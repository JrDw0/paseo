import { useMemo, useRef } from "react";
import { useAggregatedAgents } from "./use-aggregated-agents";
import { buildWorkspaceRowAgentMeta, type WorkspaceRowAgentMeta } from "./workspace-row-agent-meta";

export { buildWorkspaceRowAgentMeta, type WorkspaceRowAgentMeta };

/**
 * Aggregated-agent driven meta lookup keyed by "serverId:workspaceId". Meta
 * objects keep identity across rebuilds when their fields are unchanged so
 * context consumers only re-render on real updates.
 */
export function useWorkspaceRowAgentMeta(): ReadonlyMap<string, WorkspaceRowAgentMeta> {
  const { agents } = useAggregatedAgents();
  const previousMetaRef = useRef(new Map<string, WorkspaceRowAgentMeta>());

  return useMemo(() => {
    const built = buildWorkspaceRowAgentMeta(agents);
    const previous = previousMetaRef.current;
    const next = new Map<string, WorkspaceRowAgentMeta>();
    for (const [key, meta] of built) {
      const stale = previous.get(key);
      next.set(
        key,
        stale &&
          stale.provider === meta.provider &&
          stale.lastActivityAt === meta.lastActivityAt &&
          stale.agentTitle === meta.agentTitle
          ? stale
          : meta,
      );
    }
    previousMetaRef.current = next;
    return next;
  }, [agents]);
}
