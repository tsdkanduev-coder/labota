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
  model: z.string().default("claude-sonnet-4-20250514"),
  llmTimeoutMs: z.number().int().positive().default(30_000),
  llmRetryDelays: z.array(z.number()).default([5_000, 15_000, 30_000]),
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
  if (process.env.NABU_MODEL) {
    resolved.model = process.env.NABU_MODEL;
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

  // Check ANTHROPIC_API_KEY for proactive LLM calls
  if (!process.env.ANTHROPIC_API_KEY) {
    errors.push("ANTHROPIC_API_KEY environment variable is required for proactive calendar briefs");
  }

  return { valid: errors.length === 0, errors };
}
