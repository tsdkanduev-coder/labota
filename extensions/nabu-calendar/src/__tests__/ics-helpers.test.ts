import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../types.js";
import {
  extractAttendees,
  extractOrganizer,
  filterByDate,
  filterByRange,
  findFreeSlots,
  mapStatus,
  mapTransparency,
  toISO,
} from "../ics-helpers.js";

const TZ = "Europe/Moscow";

function makeEvent(
  overrides: Partial<CalendarEvent> & { uid: string; summary: string; start: string; end: string },
): CalendarEvent {
  return {
    status: "confirmed",
    transparency: "opaque",
    attendees: [],
    isRecurring: false,
    allDay: false,
    ...overrides,
  };
}

// ─── toISO ──────────────────────────────────────────────────────

describe("toISO", () => {
  it("converts timed event with timezone", () => {
    const date = new Date("2026-03-01T10:00:00Z") as Date & { tz?: string };
    date.tz = "Europe/Moscow";
    const iso = toISO(date, TZ, false);
    expect(iso).toContain("2026-03-01T13:00:00"); // UTC+3
  });

  it("converts all-day event using UTC components (D6)", () => {
    // Simulates node-ical parsing VALUE=DATE:20260301
    const date = new Date(Date.UTC(2026, 2, 1)) as Date & { tz?: string };
    const iso = toISO(date, TZ, true);
    expect(iso).toContain("2026-03-01T00:00:00");
  });

  it("falls back to provided timezone when event has no tz", () => {
    const date = new Date("2026-03-01T10:00:00Z") as Date & { tz?: string };
    const iso = toISO(date, "America/New_York", false);
    expect(iso).toContain("2026-03-01T05:00:00"); // UTC-5
  });
});

// ─── extractAttendees ───────────────────────────────────────────

describe("extractAttendees", () => {
  it("returns empty for undefined", () => {
    expect(extractAttendees(undefined)).toEqual([]);
  });

  it("extracts from string", () => {
    expect(extractAttendees("alice@example.com")).toEqual(["alice@example.com"]);
  });

  it("extracts CN from object", () => {
    const attendee = { params: { CN: "Alice" }, val: "mailto:alice@example.com" };
    expect(extractAttendees(attendee)).toEqual(["Alice"]);
  });

  it("falls back to val when no CN", () => {
    const attendee = { val: "mailto:alice@example.com" };
    expect(extractAttendees(attendee)).toEqual(["alice@example.com"]);
  });

  it("handles array of attendees", () => {
    const attendees = [
      { params: { CN: "Alice" }, val: "mailto:alice@example.com" },
      { params: { CN: "Bob" }, val: "mailto:bob@example.com" },
    ];
    expect(extractAttendees(attendees)).toEqual(["Alice", "Bob"]);
  });

  it("filters out empty strings", () => {
    expect(extractAttendees([{}, "alice@example.com"])).toEqual(["alice@example.com"]);
  });
});

// ─── extractOrganizer ───────────────────────────────────────────

describe("extractOrganizer", () => {
  it("returns undefined for falsy", () => {
    expect(extractOrganizer(undefined)).toBeUndefined();
  });

  it("extracts from string", () => {
    expect(extractOrganizer("mailto:org@example.com")).toBe("org@example.com");
  });

  it("extracts CN from object", () => {
    expect(extractOrganizer({ params: { CN: "Org" }, val: "mailto:org@example.com" })).toBe("Org");
  });
});

// ─── mapStatus / mapTransparency ────────────────────────────────

describe("mapStatus", () => {
  it("maps CONFIRMED", () => expect(mapStatus("CONFIRMED")).toBe("confirmed"));
  it("maps TENTATIVE", () => expect(mapStatus("TENTATIVE")).toBe("tentative"));
  it("maps CANCELLED", () => expect(mapStatus("CANCELLED")).toBe("cancelled"));
  it("defaults to confirmed", () => expect(mapStatus(undefined)).toBe("confirmed"));
});

describe("mapTransparency", () => {
  it("maps TRANSPARENT", () => expect(mapTransparency("TRANSPARENT")).toBe("transparent"));
  it("maps OPAQUE", () => expect(mapTransparency("OPAQUE")).toBe("opaque"));
  it("defaults to opaque", () => expect(mapTransparency(undefined)).toBe("opaque"));
});

// ─── filterByDate ───────────────────────────────────────────────

describe("filterByDate", () => {
  const events: CalendarEvent[] = [
    makeEvent({
      uid: "1",
      summary: "Morning",
      start: "2026-03-01T10:00:00+03:00",
      end: "2026-03-01T11:00:00+03:00",
    }),
    makeEvent({
      uid: "2",
      summary: "Afternoon",
      start: "2026-03-01T14:00:00+03:00",
      end: "2026-03-01T15:00:00+03:00",
    }),
    makeEvent({
      uid: "3",
      summary: "Tomorrow",
      start: "2026-03-02T10:00:00+03:00",
      end: "2026-03-02T11:00:00+03:00",
    }),
  ];

  it("filters by specific date", () => {
    const result = filterByDate(events, "2026-03-01", TZ);
    expect(result.map((e) => e.uid)).toEqual(["1", "2"]);
  });

  it("returns empty for no matches", () => {
    const result = filterByDate(events, "2026-03-05", TZ);
    expect(result).toEqual([]);
  });

  it("handles all-day event with exclusive end (D1)", () => {
    // All-day event on March 1 has end = March 2 00:00 (exclusive)
    const allDayEvents: CalendarEvent[] = [
      makeEvent({
        uid: "allday",
        summary: "All Day",
        start: "2026-03-01T00:00:00+03:00",
        end: "2026-03-02T00:00:00+03:00",
        allDay: true,
      }),
    ];
    // Should appear on March 1
    expect(filterByDate(allDayEvents, "2026-03-01", TZ).length).toBe(1);
    // Should NOT appear on March 2
    expect(filterByDate(allDayEvents, "2026-03-02", TZ).length).toBe(0);
  });

  it("handles multi-day event", () => {
    const multiDay: CalendarEvent[] = [
      makeEvent({
        uid: "multi",
        summary: "Conference",
        start: "2026-03-01T09:00:00+03:00",
        end: "2026-03-03T18:00:00+03:00",
      }),
    ];
    expect(filterByDate(multiDay, "2026-03-01", TZ).length).toBe(1);
    expect(filterByDate(multiDay, "2026-03-02", TZ).length).toBe(1);
    expect(filterByDate(multiDay, "2026-03-03", TZ).length).toBe(1);
    expect(filterByDate(multiDay, "2026-03-04", TZ).length).toBe(0);
  });

  it("returns empty for invalid date (D8)", () => {
    expect(filterByDate(events, "not-a-date", TZ)).toEqual([]);
  });
});

