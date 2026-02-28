import type { VEvent } from "node-ical";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { expandRecurring } from "../ics-recurring.js";

const TZ = "Europe/Moscow";

// ─── Helpers ────────────────────────────────────────────────────

/** Minimal VEvent factory for testing */
function makeVEvent(overrides: Partial<VEvent> & { uid: string }): VEvent {
  return {
    type: "VEVENT",
    params: {},
    summary: "Test Event",
    start: new Date("2026-03-01T10:00:00Z"),
    end: new Date("2026-03-01T11:00:00Z"),
    datetype: "date-time",
    ...overrides,
  } as unknown as VEvent;
}

/** Create a mock rrule that returns given dates */
function mockRrule(dates: Date[], tzid?: string | null) {
  return {
    between: (_start: Date, _end: Date, _inc: boolean) => dates,
    // Pass null to simulate Google Calendar Z-suffix (no tzid in rrule origOptions)
    origOptions: { tzid: tzid === null ? undefined : (tzid ?? TZ) },
  };
}

const WINDOW_START = DateTime.fromISO("2026-03-01T00:00:00", { zone: TZ });
const WINDOW_END = DateTime.fromISO("2026-03-31T23:59:59", { zone: TZ });

// ─── Tests ──────────────────────────────────────────────────────

describe("expandRecurring", () => {
  it("returns empty for events without RRULE", () => {
    const event = makeVEvent({ uid: "no-rrule" });
    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result).toEqual([]);
  });

  it("expands weekly recurring event", () => {
    // Simulate rrule returning 4 Mondays in March
    const dates = [
      new Date(Date.UTC(2026, 2, 2, 10, 0)), // Mon March 2
      new Date(Date.UTC(2026, 2, 9, 10, 0)), // Mon March 9
      new Date(Date.UTC(2026, 2, 16, 10, 0)), // Mon March 16
      new Date(Date.UTC(2026, 2, 23, 10, 0)), // Mon March 23
    ];

    const event = makeVEvent({
      uid: "weekly-sync",
      summary: "Weekly Sync",
      start: new Date("2026-03-02T10:00:00Z"),
      end: new Date("2026-03-02T11:00:00Z"),
      datetype: "date-time",
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result.length).toBe(4);

    // All instances should share UID
    expect(result.every((e) => e.uid === "weekly-sync")).toBe(true);

    // All instances should be marked recurring
    expect(result.every((e) => e.isRecurring)).toBe(true);

    // Each should have a recurrenceId
    expect(result.every((e) => e.recurrenceId !== undefined)).toBe(true);

    // Summary should propagate
    expect(result[0]!.summary).toBe("Weekly Sync");
  });

  it("preserves event duration for each instance", () => {
    // Event is 90 minutes
    const dates = [new Date(Date.UTC(2026, 2, 1, 10, 0))];
    const event = makeVEvent({
      uid: "long-meeting",
      start: new Date("2026-03-01T10:00:00Z"),
      end: new Date("2026-03-01T11:30:00Z"), // 90 min
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result.length).toBe(1);

    const start = DateTime.fromISO(result[0]!.start);
    const end = DateTime.fromISO(result[0]!.end);
    const durationMin = end.diff(start, "minutes").minutes;
    expect(durationMin).toBe(90);
  });

  it("excludes EXDATE instances", () => {
    // 3 occurrences, but March 9 is excluded
    const dates = [
      new Date(Date.UTC(2026, 2, 2, 10, 0)),
      new Date(Date.UTC(2026, 2, 9, 10, 0)), // excluded
      new Date(Date.UTC(2026, 2, 16, 10, 0)),
    ];

    const exdate: Record<string, Date> = {};
    // Simulate node-ical EXDATE: the Date represents local time 10:00 Moscow.
    // node-ical stores EXDATE dates where the tz property indicates the timezone.
    // buildExdateSet uses DateTime.fromJSDate(date, { zone: date.tz }) to get the
    // ISO string. So the Date must represent the ACTUAL UTC moment corresponding
    // to 10:00 Moscow (which is 07:00 UTC in March, UTC+3).
    const exdateDate = new Date("2026-03-09T07:00:00Z") as Date & { tz?: string };
    exdateDate.tz = TZ;
    exdate["20260309T100000"] = exdateDate;

    const event = makeVEvent({
      uid: "with-exdate",
      start: new Date("2026-03-02T10:00:00Z"),
      end: new Date("2026-03-02T11:00:00Z"),
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
      exdate: exdate as unknown as VEvent["exdate"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result.length).toBe(2);
  });

  it("handles EXDATE for all-day events (date-only comparison)", () => {
    const dates = [
      new Date(Date.UTC(2026, 2, 1, 0, 0)),
      new Date(Date.UTC(2026, 2, 2, 0, 0)), // excluded
      new Date(Date.UTC(2026, 2, 3, 0, 0)),
    ];

    const exdateDate = new Date(Date.UTC(2026, 2, 2, 0, 0)) as Date & { tz?: string };
    exdateDate.tz = TZ;

    const event = makeVEvent({
      uid: "allday-exdate",
      summary: "All Day Series",
      start: new Date(Date.UTC(2026, 2, 1, 0, 0)),
      end: new Date(Date.UTC(2026, 2, 2, 0, 0)), // next day = exclusive end
      datetype: "date",
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
      exdate: { "20260302": exdateDate } as unknown as VEvent["exdate"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result.length).toBe(2);
    expect(result.every((e) => e.allDay)).toBe(true);
  });

  it("uses modified instance from recurrences", () => {
    const dates = [
      new Date(Date.UTC(2026, 2, 2, 10, 0)),
      new Date(Date.UTC(2026, 2, 9, 10, 0)), // this one is modified
      new Date(Date.UTC(2026, 2, 16, 10, 0)),
    ];

    const modifiedInstance = {
      type: "VEVENT",
      params: {},
      uid: "with-modified",
      summary: "Moved Meeting", // changed title
      start: new Date("2026-03-09T14:00:00Z") as Date & { tz?: string }, // moved to 14:00
      end: new Date("2026-03-09T15:00:00Z") as Date & { tz?: string },
      datetype: "date-time",
      recurrenceid: new Date("2026-03-09T10:00:00Z"),
    };
    modifiedInstance.start.tz = TZ;
    modifiedInstance.end.tz = TZ;

    const event = makeVEvent({
      uid: "with-modified",
      summary: "Original Meeting",
      start: new Date("2026-03-02T10:00:00Z"),
      end: new Date("2026-03-02T11:00:00Z"),
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
      recurrences: {
        "2026-03-09": modifiedInstance,
      } as unknown as VEvent["recurrences"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result.length).toBe(3);

    // The March 9 instance should have modified summary
    const modifiedResult = result.find((e) => e.summary === "Moved Meeting");
    expect(modifiedResult).toBeDefined();
    expect(modifiedResult!.isRecurring).toBe(true);
  });

  it("adds moved recurrence instances outside normal rrule dates", () => {
    // rrule returns March 2 and 9, but recurrences has March 15 (moved from March 9)
    const dates = [new Date(Date.UTC(2026, 2, 2, 10, 0))];

    const movedInstance = {
      type: "VEVENT",
      params: {},
      uid: "moved-event",
      summary: "Moved to 15th",
      start: new Date("2026-03-15T10:00:00Z") as Date & { tz?: string },
      end: new Date("2026-03-15T11:00:00Z") as Date & { tz?: string },
      datetype: "date-time",
      recurrenceid: new Date("2026-03-09T10:00:00Z"),
    };
    movedInstance.start.tz = TZ;
    movedInstance.end.tz = TZ;

    const event = makeVEvent({
      uid: "moved-event",
      summary: "Regular Meeting",
      start: new Date("2026-03-02T10:00:00Z"),
      end: new Date("2026-03-02T11:00:00Z"),
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
      recurrences: {
        // Key not matching any rrule date → will be added in step 4
        "2026-03-09": movedInstance,
      } as unknown as VEvent["recurrences"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    // rrule gives 1 (March 2) + moved instance (March 15) = 2
    expect(result.length).toBe(2);
    expect(result.some((e) => e.summary === "Moved to 15th")).toBe(true);
  });

  it("skips moved instances outside the window", () => {
    const dates = [new Date(Date.UTC(2026, 2, 2, 10, 0))];

    const movedInstance = {
      type: "VEVENT",
      params: {},
      uid: "moved-outside",
      summary: "Moved Far",
      start: new Date("2026-05-01T10:00:00Z") as Date & { tz?: string }, // May, outside window
      end: new Date("2026-05-01T11:00:00Z") as Date & { tz?: string },
      datetype: "date-time",
    };
    movedInstance.start.tz = TZ;
    movedInstance.end.tz = TZ;

    const event = makeVEvent({
      uid: "moved-outside",
      start: new Date("2026-03-02T10:00:00Z"),
      end: new Date("2026-03-02T11:00:00Z"),
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
      recurrences: {
        "2026-03-09": movedInstance,
      } as unknown as VEvent["recurrences"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    // Only the rrule date, not the moved one (outside window)
    expect(result.length).toBe(1);
  });

  it("handles timezone correction for rrule dates", () => {
    // rrule.between() returns UTC Dates where UTC components = local time
    // e.g., event at 10:00 Moscow → Date with getUTCHours() === 10
    const dates = [new Date(Date.UTC(2026, 2, 1, 10, 0))]; // "10:00 local"

    const event = makeVEvent({
      uid: "tz-corrected",
      summary: "TZ Test",
      start: new Date("2026-03-01T10:00:00Z"),
      end: new Date("2026-03-01T11:00:00Z"),
      datetype: "date-time",
      rrule: mockRrule(dates, TZ) as unknown as VEvent["rrule"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result.length).toBe(1);

    // The start time should reflect 10:00 in Moscow timezone
    const startDt = DateTime.fromISO(result[0]!.start, { zone: TZ });
    expect(startDt.hour).toBe(10);
    expect(startDt.minute).toBe(0);
  });

  it("propagates attendees and organizer to instances", () => {
    const dates = [new Date(Date.UTC(2026, 2, 1, 10, 0))];

    const event = makeVEvent({
      uid: "with-attendees",
      summary: "Team Sync",
      start: new Date("2026-03-01T10:00:00Z"),
      end: new Date("2026-03-01T11:00:00Z"),
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
      attendee: [
        { params: { CN: "Alice" }, val: "mailto:alice@example.com" },
        { params: { CN: "Bob" }, val: "mailto:bob@example.com" },
      ],
      organizer: { params: { CN: "Manager" }, val: "mailto:mgr@example.com" },
    } as unknown as Partial<VEvent> & { uid: string });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result[0]!.attendees).toEqual(["Alice", "Bob"]);
    expect(result[0]!.organizer).toBe("Manager");
  });

  it("handles event with no end date", () => {
    // Some events might not have end date — duration = 0
    const dates = [new Date(Date.UTC(2026, 2, 1, 10, 0))];

    const event = makeVEvent({
      uid: "no-end",
      summary: "Instant",
      start: new Date("2026-03-01T10:00:00Z"),
      end: undefined as unknown as Date,
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result.length).toBe(1);
    // Start and end should be the same (0 duration)
    expect(result[0]!.start).toBe(result[0]!.end);
  });

  it("maps status and transparency correctly", () => {
    const dates = [new Date(Date.UTC(2026, 2, 1, 10, 0))];

    const event = makeVEvent({
      uid: "status-test",
      start: new Date("2026-03-01T10:00:00Z"),
      end: new Date("2026-03-01T11:00:00Z"),
      rrule: mockRrule(dates) as unknown as VEvent["rrule"],
      status: "TENTATIVE" as unknown as VEvent["status"],
      transparency: "TRANSPARENT" as unknown as VEvent["transparency"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result[0]!.status).toBe("tentative");
    expect(result[0]!.transparency).toBe("transparent");
  });

  it("outputs ISO in userTz for Google Calendar Z-suffix events (D10)", () => {
    // Google Calendar: DTSTART:20260301T070000Z (= 10:00 Moscow)
    // node-ical: date.tz = "Etc/UTC", JS Date = UTC 07:00
    // rrule.between() returns Date with getUTCHours()=7 (UTC components = event's original UTC time)
    // But wait — rrule sees the DTSTART as "07:00 in the rrule's tzid zone"
    // For Z-suffix events, rrule origOptions.tzid is typically undefined,
    // and event.start.tz = "Etc/UTC". So correctRruleDate interprets
    // getUTCHours()=7 as "07:00 in Etc/UTC" → moment = 07:00 UTC = 10:00 Moscow.
    // The key D10 fix: .setZone(timezone) ensures output ISO shows +03:00.
    const startDate = new Date("2026-03-01T07:00:00Z") as Date & { tz?: string };
    startDate.tz = "Etc/UTC"; // Google Calendar Z-suffix behavior

    const dates = [new Date(Date.UTC(2026, 2, 1, 7, 0))]; // rrule returns UTC components

    const event = makeVEvent({
      uid: "google-utc-recurring",
      summary: "Google Event",
      start: startDate,
      end: new Date("2026-03-01T08:00:00Z"),
      datetype: "date-time",
      rrule: mockRrule(dates, null) as unknown as VEvent["rrule"],
    });

    const result = expandRecurring(event, WINDOW_START, WINDOW_END, TZ);
    expect(result.length).toBe(1);

    // ISO must express time in Moscow timezone
    expect(result[0]!.start).toContain("T10:00:00");
    expect(result[0]!.start).toContain("+03:00");
    expect(result[0]!.end).toContain("T11:00:00");
    expect(result[0]!.end).toContain("+03:00");
  });
});
