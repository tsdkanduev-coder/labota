import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebhookContext } from "../types.js";
import { VoximplantProvider } from "./voximplant.js";

function createCtx(params?: Partial<WebhookContext>): WebhookContext {
  return {
    headers: {},
    rawBody: "{}",
    url: "http://localhost/voice/webhook",
    method: "POST",
    query: {},
    remoteAddress: "127.0.0.1",
    ...params,
  };
}

describe("VoximplantProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("verifies webhook secret header", () => {
    const provider = new VoximplantProvider(
      {
        managementJwt: "jwt",
        ruleId: "rule-1",
        webhookSecret: "secret",
        apiBaseUrl: "https://api.voximplant.com/platform_api",
        controlTimeoutMs: 1000,
      },
      {
        webhookSecret: "secret",
      },
    );

    const ok = provider.verifyWebhook(
      createCtx({
        headers: { "x-openclaw-voximplant-secret": "secret" },
      }),
    );
    expect(ok.ok).toBe(true);

    const bad = provider.verifyWebhook(
      createCtx({
        headers: { "x-openclaw-voximplant-secret": "bad" },
      }),
    );
    expect(bad.ok).toBe(false);
  });

  it("parses normalized webhook events", () => {
    const provider = new VoximplantProvider(
      {
        managementJwt: "jwt",
        ruleId: "rule-1",
        webhookSecret: "secret",
        apiBaseUrl: "https://api.voximplant.com/platform_api",
        controlTimeoutMs: 1000,
      },
      {
        webhookSecret: "secret",
      },
    );

    const result = provider.parseWebhookEvent(
      createCtx({
        rawBody: JSON.stringify({
          type: "call.answered",
          callId: "call-1",
          providerCallId: "prov-1",
          from: "+79990001122",
          to: "+79990003344",
        }),
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe("call.answered");
    expect(result.events[0]?.callId).toBe("call-1");
    expect(result.events[0]?.providerCallId).toBe("prov-1");
  });

  it("starts scenario and uses control URL for in-call commands", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/StartScenarios/")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              result: {
                call_session_history_id: "history-1",
                media_session_access_secure_url: "https://control.example/session-1",
              },
            }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        text: async () => "OK",
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new VoximplantProvider(
      {
        managementJwt: "jwt",
        ruleId: "rule-1",
        webhookSecret: "secret",
        apiBaseUrl: "https://api.voximplant.com/platform_api",
        controlTimeoutMs: 1000,
      },
      {
        webhookSecret: "secret",
      },
    );

    const initiated = await provider.initiateCall({
      callId: "call-1",
      from: "+79990001122",
      to: "+79990003344",
      webhookUrl: "https://openclaw.example/voice/webhook",
    });

    expect(initiated.providerCallId).toBe("history-1");

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall?.[0]).toBe("https://api.voximplant.com/platform_api/StartScenarios/");
    const firstInit = firstCall?.[1] as RequestInit;
    const bodyText = String(firstInit.body);
    expect(bodyText).toContain("rule_id=rule-1");
    expect(bodyText).toContain("script_custom_data=");

    await provider.playTts({
      callId: "call-1",
      providerCallId: "history-1",
      text: "Hello",
    });

    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall?.[0]).toBe("https://control.example/session-1");
  });

  it("uses OpenClaw media stream + telephony TTS when stream is active", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            result: {
              call_session_history_id: "history-1",
              media_session_access_secure_url: "https://control.example/session-1",
            },
          }),
      } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new VoximplantProvider(
      {
        managementJwt: "jwt",
        ruleId: "rule-1",
        webhookSecret: "secret",
        apiBaseUrl: "https://api.voximplant.com/platform_api",
        controlTimeoutMs: 1000,
      },
      {
        webhookSecret: "secret",
        publicUrl: "https://openclaw.example/voice/webhook",
        streamPath: "/voice/stream",
      },
    );

    const initiated = await provider.initiateCall({
      callId: "call-1",
      from: "+79990001122",
      to: "+79990003344",
      webhookUrl: "https://openclaw.example/voice/webhook",
    });
    expect(initiated.providerCallId).toBe("history-1");

    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const params = new URLSearchParams(String(firstInit.body));
    const scriptCustomDataRaw = params.get("script_custom_data");
    expect(scriptCustomDataRaw).toBeTruthy();
    const scriptCustomData = JSON.parse(scriptCustomDataRaw || "{}") as { streamUrl?: string };
    const streamUrl = scriptCustomData.streamUrl || "";
    expect(streamUrl).toContain("wss://openclaw.example/voice/stream");
    const streamToken = new URL(streamUrl).searchParams.get("token");
    expect(provider.isValidStreamToken("call-1", streamToken || undefined)).toBe(true);
    expect(provider.isValidStreamToken("history-1", streamToken || undefined)).toBe(true);

    const queueTts = vi.fn(
      async (_streamSid: string, playFn: (signal: AbortSignal) => Promise<void>) => {
        const controller = new AbortController();
        await playFn(controller.signal);
      },
    );
    const sendAudio = vi.fn();
    const sendMark = vi.fn();
    const clearTtsQueue = vi.fn();

    provider.setMediaStreamHandler({
      queueTts,
      sendAudio,
      sendMark,
      clearTtsQueue,
    } as unknown as import("../media-stream.js").MediaStreamHandler);
    provider.setTTSProvider({
      synthesizeForTelephony: async () => Buffer.alloc(320, 1),
    });
    provider.registerCallStream("call-1", "stream-1");

    await provider.playTts({
      callId: "call-1",
      providerCallId: "history-1",
      text: "Hello from LLM",
    });

    expect(queueTts).toHaveBeenCalledTimes(1);
    expect(sendAudio).toHaveBeenCalled();
    expect(sendMark).toHaveBeenCalled();
    // Only StartScenarios should hit fetch; no control speak request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("generates management JWT from service-account credentials", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const rawHeaders = init?.headers;
      let authHeader = "";
      if (rawHeaders instanceof Headers) {
        authHeader = rawHeaders.get("Authorization") ?? "";
      } else if (Array.isArray(rawHeaders)) {
        const pair = rawHeaders.find(([key]) => key.toLowerCase() === "authorization");
        authHeader = pair?.[1] ?? "";
      } else if (rawHeaders && typeof rawHeaders === "object") {
        const map = rawHeaders as Record<string, string>;
        authHeader = map.Authorization ?? map.authorization ?? "";
      }

      expect(authHeader.startsWith("Bearer ")).toBe(true);
      const token = authHeader.slice("Bearer ".length);
      const [headerPart, payloadPart] = token.split(".");
      expect(headerPart).toBeTruthy();
      expect(payloadPart).toBeTruthy();
      const header = JSON.parse(Buffer.from(headerPart || "", "base64url").toString("utf8"));
      const payload = JSON.parse(Buffer.from(payloadPart || "", "base64url").toString("utf8"));
      expect(header).toMatchObject({ alg: "RS256", typ: "JWT", kid: "key-1" });
      expect(payload.iss).toBe("10277772");
      expect(payload.exp - payload.iat).toBe(3600);

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            result: {
              call_session_history_id: "history-1",
            },
          }),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new VoximplantProvider({
      managementAccountId: "10277772",
      managementKeyId: "key-1",
      managementPrivateKey: privateKeyPem,
      ruleId: "rule-1",
      webhookSecret: "secret",
      apiBaseUrl: "https://api.voximplant.com/platform_api",
      controlTimeoutMs: 1000,
    });

    const initiated = await provider.initiateCall({
      callId: "call-1",
      from: "+79990001122",
      to: "+79990003344",
      webhookUrl: "https://openclaw.example/voice/webhook",
    });

    expect(initiated.providerCallId).toBe("history-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores managementJwt AUTO sentinel and uses service-account JWT", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const rawHeaders = init?.headers;
      let authHeader = "";
      if (rawHeaders instanceof Headers) {
        authHeader = rawHeaders.get("Authorization") ?? "";
      } else if (Array.isArray(rawHeaders)) {
        const pair = rawHeaders.find(([key]) => key.toLowerCase() === "authorization");
        authHeader = pair?.[1] ?? "";
      } else if (rawHeaders && typeof rawHeaders === "object") {
        const map = rawHeaders as Record<string, string>;
        authHeader = map.Authorization ?? map.authorization ?? "";
      }

      expect(authHeader).not.toBe("Bearer AUTO");
      expect(authHeader.startsWith("Bearer ")).toBe(true);

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            result: {
              call_session_history_id: "history-auto",
            },
          }),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new VoximplantProvider({
      managementJwt: "AUTO",
      managementAccountId: "10277772",
      managementKeyId: "key-1",
      managementPrivateKey: privateKeyPem,
      ruleId: "rule-1",
      webhookSecret: "secret",
      apiBaseUrl: "https://api.voximplant.com/platform_api",
      controlTimeoutMs: 1000,
    });

    const initiated = await provider.initiateCall({
      callId: "call-auto",
      from: "+79990001122",
      to: "+79990003344",
      webhookUrl: "https://openclaw.example/voice/webhook",
    });

    expect(initiated.providerCallId).toBe("history-auto");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
