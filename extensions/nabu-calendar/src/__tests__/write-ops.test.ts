import * as crypto from "node:crypto";
import { describe, expect, it } from "vitest";

// ─── Replicate the helper logic from index.ts for unit testing ──────
// These mirror the closure-scoped helpers in the plugin to test the algorithms.

function resolveWriteParams(params: {
  eventLocation?: string;
  place?: string;
  attendees?: string[];
}): {
  resolvedLocation: string | undefined;
  canonicalAttendees: string[];
  invalidEmails: string[];
} {
  const resolvedLocation = params.eventLocation || params.place || undefined;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const trimmed = (params.attendees || []).map((e) => e.trim().toLowerCase());
  const invalidEmails = trimmed.filter((e) => e && !emailRegex.test(e));
  const canonicalAttendees = [...new Set(trimmed.filter((e) => emailRegex.test(e)))].sort();

  return { resolvedLocation, canonicalAttendees, invalidEmails };
}

function buildCreateEventBody(params: {
  summary: string;
  startDateTime: string;
  endDateTime: string;
  resolvedLocation: string | undefined;
  eventDescription: string | undefined;
  canonicalAttendees: string[];
  addGoogleMeet: boolean;
  idempotencyKey: string;
}) {
  return {
    summary: params.summary,
    start: { dateTime: params.startDateTime },
    end: { dateTime: params.endDateTime },
    ...(params.resolvedLocation && { location: params.resolvedLocation }),
    ...(params.eventDescription && { description: params.eventDescription }),
    ...(params.canonicalAttendees.length > 0 && {
      attendees: params.canonicalAttendees.map((e) => ({ email: e })),
    }),
    ...(params.addGoogleMeet && {
      conferenceData: {
        createRequest: {
          requestId: params.idempotencyKey,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  };
}

function makeDeterministicKey(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

function generateConfirmToken(payload: Record<string, unknown>, secret: string): string {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("write-ops helpers", () => {
  // Test 1: skipPreview + attendees + place
  it("resolves attendees, place alias, and builds event body correctly", () => {
    const { resolvedLocation, canonicalAttendees, invalidEmails } = resolveWriteParams({
      place: "Кафе Пушкин",
      attendees: ["Wife@Gmail.com", "  friend@ya.ru  "],
    });

    expect(resolvedLocation).toBe("Кафе Пушкин");
    expect(canonicalAttendees).toEqual(["friend@ya.ru", "wife@gmail.com"]);
    expect(invalidEmails).toHaveLength(0);

    const body = buildCreateEventBody({
      summary: "Ужин",
      startDateTime: "2026-03-05T19:00:00+03:00",
      endDateTime: "2026-03-05T20:30:00+03:00",
      resolvedLocation,
      eventDescription: undefined,
      canonicalAttendees,
      addGoogleMeet: false,
      idempotencyKey: "test-key",
    });

    expect(body.location).toBe("Кафе Пушкин");
    expect(body.attendees).toEqual([{ email: "friend@ya.ru" }, { email: "wife@gmail.com" }]);
    expect(body).not.toHaveProperty("conferenceData");
  });

  // Test 2: retry idempotency — deterministic key
  it("produces identical idempotency key for same params (retry-safe)", () => {
    const payload = {
      chatId: 12345,
      summary: "Встреча",
      startDateTime: "2026-03-05T10:00:00+03:00",
      endDateTime: "2026-03-05T11:00:00+03:00",
      location: undefined,
      description: undefined,
      attendees: ["a@b.com"],
      addGoogleMeet: false,
    };

    const key1 = makeDeterministicKey(payload);
    const key2 = makeDeterministicKey(payload);

    expect(key1).toBe(key2);
    expect(key1).toHaveLength(32);
  });

  // Test 3: HMAC consistency — canonical attendees in preview and confirm
  it("HMAC matches when raw attendees are canonicalized identically", () => {
    const secret = "test-secret";

    // Simulate preview path
    const raw1 = ["B@C.com", "  a@b.com  "];
    const { canonicalAttendees: canonical1 } = resolveWriteParams({ attendees: raw1 });
    const previewPayload = {
      action: "create_event",
      chatId: 123,
      summary: "Test",
      attendees: canonical1,
      idempotencyKey: "key-1",
      exp: 999,
    };
    const token = generateConfirmToken(previewPayload, secret);

    // Simulate confirm path (same raw input, re-canonicalized)
    const raw2 = ["B@C.com", "  a@b.com  "];
    const { canonicalAttendees: canonical2 } = resolveWriteParams({ attendees: raw2 });
    const confirmPayload = {
      action: "create_event",
      chatId: 123,
      summary: "Test",
      attendees: canonical2,
      idempotencyKey: "key-1",
      exp: 999,
    };

    expect(canonical1).toEqual(canonical2);
    expect(generateConfirmToken(confirmPayload, secret)).toBe(token);
  });

  // Test 4: invalid email → hard error
  it("reports invalid emails instead of silently dropping them", () => {
    const { canonicalAttendees, invalidEmails } = resolveWriteParams({
      attendees: ["not-an-email", "valid@ok.com", "also bad", "another@fine.org"],
    });

    expect(invalidEmails).toEqual(["not-an-email", "also bad"]);
    expect(canonicalAttendees).toEqual(["another@fine.org", "valid@ok.com"]);
  });

  // Test 5: Google Meet — conferenceData in event body
  it("includes conferenceData when addGoogleMeet is true", () => {
    const body = buildCreateEventBody({
      summary: "Sync с командой",
      startDateTime: "2026-03-05T10:00:00+03:00",
      endDateTime: "2026-03-05T11:00:00+03:00",
      resolvedLocation: undefined,
      eventDescription: undefined,
      canonicalAttendees: [],
      addGoogleMeet: true,
      idempotencyKey: "meet-key-123",
    });

    expect(body.conferenceData).toBeDefined();
    expect(body.conferenceData!.createRequest.requestId).toBe("meet-key-123");
    expect(body.conferenceData!.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
  });

  // Test 6: stale_confirmation — preview without Meet + confirm with Meet
  it("HMAC fails when addGoogleMeet changes between preview and confirm", () => {
    const secret = "test-secret";

    const previewPayload = {
      action: "create_event",
      chatId: 123,
      summary: "Meeting",
      addGoogleMeet: false,
      idempotencyKey: "key-1",
      exp: 999,
    };
    const token = generateConfirmToken(previewPayload, secret);

    // Confirm with addGoogleMeet changed to true
    const confirmPayload = {
      ...previewPayload,
      addGoogleMeet: true,
    };

    expect(generateConfirmToken(confirmPayload, secret)).not.toBe(token);
  });

  // Test 7: offline create without addGoogleMeet has no conferenceData
  it("does not include conferenceData when addGoogleMeet is false", () => {
    const body = buildCreateEventBody({
      summary: "Ужин в ресторане",
      startDateTime: "2026-03-05T19:00:00+03:00",
      endDateTime: "2026-03-05T21:00:00+03:00",
      resolvedLocation: "Белый Кролик",
      eventDescription: "Бронь на двоих",
      canonicalAttendees: ["wife@gmail.com"],
      addGoogleMeet: false,
      idempotencyKey: "offline-key",
    });

    expect(body).not.toHaveProperty("conferenceData");
    expect(body.location).toBe("Белый Кролик");
    expect(body.attendees).toEqual([{ email: "wife@gmail.com" }]);
  });

  // Test: eventLocation takes precedence over place
  it("eventLocation takes precedence over place alias", () => {
    const { resolvedLocation } = resolveWriteParams({
      eventLocation: "Exact Location",
      place: "Alias Location",
    });
    expect(resolvedLocation).toBe("Exact Location");
  });

  // Test: deduplication of attendees
  it("deduplicates attendees (case-insensitive)", () => {
    const { canonicalAttendees } = resolveWriteParams({
      attendees: ["a@b.com", "A@B.COM", "a@b.com", "c@d.com"],
    });
    expect(canonicalAttendees).toEqual(["a@b.com", "c@d.com"]);
  });

  // Test: different events at same time produce different keys
  it("different summaries at same time produce different idempotency keys", () => {
    const base = {
      chatId: 123,
      startDateTime: "2026-03-05T10:00:00+03:00",
      endDateTime: "2026-03-05T11:00:00+03:00",
      location: undefined,
      description: undefined,
      attendees: [] as string[],
      addGoogleMeet: false,
    };

    const key1 = makeDeterministicKey({ ...base, summary: "Meeting A" });
    const key2 = makeDeterministicKey({ ...base, summary: "Meeting B" });

    expect(key1).not.toBe(key2);
  });

  // Test: same event with/without Meet produces different keys
  it("same event with vs without Meet produces different idempotency keys", () => {
    const base = {
      chatId: 123,
      summary: "Sync",
      startDateTime: "2026-03-05T10:00:00+03:00",
      endDateTime: "2026-03-05T11:00:00+03:00",
      location: undefined,
      description: undefined,
      attendees: [] as string[],
    };

    const key1 = makeDeterministicKey({ ...base, addGoogleMeet: false });
    const key2 = makeDeterministicKey({ ...base, addGoogleMeet: true });

    expect(key1).not.toBe(key2);
  });
});
