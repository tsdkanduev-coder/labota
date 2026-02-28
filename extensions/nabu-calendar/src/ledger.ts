import { DateTime } from "luxon";
import * as fs from "node:fs";
import * as path from "node:path";
import { IncidentRecordSchema, type IncidentRecord, type IncidentState } from "./types.js";

/**
 * Incident ledger: tracks proactive messages sent to users.
 *
 * Responsibilities:
 * - Dedup: don't send the same incident twice
 * - State machine: sent → acked/dismissed/expired
 * - Cooldown: don't spam after user interaction
 * - Message log: store text snippets + reasoning for inter-message context
 * - TTL: auto-expire old incidents
 *
 * File layout:
 *   {stateDir}/nabu-calendar/ledger/{chatId}.json
 */
export class NabuLedger {
  private readonly ledgerDir: string;
  private cache = new Map<number, IncidentRecord[]>();

  /** Default TTL: 7 days */
  static readonly DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  /** Default cooldown after ack/dismiss: 30 minutes */
  static readonly DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

  constructor(stateDir: string) {
    this.ledgerDir = path.join(stateDir, "nabu-calendar", "ledger");
    fs.mkdirSync(this.ledgerDir, { recursive: true });
  }

  // ─── Read ────────────────────────────────────────────────────

  /** Get all incidents for a chat (with expired entries cleaned). */
  getAll(chatId: number): IncidentRecord[] {
    const records = this.load(chatId);
    const now = DateTime.utc();

    // Expire old records
    const active: IncidentRecord[] = [];
    let changed = false;

    for (const r of records) {
      if (DateTime.fromISO(r.ttl) < now) {
        changed = true; // will be removed
      } else {
        active.push(r);
      }
    }

    if (changed) {
      this.save(chatId, active);
    }

    return active;
  }

  /** Get a specific incident by ID. */
  get(chatId: number, incidentId: string): IncidentRecord | null {
    return this.getAll(chatId).find((r) => r.id === incidentId) ?? null;
  }

  /** Check if an incident ID already exists (dedup). */
  exists(chatId: number, incidentId: string): boolean {
    return this.getAll(chatId).some((r) => r.id === incidentId);
  }

  // ─── Today's messages (for inter-message context) ────────────

  /** Get all messages sent today for a chat. */
  getTodayMessages(chatId: number): IncidentRecord[] {
    const records = this.getAll(chatId);
    const todayStart = DateTime.utc().startOf("day");

    return records.filter((r) => DateTime.fromISO(r.sentAt) >= todayStart);
  }

  /** Count proactive messages sent today (for anti-spam). */
  countToday(chatId: number): number {
    return this.getTodayMessages(chatId).length;
  }

  // ─── Write ───────────────────────────────────────────────────

  /** Record a new incident (message sent). */
  record(params: {
    chatId: number;
    incidentId: string;
    trigger: string;
    textSnippet: string;
    reasoning?: string;
    ttlMs?: number;
  }): IncidentRecord {
    const {
      chatId,
      incidentId,
      trigger,
      textSnippet,
      reasoning,
      ttlMs = NabuLedger.DEFAULT_TTL_MS,
    } = params;
    const now = DateTime.utc();

    const record: IncidentRecord = {
      id: incidentId,
      chatId,
      state: "sent",
      trigger,
      textSnippet: textSnippet.slice(0, 200),
      reasoning,
      sentAt: now.toISO()!,
      updatedAt: now.toISO()!,
      ttl: now.plus({ milliseconds: ttlMs }).toISO()!,
    };

    const records = this.getAll(chatId);
    records.push(IncidentRecordSchema.parse(record));
    this.save(chatId, records);

    return record;
  }

  // ─── State transitions ──────────────────────────────────────

  /** Transition an incident to a new state. */
  transition(
    chatId: number,
    incidentId: string,
    newState: IncidentState,
    opts?: { reaction?: string; cooldownMs?: number },
  ): IncidentRecord | null {
    const records = this.getAll(chatId);
    const idx = records.findIndex((r) => r.id === incidentId);
    if (idx === -1) return null;

    const record = records[idx]!;
    const now = DateTime.utc();

    // Validate transition
    if (!this.isValidTransition(record.state, newState)) {
      return null;
    }

    record.state = newState;
    record.updatedAt = now.toISO()!;

    if (opts?.reaction) {
      record.reaction = opts.reaction;
    }

    if (opts?.cooldownMs) {
      record.cooldownUntil = now.plus({ milliseconds: opts.cooldownMs }).toISO()!;
    } else if (newState === "acked" || newState === "dismissed") {
      // Default cooldown on user interaction
      record.cooldownUntil = now.plus({ milliseconds: NabuLedger.DEFAULT_COOLDOWN_MS }).toISO()!;
    }

    records[idx] = record;
    this.save(chatId, records);

    return record;
  }

  /** Acknowledge an incident. */
  ack(chatId: number, incidentId: string, reaction?: string): IncidentRecord | null {
    return this.transition(chatId, incidentId, "acked", { reaction });
  }

  /** Dismiss an incident. */
  dismiss(chatId: number, incidentId: string, reaction?: string): IncidentRecord | null {
    return this.transition(chatId, incidentId, "dismissed", { reaction });
  }

  // ─── Cooldown check ─────────────────────────────────────────

  /** Check if any cooldown is active for this chat. */
  isInCooldown(chatId: number): boolean {
    const records = this.getAll(chatId);
    const now = DateTime.utc();

    return records.some((r) => r.cooldownUntil && DateTime.fromISO(r.cooldownUntil) > now);
  }

  // ─── Cleanup ────────────────────────────────────────────────

  /** Remove all incidents older than maxAge. */
  cleanup(chatId: number, maxAgeMs: number = NabuLedger.DEFAULT_TTL_MS): void {
    const records = this.getAll(chatId);
    const cutoff = DateTime.utc().minus({ milliseconds: maxAgeMs });

    const kept = records.filter((r) => DateTime.fromISO(r.sentAt) >= cutoff);
    this.save(chatId, kept);
  }

  // ─── Internal ───────────────────────────────────────────────

  private isValidTransition(from: IncidentState, to: IncidentState): boolean {
    const transitions: Record<IncidentState, IncidentState[]> = {
      sent: ["acked", "dismissed", "expired"],
      acked: [], // terminal
      dismissed: [], // terminal
      expired: [], // terminal
    };
    return transitions[from]?.includes(to) ?? false;
  }

  private load(chatId: number): IncidentRecord[] {
    if (this.cache.has(chatId)) {
      return [...this.cache.get(chatId)!];
    }

    const filePath = this.ledgerFilePath(chatId);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const records = Array.isArray(raw) ? raw.map((r) => IncidentRecordSchema.parse(r)) : [];
      this.cache.set(chatId, records);
      return [...records];
    } catch {
      return [];
    }
  }

  private save(chatId: number, records: IncidentRecord[]): void {
    const filePath = this.ledgerFilePath(chatId);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;

    fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
    this.cache.set(chatId, records);
  }

  private ledgerFilePath(chatId: number): string {
    return path.join(this.ledgerDir, `${chatId}.json`);
  }
}
