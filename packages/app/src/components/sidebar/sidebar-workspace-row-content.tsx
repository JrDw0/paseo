import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  CircleAlert,
  ExternalLink,
  Folder,
  FolderGit2,
  GitPullRequest,
  Globe,
  Monitor,
  SquareTerminal,
} from "lucide-react-native";
import { SidebarSubtitleProjectIcon } from "@/components/sidebar/sidebar-subtitle-project-icon";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import { SyncedLoader } from "@/components/synced-loader";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { Theme } from "@/styles/theme";
import type { PrHint } from "@/git/use-pr-status-query";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import { ForgeBrandIcon } from "@/git/forge-icon";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { isEmphasizedStatusDotBucket } from "@/utils/status-dot-color";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { openExternalUrl } from "@/utils/open-external-url";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { useSidebarRowAgentMeta } from "@/components/sidebar/sidebar-workspace-list-context";
import { getProviderIcon } from "@/components/provider-icons";
import { formatTimeAgo } from "@/utils/time";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DiffStat } from "@/components/diff-stat";

const DEFAULT_STATUS_DOT_SIZE = 7;
const EMPHASIZED_STATUS_DOT_SIZE = 9;
const DEFAULT_STATUS_DOT_OFFSET = 0;
const EMPHASIZED_STATUS_DOT_OFFSET = -1;

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const amberColorMapping = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const syncedLoaderColorMapping = (theme: Theme) => ({
  color:
    theme.colorScheme === "light"
      ? theme.colors.palette.amber[700]
      : theme.colors.palette.amber[500],
});
const blueColorMapping = (theme: Theme) => ({ color: theme.colors.palette.blue[500] });
const greenColorMapping = (theme: Theme) => ({ color: theme.colors.palette.green[500] });
const redColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });
const purpleColorMapping = (theme: Theme) => ({ color: theme.colors.palette.purple[500] });

const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedSyncedLoader = withUnistyles(SyncedLoader);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderGit2 = withUnistyles(FolderGit2);
const ThemedGlobe = withUnistyles(Globe);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);

function renderChecksBadgeForgeIcon(icon: string) {
  return <ForgeBrandIcon iconKind={icon} size={10} uniProps={redColorMapping} />;
}

type SidebarWorkspaceScriptIconKind = "service" | "command";

