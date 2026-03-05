import * as fs from "node:fs";
import * as path from "node:path";
import { UserPreferencesSchema, type UserPreferences } from "./types.js";

/**
 * Persistent store for per-user restaurant preferences.
 * Uses stateDir for file-based storage with atomic writes.
 *
 * File layout:
 *   {stateDir}/nabu-places/users/{chatId}.json
 */
export class PlacesStore {
  private readonly usersDir: string;
  private cache = new Map<number, UserPreferences>();

  constructor(stateDir: string) {
    this.usersDir = path.join(stateDir, "nabu-places", "users");
    fs.mkdirSync(this.usersDir, { recursive: true });
  }

  /** Get preferences for a chat, or null if not set up. */
  get(chatId: number): UserPreferences | null {
    if (this.cache.has(chatId)) {
      return this.cache.get(chatId)!;
    }

    const filePath = this.userFilePath(chatId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const prefs = UserPreferencesSchema.parse(raw);
      this.cache.set(chatId, prefs);
      return prefs;
    } catch {
      return null;
    }
  }

  /** Get preferences or create default ones. */
  getOrCreate(chatId: number, defaultCity?: string): UserPreferences {
    const existing = this.get(chatId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const prefs: UserPreferences = UserPreferencesSchema.parse({
      chatId,
      defaultCity: defaultCity ?? "Москва",
      createdAt: now,
      updatedAt: now,
    });

    this.set(chatId, prefs);
    return prefs;
  }

  /** Save preferences for a chat. Atomic write (write to tmp, then rename). */
  set(chatId: number, prefs: UserPreferences): void {
    const filePath = this.userFilePath(chatId);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;

    const validated = UserPreferencesSchema.parse(prefs);

    fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
    this.cache.set(chatId, validated);
  }

  /** Update specific fields of user preferences. */
  update(chatId: number, updates: Partial<UserPreferences>): UserPreferences {
    const existing = this.getOrCreate(chatId);
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.set(chatId, updated);
    return updated;
  }

  /** Add a restaurant to saved list. */
  saveRestaurant(
    chatId: number,
    restaurant: Omit<UserPreferences["savedRestaurants"][number], "savedAt">,
  ): UserPreferences {
    const prefs = this.getOrCreate(chatId);
    const savedRestaurants = [
      ...prefs.savedRestaurants,
      { ...restaurant, savedAt: new Date().toISOString() },
    ];
    return this.update(chatId, { savedRestaurants });
  }

  /** Remove a restaurant from saved list by name. */
  removeRestaurant(chatId: number, name: string): UserPreferences {
    const prefs = this.getOrCreate(chatId);
    const savedRestaurants = prefs.savedRestaurants.filter(
      (r) => r.name.toLowerCase() !== name.toLowerCase(),
    );
    return this.update(chatId, { savedRestaurants });
  }

  /** Delete all preferences for a user. */
  delete(chatId: number): boolean {
    const filePath = this.userFilePath(chatId);
    this.cache.delete(chatId);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  /** List all configured chat IDs. */
  listChatIds(): number[] {
    try {
      return fs
        .readdirSync(this.usersDir)
        .filter((f) => f.endsWith(".json") && !f.includes(".tmp."))
        .map((f) => Number.parseInt(path.basename(f, ".json"), 10))
        .filter((n) => !Number.isNaN(n));
    } catch {
      return [];
    }
  }

  private userFilePath(chatId: number): string {
    return path.join(this.usersDir, `${chatId}.json`);
  }
}
