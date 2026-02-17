import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateProviderConfig, resolveVoiceCallConfig, type VoiceCallConfig } from "./config.js";

function createBaseConfig(
  provider: "telnyx" | "twilio" | "plivo" | "voximplant" | "mock",
): VoiceCallConfig {
  return {
    enabled: true,
    provider,
    fromNumber: "+15550001234",
    inboundPolicy: "disabled",
    allowFrom: [],
    outbound: { defaultMode: "notify", notifyHangupDelaySec: 3 },
    maxDurationSeconds: 300,
    silenceTimeoutMs: 800,
    transcriptTimeoutMs: 180000,
    ringTimeoutMs: 30000,
    maxConcurrentCalls: 1,
    serve: { port: 3334, bind: "127.0.0.1", path: "/voice/webhook" },
    tailscale: { mode: "off", path: "/voice/webhook" },
    tunnel: { provider: "none", allowNgrokFreeTierLoopbackBypass: false },
    webhookSecurity: {
      allowedHosts: [],
      trustForwardingHeaders: false,
      trustedProxyIPs: [],
    },
    streaming: {
      enabled: false,
      sttProvider: "openai-realtime",
      sttModel: "gpt-4o-transcribe",
      silenceDurationMs: 800,
      vadThreshold: 0.5,
      streamPath: "/voice/stream",
    },
    skipSignatureVerification: false,
    stt: { provider: "openai", model: "whisper-1" },
    tts: { provider: "openai", model: "gpt-4o-mini-tts", voice: "coral" },
    responseModel: "openai/gpt-4o-mini",
    responseTimeoutMs: 30000,
  };
}