export function SidebarWorkspaceRowFrame({
  workspace,
  isDragging = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  isDragging?: boolean;
  children: (input: {
    isHovered: boolean;
    hoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
  }) => ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return (
    <WorkspaceHoverCard workspace={workspace} prHint={workspace.prHint} isDragging={isDragging}>
      {children({ isHovered, hoverHandlers })}
    </WorkspaceHoverCard>
  );
}

// The row owns both desktop and compact metadata because the same selection and hover rails must
// stay aligned across project and status grouping.
// oxlint-disable-next-line complexity
export const SidebarWorkspaceRowContent = memo(function SidebarWorkspaceRowContent({
  workspace,
  subtitle,
  subtitleProjectName = null,
  subtitleProjectIconDataUri = null,
  scriptIconKind = null,
  isHovered,
  isLoading,
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  reserveIdleStatusIndicatorSpace = true,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  subtitle?: string | null;
  /** Project named by the subtitle. Set it to lead the subtitle line with that project's icon. */
  subtitleProjectName?: string | null;
  subtitleProjectIconDataUri?: string | null;
  scriptIconKind?: SidebarWorkspaceScriptIconKind | null;
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
  const isCompact = useIsCompactFormFactor();
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({
    workspace,
    agentTitle: agentMeta?.agentTitle ?? null,
  });
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      scriptIconKind ? styles.workspaceBranchTextWithAccessory : styles.workspaceBranchTextFlexible,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [scriptIconKind, isHovered, isCreating],
  );
  const { t } = useTranslation();
  const statusLabelKey = {
    needs_input: "needsInput",
    failed: "failed",
    attention: "attention",
    running: "running",
    done: "done",
  }[workspace.statusBucket];
  const statusLabel = t(`sidebar.workspace.status.${statusLabelKey}`);
  let secondaryContent: ReactNode = null;
  if (isCompact) {
    secondaryContent = (
      <View style={styles.workspaceCompactMetadataRow}>
        <Text style={styles.workspaceStatusLabel} numberOfLines={1}>
          {statusLabel}
        </Text>
        {subtitleProjectName ? (
          <SidebarSubtitleProjectIcon
            projectViewKey={workspace.projectViewKey}
            projectName={subtitleProjectName}
            iconDataUri={subtitleProjectIconDataUri}
            testID={`sidebar-row-project-icon-${workspace.workspaceKey}`}
          />
        ) : null}
        {subtitle ? (
          <Text style={styles.workspaceSubtitleCompact} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        <WorkspaceWorktreeBranchBadge workspace={workspace} compact />
        {workspace.diffStat ? (
          <DiffStat
            additions={workspace.diffStat.additions}
            deletions={workspace.diffStat.deletions}
            testID={`sidebar-workspace-diff-${workspace.workspaceKey}`}
          />
        ) : null}
        <WorkspaceAgentActivity meta={agentMeta} compact />
      </View>
    );
  } else if (subtitle) {
    secondaryContent = (
      <View style={styles.workspaceSubtitleRow}>
        {subtitleProjectName ? (
          <SidebarSubtitleProjectIcon
            projectViewKey={workspace.projectViewKey}
            projectName={subtitleProjectName}
            iconDataUri={subtitleProjectIconDataUri}
            testID={`sidebar-row-project-icon-${workspace.workspaceKey}`}
          />
        ) : null}
        <Text style={styles.workspaceSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        <WorkspaceStatusIndicator
          bucket={workspace.statusBucket}
          workspaceKind={workspace.workspaceKind}
          loading={isLoading}
          reserveIdleSpace={reserveIdleStatusIndicatorSpace}
        />
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <View style={styles.workspaceTitleLeft}>
              <WorkspaceProviderIcon meta={agentMeta} />
              <Text style={workspaceBranchTextStyle} numberOfLines={1}>
                {workspaceLabel}
              </Text>
              {scriptIconKind ? <WorkspaceScriptIcon kind={scriptIconKind} /> : null}
            </View>
            <View style={[sidebarWorkspaceRowStyles.rowRight, styles.workspaceTitleRowRight]}>
              {isCompact ? (
                children
              ) : (
                <>
                  <WorkspaceWorktreeBranchBadge workspace={workspace} />
                  <WorkspaceAgentActivity meta={agentMeta} />
                  {children}
                </>
              )}
            </View>
          </View>
          {secondaryContent}
          {workspace.prHint ? (
            <View style={styles.workspacePrBadgeRow}>
              <PrBadge hint={workspace.prHint} />
              <ChecksBadge checks={workspace.prHint.checks} forge={workspace.prHint.forge} />
            </View>
          ) : null}
        </View>
      </View>
      {showShortcutBadge && shortcutNumber !== null && !isCompact ? (
        <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </View>
  );
});

function WorkspaceProviderIcon({ meta }: { meta: ReturnType<typeof useSidebarRowAgentMeta> }) {
  if (!meta?.provider) {
    return null;
  }
  const Icon = getProviderIcon(meta.provider);
  return <Icon size={12} color={styles.workspaceProviderIcon.color} />;
}

function WorkspaceAgentActivity({
  meta,
  compact = false,
}: {
  meta: ReturnType<typeof useSidebarRowAgentMeta>;
  compact?: boolean;
}) {
  if (!meta) {
    return null;
  }
  return (
    <Text
      style={[styles.workspaceAgentActivity, compact && styles.workspaceAgentActivityCompact]}
      numberOfLines={1}
    >
      {formatTimeAgo(meta.lastActivityAt)}
    </Text>
  );
}

function WorkspaceWorktreeBranchBadge({
  workspace,
  compact = false,
}: {
  workspace: SidebarWorkspaceEntry;
  compact?: boolean;
}) {
  // Worktrees are identified by their branch; the general title precedence skips
  // the branch, so surface it as a right-hand chip so the row still says which
  // branch this worktree checks out.
  if (workspace.workspaceKind !== "worktree" || !workspace.currentBranch) {
    return null;
  }
  return (
    <View
      style={[styles.workspaceBranchBadge, compact && styles.workspaceBranchBadgeCompact]}
      testID="workspace-worktree-branch-badge"
    >
      <ThemedFolderGit2 size={12} uniProps={blueColorMapping} />
      <Text style={styles.workspaceBranchBadgeText} numberOfLines={1}>
        {workspace.currentBranch}
      </Text>
    </View>
  );
}

function WorkspaceScriptIcon({ kind }: { kind: SidebarWorkspaceScriptIconKind }) {
  return (
    <View
      style={styles.workspaceTitleAccessory}
      accessibilityLabel="Scripts available"
      testID={kind === "service" ? "workspace-globe-icon" : "workspace-terminal-icon"}
    >
      {kind === "service" ? (
        <ThemedGlobe size={12} uniProps={blueColorMapping} />
      ) : (
        <ThemedSquareTerminal size={12} uniProps={blueColorMapping} />
      )}
    </View>
  );
}

function WorkspaceStatusIndicator({
  bucket,
  workspaceKind,
  loading = false,
  reserveIdleSpace = true,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  workspaceKind: SidebarWorkspaceEntry["workspaceKind"];
  loading?: boolean;
  reserveIdleSpace?: boolean;
}) {
  const shouldShowSyncedLoader = shouldRenderSyncedStatusLoader({ bucket });

  if (loading) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-loading">
        <ThemedLoadingSpinner size={8} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }

  if (shouldShowSyncedLoader) {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-running">
        <ThemedSyncedLoader size={11} uniProps={syncedLoaderColorMapping} />
      </View>
    );
  }

  if (bucket === "needs_input") {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-needs_input">
        <ThemedCircleAlert size={14} uniProps={amberColorMapping} />
      </View>
    );
  }

  if (bucket === "attention") {
    return (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-attention">
        <View style={styles.standaloneStatusDot} />
      </View>
    );
  }

  if (bucket === "done") {
    return reserveIdleSpace ? (
      <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-done" />
    ) : null;
  }

  let KindIcon: typeof ThemedMonitor;
  if (workspaceKind === "local_checkout") KindIcon = ThemedMonitor;
  else if (workspaceKind === "worktree") KindIcon = ThemedFolderGit2;
  else KindIcon = ThemedFolder;

  const dotColorStyle = getStatusDotColorStyle(bucket);
  const statusDotSize = isEmphasizedStatusDotBucket(bucket)
    ? EMPHASIZED_STATUS_DOT_SIZE
    : DEFAULT_STATUS_DOT_SIZE;
  const statusDotOffset =
    statusDotSize === EMPHASIZED_STATUS_DOT_SIZE
      ? EMPHASIZED_STATUS_DOT_OFFSET
      : DEFAULT_STATUS_DOT_OFFSET;
  return (
    <View style={styles.workspaceStatusDot} testID={`workspace-status-indicator-${bucket}`}>
      <KindIcon size={14} uniProps={foregroundMutedColorMapping} />
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

function PrBadge({ hint }: { hint: PrHint }) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void openExternalUrl(hint.url);
    },
    [hint.url],
  );
  const textStyle = useMemo(
    () => (isHovered ? [prBadgeStyles.text, prBadgeStyles.textHovered] : prBadgeStyles.text),
    [isHovered],
  );
  const iconUniProps = isHovered ? foregroundColorMapping : getPrIconUniMapping(hint.state);
  const presentation = getForgePresentation(normalizeForge(hint.forge));

  const handlePressIn = useCallback((event: GestureResponderEvent) => event.stopPropagation(), []);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  const pressableStyle = useMemo(
    () => [prBadgeStyles.badge, isHovered && prBadgeStyles.badgePressed],
    [isHovered],
  );

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("workspace.git.pr.accessibility.pullRequest", {
        number: hint.number,
        context: presentation.changeRequestContext,
      })}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={pressableStyle}
    >
      {isHovered ? (
        <ThemedExternalLink size={12} uniProps={iconUniProps} />
      ) : (
        <ThemedGitPullRequest size={12} uniProps={iconUniProps} />
      )}
      <Text style={textStyle} numberOfLines={1}>
        {presentation.numberPrefix}
        {hint.number}
      </Text>
    </Pressable>
  );
}

function ChecksBadge({ checks, forge }: { checks: PrHint["checks"]; forge: PrHint["forge"] }) {
  if (!checks || checks.length === 0) return null;
  const failed = checks.filter((check) => check.status === "failure").length;
  if (failed === 0) return null;
  const icon = getForgePresentation(normalizeForge(forge)).icon;
  return (
    <View style={checksBadgeStyles.badge}>
      {renderChecksBadgeForgeIcon(icon)}
      <Text style={checksBadgeStyles.text}>{failed} failed</Text>
    </View>
  );
}

function getPrIconUniMapping(state: PrHint["state"]) {
  switch (state) {
    case "merged":
      return purpleColorMapping;
    case "open":
      return greenColorMapping;
    case "closed":
      return redColorMapping;
  }
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

const prBadgeStyles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  badgePressed: {
    opacity: 0.82,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
  textHovered: {
    color: theme.colors.foreground,
  },
}));

