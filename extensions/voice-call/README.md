# @openclaw/voice-call

Official Voice Call plugin for **OpenClaw**.

Providers:

- **Twilio** (Programmable Voice + Media Streams)
- **Telnyx** (Call Control v2)
- **Plivo** (Voice API + XML transfer + GetInput speech)
- **Voximplant** (StartScenarios + VoxEngine webhook bridge)
- **Mock** (dev/no network)

Docs: `https://docs.openclaw.ai/plugins/voice-call`
Plugin system: `https://docs.openclaw.ai/plugin`

## Install (local dev)

### Option A: install via OpenClaw (recommended)

```bash
openclaw plugins install @openclaw/voice-call
```

Restart the Gateway afterwards.

### Option B: copy into your global extensions folder (dev)

```bash
mkdir -p ~/.openclaw/extensions
cp -R extensions/voice-call ~/.openclaw/extensions/voice-call
cd ~/.openclaw/extensions/voice-call && pnpm install
```

## Config

Put under `plugins.entries.voice-call.config`:

```json5
{
  provider: "twilio", // or "telnyx" | "plivo" | "voximplant" | "mock"
  fromNumber: "+15550001234",
  toNumber: "+15550005678",

  twilio: {
    accountSid: "ACxxxxxxxx",
    authToken: "your_token",
  },

  telnyx: {
    apiKey: "KEYxxxx",
    connectionId: "CONNxxxx",
    // Telnyx webhook public key from the Telnyx Mission Control Portal
    // (Base64 string; can also be set via TELNYX_PUBLIC_KEY).
    publicKey: "...",
  },

  plivo: {
    authId: "MAxxxxxxxxxxxxxxxxxxxx",
    authToken: "your_token",
  },

  voximplant: {
    // Option A: static JWT (manual rotation every <= 1h)
    managementJwt: "eyJ...",
    // Option B: service-account auto JWT (recommended)
    // managementAccountId: "10277772",
    // managementKeyId: "f4b6bf31-....",
    // managementPrivateKey: "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
    // managementJwtRefreshSkewSec: 60,
    ruleId: "123456",
    webhookSecret: "shared_secret",
    // apiBaseUrl: "https://api.voximplant.com/platform_api",
    // controlTimeoutMs: 10000,
  },

  // Webhook server
  serve: {
    port: 3334,
    path: "/voice/webhook",
  },

  // Public exposure (pick one):
  // publicUrl: "https://example.ngrok.app/voice/webhook",
  // tunnel: { provider: "ngrok" },
  // tailscale: { mode: "funnel", path: "/voice/webhook" }

  outbound: {
    defaultMode: "notify", // or "conversation"
  },

  streaming: {
    enabled: true,
    streamPath: "/voice/stream",
  },
}
```

Notes:

- Twilio/Telnyx/Plivo/Voximplant require a **publicly reachable** webhook URL.
- `mock` is a local dev provider (no network calls).
- Telnyx requires `telnyx.publicKey` (or `TELNYX_PUBLIC_KEY`) unless `skipSignatureVerification` is true.
- Voximplant requires `voximplant.webhookSecret` (or `VOXIMPLANT_WEBHOOK_SECRET`) unless `skipSignatureVerification` is true.
- Voximplant auth can be either static `managementJwt` or auto-generated from service-account fields:
  `managementAccountId`, `managementKeyId`, `managementPrivateKey`
  (or env: `VOXIMPLANT_MANAGEMENT_ACCOUNT_ID`, `VOXIMPLANT_MANAGEMENT_KEY_ID`,
  `VOXIMPLANT_MANAGEMENT_PRIVATE_KEY` / `VOXIMPLANT_MANAGEMENT_PRIVATE_KEY_B64`).
- `tunnel.allowNgrokFreeTierLoopbackBypass: true` allows Twilio webhooks with invalid signatures **only** when `tunnel.provider="ngrok"` and `serve.bind` is loopback (ngrok local agent). Use for local dev only.

## Voximplant scenario contract

The provider starts a scenario through `StartScenarios` and passes this `script_custom_data`:

- `callId` (OpenClaw internal call id)
- `from` (caller id in E.164)
- `to` (target phone in E.164)
- `webhookUrl` (OpenClaw webhook URL)
- `webhookSecret` (if configured in OpenClaw)
- `streamUrl` (when `streaming.enabled=true`)

Your VoxEngine scenario should:

- call PSTN in your region (for RU routing)
- bridge RTP audio to `streamUrl` over WebSocket (transport only)
- send call lifecycle callbacks to `webhookUrl` as JSON
- include header `x-openclaw-voximplant-secret: <voximplant.webhookSecret>`
- return `media_session_access_secure_url` in callback payload for fallback controls (`hangup`, non-streaming fallback)

When media streaming is active, OpenClaw handles STT + dialog + TTS. Voximplant only transports telephony.

## ElevenLabs voice for calls

Use core `messages.tts` (or plugin `tts` override) with provider `elevenlabs` and keep `streaming.enabled=true`:

```json5
{
  messages: {
    tts: {
      provider: "elevenlabs",
      elevenlabs: {
        apiKey: "${ELEVENLABS_API_KEY}",
        voiceId: "pNInz6obpgDQGcFmaJgB",
        modelId: "eleven_multilingual_v2",
      },
    },
  },
}
```

## TTS for calls

Voice Call uses the core `messages.tts` configuration (OpenAI or ElevenLabs) for
streaming speech on calls. You can override it under the plugin config with the
same shape — overrides deep-merge with `messages.tts`.

```json5
{
  tts: {
    provider: "openai",
    openai: {
      voice: "alloy",
    },
  },
}
```

Notes:

- Edge TTS is ignored for voice calls (telephony audio needs PCM; Edge output is unreliable).
- Core TTS is used when Twilio media streaming is enabled; otherwise calls fall back to provider native voices.

## CLI

```bash
openclaw voicecall call --to "+15555550123" --message "Hello from OpenClaw"
openclaw voicecall continue --call-id <id> --message "Any questions?"
openclaw voicecall speak --call-id <id> --message "One moment"
openclaw voicecall end --call-id <id>
openclaw voicecall status --call-id <id>
openclaw voicecall tail
openclaw voicecall expose --mode funnel
```

## Tool

Tool name: `voice_call`

Actions:

- `initiate_call` (message, to?, mode?)
- `continue_call` (callId, message)
- `speak_to_user` (callId, message)
- `end_call` (callId)
- `get_status` (callId)

## Gateway RPC

- `voicecall.initiate` (to?, message, mode?)
- `voicecall.continue` (callId, message)
- `voicecall.speak` (callId, message)
- `voicecall.end` (callId)
- `voicecall.status` (callId)

## Notes

- Uses webhook signature verification for Twilio/Telnyx/Plivo.
- `responseModel` / `responseSystemPrompt` control AI auto-responses.
- Media streaming requires `ws` and OpenAI Realtime API key.
