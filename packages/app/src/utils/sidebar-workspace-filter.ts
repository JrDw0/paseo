import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import type { WorkspaceRowAgentMeta } from "@/hooks/use-workspace-row-agent-meta";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";

/**
 * Sidebar workspace filter: substring match across everything a row shows —
 * its rendered primary label, the raw workspace name, the project, the branch,
 * the agent provider, and the host label (the subtitle in multi-host sidebars).
 */

export function normalizeSidebarFilterQuery(query: string): string {
  return query.trim().toLowerCase();
}

export interface SidebarWorkspaceFilterFields {
  label: string;
  name: string;
  projectName: string;
  currentBranch: string | null;
  provider: string | null;
  hostLabel: string | null;
}

export function sidebarWorkspaceFilterFieldsMatch(
  fields: SidebarWorkspaceFilterFields,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  const candidates = [
    fields.label,
    fields.name,
    fields.projectName,
    fields.currentBranch,
    fields.provider,
    fields.hostLabel,
  ];
  return candidates.some((candidate) => candidate?.toLowerCase().includes(normalizedQuery));
}

/** Both structural placements and session entries satisfy this shape. */
export type SidebarWorkspaceFilterRow = Pick<
  SidebarWorkspaceEntry,
  "workspaceKey" | "serverId" | "workspaceId" | "name" | "projectName"
> & {
  currentBranch?: string | null;
};

export type SidebarWorkspaceFilterPredicate = (row: SidebarWorkspaceFilterRow) => boolean;

export function resolveSidebarWorkspaceFilterFields(input: {
  row: SidebarWorkspaceFilterRow;
  entry: SidebarWorkspaceEntry | null;
  agentMeta: WorkspaceRowAgentMeta | null;
  hostLabel: string;
}): SidebarWorkspaceFilterFields {
  const label = input.entry
    ? resolveSidebarWorkspacePrimaryLabel({
        workspace: input.entry,
        agentTitle: input.agentMeta?.agentTitle ?? null,
      })
    : input.row.name;
  return {
    label,
    name: input.row.name,
    projectName: input.row.projectName,
    currentBranch: input.entry?.currentBranch ?? input.row.currentBranch ?? null,
    provider: input.agentMeta?.provider ?? null,
    hostLabel: input.hostLabel,
  };
}
