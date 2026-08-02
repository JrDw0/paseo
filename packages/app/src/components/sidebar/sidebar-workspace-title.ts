import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";

/**
 * Primary label precedence is the same in every mode: a user-set title always
 * wins, then the mode's source (branch or the latest agent's title), then the
 * workspace name. This is the single rule so a row no longer flips between the
 * conversation title and the workspace name depending on who looked at it last.
 */
export function resolveSidebarWorkspacePrimaryLabel(input: {
  // A real SidebarWorkspaceEntry always has `title` (the user-set name); the
  // accessibility label composes over a narrower Pick where it may be absent,
  // so it's optional here and simply means "no user title".
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch"> & { title?: string | null };
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

export function resolveSidebarWorkspaceAccessibilityLabel(input: {
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch" | "statusBucket">;
  workspaceTitleSource: WorkspaceTitleSource;
  leadingProjectName?: string | null;
  hostBadgeLabel?: string | null;
  pullRequestLabel?: string | null;
  serviceLabel?: string | null;
}): string {
  return [
    input.leadingProjectName,
    resolveSidebarWorkspacePrimaryLabel(input),
    input.hostBadgeLabel,
    input.pullRequestLabel,
    input.serviceLabel,
    input.workspace.statusBucket === "done"
      ? null
      : STATUS_BUCKET_LABELS[input.workspace.statusBucket],
  ]
    .filter((label): label is string => Boolean(label))
    .join(", ");
}
