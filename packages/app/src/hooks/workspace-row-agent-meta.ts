import { isWorkspaceRootAgent } from "@/subagents/policies";
import type { AggregatedAgent } from "./use-aggregated-agents";

/**
 * What a sidebar workspace row borrows from its most recent root agent:
 * which provider runs there, when the last message activity happened, and the
 * agent's own title so the row can surface it instead of the workspace name.
 */
export interface WorkspaceRowAgentMeta {
  provider: AggregatedAgent["provider"];
  lastActivityAt: Date;
  agentTitle: string | null;
}

function workspaceMetaKey(agent: AggregatedAgent): string {
  return `${agent.serverId}:${agent.workspaceId}`;
}

/**
 * Picks the most recently active root agent per "serverId:workspaceId".
 * Subagents are excluded (they share the workspace but carry their own
 * provider/activity), like the sidebar status buckets do.
 */
export function buildWorkspaceRowAgentMeta(
  agents: readonly AggregatedAgent[],
): Map<string, WorkspaceRowAgentMeta> {
  const agentsByIdByServer = new Map<string, Map<string, AggregatedAgent>>();
  for (const agent of agents) {
    let byId = agentsByIdByServer.get(agent.serverId);
    if (!byId) {
      byId = new Map();
      agentsByIdByServer.set(agent.serverId, byId);
    }
    byId.set(agent.id, agent);
  }

  const latestByWorkspace = new Map<string, AggregatedAgent>();
  for (const agent of agents) {
    const parent = agent.parentAgentId
      ? agentsByIdByServer.get(agent.serverId)?.get(agent.parentAgentId)
      : undefined;
    if (!isWorkspaceRootAgent(agent, parent)) {
      continue;
    }
    const key = workspaceMetaKey(agent);
    const current = latestByWorkspace.get(key);
    if (!current || agent.lastActivityAt.getTime() > current.lastActivityAt.getTime()) {
      latestByWorkspace.set(key, agent);
    }
  }

  const metaByKey = new Map<string, WorkspaceRowAgentMeta>();
  for (const [key, agent] of latestByWorkspace) {
    metaByKey.set(key, {
      provider: agent.provider,
      lastActivityAt: agent.lastActivityAt,
      agentTitle: agent.title,
    });
  }
  return metaByKey;
}
