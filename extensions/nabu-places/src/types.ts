import { z } from "zod";

// ─── Cuisine / Preference Tags ──────────────────────────────────

export const CuisineTag = z.enum([
  "japanese",
  "italian",
  "georgian",
  "russian",
  "french",
  "chinese",
  "korean",
  "thai",
  "indian",
  "mexican",
  "american",
  "mediterranean",
  "middle_eastern",
  "seafood",
  "steakhouse",
  "vegetarian",
  "other",
]);
export type CuisineTag = z.infer<typeof CuisineTag>;

// ─── Saved Restaurant ───────────────────────────────────────────

export const SavedRestaurantSchema = z.object({
  name: z.string(),
  cuisine: CuisineTag.optional(),
  city: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  note: z.string().optional(), // user's personal note ("great wine list")
  url: z.string().optional(), // Yandex Maps / 2GIS link
  savedAt: z.string(), // ISO 8601
});
export type SavedRestaurant = z.infer<typeof SavedRestaurantSchema>;

// ─── User Preferences ───────────────────────────────────────────

export const UserPreferencesSchema = z.object({
  chatId: z.number(),
  defaultCity: z.string().default("Москва"),
  favoriteCuisines: z.array(CuisineTag).default([]),
  dislikedCuisines: z.array(CuisineTag).default([]),
  priceRange: z.enum(["budget", "moderate", "premium", "luxury"]).optional(),
  dietaryNotes: z.string().optional(), // "no pork", "allergic to nuts"
  savedRestaurants: z.array(SavedRestaurantSchema).default([]),
  createdAt: z.string(), // ISO 8601
  updatedAt: z.string(), // ISO 8601
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
