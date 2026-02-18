import { describe, expect, it, vi } from "vitest";
import type {
  OpenAIRealtimeSTTProvider,
  RealtimeSTTSession,
} from "./providers/stt-openai-realtime.js";
import { MediaStreamHandler } from "./media-stream.js";

const createStubSession = (): RealtimeSTTSession => ({
  connect: async () => {},
  sendAudio: () => {},
  waitForTranscript: async () => "",
  onPartial: () => {},
  onTranscript: () => {},
  onSpeechStart: () => {},
  close: () => {},
  isConnected: () => true,
});

const createStubSttProvider = (): OpenAIRealtimeSTTProvider =>
  ({
    createSession: () => createStubSession(),
  }) as unknown as OpenAIRealtimeSTTProvider;

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const waitForAbort = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

describe("MediaStreamHandler TTS queue", () => {
  it("serializes TTS playback and resolves in order", async () => {
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
    });
    const started: number[] = [];
    const finished: number[] = [];

    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const first = handler.queueTts("stream-1", async () => {
      started.push(1);
      await firstGate;
      finished.push(1);
    });
    const second = handler.queueTts("stream-1", async () => {
      started.push(2);
      finished.push(2);
    });

    await flush();
    expect(started).toEqual([1]);

    resolveFirst();
    await first;
    await second;

    expect(started).toEqual([1, 2]);
    expect(finished).toEqual([1, 2]);
  });

  it("cancels active playback and clears queued items", async () => {
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
    });

    let queuedRan = false;
    const started: string[] = [];

    const active = handler.queueTts("stream-1", async (signal) => {
      started.push("active");
      await waitForAbort(signal);
    });
    void handler.queueTts("stream-1", async () => {
      queuedRan = true;
    });

    await flush();
    expect(started).toEqual(["active"]);

    handler.clearTtsQueue("stream-1");
    await active;
    await flush();

    expect(queuedRan).toBe(false);
  });
});

