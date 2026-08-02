import { describe, expect, test } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { buildJumpIndexFromTimeline } from "./jump-index";

function userMessage(i: { seq: number; text?: string; messageId?: string; timestamp?: string }): {
  item: AgentTimelineItem;
  seqStart: number;
  timestamp: string;
} {
  return {
    item: {
      type: "user_message",
      text: i.text ?? "",
      ...(i.messageId ? { messageId: i.messageId } : {}),
    },
    seqStart: i.seq,
    timestamp: i.timestamp ?? "2026-08-01T00:00:00.000Z",
  };
}

function nonUser(i: { seq: number; type: "assistant_message" | "reasoning" }): {
  item: AgentTimelineItem;
  seqStart: number;
  timestamp: string;
} {
  return {
    item: { type: i.type, text: "x" },
    seqStart: i.seq,
    timestamp: "2026-08-01T00:00:00.000Z",
  };
}

describe("buildJumpIndexFromTimeline", () => {
  test("keeps only user messages in ascending seq order", () => {
    const index = buildJumpIndexFromTimeline({
      entries: [
        nonUser({ seq: 1, type: "assistant_message" }),
        userMessage({ seq: 2, text: "first ask" }),
        nonUser({ seq: 3, type: "reasoning" }),
        userMessage({ seq: 4, text: "second ask" }),
      ],
      formatTimestamp: () => "now",
      imageMessagePreview: "[image]",
    });

    expect(index).toEqual([
      { id: "seq:2", seq: 2, preview: "first ask", timestampLabel: "now" },
      { id: "seq:4", seq: 4, preview: "second ask", timestampLabel: "now" },
    ]);
  });

  test("uses messageId as the jump id when present", () => {
    const index = buildJumpIndexFromTimeline({
      entries: [userMessage({ seq: 10, text: "hi", messageId: "msg-1" })],
      formatTimestamp: () => "now",
      imageMessagePreview: "[image]",
    });

    expect(index[0]).toMatchObject({ id: "msg-1", seq: 10, preview: "hi" });
  });

  test("uses the first non-empty trimmed line as the preview", () => {
    const index = buildJumpIndexFromTimeline({
      entries: [userMessage({ seq: 5, text: "  \n  Hello world  \n second line" })],
      formatTimestamp: () => "now",
      imageMessagePreview: "[image]",
    });

    expect(index[0].preview).toBe("Hello world");
  });

  test("falls back to the image placeholder for blank user messages", () => {
    const index = buildJumpIndexFromTimeline({
      entries: [userMessage({ seq: 7, text: "  \n  \n" })],
      formatTimestamp: () => "now",
      imageMessagePreview: "[image]",
    });

    expect(index[0].preview).toBe("[image]");
  });

  test("propagates the formatted timestamp", () => {
    const index = buildJumpIndexFromTimeline({
      entries: [userMessage({ seq: 9, text: "hello" })],
      formatTimestamp: () => "5 min ago",
      imageMessagePreview: "[image]",
    });

    expect(index[0].timestampLabel).toBe("5 min ago");
  });
});
