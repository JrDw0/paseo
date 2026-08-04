import { describe, expect, test } from "vitest";
import {
  advanceJumpBackfillState,
  createJumpBackfillState,
  deriveBackfillCursor,
  driveJumpBackfill,
  planJumpBackfill,
} from "./jump-backfill";
import { decideMessageJump, findLoadedMessageJumpTarget } from "./jump-decision";
import type { JumpIndexEntry } from "@/timeline/jump-index";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";

describe("planJumpBackfill", () => {
  const entry = { pagesFetched: 0, currentStartSeq: 100, targetSeq: 10, maxPages: 3 };

  test("done when the span already covers the target", () => {
    expect(
      planJumpBackfill({ state: createJumpBackfillState(), currentStartSeq: 5, targetSeq: 10 }),
    ).toEqual({ kind: "done" });
  });

  test("continues paging before the current start until the target is covered", () => {
    expect(planJumpBackfill({ state: createJumpBackfillState(), ...entry })).toEqual({
      kind: "continue",
      cursorSeq: 100,
    });
  });

  test("fires a capped window once maxPages is exhausted", () => {
    expect(
      planJumpBackfill({
        state: { pagesFetched: 3 },
        currentStartSeq: 100,
        targetSeq: 10,
        maxPages: 3,
      }),
    ).toEqual({ kind: "window", cursorSeq: 11 });
  });

  test("deriveBackfillCursor uses the decision seq and a default page limit", () => {
    expect(deriveBackfillCursor({ decision: { kind: "continue", cursorSeq: 42 } })).toEqual({
      seq: 42,
      limit: TIMELINE_FETCH_PAGE_SIZE,
    });
  });

  test("advanceJumpBackfillState only counts non-done decisions", () => {
    const s0 = createJumpBackfillState();
    expect(advanceJumpBackfillState(s0, { kind: "done" })).toEqual({ pagesFetched: 0 });
    expect(advanceJumpBackfillState(s0, { kind: "continue", cursorSeq: 1 })).toEqual({
      pagesFetched: 1,
    });
  });
});

describe("driveJumpBackfill", () => {
  function harness(input: { startSeq: number; targetSeq: number; maxPages?: number }) {
    let startSeq = input.startSeq;
    let windowCovers = false;
    const fetched: Array<{ seq: number; limit: number }> = [];
    let covered = 0;
    const fetchPage: Parameters<typeof driveJumpBackfill>[0]["fetchPage"] = async (request) => {
      fetched.push({ seq: request.cursor.seq, limit: request.limit });
      if (windowCovers && request.cursor.seq === input.targetSeq + 1) {
        // Window probe: the daemon returns the window ending at the target.
        startSeq = input.targetSeq;
        return;
      }
      // Each continuous page pulls 3 rows, simulating the span widening.
      startSeq = Math.max(startSeq - 3, input.targetSeq);
    };
    return {
      fetched,
      covered: () => covered,
      run: async (max?: number, opts?: { windowCovers?: boolean }) => {
        windowCovers = opts?.windowCovers === true;
        return driveJumpBackfill({
          targetSeq: input.targetSeq,
          readStartSeq: () => startSeq,
          readEpoch: () => "epoch-1",
          fetchPage,
          onCovered: () => {
            covered += 1;
          },
          maxPages: max ?? input.maxPages,
        });
      },
    };
  }

  test("fetches a target window when cursor coverage does not prove the row is rendered", async () => {
    const h = harness({ startSeq: 5, targetSeq: 10 });
    await h.run();
    expect(h.fetched).toEqual([{ seq: 11, limit: TIMELINE_FETCH_PAGE_SIZE }]);
    expect(h.covered()).toBe(1);
  });

  test("fetches a target window when no local timeline cursor exists", async () => {
    let covered = 0;
    let startSeq = Number.POSITIVE_INFINITY;
    const fetched: number[] = [];
    await driveJumpBackfill({
      targetSeq: 10,
      readStartSeq: () => startSeq,
      readEpoch: () => "epoch-1",
      fetchPage: async (request) => {
        fetched.push(request.cursor.seq);
        // The daemon window response establishes the span around the target.
        startSeq = 10;
      },
      onCovered: () => {
        covered += 1;
      },
    });
    expect(fetched).toEqual([11]);
    expect(covered).toBe(1);
  });

  test("rejects when a page lands but the span still does not cover the target", async () => {
    let covered = 0;
    await expect(
      driveJumpBackfill({
        targetSeq: 10,
        readStartSeq: () => Number.POSITIVE_INFINITY,
        readEpoch: () => "epoch-1",
        fetchPage: async () => undefined,
        onCovered: () => {
          covered += 1;
        },
      }),
    ).rejects.toThrow("Timeline backfill did not cover the target");
    expect(covered).toBe(0);
  });

  test("pages continuously until the span covers the target", async () => {
    const h = harness({ startSeq: 10, targetSeq: 2 });
    await h.run();
    expect(h.fetched.length).toBeGreaterThan(0);
    expect(h.fetched[0]).toEqual({ seq: 10, limit: TIMELINE_FETCH_PAGE_SIZE });
    expect(h.covered()).toBe(1);
  });

  test("trips to a capped window when maxPages continuous pages are exhausted", async () => {
    const h = harness({ startSeq: 40, targetSeq: 1, maxPages: 1 });
    await h.run(1, { windowCovers: true });
    // After the first continue page the span narrows slowly; the extra capped
    // page keys on targetSeq+1.
    const windowFetch = h.fetched.find((f) => f.seq === 2);
    expect(windowFetch).toBeDefined();
    expect(h.covered()).toBe(1);
  });

  test("stops when a page does not widen the loaded history span", async () => {
    await expect(
      driveJumpBackfill({
        targetSeq: 1,
        readStartSeq: () => 10,
        readEpoch: () => "epoch-1",
        fetchPage: async () => undefined,
        onCovered: () => {},
      }),
    ).rejects.toThrow("Timeline backfill made no progress");
  });
});

describe("decideMessageJump", () => {
  const entry: JumpIndexEntry = {
    id: "m1",
    epoch: "epoch-1",
    seq: 10,
    preview: "hi",
    timestampLabel: "now",
  };

  test("scrolls when the target seq is already inside the rendered span", () => {
    expect(decideMessageJump(entry, { isSeqCovered: () => true })).toEqual({
      kind: "scroll",
      entry,
    });
  });

  test("back-fills (load-until) when the target seq is outside the rendered span", () => {
    expect(decideMessageJump(entry, { isSeqCovered: () => false })).toEqual({
      kind: "load-until",
      entry,
    });
  });

  test("resolves an old user message through its timeline sequence", () => {
    expect(
      findLoadedMessageJumpTarget(
        [
          {
            kind: "user_message",
            id: "generated-user-id",
            text: "older message",
            timestamp: new Date(),
            timelineCursor: { epoch: "epoch-1", seq: 10 },
          },
        ],
        entry,
      ),
    ).toBe("generated-user-id");
  });
});
