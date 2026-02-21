import { describe, expect, it } from "vitest";
import { VoiceCallWebhookServer } from "./webhook.js";

describe("sanitizeTask", () => {
  it("strips phone-number prefix from task", () => {
    const result = VoiceCallWebhookServer.sanitizeTask(
      "позвонить по номеру +7 960 821 5178 и забронировать столик",
    );
    expect(result).toBe("Забронировать столик");
  });

  it("strips prefix without 'по номеру'", () => {
    const result = VoiceCallWebhookServer.sanitizeTask(
      "позвонить +79608215178 и узнать расписание",
    );
    expect(result).toBe("Узнать расписание");
  });

  it("preserves task when no phone prefix", () => {
    const result = VoiceCallWebhookServer.sanitizeTask(
      "Забронировать столик на имя Елена, завтра 20:00",
    );
    expect(result).toBe("Забронировать столик на имя Елена, завтра 20:00");
  });

  it("preserves conditions and clarifications", () => {
    const result = VoiceCallWebhookServer.sanitizeTask(
      "позвонить +7 960 821 5178 и забронировать столик, если нет мест — уточнить ближайшее время",
    );
    expect(result).toBe("Забронировать столик, если нет мест — уточнить ближайшее время");
  });

  it("collapses extra whitespace", () => {
    const result = VoiceCallWebhookServer.sanitizeTask("  забронировать   столик   на   двоих  ");
    expect(result).toBe("Забронировать столик на двоих");
  });

  it("caps at 300 chars", () => {
    const longTask = "а".repeat(400);
    const result = VoiceCallWebhookServer.sanitizeTask(longTask);
    expect(result.length).toBe(300);
  });

  it("capitalizes first letter after stripping", () => {
    const result = VoiceCallWebhookServer.sanitizeTask("позвонить +79608215178 и уточнить наличие");
    expect(result.charAt(0)).toBe("У");
  });
});
