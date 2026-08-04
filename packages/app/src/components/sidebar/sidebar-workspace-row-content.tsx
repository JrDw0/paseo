import { memo, useId, useMemo, useCallback, useState, type ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { CircleAlert, Folder, FolderGit2, Monitor } from "lucide-react-native";
import { ProjectStatusIndicator } from "@/components/sidebar/project-leading-visual";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import {
  WorkspaceMetaRow,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  hasSidebarWorkspaceTrailing,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor, isEmphasizedStatusDotBucket } from "@/utils/status-dot-color";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { useSidebarRowAgentMeta } from "@/components/sidebar/sidebar-workspace-list-context";
import { getProviderIcon } from "@/components/provider-icons";
import { useTranslation } from "react-i18next";
import { formatTimeAgoLocalized } from "@/utils/time";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";

// The scrim spans more than the kebab so the fade starts left of the diff stat. Solid from
// SCRIM_SOLID_OFFSET rightward, which keeps the kebab itself off the gradient entirely.
const SCRIM_WIDTH = 48;
const SCRIM_SOLID_OFFSET = "55%";

const DEFAULT_STATUS_DOT_SIZE = 7;
const EMPHASIZED_STATUS_DOT_SIZE = 9;
const DEFAULT_STATUS_DOT_OFFSET = 0;
const EMPHASIZED_STATUS_DOT_OFFSET = -1;

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const needsInputColorMapping = (theme: Theme) => ({
  color: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});
const amberColorMapping = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const blueColorMapping = (theme: Theme) => ({ color: theme.colors.palette.blue[500] });

const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderGit2 = withUnistyles(FolderGit2);

/**
 * react-native-svg's extractGradient reads stopColor off the child elements structurally,
 * without rendering them, so wrapping Stop itself in withUnistyles hides the color from it and
 * the native gradient silently falls back to black. Theme the whole SVG instead and keep real
 * Stop elements as direct children of the gradient.
 */
function TrailingActionScrimSvg({ gradientId, color }: { gradientId: string; color: string }) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          {/* Same color at both ends, varying only stopOpacity. Interpolating a hex toward
              `transparent` goes through black in some engines and leaves a grey fringe. */}
          <Stop offset="0%" stopColor={color} stopOpacity={0} />
          <Stop offset={SCRIM_SOLID_OFFSET} stopColor={color} stopOpacity={1} />
          <Stop offset="100%" stopColor={color} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const ThemedTrailingActionScrimSvg = withUnistyles(TrailingActionScrimSvg);

const scrimColorMapping = (theme: Theme) => ({ color: theme.colors.surfaceSidebarHover });

export function SidebarWorkspaceRowFrame({
  workspace,
  isDragging = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  isDragging?: boolean;
  children: (input: {
    isHovered: boolean;
    contextMenuOpen: boolean;
    onContextMenuOpenChange: (open: boolean) => void;
    hoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
  }) => ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => {
    if (!contextMenuOpen) setIsHovered(true);
  }, [contextMenuOpen]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    setContextMenuOpen(open);
    if (open) setIsHovered(false);
  }, []);
  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return (
    <WorkspaceHoverCard
      workspace={workspace}
      prHint={workspace.prHint}
      isDragging={isDragging}
      disabled={contextMenuOpen}
    >
      {children({
        isHovered: isHovered && !contextMenuOpen,
        contextMenuOpen,
        onContextMenuOpenChange: handleContextMenuOpenChange,
        hoverHandlers,
      })}
    </WorkspaceHoverCard>
  );
}

