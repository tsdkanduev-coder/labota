import crypto from "node:crypto";
import type { VoximplantConfig } from "../config.js";
import type { MediaStreamHandler } from "../media-stream.js";
import type { TelephonyTtsProvider } from "../telephony-tts.js";
import type {
  EndReason,
  HangupCallInput,
  InitiateCallInput,
  InitiateCallResult,
  NormalizedEvent,
  PlayTtsInput,
  ProviderWebhookParseResult,
  StartListeningInput,
  StopListeningInput,
  WebhookContext,
  WebhookVerificationResult,
} from "../types.js";
import type { VoiceCallProvider } from "./base.js";
import { chunkAudio } from "../telephony-audio.js";

export interface VoximplantProviderOptions {
  /** Skip webhook verification (development only) */
  skipVerification?: boolean;
  /** Shared secret expected in webhook callback */
  webhookSecret?: string;
  /** Timeout for control URL commands in milliseconds */
  controlTimeoutMs?: number;
  /** Override public URL origin for media stream URL generation */
  publicUrl?: string;
  /** Path for media stream WebSocket endpoint */
  streamPath?: string;
}

type JsonRecord = Record<string, unknown>;
type CachedJwt = { token: string; exp: number };
type VoximplantServiceAccount = {
  accountId: string;
  keyId: string;
  privateKey: string;
};

const VOXIMPLANT_MANAGEMENT_JWT_SENTINELS = new Set(["AUTO", "__AUTO__", "__SERVICE_ACCOUNT__"]);

