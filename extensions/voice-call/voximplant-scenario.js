/**
 * VoxEngine scenario for Nabu voice calls.
 * Deployed on Voximplant platform — this file is a local reference copy.
 *
 * Flow:
 *   1. OpenClaw calls StartScenarios with script_custom_data (callId, to, from, webhookUrl, streamUrl, etc.)
 *   2. Scenario dials PSTN (callPSTN)
 *   3. On connect: opens WebSocket to streamUrl, bridges audio bidirectionally
 *   4. Sends lifecycle webhooks (call.initiated, call.ringing, call.answered, call.active, call.ended)
 *   5. OpenClaw handles STT + dialog + TTS via the WebSocket audio bridge
 */

function toConfig(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }
  try {
    var s = String(raw);
    if (s && s.charAt(0) === "{") return JSON.parse(s);
  } catch (e) {}
  return {};
}

function asStr(v) {
  return v === undefined || v === null ? "" : String(v);
}

var callId = "";
var to = "";
var from = "";
var webhookUrl = "";
var webhookSecret = "";
var streamUrl = null;
var call = null;
var ws = null;
var sessionAccessSecureUrl = null;
var terminated = false;

function terminateOnce() {
  if (terminated) return;
  terminated = true;
  VoxEngine.terminate();
}

function postEvent(type, extra) {
  if (!webhookUrl) return;
  if (typeof Net === "undefined" || !Net.httpRequestAsync) {
    Logger.write("Net.httpRequestAsync unavailable");
    return;
  }
  var payload = {
    type: type,
    provider: "voximplant",
    callId: callId,
    providerCallId: call ? String(call.id()) : undefined,
    call_session_history_id: call ? String(call.id()) : undefined,
    media_session_access_secure_url: sessionAccessSecureUrl || undefined,
    from: from || undefined,
    to: to || undefined,
    timestamp: Date.now(),
  };
  if (extra) {
    for (var k in extra) payload[k] = extra[k];
  }
  try {
    var req = Net.httpRequestAsync(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-voximplant-secret": webhookSecret,
      },
      postData: JSON.stringify(payload),
    });
    if (req && typeof req.then === "function") {
      req
        .then(function (resp) {
          try {
            Logger.write("Webhook " + type + " -> HTTP " + (resp && resp.code));
          } catch (_) {}
        })
        .catch(function (e) {
          Logger.write("Webhook post failed: " + e);
        });
    }
  } catch (e) {
    Logger.write("Webhook exception: " + e);
  }
}

function attachCallEvents(c) {
  c.addEventListener(CallEvents.Ringing, function () {
    Logger.write("PSTN ringing");
    postEvent("call.ringing");
  });

  c.addEventListener(CallEvents.Connected, function () {
    Logger.write("PSTN connected");
    postEvent("call.answered");

    // Record both sides in HD MP3 (48kHz)
    call.record({ hd_audio: true });
    Logger.write("Recording started (HD)");

    if (streamUrl) {
      try {
        ws = VoxEngine.createWebSocket(streamUrl);
        ws.addEventListener(WebSocketEvents.OPEN, function () {
          Logger.write("Media WS open");
          postEvent("call.active");

          // Bridge audio bidirectionally: call ↔ WebSocket
          c.sendMediaTo(ws, {
            encoding: WebSocketAudioEncoding.ULAW,
            customParameters: { callId: callId },
          });
          ws.sendMediaTo(c, {
            encoding: WebSocketAudioEncoding.ULAW,
            customParameters: { callId: callId },
          });
        });
        ws.addEventListener(WebSocketEvents.ERROR, function (e) {
          Logger.write("Media WS error: " + e);
          postEvent("call.error", { error: "stream_ws_error" });
        });
        ws.addEventListener(WebSocketEvents.CLOSE, function () {
          Logger.write("Media WS closed");
          postEvent("call.error", { error: "stream_ws_closed" });
        });
      } catch (e) {
        Logger.write("Media WS init failed: " + e);
        postEvent("call.error", { error: "stream_init_failed: " + e });
      }
    } else {
      postEvent("call.active");
    }
  });

  c.addEventListener(CallEvents.Failed, function (e) {
    var code = e && e.code !== undefined ? e.code : "n/a";
    var reason = e && e.reason !== undefined ? e.reason : e && e.text ? e.text : "unknown";
    Logger.write("PSTN failed code=" + code + " reason=" + reason);
    postEvent("call.error", { error: "pstn_failed", code: String(code), reason: String(reason) });
    terminateOnce();
  });

  c.addEventListener(CallEvents.Disconnected, function (e) {
    var reason = e && e.reason !== undefined ? e.reason : "completed";
    Logger.write("PSTN disconnected reason=" + reason);
    postEvent("call.ended", { reason: String(reason) });
    terminateOnce();
  });
}

// Handle control commands from OpenClaw (hangup)
VoxEngine.addEventListener(AppEvents.HttpRequest, function (e) {
  Logger.write("Control request: " + e.method + " " + e.path);
  var body = {};
  try {
    body = JSON.parse(e.content || "{}");
  } catch (_) {}

  if (body.action === "hangup") {
    Logger.write("Hangup requested via control URL, reason=" + (body.reason || "unknown"));
    if (call) {
      try {
        call.hangup();
      } catch (ex) {
        Logger.write("call.hangup error: " + ex);
      }
    }
    setTimeout(function () {
      terminateOnce();
    }, 5000);
  }
});

VoxEngine.addEventListener(AppEvents.Started, function (e) {
  sessionAccessSecureUrl = e.accessSecureURL || e.accessURL || null;
  var raw = e && e.customData !== undefined ? e.customData : VoxEngine.customData();
  var cfg = toConfig(raw);

  callId = asStr(cfg.callId) || "vox-" + Date.now();
  to = asStr(cfg.to);
  from = asStr(cfg.from);
  webhookUrl = asStr(cfg.webhookUrl);
  webhookSecret = asStr(cfg.webhookSecret);
  streamUrl = asStr(cfg.streamUrl) || null;

  Logger.write("Started callId=" + callId + " to=" + to + " from=" + from);
  Logger.write("webhookUrl=" + webhookUrl);
  Logger.write("streamUrl=" + streamUrl);

  if (!to || !from) {
    postEvent("call.error", { error: "missing_to_or_from" });
    terminateOnce();
    return;
  }

  call = VoxEngine.callPSTN(to, from);
  postEvent("call.initiated");
  attachCallEvents(call);

  // Safety timeout — terminate stuck calls after 10 minutes
  setTimeout(function () {
    Logger.write("Safety timeout reached (600s), terminating");
    if (call) {
      try {
        call.hangup();
      } catch (_) {}
    }
    setTimeout(function () {
      terminateOnce();
    }, 3000);
  }, 600000);
});

VoxEngine.addEventListener(AppEvents.Terminating, function () {
  try {
    if (ws) ws.close();
  } catch (e) {}
});