describe("MediaStreamHandler call identity", () => {
  it("accepts start events with customParameters.callId when callSid is absent", async () => {
    const onConnect = vi.fn();
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
      shouldAcceptStream: ({ callId }) => callId === "call-123",
      onConnect,
    });

    type HandleStart = (
      ws: { close: (code?: number, reason?: string) => void },
      message: unknown,
      streamToken?: string,
    ) => Promise<{ callId: string } | null>;
    const handleStart = (handler as unknown as { handleStart: HandleStart }).handleStart.bind(
      handler,
    );

    const closeSpy = vi.fn();
    const session = await handleStart(
      { close: closeSpy },
      {
        event: "start",
        streamSid: "stream-1",
        start: {
          streamSid: "stream-1",
          accountSid: "account",
          tracks: ["inbound"],
          customParameters: {
            callId: "call-123",
            token: "token-123",
          },
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
        },
      },
      "token-123",
    );

    expect(session?.callId).toBe("call-123");
    expect(closeSpy).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledWith("call-123", "stream-1");
  });

  it("reflects provider start encoding in reply start event", async () => {
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
      shouldAcceptStream: ({ callId }) => callId === "call-enc",
    });

    type HandleStart = (
      ws: {
        close: (code?: number, reason?: string) => void;
        readyState: number;
        send: (msg: string) => void;
      },
      message: unknown,
      streamToken?: string,
    ) => Promise<{ callId: string } | null>;
    const handleStart = (handler as unknown as { handleStart: HandleStart }).handleStart.bind(
      handler,
    );

    const closeSpy = vi.fn();
    const sendSpy = vi.fn();
    await handleStart(
      { close: closeSpy, readyState: 1, send: sendSpy },
      {
        event: "start",
        streamSid: "stream-enc",
        start: {
          streamSid: "stream-enc",
          accountSid: "account",
          tracks: ["inbound"],
          customParameters: { callId: "call-enc" },
          mediaFormat: { encoding: "ULAW", sampleRate: 8000 },
        },
      },
      undefined,
    );

    expect(closeSpy).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendSpy.mock.calls[0][0] as string) as {
      event?: string;
      start?: { mediaFormat?: { encoding?: string } };
    };
    expect(sent.event).toBe("start");
    expect(sent.start?.mediaFormat?.encoding).toBe("ULAW");
  });

  it("resolves call ID from stream token when start payload has no call identifiers", async () => {
    const onConnect = vi.fn();
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
      resolveCallIdByToken: (token) => (token === "token-xyz" ? "call-xyz" : undefined),
      shouldAcceptStream: ({ callId, token }) => callId === "call-xyz" && token === "token-xyz",
      onConnect,
    });

    type HandleStart = (
      ws: { close: (code?: number, reason?: string) => void },
      message: unknown,
      streamToken?: string,
    ) => Promise<{ callId: string } | null>;
    const handleStart = (handler as unknown as { handleStart: HandleStart }).handleStart.bind(
      handler,
    );

    const closeSpy = vi.fn();
    const session = await handleStart(
      { close: closeSpy },
      {
        event: "start",
        streamSid: "stream-2",
        start: {
          streamSid: "stream-2",
          accountSid: "account",
          tracks: ["inbound"],
          customParameters: {},
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
        },
      },
      "token-xyz",
    );

    expect(session?.callId).toBe("call-xyz");
    expect(closeSpy).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledWith("call-xyz", "stream-2");
  });

  it("accepts provider-specific snake_case call identifiers", async () => {
    const onConnect = vi.fn();
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
      shouldAcceptStream: ({ callId, token }) =>
        callId === "vox-history-1" && token === "stream-token-1",
      onConnect,
    });

    type HandleStart = (
      ws: { close: (code?: number, reason?: string) => void },
      message: unknown,
      streamToken?: string,
    ) => Promise<{ callId: string } | null>;
    const handleStart = (handler as unknown as { handleStart: HandleStart }).handleStart.bind(
      handler,
    );

    const closeSpy = vi.fn();
    const session = await handleStart(
      { close: closeSpy },
      {
        event: "start",
        streamSid: "stream-3",
        start: {
          streamSid: "stream-3",
          accountSid: "account",
          tracks: ["inbound"],
          custom_parameters: {
            call_session_history_id: "vox-history-1",
            stream_token: "stream-token-1",
          },
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
        },
      },
      undefined,
    );

    expect(session?.callId).toBe("vox-history-1");
    expect(closeSpy).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledWith("vox-history-1", "stream-3");
  });

  it("supports raw stream mode by resolving call ID from stream token", async () => {
    const onConnect = vi.fn();
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
      resolveCallIdByToken: (token) => (token === "vox-token-1" ? "call-vox-1" : undefined),
      shouldAcceptStream: ({ callId, token }) => callId === "call-vox-1" && token === "vox-token-1",
      onConnect,
    });

    type HandleRawStart = (
      ws: { close: (code?: number, reason?: string) => void },
      streamToken?: string,
    ) => Promise<{ callId: string; streamSid: string } | null>;
    const handleRawStart = (
      handler as unknown as { handleRawStart: HandleRawStart }
    ).handleRawStart.bind(handler);

    const closeSpy = vi.fn();
    const session = await handleRawStart({ close: closeSpy }, "vox-token-1");

    expect(session?.callId).toBe("call-vox-1");
    expect(session?.streamSid).toMatch(/^raw-call-vox-1-/);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledWith("call-vox-1", expect.stringMatching(/^raw-call-vox-1-/));
  });
});

describe("MediaStreamHandler transport", () => {
  it("sends raw binary audio payload for raw transport sessions", () => {
    const handler = new MediaStreamHandler({
      sttProvider: createStubSttProvider(),
    });
    const wsSend = vi.fn();

    (
      handler as unknown as {
        sessions: Map<string, { ws: { readyState: number; send: (payload: Buffer) => void } }>;
      }
    ).sessions.set("raw-stream-1", {
      callId: "call-1",
      streamSid: "raw-stream-1",
      transport: "raw",
      ws: { readyState: 1, send: wsSend },
      sttSession: createStubSession(),
    });

    const audio = Buffer.from([1, 2, 3, 4]);
    handler.sendAudio("raw-stream-1", audio);

    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(wsSend).toHaveBeenCalledWith(audio);
  });
});
