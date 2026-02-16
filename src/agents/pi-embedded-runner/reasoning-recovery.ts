import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { log } from "./logger.js";

type RecoveryResult = {
  recovered: boolean;
  changedMessages: number;
  droppedMessages: number;
  reason?: string;
};

type ResetResult = {
  reset: boolean;
  reason?: string;
};

function parseReasoningSignatureId(value: unknown): string | null {
  if (!value) {
    return null;
  }
  let candidate: { id?: unknown; type?: unknown } | null = null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return null;
    }
    try {
      candidate = JSON.parse(trimmed) as { id?: unknown; type?: unknown };
    } catch {
      return null;
    }
  } else if (typeof value === "object") {
    candidate = value as { id?: unknown; type?: unknown };
  }
  if (!candidate) {
    return null;
  }
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const type = typeof candidate.type === "string" ? candidate.type.trim() : "";
  if (!id.startsWith("rs_")) {
    return null;
  }
  if (type === "reasoning" || type.startsWith("reasoning.")) {
    return id;
  }
  return null;
}

function scrubAssistantReasoningSignatures(
  message: AgentMessage,
  itemId?: string,
): { message: AgentMessage | null; changed: boolean } {
  const role = (message as { role?: unknown }).role;
  if (role !== "assistant") {
    return { message, changed: false };
  }
  const assistant = message as Extract<AgentMessage, { role: "assistant" }>;
  if (!Array.isArray(assistant.content)) {
    return { message, changed: false };
  }

  let changed = false;
  const nextContent: typeof assistant.content = [];
  for (const block of assistant.content) {
    if (!block || typeof block !== "object") {
      nextContent.push(block);
      continue;
    }
    const record = block as {
      type?: unknown;
      thinking?: unknown;
      thinkingSignature?: unknown;
      signature?: unknown;
    };
    if (record.type !== "thinking") {
      nextContent.push(block);
      continue;
    }
    const signatureId =
      parseReasoningSignatureId(record.thinkingSignature) ??
      parseReasoningSignatureId(record.signature);
    if (!signatureId || (itemId && signatureId !== itemId)) {
      nextContent.push(block);
      continue;
    }

    changed = true;
    const nextBlock = { ...(block as unknown as Record<string, unknown>) };
    delete nextBlock.thinkingSignature;
    delete nextBlock.signature;
    const thinkingText = typeof nextBlock.thinking === "string" ? nextBlock.thinking.trim() : "";
    const hasMeaningfulFields = Object.keys(nextBlock).some(
      (key) => key !== "type" && key !== "thinking",
    );
    if (!thinkingText && !hasMeaningfulFields) {
      continue;
    }
    nextContent.push(nextBlock as unknown as (typeof assistant.content)[number]);
  }

  if (!changed) {
    return { message, changed: false };
  }
  if (nextContent.length === 0) {
    return { message: null, changed: true };
  }
  return {
    message: { ...assistant, content: nextContent } as AgentMessage,
    changed: true,
  };
}

function appendEntry(sessionManager: SessionManager, entry: Record<string, unknown>): void {
  const type = entry.type;
  if (type === "compaction") {
    sessionManager.appendCompaction(
      entry.summary as string,
      entry.firstKeptEntryId as string,
      entry.tokensBefore as number,
      entry.details as Record<string, unknown> | undefined,
      entry.fromHook as boolean | undefined,
    );
    return;
  }
  if (type === "thinking_level_change") {
    sessionManager.appendThinkingLevelChange(entry.thinkingLevel as string);
    return;
  }
  if (type === "model_change") {
    sessionManager.appendModelChange(entry.provider as string, entry.modelId as string);
    return;
  }
  if (type === "custom") {
    sessionManager.appendCustomEntry(entry.customType as string, entry.data);
    return;
  }
  if (type === "custom_message") {
    sessionManager.appendCustomMessageEntry(
      entry.customType as string,
      entry.content as Parameters<typeof sessionManager.appendCustomMessageEntry>[1],
      entry.display === true,
      entry.details as Record<string, unknown> | undefined,
    );
    return;
  }
  if (type === "session_info") {
    if (typeof entry.name === "string" && entry.name.trim()) {
      sessionManager.appendSessionInfo(entry.name);
    }
    return;
  }
}

