import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { fetchAgentTimelineOnce } from "@/timeline/fetch-agent-timeline-once";
import { planTimelineFullIndexFetch } from "@/timeline/timeline-sync-plan";
import { loadStoredJumpIndex, saveStoredJumpIndex } from "@/timeline/message-jump-index-cache";
import { buildJumpIndexFromTimeline, type JumpIndexEntry } from "@/timeline/jump-index";
import { formatTimeAgo } from "@/utils/time";

/**
 * Conversation-wide user-message jump index, persisted to AsyncStorage.
 *
 * The hook seeds entries immediately from the persisted cache (instant reopen),
 * then refreshes in the background with a compact user-message-only timeline
 * fetch and re-persists. `ready` is true as soon as any entries are available,
 * so a warm reopen never shows a spinner.
 */
export function useMessageJumpIndex({
  serverId,
  agentId,
  enabled,
}: {
  serverId: string;
  agentId: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const session = useSessionStore((state) => state.sessions[serverId]);
  const [entries, setEntries] = useState<JumpIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const agentKey = `${serverId}:${agentId}`;

  const refresh = useCallback(async () => {
    const client = useSessionStore.getState().sessions[serverId]?.client;
    if (!client) {
      return null;
    }
    try {
      const payload: FetchAgentTimelinePayload = await fetchAgentTimelineOnce(
        client,
        agentId,
        planTimelineFullIndexFetch(),
      );
      if (payload.error) {
        throw new Error(payload.error);
      }
      const built = buildJumpIndexFromTimeline({
        entries: payload.entries,
        formatTimestamp: (iso) => formatTimeAgo(new Date(iso)),
        imageMessagePreview: t("agentStream.messageJump.imageMessage"),
      });
      if (mounted.current) {
        setEntries(built);
        setError(null);
      }
      void saveStoredJumpIndex(AsyncStorage, agentKey, built);
      return built;
    } catch (e: unknown) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
        setEntries((prev) => prev ?? []);
      }
      return null;
    }
  }, [agentId, serverId, t, agentKey]);

  // Seed from cache instantly, then refresh in the background on mount/enable.
  useEffect(() => {
    mounted.current = true;
    if (!session?.client || !enabled) {
      return;
    }
    let cancelled = false;
    void loadStoredJumpIndex(AsyncStorage, agentKey).then((cached) => {
      if (cancelled || !cached || cached.length === 0) {
        return cached;
      }
      setEntries(cached);
      return cached;
    });
    void refresh();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.client, enabled, agentId, serverId, agentKey]);

  return useMemo(
    () => ({ entries, error, refresh, ready: entries !== null }),
    [entries, error, refresh],
  );
}
