import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { DateTime } from "luxon";
import * as crypto from "node:crypto";
import type { CalendarEvent, CalendarSnapshot } from "./src/types.js";
import { nabuCalendarConfigParser, resolveConfig, validateConfig } from "./src/config.js";
import {
  OAuthStateManager,
  buildAuthUrl,
  exchangeCode,
  fetchUserInfo,
  revokeToken,
} from "./src/google-auth.js";
import {
  ensureValidToken,
  createEvent as gcalCreateEvent,
  updateEvent as gcalUpdateEvent,
  deleteEvent as gcalDeleteEvent,
  searchEvents as gcalSearchEvents,
  getEvent as gcalGetEvent,
} from "./src/google-calendar-api.js";
import { IcsFetcher } from "./src/ics-fetcher.js";
import { filterByDate, filterByRange, findFreeSlots } from "./src/ics-helpers.js";
import { NabuLedger } from "./src/ledger.js";
import { NabuStore } from "./src/store.js";

// ─── Google OAuth Config ────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "";
const CONFIRM_SECRET = process.env.NABU_CONFIRM_SECRET || "";
const BASE_URL = process.env.OPENCLAW_BASE_URL || "https://openclaw-1zxd.onrender.com";

// ─── Allowed .ics hosts ──────────────────────────────────────────
// P2 fix: host allowlist for URL validation

const ICS_HOST_ALLOWLIST = new Set([
  "calendar.google.com",
  "outlook.office365.com",
  "outlook.live.com",
  "caldav.icloud.com",
  "p.calendar.yahoo.com",
  "calendar.yahoo.com",
  "fastmail.com",
  "cloud.timeedit.net",
]);

function isAllowedIcsHost(hostname: string): boolean {
  // Allow exact match
  if (ICS_HOST_ALLOWLIST.has(hostname)) return true;
  // Allow subdomains of allowed hosts (e.g., p68-caldav.icloud.com)
  for (const allowed of ICS_HOST_ALLOWLIST) {
    if (hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

// ─── Tool Schema ─────────────────────────────────────────────────
// P1 fix: flat object with discriminator instead of root Type.Union.
// Vertex AI / OpenAI reject anyOf at root level.

const NabuCalendarToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("setup"),
      Type.Literal("fetch"),
      Type.Literal("find_slots"),
      Type.Literal("handle_callback"),
      Type.Literal("record_incident"),
      Type.Literal("status"),
      Type.Literal("disable"),
      // P2: Write-ops actions
      Type.Literal("auth"),
      Type.Literal("search_events"),
      Type.Literal("create_event"),
      Type.Literal("update_event"),
      Type.Literal("delete_event"),
      // Per-user memory actions (multi-user isolation)
      Type.Literal("save_note"),
      Type.Literal("get_notes"),
    ],
    { description: "Action to perform" },
  ),
  // setup
  icsUrl: Type.Optional(Type.String({ description: "Calendar .ics feed URL (for setup)" })),
  timezone: Type.Optional(
    Type.String({ description: 'Timezone, e.g. "Europe/Moscow" (for setup)' }),
  ),
  // fetch
  date: Type.Optional(Type.String({ description: 'ISO date or "today"/"tomorrow" (for fetch)' })),
  from: Type.Optional(Type.String({ description: "ISO date range start (for fetch)" })),
  to: Type.Optional(Type.String({ description: "ISO date range end (for fetch)" })),
  // find_slots
  durationMin: Type.Optional(
    Type.Number({ description: "Desired slot duration in minutes (for find_slots)" }),
  ),
  // record_incident
  trigger: Type.Optional(
    Type.String({
      description: "What triggered this incident, e.g. 'periodic-sync-diff' (for record_incident)",
    }),
  ),
  textSnippet: Type.Optional(
    Type.String({ description: "Short text of the proactive message sent (for record_incident)" }),
  ),
  // handle_callback
  callbackAction: Type.Optional(
    Type.String({
      description:
        'Callback action: "ack", "dismiss", "plan", "remind", "context" (for handle_callback)',
    }),
  ),
  incidentId: Type.Optional(Type.String({ description: "Incident ID (for handle_callback)" })),
  reminderMinutes: Type.Optional(
    Type.Number({ description: "Minutes before event to remind (for handle_callback remind)" }),
  ),
  // P2: Write-ops parameters
  summary: Type.Optional(Type.String({ description: "Event title (for create/update)" })),
  startDateTime: Type.Optional(
    Type.String({ description: "Event start ISO datetime (for create/update)" }),
  ),
  endDateTime: Type.Optional(
    Type.String({
      description: "Event end ISO datetime (for create/update). Defaults to start + 60 min",
    }),
  ),
  eventLocation: Type.Optional(Type.String({ description: "Event location (for create/update)" })),
  eventDescription: Type.Optional(
    Type.String({ description: "Event description (for create/update)" }),
  ),
  attendees: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Email addresses of attendees to invite (for create/update). Example: ["wife@gmail.com"]',
    }),
  ),
  place: Type.Optional(Type.String({ description: "Alias for eventLocation (for create/update)" })),
  eventId: Type.Optional(
    Type.String({ description: "Google Calendar event ID (for update/delete)" }),
  ),
  searchQuery: Type.Optional(
    Type.String({ description: "Search query for finding events (for search_events)" }),
  ),
  searchDate: Type.Optional(
    Type.String({ description: "Date to search around, ISO date (for search_events)" }),
  ),
  confirmed: Type.Optional(Type.Boolean({ description: "Confirm a previewed write operation" })),
  confirmToken: Type.Optional(
    Type.String({ description: "HMAC token from preview step (required with confirmed=true)" }),
  ),
  idempotencyKey: Type.Optional(
    Type.String({
      description: "Idempotency key from preview step (required with confirmed=true)",
    }),
  ),
  expiresAt: Type.Optional(
    Type.Number({
      description: "Expiration timestamp from preview step (required with confirmed=true)",
    }),
  ),
  // Per-user memory
  note: Type.Optional(
    Type.String({
      description:
        "A brief observation about the user to remember (for save_note). " +
        "Examples: schedule preferences, VIP contacts, behavioral patterns.",
    }),
  ),
});

// ─── Plugin ──────────────────────────────────────────────────────

