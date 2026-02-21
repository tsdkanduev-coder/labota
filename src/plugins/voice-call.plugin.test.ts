import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let runtimeStub: {
  config: { toNumber?: string };
  manager: {
    initiateCall: ReturnType<typeof vi.fn>;
    continueCall: ReturnType<typeof vi.fn>;
    speak: ReturnType<typeof vi.fn>;
    endCall: ReturnType<typeof vi.fn>;
    getCall: ReturnType<typeof vi.fn>;
    getCallByProviderCallId: ReturnType<typeof vi.fn>;
    getCallHistory: ReturnType<typeof vi.fn>;
    setOnCallEndedHook: ReturnType<typeof vi.fn>;
  };
  stop: ReturnType<typeof vi.fn>;
};
let enqueueSystemEventMock: ReturnType<typeof vi.fn>;

vi.mock("../../extensions/voice-call/src/runtime.js", () => ({
  createVoiceCallRuntime: vi.fn(async () => runtimeStub),
}));

import plugin from "../../extensions/voice-call/index.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

type Registered = {
  methods: Map<string, (ctx: Record<string, unknown>) => unknown>;
  tools: unknown[];
};

function setup(config: Record<string, unknown>): Registered {
  const methods = new Map<string, (ctx: Record<string, unknown>) => unknown>();
  const tools: unknown[] = [];
  plugin.register({
    id: "voice-call",
    name: "Voice Call",
    description: "test",
    version: "0",
    source: "test",
    config: {},
    pluginConfig: config,
    runtime: {
      tts: { textToSpeechTelephony: vi.fn() },
      system: { enqueueSystemEvent: enqueueSystemEventMock },
    },
    logger: noopLogger,
    registerGatewayMethod: (method, handler) => methods.set(method, handler),
    registerTool: (tool) => tools.push(tool),
    registerCli: () => {},
    registerService: () => {},
    resolvePath: (p: string) => p,
  });
  return { methods, tools };
}

function resolveVoiceCallTool(
  registered: unknown,
  sessionKey = "agent:main:telegram:dm:test-user",
): {
  execute: (id: string, params: unknown) => Promise<unknown>;
} {
  if (typeof registered === "function") {
    return registered({
      config: {},
      sessionKey,
      messageChannel: "telegram",
    }) as { execute: (id: string, params: unknown) => Promise<unknown> };
  }
  return registered as { execute: (id: string, params: unknown) => Promise<unknown> };
}

