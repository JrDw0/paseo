export function shouldShowSidebarWorkspaceDiffStat(input: {
  hasDiffStat: boolean;
  isTouchPlatform: boolean;
}): boolean {
  return input.hasDiffStat && !input.isTouchPlatform;
}
