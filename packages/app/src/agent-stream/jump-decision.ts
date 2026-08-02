import type { JumpIndexEntry } from "@/timeline/jump-index";

/**
 * Decide what a jump to a target message requires given which part of the
 * conversation is currently rendered.
 *
 * - already loaded        -> scroll straight to it (no fetch)
 * - not loaded            -> back-fill older pages until the target row is
 *                            rendered, then scroll. The loop exits immediately
 *                            if the span already covers the target's seq.
 */
export type JumpDecision =
  | { kind: "scroll"; entry: JumpIndexEntry }
  | { kind: "load-until"; entry: JumpIndexEntry };

export interface JumpLoadedContext {
  /** whether the target's seq is inside the currently rendered span */
  isSeqCovered: (seq: number) => boolean;
}

/**
 * A target is loaded iff its seq sits inside the rendered span. The daemon's
 * projected rows never carry a stable alignment id (the rendered row id differs
 * when a messageId is absent), so seq coverage is the reliable test.
 */
export function decideMessageJump(entry: JumpIndexEntry, ctx: JumpLoadedContext): JumpDecision {
  if (ctx.isSeqCovered(entry.seq)) {
    return { kind: "scroll", entry };
  }
  return { kind: "load-until", entry };
}