describe("voice-call plugin", () => {
  beforeEach(() => {
    enqueueSystemEventMock = vi.fn();
    runtimeStub = {
      config: { toNumber: "+15550001234" },
      manager: {
        initiateCall: vi.fn(async () => ({ callId: "call-1", success: true })),
        continueCall: vi.fn(async () => ({
          success: true,
          transcript: "hello",
        })),
        speak: vi.fn(async () => ({ success: true })),
        endCall: vi.fn(async () => ({ success: true })),
        getCall: vi.fn((id: string) => (id === "call-1" ? { callId: "call-1" } : undefined)),
        getCallByProviderCallId: vi.fn(() => undefined),
        getCallHistory: vi.fn(async () => [
          { callId: "call-1", sessionKey: "agent:main:telegram:dm:test-user" },
        ]),
        setOnCallEndedHook: vi.fn(),
      },
      stop: vi.fn(async () => {}),
    };
  });

  afterEach(() => vi.restoreAllMocks());

  it("registers gateway methods", () => {
    const { methods } = setup({ provider: "mock" });
    expect(methods.has("voicecall.initiate")).toBe(true);
    expect(methods.has("voicecall.continue")).toBe(true);
    expect(methods.has("voicecall.speak")).toBe(true);
    expect(methods.has("voicecall.end")).toBe(true);
    expect(methods.has("voicecall.status")).toBe(true);
    expect(methods.has("voicecall.start")).toBe(true);
  });

  it("initiates a call via voicecall.initiate with prompt", async () => {
    const { methods } = setup({ provider: "mock" });
    const handler = methods.get("voicecall.initiate");
    const respond = vi.fn();
    await handler?.({ params: { prompt: "Забронировать столик" }, respond });
    expect(runtimeStub.manager.initiateCall).toHaveBeenCalled();
    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.callId).toBe("call-1");
  });

  it("voicecall.initiate falls back to message when prompt missing", async () => {
    const { methods } = setup({ provider: "mock" });
    const handler = methods.get("voicecall.initiate");
    const respond = vi.fn();
    await handler?.({ params: { message: "Hi" }, respond });
    expect(runtimeStub.manager.initiateCall).toHaveBeenCalled();
    const opts = runtimeStub.manager.initiateCall.mock.calls[0][2];
    expect(opts.prompt).toBe("Hi");
    const [ok] = respond.mock.calls[0];
    expect(ok).toBe(true);
  });

  it("voicecall.initiate errors when neither prompt nor message given", async () => {
    const { methods } = setup({ provider: "mock" });
    const handler = methods.get("voicecall.initiate");
    const respond = vi.fn();
    await handler?.({ params: {}, respond });
    expect(runtimeStub.manager.initiateCall).not.toHaveBeenCalled();
    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(false);
    expect(payload.error).toContain("prompt or message required");
  });

  it("returns call status", async () => {
    const { methods } = setup({ provider: "mock" });
    const handler = methods.get("voicecall.status");
    const respond = vi.fn();
    await handler?.({ params: { callId: "call-1" }, respond });
    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.found).toBe(true);
  });

  it("tool get_status returns json payload", async () => {
    const { tools } = setup({ provider: "mock" });
    const tool = resolveVoiceCallTool(tools[0]);
    const result = (await tool.execute("id", {
      action: "get_status",
      callId: "call-1",
    })) as { details: { found?: boolean } };
    expect(result.details.found).toBe(true);
  });

  it("legacy tool status without sid returns error payload", async () => {
    const { tools } = setup({ provider: "mock" });
    const tool = resolveVoiceCallTool(tools[0]);
    const result = (await tool.execute("id", { mode: "status" })) as {
      details: { error?: unknown };
    };
    expect(String(result.details.error)).toContain("sid required");
  });

  it("tool initiate_call binds call to current session", async () => {
    const { tools } = setup({ provider: "mock" });
    const tool = resolveVoiceCallTool(tools[0], "agent:main:telegram:dm:user-42");
    await tool.execute("id", {
      action: "initiate_call",
      to: "+15550001111",
      prompt: "Забронировать столик на имя Елена",
    });
    expect(runtimeStub.manager.initiateCall).toHaveBeenCalledWith(
      "+15550001111",
      "agent:main:telegram:dm:user-42",
      expect.any(Object),
    );
  });

  it("tool initiate_call forwards prompt and language metadata", async () => {
    const { tools } = setup({ provider: "mock" });
    const tool = resolveVoiceCallTool(tools[0], "agent:main:telegram:dm:user-42");
    await tool.execute("id", {
      action: "initiate_call",
      to: "+15550001111",
      prompt: "Забронировать столик на 2 гостей на 19:00 на имя Тсевдн",
      language: "ru",
    });
    expect(runtimeStub.manager.initiateCall).toHaveBeenCalledWith(
      "+15550001111",
      "agent:main:telegram:dm:user-42",
      expect.objectContaining({
        prompt: "Забронировать столик на 2 гостей на 19:00 на имя Тсевдн",
        language: "ru",
      }),
    );
  });

  it("tool initiate_call rejects when prompt is missing", async () => {
    const { tools } = setup({ provider: "mock" });
    const tool = resolveVoiceCallTool(tools[0], "agent:main:telegram:dm:user-42");
    const result = (await tool.execute("id", {
      action: "initiate_call",
      to: "+15550001111",
    })) as { details: { error?: string } };
    expect(runtimeStub.manager.initiateCall).not.toHaveBeenCalled();
    expect(result.details.error).toContain("prompt required");
  });

  it("tool get_call_history is scoped by session by default", async () => {
    runtimeStub.manager.getCallHistory.mockResolvedValue([
      { callId: "call-a", sessionKey: "agent:main:telegram:dm:test-user" },
      { callId: "call-b", sessionKey: "agent:main:telegram:dm:other-user" },
      { callId: "call-a", sessionKey: "agent:main:telegram:dm:test-user" },
    ]);
    const { tools } = setup({ provider: "mock" });
    const tool = resolveVoiceCallTool(tools[0], "agent:main:telegram:dm:test-user");
    const result = (await tool.execute("id", {
      action: "get_call_history",
      limit: 10,
    })) as { details: { calls?: Array<{ callId: string }> } };
    expect(result.details.calls?.map((call) => call.callId)).toEqual(["call-a"]);
  });

  it("enqueues structured system outcome when call ends", async () => {
    const { methods } = setup({ provider: "mock" });
    const initiate = methods.get("voicecall.initiate");
    const respond = vi.fn();
    await initiate?.({ params: { prompt: "Подтвердить бронь", to: "+15550001111" }, respond });

    expect(runtimeStub.manager.setOnCallEndedHook).toHaveBeenCalledTimes(1);
    const onCallEnded = runtimeStub.manager.setOnCallEndedHook.mock.calls[0]?.[0] as
      | ((call: Record<string, unknown>) => void)
      | undefined;
    expect(typeof onCallEnded).toBe("function");

    onCallEnded?.({
      callId: "call-1",
      providerCallId: "provider-call-1",
      from: "+15550001234",
      to: "+15550001111",
      state: "completed",
      endReason: "completed",
      startedAt: 1700000000000,
      endedAt: 1700000005000,
      sessionKey: "agent:main:telegram:dm:test-user",
      metadata: {
        prompt: "Подтвердить бронь",
      },
      transcript: [
        { speaker: "bot", text: "Здравствуйте", timestamp: 1700000001000 },
        { speaker: "user", text: "Да, бронь подтверждена", timestamp: 1700000003000 },
      ],
    });

    expect(enqueueSystemEventMock).toHaveBeenCalledTimes(1);
    const [text, opts] = enqueueSystemEventMock.mock.calls[0];
    expect(String(text)).toContain("VOICE_CALL_COMPLETED");
    expect(String(text)).toContain("Подтвердить бронь");
    expect(opts).toEqual(
      expect.objectContaining({
        sessionKey: "agent:main:telegram:dm:test-user",
        contextKey: "voice-call:call-1:ended",
      }),
    );
  });

  it("CLI start prints JSON", async () => {
    const { register } = plugin as unknown as {
      register: (api: Record<string, unknown>) => void | Promise<void>;
    };
    const program = new Command();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await register({
      id: "voice-call",
      name: "Voice Call",
      description: "test",
      version: "0",
      source: "test",
      config: {},
      pluginConfig: { provider: "mock" },
      runtime: { tts: { textToSpeechTelephony: vi.fn() } },
      logger: noopLogger,
      registerGatewayMethod: () => {},
      registerTool: () => {},
      registerCli: (
        fn: (ctx: {
          program: Command;
          config: Record<string, unknown>;
          workspaceDir?: string;
          logger: typeof noopLogger;
        }) => void,
      ) =>
        fn({
          program,
          config: {},
          workspaceDir: undefined,
          logger: noopLogger,
        }),
      registerService: () => {},
      resolvePath: (p: string) => p,
    });

    await program.parseAsync(["voicecall", "start", "--to", "+1", "--message", "Hello"], {
      from: "user",
    });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
