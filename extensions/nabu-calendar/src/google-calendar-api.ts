import type { NabuStore } from "./store.js";
import type { GoogleCalendarEventInput, GoogleCalendarEvent } from "./types.js";
import { refreshAccessToken, InvalidGrantError } from "./google-auth.js";

// ─── Types ─────────────────────────────────────────────────────────

interface GcalFetchResult<T = unknown> {
  ok: true;
  data: T;
}

interface GcalFetchError {
  ok: false;
  error: string;
  message: string;
  needsReauth?: boolean;
}

type GcalResult<T = unknown> = GcalFetchResult<T> | GcalFetchError;

interface EventListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
}

// ─── Constants ─────────────────────────────────────────────────────

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";

// ─── Token Management ──────────────────────────────────────────────

/**
 * Ensure we have a valid access token. Refreshes if expired.
 * Returns the valid token or a needsReauth error.
 */
export async function ensureValidToken(
  store: NabuStore,
  chatId: number,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string } | GcalFetchError> {
  const config = store.get(chatId);
  if (!config || !config.googleCalendarConnected) {
    return {
      ok: false,
      error: "not_connected",
      message: "Google Calendar not connected",
      needsReauth: true,
    };
  }

  if (!config.googleRefreshToken) {
    return {
      ok: false,
      error: "no_refresh_token",
      message: "No refresh token available",
      needsReauth: true,
    };
  }

  // Check if token is still valid (with 60s buffer)
  if (config.googleAccessToken && config.googleAccessTokenExpiresAt) {
    if (config.googleAccessTokenExpiresAt > Date.now() + 60_000) {
      return { accessToken: config.googleAccessToken };
    }
  }

  // Token expired — refresh
  try {
    const refreshed = await refreshAccessToken(config.googleRefreshToken, clientId, clientSecret);
    // IMPORTANT: never overwrite existing refreshToken with undefined
    store.update(chatId, {
      googleAccessToken: refreshed.accessToken,
      googleAccessTokenExpiresAt: refreshed.expiresAt,
    });
    return { accessToken: refreshed.accessToken };
  } catch (err) {
    if (err instanceof InvalidGrantError) {
      // Refresh token revoked — clear connection state
      store.update(chatId, {
        googleCalendarConnected: false,
        googleAccessToken: undefined,
        googleAccessTokenExpiresAt: undefined,
        consentMode: "read_only",
      });
      return {
        ok: false,
        error: "invalid_grant",
        message: "Google access revoked. Please reconnect.",
        needsReauth: true,
      };
    }
    throw err;
  }
}

// ─── Low-level Fetch ───────────────────────────────────────────────

/**
 * Make an authenticated request to Google Calendar API.
 * Handles 401 retry (once), structured errors for 403/404/429.
 */
