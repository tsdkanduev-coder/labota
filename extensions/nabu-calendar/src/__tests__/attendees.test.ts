import crypto from "crypto";
import { describe, expect, it } from "vitest";

// ─── Copied from index.ts (not exported, test them directly) ──────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function canonicalizeAttendees(emails?: string[]): string[] | undefined {
  if (!emails || emails.length === 0) return undefined;
  return [...new Set(emails.map((e) => e.trim().toLowerCase()))].sort();
}

function generateConfirmToken(secret: string, payload: Record<string, unknown>): string {
  const data = JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

// ─── Test 1: Canonicalize ──────────────────────────────────────────

describe("canonicalizeAttendees", () => {
  it("trims, lowercases, dedupes, and sorts", () => {
    const input = [" Wife@Gmail.COM ", "alice@b.com", "wife@gmail.com"];
    expect(canonicalizeAttendees(input)).toEqual(["alice@b.com", "wife@gmail.com"]);
  });

  it("returns undefined for empty array", () => {
    expect(canonicalizeAttendees([])).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(canonicalizeAttendees(undefined)).toBeUndefined();
  });

  it("handles single email", () => {
    expect(canonicalizeAttendees(["Alice@Example.COM"])).toEqual(["alice@example.com"]);
  });

  it("sorts alphabetically", () => {
    expect(canonicalizeAttendees(["z@b.com", "a@b.com", "m@b.com"])).toEqual([
      "a@b.com",
      "m@b.com",
      "z@b.com",
    ]);
  });
});

// ─── Test 2: Email validation ──────────────────────────────────────

describe("EMAIL_RE validation", () => {
  it("accepts valid emails", () => {
    expect(EMAIL_RE.test("user@example.com")).toBe(true);
    expect(EMAIL_RE.test("alice.bob@company.co.uk")).toBe(true);
    expect(EMAIL_RE.test("test+tag@gmail.com")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(EMAIL_RE.test("not-an-email")).toBe(false);
    expect(EMAIL_RE.test("also bad")).toBe(false);
    expect(EMAIL_RE.test("@no-local.com")).toBe(false);
    expect(EMAIL_RE.test("no-domain@")).toBe(false);
    expect(EMAIL_RE.test("")).toBe(false);
  });

  it("detects invalid in canonicalized list", () => {
    const attendees = canonicalizeAttendees(["valid@email.com", "not-an-email", "also bad"]);
    const invalid = attendees?.filter((e) => !EMAIL_RE.test(e));
    expect(invalid).toEqual(["also bad", "not-an-email"]);
  });
});

// ─── Test 3: Server merge ──────────────────────────────────────────

describe("server-side attendee merge", () => {
  // Simulate the merge logic from handleUpdateEvent preview path
  function mergeAttendees(
    existingAttendees: Array<{ email: string; self?: boolean }>,
    newEmails: string[],
  ): Array<{ email: string }> {
    const existingEmails = existingAttendees
      .filter((a) => !a.self)
      .map((a) => a.email.toLowerCase());
    const canonical = canonicalizeAttendees(newEmails) || [];
    const merged = [...new Set([...existingEmails, ...canonical])].sort();
    return merged.map((email) => ({ email }));
  }

  it("merges existing + new, filters self", () => {
    const existing = [{ email: "alice@b.com" }, { email: "owner@me.com", self: true }];
    const result = mergeAttendees(existing, ["bob@c.com"]);
    expect(result).toEqual([{ email: "alice@b.com" }, { email: "bob@c.com" }]);
  });

  it("deduplicates when adding already-existing attendee", () => {
    const existing = [{ email: "alice@b.com" }];
    const result = mergeAttendees(existing, ["alice@b.com", "bob@c.com"]);
    expect(result).toEqual([{ email: "alice@b.com" }, { email: "bob@c.com" }]);
  });

  it("handles empty existing attendees", () => {
    const result = mergeAttendees([], ["new@user.com"]);
    expect(result).toEqual([{ email: "new@user.com" }]);
  });

  it("handles case-insensitive dedup with existing", () => {
    const existing = [{ email: "Alice@B.COM" }];
    const result = mergeAttendees(existing, ["alice@b.com"]);
    expect(result).toEqual([{ email: "alice@b.com" }]);
  });
});

// ─── Test 4: HMAC stale on attendee change ─────────────────────────

describe("HMAC stale on attendee change", () => {
  const secret = "test-secret-key-for-hmac";

  it("verify passes with same attendees", () => {
    const payload = {
      action: "create_event",
      chatId: 123,
      summary: "Dinner",
      attendees: ["a@b.com"],
    };
    const token = generateConfirmToken(secret, payload);
    const token2 = generateConfirmToken(secret, payload);
    expect(token).toBe(token2);
  });

  it("verify fails with different attendees", () => {
    const previewPayload = {
      action: "create_event",
      chatId: 123,
      summary: "Dinner",
      attendees: ["a@b.com"],
    };
    const confirmPayload = {
      action: "create_event",
      chatId: 123,
      summary: "Dinner",
      attendees: ["c@d.com"],
    };
    const previewToken = generateConfirmToken(secret, previewPayload);
    const confirmToken = generateConfirmToken(secret, confirmPayload);
    expect(previewToken).not.toBe(confirmToken);
  });

  it("verify fails with reordered attendees (without canonicalization)", () => {
    const payload1 = {
      action: "create_event",
      attendees: ["a@b.com", "c@d.com"],
    };
    const payload2 = {
      action: "create_event",
      attendees: ["c@d.com", "a@b.com"],
    };
    const token1 = generateConfirmToken(secret, payload1);
    const token2 = generateConfirmToken(secret, payload2);
    // Without canonicalization, different order = different HMAC
    expect(token1).not.toBe(token2);
  });

  it("verify passes with canonicalized attendees regardless of input order", () => {
    const canon1 = canonicalizeAttendees(["c@d.com", "a@b.com"]);
    const canon2 = canonicalizeAttendees(["a@b.com", "c@d.com"]);
    const payload1 = { action: "create_event", attendees: canon1 };
    const payload2 = { action: "create_event", attendees: canon2 };
    const token1 = generateConfirmToken(secret, payload1);
    const token2 = generateConfirmToken(secret, payload2);
    // With canonicalization, order doesn't matter
    expect(token1).toBe(token2);
  });
});
