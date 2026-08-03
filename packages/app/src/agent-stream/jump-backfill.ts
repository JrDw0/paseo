import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";

/**
 * Decide the next back-fill timeline request to bring a target message's row
 * into the stream, plus whether it terminated.
 *
 * Two strategies, both feeding the existing "older before" prepend reducer:
 *
 * - Continuous: page-by-page back-fill from the current span start until the
 *   target seq is covered, preserving a contiguous run of history.
 * - Cap fallback ("window"): after `maxPages` continuous pages, fire a single
 *   bounded `before` fetch keyed on `targetSeq+1` so the daemon returns a window
 *   *ending at* the target. That skips the middle (context gap) but lands in
 *   exactly one request regardless of distance — the guard against pathological
 *   long back-fills.
 */
export type BackfillDecision =
  | { kind: "continue"; cursorSeq: number }
  | { kind: "window"; cursorSeq: number }
  | { kind: "done" };

export interface JumpBackfillState {
  pagesFetched: number;
}

export function createJumpBackfillState(): JumpBackfillState {
  return { pagesFetched: 0 };
}

export function planJumpBackfill(input: {
  state: JumpBackfillState;
  currentStartSeq: number;
  targetSeq: number;
  maxPages?: number;
  pageLimit?: number;
}): BackfillDecision {
  const { state, currentStartSeq, targetSeq } = input;
  const maxPages = input.maxPages ?? JUMP_BACKFILL_DEFAULT_MAX_PAGES;
  if (currentStartSeq <= targetSeq) {
    return { kind: "done" };
  }
  if (state.pagesFetched >= maxPages) {
    return { kind: "window", cursorSeq: targetSeq + 1 };
  }
  return { kind: "continue", cursorSeq: currentStartSeq };
}

export function deriveBackfillCursor(input: {
  decision: Exclude<BackfillDecision, { kind: "done" }>;
  pageLimit?: number;
}): { seq: number; limit: number } {
  return {
    seq: input.decision.cursorSeq,
    limit: input.pageLimit ?? TIMELINE_FETCH_PAGE_SIZE,
  };
}

export function advanceJumpBackfillState(
  state: JumpBackfillState,
  decision: BackfillDecision,
): JumpBackfillState {
  if (decision.kind === "done") {
    return state;
  }
  return { pagesFetched: state.pagesFetched + 1 };
}

export const JUMP_BACKFILL_DEFAULT_MAX_PAGES = 8;

/**
 * Drive the back-fill loop for a target that is not yet loaded. Issues one
 * fetch per iteration, re-reading the stream span from the store between any
 * two pages (the daemon's fetch response lands in the store via the outbound
 * timeline subscription), until the span covers the target's seq or the
 * continuous cap trips and a single capped window is fetched.
 *
 * `onCovered` fires once the target row's seq is inside the loaded span.
 */
export async function driveJumpBackfill(input: {
  targetSeq: number;
  readStartSeq: () => number;
  readEpoch: () => string;
  fetchPage: (request: {
    direction: "before";
    cursor: { epoch: string; seq: number };
    limit: number;
  }) => Promise<unknown>;
  onCovered: () => void;
  maxPages?: number;
  pageLimit?: number;
}): Promise<void> {
  const {
    targetSeq,
    readStartSeq,
    readEpoch,
    fetchPage,
    onCovered,
    maxPages = JUMP_BACKFILL_DEFAULT_MAX_PAGES,
    pageLimit = TIMELINE_FETCH_PAGE_SIZE,
  } = input;

  let state = createJumpBackfillState();
  let fetchedTargetWindow = false;
  while (readStartSeq() > targetSeq || !fetchedTargetWindow) {
    const startSeq = readStartSeq();
    const decision =
      !Number.isFinite(startSeq) || startSeq <= targetSeq
        ? ({ kind: "window", cursorSeq: targetSeq + 1 } as const)
        : planJumpBackfill({
            state,
            currentStartSeq: startSeq,
            targetSeq,
            maxPages,
            pageLimit,
          });
    if (decision.kind === "done") {
      break;
    }
    const cursor = deriveBackfillCursor({ decision, pageLimit });
    await fetchPage({
      direction: "before",
      cursor: { epoch: readEpoch(), seq: cursor.seq },
      limit: cursor.limit,
    });
    state = advanceJumpBackfillState(state, decision);
    if (decision.kind === "window") {
      fetchedTargetWindow = true;
      break;
    }
    if (readStartSeq() >= startSeq) {
      throw new Error("Timeline backfill made no progress");
    }
  }
  onCovered();
}