const nabuCalendarPlugin = {
  id: "nabu-calendar",
  name: "Nabu Calendar",
  description: "AI-powered calendar brief bot for Telegram",
  configSchema: nabuCalendarConfigParser,

  register(api: OpenClawPluginApi) {
    const rawConfig = nabuCalendarConfigParser.parse(api.pluginConfig);
    const config = resolveConfig(rawConfig);
    const validation = validateConfig(config);

    if (validation.errors.length > 0) {
      for (const err of validation.errors) {
        api.logger.warn(`[nabu-calendar] Config warning: ${err}`);
      }
    }

    // ─── Shared state ──────────────────────────────────────────
    // P1 fix: single stateDir source. Service sets it on start,
    // tool handlers use the same variable. No env/home fallback split.

    let resolvedStateDir: string | null = null;
    let store: NabuStore | null = null;
    let ledger: NabuLedger | null = null;
    let fetcher: IcsFetcher | null = null;

    const getStateDir = (): string => {
      if (!resolvedStateDir) {
        throw new Error(
          "[nabu-calendar] stateDir not initialized — service.start() must run before tool calls",
        );
      }
      return resolvedStateDir;
    };

    const ensureStore = (): NabuStore => {
      if (!store) store = new NabuStore(getStateDir());
      return store;
    };

    const ensureLedger = (): NabuLedger => {
      if (!ledger) ledger = new NabuLedger(getStateDir());
      return ledger;
    };

    const ensureFetcher = (): IcsFetcher => {
      if (!fetcher) fetcher = new IcsFetcher(getStateDir());
      return fetcher;
    };

    let oauthStateManager: OAuthStateManager | null = null;
    const ensureOAuthStateManager = (): OAuthStateManager => {
      if (!oauthStateManager) oauthStateManager = new OAuthStateManager(getStateDir());
      return oauthStateManager;
    };

    // ─── P2: Attendees helpers ──────────────────────────────────

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function canonicalizeAttendees(emails?: string[]): string[] | undefined {
      if (!emails || emails.length === 0) return undefined;
      return [...new Set(emails.map((e) => e.trim().toLowerCase()))].sort();
    }

    // ─── P2: HMAC Confirm Token ────────────────────────────────

    function generateConfirmToken(payload: Record<string, unknown>): string {
      const data = JSON.stringify(payload);
      return crypto.createHmac("sha256", CONFIRM_SECRET).update(data).digest("hex");
    }

    function verifyConfirmToken(token: string, payload: Record<string, unknown>): boolean {
      try {
        const expected = generateConfirmToken(payload);
        if (token.length !== expected.length) return false;
        // Validate hex before comparing — malformed hex produces shorter buffers
        if (!/^[\da-f]+$/i.test(token)) return false;
        return crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
      } catch {
        // Malformed token (e.g., non-hex chars slipping through, odd length)
        return false;
      }
    }

    // ─── P2: Write-ops rate limit ──────────────────────────────

    function checkAndIncrementRateLimit(chatId: number): { ok: boolean; error?: string } {
      const s = ensureStore();
      const cfg = s.get(chatId);
      if (!cfg) return { ok: false, error: "not_configured" };

      const currentHour = new Date().toISOString().slice(0, 13); // "2026-03-02T15"
      let count = cfg.writeOpsHourCount;
      const resetHour = cfg.writeOpsHourReset;

      // Reset counter if hour changed
      if (resetHour !== currentHour) {
        count = 0;
      }

      if (count >= 10) {
        return { ok: false, error: "rate_limit" };
      }

      s.update(chatId, {
        writeOpsHourCount: count + 1,
        writeOpsHourReset: currentHour,
      });

      return { ok: true };
    }

    // ─── P2: OAuth Callback HTTP Route ─────────────────────────

    api.registerHttpRoute({
      path: "/plugins/nabu-calendar/oauth/callback",
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || "", `https://${req.headers.host}`);
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              `<html><body><h2>Authorization failed</h2><p>Error: ${error}</p><p>Return to Telegram and try again.</p></body></html>`,
            );
            return;
          }

          if (!code || !state) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              `<html><body><h2>Invalid request</h2><p>Missing code or state parameter.</p></body></html>`,
            );
            return;
          }

          const stateManager = ensureOAuthStateManager();
          const pendingState = stateManager.resolve(state);

          if (!pendingState) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              `<html><body><h2>Link expired</h2><p>Authorization link has expired or was already used. Return to Telegram and request a new link.</p></body></html>`,
            );
            return;
          }

          const redirectUri = `${BASE_URL}/plugins/nabu-calendar/oauth/callback`;
          const tokens = await exchangeCode(
            code,
            pendingState.codeVerifier,
            redirectUri,
            GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET,
          );

          // Fetch user info to show which account was connected
          let userInfo: { email: string; name?: string } | null = null;
          try {
            userInfo = await fetchUserInfo(tokens.accessToken);
          } catch (e) {
            api.logger.warn(
              `[nabu-calendar] Failed to fetch userinfo: ${e instanceof Error ? e.message : String(e)}`,
            );
          }

          const email = userInfo?.email || "unknown";

          // Update store with tokens
          const s = ensureStore();
          const existingConfig = s.get(pendingState.chatId);
          if (existingConfig) {
            s.update(pendingState.chatId, {
              googleAccessToken: tokens.accessToken,
              googleRefreshToken: tokens.refreshToken ?? existingConfig.googleRefreshToken,
              googleAccessTokenExpiresAt: tokens.expiresAt,
              googleCalendarConnected: true,
              googleEmail: email,
              writeEnabled: true,
              consentMode: "act_with_confirmation",
            });
          }

          // Notify user in Telegram
          try {
            const sendMsg = (
              api as unknown as {
                runtime?: {
                  channel?: {
                    telegram?: {
                      sendMessageTelegram?: (to: string, text: string) => Promise<unknown>;
                    };
                  };
                };
              }
            ).runtime?.channel?.telegram?.sendMessageTelegram;
            if (sendMsg) {
              await sendMsg(
                String(pendingState.chatId),
                `Google Calendar connected (account: ${email}). I can now create and modify events.`,
              );
            }
          } catch (e) {
            api.logger.warn(
              `[nabu-calendar] Failed to send Telegram notification: ${e instanceof Error ? e.message : String(e)}`,
            );
          }

          api.logger.info(
            `[nabu-calendar] OAuth complete for chat ${pendingState.chatId}, email=${email}`,
          );

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
            <h2>Done! ✓</h2>
            <p>Account <strong>${email}</strong> connected.</p>
            <p>Return to Telegram.</p>
          </body></html>`);
        } catch (err) {
          api.logger.error(
            `[nabu-calendar] OAuth callback error: ${err instanceof Error ? err.message : String(err)}`,
          );
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<html><body><h2>Server error</h2><p>Something went wrong. Please try again.</p></body></html>`,
          );
        }
      },
    });

    // ─── Register Tool ─────────────────────────────────────────

    api.registerTool((toolCtx) => {
      const chatId = extractChatId(toolCtx.messageTo);
      const messageTo = toolCtx.messageTo;

      return {
        name: "nabu_calendar",
        label: "Nabu Calendar",
        description:
          "Personal calendar assistant. Actions: setup (connect .ics feed), fetch (get events), find_slots (find free time), handle_callback (process button taps), record_incident (log a proactive message for dedup/cooldown), status, disable.",
        parameters: NabuCalendarToolSchema,

        async execute(_toolCallId, params) {
          try {
            switch (params.action) {
              case "setup":
                return await handleSetup(params, chatId, messageTo);
              case "fetch":
                return await handleFetch(params, chatId);
              case "find_slots":
                return await handleFindSlots(params, chatId);
              case "handle_callback":
                return await handleCallback(params, chatId);
              case "record_incident":
                return await handleRecordIncident(params, chatId);
              case "status":
                return await handleStatus(chatId);
              case "disable":
                return await handleDisable(chatId);
              // P2: Write-ops actions
              case "auth":
                return await handleAuth(chatId);
              case "search_events":
                return await handleSearchEvents(params, chatId);
              case "create_event":
                return await handleCreateEvent(params, chatId);
              case "update_event":
                return await handleUpdateEvent(params, chatId);
              case "delete_event":
                return await handleDeleteEvent(params, chatId);
              // Per-user memory actions
              case "save_note":
                return handleSaveNote(params, chatId);
              case "get_notes":
                return handleGetNotes(chatId);
              default:
                return textResult({ error: "Unknown action" });
            }
          } catch (err) {
            api.logger.error(
              `[nabu-calendar] Tool error: ${err instanceof Error ? err.message : String(err)}`,
            );
            return textResult({
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    });

    // ─── Register Service ──────────────────────────────────────

    api.registerService({
      id: "nabu-calendar",

      start: async (ctx) => {
        // P1 fix: store stateDir from service context — single source of truth
        resolvedStateDir = ctx.stateDir;

        if (!config.enabled) {
          api.logger.info("[nabu-calendar] Plugin disabled, skipping service start");
          return;
        }

        api.logger.info("[nabu-calendar] Service started");
        ensureStore();
        ensureLedger();
        ensureFetcher();
      },

      stop: async () => {
        api.logger.info("[nabu-calendar] Service stopped");
        store = null;
        ledger = null;
        fetcher = null;
      },
    });

    // ─── Tool Handlers ─────────────────────────────────────────

    async function handleSetup(
      params: { icsUrl?: string; timezone?: string },
      chatId: number | null,
      messageTo: string | undefined,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }
      if (!params.icsUrl) {
        return textResult({ error: "icsUrl is required for setup" });
      }

      const icsUrl = params.icsUrl.trim();

      // Validate URL (P2: https + host allowlist)
      let url: URL;
      try {
        url = new URL(icsUrl);
      } catch {
        return textResult({ error: "Invalid URL format" });
      }

      if (url.protocol !== "https:") {
        return textResult({ error: "Only HTTPS URLs are allowed for security" });
      }

      if (!isAllowedIcsHost(url.hostname)) {
        return textResult({
          error: `Host "${url.hostname}" is not in the allowlist. Supported: Google Calendar, Outlook, iCloud, Yahoo, Fastmail. Contact support to add other providers.`,
        });
      }

      const timezone = params.timezone?.trim() || config.timezone;
      const s = ensureStore();

      // Reset previous state for this chat (clean slate on reconnect)
      const f = ensureFetcher();
      f.reset(chatId);
      const l = ensureLedger();
      l.cleanup(chatId, 0); // Remove all existing incidents

      // Save config first (always succeeds) — D2: setup doesn't fail on fetch
      const userConfig = {
        chatId,
        icsUrl,
        timezone,
        morningBriefHour: config.morningBriefHour,
        eveningLookaheadHour: config.eveningLookaheadHour,
        syncIntervalMs: config.syncIntervalMs,
        writeEnabled: config.writeEnabled,
        createdAt: new Date().toISOString(),
        // P2: defaults for Google Calendar write-ops fields
        googleCalendarConnected: false,
        consentMode: "read_only" as const,
        writeOpsHourCount: 0,
        // Per-user memory
        userNotes: [],
      };

      s.set(chatId, userConfig);
      api.logger.info(`[nabu-calendar] Setup complete for chat ${chatId}, tz=${timezone}`);

      // Attempt initial fetch with timeout — D2: resilient, doesn't block setup
      let syncResult: {
        eventsFound: number;
        calendarSnapshot: CalendarSnapshot | null;
        syncStatus: string;
      };
      try {
        const f = ensureFetcher();
        const result = await f.fetch(chatId, icsUrl, timezone, true);
        const snapshot = generateSnapshot(result.events, timezone);
        syncResult = {
          eventsFound: result.events.length,
          calendarSnapshot: snapshot,
          syncStatus: result.stale ? "stale" : "ok",
        };
        api.logger.info(
          `[nabu-calendar] Initial fetch: ${result.events.length} events, source=${result.source}`,
        );
      } catch (err) {
        api.logger.warn(
          `[nabu-calendar] Initial fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        syncResult = {
          eventsFound: 0,
          calendarSnapshot: null,
          syncStatus: "pending",
        };
      }

      // Resolve delivery target for cron jobs
      const deliveryTarget = messageTo ? parseDeliveryTarget(messageTo) : undefined;

      // P1 fix: return proper OpenClaw cron job schema
      return textResult({
        ok: true,
        ...syncResult,
        cronJobs: [
          buildCronJob({
            name: `nabu-brief-morning-${chatId}`,
            schedule: { kind: "cron", expr: `0 ${config.morningBriefHour} * * *`, tz: timezone },
            message: [
              `Morning check for chat ${chatId}.`,
              `Call nabu_calendar with action="fetch" and date="today".`,
              `Analyze the day using the proactive model from your SKILL.md.`,
              `Check the "ledger" field: if ledger.inCooldown is true → reply "NO_REPLY".`,
              ``,
              `Message the user ONLY if at least one of these is true:`,
              `- There are VIP meetings today (CEO, C-level, important client, investor, board)`,
              `- There are scheduling conflicts between important events`,
              `- The day is overloaded (8+ meetings) or poorly structured (routine blocks prep time for key meetings)`,
              ``,
              `If you message — be brief (2-4 lines). Mention only what matters, propose concrete actions.`,
              `AFTER sending a message, call nabu_calendar with action="record_incident", incidentId="morning-check-<today's date>", trigger="morning-check", textSnippet=<your message>.`,
              `If nothing important — reply "NO_REPLY". A normal day with normal meetings = NO_REPLY.`,
              `Use the user's language (Russian if events are in Russian). Times in HH:MM, timezone: ${timezone}.`,
            ].join("\n"),
            delivery: deliveryTarget,
          }),
          buildCronJob({
            name: `nabu-evening-lookahead-${chatId}`,
            schedule: {
              kind: "cron",
              expr: `0 ${config.eveningLookaheadHour} * * *`,
              tz: timezone,
            },
            message: [
              `Evening lookahead for chat ${chatId}.`,
              `Call nabu_calendar with action="fetch" and date="tomorrow".`,
              `Analyze tomorrow using the proactive model from your SKILL.md.`,
              `Check the "ledger" field: if ledger.inCooldown is true → reply "NO_REPLY".`,
              ``,
              `Message the user ONLY if at least one of these is true:`,
              `- VIP meetings tomorrow (CEO, C-level, important client, investor, board)`,
              `- Scheduling conflicts between important events`,
              `- Overloaded or poorly structured day that needs action`,
              `- First meeting is unusually early (before 9:00) — warn so they plan their morning`,
              ``,
              `If you message — be brief (2-4 lines). Focus on what needs attention or preparation.`,
              `AFTER sending a message, call nabu_calendar with action="record_incident", incidentId="evening-lookahead-<tomorrow's date>", trigger="evening-lookahead", textSnippet=<your message>.`,
              `If nothing notable — reply "NO_REPLY". A normal day = NO_REPLY.`,
              `Use the user's language. Times in HH:MM, timezone: ${timezone}.`,
            ].join("\n"),
            delivery: deliveryTarget,
          }),
          buildCronJob({
            name: `nabu-sync-periodic-${chatId}`,
            schedule: { kind: "every", everyMs: config.syncIntervalMs },
            message: [
              `Periodic calendar sync for chat ${chatId}.`,
              `Call nabu_calendar with action="fetch" and date="today".`,
              `Check the "diff" field AND "ledger" field in the response. Apply the proactive model from your SKILL.md:`,
              ``,
              `- If diff is EMPTY or has NO added/modified/removed items → reply "NO_REPLY".`,
              `- If diff has changes but they are minor (routine sync shifted 15 min, description edit) → reply "NO_REPLY".`,
              `- If ledger.inCooldown is true → reply "NO_REPLY" (user recently interacted).`,
              `- If a change's event UID is in ledger.recentIncidentIds → reply "NO_REPLY" (already reported).`,
              `- If diff has IMPORTANT changes (VIP meeting added/cancelled/moved, new conflict with key event, significant schedule disruption) → send a SHORT alert (1-2 sentences).`,
              ``,
              `AFTER sending an alert, call nabu_calendar with action="record_incident", incidentId=<event UID or unique key>, trigger="periodic-sync", textSnippet=<your message text>.`,
              `This prevents duplicate alerts on the next sync.`,
              ``,
              `Examples of when to alert: "Petrov (CEO) added a 1:1 tomorrow at 9:00" or "Board review moved from 14:00 to 16:00 — conflicts with your flight".`,
              `Examples of NO_REPLY: routine standup moved 15 min, team sync description updated, lunch block shifted.`,
              ``,
              `IMPORTANT: Never send status updates about sync process. Never explain what you're doing. Only alert on tier 1 changes.`,
              `Use the user's language. Times in HH:MM, timezone: ${timezone}.`,
            ].join("\n"),
            delivery: deliveryTarget,
          }),
          buildCronJob({
            name: `nabu-memory-consolidation-${chatId}`,
            schedule: { kind: "cron", expr: `0 22 * * *`, tz: timezone },
            message: [
              `Daily memory consolidation for chat ${chatId}.`,
              `This is an internal housekeeping task. Do NOT message the user.`,
              `Reply with exactly "NO_REPLY" after completing.`,
            ].join("\n"),
            delivery: deliveryTarget,
          }),
        ],
        cronJobNames: [
          `nabu-brief-morning-${chatId}`,
          `nabu-evening-lookahead-${chatId}`,
          `nabu-sync-periodic-${chatId}`,
          `nabu-memory-consolidation-${chatId}`,
        ],
        instruction:
          syncResult.syncStatus === "pending"
            ? `Calendar connected but initial sync failed. Events will appear on next periodic sync. IMPORTANT: First remove any existing cron jobs with these names (ignore errors if they don't exist): nabu-brief-morning-${chatId}, nabu-evening-lookahead-${chatId}, nabu-sync-periodic-${chatId}, nabu-memory-consolidation-${chatId}. Use cron({ action: "remove", name: "<name>" }) for each. Then create all 4 cron jobs listed above using cron({ action: "add", job: <item> }).`
            : `IMPORTANT: First remove any existing cron jobs with these names (ignore errors if they don't exist): nabu-brief-morning-${chatId}, nabu-evening-lookahead-${chatId}, nabu-sync-periodic-${chatId}, nabu-memory-consolidation-${chatId}. Use cron({ action: "remove", name: "<name>" }) for each. Then create all 4 cron jobs listed above using cron({ action: "add", job: <item> }). This ensures no duplicate jobs on re-setup.`,
      });
    }

    async function handleFetch(
      params: { date?: string; from?: string; to?: string },
      chatId: number | null,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);
      if (!userConfig) {
        return textResult({
          error: "Calendar not set up. Ask the user to send their .ics URL.",
        });
      }

      const f = ensureFetcher();
      const result = await f.fetch(chatId, userConfig.icsUrl, userConfig.timezone);

      // Update lastFetchAt in store
      s.update(chatId, { lastFetchAt: result.fetchedAt });

      // Filter by date/range if specified
      let events: CalendarEvent[];
      if (params.date) {
        events = filterByDate(result.events, params.date, userConfig.timezone);
      } else if (params.from || params.to) {
        events = filterByRange(result.events, params.from, params.to, userConfig.timezone);
      } else {
        events = result.events;
      }

      // Ledger context for proactive dedup/cooldown
      const l = ensureLedger();
      const todayCount = l.countToday(chatId);
      const inCooldown = l.isInCooldown(chatId);
      const recentIds = l.getTodayMessages(chatId).map((r) => r.id);

      return textResult({
        events,
        count: events.length,
        fetchedAt: result.fetchedAt,
        stale: result.stale,
        source: result.source,
        ...(result.diff && { diff: result.diff }),
        ledger: {
          proactiveMessagesToday: todayCount,
          inCooldown,
          recentIncidentIds: recentIds,
        },
      });
    }

    async function handleFindSlots(
      params: { date?: string; durationMin?: number },
      chatId: number | null,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);
      if (!userConfig) {
        return textResult({ error: "Calendar not set up." });
      }

      const f = ensureFetcher();
      const result = await f.fetch(chatId, userConfig.icsUrl, userConfig.timezone);

      const targetDate = params.date || "today";
      const dayEvents = filterByDate(result.events, targetDate, userConfig.timezone);

      const slots = findFreeSlots(
        dayEvents,
        9, // workday start
        18, // workday end
        params.durationMin || 30,
        targetDate,
        userConfig.timezone,
      );

      return textResult({
        date: targetDate,
        slots,
        busyBlocks: dayEvents
          .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && !e.allDay)
          .map((e) => ({ summary: e.summary, start: e.start, end: e.end })),
        stale: result.stale,
        source: result.source,
      });
    }

    // P2 fix: added "plan" and "remind" handlers
    async function handleCallback(
      params: { callbackAction?: string; incidentId?: string; reminderMinutes?: number },
      chatId: number | null,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }
      if (!params.callbackAction) {
        return textResult({ error: "callbackAction is required" });
      }

      const l = ensureLedger();

      switch (params.callbackAction) {
        case "ack": {
          if (!params.incidentId) {
            return textResult({ error: "incidentId required for ack" });
          }
          const record = l.ack(chatId, params.incidentId, "ack");
          return textResult({
            ok: !!record,
            context: record?.textSnippet,
          });
        }

        case "dismiss": {
          if (!params.incidentId) {
            return textResult({ error: "incidentId required for dismiss" });
          }
          const record = l.dismiss(chatId, params.incidentId, "dismiss");
          return textResult({
            ok: !!record,
            context: record?.textSnippet,
          });
        }

        case "context": {
          if (!params.incidentId) {
            return textResult({ error: "incidentId required for context" });
          }
          const record = l.get(chatId, params.incidentId);
          return textResult({
            ok: !!record,
            context: record?.textSnippet,
            state: record?.state,
            trigger: record?.trigger,
          });
        }

        case "plan": {
          // Complex callback — agent will use LLM reasoning + nabu_calendar fetch.
          // Tool just returns context, LLM composes the plan.
          if (!params.incidentId) {
            return textResult({ error: "incidentId required for plan" });
          }
          const record = l.get(chatId, params.incidentId);
          const todayMessages = l.getTodayMessages(chatId);
          return textResult({
            ok: true,
            action: "plan",
            originalMessage: record?.textSnippet,
            trigger: record?.trigger,
            todayContext: todayMessages.map((m) => ({
              time: m.sentAt,
              text: m.textSnippet,
              reaction: m.reaction,
            })),
            instruction:
              'Use nabu_calendar with action="fetch" and date="today" to get events, then compose a schedule optimization plan based on the context above.',
          });
        }

        case "remind": {
          // Returns context for agent to create a cron reminder
          if (!params.incidentId) {
            return textResult({ error: "incidentId required for remind" });
          }
          const record = l.get(chatId, params.incidentId);
          const minutes = params.reminderMinutes ?? 15;
          return textResult({
            ok: true,
            action: "remind",
            originalMessage: record?.textSnippet,
            minutesBefore: minutes,
            instruction: `Create a one-shot cron job to remind the user ${minutes} minutes before the relevant event. Use cron({ action: "add", job: { schedule: { kind: "at", at: "<computed-ISO-time>" }, ... } }).`,
          });
        }

        default:
          return textResult({
            error: `Unknown callback action: ${params.callbackAction}`,
          });
      }
    }

    async function handleRecordIncident(
      params: { incidentId?: string; trigger?: string; textSnippet?: string },
      chatId: number | null,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }
      if (!params.incidentId || !params.trigger || !params.textSnippet) {
        return textResult({
          error: "incidentId, trigger, and textSnippet are required for record_incident",
        });
      }

      const l = ensureLedger();

      // Dedup check
      if (l.exists(chatId, params.incidentId)) {
        return textResult({
          ok: false,
          reason: "duplicate",
          message: "This incident was already recorded. Do not send the message.",
        });
      }

      // Cooldown check
      if (l.isInCooldown(chatId)) {
        return textResult({
          ok: false,
          reason: "cooldown",
          message:
            "User recently interacted with a proactive message. Wait before sending another.",
        });
      }

      // Record it
      const record = l.record({
        chatId,
        incidentId: params.incidentId,
        trigger: params.trigger,
        textSnippet: params.textSnippet,
      });

      return textResult({
        ok: true,
        recorded: record.id,
        proactiveMessagesToday: l.countToday(chatId),
      });
    }

    async function handleStatus(chatId: number | null) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);

      if (!userConfig) {
        return textResult({
          connected: false,
          message: "Calendar not set up.",
        });
      }

      const l = ensureLedger();
      const todayCount = l.countToday(chatId);

      return textResult({
        connected: true,
        timezone: userConfig.timezone,
        morningBriefHour: userConfig.morningBriefHour,
        eveningLookaheadHour: userConfig.eveningLookaheadHour,
        writeEnabled: userConfig.writeEnabled,
        proactiveMessagesToday: todayCount,
        lastFetchAt: userConfig.lastFetchAt || "never",
        // P2: Google Calendar write-ops status
        googleCalendarConnected: userConfig.googleCalendarConnected,
        googleEmail: userConfig.googleEmail,
        consentMode: userConfig.consentMode,
        writeOpsHourCount: userConfig.writeOpsHourCount,
      });
    }

    async function handleDisable(chatId: number | null) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);

      // Revoke Google tokens if connected
      if (userConfig?.googleAccessToken) {
        try {
          await revokeToken(userConfig.googleAccessToken);
        } catch {
          // Best-effort revocation
        }
      }
      if (userConfig?.googleRefreshToken) {
        try {
          await revokeToken(userConfig.googleRefreshToken);
        } catch {
          // Best-effort revocation
        }
      }

      const deleted = s.delete(chatId);

      if (deleted) {
        // Clean fetch cache and ledger
        const f = ensureFetcher();
        f.reset(chatId);
        const l = ensureLedger();
        l.cleanup(chatId, 0);
      }

      const cronJobNames = [
        `nabu-brief-morning-${chatId}`,
        `nabu-evening-lookahead-${chatId}`,
        `nabu-sync-periodic-${chatId}`,
        `nabu-memory-consolidation-${chatId}`,
      ];

      return textResult({
        ok: true,
        wasConnected: deleted,
        message: deleted
          ? "Calendar disconnected. Remove all cron jobs listed below."
          : "No calendar was connected.",
        cronJobsToRemove: deleted ? cronJobNames : [],
        instruction: deleted
          ? `Remove these cron jobs using cron({ action: "remove", name: "<name>" }) for each: ${cronJobNames.join(", ")}`
          : undefined,
      });
    }

    // ─── Per-user Memory Handlers ──────────────────────────────

    const MAX_USER_NOTES = 50;

    function handleSaveNote(params: { note?: string }, chatId: number | null) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }
      const note = typeof params.note === "string" ? params.note.trim() : "";
      if (!note) {
        return textResult({ error: "note is required for save_note" });
      }
      if (note.length > 500) {
        return textResult({ error: "Note too long (max 500 chars). Be concise." });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);
      if (!userConfig) {
        return textResult({
          error: "Calendar not set up. Cannot save notes without setup.",
        });
      }

      const notes = userConfig.userNotes ?? [];
      // Dedup: don't add if identical note already exists
      if (notes.includes(note)) {
        return textResult({ ok: true, message: "Note already exists.", count: notes.length });
      }
      // Cap at MAX_USER_NOTES, dropping oldest
      const updated = [...notes, note].slice(-MAX_USER_NOTES);
      s.update(chatId, { userNotes: updated });

      api.logger.info(`[nabu-calendar] Saved note for chat ${chatId} (${updated.length} total)`);
      return textResult({ ok: true, count: updated.length });
    }

    function handleGetNotes(chatId: number | null) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);
      if (!userConfig) {
        return textResult({ notes: [], count: 0 });
      }

      const notes = userConfig.userNotes ?? [];
      return textResult({ notes, count: notes.length });
    }

    // ─── P2: Write-ops Handlers ───────────────────────────────

    async function handleAuth(chatId: number | null) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return textResult({
          error:
            "Google Calendar API not configured. GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET must be set.",
        });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);

      if (!userConfig) {
        return textResult({
          error:
            "Calendar not set up. Connect ICS feed first, then authorize Google Calendar for write access.",
        });
      }

      // Check if already connected
      if (userConfig.googleCalendarConnected) {
        return textResult({
          alreadyConnected: true,
          googleEmail: userConfig.googleEmail,
          message: `Google Calendar is already connected (${userConfig.googleEmail || "unknown account"}).`,
        });
      }

      // Check if ICS URL is from Google Calendar — warn but don't block
      let nonGoogleWarning: string | undefined;
      try {
        const icsHost = new URL(userConfig.icsUrl).hostname;
        if (!icsHost.includes("google")) {
          nonGoogleWarning =
            "Your calendar feed is not from Google Calendar. Write-ops (create/update/delete) only work with Google Calendar.";
        }
      } catch {
        // URL parse error — proceed anyway
      }

      const stateManager = ensureOAuthStateManager();
      const { authUrl } = buildAuthUrl(chatId, BASE_URL, GOOGLE_CLIENT_ID, stateManager);

      return textResult({
        authUrl,
        ...(nonGoogleWarning && { warning: nonGoogleWarning }),
        instruction:
          "Send this link to the user. They need to click it and authorize Google Calendar access in their browser.",
      });
    }

    async function handleSearchEvents(
      params: { searchQuery?: string; searchDate?: string },
      chatId: number | null,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      if (!CONFIRM_SECRET) {
        return textResult({
          error: "write_ops_not_configured",
          message: "NABU_CONFIRM_SECRET not set — write-ops disabled",
        });
      }

      if (!params.searchQuery) {
        return textResult({ error: "searchQuery is required" });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);
      if (!userConfig?.googleCalendarConnected) {
        return textResult({
          error: "Google Calendar not connected. Call auth first.",
          needsAuth: true,
        });
      }

      // Build time range around searchDate
      let timeMin: string | undefined;
      let timeMax: string | undefined;
      if (params.searchDate) {
        const dt = DateTime.fromISO(params.searchDate, { zone: userConfig.timezone });
        timeMin = dt.startOf("day").toISO() || undefined;
        timeMax = dt.endOf("day").toISO() || undefined;
      }

      const result = await gcalSearchEvents(
        s,
        chatId,
        params.searchQuery,
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        timeMin,
        timeMax,
      );

      if (!result.ok) {
        return textResult({ ...result });
      }

      const candidates = result.data.map((e) => ({
        eventId: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
        recurringEventId: e.recurringEventId,
        ...(e.attendees &&
          e.attendees.length > 0 && {
            attendees: e.attendees.filter((a) => !a.self).map((a) => a.displayName || a.email),
          }),
      }));

      return textResult({
        ok: true,
        candidates,
        count: candidates.length,
        instruction:
          candidates.length > 1
            ? "Multiple events found. Show the list to the user and ask which one they want to modify."
            : candidates.length === 1
              ? "One event found. Proceed with the eventId for update/delete."
              : "No events found matching the query.",
      });
    }

    async function handleCreateEvent(
      params: {
        summary?: string;
        startDateTime?: string;
        endDateTime?: string;
        eventLocation?: string;
        eventDescription?: string;
        attendees?: string[];
        place?: string;
        confirmed?: boolean;
        confirmToken?: string;
        idempotencyKey?: string;
        expiresAt?: number;
      },
      chatId: number | null,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      // Fail-closed: no CONFIRM_SECRET = no write-ops
      if (!CONFIRM_SECRET) {
        return textResult({
          error: "write_ops_not_configured",
          message: "NABU_CONFIRM_SECRET not set — write-ops disabled",
        });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);
      if (!userConfig?.googleCalendarConnected) {
        return textResult({
          error: "Google Calendar not connected. Call auth first.",
          needsAuth: true,
        });
      }

      if (userConfig.consentMode !== "act_with_confirmation") {
        return textResult({
          error:
            "Write operations require consent mode 'act_with_confirmation'. Reconnect Google Calendar.",
          needsAuth: true,
        });
      }

      if (!params.summary || !params.startDateTime) {
        return textResult({ error: "summary and startDateTime are required" });
      }

      // Validate startDateTime is a proper ISO 8601 datetime (not "tomorrow" etc.)
      const startDt = DateTime.fromISO(params.startDateTime);
      if (!startDt.isValid) {
        return textResult({
          error: "invalid_datetime",
          message: `startDateTime "${params.startDateTime}" is not a valid ISO 8601 datetime. Use format like "2026-03-03T19:00:00+03:00".`,
        });
      }

      // Validate endDateTime if provided
      if (params.endDateTime) {
        const endDt = DateTime.fromISO(params.endDateTime);
        if (!endDt.isValid) {
          return textResult({
            error: "invalid_datetime",
            message: `endDateTime "${params.endDateTime}" is not a valid ISO 8601 datetime. Use format like "2026-03-03T20:00:00+03:00".`,
          });
        }
      }

      // Default duration: 60 minutes if endDateTime not specified
      const endDateTime = params.endDateTime || startDt.plus({ minutes: 60 }).toISO();
      if (!endDateTime) {
        return textResult({ error: "Invalid startDateTime format" });
      }

      // Canonicalize attendees + validate emails
      const attendees = canonicalizeAttendees(params.attendees);
      if (attendees) {
        const invalid = attendees.filter((e) => !EMAIL_RE.test(e));
        if (invalid.length) {
          return textResult({
            error: "invalid_attendee_email",
            message: `Invalid email(s): ${invalid.join(", ")}. Use valid email addresses.`,
          });
        }
      }

      // Normalize place → eventLocation alias
      const eventLocation = params.eventLocation || params.place;

      if (params.confirmed) {
        // ── Confirmed: execute the write ──

        if (!params.confirmToken || !params.idempotencyKey || !params.expiresAt) {
          return textResult({
            error: "confirmToken, idempotencyKey, and expiresAt are required with confirmed=true",
          });
        }

        // Reconstruct payload and verify HMAC
        const payload = {
          action: "create_event",
          chatId,
          summary: params.summary,
          startDateTime: params.startDateTime,
          endDateTime,
          eventLocation,
          eventDescription: params.eventDescription,
          attendees,
          idempotencyKey: params.idempotencyKey,
          exp: params.expiresAt,
        };

        if (!verifyConfirmToken(params.confirmToken, payload)) {
          return textResult({
            error: "stale_confirmation",
            message: "Parameters changed since preview. Please request a new preview.",
          });
        }

        // Check expiration — auto-refresh if expired
        if (Date.now() > params.expiresAt) {
          // Auto-refresh: generate new preview
          const newIdempotencyKey = crypto.randomUUID();
          const newExp = Date.now() + 10 * 60_000;
          const newPayload = {
            action: "create_event",
            chatId,
            summary: params.summary,
            startDateTime: params.startDateTime,
            endDateTime,
            eventLocation,
            eventDescription: params.eventDescription,
            attendees,
            idempotencyKey: newIdempotencyKey,
            exp: newExp,
          };
          const newConfirmToken = generateConfirmToken(newPayload);

          return textResult({
            error: "confirmation_expired",
            refreshedPreview: {
              summary: params.summary,
              startDateTime: params.startDateTime,
              endDateTime,
              location: eventLocation,
              ...(attendees && { attendees }),
            },
            newConfirmToken,
            newIdempotencyKey,
            newExpiresAt: newExp,
            instruction: "Show the updated preview to the user and ask for confirmation again.",
          });
        }

        // Rate limit check
        const rateResult = checkAndIncrementRateLimit(chatId);
        if (!rateResult.ok) {
          return textResult({
            error: "rate_limit",
            message: "Too many write operations this hour. Try again later.",
          });
        }

        // Execute create
        const event = {
          summary: params.summary,
          start: { dateTime: params.startDateTime },
          end: { dateTime: endDateTime },
          ...(eventLocation && { location: eventLocation }),
          ...(params.eventDescription && { description: params.eventDescription }),
          ...(attendees && { attendees: attendees.map((email) => ({ email })) }),
        };

        const result = await gcalCreateEvent(
          s,
          chatId,
          event,
          GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET,
          params.idempotencyKey,
        );

        if (!result.ok) {
          return textResult({ ...result });
        }

        const alreadyExists =
          "_alreadyExists" in result.data &&
          (result.data as Record<string, unknown>)._alreadyExists;

        return textResult({
          ok: true,
          eventId: result.data.id,
          htmlLink: result.data.htmlLink,
          alreadyExists: !!alreadyExists,
          syncNote:
            "Event created. It may take up to 15 minutes to appear in read mode (ICS feed).",
        });
      }

      // ── Preview mode: generate confirmToken ──

      // Soft duplicate check
      let duplicateWarning: string | undefined;
      try {
        const startDt = DateTime.fromISO(params.startDateTime);
        const endDt = DateTime.fromISO(endDateTime);
        const searchResult = await gcalSearchEvents(
          s,
          chatId,
          params.summary,
          GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET,
          startDt.minus({ hours: 1 }).toISO() || undefined,
          endDt.plus({ hours: 1 }).toISO() || undefined,
          3,
        );
        if (searchResult.ok && searchResult.data.length > 0) {
          const similar = searchResult.data[0]!;
          duplicateWarning = `Similar event already exists: "${similar.summary}" at ${similar.start?.dateTime || similar.start?.date}. Create another one?`;
        }
      } catch {
        // Duplicate check is best-effort
      }

      const idempotencyKey = crypto.randomUUID();
      const exp = Date.now() + 10 * 60_000;
      const payload = {
        action: "create_event",
        chatId,
        summary: params.summary,
        startDateTime: params.startDateTime,
        endDateTime,
        eventLocation,
        eventDescription: params.eventDescription,
        attendees,
        idempotencyKey,
        exp,
      };
      const confirmToken = generateConfirmToken(payload);

      return textResult({
        status: "needs_confirmation",
        preview: {
          summary: params.summary,
          startDateTime: params.startDateTime,
          endDateTime,
          location: eventLocation,
          description: params.eventDescription,
          ...(attendees && { attendees }),
        },
        confirmToken,
        idempotencyKey,
        expiresAt: exp,
        ...(duplicateWarning && { duplicateWarning }),
        instruction:
          "Show the preview to the user and ask for confirmation. Pass confirmToken, idempotencyKey, and expiresAt back with confirmed=true.",
      });
    }

    async function handleUpdateEvent(
      params: {
        eventId?: string;
        summary?: string;
        startDateTime?: string;
        endDateTime?: string;
        eventLocation?: string;
        eventDescription?: string;
        attendees?: string[];
        place?: string;
        confirmed?: boolean;
        confirmToken?: string;
        idempotencyKey?: string;
        expiresAt?: number;
      },
      chatId: number | null,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      if (!CONFIRM_SECRET) {
        return textResult({
          error: "write_ops_not_configured",
          message: "NABU_CONFIRM_SECRET not set — write-ops disabled",
        });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);
      if (!userConfig?.googleCalendarConnected) {
        return textResult({
          error: "Google Calendar not connected. Call auth first.",
          needsAuth: true,
        });
      }

      if (userConfig.consentMode !== "act_with_confirmation") {
        return textResult({
          error:
            "Write operations require consent mode 'act_with_confirmation'. Reconnect Google Calendar.",
          needsAuth: true,
        });
      }

      if (!params.eventId) {
        return textResult({
          error: "eventId is required. Use search_events to find the event first.",
        });
      }

      // Canonicalize attendees + validate emails
      const attendees = canonicalizeAttendees(params.attendees);
      if (attendees) {
        const invalid = attendees.filter((e) => !EMAIL_RE.test(e));
        if (invalid.length) {
          return textResult({
            error: "invalid_attendee_email",
            message: `Invalid email(s): ${invalid.join(", ")}. Use valid email addresses.`,
          });
        }
      }

      // Normalize place → eventLocation alias
      const eventLocation = params.eventLocation || params.place;

      if (params.confirmed) {
        // ── Confirmed: execute the update ──

        if (!params.confirmToken || !params.idempotencyKey || !params.expiresAt) {
          return textResult({
            error: "confirmToken, idempotencyKey, and expiresAt are required with confirmed=true",
          });
        }

        // Build updates object (attendees already merged in preview, HMAC guarantees integrity)
        const updates: Record<string, unknown> = {};
        if (params.summary) updates.summary = params.summary;
        if (params.startDateTime) updates.start = { dateTime: params.startDateTime };
        if (params.endDateTime) updates.end = { dateTime: params.endDateTime };
        if (eventLocation !== undefined) updates.location = eventLocation;
        if (params.eventDescription !== undefined) updates.description = params.eventDescription;
        if (attendees !== undefined) {
          updates.attendees = attendees.map((email) => ({ email }));
        }

        const payload = {
          action: "update_event",
          chatId,
          eventId: params.eventId,
          ...updates,
          idempotencyKey: params.idempotencyKey,
          exp: params.expiresAt,
        };

        if (!verifyConfirmToken(params.confirmToken, payload)) {
          return textResult({
            error: "stale_confirmation",
            message: "Parameters changed since preview. Please request a new preview.",
          });
        }

        if (Date.now() > params.expiresAt) {
          // Auto-refresh
          const newIdempotencyKey = crypto.randomUUID();
          const newExp = Date.now() + 10 * 60_000;
          const newPayload = { ...payload, idempotencyKey: newIdempotencyKey, exp: newExp };
          const newConfirmToken = generateConfirmToken(newPayload);

          return textResult({
            error: "confirmation_expired",
            refreshedPreview: { eventId: params.eventId, ...updates },
            newConfirmToken,
            newIdempotencyKey,
            newExpiresAt: newExp,
            instruction: "Show the updated preview and ask for confirmation again.",
          });
        }

        const rateResult = checkAndIncrementRateLimit(chatId);
        if (!rateResult.ok) {
          return textResult({
            error: "rate_limit",
            message: "Too many write operations this hour. Try again later.",
          });
        }

        const result = await gcalUpdateEvent(
          s,
          chatId,
          params.eventId,
          updates as Record<string, unknown> & { summary?: string },
          GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET,
        );

        if (!result.ok) {
          return textResult({ ...result });
        }

        return textResult({
          ok: true,
          eventId: result.data.id,
          htmlLink: result.data.htmlLink,
          syncNote: "Event updated. It may take up to 15 minutes to reflect in read mode.",
        });
      }

      // ── Preview mode ──

      // Get current event to check for recurring / past-event
      const existingEvent = await gcalGetEvent(
        s,
        chatId,
        params.eventId,
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
      );
      if (!existingEvent.ok) {
        return textResult({ ...existingEvent });
      }

      const warnings: Record<string, string> = {};

      // Recurring event check
      if (existingEvent.data.recurringEventId) {
        warnings.recurringWarning =
          "This is a recurring event. In V1.1, only this single instance can be modified.";
      }

      // Past event check
      const eventEnd = existingEvent.data.end?.dateTime || existingEvent.data.end?.date;
      if (eventEnd && new Date(eventEnd) < new Date()) {
        warnings.pastEventWarning = "This event has already passed.";
      }

      const updates: Record<string, unknown> = {};
      if (params.summary) updates.summary = params.summary;
      if (params.startDateTime) updates.start = { dateTime: params.startDateTime };
      if (params.endDateTime) updates.end = { dateTime: params.endDateTime };
      if (eventLocation !== undefined) updates.location = eventLocation;
      if (params.eventDescription !== undefined) updates.description = params.eventDescription;

      // Server-side merge: union existing + new attendees (add-only in V1.1)
      if (attendees !== undefined) {
        const existingEmails = (existingEvent.data.attendees || [])
          .filter((a) => !a.self)
          .map((a) => a.email.toLowerCase());
        const merged = [...new Set([...existingEmails, ...attendees])].sort();
        updates.attendees = merged.map((email) => ({ email }));
      }

      const idempotencyKey = crypto.randomUUID();
      const exp = Date.now() + 10 * 60_000;
      const payload = {
        action: "update_event",
        chatId,
        eventId: params.eventId,
        ...updates,
        idempotencyKey,
        exp,
      };
      const confirmToken = generateConfirmToken(payload);

      return textResult({
        status: "needs_confirmation",
        preview: {
          eventId: params.eventId,
          currentEvent: {
            summary: existingEvent.data.summary,
            start: existingEvent.data.start?.dateTime || existingEvent.data.start?.date,
            end: existingEvent.data.end?.dateTime || existingEvent.data.end?.date,
            location: existingEvent.data.location,
            ...(existingEvent.data.attendees &&
              existingEvent.data.attendees.length > 0 && {
                attendees: existingEvent.data.attendees
                  .filter((a) => !a.self)
                  .map((a) => ({
                    email: a.email,
                    ...(a.displayName && { name: a.displayName }),
                    ...(a.responseStatus && { status: a.responseStatus }),
                  })),
              }),
          },
          updates,
        },
        confirmToken,
        idempotencyKey,
        expiresAt: exp,
        ...warnings,
        instruction: "Show the preview to the user and ask for confirmation.",
      });
    }

    async function handleDeleteEvent(
      params: {
        eventId?: string;
        confirmed?: boolean;
        confirmToken?: string;
        idempotencyKey?: string;
        expiresAt?: number;
      },
      chatId: number | null,
    ) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      if (!CONFIRM_SECRET) {
        return textResult({
          error: "write_ops_not_configured",
          message: "NABU_CONFIRM_SECRET not set — write-ops disabled",
        });
      }

      const s = ensureStore();
      const userConfig = s.get(chatId);
      if (!userConfig?.googleCalendarConnected) {
        return textResult({
          error: "Google Calendar not connected. Call auth first.",
          needsAuth: true,
        });
      }

      if (userConfig.consentMode !== "act_with_confirmation") {
        return textResult({
          error:
            "Write operations require consent mode 'act_with_confirmation'. Reconnect Google Calendar.",
          needsAuth: true,
        });
      }

      if (!params.eventId) {
        return textResult({
          error: "eventId is required. Use search_events to find the event first.",
        });
      }

      if (params.confirmed) {
        // ── Confirmed: execute the delete ──

        if (!params.confirmToken || !params.idempotencyKey || !params.expiresAt) {
          return textResult({
            error: "confirmToken, idempotencyKey, and expiresAt are required with confirmed=true",
          });
        }

        const payload = {
          action: "delete_event",
          chatId,
          eventId: params.eventId,
          idempotencyKey: params.idempotencyKey,
          exp: params.expiresAt,
        };

        if (!verifyConfirmToken(params.confirmToken, payload)) {
          return textResult({
            error: "stale_confirmation",
            message: "Parameters changed since preview. Please request a new preview.",
          });
        }

        if (Date.now() > params.expiresAt) {
          // Auto-refresh
          const newIdempotencyKey = crypto.randomUUID();
          const newExp = Date.now() + 10 * 60_000;
          const newPayload = { ...payload, idempotencyKey: newIdempotencyKey, exp: newExp };
          const newConfirmToken = generateConfirmToken(newPayload);

          return textResult({
            error: "confirmation_expired",
            refreshedPreview: { eventId: params.eventId, action: "delete" },
            newConfirmToken,
            newIdempotencyKey,
            newExpiresAt: newExp,
            instruction: "Show the updated preview and ask for confirmation again.",
          });
        }

        const rateResult = checkAndIncrementRateLimit(chatId);
        if (!rateResult.ok) {
          return textResult({
            error: "rate_limit",
            message: "Too many write operations this hour. Try again later.",
          });
        }

        const result = await gcalDeleteEvent(
          s,
          chatId,
          params.eventId,
          GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET,
        );

        if (!result.ok) {
          return textResult({ ...result });
        }

        return textResult({
          ok: true,
          deleted: result.data.deleted,
          alreadyDeleted: result.data.alreadyDeleted,
          syncNote: "Event deleted. It may take up to 15 minutes to disappear from read mode.",
        });
      }

      // ── Preview mode ──

      const existingEvent = await gcalGetEvent(
        s,
        chatId,
        params.eventId,
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
      );
      if (!existingEvent.ok) {
        return textResult({ ...existingEvent });
      }

      const warnings: Record<string, string> = {};

      if (existingEvent.data.recurringEventId) {
        warnings.recurringWarning =
          "This is a recurring event. Only this single instance will be deleted.";
      }

      const eventEnd = existingEvent.data.end?.dateTime || existingEvent.data.end?.date;
      if (eventEnd && new Date(eventEnd) < new Date()) {
        warnings.pastEventWarning = "This event has already passed.";
      }

      const idempotencyKey = crypto.randomUUID();
      const exp = Date.now() + 10 * 60_000;
      const payload = {
        action: "delete_event",
        chatId,
        eventId: params.eventId,
        idempotencyKey,
        exp,
      };
      const confirmToken = generateConfirmToken(payload);

      return textResult({
        status: "needs_confirmation",
        preview: {
          action: "delete",
          eventId: params.eventId,
          event: {
            summary: existingEvent.data.summary,
            start: existingEvent.data.start?.dateTime || existingEvent.data.start?.date,
            end: existingEvent.data.end?.dateTime || existingEvent.data.end?.date,
            location: existingEvent.data.location,
          },
        },
        confirmToken,
        idempotencyKey,
        expiresAt: exp,
        ...warnings,
        instruction: "Show the preview to the user and ask for confirmation.",
      });
    }
  },
};

