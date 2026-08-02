import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";

/**
 * Primary label precedence: a user-set title always wins, then the session's
 * title (imports backfill it from the first prompt), then the workspace name.
 * The name is last because for worktrees it's just the git branch — indistinguishable
 * when every workspace sits on the same branch.
 */
export function resolveSidebarWorkspacePrimaryLabel(input: {
  // A real SidebarWorkspaceEntry always has `title` (the user-set name); the
  // accessibility label composes over a narrower Pick where it may be absent,
  // so it's optional here and simply means "no user title".
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch"> & { title?: string | null };
  agentTitle?: string | null;
}): string {
  if (input.workspace.title) {
    return input.workspace.title;
  }
  return input.agentTitle ?? input.workspace.name;
}

export function resolveSidebarWorkspaceAccessibilityLabel(input: {
  workspace: Pick<SidebarWorkspaceEntry, "name" | "currentBranch" | "statusBucket">;
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
