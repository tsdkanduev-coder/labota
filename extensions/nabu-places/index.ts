import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { UserPreferences } from "./src/types.js";
import { nabuPlacesConfigParser, resolveConfig, validateConfig } from "./src/config.js";
import { PlacesStore } from "./src/store.js";

// ─── Helpers ──────────────────────────────────────────────────────

function textResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function extractChatId(messageTo?: string): number | null {
  if (!messageTo) return null;
  const match = messageTo.match(/:(-?\d+)$/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

// ─── Tool Schema ──────────────────────────────────────────────────
// Flat object with action discriminator (same pattern as nabu-calendar).

const NabuPlacesToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("get_preferences"),
      Type.Literal("update_preferences"),
      Type.Literal("save_restaurant"),
      Type.Literal("remove_restaurant"),
      Type.Literal("list_saved"),
    ],
    { description: "Action to perform" },
  ),
  // chatId override (for cron/isolated sessions)
  chatId: Type.Optional(
    Type.Number({ description: "Telegram chat ID. Pass explicitly in cron/isolated sessions." }),
  ),
  // update_preferences
  defaultCity: Type.Optional(Type.String({ description: "Default city for searches" })),
  favoriteCuisines: Type.Optional(
    Type.Array(Type.String(), { description: "Preferred cuisine types" }),
  ),
  dislikedCuisines: Type.Optional(
    Type.Array(Type.String(), { description: "Disliked cuisine types" }),
  ),
  priceRange: Type.Optional(
    Type.String({
      description: 'Price preference: "budget", "moderate", "premium", "luxury"',
    }),
  ),
  dietaryNotes: Type.Optional(
    Type.String({
      description: 'Dietary restrictions / notes, e.g. "no pork", "allergic to nuts"',
    }),
  ),
  // save_restaurant
  restaurantName: Type.Optional(Type.String({ description: "Restaurant name (for save/remove)" })),
  cuisine: Type.Optional(Type.String({ description: "Cuisine type of the restaurant" })),
  city: Type.Optional(Type.String({ description: "City where the restaurant is located" })),
  rating: Type.Optional(Type.Number({ description: "Rating (0-5) from Yandex Maps / 2GIS" })),
  note: Type.Optional(Type.String({ description: "User's personal note about the restaurant" })),
  url: Type.Optional(Type.String({ description: "Yandex Maps or 2GIS URL" })),
});

// ─── Plugin ───────────────────────────────────────────────────────

const nabuPlacesPlugin = {
  id: "nabu-places",
  name: "Nabu Places",
  description: "Restaurant search preferences & saved places for Telegram concierge",
  configSchema: nabuPlacesConfigParser,

  register(api: OpenClawPluginApi) {
    const rawConfig = nabuPlacesConfigParser.parse(api.pluginConfig);
    const config = resolveConfig(rawConfig);
    const validation = validateConfig(config);

    if (validation.errors.length > 0) {
      for (const err of validation.errors) {
        api.logger.warn(`[nabu-places] Config warning: ${err}`);
      }
    }

    // ─── Shared state ──────────────────────────────────────────

    let resolvedStateDir: string | null = null;
    let store: PlacesStore | null = null;

    const getStateDir = (): string => {
      if (!resolvedStateDir) {
        throw new Error(
          "[nabu-places] stateDir not initialized — service.start() must run before tool calls",
        );
      }
      return resolvedStateDir;
    };

    const ensureStore = (): PlacesStore => {
      if (!store) store = new PlacesStore(getStateDir());
      return store;
    };

    // ─── Tool ──────────────────────────────────────────────────

    api.registerTool((toolCtx) => {
      const messageTo = toolCtx.messageTo;

      return {
        name: "nabu_places",
        label: "Nabu Places",
        description:
          "Manage restaurant preferences and saved places. " +
          "Actions: get_preferences, update_preferences, save_restaurant, remove_restaurant, list_saved.",
        parameters: NabuPlacesToolSchema,

        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const chatId = extractChatId(messageTo) ?? (params.chatId as number | undefined) ?? null;

          if (!chatId) {
            return textResult({ error: "Cannot determine chatId. Pass it explicitly." });
          }

          const s = ensureStore();

          try {
            switch (params.action as string) {
              // ── get_preferences ─────────────────────────────
              case "get_preferences": {
                const prefs = s.getOrCreate(chatId, config.defaultCity);
                return textResult({ ok: true, preferences: prefsToJson(prefs) });
              }

              // ── update_preferences ─────────────────────────
              case "update_preferences": {
                const updates: Partial<UserPreferences> = {};
                if (params.defaultCity) updates.defaultCity = params.defaultCity as string;
                if (params.favoriteCuisines)
                  updates.favoriteCuisines =
                    params.favoriteCuisines as UserPreferences["favoriteCuisines"];
                if (params.dislikedCuisines)
                  updates.dislikedCuisines =
                    params.dislikedCuisines as UserPreferences["dislikedCuisines"];
                if (params.priceRange)
                  updates.priceRange = params.priceRange as UserPreferences["priceRange"];
                if (params.dietaryNotes !== undefined)
                  updates.dietaryNotes = params.dietaryNotes as string;

                const prefs = s.update(chatId, updates);
                return textResult({ ok: true, preferences: prefsToJson(prefs) });
              }

              // ── save_restaurant ─────────────────────────────
              case "save_restaurant": {
                if (!params.restaurantName) {
                  return textResult({ error: "restaurantName is required" });
                }
                const prefs = s.saveRestaurant(chatId, {
                  name: params.restaurantName as string,
                  cuisine: params.cuisine as UserPreferences["savedRestaurants"][number]["cuisine"],
                  city: params.city as string | undefined,
                  rating: params.rating as number | undefined,
                  note: params.note as string | undefined,
                  url: params.url as string | undefined,
                });
                return textResult({
                  ok: true,
                  saved: prefs.savedRestaurants.length,
                  restaurant: params.restaurantName,
                });
              }

              // ── remove_restaurant ───────────────────────────
              case "remove_restaurant": {
                if (!params.restaurantName) {
                  return textResult({ error: "restaurantName is required" });
                }
                const prefs = s.removeRestaurant(chatId, params.restaurantName as string);
                return textResult({
                  ok: true,
                  saved: prefs.savedRestaurants.length,
                  removed: params.restaurantName,
                });
              }

              // ── list_saved ──────────────────────────────────
              case "list_saved": {
                const prefs = s.getOrCreate(chatId, config.defaultCity);
                return textResult({
                  ok: true,
                  count: prefs.savedRestaurants.length,
                  restaurants: prefs.savedRestaurants,
                });
              }

              default:
                return textResult({ error: `Unknown action: ${params.action}` });
            }
          } catch (err) {
            return textResult({
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    });

    // ─── Service ───────────────────────────────────────────────

    api.registerService({
      id: "nabu-places",
      start: async (ctx) => {
        resolvedStateDir = ctx.stateDir;
        ensureStore();
        api.logger.info("[nabu-places] Service started");
      },
      stop: async () => {
        store = null;
        api.logger.info("[nabu-places] Service stopped");
      },
    });
  },
};

// ─── Helpers ──────────────────────────────────────────────────────

function prefsToJson(prefs: UserPreferences): Record<string, unknown> {
  return {
    defaultCity: prefs.defaultCity,
    favoriteCuisines: prefs.favoriteCuisines,
    dislikedCuisines: prefs.dislikedCuisines,
    priceRange: prefs.priceRange ?? null,
    dietaryNotes: prefs.dietaryNotes ?? null,
    savedCount: prefs.savedRestaurants.length,
  };
}

export default nabuPlacesPlugin;
