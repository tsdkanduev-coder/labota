import { describe, expect, it } from "vitest";
import { parseLlmResponse, buildGoogleCalendarUrl, type BookingDetails } from "./index.js";

describe("parseLlmResponse", () => {
  it("parses valid JSON with summary and confirmed booking", () => {
    const raw = JSON.stringify({
      summary: "Мы забронировали столик.",
      booking: {
        confirmed: true,
        restaurant: "Белуга",
        date: "2025-02-25",
        time: "19:00",
        guestName: "Елена",
        guestCount: 4,
      },
    });
    const result = parseLlmResponse(raw);
    expect(result.summary).toBe("Мы забронировали столик.");
    expect(result.booking).not.toBeNull();
    expect(result.booking!.confirmed).toBe(true);
    expect(result.booking!.restaurant).toBe("Белуга");
    expect(result.booking!.date).toBe("2025-02-25");
    expect(result.booking!.time).toBe("19:00");
    expect(result.booking!.guestName).toBe("Елена");
    expect(result.booking!.guestCount).toBe(4);
  });

  it("returns booking null when booking is null in JSON", () => {
    const raw = JSON.stringify({ summary: "Звонок завершён.", booking: null });
    const result = parseLlmResponse(raw);
    expect(result.summary).toBe("Звонок завершён.");
    expect(result.booking).toBeNull();
  });

  it("returns booking null when confirmed is false", () => {
    const raw = JSON.stringify({
      summary: "Не удалось забронировать.",
      booking: { confirmed: false, restaurant: "Белуга" },
    });
    const result = parseLlmResponse(raw);
    expect(result.summary).toBe("Не удалось забронировать.");
    expect(result.booking).toBeNull();
  });

  it("falls back to raw text when JSON is invalid", () => {
    const raw = "This is not JSON at all";
    const result = parseLlmResponse(raw);
    expect(result.summary).toBe("This is not JSON at all");
    expect(result.booking).toBeNull();
  });

  it("uses raw text as summary when summary field is missing", () => {
    const raw = JSON.stringify({ booking: { confirmed: true, date: "2025-03-01" } });
    const result = parseLlmResponse(raw);
    expect(result.summary).toBe(raw);
    expect(result.booking).not.toBeNull();
  });

  it("ignores non-string/non-number booking fields", () => {
    const raw = JSON.stringify({
      summary: "OK",
      booking: {
        confirmed: true,
        restaurant: 123,
        date: "2025-02-25",
        time: "20:00",
        guestName: null,
        guestCount: "four",
      },
    });
    const result = parseLlmResponse(raw);
    expect(result.booking!.restaurant).toBeUndefined();
    expect(result.booking!.guestName).toBeUndefined();
    expect(result.booking!.guestCount).toBeUndefined();
    expect(result.booking!.date).toBe("2025-02-25");
  });
});

describe("buildGoogleCalendarUrl", () => {
  const fullBooking: BookingDetails = {
    confirmed: true,
    restaurant: "Белуга",
    date: "2025-02-25",
    time: "19:00",
    durationMinutes: 120,
    guestName: "Елена",
    guestCount: 4,
    address: "ул. Пушкина, д. 10",
  };

  it("generates correct URL with all fields", () => {
    const url = buildGoogleCalendarUrl(fullBooking)!;
    expect(url).toContain("https://calendar.google.com/calendar/render?");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("ctz=Europe%2FMoscow");
    // Start: 20250225T190000, End: 20250225T210000 (120 min)
    expect(url).toContain("dates=20250225T190000%2F20250225T210000");
    // Title should contain restaurant, name, count
    expect(url).toContain(encodeURIComponent("Бронь:"));
    expect(url).toContain(encodeURIComponent("Белуга"));
    expect(url).toContain(encodeURIComponent("Елена"));
    // URLSearchParams encodes spaces as '+', so check decoded values
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("text")).toContain("4 чел.");
    // Address as location
    expect(params.get("location")).toBe("ул. Пушкина, д. 10");
  });

  it("uses restaurant as location when no address", () => {
    const booking: BookingDetails = { ...fullBooking, address: undefined };
    const url = buildGoogleCalendarUrl(booking)!;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("location")).toBe("Белуга");
  });

  it("defaults duration to 90 minutes", () => {
    const booking: BookingDetails = { ...fullBooking, durationMinutes: undefined };
    const url = buildGoogleCalendarUrl(booking)!;
    // Start 19:00, +90min = 20:30
    expect(url).toContain("dates=20250225T190000%2F20250225T203000");
  });

  it("handles midnight overflow", () => {
    const booking: BookingDetails = {
      confirmed: true,
      date: "2025-02-25",
      time: "23:00",
      durationMinutes: 120,
    };
    const url = buildGoogleCalendarUrl(booking)!;
    // Start 23:00, +120min = 01:00 next day (day 26)
    expect(url).toContain("dates=20250225T230000%2F20250226T010000");
  });

  it("returns null when confirmed is false", () => {
    expect(buildGoogleCalendarUrl({ ...fullBooking, confirmed: false })).toBeNull();
  });

  it("returns null when date is missing", () => {
    expect(buildGoogleCalendarUrl({ ...fullBooking, date: undefined })).toBeNull();
  });

  it("returns null when time is missing", () => {
    expect(buildGoogleCalendarUrl({ ...fullBooking, time: undefined })).toBeNull();
  });

  it("returns null for invalid date format", () => {
    expect(buildGoogleCalendarUrl({ ...fullBooking, date: "25-02-2025" })).toBeNull();
    expect(buildGoogleCalendarUrl({ ...fullBooking, date: "2025/02/25" })).toBeNull();
  });

  it("returns null for invalid time format", () => {
    expect(buildGoogleCalendarUrl({ ...fullBooking, time: "7pm" })).toBeNull();
    expect(buildGoogleCalendarUrl({ ...fullBooking, time: "190" })).toBeNull();
  });

  it("generates fallback title when no restaurant/name/count", () => {
    const booking: BookingDetails = {
      confirmed: true,
      date: "2025-02-25",
      time: "19:00",
    };
    const url = buildGoogleCalendarUrl(booking)!;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("text")).toBe("Бронирование столика");
  });

  it("correctly URL-encodes Cyrillic text", () => {
    const url = buildGoogleCalendarUrl(fullBooking)!;
    // Should be a valid URL — no raw Cyrillic
    expect(url).not.toMatch(/[а-яА-ЯёЁ]/);
    // But should decode back correctly
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("text")).toContain("Белуга");
    expect(params.get("text")).toContain("Елена");
  });
});
