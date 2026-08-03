import type { FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";
import { hydrateStreamState, type StreamItem, type TimelinePosition } from "@/types/stream";
import type { MessageJumpEntry } from "@/components/message-jump-sheet";

// The first response is intentionally only the target row. Context is fetched
// after the target has been mounted and focused, so a long conversation never
// makes the user wait for an entire viewport-sized page.
export const TARGET_WINDOW_INITIAL_LIMIT = 1;
export const TARGET_WINDOW_PAGE_LIMIT = 40;
export const TARGET_WINDOW_MAX_ITEMS = 120;
export const TARGET_WINDOW_EXPANSION_DELAY_MS = 180;

export interface TargetWindowRow {
  item: StreamItem;
  seqStart: number;
  seqEnd: number;
}

export interface TargetWindowPage {
  epoch: string;
  rows: TargetWindowRow[];
  startCursor: { epoch: string; seq: number } | null;
  endCursor: { epoch: string; seq: number } | null;
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface TargetWindowSnapshot {
  status: "idle" | "loading" | "ready" | "expanding" | "error";
  target: MessageJumpEntry | null;
  epoch: string | null;
  rows: TargetWindowRow[];
  items: StreamItem[];
  startCursor: { epoch: string; seq: number } | null;
  endCursor: { epoch: string; seq: number } | null;
  hasOlder: boolean;
  hasNewer: boolean;
  generation: number;
  focusRevision: number;
  error: string | null;
}

export interface TargetWindowExpansion {
  direction: "before" | "after";
  cursor: { epoch: string; seq: number };
}

export function createTargetWindowSnapshot(): TargetWindowSnapshot {
  return {
    status: "idle",
    target: null,
    epoch: null,
    rows: [],
    items: [],
    startCursor: null,
    endCursor: null,
    hasOlder: false,
    hasNewer: false,
    generation: 0,
    focusRevision: 0,
    error: null,
  };
}

/**
 * The jump index already has enough information to render a temporary target
 * row. Showing it immediately lets the native list leave the live tail while
 * the daemon fetches the canonical row in the background.
 */
export function createTargetWindowPlaceholder(target: MessageJumpEntry): TargetWindowRow {
  return {
    item: {
      kind: "user_message",
      id: target.id,
      timelineCursor: { epoch: target.epoch, seq: target.seq },
      text: target.preview,
      timestamp: new Date(),
    },
    seqStart: target.seq,
    seqEnd: target.seq,
  };
}

function timelinePositionForEntry(input: {
  item: AgentTimelineItem;
  epoch: string;
  seqStart: number;
  seqEnd: number;
}): TimelinePosition {
  return {
    epoch: input.epoch,
    seq: input.item.type === "user_message" ? input.seqStart : input.seqEnd,
  };
}

export function hydrateTargetWindowPage(payload: FetchAgentTimelinePayload): TargetWindowPage {
  const rows: TargetWindowRow[] = [];
  for (const entry of payload.entries) {
    const event = {
      type: "timeline",
      provider: entry.provider,
      item: entry.item,
    } as AgentStreamEventPayload;
    const hydrated = hydrateStreamState(
      [
        {
          event,
          timestamp: new Date(entry.timestamp),
          timelineCursor: timelinePositionForEntry({
            item: entry.item,
            epoch: payload.epoch,
            seqStart: entry.seqStart,
            seqEnd: entry.seqEnd,
          }),
        },
      ],
      { source: "canonical" },
    );
    for (const item of hydrated) {
      rows.push({
        item,
        seqStart: entry.seqStart,
        seqEnd: entry.seqEnd,
      });
    }
  }
  return {
    epoch: payload.epoch,
    rows,
    startCursor: payload.startCursor,
    endCursor: payload.endCursor,
    hasOlder: payload.hasOlder,
    hasNewer: payload.hasNewer,
  };
}

function targetWindowRowKey(epoch: string, row: TargetWindowRow): string {
  return `${epoch}:${row.seqStart}:${row.seqEnd}:${row.item.kind}:${row.item.id}`;
}

export function mergeTargetWindowPage(input: {
  epoch: string;
  existingRows: TargetWindowRow[];
  page: TargetWindowPage;
}): TargetWindowRow[] {
  if (input.page.epoch !== input.epoch) {
    return input.existingRows;
  }
  const rowsByKey = new Map<string, TargetWindowRow>();
  for (const row of input.existingRows) {
    rowsByKey.set(targetWindowRowKey(input.epoch, row), row);
  }
  for (const row of input.page.rows) {
    const key = targetWindowRowKey(input.epoch, row);
    const previous = rowsByKey.get(key);
    if (!previous || row.seqEnd >= previous.seqEnd) {
      rowsByKey.set(key, row);
    }
  }
  return [...rowsByKey.values()].sort(
    (left, right) => left.seqStart - right.seqStart || left.seqEnd - right.seqEnd,
  );
}

export function targetWindowItems(rows: TargetWindowRow[]): StreamItem[] {
  return rows.map((row) => row.item);
}

export function getTargetWindowExpansion(
  snapshot: Pick<
    TargetWindowSnapshot,
    "target" | "rows" | "startCursor" | "endCursor" | "hasOlder" | "hasNewer"
  >,
): TargetWindowExpansion | null {
  if (!snapshot.target) {
    return null;
  }

  let olderCount = 0;
  let newerCount = 0;
  for (const row of snapshot.rows) {
    if (row.seqEnd < snapshot.target.seq) {
      olderCount += 1;
    } else if (row.seqStart > snapshot.target.seq) {
      newerCount += 1;
    }
  }

  if (
    snapshot.hasOlder &&
    snapshot.startCursor &&
    (!snapshot.hasNewer || olderCount <= newerCount)
  ) {
    return { direction: "before", cursor: snapshot.startCursor };
  }
  if (snapshot.hasNewer && snapshot.endCursor) {
    return { direction: "after", cursor: snapshot.endCursor };
  }
  if (snapshot.hasOlder && snapshot.startCursor) {
    return { direction: "before", cursor: snapshot.startCursor };
  }
  return null;
}

export function findTargetWindowMessageId(
  items: StreamItem[],
  target: MessageJumpEntry,
): string | null {
  for (const item of items) {
    if (item.kind !== "user_message") {
      continue;
    }
    if (item.id === target.id) {
      return item.id;
    }
    if (
      target.epoch &&
      item.timelineCursor?.epoch === target.epoch &&
      item.timelineCursor.seq === target.seq
    ) {
      return item.id;
    }
  }
  return null;
}

export function targetWindowContainsTarget(
  rows: TargetWindowRow[],
  target: MessageJumpEntry,
): boolean {
  return findTargetWindowMessageId(targetWindowItems(rows), target) !== null;
}
