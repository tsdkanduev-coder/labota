import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { CoreConfig } from "./src/core-bridge.js";
import type { CallRecord } from "./src/types.js";
import { registerVoiceCallCli } from "./src/cli.js";
import {
  VoiceCallConfigSchema,
  resolveVoiceCallConfig,
  validateProviderConfig,
  type VoiceCallConfig,
} from "./src/config.js";
import { createVoiceCallRuntime, type VoiceCallRuntime } from "./src/runtime.js";

/** Structured booking details extracted from call transcript by LLM. */
export interface BookingDetails {
  confirmed: boolean;
  restaurant?: string;
  date?: string; // YYYY-MM-DD (Moscow)
  time?: string; // HH:MM (Moscow)
  durationMinutes?: number;
  guestName?: string;
  guestCount?: number;
  address?: string;
  notes?: string;
}

export interface LlmSummaryResponse {
  summary: string;
  booking: BookingDetails | null;
}

const voiceCallConfigSchema = {
  parse(value: unknown): VoiceCallConfig {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    const twilio = raw.twilio as Record<string, unknown> | undefined;
    const legacyFrom = typeof twilio?.from === "string" ? twilio.from : undefined;

    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
    const providerRaw = raw.provider === "log" ? "mock" : raw.provider;
    const provider = providerRaw ?? (enabled ? "mock" : undefined);

    return VoiceCallConfigSchema.parse({
      ...raw,
      enabled,
      provider,
      fromNumber: raw.fromNumber ?? legacyFrom,
    });
  },
  uiHints: {
    provider: {
      label: "Provider",
      help: "Use twilio, telnyx, plivo, voximplant, or mock for dev/no-network.",
    },
    fromNumber: { label: "From Number", placeholder: "+15550001234" },
    toNumber: { label: "Default To Number", placeholder: "+15550001234" },
    inboundPolicy: { label: "Inbound Policy" },
    allowFrom: { label: "Inbound Allowlist" },
    inboundGreeting: { label: "Inbound Greeting", advanced: true },
    "telnyx.apiKey": { label: "Telnyx API Key", sensitive: true },
    "telnyx.connectionId": { label: "Telnyx Connection ID" },
    "telnyx.publicKey": { label: "Telnyx Public Key", sensitive: true },
    "twilio.accountSid": { label: "Twilio Account SID" },
    "twilio.authToken": { label: "Twilio Auth Token", sensitive: true },
    "voximplant.managementJwt": { label: "Voximplant Management JWT", sensitive: true },
    "voximplant.managementAccountId": {
      label: "Voximplant Management Account ID",
      advanced: true,
    },
    "voximplant.managementKeyId": { label: "Voximplant Management Key ID", advanced: true },
    "voximplant.managementPrivateKey": {
      label: "Voximplant Management Private Key",
      sensitive: true,
      advanced: true,
    },
    "voximplant.managementJwtRefreshSkewSec": {
      label: "Voximplant JWT Refresh Skew (sec)",
      advanced: true,
    },
    "voximplant.ruleId": { label: "Voximplant Rule ID" },
    "voximplant.apiBaseUrl": { label: "Voximplant API Base URL", advanced: true },
    "voximplant.webhookSecret": { label: "Voximplant Webhook Secret", sensitive: true },
    "voximplant.controlTimeoutMs": { label: "Voximplant Control Timeout (ms)", advanced: true },
    "outbound.defaultMode": { label: "Default Call Mode" },
    "outbound.notifyHangupDelaySec": {
      label: "Notify Hangup Delay (sec)",
      advanced: true,
    },
    "serve.port": { label: "Webhook Port" },
    "serve.bind": { label: "Webhook Bind" },
    "serve.path": { label: "Webhook Path" },
    "tailscale.mode": { label: "Tailscale Mode", advanced: true },
    "tailscale.path": { label: "Tailscale Path", advanced: true },
    "tunnel.provider": { label: "Tunnel Provider", advanced: true },
    "tunnel.ngrokAuthToken": {
      label: "ngrok Auth Token",
      sensitive: true,
      advanced: true,
    },
    "tunnel.ngrokDomain": { label: "ngrok Domain", advanced: true },
    "tunnel.allowNgrokFreeTierLoopbackBypass": {
      label: "Allow ngrok Free Tier (Loopback Bypass)",
      advanced: true,
    },
    "streaming.enabled": { label: "Enable Streaming", advanced: true },
    "streaming.mode": {
      label: "Streaming Mode",
      help: "stt-llm-tts (legacy cascade) or realtime-conversation (OpenAI voice brain).",
      advanced: true,
    },
    "streaming.openaiApiKey": {
      label: "OpenAI Realtime API Key",
      sensitive: true,
      advanced: true,
    },
    "streaming.sttModel": { label: "Realtime STT Model", advanced: true },
    "streaming.realtimeModel": { label: "Realtime Conversation Model", advanced: true },
    "streaming.assistantVoice": { label: "Realtime Assistant Voice", advanced: true },
    "streaming.assistantInstructions": {
      label: "Realtime Assistant Instructions",
      advanced: true,
    },
    "streaming.bargeInOnSpeechStart": { label: "Barge-in On Speech Start", advanced: true },
    "streaming.streamPath": { label: "Media Stream Path", advanced: true },
    "tts.provider": {
      label: "TTS Provider Override",
      help: "Deep-merges with messages.tts (Edge is ignored for calls).",
      advanced: true,
    },
    "tts.openai.model": { label: "OpenAI TTS Model", advanced: true },
    "tts.openai.voice": { label: "OpenAI TTS Voice", advanced: true },
    "tts.openai.apiKey": {
      label: "OpenAI API Key",
      sensitive: true,
      advanced: true,
    },
    "tts.elevenlabs.modelId": { label: "ElevenLabs Model ID", advanced: true },
    "tts.elevenlabs.voiceId": { label: "ElevenLabs Voice ID", advanced: true },
    "tts.elevenlabs.apiKey": {
      label: "ElevenLabs API Key",
      sensitive: true,
      advanced: true,
    },
    "tts.elevenlabs.baseUrl": { label: "ElevenLabs Base URL", advanced: true },
    publicUrl: { label: "Public Webhook URL", advanced: true },
    skipSignatureVerification: {
      label: "Skip Signature Verification",
      advanced: true,
    },
    store: { label: "Call Log Store Path", advanced: true },
    responseModel: { label: "Response Model", advanced: true },
    responseSystemPrompt: { label: "Response System Prompt", advanced: true },
    responseTimeoutMs: { label: "Response Timeout (ms)", advanced: true },
  },
};

const VoiceCallToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("initiate_call"),
    to: Type.Optional(Type.String({ description: "Call target" })),
    prompt: Type.String({
      description:
        "Task for the voice call in one sentence in Russian. " +
        "MUST include three mandatory details: (1) guest name, (2) date/time, (3) number of guests. " +
        "If any of these are missing from the user's message, ask the user BEFORE calling — do NOT call without them. " +
        "Example: 'Забронировать столик на имя Елена, завтра 20:00, 4 гостя'. " +
        "Do NOT add behavioral instructions or role descriptions — just the task.",
    }),
    message: Type.Optional(Type.String({ description: "Fallback intro text (for notify mode)" })),
    language: Type.Optional(Type.String({ description: "Preferred language code (ru/en/etc)" })),
    mode: Type.Optional(Type.Union([Type.Literal("notify"), Type.Literal("conversation")])),
  }),
  Type.Object({
    action: Type.Literal("continue_call"),
    callId: Type.String({ description: "Call ID" }),
    message: Type.String({ description: "Follow-up message" }),
  }),
  Type.Object({
    action: Type.Literal("speak_to_user"),
    callId: Type.String({ description: "Call ID" }),
    message: Type.String({ description: "Message to speak" }),
  }),
  Type.Object({
    action: Type.Literal("end_call"),
    callId: Type.String({ description: "Call ID" }),
  }),
  Type.Object({
    action: Type.Literal("get_status"),
    callId: Type.String({ description: "Call ID" }),
  }),
  Type.Object({
    action: Type.Literal("get_call_history"),
    callId: Type.Optional(Type.String({ description: "Filter by call ID or provider call ID" })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
    includeAllSessions: Type.Optional(
      Type.Boolean({ description: "When true, includes calls from all sessions" }),
    ),
  }),
  Type.Object({
    mode: Type.Optional(Type.Union([Type.Literal("call"), Type.Literal("status")])),
    to: Type.Optional(Type.String({ description: "Call target" })),
    sid: Type.Optional(Type.String({ description: "Call SID" })),
    message: Type.Optional(Type.String({ description: "Optional intro message" })),
  }),
]);

function resolveHistoryLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 20;
  }
  const normalized = Math.trunc(value);
  if (normalized < 1) {
    return 1;
  }
  if (normalized > 200) {
    return 200;
  }
  return normalized;
}

function getLatestCallSnapshots(records: CallRecord[]): CallRecord[] {
  const byCallId = new Map<string, CallRecord>();
  for (const record of records) {
    byCallId.set(record.callId, record);
  }
  return Array.from(byCallId.values()).sort((a, b) => {
    const aTs = a.endedAt ?? a.startedAt;
    const bTs = b.endedAt ?? b.startedAt;
    return bTs - aTs;
  });
}

const voiceCallPlugin = {
  id: "voice-call",
  name: "Voice Call",
  description: "Voice-call plugin with Telnyx/Twilio/Plivo/Voximplant providers",
  configSchema: voiceCallConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolveVoiceCallConfig(voiceCallConfigSchema.parse(api.pluginConfig));
    const validation = validateProviderConfig(config);

    if (api.pluginConfig && typeof api.pluginConfig === "object") {
      const raw = api.pluginConfig as Record<string, unknown>;
      const twilio = raw.twilio as Record<string, unknown> | undefined;
      if (raw.provider === "log") {
        api.logger.warn('[voice-call] provider "log" is deprecated; use "mock" instead');
      }
      if (typeof twilio?.from === "string") {
        api.logger.warn("[voice-call] twilio.from is deprecated; use fromNumber instead");
      }
    }

    let runtimePromise: Promise<VoiceCallRuntime> | null = null;
    let runtime: VoiceCallRuntime | null = null;

    const ensureRuntime = async () => {
      if (!config.enabled) {
        throw new Error("Voice call disabled in plugin config");
      }
      if (!validation.valid) {
        throw new Error(validation.errors.join("; "));
      }
      if (runtime) {
        return runtime;
      }
      if (!runtimePromise) {
        runtimePromise = createVoiceCallRuntime({
          config,
          coreConfig: api.config as CoreConfig,
          ttsRuntime: api.runtime.tts,
          logger: api.logger,
        });
      }
      runtime = await runtimePromise;
      runtime.manager.setOnCallEndedHook((call) => {
        const sessionKey = typeof call.sessionKey === "string" ? call.sessionKey.trim() : "";
        if (!sessionKey) {
          api.logger.warn(
            `[voice-call] onCallEnded: no sessionKey for call ${call.callId}, cannot report`,
          );
          return;
        }
        const reason = call.endReason ?? call.state;
        const transcript = call.transcript.slice(-120).map((entry) => ({
          speaker: entry.speaker,
          text: entry.text,
          timestamp: entry.timestamp,
        }));
        const prompt = typeof call.metadata?.prompt === "string" ? call.metadata.prompt.trim() : "";
        const startedAtIso = new Date(call.startedAt).toISOString();
        const endedAtIso = new Date(call.endedAt ?? Date.now()).toISOString();
        const durationSec = Math.max(
          0,
          Math.round(((call.endedAt ?? Date.now()) - call.startedAt) / 1000),
        );
        const payload = {
          type: "voice_call_outcome",
          callId: call.callId,
          providerCallId: call.providerCallId ?? null,
          from: call.from,
          to: call.to,
          state: call.state,
          reason,
          startedAt: startedAtIso,
          endedAt: endedAtIso,
          durationSec,
          prompt: prompt || null,
          transcriptCount: call.transcript.length,
          transcript,
        };

        // Decide delivery path: proactive Telegram message (preferred) or system event fallback.
        const telegramChatId =
          extractTelegramChatId(sessionKey) ?? extractChatIdFromMessageTo(call.messageTo);

        if (telegramChatId) {
          // Send proactive LLM summary with optional calendar link directly to Telegram.
          (async () => {
            let summary: string;
            let calendarUrl: string | null = null;
            try {
              const result = await generateLlmSummary(transcript, prompt, durationSec, call);
              summary = result.summary;
              if (result.booking) {
                calendarUrl = buildGoogleCalendarUrl(result.booking);
              }
            } catch (err) {
              api.logger.warn(
                `[voice-call] LLM summary failed, using template: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
              summary = buildCallSummary(call, transcript, prompt, durationSec);
            }
            if (calendarUrl) {
              summary += `\n\n[📅 Добавить в календарь](${calendarUrl})`;
            }
            api.logger.info(
              `[voice-call] Sending proactive Telegram message to ${telegramChatId} for call ${call.callId}`,
            );
            api.runtime.channel.telegram
              .sendMessageTelegram(telegramChatId, summary)
              .catch((sendErr: unknown) => {
                api.logger.warn(
                  `[voice-call] Failed to send proactive Telegram message: ${
                    sendErr instanceof Error ? sendErr.message : String(sendErr)
                  }`,
                );
              });
          })();
        } else {
          // No Telegram chat ID — fall back to system event (agent responds on next user message).
          const systemPromptForAgent = [
            "VOICE_CALL_COMPLETED",
            [
              "Ты — профессиональный консьерж-ассистент. Проанализируй транскрипт звонка и напиши пользователю в текущий Telegram-чат отчёт о результате.",
              "",
              "Стиль общения:",
              "— Деловой, уважительный, тёплый тон. Никаких смайликов и восклицательных знаков через слово.",
              "— Обращайся к пользователю по имени, если оно известно из контекста чата.",
              "— Пиши от первого лица множественного числа («мы уточнили», «мы забронировали»).",
              "— Будь лаконичен: главное — результат, детали, следующий шаг.",
              "",
              "Структура ответа (адаптируй под ситуацию, не все блоки обязательны):",
              "1. Краткий итог: что удалось/не удалось.",
              "2. Детали: дата, время, адрес, зал, количество персон, ограничения — всё что удалось выяснить из разговора.",
              "3. Если есть дополнительная информация от собеседника (условия, ограничения, альтернативы) — укажи.",
              "4. Если цель не достигнута — объясни причину и предложи конкретный следующий шаг.",
              "5. Завершай фразой в духе «Остаёмся в вашем распоряжении по любым вопросам.»",
              "",
              "Не выдумывай информацию — используй только то, что есть в транскрипте.",
            ].join("\n"),
            JSON.stringify(payload, null, 2),
          ].join("\n\n");

          try {
            api.runtime.system.enqueueSystemEvent(systemPromptForAgent, {
              sessionKey,
              contextKey: `voice-call:${call.callId}:ended`,
            });
          } catch (err) {
            api.logger.warn(
              `[voice-call] Failed to enqueue call-ended system event: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      });
      return runtime;
    };

    const sendError = (respond: (ok: boolean, payload?: unknown) => void, err: unknown) => {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    };

    api.registerGatewayMethod(
      "voicecall.initiate",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const prompt = typeof params?.prompt === "string" ? params.prompt.trim() : "";
          const message = typeof params?.message === "string" ? params.message.trim() : "";
          const effectivePrompt = prompt || message;
          if (!effectivePrompt) {
            respond(false, { error: "prompt or message required" });
            return;
          }
          if (!prompt && message) {
            console.warn(
              "[voice-call] voicecall.initiate called with message but no prompt — " +
                "please migrate to the prompt field",
            );
          }
          const rt = await ensureRuntime();
          const to =
            typeof params?.to === "string" && params.to.trim()
              ? params.to.trim()
              : rt.config.toNumber;
          if (!to) {
            respond(false, { error: "to required" });
            return;
          }
          const mode =
            params?.mode === "notify" || params?.mode === "conversation" ? params.mode : undefined;
          const language =
            typeof params?.language === "string" && params.language.trim()
              ? params.language.trim()
              : undefined;
          // Accept sessionKey so the call-ended hook can report results back
          // to the originating chat session (Telegram group/DM).
          const gatewaySessionKey =
            typeof params?.sessionKey === "string" && params.sessionKey.trim()
              ? params.sessionKey.trim()
              : undefined;
          const result = await rt.manager.initiateCall(to, gatewaySessionKey, {
            message: message || effectivePrompt,
            prompt: effectivePrompt,
            language,
            mode,
          });
          if (!result.success) {
            respond(false, { error: result.error || "initiate failed" });
            return;
          }
          respond(true, { callId: result.callId, initiated: true });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.continue",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const callId = typeof params?.callId === "string" ? params.callId.trim() : "";
          const message = typeof params?.message === "string" ? params.message.trim() : "";
          if (!callId || !message) {
            respond(false, { error: "callId and message required" });
            return;
          }
          const rt = await ensureRuntime();
          const result = await rt.manager.continueCall(callId, message);
          if (!result.success) {
            respond(false, { error: result.error || "continue failed" });
            return;
          }
          respond(true, { success: true, transcript: result.transcript });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.speak",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const callId = typeof params?.callId === "string" ? params.callId.trim() : "";
          const message = typeof params?.message === "string" ? params.message.trim() : "";
          if (!callId || !message) {
            respond(false, { error: "callId and message required" });
            return;
          }
          const rt = await ensureRuntime();
          const result = await rt.manager.speak(callId, message);
          if (!result.success) {
            respond(false, { error: result.error || "speak failed" });
            return;
          }
          respond(true, { success: true });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.end",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const callId = typeof params?.callId === "string" ? params.callId.trim() : "";
          if (!callId) {
            respond(false, { error: "callId required" });
            return;
          }
          const rt = await ensureRuntime();
          const result = await rt.manager.endCall(callId);
          if (!result.success) {
            respond(false, { error: result.error || "end failed" });
            return;
          }
          respond(true, { success: true });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.status",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const raw =
            typeof params?.callId === "string"
              ? params.callId.trim()
              : typeof params?.sid === "string"
                ? params.sid.trim()
                : "";
          if (!raw) {
            respond(false, { error: "callId required" });
            return;
          }
          const rt = await ensureRuntime();
          const call = rt.manager.getCall(raw) || rt.manager.getCallByProviderCallId(raw);
          if (!call) {
            respond(true, { found: false });
            return;
          }
          respond(true, { found: true, call });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "voicecall.start",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const to = typeof params?.to === "string" ? params.to.trim() : "";
          const message = typeof params?.message === "string" ? params.message.trim() : "";
          if (!to) {
            respond(false, { error: "to required" });
            return;
          }
          const rt = await ensureRuntime();
          const prompt =
            typeof params?.prompt === "string" && params.prompt.trim()
              ? params.prompt.trim()
              : undefined;
          const language =
            typeof params?.language === "string" && params.language.trim()
              ? params.language.trim()
              : undefined;
          const result = await rt.manager.initiateCall(to, undefined, {
            message: message || undefined,
            prompt,
            language,
          });
          if (!result.success) {
            respond(false, { error: result.error || "initiate failed" });
            return;
          }
          respond(true, { callId: result.callId, initiated: true });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerTool((toolCtx) => {
      const sessionKey =
        typeof toolCtx.sessionKey === "string" && toolCtx.sessionKey.trim()
          ? toolCtx.sessionKey.trim()
          : undefined;
      const messageTo =
        typeof toolCtx.messageTo === "string" && toolCtx.messageTo.trim()
          ? toolCtx.messageTo.trim()
          : undefined;
      return {
        name: "voice_call",
        label: "Voice Call",
        description:
          "Make phone calls via voice-call plugin. " +
          "For initiate_call, `prompt` MUST contain the task with three required details: " +
          "guest name, date/time, and number of guests. " +
          "If any detail is missing, ask the user first — never call without all three. " +
          "Example: 'Забронировать столик на имя Елена, завтра 20:00, 4 гостя'. " +
          "Do NOT add role or behavioral instructions — just the task.",
        parameters: VoiceCallToolSchema,
        async execute(_toolCallId, params) {
          const json = (payload: unknown) => ({
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            details: payload,
          });

          try {
            const rt = await ensureRuntime();

            if (typeof params?.action === "string") {
              switch (params.action) {
                case "initiate_call": {
                  const prompt = String(params.prompt || "").trim();
                  if (!prompt) {
                    throw new Error("prompt required");
                  }
                  const to =
                    typeof params.to === "string" && params.to.trim()
                      ? params.to.trim()
                      : rt.config.toNumber;
                  if (!to) {
                    throw new Error("to required");
                  }
                  const message =
                    typeof params.message === "string" && params.message.trim()
                      ? params.message.trim()
                      : prompt;
                  const language =
                    typeof params.language === "string" && params.language.trim()
                      ? params.language.trim()
                      : undefined;
                  const result = await rt.manager.initiateCall(to, sessionKey, {
                    message,
                    prompt,
                    language,
                    mode:
                      params.mode === "notify" || params.mode === "conversation"
                        ? params.mode
                        : undefined,
                    messageTo,
                  });
                  if (!result.success) {
                    throw new Error(result.error || "initiate failed");
                  }
                  return json({ callId: result.callId, initiated: true });
                }
                case "continue_call": {
                  const callId = String(params.callId || "").trim();
                  const message = String(params.message || "").trim();
                  if (!callId || !message) {
                    throw new Error("callId and message required");
                  }
                  const result = await rt.manager.continueCall(callId, message);
                  if (!result.success) {
                    throw new Error(result.error || "continue failed");
                  }
                  return json({ success: true, transcript: result.transcript });
                }
                case "speak_to_user": {
                  const callId = String(params.callId || "").trim();
                  const message = String(params.message || "").trim();
                  if (!callId || !message) {
                    throw new Error("callId and message required");
                  }
                  const result = await rt.manager.speak(callId, message);
                  if (!result.success) {
                    throw new Error(result.error || "speak failed");
                  }
                  return json({ success: true });
                }
                case "end_call": {
                  const callId = String(params.callId || "").trim();
                  if (!callId) {
                    throw new Error("callId required");
                  }
                  const result = await rt.manager.endCall(callId);
                  if (!result.success) {
                    throw new Error(result.error || "end failed");
                  }
                  return json({ success: true });
                }
                case "get_status": {
                  const callId = String(params.callId || "").trim();
                  if (!callId) {
                    throw new Error("callId required");
                  }
                  const call =
                    rt.manager.getCall(callId) || rt.manager.getCallByProviderCallId(callId);
                  return json(call ? { found: true, call } : { found: false });
                }
                case "get_call_history": {
                  const requestedCallId = String(params.callId || "").trim();
                  const limit = resolveHistoryLimit(params.limit);
                  const includeAllSessions = params.includeAllSessions === true;
                  const raw = await rt.manager.getCallHistory(limit * 6);
                  const snapshots = getLatestCallSnapshots(raw);
                  const scoped =
                    includeAllSessions || !sessionKey
                      ? snapshots
                      : snapshots.filter((call) => call.sessionKey === sessionKey);
                  const filtered = requestedCallId
                    ? scoped.filter(
                        (call) =>
                          call.callId === requestedCallId ||
                          call.providerCallId === requestedCallId,
                      )
                    : scoped.slice(0, limit);

                  return json({
                    count: filtered.length,
                    scope:
                      includeAllSessions || !sessionKey ? "all-sessions" : `session:${sessionKey}`,
                    calls: filtered,
                  });
                }
              }
            }

            const mode = params?.mode ?? "call";
            if (mode === "status") {
              const sid = typeof params.sid === "string" ? params.sid.trim() : "";
              if (!sid) {
                throw new Error("sid required for status");
              }
              const call = rt.manager.getCall(sid) || rt.manager.getCallByProviderCallId(sid);
              return json(call ? { found: true, call } : { found: false });
            }

            const to =
              typeof params.to === "string" && params.to.trim()
                ? params.to.trim()
                : rt.config.toNumber;
            if (!to) {
              throw new Error("to required for call");
            }
            const result = await rt.manager.initiateCall(to, sessionKey, {
              message:
                typeof params.message === "string" && params.message.trim()
                  ? params.message.trim()
                  : undefined,
              prompt:
                typeof params.prompt === "string" && params.prompt.trim()
                  ? params.prompt.trim()
                  : undefined,
              language:
                typeof params.language === "string" && params.language.trim()
                  ? params.language.trim()
                  : undefined,
            });
            if (!result.success) {
              throw new Error(result.error || "initiate failed");
            }
            return json({ callId: result.callId, initiated: true });
          } catch (err) {
            return json({
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    });

    api.registerCli(
      ({ program }) =>
        registerVoiceCallCli({
          program,
          config,
          ensureRuntime,
          logger: api.logger,
        }),
      { commands: ["voicecall"] },
    );

    api.registerService({
      id: "voicecall",
      start: async () => {
        if (!config.enabled) {
          return;
        }
        try {
          await ensureRuntime();
        } catch (err) {
          api.logger.error(
            `[voice-call] Failed to start runtime: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
      stop: async () => {
        if (!runtimePromise) {
          return;
        }
        try {
          const rt = await runtimePromise;
          await rt.stop();
        } finally {
          runtimePromise = null;
          runtime = null;
        }
      },
    });
  },
};

/**
 * Extract a Telegram chat ID from a session key.
 * Session keys follow the pattern: "agent:<agentId>:telegram:<type>:<chatId>[:topic:<topicId>]"
 * where <type> is "dm", "group", etc.
 * Returns the chat ID string (e.g. "-100123456789") or null if not a Telegram session.
 */
function extractTelegramChatId(sessionKey: string): string | null {
  // Match "telegram:dm:<id>" or "telegram:group:<id>" or "telegram:direct:<id>" patterns
  const match = sessionKey.match(/telegram:(?:dm|group|direct):(-?\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract a Telegram chat ID from a messageTo delivery target.
 * messageTo can be "telegram:<chatId>" or "telegram:<type>:<chatId>".
 * This is a fallback for when sessionKey doesn't contain the chatId (e.g. dmScope="main").
 */
function extractChatIdFromMessageTo(messageTo?: string): string | null {
  if (!messageTo) return null;
  // "telegram:direct:123", "telegram:dm:123", "telegram:group:123"
  const typed = messageTo.match(/^telegram:(?:direct|dm|group):(-?\d+)/);
  if (typed) return typed[1];
  // "telegram:123" (short form used by OpenClaw core)
  const short = messageTo.match(/^telegram:(-?\d+)/);
  return short ? short[1] : null;
}

/**
 * Generate a concierge-style call summary using LLM (gpt-4o-mini).
 * Uses the same prompt style as the system event LLM summary, but returns
 * the result directly instead of enqueuing for next user message.
 */
async function generateLlmSummary(
  transcript: Array<{ speaker: string; text: string }>,
  prompt: string,
  durationSec: number,
  call: CallRecord,
): Promise<LlmSummaryResponse> {
  // Build reference date string in Moscow timezone for resolving "завтра"/"в четверг"
  const callDate = new Date(call.startedAt);
  const isoDate = callDate.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" }); // YYYY-MM-DD
  const weekday = callDate.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
  });
  const longDate = callDate.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const systemPrompt = [
    "Ты — профессиональный консьерж-ассистент. Проанализируй транскрипт звонка и верни результат строго в формате JSON.",
    "",
    "Формат ответа (JSON):",
    "{",
    '  "summary": "текст отчёта для клиента",',
    '  "booking": { ... } или null',
    "}",
    "",
    "Поле summary — текст для клиента:",
    "— Деловой, уважительный, тёплый тон. Никаких смайликов.",
    "— От первого лица множественного числа («мы уточнили», «мы забронировали»).",
    "— Структура: 1) Итог (одно-два предложения), 2) Детали (список через «—»), 3) Следующий шаг.",
    "— Завершай: «Остаёмся в вашем распоряжении по любым вопросам.»",
    "— Не выдумывай — только факты из транскрипта.",
    "",
    "Поле booking — структурированные данные бронирования (или null если бронь не состоялась):",
    '{ "confirmed": true/false, "restaurant": "название", "date": "YYYY-MM-DD", "time": "HH:MM",',
    '  "durationMinutes": 90, "guestName": "имя", "guestCount": 2, "address": "адрес", "notes": "примечания" }',
    "Если бронирование НЕ подтверждено — confirmed: false. Неизвестные поля не включай.",
    "",
    `Дата звонка: ${isoDate} (${weekday}, ${longDate}). Таймзона: Europe/Moscow.`,
    "Если собеседник говорит «завтра» — это следующий день от даты звонка. «Послезавтра» — через два дня.",
  ].join("\n");

  const userMessage = [
    `Задача звонка: ${prompt}`,
    `Длительность: ${durationSec} сек`,
    `Результат: ${call.endReason ?? call.state}`,
    "",
    "Транскрипт:",
    ...transcript.map((t) => {
      const speaker = t.speaker === "bot" || t.speaker === "assistant" ? "Бот" : "Собеседник";
      return `${speaker}: ${t.text}`;
    }),
  ].join("\n");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent =
    data.choices?.[0]?.message?.content?.trim() ?? '{"summary":"Звонок завершён."}';
  return parseLlmResponse(rawContent);
}

/**
 * Parse the JSON response from LLM into summary text and optional booking details.
 * Falls back to raw text as summary if JSON parsing fails.
 */
export function parseLlmResponse(raw: string): LlmSummaryResponse {
  try {
    const parsed = JSON.parse(raw);
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : raw;
    let booking: BookingDetails | null = null;
    if (parsed.booking && typeof parsed.booking === "object" && parsed.booking.confirmed === true) {
      booking = {
        confirmed: true,
        restaurant:
          typeof parsed.booking.restaurant === "string" ? parsed.booking.restaurant : undefined,
        date: typeof parsed.booking.date === "string" ? parsed.booking.date : undefined,
        time: typeof parsed.booking.time === "string" ? parsed.booking.time : undefined,
        durationMinutes:
          typeof parsed.booking.durationMinutes === "number"
            ? parsed.booking.durationMinutes
            : undefined,
        guestName:
          typeof parsed.booking.guestName === "string" ? parsed.booking.guestName : undefined,
        guestCount:
          typeof parsed.booking.guestCount === "number" ? parsed.booking.guestCount : undefined,
        address: typeof parsed.booking.address === "string" ? parsed.booking.address : undefined,
        notes: typeof parsed.booking.notes === "string" ? parsed.booking.notes : undefined,
      };
    }
    return { summary, booking };
  } catch {
    return { summary: raw.trim(), booking: null };
  }
}

/**
 * Build a Google Calendar event URL from booking details.
 * Uses ctz=Europe/Moscow with local dates (no UTC conversion needed).
 * Returns null if booking is not confirmed or missing date/time.
 */
export function buildGoogleCalendarUrl(booking: BookingDetails): string | null {
  if (!booking.confirmed || !booking.date || !booking.time) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) return null;
  if (!/^\d{2}:\d{2}$/.test(booking.time)) return null;

  const pad = (n: number) => String(n).padStart(2, "0");

  const [startH, startM] = booking.time.split(":").map(Number);
  const [startY, startMo, startD] = booking.date.split("-").map(Number);
  const startLocal = `${startY}${pad(startMo)}${pad(startD)}T${pad(startH)}${pad(startM)}00`;

  // End time via pure minute arithmetic (no Date — no timezone dependency on host)
  const durationMin = booking.durationMinutes ?? 90;
  let endTotalMin = startH * 60 + startM + durationMin;
  let endD = startD;
  while (endTotalMin >= 24 * 60) {
    endTotalMin -= 24 * 60;
    endD += 1;
  }
  const endH = Math.floor(endTotalMin / 60);
  const endMin = endTotalMin % 60;
  const endLocal = `${startY}${pad(startMo)}${pad(endD)}T${pad(endH)}${pad(endMin)}00`;

  const titleParts: string[] = [];
  if (booking.restaurant) titleParts.push(booking.restaurant);
  if (booking.guestName) titleParts.push(`на имя ${booking.guestName}`);
  if (booking.guestCount) titleParts.push(`${booking.guestCount} чел.`);
  const title = titleParts.length ? `Бронь: ${titleParts.join(", ")}` : "Бронирование столика";

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${startLocal}/${endLocal}`,
    ctz: "Europe/Moscow",
  });
  if (booking.address) params.set("location", booking.address);
  else if (booking.restaurant) params.set("location", booking.restaurant);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Build a human-readable call summary for direct Telegram delivery (fallback).
 * Simple template used when LLM summary fails or is unavailable.
 */
function buildCallSummary(
  call: CallRecord,
  transcript: Array<{ speaker: string; text: string }>,
  prompt: string,
  durationSec: number,
): string {
  const lines: string[] = [];

  // Header
  const succeeded =
    call.state === "hangup-user" || call.state === "hangup-bot" || call.state === "timeout";
  if (succeeded) {
    lines.push("Звонок завершён.");
  } else {
    lines.push(`Звонок завершён (${call.endReason ?? call.state}).`);
  }

  // Task description (first 150 chars of prompt)
  if (prompt) {
    const short = prompt.length > 150 ? `${prompt.slice(0, 150)}…` : prompt;
    lines.push(`Задача: ${short}`);
  }

  // Duration
  if (durationSec > 0) {
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    lines.push(`Длительность: ${min > 0 ? `${min} мин ` : ""}${sec} сек`);
  }

  // Last few transcript lines (up to 6)
  if (transcript.length > 0) {
    lines.push("");
    lines.push("Ключевые реплики:");
    const recent = transcript.slice(-6);
    for (const entry of recent) {
      const speaker =
        entry.speaker === "bot" || entry.speaker === "assistant" ? "Бот" : "Собеседник";
      lines.push(`— ${speaker}: ${entry.text}`);
    }
  }

  lines.push("");
  lines.push("Остаёмся в вашем распоряжении.");

  return lines.join("\n");
}

export default voiceCallPlugin;
