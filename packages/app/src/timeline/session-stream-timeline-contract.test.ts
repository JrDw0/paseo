import { describe, expect, it } from "vitest";
import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";
import {
  applyStreamEvent,
  flushHeadToTail,
  hydrateStreamState,
  type AgentToolCallItem,
  type AssistantMessageItem,
  type StreamItem,
  type ThoughtItem,
} from "@/types/stream";
import {
  processTimelineResponse,
  type ProcessTimelineResponseInput,
} from "./session-stream-reducers";

// ---------------------------------------------------------------------------
// Purpose
// ---------------------------------------------------------------------------
// Behavior-contract tests for the session-stream timeline reducer's three hot
// spots. These pin down the exact observable semantics so a future refactor of
// the implementation (e.g. avoiding O(n) array copies) can rederive it without
// changing behavior:
//
//   1. flushHeadToTail(tail, head)                    - src/types/stream.ts
//   2. mergePrependedCanonicalTail(older, current)    - src/timeline/session-stream-reducers.ts
//   3. applyStreamEvent head/tail lane discipline     - src/types/stream.ts
//
// mergePrependedCanonicalTail is module-private (not exported). Its behavior is
// only reachable through processTimelineResponse with payload.direction ===
// "before" (the prepend boundary path). We pin it through that public path. The
// "olderTail empty returns currentTail" branch is unreachable there (the prepend
// path only calls merge when acceptedUnits.length > 0), so it is intentionally
// not tested — documented, not forced.
//
// All tests are deterministic: no timers, no randomness.

// ---------------------------------------------------------------------------
// Test helpers (mirrors session-stream-reducers.test.ts factory style)
// ---------------------------------------------------------------------------

function makeTimelineEntry(
  seq: number,
  text: string,
  type: string = "assistant_message",
  seqEnd = seq,
) {
  return {
    seqStart: seq,
    seqEnd,
    provider: "claude",
    item: { type, text },
    timestamp: new Date(1000 + seq).toISOString(),
  };
}

function makeToolCallTimelineEntry(
  seq: number,
  callId: string,
  status: "running" | "completed",
  detail: Record<string, unknown>,
) {
  return {
    seqStart: seq,
    seqEnd: seq,
    provider: "claude",
    item: {
      type: "tool_call",
      callId,
      name: "Read",
      status,
      detail,
      error: null,
    },
    timestamp: new Date(1000 + seq).toISOString(),
  };
}

function assistantTimelineEvent(text: string, messageId?: string): AgentStreamEventPayload {
  return {
    type: "timeline",
    provider: "claude",
    item: { type: "assistant_message", text, ...(messageId ? { messageId } : {}) },
  } as AgentStreamEventPayload;
}

function toolCallTimelineEvent(
  callId: string,
  status: "running" | "completed" = "running",
  detail: Record<string, unknown> = { type: "unknown", input: null, output: null },
): AgentStreamEventPayload {
  return {
    type: "timeline",
    provider: "claude",
    item: {
      type: "tool_call",
      callId,
      name: "Read",
      status,
      detail,
      error: null,
    },
  } as AgentStreamEventPayload;
}

function makeAssistantItem(text: string, id = `assistant-${text.length}`): AssistantMessageItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: new Date(1000),
  };
}

function makeThoughtItem(
  text: string,
  id = `thought-${text.length}`,
  status: ThoughtItem["status"] = "loading",
): ThoughtItem {
  return { kind: "thought", id, text, timestamp: new Date(1000), status };
}

function makeUserMessageItem(
  text: string,
  id = `user-${text.length}`,
): Extract<StreamItem, { kind: "user_message" }> {
  return { kind: "user_message", id, text, timestamp: new Date(1000) };
}

function getAssistantTexts(items: StreamItem[]): string[] {
  return items
    .filter((item): item is AssistantMessageItem => item.kind === "assistant_message")
    .map((item) => item.text);
}

function getAgentToolCalls(items: StreamItem[]): AgentToolCallItem[] {
  return items.filter(
    (item): item is AgentToolCallItem =>
      item.kind === "tool_call" && item.payload.source === "agent",
  );
}

const baseTimelineInput: ProcessTimelineResponseInput = {
  payload: {
    agentId: "agent-1",
    direction: "before",
    reset: false,
    epoch: "epoch-1",
    startCursor: null,
    endCursor: null,
    entries: [],
    error: null,
    hasNewer: false,
    hasOlder: false,
  },
  currentTail: [],
  currentHead: [],
  currentCursor: { epoch: "epoch-1", startSeq: 3, endSeq: 5 },
  isInitializing: false,
  hasActiveInitDeferred: false,
  initRequestDirection: "tail",
};

