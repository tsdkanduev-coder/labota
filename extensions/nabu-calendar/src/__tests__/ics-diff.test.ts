import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../types.js";
import { computeDiff } from "../ics-diff.js";

// ─── Helpers ────────────────────────────────────────────────────

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

// ─── computeDiff ────────────────────────────────────────────────

describe("computeDiff", () => {
  it("detects added events", () => {
    const prev: CalendarEvent[] = [];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "new-1",
        summary: "New Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.added.length).toBe(1);
    expect(diff.added[0]!.uid).toBe("new-1");
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(0);
  });

  it("detects removed events", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "old-1",
        summary: "Old Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
      }),
    ];
    const curr: CalendarEvent[] = [];
    const diff = computeDiff(prev, curr);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(1);
    expect(diff.removed[0]!.uid).toBe("old-1");
    expect(diff.modified.length).toBe(0);
  });

  it("detects modified summary", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "mod-1",
        summary: "Old Title",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "mod-1",
        summary: "New Title",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0]!.changes.some((c) => c.includes("title"))).toBe(true);
    expect(diff.modified[0]!.changes.some((c) => c.includes("Old Title"))).toBe(true);
    expect(diff.modified[0]!.changes.some((c) => c.includes("New Title"))).toBe(true);
  });

  it("detects modified time", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "time-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "time-1",
        summary: "Meeting",
        start: "2026-03-01T14:00:00+03:00",
        end: "2026-03-01T15:00:00+03:00",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0]!.changes.some((c) => c.includes("time"))).toBe(true);
    expect(diff.modified[0]!.changes.some((c) => c.includes("10:00"))).toBe(true);
    expect(diff.modified[0]!.changes.some((c) => c.includes("14:00"))).toBe(true);
  });

  it("detects modified location", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "loc-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        location: "Room A",
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "loc-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        location: "Room B",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0]!.changes.some((c) => c.includes("location"))).toBe(true);
  });

  it("detects modified status", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "stat-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        status: "confirmed",
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "stat-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        status: "cancelled",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0]!.changes.some((c) => c.includes("status"))).toBe(true);
  });

  it("detects multiple changes in a single event", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "multi-1",
        summary: "Old",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        location: "Room A",
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "multi-1",
        summary: "New",
        start: "2026-03-01T14:00:00+03:00",
        end: "2026-03-01T15:00:00+03:00",
        location: "Room B",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.modified.length).toBe(1);
    // title + time + end + location = 4 changes
    expect(diff.modified[0]!.changes.length).toBeGreaterThanOrEqual(3);
  });

  it("reports no changes for identical events", () => {
    const events: CalendarEvent[] = [
      makeEvent({
        uid: "same-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
      }),
    ];
    const diff = computeDiff(events, events);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(0);
  });

  it("handles empty arrays", () => {
    const diff = computeDiff([], []);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(0);
  });

  it("handles complex scenario: add + remove + modify", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "keep",
        summary: "Keep Same",
        start: "2026-03-01T09:00:00+03:00",
        end: "2026-03-01T10:00:00+03:00",
      }),
      makeEvent({
        uid: "modify",
        summary: "Will Change",
        start: "2026-03-01T11:00:00+03:00",
        end: "2026-03-01T12:00:00+03:00",
      }),
      makeEvent({
        uid: "remove",
        summary: "Will Remove",
        start: "2026-03-01T14:00:00+03:00",
        end: "2026-03-01T15:00:00+03:00",
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "keep",
        summary: "Keep Same",
        start: "2026-03-01T09:00:00+03:00",
        end: "2026-03-01T10:00:00+03:00",
      }),
      makeEvent({
        uid: "modify",
        summary: "Changed Title",
        start: "2026-03-01T11:00:00+03:00",
        end: "2026-03-01T12:00:00+03:00",
      }),
      makeEvent({
        uid: "add",
        summary: "New Event",
        start: "2026-03-01T16:00:00+03:00",
        end: "2026-03-01T17:00:00+03:00",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.added.length).toBe(1);
    expect(diff.added[0]!.uid).toBe("add");
    expect(diff.removed.length).toBe(1);
    expect(diff.removed[0]!.uid).toBe("remove");
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0]!.event.uid).toBe("modify");
  });

  // ─── Recurring event keys ────────────────────────────────────

  it("uses uid::recurrenceId as key for recurring events", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "rec-1",
        summary: "Recurring",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        recurrenceId: "2026-03-01T10:00:00+03:00",
        isRecurring: true,
      }),
      makeEvent({
        uid: "rec-1",
        summary: "Recurring",
        start: "2026-03-08T10:00:00+03:00",
        end: "2026-03-08T11:00:00+03:00",
        recurrenceId: "2026-03-08T10:00:00+03:00",
        isRecurring: true,
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "rec-1",
        summary: "Recurring",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        recurrenceId: "2026-03-01T10:00:00+03:00",
        isRecurring: true,
      }),
      makeEvent({
        uid: "rec-1",
        summary: "Updated Recurring", // changed title for March 8 instance
        start: "2026-03-08T10:00:00+03:00",
        end: "2026-03-08T11:00:00+03:00",
        recurrenceId: "2026-03-08T10:00:00+03:00",
        isRecurring: true,
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0]!.event.summary).toBe("Updated Recurring");
  });

  it("detects time change as modification, not add+remove (Codex fix)", () => {
    // Key is uid (not uid::start), so time change = modification
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "moved-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "moved-1",
        summary: "Meeting",
        start: "2026-03-01T14:00:00+03:00",
        end: "2026-03-01T15:00:00+03:00",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0]!.changes.some((c) => c.includes("time"))).toBe(true);
  });

  it("treats undefined and empty string as equivalent", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "norm-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        location: undefined,
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "norm-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        location: "",
      }),
    ];
    const diff = computeDiff(prev, curr);
    // undefined ↔ "" should NOT be a change
    expect(diff.modified.length).toBe(0);
  });

  it("formats time changes as HH:mm", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "fmt-1",
        summary: "Meeting",
        start: "2026-03-01T10:30:00+03:00",
        end: "2026-03-01T11:30:00+03:00",
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "fmt-1",
        summary: "Meeting",
        start: "2026-03-01T15:45:00+03:00",
        end: "2026-03-01T16:45:00+03:00",
      }),
    ];
    const diff = computeDiff(prev, curr);
    expect(diff.modified.length).toBe(1);
    const timeChange = diff.modified[0]!.changes.find((c) => c.includes("time"));
    expect(timeChange).toBeDefined();
    expect(timeChange).toContain("10:30");
    expect(timeChange).toContain("15:45");
  });

  it("ignores fields not in COMPARED_FIELDS (description, attendees)", () => {
    const prev: CalendarEvent[] = [
      makeEvent({
        uid: "ignore-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        description: "Old description",
        attendees: ["Alice"],
      }),
    ];
    const curr: CalendarEvent[] = [
      makeEvent({
        uid: "ignore-1",
        summary: "Meeting",
        start: "2026-03-01T10:00:00+03:00",
        end: "2026-03-01T11:00:00+03:00",
        description: "New description",
        attendees: ["Alice", "Bob"],
      }),
    ];
    const diff = computeDiff(prev, curr);
    // description and attendees changes should be ignored
    expect(diff.modified.length).toBe(0);
  });
});
