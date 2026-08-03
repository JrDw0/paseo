/**
 * Jump-to-message viewport targeting shared by the stream render strategies.
 * The native inverted FlatList cannot measure rows outside its render window
 * and has no getItemLayout, so a jump may have to estimate an offset, mount the
 * rows, and retry scrollToIndex. This module keeps those decisions pure.
 */

export const MESSAGE_JUMP_MAX_RETRIES = 3;
export const MESSAGE_JUMP_RETRY_DELAY_MS = 350;

export type MessageJumpPlan =
  | { kind: "scroll-to-index"; index: number }
  | { kind: "scroll-to-bottom" }
  | { kind: "missing" };

/**
 * Messages present in the loaded history rows navigate by data index. Live-head
 * messages sit visually at the bottom edge of the (inverted) list, so the
 * existing bottom anchor covers them.
 */
export function planMessageJump(
  rowIdToDataIndex: ReadonlyMap<string, number>,
  liveHeadIds: ReadonlySet<string>,
  messageId: string,
): MessageJumpPlan {
  const index = rowIdToDataIndex.get(messageId);
  if (index !== undefined) {
    return { kind: "scroll-to-index", index };
  }
  return liveHeadIds.has(messageId) ? { kind: "scroll-to-bottom" } : { kind: "missing" };
}

export interface PendingMessageJump {
  readonly token: number;
  readonly messageId: string;
  readonly index: number;
  readonly retriesLeft: number;
}

export function createPendingMessageJump(input: {
  token: number;
  messageId: string;
  index: number;
  maxRetries?: number;
}): PendingMessageJump {
  return {
    token: input.token,
    messageId: input.messageId,
    index: input.index,
    retriesLeft: input.maxRetries ?? MESSAGE_JUMP_MAX_RETRIES,
  };
}

export interface MessageJumpIndexFailure {
  index: number;
  averageItemLength: number;
}

export interface MessageJumpFailureRecovery {
  next: PendingMessageJump;
  fallbackOffset: number;
}

/**
 * null means abandon the jump: it fired for a stale target, or it exhausted its
 * retries. Otherwise scroll to the estimated offset, let the rows mount, and
 * retry scrollToIndex once they are measurable.
 */
export function recoverMessageJumpIndexFailure(
  pending: PendingMessageJump | null,
  failure: MessageJumpIndexFailure,
): MessageJumpFailureRecovery | null {
  if (!pending) {
    return null;
  }
  if (pending.index !== failure.index || pending.retriesLeft <= 0) {
    return null;
  }
  return {
    next: { ...pending, retriesLeft: pending.retriesLeft - 1 },
    fallbackOffset: Math.max(0, failure.index * failure.averageItemLength),
  };
}
