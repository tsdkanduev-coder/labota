import { z } from "zod";

// ─── Calendar Event ──────────────────────────────────────────────

export const CalendarEventSchema = z.object({
  uid: z.string(),
  summary: z.string(),
  start: z.string(), // ISO 8601 datetime (even for all-day events)
  end: z.string(), // ISO 8601 datetime (even for all-day events)
  location: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
  transparency: z.enum(["opaque", "transparent"]).default("opaque"),
  attendees: z.array(z.string()).default([]),
  organizer: z.string().optional(),
  recurrenceId: z.string().optional(), // for recurring event instances
  isRecurring: z.boolean().default(false),
  allDay: z.boolean().default(false), // D1: all-day events normalized to midnight datetime
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// ─── Calendar Diff ───────────────────────────────────────────────

export const EventChangeSchema = z.object({
  event: CalendarEventSchema,
  changes: z.array(z.string()), // human-readable: ["time: 10:00→11:00", "title: 'Sync'→'Team Sync'"]
});
export type EventChange = z.infer<typeof EventChangeSchema>;

export const CalendarDiffSchema = z.object({
  added: z.array(CalendarEventSchema),
  removed: z.array(CalendarEventSchema),
  modified: z.array(EventChangeSchema),
});
export type CalendarDiff = z.infer<typeof CalendarDiffSchema>;

// ─── Tick Triggers ───────────────────────────────────────────────

export type TickTrigger =
  | { type: "morning_brief" }
  | { type: "evening_lookahead" }
  | { type: "periodic_sync"; diff: CalendarDiff }
  | { type: "reminder"; incidentId: string }
  | { type: "consolidation" };

// ─── User Config (per-user, stored in stateDir) ─────────────────

export const NabuUserConfigSchema = z.object({
  chatId: z.number(),
  icsUrl: z.string().url(),
  timezone: z.string().default("Europe/Moscow"),
  morningBriefHour: z.number().int().min(0).max(23).default(8),
  eveningLookaheadHour: z.number().int().min(0).max(23).default(20),
  syncIntervalMs: z.number().int().positive().default(900_000), // 15 min
  writeEnabled: z.boolean().default(false),
  createdAt: z.string(), // ISO 8601
  lastFetchAt: z.string().optional(),
  lastEtag: z.string().optional(),
});
export type NabuUserConfig = z.infer<typeof NabuUserConfigSchema>;

// ─── Incident / Ledger ──────────────────────────────────────────

export const IncidentStateSchema = z.enum(["sent", "acked", "dismissed", "expired"]);
export type IncidentState = z.infer<typeof IncidentStateSchema>;

export const IncidentRecordSchema = z.object({
  id: z.string(),
  chatId: z.number(),
  state: IncidentStateSchema,
  trigger: z.string(), // "morning_brief" | "periodic_sync" | etc.
  textSnippet: z.string(), // first ~200 chars of sent message
  reasoning: z.string().optional(), // LLM reasoning (for memory consolidation)
  reaction: z.string().optional(), // "acked" | "dismissed" | button callback
  sentAt: z.string(), // ISO 8601
  updatedAt: z.string(), // ISO 8601
  cooldownUntil: z.string().optional(), // ISO 8601
  ttl: z.string(), // ISO 8601, when to expire
});
export type IncidentRecord = z.infer<typeof IncidentRecordSchema>;

// ─── Proactive LLM Response ────────────────────────────────────

export const NabuProactiveResponseSchema = z.object({
  send: z.boolean(),
  text: z.string().optional(),
  buttons: z
    .array(
      z.array(
        z.object({
          text: z.string(),
          callback_data: z.string().max(64),
        }),
      ),
    )
    .optional(),
  memoryUpdates: z.string().optional(), // for consolidation only
});
export type NabuProactiveResponse = z.infer<typeof NabuProactiveResponseSchema>;

// ─── Calendar Snapshot (from setup) ─────────────────────────────

export const RecurringMeetingSchema = z.object({
  summary: z.string(),
  dayOfWeek: z.string(), // "Monday", "Tuesday", etc.
  time: z.string(), // "10:00"
  attendees: z.array(z.string()),
});

export const CalendarSnapshotSchema = z.object({
  recurringMeetings: z.array(RecurringMeetingSchema),
  frequentAttendees: z.array(
    z.object({
      name: z.string(),
      count: z.number(),
    }),
  ),
  typicalHours: z.object({
    start: z.string(), // "09:00"
    end: z.string(), // "18:00"
  }),
  busiestDay: z.string(),
  totalEvents: z.number(),
});
export type CalendarSnapshot = z.infer<typeof CalendarSnapshotSchema>;

// ─── Fetch State (for ETag / conditional requests) ──────────────

export const FetchStateSchema = z.object({
  lastFetchAt: z.string().optional(),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  lastEvents: z.array(CalendarEventSchema).optional(),
  consecutiveErrors: z.number().default(0),
  nextRetryAt: z.string().optional(),
});
export type FetchState = z.infer<typeof FetchStateSchema>;

// ─── Fetch Result (returned by IcsFetcher.fetch()) ──────────────

export const FetchResultSchema = z.object({
  events: z.array(CalendarEventSchema),
  diff: CalendarDiffSchema.nullable(), // null on first fetch
  notModified: z.boolean(), // D5: explicit in all paths, true ONLY on 304
  stale: z.boolean(), // true if serving from cache during backoff
  source: z.enum(["network", "cache", "backoff"]),
  fetchedAt: z.string(), // ISO 8601
});
export type FetchResult = z.infer<typeof FetchResultSchema>;