export const SidebarWorkspaceRowContent = memo(function SidebarWorkspaceRowContent({
  workspace,
  hostBadge,
  leadingProjectName = null,
  leadingProjectIconDataUri = null,
  serviceSummary = null,
  backdrop,
  isHovered,
  isLoading,
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  reserveIdleStatusIndicatorSpace = true,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  /** Hoisted rows use their project icon as the leading visual because no project row contains them. */
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  serviceSummary?: WorkspaceServiceSummary | null;
  /** The row's current background, so the project status badge can knock out of it. */
  backdrop: SurfaceBackdrop;
  isHovered: boolean;
  isLoading: boolean;
  isCreating?: boolean;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  /** Keep the empty leading slot when the workspace has no active status. */
  reserveIdleStatusIndicatorSpace?: boolean;
  children?: ReactNode;
}) {
  const agentMeta = useSidebarRowAgentMeta(workspace.serverId, workspace.workspaceId);
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({
    workspace,
    agentTitle: agentMeta?.agentTitle ?? null,
  });
  const isCompact = useIsCompactFormFactor();
  // The row title is the scan target, so on touch/compact surfaces (where the
  // hover never fires) it must rest at full opacity, not the desktop dimmed
  // state. Hover still controls it on desktop. See docs/hover.md "Native fallback".
  const fullOpacityTitle = isHovered || isNative || isCompact;
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      isCompact && styles.workspaceBranchTextCompact,
      fullOpacityTitle && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [isCompact, fullOpacityTitle, isCreating],
  );

  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        {leadingProjectName ? (
          <ProjectStatusIndicator
            iconDataUri={leadingProjectIconDataUri}
            displayName={leadingProjectName}
            projectViewKey={workspace.projectViewKey}
            statusBucket={workspace.statusBucket}
            backdrop={backdrop}
            loading={isLoading}
            testID={`sidebar-row-project-icon-${workspace.workspaceKey}`}
          />
        ) : (
          <WorkspaceStatusIndicator
            bucket={workspace.statusBucket}
            workspaceKind={workspace.workspaceKind}
            loading={isLoading}
            reserveIdleSpace={reserveIdleStatusIndicatorSpace}
            compact={isCompact}
          />
        )}
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <View style={styles.workspaceTitleLeft}>
              <WorkspaceProviderIcon meta={agentMeta} compact={isCompact} />
              <Text style={workspaceBranchTextStyle} numberOfLines={1}>
                {workspaceLabel}
              </Text>
            </View>
            <View style={[sidebarWorkspaceRowStyles.rowRight, styles.workspaceTitleRowRight]}>
              <WorkspaceWorktreeBranchBadge workspace={workspace} />
              <WorkspaceAgentActivity meta={agentMeta} />
              {children}
            </View>
          </View>
          <WorkspaceMetaRow
            hostBadge={hostBadge ?? null}
            prHint={workspace.prHint}
            serviceSummary={serviceSummary}
          />
        </View>
      </View>
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </View>
  );
});

function WorkspaceProviderIcon({
  meta,
  compact = false,
}: {
  meta: ReturnType<typeof useSidebarRowAgentMeta>;
  compact?: boolean;
}) {
  if (!meta?.provider) {
    return null;
  }
  const Icon = getProviderIcon(meta.provider);
  return <Icon size={compact ? 16 : 12} color={styles.workspaceProviderIcon.color} />;
}

function WorkspaceAgentActivity({ meta }: { meta: ReturnType<typeof useSidebarRowAgentMeta> }) {
  const { t, i18n } = useTranslation();
  if (!meta) {
    return null;
  }
  return (
    <Text style={styles.workspaceAgentActivity} numberOfLines={1}>
      {formatTimeAgoLocalized(meta.lastActivityAt, new Date(), t, i18n.language)}
    </Text>
  );
}

function WorkspaceWorktreeBranchBadge({ workspace }: { workspace: SidebarWorkspaceEntry }) {
  // Worktrees are identified by their branch; the general title precedence skips
  // the branch, so surface it as a right-hand chip so the row still says which
  // branch this worktree checks out.
  if (workspace.workspaceKind !== "worktree" || !workspace.currentBranch) {
    return null;
  }
  return (
    <View style={styles.workspaceBranchBadge} testID="workspace-worktree-branch-badge">
      <ThemedFolderGit2 size={12} uniProps={blueColorMapping} />
      <Text style={styles.workspaceBranchBadgeText} numberOfLines={1}>
        {workspace.currentBranch}
      </Text>
    </View>
  );
}

function resolveStatusDotGeometry(bucket: SidebarWorkspaceEntry["statusBucket"], compact: boolean) {
  const emphasized = isEmphasizedStatusDotBucket(bucket);
  let size = compact ? 8 : DEFAULT_STATUS_DOT_SIZE;
  let offset = DEFAULT_STATUS_DOT_OFFSET;
  if (emphasized) {
    size = compact ? 10 : EMPHASIZED_STATUS_DOT_SIZE;
    offset = compact ? -2 : EMPHASIZED_STATUS_DOT_OFFSET;
  }
  return { size, offset };
}