export async function gcalFetch<T = unknown>(
  store: NabuStore,
  chatId: number,
  apiPath: string,
  method: string,
  clientId: string,
  clientSecret: string,
  body?: unknown,
): Promise<GcalResult<T>> {
  const tokenResult = await ensureValidToken(store, chatId, clientId, clientSecret);
  if ("ok" in tokenResult && !tokenResult.ok) return tokenResult;
  if (!("accessToken" in tokenResult)) return tokenResult;

  let accessToken = tokenResult.accessToken;

  const doFetch = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    return fetch(`${GCAL_BASE}${apiPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  let response = await doFetch(accessToken);

  // On 401: try refreshing once
  if (response.status === 401) {
    const config = store.get(chatId);
    if (config?.googleRefreshToken) {
      try {
        const refreshed = await refreshAccessToken(
          config.googleRefreshToken,
          clientId,
          clientSecret,
        );
        store.update(chatId, {
          googleAccessToken: refreshed.accessToken,
          googleAccessTokenExpiresAt: refreshed.expiresAt,
        });
        accessToken = refreshed.accessToken;
        response = await doFetch(accessToken);
      } catch (err) {
        if (err instanceof InvalidGrantError) {
          store.update(chatId, {
            googleCalendarConnected: false,
            googleAccessToken: undefined,
            googleAccessTokenExpiresAt: undefined,
            consentMode: "read_only",
          });
          return {
            ok: false,
            error: "invalid_grant",
            message: "Google access revoked. Please reconnect.",
            needsReauth: true,
          };
        }
        throw err;
      }
    }
  }

  // Handle error status codes
  if (!response.ok) {
    if (response.status === 403) {
      return {
        ok: false,
        error: "forbidden",
        message: "No permission to modify this event (not the organizer?)",
      };
    }
    if (response.status === 404) {
      return { ok: false, error: "not_found", message: "Event not found (may have been deleted)" };
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      return {
        ok: false,
        error: "rate_limited",
        message: `Google API rate limited${retryAfter ? `. Retry after ${retryAfter}s` : ""}`,
      };
    }
    const errorBody = await response.text();
    return {
      ok: false,
      error: "api_error",
      message: `Google Calendar API error (${response.status}): ${errorBody.slice(0, 200)}`,
    };
  }

  // DELETE returns 204 with no body
  if (response.status === 204 || method === "DELETE") {
    return { ok: true, data: {} as T };
  }

  const data = await response.json();
  return { ok: true, data: data as T };
}

// ─── CRUD Operations ───────────────────────────────────────────────

/**
 * Create a calendar event.
 * If idempotencyKey is provided, checks for existing event with that key first.
 */
export async function createEvent(
  store: NabuStore,
  chatId: number,
  event: GoogleCalendarEventInput,
  clientId: string,
  clientSecret: string,
  idempotencyKey?: string,
): Promise<GcalResult<GoogleCalendarEvent>> {
  // Idempotency check: if key provided, search for existing
  if (idempotencyKey) {
    const existing = await searchByIdempotencyKey(
      store,
      chatId,
      idempotencyKey,
      clientId,
      clientSecret,
    );
    if (existing.ok && existing.data) {
      return {
        ok: true,
        data: { ...existing.data, _alreadyExists: true } as GoogleCalendarEvent & {
          _alreadyExists: boolean;
        },
      };
    }
  }

  // Add idempotency key to extended properties
  if (idempotencyKey) {
    event = {
      ...event,
      extendedProperties: {
        ...event.extendedProperties,
        private: {
          ...event.extendedProperties?.private,
          nabuIdempotencyKey: idempotencyKey,
        },
      },
    };
  }

  return gcalFetch<GoogleCalendarEvent>(
    store,
    chatId,
    "/calendars/primary/events",
    "POST",
    clientId,
    clientSecret,
    event,
  );
}

/**
 * Update a calendar event by ID.
 */
export async function updateEvent(
  store: NabuStore,
  chatId: number,
  eventId: string,
  updates: Partial<GoogleCalendarEventInput>,
  clientId: string,
  clientSecret: string,
): Promise<GcalResult<GoogleCalendarEvent>> {
  return gcalFetch<GoogleCalendarEvent>(
    store,
    chatId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    "PATCH",
    clientId,
    clientSecret,
    updates,
  );
}

/**
 * Delete a calendar event by ID.
 * Returns ok:true even if already deleted (idempotent).
 */
export async function deleteEvent(
  store: NabuStore,
  chatId: number,
  eventId: string,
  clientId: string,
  clientSecret: string,
): Promise<GcalResult<{ deleted: boolean; alreadyDeleted?: boolean }>> {
  const result = await gcalFetch<Record<string, never>>(
    store,
    chatId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    "DELETE",
    clientId,
    clientSecret,
  );

  if (!result.ok && result.error === "not_found") {
    // Event already deleted — idempotent success
    return { ok: true, data: { deleted: true, alreadyDeleted: true } };
  }

  if (result.ok) {
    return { ok: true, data: { deleted: true } };
  }

  return result as GcalFetchError;
}

/**
 * Search events by query string and optional time range.
 * Returns up to maxResults (default 5) candidates.
 */
export async function searchEvents(
  store: NabuStore,
  chatId: number,
  query: string,
  clientId: string,
  clientSecret: string,
  timeMin?: string,
  timeMax?: string,
  maxResults = 5,
): Promise<GcalResult<GoogleCalendarEvent[]>> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });

  if (timeMin) params.set("timeMin", timeMin);
  if (timeMax) params.set("timeMax", timeMax);

  const result = await gcalFetch<EventListResponse>(
    store,
    chatId,
    `/calendars/primary/events?${params.toString()}`,
    "GET",
    clientId,
    clientSecret,
  );

  if (!result.ok) return result;
  return { ok: true, data: result.data.items || [] };
}

/**
 * Search for an event by its nabuIdempotencyKey extended property.
 * Returns the event if found, null if not.
 */
export async function searchByIdempotencyKey(
  store: NabuStore,
  chatId: number,
  key: string,
  clientId: string,
  clientSecret: string,
): Promise<GcalResult<GoogleCalendarEvent | null>> {
  const params = new URLSearchParams({
    privateExtendedProperty: `nabuIdempotencyKey=${key}`,
    maxResults: "1",
    singleEvents: "true",
  });

  const result = await gcalFetch<EventListResponse>(
    store,
    chatId,
    `/calendars/primary/events?${params.toString()}`,
    "GET",
    clientId,
    clientSecret,
  );

  if (!result.ok) return result;
  const items = result.data.items || [];
  return { ok: true, data: items.length > 0 ? items[0]! : null };
}

/**
 * Get a single event by ID (for recurring check, past-event check, etc.)
 */
export async function getEvent(
  store: NabuStore,
  chatId: number,
  eventId: string,
  clientId: string,
  clientSecret: string,
): Promise<GcalResult<GoogleCalendarEvent>> {
  return gcalFetch<GoogleCalendarEvent>(
    store,
    chatId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    "GET",
    clientId,
    clientSecret,
  );
}
