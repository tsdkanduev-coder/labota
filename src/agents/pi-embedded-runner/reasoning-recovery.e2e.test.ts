import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resetSessionForReasoningRecovery } from "./reasoning-recovery.js";

function asAgentMessage(value: AgentMessage): AgentMessage {
  return value;
}

describe("resetSessionForReasoningRecovery", () => {
  it("persists reset across SessionManager reopen", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclaw-reasoning-reset-"));
    const sessionFile = path.join(dir, "session.jsonl");

    try {
      const sessionManager = SessionManager.open(sessionFile);
      sessionManager.appendMessage(
        asAgentMessage({
          role: "user",
          content: [{ type: "text", text: "hello" }],
        } as AgentMessage),
      );
      sessionManager.appendMessage(
        asAgentMessage({
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "internal",
              thinkingSignature: JSON.stringify({ id: "rs_test", type: "reasoning" }),
            },
          ],
          stopReason: "stop",
        } as AgentMessage),
      );

      const reset = await resetSessionForReasoningRecovery({
        sessionFile,
        sessionKey: "test-session",
      });
      expect(reset.reset).toBe(true);

      const reopened = SessionManager.open(sessionFile);
      const context = reopened.buildSessionContext();
      expect(context.messages).toEqual([]);

      const branch = reopened.getBranch();
      const tail = branch[branch.length - 1] as
        | { type?: unknown; customType?: unknown; parentId?: unknown }
        | undefined;
      expect(tail?.type).toBe("custom");
      expect(tail?.customType).toBe("openai_reasoning_recovery_reset");
      expect((tail?.parentId as string | null | undefined) ?? null).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
