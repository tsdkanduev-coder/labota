import type { VEvent } from "node-ical";
import { DateTime } from "luxon";
import * as ical from "node-ical";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CalendarEvent, FetchResult, FetchState } from "./types.js";
import { computeDiff } from "./ics-diff.js";
import {
  extractAttendees,
  extractOrganizer,
  mapStatus,
  mapTransparency,
  toISO,
} from "./ics-helpers.js";
import { expandRecurring } from "./ics-recurring.js";
import { FetchStateSchema } from "./types.js";

// ─── Constants ──────────────────────────────────────────────────

const MAX_BODY_SIZE = 5 * 1024 * 1024; // D7: 5MB limit
const FETCH_TIMEOUT_MS = 15_000; // 15s
const SETUP_TIMEOUT_MS = 10_000; // 10s for initial setup fetch

/** Backoff delays by consecutive error count: 1→60s, 2→300s, 3→900s, 4+→3600s */
const BACKOFF_DELAYS_S = [0, 60, 300, 900, 3600];

/** Expansion window: 7 days back, 90 days forward */
const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 90;

// ─── IcsFetcher ─────────────────────────────────────────────────

/**
 * Fetches and parses .ics feeds with:
 * - ETag / If-None-Match conditional requests
 * - Exponential backoff on errors
 * - 5MB body size limit
 * - RRULE expansion for recurring events
 * - Diff computation against previous fetch
 * - File-based state persistence
 */
export class IcsFetcher {
  private readonly fetchDir: string;

  constructor(stateDir: string) {
    this.fetchDir = path.join(stateDir, "nabu-calendar", "fetch");
    fs.mkdirSync(this.fetchDir, { recursive: true });
  }

  /**
   * Fetch .ics feed, parse events, compute diff.
   *
   * @param isSetup - If true, uses shorter timeout (10s) for initial setup
   */
  async fetch(
    chatId: number,
    icsUrl: string,
    timezone: string,
    isSetup = false,
  ): Promise<FetchResult> {
    const state = this.loadState(chatId);
    const now = DateTime.now();

    // 1. Backoff check
    if (
      state.consecutiveErrors > 0 &&
      state.nextRetryAt &&
      now < DateTime.fromISO(state.nextRetryAt)
    ) {
      return {
        events: state.lastEvents ?? [],
        diff: null,
        notModified: false,
        stale: true,
        source: "backoff",
        fetchedAt: now.toISO()!,
      };
    }

    // 2. HTTP fetch
    const timeoutMs = isSetup ? SETUP_TIMEOUT_MS : FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "text/calendar, application/calendar+xml;q=0.9, */*;q=0.1",
        "User-Agent": "NabuCalendar/1.0",
      };
      if (state.etag) {
        headers["If-None-Match"] = state.etag;
      }
      if (state.lastModified) {
        headers["If-Modified-Since"] = state.lastModified;
      }

