import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";

/**
 * Primary label precedence is the same in every mode: a user-set title always
 * wins, then the mode's source (branch or the latest agent's title), then the
 * workspace name. This is the single rule so a row no longer flips between the
 * conversation title and the workspace name depending on who looked at it last.
 */
export function resolveSidebarWorkspacePrimaryLabel(input: {
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch" | "title">;
  workspaceTitleSource: WorkspaceTitleSource;
  agentTitle?: string | null;
}): string {
  if (input.workspace.title) {
    return input.workspace.title;
  }
  if (input.workspaceTitleSource === "branch") {
    return input.workspace.currentBranch ?? input.workspace.name;
  }
  if (input.workspaceTitleSource === "agent") {
    return input.agentTitle ?? input.workspace.name;
  }
  return input.workspace.name;
}