// ─── filterByRange ──────────────────────────────────────────────

describe("filterByRange", () => {
  const events: CalendarEvent[] = [
    makeEvent({
      uid: "1",
      summary: "A",
      start: "2026-03-01T10:00:00+03:00",
      end: "2026-03-01T11:00:00+03:00",
    }),
    makeEvent({
      uid: "2",
      summary: "B",
      start: "2026-03-05T10:00:00+03:00",
      end: "2026-03-05T11:00:00+03:00",
    }),
    makeEvent({
      uid: "3",
      summary: "C",
      start: "2026-03-10T10:00:00+03:00",
      end: "2026-03-10T11:00:00+03:00",
    }),
  ];

  it("filters by range", () => {
    const result = filterByRange(events, "2026-03-01", "2026-03-06", TZ);
    expect(result.map((e) => e.uid)).toEqual(["1", "2"]);
  });

  it("returns empty for invalid range", () => {
    expect(filterByRange(events, "bad", "worse", TZ)).toEqual([]);
  });
});

// ─── findFreeSlots ──────────────────────────────────────────────

describe("findFreeSlots", () => {
  it("finds gaps between meetings", () => {
    const events: CalendarEvent[] = [
      makeEvent({
        uid: "1",
        summary: "A",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
      }),
      makeEvent({
        uid: "2",
        summary: "B",
        start: "2026-03-01T14:00:00+03:00",
        end: "2026-03-01T15:00:00+03:00",
      }),
    ];
    const slots = findFreeSlots(events, 9, 18, 30, "2026-03-01", TZ);
    // Expected gaps: 09:00-10:00 (60m), 11:00-14:00 (180m), 15:00-18:00 (180m)
    expect(slots.length).toBe(3);
    expect(slots[0]!.durationMin).toBe(60);
    expect(slots[1]!.durationMin).toBe(180);
    expect(slots[2]!.durationMin).toBe(180);
  });

  it("merges overlapping meetings", () => {
    const events: CalendarEvent[] = [
      makeEvent({
        uid: "1",
        summary: "A",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T12:00:00+03:00",
      }),
      makeEvent({
        uid: "2",
        summary: "B",
        start: "2026-03-01T11:00:00+03:00",
        end: "2026-03-01T13:00:00+03:00",
      }),
    ];
    const slots = findFreeSlots(events, 9, 18, 30, "2026-03-01", TZ);
    // Merged busy: 10:00-13:00. Gaps: 09:00-10:00 (60m), 13:00-18:00 (300m)
    expect(slots.length).toBe(2);
    expect(slots[0]!.durationMin).toBe(60);
    expect(slots[1]!.durationMin).toBe(300);
  });

  it("returns full workday when no meetings", () => {
    const slots = findFreeSlots([], 9, 18, 30, "2026-03-01", TZ);
    expect(slots.length).toBe(1);
    expect(slots[0]!.durationMin).toBe(540); // 9 hours
  });

  it("skips cancelled events", () => {
    const events: CalendarEvent[] = [
      makeEvent({
        uid: "1",
        summary: "Cancelled",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        status: "cancelled",
      }),
    ];
    const slots = findFreeSlots(events, 9, 18, 30, "2026-03-01", TZ);
    expect(slots[0]!.durationMin).toBe(540); // full workday
  });

  it("skips transparent events (D9)", () => {
    const events: CalendarEvent[] = [
      makeEvent({
        uid: "1",
        summary: "FYI",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        transparency: "transparent",
      }),
    ];
    const slots = findFreeSlots(events, 9, 18, 30, "2026-03-01", TZ);
    expect(slots[0]!.durationMin).toBe(540);
  });

  it("skips all-day events (D9)", () => {
    const events: CalendarEvent[] = [
      makeEvent({
        uid: "1",
        summary: "Holiday",
        start: "2026-03-01T00:00:00+03:00",
        end: "2026-03-02T00:00:00+03:00",
        allDay: true,
      }),
    ];
    const slots = findFreeSlots(events, 9, 18, 30, "2026-03-01", TZ);
    expect(slots[0]!.durationMin).toBe(540);
  });

  it("respects minimum duration", () => {
    const events: CalendarEvent[] = [
      makeEvent({
        uid: "1",
        summary: "A",
        start: "2026-03-01T09:15:00+03:00",
        end: "2026-03-01T18:00:00+03:00",
      }),
    ];
    // Gap is 09:00-09:15 = 15 min, below 30 min threshold
    const slots = findFreeSlots(events, 9, 18, 30, "2026-03-01", TZ);
    expect(slots.length).toBe(0);
  });
});
