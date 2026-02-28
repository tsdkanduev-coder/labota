import * as fs from "node:fs";
import * as path from "node:path";
import { NabuUserConfigSchema, type NabuUserConfig } from "./types.js";

/**
 * Persistent store for per-user Nabu configs.
 * Uses stateDir for file-based storage with atomic writes.
 *
 * File layout:
 *   {stateDir}/nabu-calendar/users/{chatId}.json
 */
export class NabuStore {
  private readonly usersDir: string;
  private cache = new Map<number, NabuUserConfig>();

  constructor(stateDir: string) {
    this.usersDir = path.join(stateDir, "nabu-calendar", "users");
    fs.mkdirSync(this.usersDir, { recursive: true });
  }

  /** Get config for a chat, or null if not set up. */
  get(chatId: number): NabuUserConfig | null {
    // Check cache first
    if (this.cache.has(chatId)) {
      return this.cache.get(chatId)!;
    }

    const filePath = this.userFilePath(chatId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const config = NabuUserConfigSchema.parse(raw);
      this.cache.set(chatId, config);
      return config;
    } catch {
      return null;
    }
  }

  /** Save config for a chat. Atomic write (write to tmp, then rename). */
  set(chatId: number, config: NabuUserConfig): void {
    const filePath = this.userFilePath(chatId);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;

    const validated = NabuUserConfigSchema.parse(config);

    fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
    this.cache.set(chatId, validated);
  }

  /** Update specific fields of a user config. */
  update(chatId: number, updates: Partial<NabuUserConfig>): NabuUserConfig | null {
    const existing = this.get(chatId);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    this.set(chatId, updated);
    return updated;
  }

  /** Delete a user's config. */
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
        .filter((f) => f.endsWith(".json"))
        .map((f) => Number.parseInt(path.basename(f, ".json"), 10))
        .filter((n) => !Number.isNaN(n));
    } catch {
      return [];
    }
  }

  /** Get all user configs. */
  listAll(): NabuUserConfig[] {
    return this.listChatIds()
      .map((id) => this.get(id))
      .filter((c): c is NabuUserConfig => c !== null);
  }

  private userFilePath(chatId: number): string {
    return path.join(this.usersDir, `${chatId}.json`);
  }
}
