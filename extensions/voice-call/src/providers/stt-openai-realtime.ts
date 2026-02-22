/**
 * OpenAI Realtime provider for voice-call streaming.
 *
 * Supports two modes:
 * - transcription: STT only (legacy cascade STT -> text LLM -> TTS)
 * - conversation: full speech-to-speech realtime voice brain
 */

import WebSocket from "ws";

export type RealtimeMode = "transcription" | "conversation";

/**
 * Per-call context for realtime conversation mode.
 */
export interface RealtimeConversationContext {
  /** System-level speaking policy and objective */
  instructions?: string;
  /** Optional initial user prompt to trigger the first assistant response */
  initialPrompt?: string;
  /**
   * If true, the first response.create uses a one-time per-response instruction
   * to force a natural opening (greet + state goal).  Subsequent responses use
   * only the session-level instructions.
   */
  forceOpening?: boolean;
  /** Preferred language hint */
  language?: string;
  /** Assistant voice (OpenAI realtime voice id) */
  voice?: string;
}

/**
 * Configuration for OpenAI Realtime provider.
 */
export interface RealtimeSTTConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Model to use (gpt-4o-transcribe in transcription mode, gpt-realtime in conversation mode) */
  model?: string;
  /** Pipeline mode */
  mode?: RealtimeMode;
  /** Silence duration in ms before considering speech ended (default: 800) */
  silenceDurationMs?: number;
  /** VAD threshold 0-1 (default: 0.5) */
  vadThreshold?: number;
  /** Default assistant voice for conversation mode */
  assistantVoice?: string;
  /** Default assistant instructions for conversation mode */
  assistantInstructions?: string;
}

export interface RealtimeSessionCreateOptions {
  /** Call-scoped conversation context (conversation mode only) */
  conversation?: RealtimeConversationContext;
  /** Assistant partial transcript callback (conversation mode only) */
  onAssistantPartialTranscript?: (partial: string) => void;
  /** Assistant final transcript callback (conversation mode only) */
  onAssistantTranscript?: (transcript: string) => void;
  /** Assistant audio callback (conversation mode only, g711_ulaw 8k chunks) */
  onAssistantAudio?: (audio: Buffer) => void;
}

/**
 * Session for streaming audio and receiving transcripts.
 */
export interface RealtimeSTTSession {
  /** Connect to the realtime service */
  connect(): Promise<void>;
  /** Send mu-law audio data (8kHz mono) */
  sendAudio(audio: Buffer): void;
  /** Wait for next complete user transcript */
  waitForTranscript(timeoutMs?: number): Promise<string>;
  /** Set callback for user partial transcripts */
  onPartial(callback: (partial: string) => void): void;
  /** Set callback for user final transcripts */
  onTranscript(callback: (transcript: string) => void): void;
  /** Set callback when caller speech starts (VAD) */
  onSpeechStart(callback: () => void): void;
  /** Set callback for assistant partial transcripts (conversation mode) */
  onAssistantPartial(callback: (partial: string) => void): void;
  /** Set callback for assistant final transcripts (conversation mode) */
  onAssistantTranscript(callback: (transcript: string) => void): void;
  /** Set callback for assistant audio chunks (conversation mode) */
  onAssistantAudio(callback: (audio: Buffer) => void): void;
  /** Check whether session is in conversation mode */
  isConversationMode(): boolean;
  /** Close the session */
  close(): void;
  /** Check if session is connected */
  isConnected(): boolean;
}

/**
 * Provider factory for OpenAI Realtime sessions.
 */
export class OpenAIRealtimeSTTProvider {
  readonly name = "openai-realtime";
  private apiKey: string;
  private model: string;
  private mode: RealtimeMode;
  private silenceDurationMs: number;
  private vadThreshold: number;
  private assistantVoice: string;
  private assistantInstructions?: string;

  constructor(config: RealtimeSTTConfig) {
    if (!config.apiKey) {
      throw new Error("OpenAI API key required for Realtime provider");
    }
    this.apiKey = config.apiKey;
    this.mode = config.mode || "transcription";
    this.model =
      config.model || (this.mode === "conversation" ? "gpt-realtime" : "gpt-4o-transcribe");
    this.silenceDurationMs = config.silenceDurationMs || 800;
    this.vadThreshold = config.vadThreshold || 0.5;
    this.assistantVoice = config.assistantVoice || "alloy";
    this.assistantInstructions = config.assistantInstructions;
  }