function WorkspaceStatusIndicator({
  bucket,
  workspaceKind,
  loading = false,
  reserveIdleSpace = true,
  compact = false,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  workspaceKind: SidebarWorkspaceEntry["workspaceKind"];
  loading?: boolean;
  reserveIdleSpace?: boolean;
  /** Touch drawers scale the dot/icon up one notch for legibility at arm's length. */
  compact?: boolean;
}) {
  // Busy is a dot here for the same reason it is on a project icon: every status in the
  // sidebar is a dot, and a row with a project icon simply moves that dot onto the icon.
  // A row starting up and a row working are both busy, so they share the dot and differ only
  // in testID.
  if (loading) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-loading">
        <View style={styles.standaloneRunningDot} />
      </View>
    );
  }

  if (shouldRenderSyncedStatusLoader({ bucket })) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-running">
        <View style={styles.standaloneRunningDot} />
      </View>
    );
  }

  if (bucket === "needs_input") {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-needs_input">
        <ThemedCircleAlert size={compact ? 16 : 14} uniProps={amberColorMapping} />
      </View>
    );
  }

  if (bucket === "attention") {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-attention">
        <View style={[styles.standaloneStatusDot, compact && styles.standaloneStatusDotCompact]} />
      </View>
    );
  }

  if (bucket === "done") {
    // An idle row still gets a dot rather than an empty slot. Nested rows are marked as
    // workspaces by indentation alone, and with nothing in the leading slot the rail has no
    // edge to read against — a workspace carrying its own glyph starts looking like a project
    // header. The dot is muted to half opacity so it holds the rail without reporting status.
    return reserveIdleSpace ? (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-done">
        <View style={styles.idleStatusDot} />
      </View>
    ) : null;
  }

  let KindIcon: typeof ThemedMonitor;
  if (workspaceKind === "local_checkout") KindIcon = ThemedMonitor;
  else if (workspaceKind === "worktree") KindIcon = ThemedFolderGit2;
  else KindIcon = ThemedFolder;

  const dotColorStyle = getStatusDotColorStyle(bucket);
  const { size: statusDotSize, offset: statusDotOffset } = resolveStatusDotGeometry(
    bucket,
    compact,
  );
  return (
    <View style={styles.workspaceStatusDot} testID={`workspace-status-indicator-${bucket}`}>
      <KindIcon size={compact ? 16 : 14} uniProps={foregroundMutedColorMapping} />
      {dotColorStyle ? (
        <StatusDotOverlay
          dotColorStyle={dotColorStyle}
          size={statusDotSize}
          offset={statusDotOffset}
        />
      ) : null}
    </View>
  );
}

function StatusDotOverlay({
  dotColorStyle,
  size,
  offset,
}: {
  dotColorStyle: ViewStyle;
  size: number;
  offset: number;
}) {
  const overlayStyle = useMemo(
    () => [
      styles.statusDotOverlay,
      dotColorStyle,
      {
        width: size,
        height: size,
        right: offset,
        bottom: offset,
      },
    ],
    [dotColorStyle, offset, size],
  );
  return <View style={overlayStyle} />;
}

function getStatusDotColorStyle(bucket: SidebarStateBucket) {
  switch (bucket) {
    case "needs_input":
      return styles.statusDotNeedsInput;
    case "failed":
      return styles.statusDotFailed;
    case "running":
      return styles.statusDotRunning;
    case "attention":
      return styles.statusDotAttention;
    case "done":
      return null;
  }
}

