import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthStateManager } from "../google-auth.js";
import {
  InvalidYandexGrantError,
  buildYandexAuthUrl,
  exchangeYandexCode,
  fetchYandexUserInfo,
  refreshYandexAccessToken,
  revokeYandexToken,
} from "../yandex-auth.js";

// ─── buildYandexAuthUrl ─────────────────────────────────────────────

describe("buildYandexAuthUrl", () => {
  let tmpDir: string;
  let stateManager: OAuthStateManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nabu-yandex-test-"));
    stateManager = new OAuthStateManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates URL with PKCE S256 code_challenge", () => {
    const { authUrl, state } = buildYandexAuthUrl(
      123456,
      "https://example.com",
      "test-client-id",
      stateManager,
    );

    const url = new URL(authUrl);
    expect(url.origin).toBe("https://oauth.yandex.ru");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")!.length).toBeGreaterThan(10);
    expect(state).toBeTruthy();
  });

  it("includes scope calendar:all and login:email", () => {
    const { authUrl } = buildYandexAuthUrl(
      123456,
      "https://example.com",
      "test-client-id",
      stateManager,
    );

    const url = new URL(authUrl);
    const scope = url.searchParams.get("scope")!;
    expect(scope).toContain("calendar:all");
    expect(scope).toContain("login:email");
  });

  it("uses correct redirect URI", () => {
    const { authUrl } = buildYandexAuthUrl(
      123456,
      "https://example.com",
      "test-client-id",
      stateManager,
    );

    const url = new URL(authUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.com/plugins/nabu-calendar/oauth/yandex/callback",
    );
  });

  it("saves state with provider=yandex and codeVerifier", () => {
    const { state } = buildYandexAuthUrl(
      123456,
      "https://example.com",
      "test-client-id",
      stateManager,
    );

    const resolved = stateManager.resolve(state);
    expect(resolved).not.toBeNull();
    expect(resolved!.chatId).toBe(123456);
    expect(resolved!.provider).toBe("yandex");
    expect(resolved!.codeVerifier).toBeTruthy();
    expect(resolved!.codeVerifier.length).toBeGreaterThan(10);
  });

  it("includes force_confirm=yes", () => {
    const { authUrl } = buildYandexAuthUrl(
      123456,
      "https://example.com",
      "test-client-id",
      stateManager,
    );

    const url = new URL(authUrl);
    expect(url.searchParams.get("force_confirm")).toBe("yes");
  });
});

// ─── exchangeYandexCode ─────────────────────────────────────────────

describe("exchangeYandexCode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns tokens on successful exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "ya-access-123",
          refresh_token: "ya-refresh-456",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const tokens = await exchangeYandexCode(
      "auth-code",
      "code-verifier",
      "https://example.com/callback",
      "client-id",
      "client-secret",
    );

    expect(tokens.accessToken).toBe("ya-access-123");
    expect(tokens.refreshToken).toBe("ya-refresh-456");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    // Verify fetch was called with correct params
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe("https://oauth.yandex.ru/token");
    const body = (fetchCall[1] as RequestInit).body as string;
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code_verifier=code-verifier");
  });

  it("throws on error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"error": "invalid_request"}', { status: 400 }),
    );

    await expect(
      exchangeYandexCode("bad-code", "verifier", "uri", "cid", "csecret"),
    ).rejects.toThrow("Yandex token exchange failed (400)");
  });
});

// ─── refreshYandexAccessToken ────────────────────────────────────────

describe("refreshYandexAccessToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns new access token on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "ya-new-access",
          expires_in: 7200,
        }),
        { status: 200 },
      ),
    );

    const result = await refreshYandexAccessToken("ya-refresh", "cid", "csecret");

    expect(result.accessToken).toBe("ya-new-access");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws InvalidYandexGrantError on invalid_grant", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"error": "invalid_grant", "error_description": "token revoked"}', {
        status: 400,
      }),
    );

    await expect(refreshYandexAccessToken("bad-refresh", "cid", "csecret")).rejects.toThrow(
      InvalidYandexGrantError,
    );
  });

  it("throws generic error on other failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"error": "server_error"}', { status: 500 }),
    );

    await expect(refreshYandexAccessToken("refresh", "cid", "csecret")).rejects.toThrow(
      "Yandex token refresh failed (500)",
    );
  });
});

// ─── fetchYandexUserInfo ─────────────────────────────────────────────

describe("fetchYandexUserInfo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses OAuth header (not Bearer)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          default_email: "user@yandex.ru",
          display_name: "Test User",
        }),
        { status: 200 },
      ),
    );

    const info = await fetchYandexUserInfo("ya-token-123");

    expect(info.email).toBe("user@yandex.ru");
    expect(info.name).toBe("Test User");

    // Verify OAuth header format
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("OAuth ya-token-123");
    // Ensure it's NOT Bearer
    expect(headers.Authorization).not.toContain("Bearer");
  });

  it("throws on error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(fetchYandexUserInfo("bad-token")).rejects.toThrow(
      "Yandex userinfo fetch failed (401)",
    );
  });
});

// ─── revokeYandexToken ───────────────────────────────────────────────

describe("revokeYandexToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw on failure (best-effort)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    // Should not throw
    await expect(revokeYandexToken("token", "cid", "csecret")).resolves.toBeUndefined();
  });
});
