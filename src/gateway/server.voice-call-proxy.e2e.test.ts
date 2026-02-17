import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { ResolvedGatewayAuth } from "./auth.js";
import { attachGatewayUpgradeHandler, createGatewayHttpServer } from "./server-http.js";

function wsDataToString(data: WebSocket.RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof Buffer) {
    return data.toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

async function withTempConfig(params: { cfg: unknown; run: () => Promise<void> }): Promise<void> {
  const prevConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  const prevDisableCache = process.env.OPENCLAW_DISABLE_CONFIG_CACHE;

  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-voice-call-proxy-test-"));
  const configPath = path.join(dir, "openclaw.json");

  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";

  try {
    await writeFile(configPath, JSON.stringify(params.cfg, null, 2), "utf-8");
    await params.run();
  } finally {
    if (prevConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = prevConfigPath;
    }
    if (prevDisableCache === undefined) {
      delete process.env.OPENCLAW_DISABLE_CONFIG_CACHE;
    } else {
      process.env.OPENCLAW_DISABLE_CONFIG_CACHE = prevDisableCache;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function listen(server: HttpServer): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(0, "127.0.0.1");
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

function isListenPermissionError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  return code === "EPERM" || code === "EACCES";
}

const resolvedAuth: ResolvedGatewayAuth = {
  mode: "none",
  allowTailscale: false,
};

describe("gateway voice-call proxy", () => {
  test("proxies /voice/webhook HTTP callbacks to voice-call server", async () => {
    let capturedBody = "";
    let capturedHeader = "";
    let capturedPath = "";

    const upstreamServer = createHttpServer((req, res) => {
      capturedPath = req.url ?? "";
      capturedHeader = String(req.headers["x-proxy-check"] ?? "");
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        capturedBody += chunk;
      });
      req.on("end", () => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true, proxied: true }));
      });
    });

    const upstreamListener = await listen(upstreamServer).catch((err) => {
      if (isListenPermissionError(err)) {
        return null;
      }
      throw err;
    });
    if (!upstreamListener) {
      return;
    }
    try {
      await withTempConfig({
        cfg: {
          plugins: {
            entries: {
              "voice-call": {
                enabled: true,
                config: {
                  serve: {
                    bind: "127.0.0.1",
                    port: upstreamListener.port,
                    path: "/voice/webhook",
                  },
                },
              },
            },
          },
        },
        run: async () => {
          const gatewayServer = createGatewayHttpServer({
            canvasHost: null,
            clients: new Set(),
            controlUiEnabled: false,
            controlUiBasePath: "/__control__",
            openAiChatCompletionsEnabled: false,
            openResponsesEnabled: false,
            handleHooksRequest: async () => false,
            resolvedAuth,
          });

          const gatewayListener = await listen(gatewayServer);
          try {
            const response = await fetch(
              `http://127.0.0.1:${gatewayListener.port}/voice/webhook?provider=voximplant`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-proxy-check": "voice-http-ok",
                },
                body: JSON.stringify({ hello: "world" }),
              },
            );

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true, proxied: true });
            expect(capturedPath).toBe("/voice/webhook?provider=voximplant");
            expect(capturedHeader).toBe("voice-http-ok");
            expect(capturedBody).toBe('{"hello":"world"}');
          } finally {
            await gatewayListener.close();
          }
        },
      });
    } finally {
      await upstreamListener.close();
    }
  }, 60_000);

  test("proxies /voice/stream websocket upgrades to voice-call server", async () => {
    let capturedUpgradePath = "";

    const upstreamServer = createHttpServer();
    const upstreamWss = new WebSocketServer({ noServer: true });

    upstreamServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/voice/stream") {
        socket.destroy();
        return;
      }
      capturedUpgradePath = req.url ?? "";
      upstreamWss.handleUpgrade(req, socket, head, (ws) => {
        ws.send("upstream-ready");
        ws.on("message", (message) => {
          ws.send(`echo:${wsDataToString(message)}`);
        });
      });
    });

    const upstreamListener = await listen(upstreamServer).catch((err) => {
      if (isListenPermissionError(err)) {
        return null;
      }
      throw err;
    });
    if (!upstreamListener) {
      upstreamWss.close();
      return;
    }
    try {
      await withTempConfig({
        cfg: {
          plugins: {
            entries: {
              "voice-call": {
                enabled: true,
                config: {
                  serve: {
                    bind: "127.0.0.1",
                    port: upstreamListener.port,
                    path: "/voice/webhook",
                  },
                  streaming: {
                    enabled: true,
                    streamPath: "/voice/stream",
                  },
                },
              },
            },
          },
        },
        run: async () => {
          const gatewayServer = createGatewayHttpServer({
            canvasHost: null,
            clients: new Set(),
            controlUiEnabled: false,
            controlUiBasePath: "/__control__",
            openAiChatCompletionsEnabled: false,
            openResponsesEnabled: false,
            handleHooksRequest: async () => false,
            resolvedAuth,
          });

          const gatewayWss = new WebSocketServer({ noServer: true });
          attachGatewayUpgradeHandler({
            httpServer: gatewayServer,
            wss: gatewayWss,
            canvasHost: null,
            clients: new Set(),
            resolvedAuth,
          });

          const gatewayListener = await listen(gatewayServer);
          try {
            const messages = await new Promise<string[]>((resolve, reject) => {
              const ws = new WebSocket(
                `ws://127.0.0.1:${gatewayListener.port}/voice/stream?token=abc123`,
              );
              const received: string[] = [];
              const timer = setTimeout(() => {
                ws.terminate();
                reject(new Error("websocket timeout"));
              }, 10_000);

              ws.on("open", () => {
                ws.send("ping");
              });
              ws.on("message", (data) => {
                received.push(wsDataToString(data));
                if (received.includes("echo:ping")) {
                  clearTimeout(timer);
                  ws.terminate();
                  resolve(received);
                }
              });
              ws.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
              });
            });

            expect(messages).toContain("upstream-ready");
            expect(messages).toContain("echo:ping");
            expect(capturedUpgradePath).toBe("/voice/stream?token=abc123");
          } finally {
            await gatewayListener.close();
            gatewayWss.close();
          }
        },
      });
    } finally {
      upstreamWss.close();
      await upstreamListener.close();
    }
  }, 60_000);
});