function normalizeManagementJwtCandidate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (VOXIMPLANT_MANAGEMENT_JWT_SENTINELS.has(trimmed)) {
    return null;
  }
  if (/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Voximplant provider using:
 * - Management API StartScenarios for outbound call bootstrap
 * - media_session_access_secure_url for in-call commands (TTS/listen/hangup)
 * - JSON webhook callbacks from VoxEngine scenario to OpenClaw webhook
 */
export class VoximplantProvider implements VoiceCallProvider {
  readonly name = "voximplant" as const;

  private readonly managementJwtStatic: string | null;
  private readonly managementServiceAccount: VoximplantServiceAccount | null;
  private readonly managementJwtRefreshSkewSec: number;
  private readonly ruleId: string;
  private readonly apiBaseUrl: string;
  private readonly options: VoximplantProviderOptions;
  private currentPublicUrl: string | null = null;
  private ttsProvider: TelephonyTtsProvider | null = null;
  private mediaStreamHandler: MediaStreamHandler | null = null;
  private cachedManagementJwt: CachedJwt | null = null;

  private providerCallIdToControlUrl = new Map<string, string>();
  private providerCallIdToCallId = new Map<string, string>();
  private callIdToControlUrl = new Map<string, string>();
  private callStreamMap = new Map<string, string>();
  private streamAuthTokens = new Map<string, string>();

  constructor(config: VoximplantConfig, options: VoximplantProviderOptions = {}) {
    const managementJwt = normalizeManagementJwtCandidate(config.managementJwt);
    const managementAccountId = config.managementAccountId?.trim();
    const managementKeyId = config.managementKeyId?.trim();
    const managementPrivateKey = config.managementPrivateKey?.trim();
    const hasServiceAccount =
      Boolean(managementAccountId) && Boolean(managementKeyId) && Boolean(managementPrivateKey);
    if (!managementJwt && !hasServiceAccount) {
      throw new Error(
        "Voximplant auth required: set managementJwt OR service-account managementAccountId/managementKeyId/managementPrivateKey",
      );
    }
    if (!config.ruleId) {
      throw new Error("Voximplant ruleId is required");
    }

    this.managementJwtStatic = managementJwt;
    this.managementServiceAccount = hasServiceAccount
      ? {
          accountId: managementAccountId || "",
          keyId: managementKeyId || "",
          privateKey: managementPrivateKey || "",
        }
      : null;
    this.managementJwtRefreshSkewSec = config.managementJwtRefreshSkewSec ?? 60;
    this.ruleId = config.ruleId;
    this.apiBaseUrl = (config.apiBaseUrl || "https://api.voximplant.com/platform_api").replace(
      /\/+$/,
      "",
    );
    this.options = {
      ...options,
      webhookSecret: options.webhookSecret ?? config.webhookSecret,
      controlTimeoutMs: options.controlTimeoutMs ?? config.controlTimeoutMs ?? 10000,
    };

    if (options.publicUrl) {
      this.currentPublicUrl = options.publicUrl;
    }
  }

  setPublicUrl(url: string): void {
    this.currentPublicUrl = url;
  }

  setTTSProvider(provider: TelephonyTtsProvider): void {
    this.ttsProvider = provider;
  }

  setMediaStreamHandler(handler: MediaStreamHandler): void {
    this.mediaStreamHandler = handler;
  }

  registerCallStream(callKey: string, streamSid: string): void {
    this.callStreamMap.set(callKey, streamSid);
    const internalCallId = this.providerCallIdToCallId.get(callKey);
    if (internalCallId) {
      this.callStreamMap.set(internalCallId, streamSid);
    }
  }

  unregisterCallStream(callKey: string): void {
    const streamSid = this.callStreamMap.get(callKey);
    this.callStreamMap.delete(callKey);

    const internalCallId = this.providerCallIdToCallId.get(callKey);
    if (internalCallId) {
      this.callStreamMap.delete(internalCallId);
    }

    if (streamSid === undefined) {
      return;
    }

    // Remove any reverse mapping that points to this stream.
    for (const [key, value] of this.callStreamMap.entries()) {
      if (value === streamSid) {
        this.callStreamMap.delete(key);
      }
    }
  }

  isValidStreamToken(callKey: string, token?: string): boolean {
    const expected = this.streamAuthTokens.get(callKey);
    if (!expected || !token) {
      return false;
    }
    if (expected.length !== token.length) {
      const dummy = Buffer.from(expected);
      crypto.timingSafeEqual(dummy, dummy);
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }

  clearTtsQueue(callKey: string): void {
    if (!this.mediaStreamHandler) {
      return;
    }
    const streamSid = this.callStreamMap.get(callKey);
    if (streamSid !== undefined) {
      this.mediaStreamHandler.clearTtsQueue(streamSid);
    }
  }

  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    if (this.options.skipVerification) {
      return { ok: true, reason: "skipVerification=true" };
    }

    const secret = this.options.webhookSecret?.trim();
    if (!secret) {
      return {
        ok: false,
        reason:
          "Missing voximplant.webhookSecret (or set VOXIMPLANT_WEBHOOK_SECRET) for webhook verification",
      };
    }

    const body = this.parseBody(ctx.rawBody);
    const providedSecret =
      this.getHeader(ctx.headers, "x-openclaw-voximplant-secret") ||
      this.getHeader(ctx.headers, "x-voximplant-secret") ||
      (typeof ctx.query?.secret === "string" ? ctx.query.secret : undefined) ||
      this.readString(body, "secret") ||
      this.readString(body, "webhookSecret");

    if (!providedSecret) {
      return { ok: false, reason: "Missing Voximplant webhook secret in request" };
    }

    if (!this.secureEquals(secret, providedSecret)) {
      return { ok: false, reason: "Invalid Voximplant webhook secret" };
    }

    return { ok: true };
  }

  parseWebhookEvent(ctx: WebhookContext): ProviderWebhookParseResult {
    const payload = this.parseBody(ctx.rawBody);
    if (!payload) {
      return { events: [], statusCode: 400 };
    }

    const event = this.normalizeEvent(payload, ctx.query);
    return {
      events: event ? [event] : [],
      statusCode: 200,
    };
  }

  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    const streamUrl = this.getStreamUrlForCall(input.callId);
    const scriptCustomData = {
      provider: "voximplant",
      callId: input.callId,
      from: input.from,
      to: input.to,
      webhookUrl: input.webhookUrl,
      webhookSecret: this.options.webhookSecret,
      streamUrl,
      clientState: input.clientState ?? {},
      inlineTwiml: input.inlineTwiml,
    };

    const response = await this.managementApiRequest("StartScenarios", {
      rule_id: this.ruleId,
      script_custom_data: JSON.stringify(scriptCustomData),
    });

    const providerCallId =
      this.pickString(response, [
        "call_session_history_id",
        "callSessionHistoryId",
        "session_id",
        "sessionId",
        "request_id",
        "requestId",
        "call_id",
        "callId",
      ]) || input.callId;

    const controlUrl = this.pickString(response, [
      "media_session_access_secure_url",
      "mediaSessionAccessSecureUrl",
      "control_url",
      "controlUrl",
      "media_session_access_url",
      "mediaSessionAccessUrl",
    ]);

    if (controlUrl) {
      this.providerCallIdToControlUrl.set(providerCallId, controlUrl);
      this.callIdToControlUrl.set(input.callId, controlUrl);
    }
    this.providerCallIdToCallId.set(providerCallId, input.callId);

    const streamToken = this.streamAuthTokens.get(input.callId);
    if (streamToken && !this.streamAuthTokens.has(providerCallId)) {
      this.streamAuthTokens.set(providerCallId, streamToken);
    }

    const streamSid = this.callStreamMap.get(input.callId);
    if (streamSid !== undefined && !this.callStreamMap.has(providerCallId)) {
      this.callStreamMap.set(providerCallId, streamSid);
    }

    return { providerCallId, status: "initiated" };
  }

  async hangupCall(input: HangupCallInput): Promise<void> {
    this.unregisterCallStream(input.providerCallId);
    this.unregisterCallStream(input.callId);
    this.streamAuthTokens.delete(input.providerCallId);
    this.streamAuthTokens.delete(input.callId);

    await this.sendControlCommand(input.callId, input.providerCallId, {
      action: "hangup",
      reason: input.reason,
    });
  }

  async playTts(input: PlayTtsInput): Promise<void> {
    const streamSid = this.resolveStreamSid(input.providerCallId, input.callId);
    if (this.ttsProvider && this.mediaStreamHandler && streamSid !== undefined) {
      await this.playTtsViaStream(input.text, streamSid);
      return;
    }

    await this.sendControlCommand(input.callId, input.providerCallId, {
      action: "speak",
      text: input.text,
      voice: input.voice,
      locale: input.locale,
    });
  }

  async startListening(input: StartListeningInput): Promise<void> {
    const streamSid = this.resolveStreamSid(input.providerCallId, input.callId);
    if (streamSid !== undefined) {
      return;
    }

    await this.sendControlCommand(input.callId, input.providerCallId, {
      action: "start_listening",
      language: input.language,
    });
  }

  async stopListening(input: StopListeningInput): Promise<void> {
    const streamSid = this.resolveStreamSid(input.providerCallId, input.callId);
    if (streamSid !== undefined) {
      return;
    }

    await this.sendControlCommand(input.callId, input.providerCallId, {
      action: "stop_listening",
    });
  }

  private async managementApiRequest(
    action: string,
    params: Record<string, string>,
  ): Promise<JsonRecord> {
    const body = new URLSearchParams(params);
    let managementJwt = await this.getManagementJwt();
    let response = await fetch(`${this.apiBaseUrl}/${action}/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementJwt}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    // If service-account mode is enabled, rotate token and retry once on auth error.
    if (response.status === 401 && this.managementServiceAccount) {
      managementJwt = await this.getManagementJwt(true);
      response = await fetch(`${this.apiBaseUrl}/${action}/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementJwt}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }

    if (!response.ok) {
      throw new Error(`Voximplant API error: ${response.status} ${text}`);
    }

    const object = this.asRecord(parsed);
    if (!object) {
      throw new Error("Voximplant API returned non-object response");
    }

    const error = this.pickString(object, ["error", "error_msg", "errorMsg"]);
    if (error) {
      throw new Error(`Voximplant API error: ${error}`);
    }
    if (typeof object.result === "number" && object.result === 0) {
      throw new Error("Voximplant API returned unsuccessful result");
    }

    return object;
  }

  private async sendControlCommand(
    callId: string,
    providerCallId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const controlUrl =
      this.providerCallIdToControlUrl.get(providerCallId) || this.callIdToControlUrl.get(callId);
    if (!controlUrl) {
      throw new Error(
        "Missing media_session_access_secure_url for this Voximplant call. Ensure your scenario emits it in webhook callbacks.",
      );
    }

    const timeoutMs = this.options.controlTimeoutMs ?? 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(controlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "voximplant",
          callId,
          providerCallId,
          ...payload,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Voximplant control error: ${response.status} ${errorText}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async playTtsViaStream(text: string, streamSid: string): Promise<void> {
    if (!this.ttsProvider || !this.mediaStreamHandler) {
      throw new Error("TTS provider and media stream handler required");
    }

    const CHUNK_SIZE = 160;
    const CHUNK_DELAY_MS = 20;

    const handler = this.mediaStreamHandler;
    const ttsProvider = this.ttsProvider;
    await handler.queueTts(streamSid, async (signal) => {
      const muLawAudio = await ttsProvider.synthesizeForTelephony(text);
      for (const chunk of chunkAudio(muLawAudio, CHUNK_SIZE)) {
        if (signal.aborted) {
          break;
        }
        handler.sendAudio(streamSid, chunk);
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        if (signal.aborted) {
          break;
        }
      }

      if (!signal.aborted) {
        handler.sendMark(streamSid, `tts-${Date.now()}`);
      }
    });
  }

  private getStreamUrl(): string | null {
    if (!this.currentPublicUrl || !this.options.streamPath) {
      return null;
    }

    const url = new URL(this.currentPublicUrl);
    const wsOrigin = url.origin.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
    const path = this.options.streamPath.startsWith("/")
      ? this.options.streamPath
      : `/${this.options.streamPath}`;
    return `${wsOrigin}${path}`;
  }

  private getStreamAuthToken(callKey: string): string {
    const existing = this.streamAuthTokens.get(callKey);
    if (existing) {
      return existing;
    }
    const token = crypto.randomBytes(16).toString("base64url");
    this.streamAuthTokens.set(callKey, token);
    return token;
  }

  private getStreamUrlForCall(callKey: string): string | null {
    const baseUrl = this.getStreamUrl();
    if (!baseUrl) {
      return null;
    }

    const token = this.getStreamAuthToken(callKey);
    const url = new URL(baseUrl);
    url.searchParams.set("token", token);
    return url.toString();
  }

  private async getManagementJwt(forceRefresh = false): Promise<string> {
    if (this.managementServiceAccount) {
      const now = Math.floor(Date.now() / 1000);
      if (
        !forceRefresh &&
        this.cachedManagementJwt &&
        this.cachedManagementJwt.exp - this.managementJwtRefreshSkewSec > now
      ) {
        return this.cachedManagementJwt.token;
      }
      const next = this.generateManagementJwt(now);
      this.cachedManagementJwt = next;
      return next.token;
    }
    if (this.managementJwtStatic) {
      return this.managementJwtStatic;
    }
    throw new Error("Voximplant management JWT is not configured");
  }

  private generateManagementJwt(nowSec: number): CachedJwt {
    if (!this.managementServiceAccount) {
      throw new Error("Voximplant service-account credentials are not configured");
    }
    const { accountId, keyId, privateKey } = this.managementServiceAccount;
    const exp = nowSec + 3600;
    const header = { alg: "RS256", typ: "JWT", kid: keyId };
    const payload = { iat: nowSec, iss: accountId, exp };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = crypto
      .sign("RSA-SHA256", Buffer.from(signingInput, "utf8"), privateKey)
      .toString("base64url");
    return { token: `${signingInput}.${signature}`, exp };
  }

  private normalizeEvent(
    payload: JsonRecord,
    query: Record<string, string | string[] | undefined> | undefined,
  ): NormalizedEvent | null {
    const eventTypeRaw =
      this.readString(payload, "type") ||
      this.readString(payload, "event") ||
      this.readString(payload, "eventType") ||
      this.readString(payload, "name");

    const eventType = this.toNormalizedEventType(eventTypeRaw);
    if (!eventType) {
      return null;
    }

    const providerCallId =
      this.readString(payload, "providerCallId") ||
      this.readString(payload, "call_session_history_id") ||
      this.readString(payload, "callSessionHistoryId") ||
      this.readString(payload, "session_id") ||
      this.readString(payload, "sessionId") ||
      this.readString(payload, "request_id") ||
      this.readString(payload, "requestId");

    const callId =
      this.readString(payload, "callId") ||
      (typeof query?.callId === "string" ? query.callId : undefined) ||
      (providerCallId ? this.providerCallIdToCallId.get(providerCallId) : undefined) ||
      providerCallId;

    if (!callId) {
      return null;
    }

    if (providerCallId) {
      this.providerCallIdToCallId.set(providerCallId, callId);
      const streamToken = this.streamAuthTokens.get(callId);
      if (streamToken && !this.streamAuthTokens.has(providerCallId)) {
        this.streamAuthTokens.set(providerCallId, streamToken);
      }
      const streamSid = this.callStreamMap.get(callId);
      if (streamSid !== undefined && !this.callStreamMap.has(providerCallId)) {
        this.callStreamMap.set(providerCallId, streamSid);
      }
    }

    const maybeControlUrl =
      this.readString(payload, "media_session_access_secure_url") ||
      this.readString(payload, "mediaSessionAccessSecureUrl");
    if (providerCallId && maybeControlUrl) {
      this.providerCallIdToControlUrl.set(providerCallId, maybeControlUrl);
      this.callIdToControlUrl.set(callId, maybeControlUrl);
      this.providerCallIdToCallId.set(providerCallId, callId);
    }

    const timestamp = this.readTimestamp(payload, "timestamp") ?? Date.now();
    const direction = this.readDirection(payload);
    const from = this.readString(payload, "from");
    const to = this.readString(payload, "to");

    const base = {
      id: this.readString(payload, "id") || crypto.randomUUID(),
      callId,
      providerCallId,
      timestamp,
      direction,
      from,
      to,
    };

    switch (eventType) {
      case "call.initiated":
        return { ...base, type: "call.initiated" };
      case "call.ringing":
        return { ...base, type: "call.ringing" };
      case "call.answered":
        return { ...base, type: "call.answered" };
      case "call.active":
        return { ...base, type: "call.active" };
      case "call.speaking":
        return {
          ...base,
          type: "call.speaking",
          text: this.readString(payload, "text") || "",
        };
      case "call.speech": {
        const transcript =
          this.readString(payload, "transcript") ||
          this.readString(payload, "text") ||
          this.readString(payload, "speech");
        if (!transcript) {
          return null;
        }
        return {
          ...base,
          type: "call.speech",
          transcript,
          isFinal: this.readBoolean(payload, "isFinal") ?? true,
          confidence: this.readNumber(payload, "confidence"),
        };
      }
      case "call.dtmf":
        return {
          ...base,
          type: "call.dtmf",
          digits: this.readString(payload, "digits") || "",
        };
      case "call.ended":
        return {
          ...base,
          type: "call.ended",
          reason: this.mapEndReason(
            this.readString(payload, "reason") || this.readString(payload, "hangupReason"),
          ),
        };
      case "call.error":
        return {
          ...base,
          type: "call.error",
          error:
            this.readString(payload, "error") || this.readString(payload, "message") || "error",
          retryable: this.readBoolean(payload, "retryable"),
        };
      default:
        return null;
    }
  }

  private resolveStreamSid(providerCallId: string, callId: string): string | undefined {
    const byProviderCallId = this.callStreamMap.get(providerCallId);
    if (byProviderCallId !== undefined) {
      return byProviderCallId;
    }
    return this.callStreamMap.get(callId);
  }

  private toNormalizedEventType(rawType?: string): NormalizedEvent["type"] | null {
    if (!rawType) {
      return null;
    }
    const normalized = rawType.trim().toLowerCase();

    if (
      normalized === "call.initiated" ||
      normalized === "call.ringing" ||
      normalized === "call.answered" ||
      normalized === "call.active" ||
      normalized === "call.speaking" ||
      normalized === "call.speech" ||
      normalized === "call.dtmf" ||
      normalized === "call.ended" ||
      normalized === "call.error"
    ) {
      return normalized;
    }

    if (["initiated", "start", "started", "outbound_start"].includes(normalized)) {
      return "call.initiated";
    }
    if (["ringing", "ring"].includes(normalized)) {
      return "call.ringing";
    }
    if (["answered", "answer", "connected", "established"].includes(normalized)) {
      return "call.answered";
    }
    if (["active", "in_progress", "in-progress"].includes(normalized)) {
      return "call.active";
    }
    if (["speaking", "tts", "say"].includes(normalized)) {
      return "call.speaking";
    }
    if (["speech", "asr", "transcript", "recognition"].includes(normalized)) {
      return "call.speech";
    }
    if (["dtmf", "digit", "digits"].includes(normalized)) {
      return "call.dtmf";
    }
    if (["ended", "hangup", "disconnected", "complete", "completed"].includes(normalized)) {
      return "call.ended";
    }
    if (["error", "failed", "failure"].includes(normalized)) {
      return "call.error";
    }

    return null;
  }

  private mapEndReason(raw?: string): EndReason {
    const value = raw?.trim().toLowerCase();
    if (!value) {
      return "completed";
    }

    if (value.includes("busy")) {
      return "busy";
    }
    if (value.includes("no-answer") || value.includes("no answer")) {
      return "no-answer";
    }
    if (value.includes("voicemail")) {
      return "voicemail";
    }
    if (value.includes("timeout")) {
      return "timeout";
    }
    if (value.includes("hangup-user") || value.includes("user")) {
      return "hangup-user";
    }
    if (value.includes("hangup-bot") || value.includes("bot")) {
      return "hangup-bot";
    }
    if (value.includes("error") || value.includes("fail")) {
      return "failed";
    }
    return "completed";
  }

  private parseBody(rawBody: string): JsonRecord | null {
    const trimmed = rawBody.trim();
    if (!trimmed) {
      return {};
    }

    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return this.asRecord(parsed);
      } catch {
        return null;
      }
    }

    try {
      const params = new URLSearchParams(trimmed);
      const out: JsonRecord = {};
      for (const [key, value] of params.entries()) {
        out[key] = value;
      }
      return out;
    } catch {
      return null;
    }
  }

  private readDirection(payload: JsonRecord): "inbound" | "outbound" | undefined {
    const value =
      this.readString(payload, "direction") ||
      this.readString(payload, "callDirection") ||
      this.readString(payload, "call_direction");
    if (!value) {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "inbound") {
      return "inbound";
    }
    if (normalized === "outbound") {
      return "outbound";
    }
    return undefined;
  }

  private readTimestamp(payload: JsonRecord, key: string): number | undefined {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 1e12 ? value : value * 1000;
    }
    if (typeof value === "string") {
      const numeric = Number.parseFloat(value);
      if (Number.isFinite(numeric)) {
        return numeric > 1e12 ? numeric : numeric * 1000;
      }
    }
    return undefined;
  }

  private pickString(response: JsonRecord, keys: string[]): string | undefined {
    const candidates: JsonRecord[] = [response];
    for (const key of ["result", "data", "payload"]) {
      const value = response[key];
      if (this.asRecord(value)) {
        candidates.push(value as JsonRecord);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          const obj = this.asRecord(item);
          if (obj) {
            candidates.push(obj);
          }
        }
      }
    }

    for (const candidate of candidates) {
      for (const key of keys) {
        const value = this.readString(candidate, key);
        if (value) {
          return value;
        }
      }
    }
    return undefined;
  }

  private readString(payload: JsonRecord | null, key: string): string | undefined {
    if (!payload) {
      return undefined;
    }
    const value = payload[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  }

  private readNumber(payload: JsonRecord, key: string): number | undefined {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private readBoolean(payload: JsonRecord, key: string): boolean | undefined {
    const value = payload[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") {
        return true;
      }
      if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
      }
    }
    return undefined;
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const direct = headers[name];
    if (Array.isArray(direct)) {
      return direct[0];
    }
    if (typeof direct === "string") {
      return direct;
    }

    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== lower) {
        continue;
      }
      if (Array.isArray(value)) {
        return value[0];
      }
      if (typeof value === "string") {
        return value;
      }
    }
    return undefined;
  }

  private secureEquals(expected: string, provided: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  }

  private asRecord(value: unknown): JsonRecord | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JsonRecord;
    }
    return null;
  }
}