export async function scrubOpenAIReasoningSignaturesInSession(params: {
  sessionFile: string;
  itemId?: string;
  sessionId?: string;
  sessionKey?: string;
}): Promise<RecoveryResult> {
  try {
    const sessionManager = SessionManager.open(params.sessionFile);
    const branch = sessionManager.getBranch();
    if (branch.length === 0) {
      return { recovered: false, changedMessages: 0, droppedMessages: 0, reason: "empty session" };
    }

    let firstChangedIndex = -1;
    let changedMessages = 0;
    let droppedMessages = 0;
    const transformedMessages = new Map<number, AgentMessage | null>();

    for (let i = 0; i < branch.length; i++) {
      const entry = branch[i] as unknown as Record<string, unknown>;
      if (entry.type !== "message") {
        continue;
      }
      const message = entry.message as AgentMessage;
      const transformed = scrubAssistantReasoningSignatures(message, params.itemId);
      if (!transformed.changed) {
        continue;
      }
      if (firstChangedIndex < 0) {
        firstChangedIndex = i;
      }
      changedMessages++;
      if (!transformed.message) {
        droppedMessages++;
      }
      transformedMessages.set(i, transformed.message);
    }

    if (firstChangedIndex < 0) {
      return {
        recovered: false,
        changedMessages: 0,
        droppedMessages: 0,
        reason: "no reasoning signatures matched",
      };
    }

    const firstChangedEntry = branch[firstChangedIndex] as { parentId?: string | null };
    const parentId =
      typeof firstChangedEntry.parentId === "string" ? firstChangedEntry.parentId : undefined;
    if (parentId) {
      sessionManager.branch(parentId);
    } else {
      sessionManager.resetLeaf();
    }

    for (let i = firstChangedIndex; i < branch.length; i++) {
      const entry = branch[i] as unknown as Record<string, unknown>;
      if (entry.type === "message") {
        const transformed = transformedMessages.get(i);
        if (transformed === null) {
          continue;
        }
        if (transformed) {
          sessionManager.appendMessage(
            transformed as Parameters<typeof sessionManager.appendMessage>[0],
          );
          continue;
        }
        sessionManager.appendMessage(
          entry.message as Parameters<typeof sessionManager.appendMessage>[0],
        );
        continue;
      }

      // These entries reference existing entry ids and are safe to skip during recovery replay.
      if (entry.type === "branch_summary" || entry.type === "label") {
        continue;
      }
      appendEntry(sessionManager, entry);
    }

    log.warn(
      `[openai-reasoning-recovery] scrubbed signatures: changed=${changedMessages} dropped=${droppedMessages} itemId=${params.itemId ?? "any"} sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
    );
    return { recovered: true, changedMessages, droppedMessages };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[openai-reasoning-recovery] scrub failed: ${message}`);
    return { recovered: false, changedMessages: 0, droppedMessages: 0, reason: message };
  }
}

export async function resetSessionForReasoningRecovery(params: {
  sessionFile: string;
  sessionId?: string;
  sessionKey?: string;
}): Promise<ResetResult> {
  try {
    const sessionManager = SessionManager.open(params.sessionFile);
    const branch = sessionManager.getBranch();
    if (branch.length === 0) {
      return { reset: false, reason: "empty session" };
    }
    sessionManager.resetLeaf();
    // resetLeaf() only updates in-memory state. Persist a new root marker so
    // subsequent SessionManager.open() calls resolve an empty active branch.
    sessionManager.appendCustomEntry("openai_reasoning_recovery_reset", {
      reason: "openai_reasoning_sequence",
      at: new Date().toISOString(),
    });
    log.warn(
      `[openai-reasoning-recovery] reset session history as last-resort recovery: sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
    );
    return { reset: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[openai-reasoning-recovery] reset failed: ${message}`);
    return { reset: false, reason: message };
  }
}