// ---------------------------------------------------------------------------
// flushHeadToTail
// ---------------------------------------------------------------------------

describe("flushHeadToTail", () => {
  it("returns the tail reference unchanged when head is empty", () => {
    const tail = [makeAssistantItem("existing", "tail-id")];
    const result = flushHeadToTail(tail, []);
    expect(result).toBe(tail);
  });

  it("dedups head items whose id already exists in tail", () => {
    const dup = makeAssistantItem("dup", "dup-id");
    const tail = [dup];
    const result = flushHeadToTail(tail, [dup]);
    expect(result).toBe(tail); // nothing new to add
    expect(result).toHaveLength(1);
  });

  it("appends only head items not already in tail, so an id is never duplicated", () => {
    const dup = makeAssistantItem("dup", "dup-id");
    const fresh = makeAssistantItem("new", "new-id");
    const tail = [dup];
    const result = flushHeadToTail(tail, [dup, fresh]);
    expect(result).toEqual([dup, fresh]);
    expect(result).toHaveLength(2);
    expect(result).not.toBe(tail);
  });

  it("returns a new array concatenating tail and head without mutating either input", () => {
    const tailItem = makeAssistantItem("tail", "tail-id");
    const headItem = makeAssistantItem("head", "head-id");
    const tail = [tailItem];
    const head = [headItem];

    const result = flushHeadToTail(tail, head);

    expect(result).toEqual([tailItem, headItem]);
    expect(result).not.toBe(tail);
    // Inputs untouched: same item references, same lengths.
    expect(tail).toHaveLength(1);
    expect(tail[0]).toBe(tailItem);
    expect(head).toHaveLength(1);
    expect(head[0]).toBe(headItem);
  });

  it("finalizes head thoughts to ready in the output without mutating the input head", () => {
    const loading = makeThoughtItem("thinking", "thought-1", "loading");
    const head = [loading];

    const result = flushHeadToTail([], head);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("thought");
    expect((result[0] as ThoughtItem).status).toBe("ready");
    // Input untouched.
    expect(head[0].status).toBe("loading");
  });

  it("finalizes a head assistant block id from blockGroupId/blockIndex without mutating the input", () => {
    const blocked: AssistantMessageItem = {
      ...makeAssistantItem("block", "raw-id"),
      blockGroupId: "g1",
      blockIndex: 1,
    };
    const head = [blocked];

    const result = flushHeadToTail([], head);

    expect(result).toHaveLength(1);
    expect((result[0] as AssistantMessageItem).id).toBe("g1:block:1");
    expect(head[0].id).toBe("raw-id");
  });
});

// ---------------------------------------------------------------------------
// mergePrependedCanonicalTail (via processTimelineResponse direction "before")
// ---------------------------------------------------------------------------

