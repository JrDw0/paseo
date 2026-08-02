import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceRowAgentMeta } from "@/hooks/use-workspace-row-agent-meta";
import type { SidebarWorkspaceFilterPredicate } from "@/utils/sidebar-workspace-filter";

/**
 * Ambient context for the sidebar workspace list:
 * - filterText: the compact header's filter input, shared by list and header
 *   without threading props through the retained panel shells.
 * - filter predicate: built by the list root (it owns entries/meta/hosts) and
 *   consumed by the project- and status-mode renderers.
 * - row agent meta: provider/last-activity/agent-title per workspace, built in
 *   the list root and consumed by leaf rows.
 */

const EMPTY_WORKSPACE_ROW_AGENT_META: ReadonlyMap<string, WorkspaceRowAgentMeta> = new Map();

export interface SidebarFilterTextContextValue {
  filterText: string;
  setFilterText: (value: string) => void;
}

const SidebarFilterTextContext = createContext<SidebarFilterTextContextValue | null>(null);

export function SidebarFilterTextProvider({
  value,
  children,
}: {
  value: SidebarFilterTextContextValue;
  children: ReactNode;
}) {
  return (
    <SidebarFilterTextContext.Provider value={value}>{children}</SidebarFilterTextContext.Provider>
  );
}

export function useSidebarFilterText(): SidebarFilterTextContextValue | null {
  return useContext(SidebarFilterTextContext);
}

const SidebarWorkspaceFilterContext = createContext<SidebarWorkspaceFilterPredicate | null>(null);

export function SidebarWorkspaceFilterProvider({
  value,
  children,
}: {
  value: SidebarWorkspaceFilterPredicate | null;
  children: ReactNode;
}) {
  return (
    <SidebarWorkspaceFilterContext.Provider value={value}>
      {children}
    </SidebarWorkspaceFilterContext.Provider>
  );
}

export function useSidebarWorkspaceFilter(): SidebarWorkspaceFilterPredicate | null {
  return useContext(SidebarWorkspaceFilterContext);
}

const SidebarRowAgentMetaContext = createContext<ReadonlyMap<string, WorkspaceRowAgentMeta>>(
  EMPTY_WORKSPACE_ROW_AGENT_META,
);

export function SidebarRowAgentMetaProvider({
  value,
  children,
}: {
  value: ReadonlyMap<string, WorkspaceRowAgentMeta>;
  children: ReactNode;
}) {
  return (
    <SidebarRowAgentMetaContext.Provider value={value}>
      {children}
    </SidebarRowAgentMetaContext.Provider>
  );
}

export function useSidebarRowAgentMeta(
  serverId: string,
  workspaceId: string,
): WorkspaceRowAgentMeta | undefined {
  const metaByKey = useContext(SidebarRowAgentMetaContext);
  return metaByKey.get(`${serverId}:${workspaceId}`);
}
