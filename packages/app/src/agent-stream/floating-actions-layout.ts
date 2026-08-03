import { MAX_CONTENT_WIDTH } from "@/constants/layout";

const EDGE_INSET = 16;
const ACTION_SIZE = 40;
const CONTENT_GAP = 16;

// On narrower desktop panes, reserve the same space on both sides of the
// message rail. This keeps the rail centered while the trailing action stack
// remains outside its interactive content.
export const DESKTOP_FLOATING_ACTIONS_CLEARANCE = ACTION_SIZE + CONTENT_GAP;

export function resolveFloatingActionsRight(input: {
  containerWidth: number | null;
  isCompact: boolean;
}): number {
  if (input.isCompact || input.containerWidth === null || !Number.isFinite(input.containerWidth)) {
    return EDGE_INSET;
  }

  const contentSideSpace = Math.max(0, (input.containerWidth - MAX_CONTENT_WIDTH) / 2);
  return Math.max(EDGE_INSET, contentSideSpace - DESKTOP_FLOATING_ACTIONS_CLEARANCE);
}
