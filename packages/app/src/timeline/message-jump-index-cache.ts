import type { JumpIndexEntry } from "@/timeline/jump-index";

/**
 * Persist the per-agent "my messages" jump index to AsyncStorage so reopening
 * the message-jump sheet is instant instead of refetching over the relay. The
 * compact user-message-only fetch keeps the payload small; this cache removes
 * the remaining network round-trip on reopen.
 */
export interface JumpIndexStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const STORAGE_KEY = "@paseo:message-jump-index";
const CACHE_VERSION = 1;
const MAX_AGENTS = 64;
const MAX_ENTRIES_PER_AGENT = 2000;

interface StoredCache {
  version: number;
  byAgentKey: Record<string, { entries: JumpIndexEntry[] }>;
}

function emptyCache(): StoredCache {
  return { version: CACHE_VERSION, byAgentKey: {} };
}

function parse(raw: string | null): StoredCache {
  if (!raw) {
    return emptyCache();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCache>;
    if (
      parsed?.version === CACHE_VERSION &&
      parsed.byAgentKey !== null &&
      typeof parsed.byAgentKey === "object"
    ) {
      return parsed as StoredCache;
    }
  } catch {
    // Corrupted persisted value: fall through to an empty cache.
  }
  return emptyCache();
}

let writeQueue: Promise<void> = Promise.resolve();

export async function loadStoredJumpIndex(
  store: JumpIndexStorage,
  agentKey: string,
): Promise<JumpIndexEntry[] | null> {
  const cache = parse(await store.getItem(STORAGE_KEY));
  const stored = cache.byAgentKey[agentKey];
  if (!stored) {
    return null;
  }
  return stored.entries.slice(0, MAX_ENTRIES_PER_AGENT);
}

export function saveStoredJumpIndex(
  store: JumpIndexStorage,
  agentKey: string,
  entries: JumpIndexEntry[],
): Promise<void> {
  const capped = entries.slice(-MAX_ENTRIES_PER_AGENT);
  return enqueueWrite(store, (current) => {
    const byAgentKey = { ...current.byAgentKey, [agentKey]: { entries: capped } };
    const keys = Object.keys(byAgentKey);
    if (keys.length > MAX_AGENTS) {
      for (const key of keys.slice(0, keys.length - MAX_AGENTS)) {
        delete byAgentKey[key];
      }
    }
    return { version: CACHE_VERSION, byAgentKey };
  });
}

function enqueueWrite(
  store: JumpIndexStorage,
  update: (current: StoredCache) => StoredCache,
): Promise<void> {
  const next = writeQueue.then(async () => {
    const current = parse(await store.getItem(STORAGE_KEY));
    const updated = update(current);
    return store.setItem(STORAGE_KEY, JSON.stringify(updated));
  });
  writeQueue = next.catch(() => undefined);
  return next;
}