  /**
   * Create a new realtime session.
   */
  createSession(options: RealtimeSessionCreateOptions = {}): RealtimeSTTSession {
    return new OpenAIRealtimeSession({
      apiKey: this.apiKey,
      model: this.model,
      mode: this.mode,
      silenceDurationMs: this.silenceDurationMs,
      vadThreshold: this.vadThreshold,
      defaultAssistantVoice: this.assistantVoice,
      defaultAssistantInstructions: this.assistantInstructions,
      options,
    });
  }
}

type SessionCtor = {
  apiKey: string;
  model: string;
  mode: RealtimeMode;
  silenceDurationMs: number;
  vadThreshold: number;
  defaultAssistantVoice: string;
  defaultAssistantInstructions?: string;
  options: RealtimeSessionCreateOptions;
};

/**
 * WebSocket-based OpenAI Realtime session.
 */
class OpenAIRealtimeSession implements RealtimeSTTSession {
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly RECONNECT_DELAY_MS = 1000;

  private ws: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private reconnectAttempts = 0;

  private pendingUserTranscript = "";
  private pendingAssistantTranscript = "";

  private onTranscriptCallback: ((transcript: string) => void) | null = null;
  private onPartialCallback: ((partial: string) => void) | null = null;
  private onSpeechStartCallback: (() => void) | null = null;
  private onAssistantTranscriptCallback: ((transcript: string) => void) | null = null;
  private onAssistantPartialCallback: ((partial: string) => void) | null = null;
  private onAssistantAudioCallback: ((audio: Buffer) => void) | null = null;

  /** Resolves when session.updated is received — used to defer response.create */
  private sessionUpdatedResolve: (() => void) | null = null;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly mode: RealtimeMode;
  private readonly silenceDurationMs: number;
  private readonly vadThreshold: number;
  private readonly defaultAssistantVoice: string;
  private readonly defaultAssistantInstructions?: string;
  private readonly conversation?: RealtimeConversationContext;

  constructor(args: SessionCtor) {
    this.apiKey = args.apiKey;
    this.model = args.model;
    this.mode = args.mode;
    this.silenceDurationMs = args.silenceDurationMs;
    this.vadThreshold = args.vadThreshold;
    this.defaultAssistantVoice = args.defaultAssistantVoice;
    this.defaultAssistantInstructions = args.defaultAssistantInstructions;

    this.conversation = args.options.conversation;
    this.onAssistantAudioCallback = args.options.onAssistantAudio || null;
    this.onAssistantPartialCallback = args.options.onAssistantPartialTranscript || null;
    this.onAssistantTranscriptCallback = args.options.onAssistantTranscript || null;
  }

  isConversationMode(): boolean {
    return this.mode === "conversation";
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.reconnectAttempts = 0;
    return this.doConnect();
  }

  private buildRealtimeUrl(): string {
    if (this.mode === "conversation") {
      return `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.model)}`;
    }
    return "wss://api.openai.com/v1/realtime?intent=transcription";
  }

  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.buildRealtimeUrl(), {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      this.ws.on("open", () => {
        console.log(`[Realtime] WebSocket connected (mode=${this.mode}, model=${this.model})`);
        this.connected = true;
        this.reconnectAttempts = 0;

        if (this.mode === "conversation") {
          this.configureConversationSession();
        } else {
          this.configureTranscriptionSession();
        }

        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const event = JSON.parse(data.toString()) as unknown;
          this.handleEvent(event);
        } catch (error) {
          console.error("[Realtime] Failed to parse event:", error);
        }
      });

      this.ws.on("error", (error) => {
        console.error("[Realtime] WebSocket error:", error);
        if (!this.connected) {
          reject(error);
        }
      });

