import { DateTime } from "luxon";
import type { CalendarDiff, CalendarEvent, EventChange } from "./types.js";

/**
 * Compare two event arrays and return structured diff.
 *
 * Key: uid::recurrenceId for recurring, uid for non-recurring.
 * Codex fix: NOT using start in key — so event time changes
 * are detected as "modified", not "remove + add".
 */
export function computeDiff(prev: CalendarEvent[], curr: CalendarEvent[]): CalendarDiff {
  const prevMap = new Map<string, CalendarEvent>();
  const currMap = new Map<string, CalendarEvent>();

  for (const e of prev) prevMap.set(eventKey(e), e);
  for (const e of curr) currMap.set(eventKey(e), e);

  const added: CalendarEvent[] = [];
  const removed: CalendarEvent[] = [];
  const modified: EventChange[] = [];

  // Events in curr but not in prev = added
  for (const [key, event] of currMap) {
    if (!prevMap.has(key)) {
      added.push(event);
    }
  }

  // Events in prev but not in curr = removed
  for (const [key, event] of prevMap) {
    if (!currMap.has(key)) {
      removed.push(event);
    }
  }

  // Events in both = check for modifications
  for (const [key, currEvent] of currMap) {
    const prevEvent = prevMap.get(key);
    if (!prevEvent) continue;

    const changes = detectChanges(prevEvent, currEvent);
    if (changes.length > 0) {
      modified.push({ event: currEvent, changes });
    }
  }

  return { added, removed, modified };
}

// ─── Internal helpers ───────────────────────────────────────────

/**
 * Stable event key.
 * - Recurring instances: uid::recurrenceId
 * - Non-recurring: uid
 */
function eventKey(e: CalendarEvent): string {
  if (e.recurrenceId) return `${e.uid}::${e.recurrenceId}`;
  return e.uid;
}

/**
 * Fields to compare and their human-readable labels.
 */
const COMPARED_FIELDS: Array<{
  field: keyof CalendarEvent;
  label: string;
  format?: (v: unknown) => string;
}> = [
  { field: "summary", label: "title" },
  { field: "start", label: "time", format: formatTime },
  { field: "end", label: "end", format: formatTime },
  { field: "location", label: "location" },
  { field: "status", label: "status" },
];

/**
 * Detect changes between two versions of the same event.
 * Returns human-readable change descriptions.
 */
function detectChanges(prev: CalendarEvent, curr: CalendarEvent): string[] {
  const changes: string[] = [];

  for (const { field, label, format } of COMPARED_FIELDS) {
    const oldVal = prev[field];
    const newVal = curr[field];

    // Normalize: treat undefined and "" as equivalent
    const oldNorm = oldVal == null || oldVal === "" ? undefined : oldVal;
    const newNorm = newVal == null || newVal === "" ? undefined : newVal;

    if (oldNorm !== newNorm) {
      const oldStr = format ? format(oldNorm) : String(oldNorm ?? "");
      const newStr = format ? format(newNorm) : String(newNorm ?? "");
      changes.push(`${label}: '${oldStr}' \u2192 '${newStr}'`);
    }
  }

  return changes;
}

/**
 * Format ISO datetime to human-readable time (HH:mm).
 */
function formatTime(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  // D10: use setZone to preserve the offset embedded in the ISO string,
  // so HH:mm reflects the user's local time (not the server's TZ).
  const dt = DateTime.fromISO(v, { setZone: true });
  if (!dt.isValid) return String(v);
  return dt.toFormat("HH:mm");
}
