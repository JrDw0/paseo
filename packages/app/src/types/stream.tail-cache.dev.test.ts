import { afterEach, describe, expect, it, vi } from "vitest";

// Turn on the module-level __DEV__ invariant guard BEFORE the reducer module is
// first loaded, so getTailIds runs the cache-tail length check.
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
});

import type { StreamItem } from "./stream";
import { getTailIds } from "./stream";

function item(id: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: `text-${id}`,
    timestamp: new Date("2026-07-18T08:00:00.000Z"),
  };
}

describe("tailIdsCache invariant", () => {
  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  });

  it("returns the same Set reference on repeated cache hits for the same tail", () => {
    const tail = [item("a"), item("b")];
    const first = getTailIds(tail);
    const second = getTailIds(tail);
    expect(first).toBe(second);
    expect(first).toEqual(new Set(["a", "b"]));
  });

  it("throws in dev when a published tail is mutated in place after caching", () => {
    const tail: StreamItem[] = [item("a")];
    getTailIds(tail); // cache a size-1 id set
    tail.push(item("b")); // an in-place mutation the invariant forbids
    expect(() => getTailIds(tail)).toThrow(/tailIdsCache/);
    // The cache is healed on the next call, so it still returns the correct set.
    expect(getTailIds(tail)).toEqual(new Set(["a", "b"]));
  });

  it("does not throw in production when a tail is only ever copied (no mutation)", () => {
    const tail = [item("x")];
    expect(getTailIds(tail)).toEqual(new Set(["x"]));
    expect(getTailIds(tail)).toBe(getTailIds(tail));
  });
});
