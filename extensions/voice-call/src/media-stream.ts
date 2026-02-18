/**
 * Media Stream Handler
 *
 * Handles bidirectional audio streaming between Twilio and the AI services.
 * - Receives mu-law audio from Twilio via WebSocket
 * - Forwards to OpenAI Realtime STT for transcription
 * - Sends TTS audio back to Twilio
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type {
  OpenAIRealtimeSTTProvider,
  RealtimeSTTSession,
} from "./providers/stt-openai-realtime.js";

/**
 * Configuration for the media stream handler.
 */
export interface MediaStreamConfig {
  /** STT provider for transcription */
  sttProvider: OpenAIRealtimeSTTProvider;
  /**
   * Resolve call ID from a stream auth token when provider "start" payload
   * does not include call identifiers.
   */
  resolveCallIdByToken?: (token: string) => string | undefined;
  /** Validate whether to accept a media stream for the given call ID */
  shouldAcceptStream?: (params: { callId: string; streamSid: string; token?: string }) => boolean;
  /** Callback when transcript is received */
  onTranscript?: (callId: string, transcript: string) => void;
  /** Callback for partial transcripts (streaming UI) */
  onPartialTranscript?: (callId: string, partial: string) => void;
  /** Callback when stream connects */
  onConnect?: (callId: string, streamSid: string) => void;
  /** Callback when speech starts (barge-in) */
  onSpeechStart?: (callId: string) => void;
  /** Callback when stream disconnects */
  onDisconnect?: (callId: string) => void;
}

/**
 * Active media stream session.
 */
interface StreamSession {
  callId: string;
  streamSid: string;
  ws: WebSocket;
  sttSession: RealtimeSTTSession;
  transport: "twilio-json" | "raw";
}

