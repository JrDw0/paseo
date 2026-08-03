import { describe, expect, it } from "vitest";
import type { FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import type { MessageJumpEntry } from "@/components/message-jump-sheet";
import {
  createTargetWindowPlaceholder,
  getTargetWindowExpansion,
  hydrateTargetWindowPage,
  mergeTargetWindowPage,
  targetWindowContainsTarget,
  targetWindowItems,
} from "./target-window";

function payload(overrides?: Partial<FetchAgentTimelinePayload>): FetchAgentTimelinePayload {
  return {
    requestId: "request",
    agentId: "agent",
    agent: null,
    direction: "before",
    projection: "projected",
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 3, nextSeq: 4 },
    startCursor: { epoch: "epoch-1", seq: 1 },
    endCursor: { epoch: "epoch-1", seq: 3 },
    hasOlder: false,
    hasNewer: false,
    entries: [],
    error: null,
    ...overrides,
  };
}

function userEntry(seq: number, id: string) {
  return {
    provider: "codex" as const,
    item: { type: "user_message" as const, text: id, messageId: id },
    timestamp: "2026-01-01T00:00:00.000Z",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  };
}

function target(id: string, seq: number): MessageJumpEntry {
  return {
    id,
    epoch: "epoch-1",
    seq,
    preview: id,
    timestampLabel: "now",
    hasImages: false,
  };
}

describe("target window", () => {
  it("creates a renderable placeholder from the jump index", () => {
    const placeholder = createTargetWindowPlaceholder(target("message-2", 2));

    expect(placeholder).toMatchObject({
      seqStart: 2,
      seqEnd: 2,
      item: {
        kind: "user_message",
        id: "message-2",
        text: "message-2",
        timelineCursor: { epoch: "epoch-1", seq: 2 },
      },
    });
  });

  it("hydrates and finds the target user row by its timeline position", () => {
    const page = hydrateTargetWindowPage(payload({ entries: [userEntry(2, "message-2")] }));
    const items = targetWindowItems(page.rows);

    expect(items[0]).toMatchObject({
      id: "message-2",
      timelineCursor: { epoch: "epoch-1", seq: 2 },
    });
    expect(targetWindowContainsTarget(page.rows, target("different-local-id", 2))).toBe(true);
  });

  it("merges before and after pages without collapsing distinct rows", () => {
    const first = hydrateTargetWindowPage(
      payload({
        entries: [userEntry(2, "message-2")],
        startCursor: { epoch: "epoch-1", seq: 2 },
        endCursor: { epoch: "epoch-1", seq: 2 },
        hasOlder: true,
        hasNewer: true,
      }),
    );
    const before = hydrateTargetWindowPage(
      payload({
        entries: [userEntry(1, "message-1")],
        startCursor: { epoch: "epoch-1", seq: 1 },
        endCursor: { epoch: "epoch-1", seq: 1 },
      }),
    );
    const after = hydrateTargetWindowPage(
      payload({
        direction: "after",
        entries: [userEntry(3, "message-3")],
        startCursor: { epoch: "epoch-1", seq: 3 },
        endCursor: { epoch: "epoch-1", seq: 3 },
      }),
    );
    const withBefore = mergeTargetWindowPage({
      epoch: "epoch-1",
      existingRows: first.rows,
      page: before,
    });
    const merged = mergeTargetWindowPage({
      epoch: "epoch-1",
      existingRows: withBefore,
      page: after,
    });

    expect(merged.map((row) => row.item.id)).toEqual(["message-1", "message-2", "message-3"]);
  });

  it("expands the less populated side first to keep the target centered", () => {
    const first = hydrateTargetWindowPage(
      payload({
        entries: [userEntry(2, "message-2")],
        startCursor: { epoch: "epoch-1", seq: 2 },
        endCursor: { epoch: "epoch-1", seq: 2 },
        hasOlder: true,
        hasNewer: true,
      }),
    );
    const before = hydrateTargetWindowPage(
      payload({
        entries: [userEntry(1, "message-1")],
        startCursor: { epoch: "epoch-1", seq: 1 },
        endCursor: { epoch: "epoch-1", seq: 1 },
        hasOlder: true,
        hasNewer: true,
      }),
    );

    const firstExpansion = getTargetWindowExpansion({
      target: target("message-2", 2),
      rows: first.rows,
      startCursor: first.startCursor,
      endCursor: first.endCursor,
      hasOlder: first.hasOlder,
      hasNewer: first.hasNewer,
    });
    expect(firstExpansion).toEqual({
      direction: "before",
      cursor: { epoch: "epoch-1", seq: 2 },
    });

    const secondExpansion = getTargetWindowExpansion({
      target: target("message-2", 2),
      rows: [...before.rows, ...first.rows],
      startCursor: before.startCursor,
      endCursor: first.endCursor,
      hasOlder: true,
      hasNewer: true,
    });
    expect(secondExpansion).toEqual({
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 2 },
    });
  });

  it("rejects rows from a different epoch and preserves duplicate sequence rows", () => {
    const first = hydrateTargetWindowPage(payload({ entries: [userEntry(2, "message-2")] }));
    const duplicate = hydrateTargetWindowPage(payload({ entries: [userEntry(2, "message-2b")] }));
    const stale = hydrateTargetWindowPage(
      payload({ epoch: "epoch-2", entries: [userEntry(1, "stale")] }),
    );

    const withDuplicate = mergeTargetWindowPage({
      epoch: "epoch-1",
      existingRows: first.rows,
      page: duplicate,
    });
    const withStale = mergeTargetWindowPage({
      epoch: "epoch-1",
      existingRows: withDuplicate,
      page: stale,
    });

    expect(withDuplicate).toHaveLength(2);
    expect(withStale).toEqual(withDuplicate);
  });
});
