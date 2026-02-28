import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { nabuCalendarConfigParser, resolveConfig, validateConfig } from "./src/config.js";
import { NabuLedger } from "./src/ledger.js";
import { NabuStore } from "./src/store.js";

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
      Type.Literal("status"),
      Type.Literal("disable"),
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

    // ─── Register Tool ─────────────────────────────────────────

    api.registerTool((toolCtx) => {
      const chatId = extractChatId(toolCtx.messageTo);
      const messageTo = toolCtx.messageTo;

      return {
        name: "nabu_calendar",
        label: "Nabu Calendar",
        description:
          "Personal calendar assistant. Actions: setup (connect .ics feed), fetch (get events), find_slots (find free time), handle_callback (process button taps), status, disable.",
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
              case "status":
                return await handleStatus(chatId);
              case "disable":
                return await handleDisable(chatId);
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
      },

      stop: async () => {
        api.logger.info("[nabu-calendar] Service stopped");
        store = null;
        ledger = null;
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

      // TODO: implement actual ICS fetch in ics-fetcher.ts (Day 2-3)
      const userConfig = {
        chatId,
        icsUrl,
        timezone,
        morningBriefHour: config.morningBriefHour,
        eveningLookaheadHour: config.eveningLookaheadHour,
        syncIntervalMs: config.syncIntervalMs,
        writeEnabled: config.writeEnabled,
        createdAt: new Date().toISOString(),
      };

      s.set(chatId, userConfig);
      api.logger.info(`[nabu-calendar] Setup complete for chat ${chatId}, tz=${timezone}`);

      // Resolve delivery target for cron jobs
      const deliveryTarget = messageTo ? parseDeliveryTarget(messageTo) : undefined;

      // P1 fix: return proper OpenClaw cron job schema
      return textResult({
        ok: true,
        eventsFound: 0, // TODO: actual count after ICS fetch
        calendarSnapshot: null, // TODO: actual analysis after ICS fetch
        cronJobs: [
          buildCronJob({
            name: `nabu-brief-morning-${chatId}`,
            schedule: { kind: "cron", expr: `0 ${config.morningBriefHour} * * *`, tz: timezone },
            message: `Run Nabu morning brief for chat ${chatId}. Analyze today's calendar and send a brief via Telegram.`,
            delivery: deliveryTarget,
          }),
          buildCronJob({
            name: `nabu-evening-lookahead-${chatId}`,
            schedule: {
              kind: "cron",
              expr: `0 ${config.eveningLookaheadHour} * * *`,
              tz: timezone,
            },
            message: `Run Nabu evening lookahead for chat ${chatId}. Preview tomorrow's calendar and send highlights via Telegram.`,
            delivery: deliveryTarget,
          }),
          buildCronJob({
            name: `nabu-sync-periodic-${chatId}`,
            schedule: { kind: "every", everyMs: config.syncIntervalMs },
            message: `Run Nabu periodic calendar sync for chat ${chatId}. Check for new/changed events and alert if important.`,
            delivery: deliveryTarget,
          }),
          buildCronJob({
            name: `nabu-memory-consolidation-${chatId}`,
            schedule: { kind: "cron", expr: `0 22 * * *`, tz: timezone },
            message: `Run Nabu daily memory consolidation for chat ${chatId}. Review today's interactions and update MEMORY.md.`,
            delivery: deliveryTarget,
          }),
        ],
        instruction:
          "Create all 4 cron jobs listed above using the cron tool. Each item is a complete job object — pass it as the `job` parameter to cron({ action: 'add', job: <item> }).",
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

      // TODO: implement actual ICS fetch + parse (Day 2-3)
      return textResult({
        events: [],
        note: "ICS fetcher not yet implemented. Connect .ics feed first.",
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

      // TODO: implement slot finding (Day 3-4)
      return textResult({
        slots: [],
        busyBlocks: [],
        note: "Slot finder not yet implemented.",
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
          // Complex callback — agent will use LLM reasoning + calendar_fetch.
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
              "Use calendar_fetch to get events, then compose a schedule optimization plan based on the context above.",
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
      });
    }

    async function handleDisable(chatId: number | null) {
      if (!chatId) {
        return textResult({ error: "Cannot determine chat ID" });
      }

      const s = ensureStore();
      const deleted = s.delete(chatId);

      return textResult({
        ok: true,
        wasConnected: deleted,
        message: deleted
          ? "Calendar disconnected. Cron jobs should be removed."
          : "No calendar was connected.",
      });
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────

function textResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
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
