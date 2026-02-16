import { describe, expect, it } from "vitest";
import {
  extractOpenAIReasoningSequenceItemId,
  isOpenAIReasoningSequenceError,
} from "./pi-embedded-helpers.js";

describe("openai reasoning sequence error detection", () => {
  it("extracts the reasoning item id from OpenAI error text", () => {
    const raw =
      "400 Item 'rs_0fa401ea88262027006993440ba89081a09555e8ca9f4fadd6' of type 'reasoning' was provided without its required following item.";
    expect(extractOpenAIReasoningSequenceItemId(raw)).toBe(
      "rs_0fa401ea88262027006993440ba89081a09555e8ca9f4fadd6",
    );
    expect(isOpenAIReasoningSequenceError(raw)).toBe(true);
  });

  it("handles prefixed transport wrappers", () => {
    const raw =
      'OpenAI error: 400 Item "rs_deadbeef" of type "reasoning" was provided without the required following item.';
    expect(extractOpenAIReasoningSequenceItemId(raw)).toBe("rs_deadbeef");
    expect(isOpenAIReasoningSequenceError(raw)).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isOpenAIReasoningSequenceError("400 invalid_request_error: malformed json")).toBe(false);
    expect(extractOpenAIReasoningSequenceItemId("400 invalid_request_error")).toBeNull();
  });
});
