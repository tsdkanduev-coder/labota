import { z } from "zod";

// ─── Plugin Config Schema ────────────────────────────────────────

export const NabuCalendarConfigSchema = z.object({
  enabled: z.boolean().default(false),
  timezone: z.string().default("Europe/Moscow"),
  morningBriefHour: z.number().int().min(0).max(23).default(8),
  eveningLookaheadHour: z.number().int().min(0).max(23).default(20),
  syncIntervalMs: z.number().int().positive().default(900_000), // 15 min
  maxProactivePerDay: z.number().int().positive().default(5),
  writeEnabled: z.boolean().default(false),
  // Note: no model/llmTimeout/llmRetryDelays — Nabu doesn't make direct LLM calls.
  // All LLM interaction goes through OpenClaw cron → isolated session → the bot's configured model.
  // ICS URL is stored per-user in store, not in plugin config
});
export type NabuCalendarConfig = z.infer<typeof NabuCalendarConfigSchema>;

// ─── Config Parser (for plugin registration) ─────────────────────

export const nabuCalendarConfigParser = {
  parse(value: unknown): NabuCalendarConfig {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return NabuCalendarConfigSchema.parse(raw);
  },
};

// ─── Resolve config from environment ─────────────────────────────

export function resolveConfig(config: NabuCalendarConfig): NabuCalendarConfig {
  const resolved = { ...config };

  // Allow env overrides
  if (process.env.NABU_TIMEZONE) {
    resolved.timezone = process.env.NABU_TIMEZONE;
  }

  return resolved;
}

// ─── Validation ──────────────────────────────────────────────────

export function validateConfig(config: NabuCalendarConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.enabled) {
    return { valid: true, errors: [] };
  }

  // No API key check needed — Nabu doesn't make direct LLM calls.
  // All LLM interaction goes through OpenClaw's configured model (OpenAI, etc.)

  return { valid: errors.length === 0, errors };
}
