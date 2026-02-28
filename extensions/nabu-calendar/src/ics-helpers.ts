import { DateTime } from "luxon";
import type { CalendarEvent } from "./types.js";

// ─── Date Conversion ────────────────────────────────────────────

/**
 * Convert node-ical DateWithTimeZone to ISO string.
 * All events normalized to full datetime (including all-day).
 *
 * D6 fix: all-day uses getUTC* to avoid server-local TZ shift.
 * node-ical parses VALUE=DATE:20260301 with UTC components.
 */
export function toISO(date: Date & { tz?: string }, fallbackTz: string, isAllDay: boolean): string {
  if (isAllDay) {
    return DateTime.fromObject(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
      },
      { zone: fallbackTz },
    ).toISO()!;
  }
  const tz = date.tz || fallbackTz;
  return DateTime.fromJSDate(date, { zone: tz }).toISO()!;
}

// ─── Attendee Extraction ────────────────────────────────────────

/**
 * Extract attendee names/emails from node-ical attendee field.
 * Handles: string, object with params.CN/val, array, undefined.
 */
export function extractAttendees(attendee: unknown): string[] {
  if (!attendee) return [];
  const list = Array.isArray(attendee) ? attendee : [attendee];
  return list
    .map((a) => {
      if (typeof a === "string") return a;
      if (typeof a === "object" && a !== null) {
        const obj = a as Record<string, unknown>;
        const params = obj.params as Record<string, unknown> | undefined;
        const cn = params?.CN;
        const val = obj.val;
        if (typeof cn === "string" && cn) return cn;
        if (typeof val === "string") return val.replace("mailto:", "");
        return "";
      }
      return "";
    })
    .filter(Boolean);
}

/**
 * Extract organizer name/email from node-ical organizer field.
 */
export function extractOrganizer(organizer: unknown): string | undefined {
  if (!organizer) return undefined;
  if (typeof organizer === "string") return organizer.replace("mailto:", "");
  if (typeof organizer === "object" && organizer !== null) {
    const obj = organizer as Record<string, unknown>;
    const params = obj.params as Record<string, unknown> | undefined;
    const cn = params?.CN;
    const val = obj.val;
    if (typeof cn === "string" && cn) return cn;
    if (typeof val === "string") return val.replace("mailto:", "");
  }
  return undefined;
}

// ─── Event Filtering ────────────────────────────────────────────

/**
 * Filter events that overlap with a target day.
 * Works correctly for both datetime and all-day events
 * because all events are stored as ISO datetime.
 *
 * D1: all-day events have exclusive end (e.g., 1-day event on March 1
 * has end = March 2 00:00), which naturally works with this overlap check.
 */
export function filterByDate(events: CalendarEvent[], date: string, tz: string): CalendarEvent[] {
  const target = parseTargetDate(date, tz);
  if (!target.isValid) return []; // D8: invalid date → empty, not crash
  const dayEnd = target.plus({ days: 1 }); // exclusive end

  return events.filter((e) => {
    const start = DateTime.fromISO(e.start, { zone: tz });
    const end = DateTime.fromISO(e.end, { zone: tz });
    return start < dayEnd && end > target;
  });
}

/**
 * Filter events within a date range [from, to).
 * D8: invalid from/to → fallback to sensible defaults.
 */
export function filterByRange(
  events: CalendarEvent[],
  from: string | undefined,
  to: string | undefined,
  tz: string,
): CalendarEvent[] {
  const rangeStart = from
    ? DateTime.fromISO(from, { zone: tz })
    : DateTime.now().setZone(tz).startOf("day");
  const rangeEnd = to ? DateTime.fromISO(to, { zone: tz }) : rangeStart.plus({ days: 7 });

  if (!rangeStart.isValid || !rangeEnd.isValid) return [];

  return events.filter((e) => {
    const start = DateTime.fromISO(e.start, { zone: tz });
    const end = DateTime.fromISO(e.end, { zone: tz });
    return start < rangeEnd && end > rangeStart;
  });
}

