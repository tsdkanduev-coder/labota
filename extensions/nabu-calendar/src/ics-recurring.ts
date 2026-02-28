import type { VEvent } from "node-ical";
import { DateTime } from "luxon";
import type { CalendarEvent } from "./types.js";
import {
  extractAttendees,
  extractOrganizer,
  mapStatus,
  mapTransparency,
  toISO,
} from "./ics-helpers.js";

/**
 * Expand a recurring VEvent into concrete CalendarEvent instances
 * within the given time window.
 *
 * Handles: RRULE, EXDATE, modified instances (event.recurrences).
 * Timezone: corrects for rrule.between() UTC-as-local quirk.
 */
export function expandRecurring(
  event: VEvent,
  windowStart: DateTime,
  windowEnd: DateTime,
  timezone: string,
): CalendarEvent[] {
  if (!event.rrule) {
    // No RRULE — might have recurrenceId but no expansion needed
    return [];
  }

  const isAllDay = event.datetype === "date";
  const eventDurationMs = (event.end?.getTime() ?? event.start.getTime()) - event.start.getTime();

  // 1. Generate occurrences via rrule.between()
  const dates = event.rrule.between(
    windowStart.toJSDate(),
    windowEnd.toJSDate(),
    true, // inclusive
  );

  // 2. Build EXDATE set for filtering
  const exdateSet = buildExdateSet(event.exdate, timezone, isAllDay);

  // 3. Build recurrences map (modified instances)
  const recurrenceMap = new Map<string, Omit<VEvent, "recurrences">>();
  if (event.recurrences) {
    for (const [key, recurrence] of Object.entries(event.recurrences)) {
      recurrenceMap.set(key, recurrence);
    }
  }

  const instances: CalendarEvent[] = [];
  const processedRecurrenceKeys = new Set<string>();

  for (const date of dates) {
    // Correct timezone: rrule.between() returns UTC Date objects where
    // UTC components represent LOCAL time in the event's timezone
    const corrected = correctRruleDate(date, event, timezone);
    const dateKey = corrected.toISODate()!;

    // Check EXDATE — compare full ISO datetime for timed events (Codex P1 fix)
    const exdateCheckKey = isAllDay ? dateKey : corrected.toISO()!;
    if (exdateSet.has(exdateCheckKey)) continue;

    // Check if this instance has been modified
    const recurrence = recurrenceMap.get(dateKey);
    if (recurrence) {
      processedRecurrenceKeys.add(dateKey);
      instances.push(convertModifiedInstance(recurrence, event.uid, timezone));
      continue;
    }

    // Regular instance
    const startDt = corrected;
    const endDt = corrected.plus({ milliseconds: eventDurationMs });

    instances.push({
      uid: event.uid,
      summary: event.summary || "",
      start: startDt.toISO()!,
      end: endDt.toISO()!,
      location: event.location || undefined,
      description: event.description || undefined,
      status: mapStatus(event.status),
      transparency: mapTransparency(event.transparency),
      attendees: extractAttendees(event.attendee),
      organizer: extractOrganizer(event.organizer),
      recurrenceId: corrected.toISO()!,
      isRecurring: true,
      allDay: isAllDay,
    });
  }

  // 4. Add modified instances not in rrule.between() result
  //    (e.g., instances moved to a different date)
  for (const [key, recurrence] of recurrenceMap) {
    if (processedRecurrenceKeys.has(key)) continue;

    const modified = convertModifiedInstance(recurrence, event.uid, timezone);

    // Only include if within window
    const modStart = DateTime.fromISO(modified.start);
    if (modStart >= windowStart && modStart < windowEnd) {
      instances.push(modified);
    }
  }

  return instances;
}

// ─── Internal helpers ───────────────────────────────────────────

/**
 * Correct rrule.between() date for timezone.
 *
 * rrule.between() returns UTC Date objects where the UTC components
 * represent LOCAL time in the event's timezone. NOT actual UTC.
 * Example: event at 10:00 Moscow → rrule returns Date with getUTCHours()=10
 */
function correctRruleDate(date: Date, event: VEvent, userTz: string): DateTime {
  const eventTz =
    event.rrule?.origOptions?.tzid || (event.start as Date & { tz?: string })?.tz || userTz;

  return DateTime.fromObject(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    },
    { zone: eventTz },
  );
}

/**
 * Build a Set of EXDATE strings for filtering.
 *
 * Codex P1 fix: for timed recurring events, compare full ISO datetime
 * not just date. This prevents excluding wrong instances when
 * multiple instances fall on the same day.
 */
function buildExdateSet(exdate: unknown, timezone: string, isAllDay: boolean): Set<string> {
  const set = new Set<string>();
  if (!exdate || typeof exdate !== "object") return set;

  const entries = Object.values(exdate as Record<string, unknown>);
  for (const entry of entries) {
    if (entry instanceof Date) {
      const dt = DateTime.fromJSDate(entry, {
        zone: (entry as Date & { tz?: string }).tz || timezone,
      });
      if (isAllDay) {
        set.add(dt.toISODate()!);
      } else {
        set.add(dt.toISO()!);
      }
    }
  }
  return set;
}

/**
 * Convert a modified recurrence instance (from event.recurrences) to CalendarEvent.
 */
function convertModifiedInstance(
  recurrence: Omit<VEvent, "recurrences">,
  parentUid: string,
  timezone: string,
): CalendarEvent {
  const isAllDay = recurrence.datetype === "date";

  const recurrenceIdDate = recurrence.recurrenceid || recurrence.start;
  const recurrenceIdStr =
    recurrenceIdDate instanceof Date
      ? toISO(recurrenceIdDate as Date & { tz?: string }, timezone, isAllDay)
      : String(recurrenceIdDate);

  return {
    uid: recurrence.uid || parentUid,
    summary: recurrence.summary || "",
    start: toISO(recurrence.start as Date & { tz?: string }, timezone, isAllDay),
    end: toISO((recurrence.end || recurrence.start) as Date & { tz?: string }, timezone, isAllDay),
    location: recurrence.location || undefined,
    description: recurrence.description || undefined,
    status: mapStatus(recurrence.status),
    transparency: mapTransparency(recurrence.transparency),
    attendees: extractAttendees(recurrence.attendee),
    organizer: extractOrganizer(recurrence.organizer),
    recurrenceId: recurrenceIdStr,
    isRecurring: true,
    allDay: isAllDay,
  };
}
