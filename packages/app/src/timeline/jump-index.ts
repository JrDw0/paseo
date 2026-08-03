import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

/**
 * Build the conversation-wide jump index from a full projected timeline fetch.
 *
 * The daemon accepted user messages carry a stable `messageId` (some older
 * projected rows may omit it, in which case we fall back to the seq). The sheet
 * only needs presentation fields (preview, timestamp); the seq is kept so the
 * caller can page to a row that is not yet loaded into the stream.
 */
export interface JumpIndexEntry {
  id: string;
  epoch: string;
  seq: number;
  preview: string;
  timestampLabel: string;
}

interface JumpIndexTimelineEntry {
  item: AgentTimelineItem;
  seqStart: number;
  timestamp: string;
}

export function buildJumpIndexFromTimeline(input: {
  entries: JumpIndexTimelineEntry[];
  epoch: string;
  formatTimestamp: (iso: string) => string;
  imageMessagePreview: string;
}): JumpIndexEntry[] {
  const { entries, epoch, formatTimestamp, imageMessagePreview } = input;
  const index: JumpIndexEntry[] = [];

  for (const entry of entries) {
    if (entry.item.type !== "user_message") {
      continue;
    }
    const firstLine = (entry.item.text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    index.push({
      id: entry.item.messageId ?? `seq:${entry.seqStart}`,
      epoch,
      seq: entry.seqStart,
      preview: firstLine ?? imageMessagePreview,
      timestampLabel: formatTimestamp(entry.timestamp),
    });
  }

  return index;
}
