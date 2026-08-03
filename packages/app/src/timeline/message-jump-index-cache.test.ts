import { describe, expect, test } from "vitest";
import {
  loadStoredJumpIndex,
  saveStoredJumpIndex,
  type JumpIndexStorage,
} from "./message-jump-index-cache";
import type { JumpIndexEntry } from "./jump-index";

function makeStore(): JumpIndexStorage & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => Promise.resolve(data.get(key) ?? null),
    setItem: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

function entry(seq: number, id = `msg-${seq}`): JumpIndexEntry {
  return { id, epoch: "epoch-1", seq, preview: `preview ${seq}`, timestampLabel: "now" };
}

describe("message-jump-index-cache", () => {
  test("returns null when nothing is stored", async () => {
    const store = makeStore();
    expect(await loadStoredJumpIndex(store, "s:a")).toBeNull();
  });

  test("round-trips entries per agent key", async () => {
    const store = makeStore();
    await saveStoredJumpIndex(store, "s:a", [entry(1), entry(2)]);
    await saveStoredJumpIndex(store, "s:b", [entry(7)]);
    expect(await loadStoredJumpIndex(store, "s:a")).toEqual([entry(1), entry(2)]);
    expect(await loadStoredJumpIndex(store, "s:b")).toEqual([entry(7)]);
  });

  test("later saves overwrite the same agent key", async () => {
    const store = makeStore();
    await saveStoredJumpIndex(store, "s:a", [entry(1)]);
    await saveStoredJumpIndex(store, "s:a", [entry(2)]);
    expect(await loadStoredJumpIndex(store, "s:a")).toEqual([entry(2)]);
  });

  test("treats a corrupt persisted value as an empty cache", async () => {
    const store = makeStore();
    store.data.set("@paseo:message-jump-index", "{not json");
    expect(await loadStoredJumpIndex(store, "s:a")).toBeNull();
  });

  test("ignores a cache with a mismatched version", async () => {
    const store = makeStore();
    store.data.set(
      "@paseo:message-jump-index",
      JSON.stringify({ version: 99, byAgentKey: { "s:a": { entries: [entry(1)] } } }),
    );
    expect(await loadStoredJumpIndex(store, "s:a")).toBeNull();
  });

  test("keeps the most recent entries when over the per-agent cap", async () => {
    const store = makeStore();
    const many = Array.from({ length: 3000 }, (_, i) => entry(i));
    await saveStoredJumpIndex(store, "s:a", many);
    const loaded = await loadStoredJumpIndex(store, "s:a");
    expect(loaded?.length).toBe(2000);
    expect(loaded?.[0].seq).toBe(1000);
  });
});