// ─── Free Slot Finder ───────────────────────────────────────────

/**
 * Find free time slots between busy blocks within working hours.
 *
 * D9: skips all-day events unless opaque, skips transparent events,
 * skips cancelled events.
 */
export function findFreeSlots(
  events: CalendarEvent[],
  workdayStartHour: number,
  workdayEndHour: number,
  minDurationMin: number,
  date: string,
  tz: string,
): Array<{ start: string; end: string; durationMin: number }> {
  const dayTarget = parseTargetDate(date, tz);
  if (!dayTarget.isValid) return [];

  const workStart = dayTarget.set({ hour: workdayStartHour, minute: 0, second: 0 });
  const workEnd = dayTarget.set({ hour: workdayEndHour, minute: 0, second: 0 });

  // Filter: only opaque, non-cancelled, non-all-day-transparent events block time
  const blocking = events
    .filter((e) => {
      if (e.status === "cancelled") return false;
      if (e.transparency === "transparent") return false;
      // All-day "FYI" events don't block specific time slots
      if (e.allDay) return false;
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  // Build merged busy intervals
  const busyIntervals: Array<{ s: DateTime; e: DateTime }> = [];
  for (const event of blocking) {
    const s = DateTime.fromISO(event.start, { zone: tz });
    const e = DateTime.fromISO(event.end, { zone: tz });
    // Clamp to workday
    const clampedS = s < workStart ? workStart : s;
    const clampedE = e > workEnd ? workEnd : e;
    if (clampedS >= clampedE) continue;

    // Merge with previous if overlapping
    if (busyIntervals.length > 0) {
      const last = busyIntervals[busyIntervals.length - 1]!;
      if (clampedS <= last.e) {
        last.e = clampedE > last.e ? clampedE : last.e;
        continue;
      }
    }
    busyIntervals.push({ s: clampedS, e: clampedE });
  }

  // Walk through workday, find gaps
  const slots: Array<{ start: string; end: string; durationMin: number }> = [];
  let cursor = workStart;

  for (const busy of busyIntervals) {
    if (busy.s > cursor) {
      const gap = busy.s.diff(cursor, "minutes").minutes;
      if (gap >= minDurationMin) {
        slots.push({
          start: cursor.toISO()!,
          end: busy.s.toISO()!,
          durationMin: Math.round(gap),
        });
      }
    }
    cursor = busy.e > cursor ? busy.e : cursor;
  }

  // Gap after last busy block
  if (cursor < workEnd) {
    const gap = workEnd.diff(cursor, "minutes").minutes;
    if (gap >= minDurationMin) {
      slots.push({
        start: cursor.toISO()!,
        end: workEnd.toISO()!,
        durationMin: Math.round(gap),
      });
    }
  }

  return slots;
}

// ─── Status Mapping ─────────────────────────────────────────────

/**
 * Map ICS status string to our enum.
 */
export function mapStatus(icsStatus: string | undefined): "confirmed" | "tentative" | "cancelled" {
  if (!icsStatus) return "confirmed";
  const upper = icsStatus.toUpperCase();
  if (upper === "TENTATIVE") return "tentative";
  if (upper === "CANCELLED") return "cancelled";
  return "confirmed";
}

/**
 * Map ICS transparency to our enum.
 */
export function mapTransparency(icsTransparency: string | undefined): "opaque" | "transparent" {
  if (!icsTransparency) return "opaque";
  return icsTransparency.toUpperCase() === "TRANSPARENT" ? "transparent" : "opaque";
}

// ─── Internal helpers ───────────────────────────────────────────

function parseTargetDate(date: string, tz: string): DateTime {
  if (date === "today") return DateTime.now().setZone(tz).startOf("day");
  if (date === "tomorrow") return DateTime.now().setZone(tz).plus({ days: 1 }).startOf("day");
  return DateTime.fromISO(date, { zone: tz }).startOf("day");
}