export const sidebarWorkspaceRowStyles = StyleSheet.create((theme) => ({
  // How far a workspace row sits inside the group header above it — a project row or a
  // status group header. Both groupings share this one indent, so every grouped workspace row
  // in the sidebar sits on the same rail regardless of how the list is grouped. Pinned rows
  // are not grouped and stay flush.
  //
  // It is row padding rather than a margin on the list, because the row's hover and selected
  // backgrounds have to keep spanning the group's full width. Indenting the container instead
  // pulls the highlight in with the content and the row stops lining up with its header.
  rowIndented: {
    paddingLeft: theme.spacing[2] + theme.spacing[2],
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  shortcutBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
  hidden: { opacity: 0 },
  // Stays position:relative at zero width so the absolutely-positioned kebab keeps
  // anchoring to the same right edge whether or not the slot holds anything.
  trailingActionSlot: {
    position: "relative",
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionSlotReserved: {
    position: "relative",
    minWidth: 18,
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
  },
  trailingActionScrim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: SCRIM_WIDTH,
  },
}));

export function SidebarWorkspaceShortcutBadge({ number }: { number: number }) {
  return (
    <View style={sidebarWorkspaceRowStyles.shortcutBadge}>
      <Text style={sidebarWorkspaceRowStyles.shortcutBadgeText}>{number}</Text>
    </View>
  );
}

/**
 * What the trailing slot shows for a row. Derived in one place because three row renderers
 * share it: the two project-mode rows and the status-mode row. The rule used to be copied
 * into each of them and immediately drifted — one call site kept hiding the diff after the
 * others stopped.
 *
 * The trailing content survives the kebab on hover and fades under the scrim instead of
 * blinking out. Touch has no hover, so its permanent kebab still hides the content outright
 * rather than scrimming an unhovered row whose background doesn't match the gradient.
 */
export function resolveTrailingActionVisibility({
  workspace,
  trailing,
  hasArchiveAction,
  isHovered,
  isTouchPlatform,
  showShortcut,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
  hasArchiveAction: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
  showShortcut: boolean;
}): {
  showTrailing: boolean;
  showKebab: boolean;
  showScrim: boolean;
  renderSlot: boolean;
  reserveSlotWidth: boolean;
} {
  const hasTrailing = hasSidebarWorkspaceTrailing({ workspace, trailing });
  const showKebab = Boolean(hasArchiveAction && (isHovered || isTouchPlatform)) && !showShortcut;
  const showTrailing = hasTrailing && !showShortcut && (isHovered || !showKebab);
  return {
    showTrailing,
    showKebab,
    // The scrim paints the row's own hover background, so it can only be drawn on a hovered
    // row — over an unhovered one the gradient fades to the wrong color. That is also why
    // touch, which shows the kebab without ever hovering, never gets one.
    showScrim: showKebab && isHovered,
    renderSlot: hasArchiveAction || hasTrailing,
    // The slot only holds width for something that permanently sits in it. Trailing content
    // does; the kebab only does on touch, where there is no hover for it to appear on and so
    // no scrim to let it overlay the title. Everywhere else the width goes back to the title
    // and the kebab fades in over its tail.
    reserveSlotWidth: hasTrailing || (hasArchiveAction && isTouchPlatform),
  };
}

export function SidebarWorkspaceTrailingActionSlot({
  reserveWidth,
  children,
}: {
  reserveWidth: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={
        reserveWidth
          ? sidebarWorkspaceRowStyles.trailingActionSlotReserved
          : sidebarWorkspaceRowStyles.trailingActionSlot
      }
    >
      {children}
    </View>
  );
}

export function SidebarWorkspaceTrailingActionBase({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  if (!children) return null;
  return <View style={visible ? undefined : sidebarWorkspaceRowStyles.hidden}>{children}</View>;
}

export function SidebarWorkspaceTrailingActionOverlay({
  visible,
  scrim = false,
  children,
}: {
  visible: boolean;
  /** Fade the row into the kebab when something (the diff stat) is still rendered behind it. */
  scrim?: boolean;
  children: ReactNode;
}) {
  if (!visible || !children) return null;
  return (
    <>
      {scrim ? <TrailingActionScrim /> : null}
      <View style={sidebarWorkspaceRowStyles.trailingActionOverlay}>{children}</View>
    </>
  );
}

/**
 * The row's own background, faded in from the right, sitting between the diff stat and the
 * kebab. The kebab lands on fully opaque background while the diff dissolves underneath it
 * rather than blinking out — hiding the diff outright was the old behavior and it cost a
 * visible flicker on every hover.
 *
 * Anchored to the trailing slot, which is position:relative. Wider than the slot on purpose:
 * the fade has to start before the diff stat does or the diff's left edge cuts off hard.
 */
function TrailingActionScrim() {
  // useId's output contains characters that are not legal inside url(#...) — React 19 wraps
  // ids in guillemets, React 18 in colons — and an unresolvable fill paints nothing at all.
  // Keep the per-instance uniqueness, drop everything a fragment reference can't carry.
  const gradientId = `sidebar-scrim-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <View style={sidebarWorkspaceRowStyles.trailingActionScrim} pointerEvents="none">
      <ThemedTrailingActionScrimSvg gradientId={gradientId} uniProps={scrimColorMapping} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  workspaceRowContent: {
    position: "relative",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceContentColumn: {
    flex: 1,
    minWidth: 0,
  },
  workspaceTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  workspaceTitleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  workspaceTitleRowRight: {
    alignItems: "center",
  },
  workspaceProviderIcon: {
    color: theme.colors.foregroundMuted,
  },
  workspaceAgentActivity: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 20,
    flexShrink: 0,
  },
  workspaceBranchBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: 140,
    flexShrink: 1,
    paddingHorizontal: theme.spacing[2],
    height: 18,
    borderRadius: theme.borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
  },
  workspaceBranchBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    flexShrink: 1,
  },
  shortcutBadgeOverlay: {
    position: "absolute",
    top: 1,
    right: 0,
  },
  workspaceStatusDot: {
    position: "relative",
    width: theme.iconSize.md,
    height: 20,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotOverlay: {
    position: "absolute",
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  standaloneStatusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  standaloneRunningDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
  },
  idleStatusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundExtraMuted,
    opacity: 0.3,
  },
  standaloneStatusDotCompact: {
    width: 10,
    height: 10,
  },
  // The title owns the first line outright now that the host, change request and CI moved
  // to the meta row, so it takes the full width the trailing slot leaves behind.
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    flex: 1,
    minWidth: 0,
  },
  // Touch drawers bump the title to body size so the scan target reads at arm's length.
  workspaceBranchTextCompact: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  statusDotNeedsInput: {
    backgroundColor: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotFailed: {
    backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotRunning: {
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotAttention: {
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
}));