const checksBadgeStyles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
    color: theme.colors.palette.red[500],
  },
}));

export const sidebarWorkspaceRowStyles = StyleSheet.create((theme) => ({
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
  trailingActionSlot: {
    position: "relative",
    minWidth: 18,
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionSlotCompact: {
    minWidth: 36,
    minHeight: 36,
  },
  trailingActionOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
  },
}));

export function SidebarWorkspaceShortcutBadge({ number }: { number: number }) {
  return (
    <View style={sidebarWorkspaceRowStyles.shortcutBadge}>
      <Text style={sidebarWorkspaceRowStyles.shortcutBadgeText}>{number}</Text>
    </View>
  );
}

export function SidebarWorkspaceTrailingActionSlot({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <View
      style={[
        sidebarWorkspaceRowStyles.trailingActionSlot,
        compact && sidebarWorkspaceRowStyles.trailingActionSlotCompact,
      ]}
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
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  if (!visible || !children) return null;
  return <View style={sidebarWorkspaceRowStyles.trailingActionOverlay}>{children}</View>;
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
  workspaceAgentActivityCompact: {
    lineHeight: 16,
    maxWidth: 52,
    flexShrink: 1,
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
  workspaceBranchBadgeCompact: {
    maxWidth: 96,
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
    backgroundColor: theme.colors.palette.green[500],
  },
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    minWidth: 0,
  },
  workspaceBranchTextFlexible: {
    flex: 1,
  },
  workspaceBranchTextWithAccessory: {
    flexShrink: 1,
  },
  workspaceTitleAccessory: {
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  workspaceSubtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
  },
  workspaceSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 14,
    flexShrink: 1,
    minWidth: 0,
  },
  workspaceCompactMetadataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    marginTop: theme.spacing[1],
  },
  workspaceStatusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    flexShrink: 0,
  },
  workspaceSubtitleCompact: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
    minWidth: 0,
    flexShrink: 1,
  },
  workspacePrBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  statusDotNeedsInput: {
    backgroundColor: theme.colors.palette.amber[500],
    borderColor: theme.colors.surface0,
  },
  statusDotFailed: {
    backgroundColor: theme.colors.palette.red[500],
    borderColor: theme.colors.surface0,
  },
  statusDotRunning: {
    backgroundColor: theme.colors.palette.blue[500],
    borderColor: theme.colors.surface0,
  },
  statusDotAttention: {
    backgroundColor: theme.colors.palette.green[500],
    borderColor: theme.colors.surface0,
  },
}));
