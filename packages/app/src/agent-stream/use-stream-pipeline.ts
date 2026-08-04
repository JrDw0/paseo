import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MessageJumpEntry } from "@/components/message-jump-sheet";
import { isWeb } from "@/constants/platform";
import type { JumpIndexEntry } from "@/timeline/jump-index";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type ToolCallDetailLevel,
  type ToolCallDetailProjection,
} from "@/tool-calls/detail-level/projection";
import type { StreamItem } from "@/types/stream";
import { formatTimeAgo } from "@/utils/time";
import { type StreamLayout, layoutStream } from "./layout";
import { type AgentStreamRenderModel, buildAgentStreamRenderModel } from "./model";
import type { StreamStrategy } from "./strategy";

/**
 * 根因 B: agent-stream/view.tsx 的 useMemo 派生管道原本内联在组件体内
 * (prepareToolCallHistory → projectToolCallDetailLevel → buildAgentStreamRenderModel
 *  → layoutStream → image-flag / jump-entry 派生 → renderedStreamItems)。
 * deep session 的 tail 达数万条,这条链上 8+ 个 M 级结构全在同一组件里耦合,
 * 既难维护也无法单独拆细依赖。本 hook 是「档 3」的纯结构抽取:memos、deps、
 * 拼装顺序与 view.tsx 原实现逐项对应,行为不变;依赖拆细留给档 3.5 决定。
 * 语义由 src/agent-stream/stream-pipeline.test.ts 锁定。
 */

const EMPTY_STREAM_HEAD: StreamItem[] = [];

interface LoadedMessageLabel {
  imageMessage: string;
  attachmentMessage: string;
}