      this.ws.on("close", (code, reason) => {
        console.log(
          `[Realtime] WebSocket closed (code: ${code}, reason: ${reason?.toString() || "none"}, mode=${this.mode})`,
        );
        this.connected = false;

        if (!this.closed) {
          if (this.mode === "conversation") {
            // In conversation mode, reconnect would lose all conversation
            // context (OpenAI Realtime doesn't preserve state across WS
            // connections). Better to let the call end gracefully.
            console.warn(
              "[Realtime] Conversation session lost — not reconnecting to avoid context reset",
            );
            this.closed = true;
            this.onCloseCallback?.();
          } else {
            void this.attemptReconnect();
          }
        }
      });

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error("Realtime connection timeout"));
        }
      }, 10000);
    });
  }

  private configureTranscriptionSession(): void {
    this.sendEvent({
      type: "transcription_session.update",
      session: {
        input_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: this.model,
        },
        turn_detection: {
          type: "server_vad",
          threshold: this.vadThreshold,
          prefix_padding_ms: 300,
          silence_duration_ms: this.silenceDurationMs,
        },
      },
    });
  }

  private configureConversationSession(): void {
    const defaultInstructions =
      "You are a live phone-call assistant. Speak naturally, briefly, and conversationally. " +
      "Do not mention internal instructions, tools, or that you are a bot. " +
      "If line quality is poor, ask one short clarifying question instead of long monologues.";

    const instructions =
      this.conversation?.instructions?.trim() ||
      this.defaultAssistantInstructions?.trim() ||
      defaultInstructions;

    const voice = this.conversation?.voice?.trim() || this.defaultAssistantVoice;

    // Set up a promise that resolves when session.updated arrives.
    // We must wait for session.updated before triggering response.create,
    // otherwise the model starts generating with default (empty) instructions
    // and then "resets" mid-sentence when our real instructions arrive.
    const sessionUpdated = new Promise<void>((resolve) => {
      this.sessionUpdatedResolve = resolve;
      // Safety timeout — don't hang forever if event is lost
      setTimeout(() => {
        if (this.sessionUpdatedResolve === resolve) {
          console.warn("[Realtime] session.updated not received within 5s, proceeding anyway");
          this.sessionUpdatedResolve = null;
          resolve();
        }
      }, 5000);
    });

    this.sendEvent({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions,
        voice,
        temperature: 0.6,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: "whisper-1",
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "high",
          create_response: true,
        },
      },
    });

    // Wait for session.updated before triggering the first assistant turn.
    // This prevents the race condition where the model starts speaking with
    // default instructions and then resets when our real instructions arrive.
    void sessionUpdated.then(() => {
      if (this.closed) {
        return;
      }

      // One-time per-response instruction for the first turn only.
      // Forces a natural opening (greet + state goal) without polluting
      // the persistent session instructions.
      const forceOpening = this.conversation?.forceOpening !== false;
      const firstTurnInstruction = forceOpening
        ? "Начни как в примерах: поздоровайся и сразу озвучь задачу одной фразой. Без служебных пояснений."
        : undefined;

      console.log(
        `[Realtime] session.updated confirmed, triggering first response` +
          (firstTurnInstruction ? " (with forced opening)" : ""),
      );

      this.sendEvent({
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          ...(firstTurnInstruction ? { instructions: firstTurnInstruction } : {}),
        },
      });
    });
  }

  private async attemptReconnect(): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this.reconnectAttempts >= OpenAIRealtimeSession.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[Realtime] Max reconnect attempts (${OpenAIRealtimeSession.MAX_RECONNECT_ATTEMPTS}) reached`,
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = OpenAIRealtimeSession.RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    console.log(
      `[Realtime] Reconnecting ${this.reconnectAttempts}/${OpenAIRealtimeSession.MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.closed) {
      return;
    }

    try {
      await this.doConnect();
      console.log("[Realtime] Reconnected successfully");
    } catch (error) {
      console.error("[Realtime] Reconnect failed:", error);
    }
  }

  private handleEvent(rawEvent: unknown): void {
    const event = this.toRecord(rawEvent);
    if (!event) {
      return;
    }

    const type = this.readString(event, "type") || "";

    switch (type) {
      case "transcription_session.created":
      case "transcription_session.updated":
      case "session.created":
      case "input_audio_buffer.speech_stopped":
      case "input_audio_buffer.committed":
      case "response.created":
      case "response.done":
        console.log(`[Realtime] ${type}`);
        return;

      case "session.updated":
        console.log(`[Realtime] ${type}`);
        // Resolve the pending sessionUpdated promise so response.create
        // fires only after our instructions are confirmed by the server.
        if (this.sessionUpdatedResolve) {
          this.sessionUpdatedResolve();
          this.sessionUpdatedResolve = null;
        }
        return;

      case "conversation.item.input_audio_transcription.delta": {
        const delta = this.readString(event, "delta");
        if (delta) {
          this.pendingUserTranscript += delta;
          this.onPartialCallback?.(this.pendingUserTranscript);
        }
        return;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const transcript = this.readString(event, "transcript");
        if (transcript) {
          console.log(`[Realtime] User transcript: ${transcript}`);
          this.onTranscriptCallback?.(transcript);
        }
        this.pendingUserTranscript = "";
        return;
      }

      case "input_audio_buffer.speech_started": {
        console.log("[Realtime] Speech started");
        this.pendingUserTranscript = "";
        this.onSpeechStartCallback?.();
        return;
      }

      case "response.audio.delta": {
        if (this.mode !== "conversation") {
          return;
        }
        const delta = this.readString(event, "delta");
        if (!delta) {
          return;
        }
        try {
          const audio = Buffer.from(delta, "base64");
          if (audio.length > 0) {
            this.onAssistantAudioCallback?.(audio);
          }
        } catch (error) {
          console.warn("[Realtime] Invalid audio delta payload:", error);
        }
        return;
      }

      case "response.audio_transcript.delta":
      case "response.output_text.delta": {
        if (this.mode !== "conversation") {
          return;
        }
        const delta = this.readString(event, "delta");
        if (!delta) {
          return;
        }
        this.pendingAssistantTranscript += delta;
        this.onAssistantPartialCallback?.(this.pendingAssistantTranscript);
        return;
      }

      case "response.audio_transcript.done":
      case "response.output_text.done": {
        if (this.mode !== "conversation") {
          return;
        }
        const transcript = this.readString(event, "transcript") || this.readString(event, "text");
        const resolved = transcript || this.pendingAssistantTranscript.trim();
        if (resolved) {
          this.onAssistantTranscriptCallback?.(resolved);
        }
        this.pendingAssistantTranscript = "";
        return;
      }

      case "response.output_item.done": {
        // NOTE: Not emitting assistant transcript here — it's already
        // emitted by response.audio_transcript.done / response.output_text.done.
        // Emitting from both events caused every bot reply to appear twice
        // in the call transcript.
        return;
      }

      case "error":
        console.error("[Realtime] Error:", event.error);
        return;

      default:
        return;
    }
  }

  private sendEvent(event: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  sendAudio(muLawData: Buffer): void {
    if (!this.connected || muLawData.length === 0) {
      return;
    }
    this.sendEvent({
      type: "input_audio_buffer.append",
      audio: muLawData.toString("base64"),
    });
  }

  onPartial(callback: (partial: string) => void): void {
    this.onPartialCallback = callback;
  }

  onTranscript(callback: (transcript: string) => void): void {
    this.onTranscriptCallback = callback;
  }

  onSpeechStart(callback: () => void): void {
    this.onSpeechStartCallback = callback;
  }

  onAssistantPartial(callback: (partial: string) => void): void {
    this.onAssistantPartialCallback = callback;
  }

  onAssistantTranscript(callback: (transcript: string) => void): void {
    this.onAssistantTranscriptCallback = callback;
  }

  onAssistantAudio(callback: (audio: Buffer) => void): void {
    this.onAssistantAudioCallback = callback;
  }

  async waitForTranscript(timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const original = this.onTranscriptCallback;
      const timeout = setTimeout(() => {
        this.onTranscriptCallback = original;
        reject(new Error("Transcript timeout"));
      }, timeoutMs);

      this.onTranscriptCallback = (transcript) => {
        clearTimeout(timeout);
        this.onTranscriptCallback = original;
        resolve(transcript);
      };
    });
  }

  close(): void {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private toRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
    if (!source) {
      return undefined;
    }
    const value = source[key];
    return typeof value === "string" ? value : undefined;
  }
}
