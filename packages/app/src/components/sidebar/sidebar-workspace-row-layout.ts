export function shouldShowSidebarWorkspaceDiffStat(input: {
  hasDiffStat: boolean;
  isCompact: boolean;
}): boolean {
  return input.hasDiffStat && !input.isCompact;
}

export function shouldShowSidebarWorkspaceMetadataDiff(input: {
  hasDiffStat: boolean;
  isCompact: boolean;
}): boolean {
  return input.hasDiffStat && input.isCompact;
}
