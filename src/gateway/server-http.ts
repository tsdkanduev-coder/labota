import type { Duplex } from "node:stream";
import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import {
  createServer as createHttpServer,
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type Server as HttpServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import type { OpenClawConfig } from "../config/config.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import {
  A2UI_PATH,
  CANVAS_HOST_PATH,
  CANVAS_WS_PATH,
  handleA2uiHttpRequest,
} from "../canvas-host/a2ui.js";
import { loadConfig } from "../config/config.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import { handleSlackHttpRequest } from "../slack/http/index.js";
import {
  authorizeGatewayConnect,
  isLocalDirectRequest,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "./auth.js";
import {
  handleControlUiAvatarRequest,
  handleControlUiHttpRequest,
  type ControlUiRootState,
} from "./control-ui.js";
import { applyHookMappings } from "./hooks-mapping.js";
import {
  extractHookToken,
  getHookAgentPolicyError,
  getHookChannelError,
  type HookMessageChannel,
  type HooksConfigResolved,
  isHookAgentAllowed,
  normalizeAgentPayload,
  normalizeHookHeaders,
  normalizeWakePayload,
  readJsonBody,
  resolveHookSessionKey,
  resolveHookTargetAgentId,
  resolveHookChannel,
  resolveHookDeliver,
} from "./hooks.js";
import { sendGatewayAuthFailure } from "./http-common.js";
import { getBearerToken, getHeader } from "./http-utils.js";
import { isPrivateOrLoopbackAddress, resolveGatewayClientIp } from "./net.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;
type HookAuthFailure = { count: number; windowStartedAtMs: number };

const HOOK_AUTH_FAILURE_LIMIT = 20;
const HOOK_AUTH_FAILURE_WINDOW_MS = 60_000;
const HOOK_AUTH_FAILURE_TRACK_MAX = 2048;
const VOICE_CALL_DEFAULT_BIND = "127.0.0.1";
const VOICE_CALL_DEFAULT_PORT = 3334;
const VOICE_CALL_DEFAULT_WEBHOOK_PATH = "/voice/webhook";
const VOICE_CALL_DEFAULT_STREAM_PATH = "/voice/stream";
const VOICE_CALL_PROXY_TIMEOUT_MS = 30_000;

type VoiceCallProxyTarget = {
  host: string;
  port: number;
  webhookPath: string;
  streamPath: string;
  streamEnabled: boolean;
};

type HookDispatchers = {
  dispatchWakeHook: (value: { text: string; mode: "now" | "next-heartbeat" }) => void;
  dispatchAgentHook: (value: {
    message: string;
    name: string;
    agentId?: string;
    wakeMode: "now" | "next-heartbeat";
    sessionKey: string;
    deliver: boolean;
    channel: HookMessageChannel;
    to?: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    allowUnsafeExternalContent?: boolean;
  }) => string;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isCanvasPath(pathname: string): boolean {
  return (
    pathname === A2UI_PATH ||
    pathname.startsWith(`${A2UI_PATH}/`) ||
    pathname === CANVAS_HOST_PATH ||
    pathname.startsWith(`${CANVAS_HOST_PATH}/`) ||
    pathname === CANVAS_WS_PATH
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function normalizePath(path: string | undefined, fallback: string): string {
  const raw = (path ?? fallback).trim();
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
    return withLeadingSlash.slice(0, -1);
  }
  return withLeadingSlash;
}

function pathMatchesPrefix(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function resolveVoiceCallProxyTarget(configSnapshot: OpenClawConfig): VoiceCallProxyTarget | null {
  const plugins = asRecord(configSnapshot.plugins);
  const entries = asRecord(plugins?.entries);
  const voiceCallEntry = asRecord(entries?.["voice-call"]);
  if (!voiceCallEntry) {
    return null;
  }
  if (voiceCallEntry.enabled === false) {
    return null;
  }
  const voiceCallConfig = asRecord(voiceCallEntry.config);
  if (!voiceCallConfig) {
    return null;
  }

  const serve = asRecord(voiceCallConfig.serve);
  const streaming = asRecord(voiceCallConfig.streaming);

  return {
    host: readString(serve?.bind) ?? VOICE_CALL_DEFAULT_BIND,
    port: readPositiveInt(serve?.port, VOICE_CALL_DEFAULT_PORT),
    webhookPath: normalizePath(readString(serve?.path), VOICE_CALL_DEFAULT_WEBHOOK_PATH),
    streamPath: normalizePath(readString(streaming?.streamPath), VOICE_CALL_DEFAULT_STREAM_PATH),
    streamEnabled: streaming?.enabled === true,
  };
}

async function proxyVoiceCallHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  target: VoiceCallProxyTarget;
}): Promise<void> {
  const { req, res, target } = params;
  const headers: OutgoingHttpHeaders = {
    ...req.headers,
    host: `${target.host}:${target.port}`,
  };

  await new Promise<void>((resolve) => {
    const upstreamReq = createHttpRequest(
      {
        protocol: "http:",
        host: target.host,
        port: target.port,
        method: req.method ?? "GET",
        path: req.url ?? target.webhookPath,
        headers,
      },
      (upstreamRes) => {
        res.statusCode = upstreamRes.statusCode ?? 502;
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (value !== undefined) {
            res.setHeader(name, value);
          }
        }
        upstreamRes.pipe(res);
        upstreamRes.on("end", resolve);
        upstreamRes.on("error", () => {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Bad Gateway");
          }
          resolve();
        });
      },
    );

    upstreamReq.setTimeout(VOICE_CALL_PROXY_TIMEOUT_MS, () => {
      upstreamReq.destroy(new Error("voice-call upstream timeout"));
    });
    upstreamReq.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Bad Gateway");
      }
      resolve();
    });
    req.on("aborted", () => {
      upstreamReq.destroy();
      resolve();
    });
    req.pipe(upstreamReq);
  });
}