// ─── Calendar Snapshot ────────────────────────────────────────────

/**
 * Generate a deterministic snapshot of calendar patterns for setup response.
 * No LLM needed — pure data analysis.
 */
function generateSnapshot(events: CalendarEvent[], timezone: string): CalendarSnapshot {
  const now = DateTime.now().setZone(timezone);
  const weekAgo = now.minus({ weeks: 4 });

  // Filter to recent events for pattern analysis
  const recentEvents = events.filter((e) => {
    const start = DateTime.fromISO(e.start, { zone: timezone });
    return start >= weekAgo && start <= now.plus({ weeks: 4 });
  });

  // Find recurring meetings
  const recurringMap = new Map<
    string,
    { summary: string; dayOfWeek: string; time: string; attendees: string[] }
  >();
  for (const e of recentEvents) {
    if (!e.isRecurring || e.allDay) continue;
    const key = `${e.summary}`;
    if (recurringMap.has(key)) continue;
    const dt = DateTime.fromISO(e.start, { zone: timezone });
    recurringMap.set(key, {
      summary: e.summary,
      dayOfWeek: dt.toFormat("EEEE"),
      time: dt.toFormat("HH:mm"),
      attendees: e.attendees,
    });
  }

  // Count attendee frequency
  const attendeeCounts = new Map<string, number>();
  for (const e of recentEvents) {
    for (const a of e.attendees) {
      attendeeCounts.set(a, (attendeeCounts.get(a) || 0) + 1);
    }
  }

  // Find typical hours
  let earliestHour = 23;
  let latestHour = 0;
  for (const e of recentEvents) {
    if (e.allDay) continue;
    const start = DateTime.fromISO(e.start, { zone: timezone });
    const end = DateTime.fromISO(e.end, { zone: timezone });
    if (start.hour < earliestHour) earliestHour = start.hour;
    if (end.hour > latestHour) latestHour = end.hour;
  }

  // Find busiest day
  const dayCounts: Record<string, number> = {};
  for (const e of recentEvents) {
    if (e.allDay) continue;
    const dt = DateTime.fromISO(e.start, { zone: timezone });
    const day = dt.toFormat("EEEE");
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  }
  const busiestDay = Object.entries(dayCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || "Monday";

  return {
    recurringMeetings: Array.from(recurringMap.values()),
    frequentAttendees: Array.from(attendeeCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
    typicalHours: {
      start: `${String(earliestHour).padStart(2, "0")}:00`,
      end: `${String(latestHour).padStart(2, "0")}:00`,
    },
    busiestDay,
    totalEvents: events.length,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function textResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

/** textResult wrapper that accepts typed error objects by spreading them */
function errorResult(err: { ok: false; error: string; message: string; needsReauth?: boolean }) {
  return textResult({ ...err });
}

function extractChatId(messageTo?: string): number | null {
  if (!messageTo) return null;
  // Format: "telegram:direct:-123456789" or "telegram:group:-100123456789"
  const match = messageTo.match(/:(-?\d+)$/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/** Parse messageTo into delivery target for cron jobs. */
function parseDeliveryTarget(
  messageTo: string,
): { mode: string; channel?: string; to?: string } | undefined {
  // Format: "telegram:direct:-123456789"
  const parts = messageTo.split(":");
  if (parts.length < 3) return undefined;
  const channel = parts[0]; // "telegram"
  const to = parts.slice(2).join(":"); // "-123456789"
  return { mode: "announce", channel, to };
}

/**
 * Build a cron job object matching OpenClaw cron tool schema.
 * P1 fix: proper schedule.kind, payload.kind, sessionTarget, delivery.
 */
function buildCronJob(opts: {
  name: string;
  schedule:
    | { kind: "cron"; expr: string; tz?: string }
    | { kind: "every"; everyMs: number }
    | { kind: "at"; at: string };
  message: string;
  delivery?: { mode: string; channel?: string; to?: string };
}): Record<string, unknown> {
  const job: Record<string, unknown> = {
    name: opts.name,
    schedule: opts.schedule,
    sessionTarget: "isolated",
    payload: {
      kind: "agentTurn",
      message: opts.message,
    },
    enabled: true,
  };

  if (opts.delivery) {
    job.delivery = opts.delivery;
  }

  return job;
}

export default nabuCalendarPlugin;