function loweredImageFlags(combined: StreamItem[]): Map<string, boolean> {
  const flags = new Map<string, boolean>();
  const seen = new Set<string>();
  for (const item of combined) {
    if (item.kind !== "user_message" || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    flags.set(item.id, (item.images?.length ?? 0) > 0);
  }
  return flags;
}

function buildLoadedFallbackJumpEntries(
  combined: StreamItem[],
  labels: LoadedMessageLabel,
  formatTimestamp: (date: Date) => string,
): MessageJumpEntry[] {
  const seen = new Set<string>();
  const entries: MessageJumpEntry[] = [];
  for (const item of combined) {
    if (item.kind !== "user_message" || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    const firstLine = item.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    const hasImages = (item.images?.length ?? 0) > 0;
    const hasAttachments = (item.attachments?.length ?? 0) > 0;
    let preview: string;
    if (firstLine) {
      preview = firstLine;
    } else if (hasImages) {
      preview = labels.imageMessage;
    } else if (hasAttachments) {
      preview = labels.attachmentMessage;
    } else {
      preview = "…";
    }
    entries.push({
      id: item.id,
      epoch: "",
      seq: -1,
      preview,
      timestampLabel: formatTimestamp(item.timestamp),
      hasImages,
    });
  }
  return entries;
}

export interface UseStreamPipelineInput {
  toolCallDetailLevel: ToolCallDetailLevel;
  /** Committed timeline (view 侧 freeze 后的 displayStreamItems)。 */
  streamItems: StreamItem[];
  /** Live streaming lane (freeze 后的 displayStreamHead)。 */
  streamHead: StreamItem[] | undefined;
  agentStatus: string;
  isMobileBreakpoint: boolean;
  streamRenderStrategy: StreamStrategy;
  /** Message-jump index entries from useMessageJumpIndex, null until loaded. */
  indexEntries: JumpIndexEntry[] | null;
}

export interface StreamPipelineResult {
  projectedToolCalls: ToolCallDetailProjection;
  baseRenderModel: AgentStreamRenderModel;
  streamLayout: StreamLayout;
  messageJumpEntries: MessageJumpEntry[];
  renderedStreamItems: StreamItem[];
}

export function useStreamPipeline(input: UseStreamPipelineInput): StreamPipelineResult {
  const {
    toolCallDetailLevel,
    streamItems,
    streamHead,
    agentStatus,
    isMobileBreakpoint,
    streamRenderStrategy,
    indexEntries,
  } = input;
  const { t } = useTranslation();

  // Keep retained history outside the 48ms live-head flush path.
  const preparedToolCallHistory = useMemo(
    () => prepareToolCallHistory(toolCallDetailLevel, streamItems),
    [streamItems, toolCallDetailLevel],
  );
  const projectedToolCalls = useMemo(
    () =>
      projectToolCallDetailLevel({
        level: toolCallDetailLevel,
        tail: streamItems,
        head: streamHead ?? EMPTY_STREAM_HEAD,
        preparedHistory: preparedToolCallHistory,
        isTurnActive: agentStatus === "running",
      }),
    [agentStatus, streamHead, streamItems, preparedToolCallHistory, toolCallDetailLevel],
  );

  const baseRenderModel = useMemo(() => {
    return buildAgentStreamRenderModel({
      agentStatus,
      tail: projectedToolCalls.tail,
      head: projectedToolCalls.head,
      platform: isWeb ? "web" : "native",
      isMobileBreakpoint,
    });
  }, [agentStatus, isMobileBreakpoint, projectedToolCalls.head, projectedToolCalls.tail]);
  const streamLayout = useMemo(
    () =>
      layoutStream({
        strategy: streamRenderStrategy,
        agentStatus,
        history: baseRenderModel.history,
        liveHead: baseRenderModel.segments.liveHead,
        timingByAssistantId: baseRenderModel.turnTiming.byAssistantId,
      }),
    [
      agentStatus,
      baseRenderModel.history,
      baseRenderModel.segments.liveHead,
      baseRenderModel.turnTiming.byAssistantId,
      streamRenderStrategy,
    ],
  );

  // The tail is the whole history and the head re-references every 48ms stream
  // flush, so the O(tail) scans stay in tail-keyed memos and each flush only
  // re-walks the (small) head. Head items come after tail items, and tail ids
  // win on collision — the same order/precedence as scanning tail+head combined.
  const tailImageFlags = useMemo(
    () => loweredImageFlags(projectedToolCalls.tail),
    [projectedToolCalls.tail],
  );
  const indexMappedEntries = useMemo<MessageJumpEntry[] | null>(() => {
    if (!indexEntries) {
      return null;
    }
    const seenIndex = new Set<string>();
    const entries: MessageJumpEntry[] = [];
    for (const entry of indexEntries) {
      if (seenIndex.has(entry.id)) {
        continue;
      }
      seenIndex.add(entry.id);
      entries.push({
        id: entry.id,
        epoch: entry.epoch,
        seq: entry.seq,
        preview: entry.preview,
        timestampLabel: entry.timestampLabel,
        hasImages: tailImageFlags.get(entry.id) ?? false,
      });
    }
    return entries;
  }, [indexEntries, tailImageFlags]);
  const messageJumpLabels = useMemo<LoadedMessageLabel>(
    () => ({
      imageMessage: t("agentStream.messageJump.imageMessage"),
      attachmentMessage: t("agentStream.messageJump.attachmentMessage"),
    }),
    [t],
  );
  const tailFallbackEntries = useMemo(
    () => buildLoadedFallbackJumpEntries(projectedToolCalls.tail, messageJumpLabels, formatTimeAgo),
    [projectedToolCalls.tail, messageJumpLabels],
  );
  const messageJumpEntries = useMemo<MessageJumpEntry[]>(() => {
    const head = projectedToolCalls.head ?? EMPTY_STREAM_HEAD;
    const headFlags = loweredImageFlags(head);
    if (indexMappedEntries) {
      let patched = indexMappedEntries;
      for (let index = 0; index < indexMappedEntries.length; index++) {
        const entry = indexMappedEntries[index];
        // Tail ids win on a tail/head id collision (head flags only fill gaps).
        const headFlag = tailImageFlags.has(entry.id) ? undefined : headFlags.get(entry.id);
        if (headFlag !== undefined && headFlag !== entry.hasImages) {
          if (patched === indexMappedEntries) {
            patched = indexMappedEntries.slice();
          }
          patched[index] = { ...entry, hasImages: headFlag };
        }
      }
      return patched;
    }
    if (headFlags.size === 0) {
      return tailFallbackEntries;
    }
    const tailIds = new Set(tailFallbackEntries.map((entry) => entry.id));
    return [
      ...tailFallbackEntries,
      ...buildLoadedFallbackJumpEntries(head, messageJumpLabels, formatTimeAgo).filter(
        (entry) => !tailIds.has(entry.id),
      ),
    ];
  }, [
    indexMappedEntries,
    tailFallbackEntries,
    tailImageFlags,
    projectedToolCalls.head,
    messageJumpLabels,
  ]);

  const renderedStreamItems = useMemo(
    () => [
      ...streamLayout.history.map((layoutItem) => layoutItem.item),
      ...streamLayout.liveHead.map((layoutItem) => layoutItem.item),
    ],
    [streamLayout.history, streamLayout.liveHead],
  );

  return {
    projectedToolCalls,
    baseRenderModel,
    streamLayout,
    messageJumpEntries,
    renderedStreamItems,
  };
}
