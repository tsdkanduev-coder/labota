import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ─────────────────────────────────────────────────────────

interface PendingOAuthState {
  chatId: number;
  codeVerifier: string;
  expiresAt: number; // epoch ms
}

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

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const OAUTH_SCOPE = "https://www.googleapis.com/auth/calendar.events openid email";
const STATE_TTL_MS = 10 * 60_000; // 10 minutes

// ─── PKCE Helpers ──────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ─── Pending State Persistence ─────────────────────────────────────

/**
 * Manages pending OAuth states in a JSON file.
 * Survives Render restarts. Atomic writes (write-tmp-rename).
 * Expired states are cleaned on every read.
 */
export class OAuthStateManager {
  private readonly filePath: string;

  constructor(stateDir: string) {
    const dir = path.join(stateDir, "nabu-calendar");
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, "oauth-pending.json");
  }

  private read(): Record<string, PendingOAuthState> {
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      if (typeof raw !== "object" || raw === null) return {};

      // Clean expired states
      const now = Date.now();
      const cleaned: Record<string, PendingOAuthState> = {};
      let hasExpired = false;
      for (const [key, value] of Object.entries(raw)) {
        const state = value as PendingOAuthState;
        if (state.expiresAt > now) {
          cleaned[key] = state;
        } else {
          hasExpired = true;
        }
      }

      // Write back if we cleaned any
      if (hasExpired) {
        this.write(cleaned);
      }

      return cleaned;
    } catch {
      return {};
    }
  }

  private write(states: Record<string, PendingOAuthState>): void {
    const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(states, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }

  save(state: string, data: PendingOAuthState): void {
    const states = this.read();
    states[state] = data;
    this.write(states);
  }

  resolve(state: string): PendingOAuthState | null {
    const states = this.read();
    const data = states[state];
    if (!data) return null;
    if (data.expiresAt < Date.now()) {
      // Expired — clean up
      delete states[state];
      this.write(states);
      return null;
    }
    // One-time use — remove after resolve
    delete states[state];
    this.write(states);
    return data;
  }
}

// ─── OAuth Functions ───────────────────────────────────────────────

/**
 * Build Google OAuth authorization URL with PKCE.
 */
export function buildAuthUrl(
  chatId: number,
  baseUrl: string,
  clientId: string,
  stateManager: OAuthStateManager,
): { authUrl: string; state: string } {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(32).toString("hex");

  // Persist state for callback resolution
  stateManager.save(state, {
    chatId,
    codeVerifier,
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const redirectUri = `${baseUrl}/plugins/nabu-calendar/oauth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    state,
  };
}

/**
 * Exchange authorization code for tokens (with PKCE code_verifier).
 */
export async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // May be undefined
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Refresh an access token using a refresh token.
 * Returns new access token + expiry. Does NOT return a new refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    // Check for invalid_grant specifically (revoked or expired refresh token)
    if (response.status === 400 && errorBody.includes("invalid_grant")) {
      throw new InvalidGrantError("Refresh token is invalid or revoked");
    }
    throw new Error(`Token refresh failed (${response.status}): ${errorBody}`);
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
 * Fetch user info (email, name) from Google.
 * Requires `openid email` scope.
 */
export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Userinfo fetch failed (${response.status})`);
  }

  const data = (await response.json()) as { email: string; name?: string };
  return { email: data.email, name: data.name };
}

/**
 * Revoke a token (access or refresh).
 */
export async function revokeToken(token: string): Promise<void> {
  const response = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });

  // Google returns 200 on success, but we don't fail on error
  // (token might already be revoked)
  if (!response.ok) {
    // Log but don't throw — revoke is best-effort
  }
}

// ─── Custom Errors ─────────────────────────────────────────────────

export class InvalidGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGrantError";
  }
}
