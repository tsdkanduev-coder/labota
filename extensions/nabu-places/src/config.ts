import { z } from "zod";

// ─── Plugin Config Schema ────────────────────────────────────────

export const NabuPlacesConfigSchema = z.object({
  enabled: z.boolean().default(false),
  defaultCity: z.string().default("Москва"),
});
export type NabuPlacesConfig = z.infer<typeof NabuPlacesConfigSchema>;

// ─── Config Parser (for plugin registration) ─────────────────────

export const nabuPlacesConfigParser = {
  parse(value: unknown): NabuPlacesConfig {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return NabuPlacesConfigSchema.parse(raw);
  },
};

// ─── Resolve config from environment ─────────────────────────────

export function resolveConfig(config: NabuPlacesConfig): NabuPlacesConfig {
  const resolved = { ...config };

  if (process.env.NABU_PLACES_DEFAULT_CITY) {
    resolved.defaultCity = process.env.NABU_PLACES_DEFAULT_CITY;
  }

  return resolved;
}

// ─── Validation ──────────────────────────────────────────────────

export function validateConfig(config: NabuPlacesConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.enabled) {
    return { valid: true, errors: [] };
  }

  return { valid: errors.length === 0, errors };
}
