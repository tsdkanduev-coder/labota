import * as crypto from "node:crypto";
import { generateCodeVerifier, generateCodeChallenge, OAuthStateManager } from "./google-auth.js";

// ─── Types ─────────────────────────────────────────────────────────

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

interface UserInfo {
  email: string;
  name?: string;
}

// ─── Constants ─────────────────────────────────────────────────────

const YANDEX_AUTH_URL = "https://oauth.yandex.ru/authorize";
const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
const YANDEX_USERINFO_URL = "https://login.yandex.ru/info?format=json";
const YANDEX_REVOKE_URL = "https://oauth.yandex.ru/revoke_token";

const YANDEX_OAUTH_SCOPE = "calendar:all login:email";
const STATE_TTL_MS = 10 * 60_000; // 10 minutes

// ─── OAuth Functions ───────────────────────────────────────────────

/**
 * Build Yandex OAuth authorization URL with PKCE.
 */
export function buildYandexAuthUrl(
  chatId: number,
  baseUrl: string,
  clientId: string,
  stateManager: OAuthStateManager,
): { authUrl: string; state: string } {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Reuse OAuthStateManager — state is a random hex string
  const state = crypto.randomBytes(32).toString("hex");

  stateManager.save(state, {
    chatId,
    codeVerifier,
    expiresAt: Date.now() + STATE_TTL_MS,
    provider: "yandex",
  });

  const redirectUri = `${baseUrl}/plugins/nabu-calendar/oauth/yandex/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: YANDEX_OAUTH_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    force_confirm: "yes", // always show consent screen
  });

  return {
    authUrl: `${YANDEX_AUTH_URL}?${params.toString()}`,
    state,
  };
}

/**
 * Exchange authorization code for tokens (with PKCE code_verifier).
 */
export async function exchangeYandexCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  const response = await fetch(YANDEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Yandex token exchange failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshYandexAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch(YANDEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    // Check for invalid_grant (revoked or expired refresh token)
    if (response.status === 400 && errorBody.includes("invalid_grant")) {
      throw new InvalidYandexGrantError("Yandex refresh token is invalid or revoked");
    }
    throw new Error(`Yandex token refresh failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Fetch user info (email, name) from Yandex.
 * Note: Yandex uses "Authorization: OAuth {token}", NOT "Bearer".
 */
export async function fetchYandexUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch(YANDEX_USERINFO_URL, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Yandex userinfo fetch failed (${response.status})`);
  }

  const data = (await response.json()) as {
    default_email: string;
    display_name?: string;
  };

  return {
    email: data.default_email,
    name: data.display_name,
  };
}

/**
 * Revoke a Yandex token (access or refresh).
 * Best-effort — does not throw on failure.
 */
export async function revokeYandexToken(
  token: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  try {
    await fetch(YANDEX_REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        access_token: token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch {
    // Best-effort — token might already be revoked
  }
}

// ─── Custom Errors ─────────────────────────────────────────────────

export class InvalidYandexGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidYandexGrantError";
  }
}