describe("validateProviderConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all relevant env vars before each test
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_CONNECTION_ID;
    delete process.env.TELNYX_PUBLIC_KEY;
    delete process.env.PLIVO_AUTH_ID;
    delete process.env.PLIVO_AUTH_TOKEN;
    delete process.env.VOXIMPLANT_MANAGEMENT_JWT;
    delete process.env.VOXIMPLANT_MANAGEMENT_ACCOUNT_ID;
    delete process.env.VOXIMPLANT_MANAGEMENT_KEY_ID;
    delete process.env.VOXIMPLANT_MANAGEMENT_PRIVATE_KEY;
    delete process.env.VOXIMPLANT_MANAGEMENT_PRIVATE_KEY_B64;
    delete process.env.VOXIMPLANT_RULE_ID;
    delete process.env.VOXIMPLANT_WEBHOOK_SECRET;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("twilio provider", () => {
    it("passes validation when credentials are in config", () => {
      const config = createBaseConfig("twilio");
      config.twilio = { accountSid: "AC123", authToken: "secret" };

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes validation when credentials are in environment variables", () => {
      process.env.TWILIO_ACCOUNT_SID = "AC123";
      process.env.TWILIO_AUTH_TOKEN = "secret";
      let config = createBaseConfig("twilio");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes validation with mixed config and env vars", () => {
      process.env.TWILIO_AUTH_TOKEN = "secret";
      let config = createBaseConfig("twilio");
      config.twilio = { accountSid: "AC123" };
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails validation when accountSid is missing everywhere", () => {
      process.env.TWILIO_AUTH_TOKEN = "secret";
      let config = createBaseConfig("twilio");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "plugins.entries.voice-call.config.twilio.accountSid is required (or set TWILIO_ACCOUNT_SID env)",
      );
    });

    it("fails validation when authToken is missing everywhere", () => {
      process.env.TWILIO_ACCOUNT_SID = "AC123";
      let config = createBaseConfig("twilio");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "plugins.entries.voice-call.config.twilio.authToken is required (or set TWILIO_AUTH_TOKEN env)",
      );
    });
  });

  describe("telnyx provider", () => {
    it("passes validation when credentials are in config", () => {
      const config = createBaseConfig("telnyx");
      config.telnyx = { apiKey: "KEY123", connectionId: "CONN456", publicKey: "public-key" };

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes validation when credentials are in environment variables", () => {
      process.env.TELNYX_API_KEY = "KEY123";
      process.env.TELNYX_CONNECTION_ID = "CONN456";
      process.env.TELNYX_PUBLIC_KEY = "public-key";
      let config = createBaseConfig("telnyx");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails validation when apiKey is missing everywhere", () => {
      process.env.TELNYX_CONNECTION_ID = "CONN456";
      let config = createBaseConfig("telnyx");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "plugins.entries.voice-call.config.telnyx.apiKey is required (or set TELNYX_API_KEY env)",
      );
    });

    it("fails validation when allowlist inbound policy lacks public key", () => {
      const config = createBaseConfig("telnyx");
      config.inboundPolicy = "allowlist";
      config.telnyx = { apiKey: "KEY123", connectionId: "CONN456" };

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "plugins.entries.voice-call.config.telnyx.publicKey is required (or set TELNYX_PUBLIC_KEY env)",
      );
    });

    it("passes validation when allowlist inbound policy has public key", () => {
      const config = createBaseConfig("telnyx");
      config.inboundPolicy = "allowlist";
      config.telnyx = {
        apiKey: "KEY123",
        connectionId: "CONN456",
        publicKey: "public-key",
      };

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes validation when skipSignatureVerification is true (even without public key)", () => {
      const config = createBaseConfig("telnyx");
      config.skipSignatureVerification = true;
      config.telnyx = { apiKey: "KEY123", connectionId: "CONN456" };

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("plivo provider", () => {
    it("passes validation when credentials are in config", () => {
      const config = createBaseConfig("plivo");
      config.plivo = { authId: "MA123", authToken: "secret" };

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes validation when credentials are in environment variables", () => {
      process.env.PLIVO_AUTH_ID = "MA123";
      process.env.PLIVO_AUTH_TOKEN = "secret";
      let config = createBaseConfig("plivo");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails validation when authId is missing everywhere", () => {
      process.env.PLIVO_AUTH_TOKEN = "secret";
      let config = createBaseConfig("plivo");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "plugins.entries.voice-call.config.plivo.authId is required (or set PLIVO_AUTH_ID env)",
      );
    });
  });

  describe("voximplant provider", () => {
    it("passes validation when credentials are in config", () => {
      const config = createBaseConfig("voximplant");
      config.voximplant = {
        managementJwt: "jwt",
        ruleId: "12345",
        webhookSecret: "secret",
      };

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes validation when credentials are in environment variables", () => {
      process.env.VOXIMPLANT_MANAGEMENT_JWT = "jwt";
      process.env.VOXIMPLANT_RULE_ID = "12345";
      process.env.VOXIMPLANT_WEBHOOK_SECRET = "secret";
      let config = createBaseConfig("voximplant");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes validation with service-account credentials in env", () => {
      process.env.VOXIMPLANT_MANAGEMENT_ACCOUNT_ID = "10277772";
      process.env.VOXIMPLANT_MANAGEMENT_KEY_ID = "key-id";
      process.env.VOXIMPLANT_MANAGEMENT_PRIVATE_KEY =
        "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
      process.env.VOXIMPLANT_RULE_ID = "12345";
      process.env.VOXIMPLANT_WEBHOOK_SECRET = "secret";
      let config = createBaseConfig("voximplant");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("treats VOXIMPLANT_MANAGEMENT_JWT=AUTO as service-account mode", () => {
      process.env.VOXIMPLANT_MANAGEMENT_JWT = "AUTO";
      process.env.VOXIMPLANT_MANAGEMENT_ACCOUNT_ID = "10277772";
      process.env.VOXIMPLANT_MANAGEMENT_KEY_ID = "key-id";
      process.env.VOXIMPLANT_MANAGEMENT_PRIVATE_KEY =
        "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
      process.env.VOXIMPLANT_RULE_ID = "12345";
      process.env.VOXIMPLANT_WEBHOOK_SECRET = "secret";
      let config = createBaseConfig("voximplant");
      config = resolveVoiceCallConfig(config);

      expect(config.voximplant?.managementJwt).toBeUndefined();

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("fails validation when Voximplant auth is missing everywhere", () => {
      process.env.VOXIMPLANT_RULE_ID = "12345";
      process.env.VOXIMPLANT_WEBHOOK_SECRET = "secret";
      let config = createBaseConfig("voximplant");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Configure Voximplant auth: either voximplant.managementJwt (or VOXIMPLANT_MANAGEMENT_JWT env) OR service-account fields voximplant.managementAccountId/managementKeyId/managementPrivateKey",
      );
    });

    it("fails validation when webhookSecret is missing and verification is enabled", () => {
      process.env.VOXIMPLANT_MANAGEMENT_JWT = "jwt";
      process.env.VOXIMPLANT_RULE_ID = "12345";
      let config = createBaseConfig("voximplant");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "plugins.entries.voice-call.config.voximplant.webhookSecret is required (or set VOXIMPLANT_WEBHOOK_SECRET env)",
      );
    });

    it("passes validation without webhookSecret when skipSignatureVerification is true", () => {
      process.env.VOXIMPLANT_MANAGEMENT_JWT = "jwt";
      process.env.VOXIMPLANT_RULE_ID = "12345";
      let config = createBaseConfig("voximplant");
      config.skipSignatureVerification = true;
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("disabled config", () => {
    it("skips validation when enabled is false", () => {
      const config = createBaseConfig("twilio");
      config.enabled = false;

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