      const response = await fetch(icsUrl, {
        headers,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      // 3. Handle 304 Not Modified
      if (response.status === 304) {
        return {
          events: state.lastEvents ?? [],
          diff: null,
          notModified: true,
          stale: false,
          source: "cache",
          fetchedAt: now.toISO()!,
        };
      }

      // 4. Handle errors
      if (!response.ok) {
        return this.handleFetchError(chatId, state, now, `HTTP ${response.status}`);
      }

      // 5. Read body with size limit (D7)
      const body = await this.readBodyWithLimit(response);

      // 6. Parse ICS
      const parsed = await ical.async.parseICS(body);

      // 7. Convert to CalendarEvent[]
      const windowStart = now.minus({ days: WINDOW_PAST_DAYS });
      const windowEnd = now.plus({ days: WINDOW_FUTURE_DAYS });
      const events = this.convertEvents(parsed, windowStart, windowEnd, timezone);

      // 8. Compute diff
      const diff = state.lastEvents != null ? computeDiff(state.lastEvents, events) : null;

      // 9. Save state
      const newState: FetchState = {
        lastFetchAt: now.toISO()!,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        lastEvents: events,
        consecutiveErrors: 0,
        nextRetryAt: undefined,
      };
      this.saveState(chatId, newState);

      return {
        events,
        diff,
        notModified: false,
        stale: false,
        source: "network",
        fetchedAt: now.toISO()!,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const message =
        err instanceof Error
          ? err.name === "AbortError"
            ? `Timeout after ${timeoutMs}ms`
            : err.message
          : String(err);
      return this.handleFetchError(chatId, state, now, message);
    }
  }

  /** Get cached events without network request. */
  getCached(chatId: number): CalendarEvent[] | null {
    const state = this.loadState(chatId);
    return state.lastEvents ?? null;
  }

  /** Reset fetch state for a chat (e.g., on URL change). */
  reset(chatId: number): void {
    const filePath = this.stateFilePath(chatId);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  // ─── Internal helpers ───────────────────────────────────────

  /**
   * Read response body with 5MB size limit.
   * Aborts if body exceeds MAX_BODY_SIZE.
   */
  private async readBodyWithLimit(response: Response): Promise<string> {
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      throw new Error(`ICS feed too large: ${contentLength} bytes (limit: ${MAX_BODY_SIZE})`);
    }

    // Stream-read with byte counting
    const reader = response.body?.getReader();
    if (!reader) {
      // Fallback: read as text (e.g., in test environments)
      return response.text();
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_SIZE) {
        reader.cancel();
        throw new Error(`ICS feed too large: ${totalBytes}+ bytes (limit: ${MAX_BODY_SIZE})`);
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder();
    return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
  }

  /**
   * Convert parsed ICS data to CalendarEvent[].
   * Handles both non-recurring and recurring events.
   */
  private convertEvents(
    parsed: Record<string, ical.CalendarComponent>,
    windowStart: DateTime,
    windowEnd: DateTime,
    timezone: string,
  ): CalendarEvent[] {
    const events: CalendarEvent[] = [];

    for (const [, component] of Object.entries(parsed)) {
      if (component.type !== "VEVENT") continue;

      const vevent = component as VEvent;

      // Recurring event → expand
      if (vevent.rrule) {
        const expanded = expandRecurring(vevent, windowStart, windowEnd, timezone);
        events.push(...expanded);
        continue;
      }

      // Non-recurring event
      if (!vevent.start) continue;

      const isAllDay = vevent.datetype === "date";
      const start = toISO(vevent.start as Date & { tz?: string }, timezone, isAllDay);
      const end = vevent.end
        ? toISO(vevent.end as Date & { tz?: string }, timezone, isAllDay)
        : start;

      const startDt = DateTime.fromISO(start);
      const endDt = DateTime.fromISO(end);

      // Filter by window
      if (endDt < windowStart || startDt > windowEnd) continue;

      events.push({
        uid: vevent.uid || `unknown-${Date.now()}-${Math.random()}`,
        summary: vevent.summary || "",
        start,
        end,
        location: vevent.location || undefined,
        description: vevent.description || undefined,
        status: mapStatus(vevent.status as string | undefined),
        transparency: mapTransparency(vevent.transparency as string | undefined),
        attendees: extractAttendees(vevent.attendee),
        organizer: extractOrganizer(vevent.organizer),
        recurrenceId: vevent.recurrenceid
          ? toISO(vevent.recurrenceid as unknown as Date & { tz?: string }, timezone, isAllDay)
          : undefined,
        isRecurring: false,
        allDay: isAllDay,
      });
    }

    // Sort by start time
    events.sort((a, b) => a.start.localeCompare(b.start));

    return events;
  }

  /**
   * Handle fetch error: increment backoff, return cached data.
   * D5: notModified = false in all error paths.
   */
  private handleFetchError(
    chatId: number,
    state: FetchState,
    now: DateTime,
    errorMessage: string,
  ): FetchResult {
    const errors = (state.consecutiveErrors ?? 0) + 1;
    const delayIndex = Math.min(errors, BACKOFF_DELAYS_S.length - 1);
    const delaySec = BACKOFF_DELAYS_S[delayIndex]!;

    const newState: FetchState = {
      ...state,
      consecutiveErrors: errors,
      nextRetryAt: now.plus({ seconds: delaySec }).toISO()!,
    };
    this.saveState(chatId, newState);

    return {
      events: state.lastEvents ?? [],
      diff: null,
      notModified: false,
      stale: true,
      source: "backoff",
      fetchedAt: now.toISO()!,
    };
  }

  // ─── State persistence ──────────────────────────────────────

  private loadState(chatId: number): FetchState {
    const filePath = this.stateFilePath(chatId);
    try {
      if (fs.existsSync(filePath)) {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return FetchStateSchema.parse(raw);
      }
    } catch {
      // Corrupted file → treat as fresh
    }
    return {
      consecutiveErrors: 0,
    };
  }

  private saveState(chatId: number, state: FetchState): void {
    const filePath = this.stateFilePath(chatId);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  }

  private stateFilePath(chatId: number): string {
    return path.join(this.fetchDir, `${chatId}.json`);
  }
}
