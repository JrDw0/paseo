import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSessionStore } from "@/stores/session-store";
import { fetchMessageJumpTimeline } from "@/timeline/message-jump-timeline-request";
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
  // The session object is recreated on every stream flush; only the client reference
  // matters here and stays stable, so select it directly to avoid per-flush re-renders.
  const sessionClient = useSessionStore((state) => state.sessions[serverId]?.client);
  const [entries, setEntries] = useState<JumpIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const agentKey = `${serverId}:${agentId}`;
  const activeAgentKey = useRef(agentKey);
  const latestRefresh = useRef(0);
  const committedNetworkResult = useRef(0);

  activeAgentKey.current = agentKey;

  useEffect(() => {
    setEntries(null);
    setError(null);
    latestRefresh.current += 1;
    committedNetworkResult.current = 0;
  }, [agentKey]);

  const refresh = useCallback(async () => {
    const client = useSessionStore.getState().sessions[serverId]?.client;
    if (!client) {
      return null;
    }
    const refreshId = latestRefresh.current + 1;
    latestRefresh.current = refreshId;
    if (mounted.current && activeAgentKey.current === agentKey) {
      setError(null);
    }
    try {
      const payload = await fetchMessageJumpTimeline(client, agentId);
      if (payload.error) {
        throw new Error(payload.error);
      }
      const built = buildJumpIndexFromTimeline({
        entries: payload.entries,
        epoch: payload.epoch,
        formatTimestamp: (iso) => formatTimeAgo(new Date(iso)),
        imageMessagePreview: t("agentStream.messageJump.imageMessage"),
      });
      if (
        mounted.current &&
        activeAgentKey.current === agentKey &&
        latestRefresh.current === refreshId
      ) {
        committedNetworkResult.current += 1;
        setEntries(built);
        setError(null);
      }
      void saveStoredJumpIndex(AsyncStorage, agentKey, built);
      return built;
    } catch (e: unknown) {
      if (
        mounted.current &&
        activeAgentKey.current === agentKey &&
        latestRefresh.current === refreshId
      ) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return null;
    }
  }, [agentId, serverId, t, agentKey]);

  // Seed from cache instantly, then refresh in the background on mount/enable.
  useEffect(() => {
    mounted.current = true;
    if (!sessionClient || !enabled) {
      return;
    }
    let cancelled = false;
    const networkResultAtLoadStart = committedNetworkResult.current;
    void loadStoredJumpIndex(AsyncStorage, agentKey).then((cached) => {
      if (
        cancelled ||
        activeAgentKey.current !== agentKey ||
        committedNetworkResult.current !== networkResultAtLoadStart ||
        !cached ||
        cached.length === 0
      ) {
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
  }, [sessionClient, enabled, agentId, serverId, agentKey]);

  return useMemo(
    () => ({ entries, error, refresh, ready: entries !== null || error !== null }),
    [entries, error, refresh],
  );
}
