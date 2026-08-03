import { describe, expect, it } from "vitest";
import {
  MESSAGE_JUMP_MAX_RETRIES,
  createPendingMessageJump,
  planMessageJump,
  recoverMessageJumpIndexFailure,
} from "./jump-to-message";

describe("planMessageJump", () => {
  it("returns the data index when the message is in the loaded history rows", () => {
    const rows = new Map([
      ["newest", 0],
      ["middle", 1],
      ["oldest", 2],
    ]);
    expect(planMessageJump(rows, new Set(), "middle")).toEqual({
      kind: "scroll-to-index",
      index: 1,
    });
  });

  it("anchors to the bottom for messages outside the history rows (live head)", () => {
    const rows = new Map([["newest", 0]]);
    expect(planMessageJump(rows, new Set(["live-head-message"]), "live-head-message")).toEqual({
      kind: "scroll-to-bottom",
    });
  });

  it("does not move when the target is absent from both history and live head", () => {
    expect(planMessageJump(new Map(), new Set(), "anything")).toEqual({ kind: "missing" });
  });
});

describe("recoverMessageJumpIndexFailure", () => {
  it("estimates the fallback offset from the average item length", () => {
    const pending = createPendingMessageJump({ token: 1, messageId: "target", index: 12 });
    const recovery = recoverMessageJumpIndexFailure(pending, {
      index: 12,
      averageItemLength: 40,
    });
    expect(recovery).not.toBeNull();
    if (!recovery) {
      return;
    }
    expect(recovery.fallbackOffset).toBe(480);
    expect(recovery.next).toEqual({ ...pending, retriesLeft: MESSAGE_JUMP_MAX_RETRIES - 1 });
  });

  it("clamps the fallback offset at zero", () => {
    const pending = createPendingMessageJump({ token: 1, messageId: "target", index: 0 });
    const recovery = recoverMessageJumpIndexFailure(pending, { index: 0, averageItemLength: 40 });
    expect(recovery?.fallbackOffset).toBe(0);
  });

  it("exhausts retries and then abandons the jump", () => {
    let pending = createPendingMessageJump({
      token: 7,
      messageId: "target",
      index: 3,
      maxRetries: 2,
    });
    const failure = { index: 3, averageItemLength: 100 };

    const first = recoverMessageJumpIndexFailure(pending, failure);
    expect(first).not.toBeNull();
    if (!first) {
      return;
    }
    pending = first.next;

    const second = recoverMessageJumpIndexFailure(pending, failure);
    expect(second).not.toBeNull();
    if (!second) {
      return;
    }
    pending = second.next;

    expect(pending.retriesLeft).toBe(0);
    expect(recoverMessageJumpIndexFailure(pending, failure)).toBeNull();
  });

  it("abandons when there is no pending jump", () => {
    expect(recoverMessageJumpIndexFailure(null, { index: 5, averageItemLength: 30 })).toBeNull();
  });

  it("ignores a failure reported for a different (stale) index", () => {
    const pending = createPendingMessageJump({ token: 1, messageId: "target", index: 4 });
    expect(recoverMessageJumpIndexFailure(pending, { index: 9, averageItemLength: 30 })).toBeNull();
  });
});