describe("mergePrependedCanonicalTail (through the before-page prepend path)", () => {
  it("returns the hydrated older tail when the current tail is empty", () => {
    const result = processTimelineResponse({
      ...baseTimelineInput,
      currentTail: [],
      payload: {
        ...baseTimelineInput.payload,
        direction: "before",
        epoch: "epoch-1",
        startCursor: { seq: 1 },
        endCursor: { seq: 2 },
        entries: [makeTimelineEntry(1, "older chunk ")],
      },
    });

    expect(getAssistantTexts(result.tail)).toEqual(["older chunk "]);
  });

  it("concats two boundary assistant messages, merging text and taking timelineCursor from currentFirst", () => {
    const currentFirst: AssistantMessageItem = {
      ...makeAssistantItem("newer chunk", "assistant-newer"),
      timelineCursor: { epoch: "epoch-1", seq: 3 },
    };
    const result = processTimelineResponse({
      ...baseTimelineInput,
      currentTail: [currentFirst],
      payload: {
        ...baseTimelineInput.payload,
        direction: "before",
        epoch: "epoch-1",
        startCursor: { seq: 1 },
        endCursor: { seq: 2 },
        entries: [makeTimelineEntry(1, "older chunk ")],
      },
    });

    const merged = result.tail.find((item) => item.kind === "assistant_message");
    expect(getAssistantTexts(result.tail)).toEqual(["older chunk newer chunk"]);
    expect(merged).toMatchObject({ timelineCursor: { epoch: "epoch-1", seq: 3 } });
  });

  it("coalesces two same-callId tool_calls at the boundary into one merged agent tool call", () => {
    const callId = "toolu_contract";
    const currentTail = hydrateStreamState(
      [
        {
          event: toolCallTimelineEvent(callId, "completed", {
            type: "read",
            filePath: "/tmp/a.ts",
          }),
          timestamp: new Date(3000),
        },
      ],
      { source: "canonical" },
    );

    const result = processTimelineResponse({
      ...baseTimelineInput,
      currentTail,
      payload: {
        ...baseTimelineInput.payload,
        direction: "before",
        epoch: "epoch-1",
        startCursor: { seq: 1 },
        endCursor: { seq: 2 },
        entries: [
          makeToolCallTimelineEntry(1, callId, "running", {
            type: "unknown",
            input: { file_path: "/tmp/a.ts" },
            output: null,
          }),
        ],
      },
    });

    const tools = getAgentToolCalls(result.tail);
    expect(tools).toHaveLength(1);
    expect(tools[0].payload.data.callId).toBe(callId);
    expect(tools[0].payload.data.status).toBe("completed");
  });

  it("plainly concatenates when the boundary item kinds differ (no merge), without mutating the current tail", () => {
    const currentFirst = makeUserMessageItem("current question", "user-curr");
    const currentTail = [currentFirst];

    const result = processTimelineResponse({
      ...baseTimelineInput,
      currentTail,
      payload: {
        ...baseTimelineInput.payload,
        direction: "before",
        epoch: "epoch-1",
        startCursor: { seq: 1 },
        endCursor: { seq: 2 },
        entries: [makeTimelineEntry(1, "older chunk ")],
      },
    });

    expect(result.tail.map((item) => item.kind)).toEqual(["assistant_message", "user_message"]);
    expect((result.tail[0] as AssistantMessageItem).text).toBe("older chunk ");
    expect((result.tail[1] as Extract<StreamItem, { kind: "user_message" }>).text).toBe(
      "current question",
    );

    // The passed-in current tail array is not mutated.
    expect(currentTail).toHaveLength(1);
    expect(currentTail[0]).toBe(currentFirst);
  });
});

// ---------------------------------------------------------------------------
// applyStreamEvent head/tail lane discipline
// ---------------------------------------------------------------------------

describe("applyStreamEvent head/tail lane discipline", () => {
  it("keeps the tail reference stable while the same assistant message streams tokens into the head", () => {
    const tailBase = [makeUserMessageItem("question", "u1")];

    const r1 = applyStreamEvent({
      tail: tailBase,
      head: [],
      event: assistantTimelineEvent("Hel", "m1"),
      timestamp: new Date(1100),
    });
    expect(r1.tail).toBe(tailBase); // tokens still stream in the head lane
    expect(r1.head[0]).toMatchObject({
      kind: "assistant_message",
      text: "Hel",
      messageId: "m1",
    });

    const r2 = applyStreamEvent({
      tail: r1.tail,
      head: r1.head,
      event: assistantTimelineEvent("lo", "m1"),
      timestamp: new Date(1200),
    });
    expect(r2.tail).toBe(tailBase); // still untouched
    expect(r2.head).toHaveLength(1);
    expect(r2.head[0]).toMatchObject({
      kind: "assistant_message",
      text: "Hello",
      messageId: "m1",
    });
  });

  it("flushes the assistant head into the tail when a different lane (tool_call) starts", () => {
    const tailBase = [makeUserMessageItem("question", "u1")];

    const streamed = applyStreamEvent({
      tail: tailBase,
      head: [],
      event: assistantTimelineEvent("All done", "m2"),
      timestamp: new Date(1000),
    });
    expect(streamed.tail).toBe(tailBase); // assistant still in the head lane

    const flushed = applyStreamEvent({
      tail: streamed.tail,
      head: streamed.head,
      event: toolCallTimelineEvent("call-1", "running", {
        type: "read",
        filePath: "/tmp/b.ts",
      }),
      timestamp: new Date(1500),
    });

    expect(flushed.tail).not.toBe(tailBase); // tail now grew
    expect(flushed.tail.map((item) => item.kind)).toEqual([
      "user_message",
      "assistant_message",
      "tool_call",
    ]);
    expect(flushed.head).toEqual([]);
  });
});