type TtsQueueEntry = {
  playFn: (signal: AbortSignal) => Promise<void>;
  controller: AbortController;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/**
 * Manages WebSocket connections for Twilio media streams.
 */
export class MediaStreamHandler {
  private wss: WebSocketServer | null = null;
  private sessions = new Map<string, StreamSession>();
  private config: MediaStreamConfig;
  /** TTS playback queues per stream (serialize audio to prevent overlap) */
  private ttsQueues = new Map<string, TtsQueueEntry[]>();
  /** Whether TTS is currently playing per stream */
  private ttsPlaying = new Map<string, boolean>();
  /** Active TTS playback controllers per stream */
  private ttsActiveControllers = new Map<string, AbortController>();

  constructor(config: MediaStreamConfig) {
    this.config = config;
  }

  /**
   * Handle WebSocket upgrade for media stream connections.
   */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.wss) {
      this.wss = new WebSocketServer({ noServer: true });
      this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss?.emit("connection", ws, request);
    });
  }

  /**
   * Handle new WebSocket connection from Twilio.
   */
  private async handleConnection(ws: WebSocket, _request: IncomingMessage): Promise<void> {
    let session: StreamSession | null = null;
    const streamToken = this.getStreamToken(_request);

    ws.on("message", async (data: WebSocket.RawData, isBinary: boolean) => {
      try {
        const binaryAudio = this.toBinaryBuffer(data, isBinary);
        if (binaryAudio) {
          if (!session) {
            session = await this.handleRawStart(ws, streamToken);
          }
          if (session) {
            session.sttSession.sendAudio(binaryAudio);
          }
          return;
        }

        const message = JSON.parse(this.toTextMessage(data)) as TwilioMediaMessage;

        switch (message.event) {
          case "connected":
            console.log("[MediaStream] Twilio connected");
            break;

          case "start":
            session = await this.handleStart(ws, message, streamToken);
            break;

          case "media":
            if (session && message.media?.payload) {
              // Forward audio to STT
              const audioBuffer = Buffer.from(message.media.payload, "base64");
              session.sttSession.sendAudio(audioBuffer);
            }
            break;

          case "stop":
            if (session) {
              this.handleStop(session);
              session = null;
            }
            break;
        }
      } catch (error) {
        console.error("[MediaStream] Error processing message:", error);
      }
    });

    ws.on("close", () => {
      if (session) {
        this.handleStop(session);
      }
    });

    ws.on("error", (error) => {
      console.error("[MediaStream] WebSocket error:", error);
    });
  }

  /**
   * Handle stream start event.
   */
  private async handleStart(
    ws: WebSocket,
    message: TwilioMediaMessage,
    streamToken?: string,
  ): Promise<StreamSession | null> {
    // VoxEngine sendMediaTo does not include streamSid — generate a synthetic one.
    const streamSid = message.streamSid || message.start?.streamSid || `vox-stream-${Date.now()}`;
    let callId = this.extractCallId(message);

    // Prefer token from start message customParameters (set via TwiML <Parameter>),
    // falling back to query string token. Twilio strips query params from WebSocket
    // URLs but reliably delivers <Parameter> values in customParameters.
    const startRecord = this.toRecord(message.start);
    const customRecord =
      this.toRecord(startRecord?.customParameters) ??
      this.toRecord(startRecord?.custom_parameters) ??
      this.toRecord(startRecord?.customData) ??
      this.toRecord(startRecord?.custom_data) ??
      this.toRecord((message as unknown as Record<string, unknown>)?.customParameters) ??
      this.toRecord((message as unknown as Record<string, unknown>)?.custom_parameters) ??
      this.toRecord((message as unknown as Record<string, unknown>)?.customData) ??
      this.toRecord((message as unknown as Record<string, unknown>)?.custom_data);
    const effectiveToken =
      this.pickString(customRecord, [
        "token",
        "streamToken",
        "stream_token",
        "authToken",
        "auth_token",
      ]) ||
      this.pickString(startRecord, [
        "token",
        "streamToken",
        "stream_token",
        "authToken",
        "auth_token",
      ]) ||
      streamToken;

    if (!callId && effectiveToken && this.config.resolveCallIdByToken) {
      const resolvedCallId = this.config.resolveCallIdByToken(effectiveToken);
      if (resolvedCallId) {
        callId = resolvedCallId;
      }
    }

    console.log(`[MediaStream] Stream started: ${streamSid} (call: ${callId})`);
    if (!callId) {
      console.warn("[MediaStream] Missing call identifier; closing stream");
      ws.close(1008, "Missing call identifier");
      return null;
    }
    if (
      this.config.shouldAcceptStream &&
      !this.config.shouldAcceptStream({ callId, streamSid, token: effectiveToken })
    ) {
      console.warn(`[MediaStream] Rejecting stream for unknown call: ${callId}`);
      ws.close(1008, "Unknown call");
      return null;
    }

    return this.createSession({
      ws,
      callId,
      streamSid,
      transport: "twilio-json",
      connectLogPrefix: "[MediaStream] Stream started",
    });
  }

  /**
   * Handle provider raw audio mode (e.g. Voximplant sendMediaTo WebSocket).
   * In this mode, stream identity can be derived from URL token.
   */
  private async handleRawStart(ws: WebSocket, streamToken?: string): Promise<StreamSession | null> {
    if (!streamToken || !this.config.resolveCallIdByToken) {
      console.warn("[MediaStream] Missing stream token for raw mode; closing stream");
      ws.close(1008, "Missing stream token");
      return null;
    }

    const callId = this.config.resolveCallIdByToken(streamToken);
    if (!callId) {
      console.warn("[MediaStream] Could not resolve call identifier from stream token");
      ws.close(1008, "Unknown call");
      return null;
    }

    const streamSid = `raw-${callId}-${Date.now()}`;
    if (
      this.config.shouldAcceptStream &&
      !this.config.shouldAcceptStream({ callId, streamSid, token: streamToken })
    ) {
      console.warn(`[MediaStream] Rejecting raw stream for unknown call: ${callId}`);
      ws.close(1008, "Unknown call");
      return null;
    }

    return this.createSession({
      ws,
      callId,
      streamSid,
      transport: "raw",
      connectLogPrefix: "[MediaStream] Raw stream started",
    });
  }

  private extractCallId(message: TwilioMediaMessage): string {
    const startRecord = this.toRecord(message.start);
    const rootRecord = this.toRecord(message);
    const customRecord =
      this.toRecord(startRecord?.customParameters) ??
      this.toRecord(startRecord?.custom_parameters) ??
      this.toRecord(startRecord?.customData) ??
      this.toRecord(startRecord?.custom_data) ??
      this.toRecord(rootRecord?.customParameters) ??
      this.toRecord(rootRecord?.custom_parameters) ??
      this.toRecord(rootRecord?.customData) ??
      this.toRecord(rootRecord?.custom_data);

    return (
      this.pickString(customRecord, [
        "callSid",
        "callId",
        "providerCallId",
        "call_sid",
        "call_id",
        "provider_call_id",
        "callSessionHistoryId",
        "call_session_history_id",
        "sessionId",
        "session_id",
        "requestId",
        "request_id",
      ]) ||
      this.pickString(startRecord, [
        "callSid",
        "callId",
        "providerCallId",
        "call_sid",
        "call_id",
        "provider_call_id",
        "callSessionHistoryId",
        "call_session_history_id",
        "sessionId",
        "session_id",
        "requestId",
        "request_id",
      ]) ||
      this.pickString(rootRecord, [
        "callSid",
        "callId",
        "providerCallId",
        "call_sid",
        "call_id",
        "provider_call_id",
        "callSessionHistoryId",
        "call_session_history_id",
        "sessionId",
        "session_id",
        "requestId",
        "request_id",
      ]) ||
      ""
    );
  }

  private toRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private pickString(
    source: Record<string, unknown> | undefined,
    keys: readonly string[],
  ): string | undefined {
    if (!source) {
      return undefined;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private async createSession(params: {
    ws: WebSocket;
    callId: string;
    streamSid: string;
    transport: "twilio-json" | "raw";
    connectLogPrefix: string;
  }): Promise<StreamSession> {
    const { ws, callId, streamSid, transport, connectLogPrefix } = params;
    console.log(`${connectLogPrefix}: ${streamSid} (call: ${callId})`);

    const sttSession = this.config.sttProvider.createSession();

    sttSession.onPartial((partial) => {
      this.config.onPartialTranscript?.(callId, partial);
    });

    sttSession.onTranscript((transcript) => {
      this.config.onTranscript?.(callId, transcript);
    });

    sttSession.onSpeechStart(() => {
      this.config.onSpeechStart?.(callId);
    });

    const session: StreamSession = {
      callId,
      streamSid,
      ws,
      sttSession,
      transport,
    };

    this.sessions.set(streamSid, session);

    // VoxEngine ws.sendMediaTo(call) requires a JSON "start" event from the
    // server before it will begin playing incoming audio to the call.
    // Send it immediately so TTS audio can be played as soon as it arrives.
    if (transport === "twilio-json" && ws.readyState === WebSocket.OPEN) {
      const startAck = JSON.stringify({
        event: "start",
        sequenceNumber: 0,
        start: {
          mediaFormat: {
            encoding: "audio/x-mulaw",
            sampleRate: 8000,
            channels: 1,
          },
          customParameters: {},
        },
      });
      ws.send(startAck);
      console.log(`[MediaStream] Sent start ack to stream ${streamSid}`);
    }

    this.config.onConnect?.(callId, streamSid);

    sttSession.connect().catch((err) => {
      console.warn(`[MediaStream] STT connection failed (TTS still works):`, err.message);
    });

    return session;
  }

  private toTextMessage(data: WebSocket.RawData): string {
    if (typeof data === "string") {
      return data;
    }
    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString("utf8");
    }
    return Buffer.from(data).toString("utf8");
  }

  private toBinaryBuffer(data: WebSocket.RawData, isBinary: boolean): Buffer | null {
    if (isBinary) {
      if (Buffer.isBuffer(data)) {
        return data;
      }
      if (data instanceof ArrayBuffer) {
        return Buffer.from(data);
      }
      if (Array.isArray(data)) {
        return Buffer.concat(data);
      }
      return null;
    }

    if (Buffer.isBuffer(data)) {
      // Twilio/Vox JSON packets are always text JSON in these integrations.
      // Treat Buffers that look like JSON as text, everything else as raw audio.
      const firstByte = data[0];
      if (firstByte === 0x7b || firstByte === 0x5b) {
        return null;
      }
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data);
    }
    return null;
  }

  /**
   * Handle stream stop event.
   */
  private handleStop(session: StreamSession): void {
    console.log(`[MediaStream] Stream stopped: ${session.streamSid}`);

    this.clearTtsState(session.streamSid);
    session.sttSession.close();
    this.sessions.delete(session.streamSid);
    this.config.onDisconnect?.(session.callId);
  }

  private getStreamToken(request: IncomingMessage): string | undefined {
    if (!request.url || !request.headers.host) {
      return undefined;
    }
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      return url.searchParams.get("token") ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get an active session with an open WebSocket, or undefined if unavailable.
   */
  private getOpenSession(streamSid: string): StreamSession | undefined {
    const session = this.sessions.get(streamSid);
    return session?.ws.readyState === WebSocket.OPEN ? session : undefined;
  }

  /**
   * Send a message to a stream's WebSocket if available.
   */
  private sendToStream(streamSid: string, message: unknown): void {
    const session = this.getOpenSession(streamSid);
    if (!session) {
      if (!this._loggedMissingStream.has(streamSid)) {
        this._loggedMissingStream.add(streamSid);
        console.warn(
          `[MediaStream] sendToStream: no open session for ${streamSid} (sessions: ${[...this.sessions.keys()].join(", ") || "none"})`,
        );
      }
      return;
    }
    if (session.transport === "raw") {
      const rawPayload = this.extractRawAudioPayload(message);
      if (rawPayload) {
        session.ws.send(rawPayload);
      }
      return;
    }
    session.ws.send(JSON.stringify(message));
  }

  private _loggedMissingStream = new Set<string>();

  private extractRawAudioPayload(message: unknown): Buffer | null {
    if (!message || typeof message !== "object") {
      return null;
    }
    const msg = message as {
      event?: string;
      media?: { payload?: unknown };
    };
    if (msg.event !== "media") {
      return null;
    }
    const payload = msg.media?.payload;
    if (typeof payload !== "string" || payload.length === 0) {
      return null;
    }
    try {
      return Buffer.from(payload, "base64");
    } catch {
      return null;
    }
  }

  /**
   * Send audio to a specific stream (for TTS playback).
   * Audio should be mu-law encoded at 8kHz mono.
   */
  private _audioChunksSent = new Map<string, number>();

  sendAudio(streamSid: string, muLawAudio: Buffer): void {
    const count = (this._audioChunksSent.get(streamSid) || 0) + 1;
    this._audioChunksSent.set(streamSid, count);
    // Log first chunk and every 100th to confirm audio flow without flooding.
    if (count === 1 || count % 100 === 0) {
      console.log(
        `[MediaStream] sendAudio chunk #${count} (${muLawAudio.length}B) to ${streamSid}`,
      );
    }
    this.sendToStream(streamSid, {
      event: "media",
      streamSid,
      media: { payload: muLawAudio.toString("base64") },
    });
  }

  /**
   * Send a mark event to track audio playback position.
   */
  sendMark(streamSid: string, name: string): void {
    this.sendToStream(streamSid, {
      event: "mark",
      streamSid,
      mark: { name },
    });
  }

  /**
   * Clear audio buffer (interrupt playback).
   */
  clearAudio(streamSid: string): void {
    this.sendToStream(streamSid, { event: "clear", streamSid });
  }

  /**
   * Queue a TTS operation for sequential playback.
   * Only one TTS operation plays at a time per stream to prevent overlap.
   */
  async queueTts(streamSid: string, playFn: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const queue = this.getTtsQueue(streamSid);
    let resolveEntry: () => void;
    let rejectEntry: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });

    queue.push({
      playFn,
      controller: new AbortController(),
      resolve: resolveEntry!,
      reject: rejectEntry!,
    });

    if (!this.ttsPlaying.get(streamSid)) {
      void this.processQueue(streamSid);
    }

    return promise;
  }

  /**
   * Clear TTS queue and interrupt current playback (barge-in).
   */
  clearTtsQueue(streamSid: string): void {
    const queue = this.getTtsQueue(streamSid);
    queue.length = 0;
    this.ttsActiveControllers.get(streamSid)?.abort();
    this.clearAudio(streamSid);
  }

  /**
   * Get active session by call ID.
   */
  getSessionByCallId(callId: string): StreamSession | undefined {
    return [...this.sessions.values()].find((session) => session.callId === callId);
  }

  /**
   * Close all sessions.
   */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      this.clearTtsState(session.streamSid);
      session.sttSession.close();
      session.ws.close();
    }
    this.sessions.clear();
  }

  private getTtsQueue(streamSid: string): TtsQueueEntry[] {
    const existing = this.ttsQueues.get(streamSid);
    if (existing) {
      return existing;
    }
    const queue: TtsQueueEntry[] = [];
    this.ttsQueues.set(streamSid, queue);
    return queue;
  }

  /**
   * Process the TTS queue for a stream.
   * Uses iterative approach to avoid stack accumulation from recursion.
   */
  private async processQueue(streamSid: string): Promise<void> {
    this.ttsPlaying.set(streamSid, true);

    while (true) {
      const queue = this.ttsQueues.get(streamSid);
      if (!queue || queue.length === 0) {
        this.ttsPlaying.set(streamSid, false);
        this.ttsActiveControllers.delete(streamSid);
        return;
      }

      const entry = queue.shift()!;
      this.ttsActiveControllers.set(streamSid, entry.controller);

      try {
        await entry.playFn(entry.controller.signal);
        entry.resolve();
      } catch (error) {
        if (entry.controller.signal.aborted) {
          entry.resolve();
        } else {
          console.error("[MediaStream] TTS playback error:", error);
          entry.reject(error);
        }
      } finally {
        if (this.ttsActiveControllers.get(streamSid) === entry.controller) {
          this.ttsActiveControllers.delete(streamSid);
        }
      }
    }
  }

  private clearTtsState(streamSid: string): void {
    const queue = this.ttsQueues.get(streamSid);
    if (queue) {
      queue.length = 0;
    }
    this.ttsActiveControllers.get(streamSid)?.abort();
    this.ttsActiveControllers.delete(streamSid);
    this.ttsPlaying.delete(streamSid);
    this.ttsQueues.delete(streamSid);
  }
}

/**
 * Twilio Media Stream message format.
 */
interface TwilioMediaMessage {
  event: "connected" | "start" | "media" | "stop" | "mark" | "clear";
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid?: string;
    callId?: string;
    providerCallId?: string;
    tracks: string[];
    customParameters?: Record<string, string>;
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  media?: {
    track?: string;
    chunk?: string;
    timestamp?: string;
    payload?: string;
  };
  mark?: {
    name: string;
  };
}
