import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

/**
 * Primary label precedence: a user-set title always wins, then the session's
 * title (imports backfill it from the first prompt), then the workspace name.
 * The name is last because for worktrees it's just the git branch — indistinguishable
 * when every workspace sits on the same branch.
 */
export function resolveSidebarWorkspacePrimaryLabel(input: {
  workspace: Pick<SidebarWorkspaceEntry, "name" | "title">;
  agentTitle?: string | null;
}): string {
  if (input.workspace.title) {
    return input.workspace.title;
  }
  return input.agentTitle ?? input.workspace.name;
}