function writeHttpResponseToSocket(params: {
  socket: Duplex;
  statusCode: number;
  statusMessage: string;
  headers?: IncomingHttpHeaders;
}): void {
  const { socket, statusCode, statusMessage, headers } = params;
  const lines = [`HTTP/1.1 ${statusCode} ${statusMessage}`];
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          lines.push(`${name}: ${item}`);
        }
      } else {
        lines.push(`${name}: ${value}`);
      }
    }
  }
  lines.push("Connection: close", "", "");
  socket.write(lines.join("\r\n"));
}

function proxyVoiceCallWsUpgrade(params: {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  target: VoiceCallProxyTarget;
}): void {
  const { req, socket, head, target } = params;
  const headers: OutgoingHttpHeaders = {
    ...req.headers,
    host: `${target.host}:${target.port}`,
  };
  const upstreamReq = createHttpRequest({
    protocol: "http:",
    host: target.host,
    port: target.port,
    method: req.method ?? "GET",
    path: req.url ?? target.streamPath,
    headers,
  });

  upstreamReq.setTimeout(VOICE_CALL_PROXY_TIMEOUT_MS, () => {
    upstreamReq.destroy(new Error("voice-call websocket upstream timeout"));
  });

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    const statusCode = upstreamRes.statusCode ?? 101;
    const statusMessage = upstreamRes.statusMessage ?? "Switching Protocols";
    const rawHeaderLines: string[] = [];
    const rawHeaders = upstreamRes.rawHeaders;
    for (let i = 0; i < rawHeaders.length; i += 2) {
      rawHeaderLines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1] ?? ""}`);
    }
    socket.write(
      [`HTTP/1.1 ${statusCode} ${statusMessage}`, ...rawHeaderLines, "", ""].join("\r\n"),
    );
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    if (upstreamHead.length > 0) {
      socket.write(upstreamHead);
    }
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstreamReq.on("response", (upstreamRes) => {
    writeHttpResponseToSocket({
      socket,
      statusCode: upstreamRes.statusCode ?? 502,
      statusMessage: upstreamRes.statusMessage ?? "Bad Gateway",
      headers: upstreamRes.headers,
    });
    upstreamRes.resume();
    upstreamRes.on("end", () => socket.destroy());
  });

  upstreamReq.on("error", () => {
    writeHttpResponseToSocket({
      socket,
      statusCode: 502,
      statusMessage: "Bad Gateway",
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
    socket.destroy();
  });

  upstreamReq.end();
}

function hasAuthorizedWsClientForIp(clients: Set<GatewayWsClient>, clientIp: string): boolean {
  for (const client of clients) {
    if (client.clientIp && client.clientIp === clientIp) {
      return true;
    }
  }
  return false;
}

async function authorizeCanvasRequest(params: {
  req: IncomingMessage;
  auth: ResolvedGatewayAuth;
  trustedProxies: string[];
  clients: Set<GatewayWsClient>;
  rateLimiter?: AuthRateLimiter;
}): Promise<GatewayAuthResult> {
  const { req, auth, trustedProxies, clients, rateLimiter } = params;
  if (isLocalDirectRequest(req, trustedProxies)) {
    return { ok: true };
  }

  let lastAuthFailure: GatewayAuthResult | null = null;
  const token = getBearerToken(req);
  if (token) {
    const authResult = await authorizeGatewayConnect({
      auth: { ...auth, allowTailscale: false },
      connectAuth: { token, password: token },
      req,
      trustedProxies,
      rateLimiter,
    });
    if (authResult.ok) {
      return authResult;
    }
    lastAuthFailure = authResult;
  }

  const clientIp = resolveGatewayClientIp({
    remoteAddr: req.socket?.remoteAddress ?? "",
    forwardedFor: getHeader(req, "x-forwarded-for"),
    realIp: getHeader(req, "x-real-ip"),
    trustedProxies,
  });
  if (!clientIp) {
    return lastAuthFailure ?? { ok: false, reason: "unauthorized" };
  }

  // IP-based fallback is only safe for machine-scoped addresses.
  // Only allow IP-based fallback for private/loopback addresses to prevent
  // cross-session access in shared-IP environments (corporate NAT, cloud).
  if (!isPrivateOrLoopbackAddress(clientIp)) {
    return lastAuthFailure ?? { ok: false, reason: "unauthorized" };
  }
  if (hasAuthorizedWsClientForIp(clients, clientIp)) {
    return { ok: true };
  }
  return lastAuthFailure ?? { ok: false, reason: "unauthorized" };
}

function writeUpgradeAuthFailure(
  socket: { write: (chunk: string) => void },
  auth: GatewayAuthResult,
) {
  if (auth.rateLimited) {
    const retryAfterSeconds =
      auth.retryAfterMs && auth.retryAfterMs > 0 ? Math.ceil(auth.retryAfterMs / 1000) : undefined;
    socket.write(
      [
        "HTTP/1.1 429 Too Many Requests",
        retryAfterSeconds ? `Retry-After: ${retryAfterSeconds}` : undefined,
        "Content-Type: application/json; charset=utf-8",
        "Connection: close",
        "",
        JSON.stringify({
          error: {
            message: "Too many failed authentication attempts. Please try again later.",
            type: "rate_limited",
          },
        }),
      ]
        .filter(Boolean)
        .join("\r\n"),
    );
    return;
  }
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createHooksRequestHandler(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
): HooksRequestHandler {
  const { getHooksConfig, bindHost, port, logHooks, dispatchAgentHook, dispatchWakeHook } = opts;
  const hookAuthFailures = new Map<string, HookAuthFailure>();

  const resolveHookClientKey = (req: IncomingMessage): string => {
    return req.socket?.remoteAddress?.trim() || "unknown";
  };

  const recordHookAuthFailure = (
    clientKey: string,
    nowMs: number,
  ): { throttled: boolean; retryAfterSeconds?: number } => {
    if (!hookAuthFailures.has(clientKey) && hookAuthFailures.size >= HOOK_AUTH_FAILURE_TRACK_MAX) {
      // Prune expired entries instead of clearing all state.
      for (const [key, entry] of hookAuthFailures) {
        if (nowMs - entry.windowStartedAtMs >= HOOK_AUTH_FAILURE_WINDOW_MS) {
          hookAuthFailures.delete(key);
        }
      }
      // If still at capacity after pruning, drop the oldest half.
      if (hookAuthFailures.size >= HOOK_AUTH_FAILURE_TRACK_MAX) {
        let toRemove = Math.floor(hookAuthFailures.size / 2);
        for (const key of hookAuthFailures.keys()) {
          if (toRemove <= 0) {
            break;
          }
          hookAuthFailures.delete(key);
          toRemove--;
        }
      }
    }
    const current = hookAuthFailures.get(clientKey);
    const expired = !current || nowMs - current.windowStartedAtMs >= HOOK_AUTH_FAILURE_WINDOW_MS;
    const next: HookAuthFailure = expired
      ? { count: 1, windowStartedAtMs: nowMs }
      : { count: current.count + 1, windowStartedAtMs: current.windowStartedAtMs };
    // Delete-before-set refreshes Map insertion order so recently-active
    // clients are not evicted before dormant ones during oldest-half eviction.
    if (hookAuthFailures.has(clientKey)) {
      hookAuthFailures.delete(clientKey);
    }
    hookAuthFailures.set(clientKey, next);
    if (next.count <= HOOK_AUTH_FAILURE_LIMIT) {
      return { throttled: false };
    }
    const retryAfterMs = Math.max(1, next.windowStartedAtMs + HOOK_AUTH_FAILURE_WINDOW_MS - nowMs);
    return {
      throttled: true,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  };

  const clearHookAuthFailure = (clientKey: string) => {
    hookAuthFailures.delete(clientKey);
  };

  return async (req, res) => {
    const hooksConfig = getHooksConfig();
    if (!hooksConfig) {
      return false;
    }
    const url = new URL(req.url ?? "/", `http://${bindHost}:${port}`);
    const basePath = hooksConfig.basePath;
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return false;
    }

    if (url.searchParams.has("token")) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(
        "Hook token must be provided via Authorization: Bearer <token> or X-OpenClaw-Token header (query parameters are not allowed).",
      );
      return true;
    }

    const token = extractHookToken(req);
    const clientKey = resolveHookClientKey(req);
    if (!safeEqualSecret(token, hooksConfig.token)) {
      const throttle = recordHookAuthFailure(clientKey, Date.now());
      if (throttle.throttled) {
        const retryAfter = throttle.retryAfterSeconds ?? 1;
        res.statusCode = 429;
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Too Many Requests");
        logHooks.warn(`hook auth throttled for ${clientKey}; retry-after=${retryAfter}s`);
        return true;
      }
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Unauthorized");
      return true;
    }
    clearHookAuthFailure(clientKey);

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    const subPath = url.pathname.slice(basePath.length).replace(/^\/+/, "");
    if (!subPath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return true;
    }

    const body = await readJsonBody(req, hooksConfig.maxBodyBytes);
    if (!body.ok) {
      const status =
        body.error === "payload too large"
          ? 413
          : body.error === "request body timeout"
            ? 408
            : 400;
      sendJson(res, status, { ok: false, error: body.error });
      return true;
    }

    const payload = typeof body.value === "object" && body.value !== null ? body.value : {};
    const headers = normalizeHookHeaders(req);

    if (subPath === "wake") {
      const normalized = normalizeWakePayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      dispatchWakeHook(normalized.value);
      sendJson(res, 200, { ok: true, mode: normalized.value.mode });
      return true;
    }

    if (subPath === "agent") {
      const normalized = normalizeAgentPayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      if (!isHookAgentAllowed(hooksConfig, normalized.value.agentId)) {
        sendJson(res, 400, { ok: false, error: getHookAgentPolicyError() });
        return true;
      }
      const sessionKey = resolveHookSessionKey({
        hooksConfig,
        source: "request",
        sessionKey: normalized.value.sessionKey,
      });
      if (!sessionKey.ok) {
        sendJson(res, 400, { ok: false, error: sessionKey.error });
        return true;
      }
      const runId = dispatchAgentHook({
        ...normalized.value,
        sessionKey: sessionKey.value,
        agentId: resolveHookTargetAgentId(hooksConfig, normalized.value.agentId),
      });
      sendJson(res, 202, { ok: true, runId });
      return true;
    }

    if (hooksConfig.mappings.length > 0) {
      try {
        const mapped = await applyHookMappings(hooksConfig.mappings, {
          payload: payload as Record<string, unknown>,
          headers,
          url,
          path: subPath,
        });
        if (mapped) {
          if (!mapped.ok) {
            sendJson(res, 400, { ok: false, error: mapped.error });
            return true;
          }
          if (mapped.action === null) {
            res.statusCode = 204;
            res.end();
            return true;
          }
          if (mapped.action.kind === "wake") {
            dispatchWakeHook({
              text: mapped.action.text,
              mode: mapped.action.mode,
            });
            sendJson(res, 200, { ok: true, mode: mapped.action.mode });
            return true;
          }
          const channel = resolveHookChannel(mapped.action.channel);
          if (!channel) {
            sendJson(res, 400, { ok: false, error: getHookChannelError() });
            return true;
          }
          if (!isHookAgentAllowed(hooksConfig, mapped.action.agentId)) {
            sendJson(res, 400, { ok: false, error: getHookAgentPolicyError() });
            return true;
          }
          const sessionKey = resolveHookSessionKey({
            hooksConfig,
            source: "mapping",
            sessionKey: mapped.action.sessionKey,
          });
          if (!sessionKey.ok) {
            sendJson(res, 400, { ok: false, error: sessionKey.error });
            return true;
          }
          const runId = dispatchAgentHook({
            message: mapped.action.message,
            name: mapped.action.name ?? "Hook",
            agentId: resolveHookTargetAgentId(hooksConfig, mapped.action.agentId),
            wakeMode: mapped.action.wakeMode,
            sessionKey: sessionKey.value,
            deliver: resolveHookDeliver(mapped.action.deliver),
            channel,
            to: mapped.action.to,
            model: mapped.action.model,
            thinking: mapped.action.thinking,
            timeoutSeconds: mapped.action.timeoutSeconds,
            allowUnsafeExternalContent: mapped.action.allowUnsafeExternalContent,
          });
          sendJson(res, 202, { ok: true, runId });
          return true;
        }
      } catch (err) {
        logHooks.warn(`hook mapping failed: ${String(err)}`);
        sendJson(res, 500, { ok: false, error: "hook mapping failed" });
        return true;
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  };
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  controlUiRoot?: ControlUiRootState;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: HooksRequestHandler;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  tlsOptions?: TlsOptions;
}): HttpServer {
  const {
    canvasHost,
    clients,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    handleHooksRequest,
    handlePluginRequest,
    resolvedAuth,
    rateLimiter,
  } = opts;
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
      const voiceCallTarget = resolveVoiceCallProxyTarget(configSnapshot);
      if (voiceCallTarget && pathMatchesPrefix(requestPath, voiceCallTarget.webhookPath)) {
        await proxyVoiceCallHttpRequest({
          req,
          res,
          target: voiceCallTarget,
        });
        return;
      }
      if (await handleHooksRequest(req, res)) {
        return;
      }
      if (
        await handleToolsInvokeHttpRequest(req, res, {
          auth: resolvedAuth,
          trustedProxies,
          rateLimiter,
        })
      ) {
        return;
      }
      if (await handleSlackHttpRequest(req, res)) {
        return;
      }
      if (handlePluginRequest) {
        // Channel HTTP endpoints are gateway-auth protected by default.
        // Non-channel plugin routes remain plugin-owned and must enforce
        // their own auth when exposing sensitive functionality.
        if (requestPath.startsWith("/api/channels/")) {
          const token = getBearerToken(req);
          const authResult = await authorizeGatewayConnect({
            auth: resolvedAuth,
            connectAuth: token ? { token, password: token } : null,
            req,
            trustedProxies,
            rateLimiter,
          });
          if (!authResult.ok) {
            sendGatewayAuthFailure(res, authResult);
            return;
          }
        }
        if (await handlePluginRequest(req, res)) {
          return;
        }
      }
      if (openResponsesEnabled) {
        if (
          await handleOpenResponsesHttpRequest(req, res, {
            auth: resolvedAuth,
            config: openResponsesConfig,
            trustedProxies,
            rateLimiter,
          })
        ) {
          return;
        }
      }
      if (openAiChatCompletionsEnabled) {
        if (
          await handleOpenAiHttpRequest(req, res, {
            auth: resolvedAuth,
            trustedProxies,
            rateLimiter,
          })
        ) {
          return;
        }
      }
      if (canvasHost) {
        if (isCanvasPath(requestPath)) {
          const ok = await authorizeCanvasRequest({
            req,
            auth: resolvedAuth,
            trustedProxies,
            clients,
            rateLimiter,
          });
          if (!ok.ok) {
            sendGatewayAuthFailure(res, ok);
            return;
          }
        }
        if (await handleA2uiHttpRequest(req, res)) {
          return;
        }
        if (await canvasHost.handleHttpRequest(req, res)) {
          return;
        }
      }
      if (controlUiEnabled) {
        if (
          handleControlUiAvatarRequest(req, res, {
            basePath: controlUiBasePath,
            resolveAvatar: (agentId) => resolveAgentAvatar(configSnapshot, agentId),
          })
        ) {
          return;
        }
        if (
          handleControlUiHttpRequest(req, res, {
            basePath: controlUiBasePath,
            config: configSnapshot,
            root: controlUiRoot,
          })
        ) {
          return;
        }
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
}) {
  const { httpServer, wss, canvasHost, clients, resolvedAuth, rateLimiter } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    void (async () => {
      const configSnapshot = loadConfig();
      const url = new URL(req.url ?? "/", "http://localhost");
      const voiceCallTarget = resolveVoiceCallProxyTarget(configSnapshot);
      if (
        voiceCallTarget &&
        voiceCallTarget.streamEnabled &&
        url.pathname === voiceCallTarget.streamPath
      ) {
        proxyVoiceCallWsUpgrade({
          req,
          socket,
          head,
          target: voiceCallTarget,
        });
        return;
      }
      if (canvasHost) {
        if (url.pathname === CANVAS_WS_PATH) {
          const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
          const ok = await authorizeCanvasRequest({
            req,
            auth: resolvedAuth,
            trustedProxies,
            clients,
            rateLimiter,
          });
          if (!ok.ok) {
            writeUpgradeAuthFailure(socket, ok);
            socket.destroy();
            return;
          }
        }
        if (canvasHost.handleUpgrade(req, socket, head)) {
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    })().catch(() => {
      socket.destroy();
    });
  });
}
