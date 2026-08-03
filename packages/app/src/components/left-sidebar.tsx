import { router, usePathname } from "expo-router";
import {
  CalendarClock,
  Clock,
  CircleHelp,
  FolderPlus,
  History,
  Home,
  MoreHorizontal,
  Plus,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import { HostPicker } from "@/components/hosts/host-picker";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/sidebar-display-preferences-menu";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HEADER_INNER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import {
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { RetainedPanelActivity } from "@/components/retained-panel";
import type { StatusGroup } from "@/hooks/sidebar-status-view-model";
import { type SidebarGroupMode, useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useHosts } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { usePanelStore } from "@/stores/panel-store";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { useIsMobilePanelPresented } from "@/mobile-panels/provider";
import {
  buildOpenProjectRoute,
  buildNewWorkspaceRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
  buildSettingsAddHostRoute,
  buildSettingsHostSectionRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarImportRecentButton } from "./sidebar/sidebar-import-recent-button";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import {
  SidebarFilterTextProvider,
  useSidebarFilterText,
} from "./sidebar/sidebar-workspace-list-context";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface SidebarSharedProps {
  theme: SidebarTheme;
  statusGroups: StatusGroup[];
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByViewKey: Map<string, string>;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  groupMode: SidebarGroupMode;
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  handleRefresh: () => void;
  handleOpenProject: () => void;
  handleHome: () => void;
  handleSettings: () => void;
  labels: SidebarLabels;
  newWorkspaceKeys: ShortcutKey[][] | null;
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}

interface SidebarLabels {
  addProject: string;
  newWorkspace: string;
  hosts: string;
  home: string;
  settings: string;
  searchHosts: string;
  sessions: string;
  schedules: string;
  closeSidebar: string;
  more: string;
  displayPreferences: string;
  importRecentSessions: string;
  help: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  closeSidebar: () => void;
  handleViewMoreNavigate: () => void;
  handleViewSchedulesNavigate: () => void;
}

type MobileMoreAction = "hosts" | "import" | "displayPreferences" | "help" | "settings";

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  active: boolean;
  handleViewMore: () => void;
  handleViewSchedules: () => void;
}

export const LeftSidebar = memo(function LeftSidebar({ active }: { active: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  const {
    projects,
    workspaceEntriesByKey,
    projectNamesByViewKey,
    isInitialLoad,
    isRevalidating,
    refreshAll,
    statusGroups,
    pinnedGroups,
    collapsedProjectKeys,
    toggleProjectCollapsed,
    groupMode,
    shortcutModel,
  } = useSidebarModel();
  const { shortcutIndexByWorkspaceKey } = shortcutModel;

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenAddProject();

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    void openProjectPicker();
  }, [showMobileAgent, openProjectPicker]);

  const handleOpenProjectDesktop = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute());
  }, [showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute());
  }, []);

  const handleAddHostMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [showMobileAgent]);

  const handleAddHostDesktop = useCallback(() => {
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);

  const handleOpenHostSettingsMobile = useCallback(
    (serverId: string) => {
      showMobileAgent();
      router.push(buildSettingsHostSectionRoute(serverId, "connections"));
    },
    [showMobileAgent],
  );

  const handleOpenHostSettingsDesktop = useCallback((serverId: string) => {
    router.push(buildSettingsHostSectionRoute(serverId, "connections"));
  }, []);

  const handleHomeMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildOpenProjectRoute());
  }, [showMobileAgent]);

  const handleHomeDesktop = useCallback(() => {
    router.push(buildOpenProjectRoute());
  }, []);

  const handleViewMoreNavigate = useCallback(() => {
    router.push(buildSessionsRoute());
  }, []);

  const handleViewSchedulesNavigate = useCallback(() => {
    router.push(buildSchedulesRoute());
  }, []);

  const newWorkspaceKeys = useShortcutKeys("new-workspace");
  const [filterText, setFilterText] = useState("");
  const filterTextContextValue = useMemo(() => ({ filterText, setFilterText }), [filterText]);
  const labels = useMemo(
    (): SidebarLabels => ({
      addProject: t("sidebar.actions.addProject"),
      newWorkspace: t("sidebar.actions.newWorkspace"),
      hosts: t("sidebar.actions.hosts"),
      home: t("sidebar.actions.home"),
      settings: t("sidebar.actions.settings"),
      searchHosts: t("sidebar.host.searchPlaceholder"),
      sessions: t("sidebar.sections.sessions"),
      schedules: t("sidebar.sections.schedules"),
      closeSidebar: t("sidebar.actions.closeSidebar"),
      more: t("sidebar.actions.more"),
      displayPreferences: t("sidebar.actions.displayPreferences"),
      importRecentSessions: t("sidebar.actions.importRecentSessions"),
      help: t("sidebar.help.trigger"),
    }),
    [t],
  );

  const sharedProps = {
    theme,
    statusGroups,
    pinnedGroups,
    projects,
    workspaceEntriesByKey,
    projectNamesByViewKey,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    groupMode,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    labels,
    newWorkspaceKeys,
  };

  if (isCompactLayout) {
    return (
      <SidebarFilterTextProvider value={filterTextContextValue}>
        <RetainedPanelActivity active={active}>
          <MobileSidebar
            {...sharedProps}
            insetsTop={insets.top}
            insetsBottom={insets.bottom}
            closeSidebar={showMobileAgent}
            handleOpenProject={handleOpenProjectMobile}
            handleHome={handleHomeMobile}
            handleSettings={handleSettingsMobile}
            handleAddHost={handleAddHostMobile}
            handleOpenHostSettings={handleOpenHostSettingsMobile}
            handleViewMoreNavigate={handleViewMoreNavigate}
            handleViewSchedulesNavigate={handleViewSchedulesNavigate}
          />
        </RetainedPanelActivity>
      </SidebarFilterTextProvider>
    );
  }

  return (
    <RetainedPanelActivity active={active}>
      <DesktopSidebar
        {...sharedProps}
        insetsTop={insets.top}
        active={active}
        handleOpenProject={handleOpenProjectDesktop}
        handleHome={handleHomeDesktop}
        handleSettings={handleSettingsDesktop}
        handleAddHost={handleAddHostDesktop}
        handleOpenHostSettings={handleOpenHostSettingsDesktop}
        handleViewMore={handleViewMoreNavigate}
        handleViewSchedules={handleViewSchedulesNavigate}
      />
    </RetainedPanelActivity>
  );
});

function sidebarHostOptionTestID(serverId: string): string {
  return `sidebar-host-row-${serverId}`;
}

function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  label,
  icon: Icon,
  iconSize,
  shortcutKeys,
  theme,
  hidden = false,
}: {
  onPress: () => void;
  testID: string;
  label: string;
  icon: typeof FolderPlus;
  iconSize?: number;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
  theme: SidebarTheme;
  buttonRef?: RefObject<View | null>;
  hidden?: boolean;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          ref={buttonRef}
          style={[styles.footerIconButton, hidden && styles.footerIconButtonHidden]}
          testID={testID}
          nativeID={testID}
          collapsable={false}
          accessible
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={onPress}
        >
          {({ hovered }) => (
            <Icon
              size={iconSize ?? theme.iconSize.md}
              color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
            />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <IconTooltipContent label={label} shortcutKeys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function footerAddProjectButtonStyle({
  hovered,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.footerAddProjectButton, Boolean(hovered) && styles.footerAddProjectButtonHovered];
}

function FooterAddProjectButton({
  onPress,
  label,
  shortcutKeys,
  theme,
}: {
  onPress: () => void;
  label: string;
  shortcutKeys: ReturnType<typeof useShortcutKeys>;
  theme: SidebarTheme;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          style={footerAddProjectButtonStyle}
          testID="sidebar-add-project"
          nativeID="sidebar-add-project"
          accessible
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={onPress}
        >
          {({ hovered }) => {
            const isHovered = Boolean(hovered);
            return (
              <>
                <FolderPlus
                  size={theme.iconSize.sm}
                  color={isHovered ? theme.colors.foreground : theme.colors.foregroundMuted}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.footerAddProjectLabel,
                    isHovered && styles.footerAddProjectLabelHovered,
                  ]}
                >
                  {label}
                </Text>
              </>
            );
          }}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <IconTooltipContent label={label} shortcutKeys={shortcutKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarHostPicker({
  theme,
  label,
  onAddHost,
  onOpenHostSettings,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  theme: SidebarTheme;
  label: string;
  onAddHost: () => void;
  onOpenHostSettings: (serverId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const hosts = useHosts();
  const triggerRef = useRef<View | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  const handleSelect = useCallback(
    (id: string) => {
      onOpenHostSettings(id);
    },
    [onOpenHostSettings],
  );

  const handleOpen = useCallback(() => {
    handleOpenChange(true);
  }, [handleOpenChange]);

  return (
    <HostPicker
      hosts={hosts}
      value=""
      onSelect={handleSelect}
      open={isOpen}
      onOpenChange={handleOpenChange}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      showActiveConnection
      onOpenHostSettings={onOpenHostSettings}
      searchable
      desktopPlacement="top-start"
      desktopMinWidth={240}
      addHostTestID="sidebar-host-add"
      hostOptionTestID={sidebarHostOptionTestID}
    >
      <FooterIconButton
        buttonRef={triggerRef}
        onPress={handleOpen}
        testID="sidebar-hosts-trigger"
        label={label}
        icon={Server}
        iconSize={theme.iconSize.sm}
        theme={theme}
        hidden={hideTrigger}
      />
    </HostPicker>
  );
}

function IconTooltipContent({
  label,
  shortcutKeys,
}: {
  label: string;
  shortcutKeys?: ReturnType<typeof useShortcutKeys>;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
    </View>
  );
}

const SidebarNewWorkspaceHeaderRow = memo(function SidebarNewWorkspaceHeaderRow({
  label,
  testID,
  variant,
  shortcutKeys,
  onBeforeNavigate,
}: {
  label: string;
  testID: string;
  variant: "header" | "compact" | "mobilePrimary";
  shortcutKeys: ShortcutKey[][] | null;
  onBeforeNavigate?: () => void;
}) {
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const activeWorkspaceServerId = activeWorkspaceSelection?.serverId ?? null;
  const activeWorkspaceId = activeWorkspaceSelection?.workspaceId ?? null;
  const activeWorkspace = useWorkspace(activeWorkspaceServerId, activeWorkspaceId);
  const supportsWorkspaceMultiplicity = useHostFeature(
    activeWorkspaceServerId,
    "workspaceMultiplicity",
  );
  const canUseActiveWorkspaceContext = Boolean(
    activeWorkspace &&
    (supportsWorkspaceMultiplicity || canCreateWorktreeForProjectKind(activeWorkspace.projectKind)),
  );

  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(
      activeWorkspaceServerId
        ? buildNewWorkspaceRoute(
            activeWorkspace && canUseActiveWorkspaceContext
              ? {
                  serverId: activeWorkspaceServerId,
                  sourceDirectory: activeWorkspace.projectRootPath,
                  projectId: activeWorkspace.projectId,
                }
              : { serverId: activeWorkspaceServerId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [activeWorkspace, activeWorkspaceServerId, canUseActiveWorkspaceContext, onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Plus}
      label={label}
      onPress={handlePress}
      testID={testID}
      variant={variant}
      shortcutKeys={shortcutKeys}
    />
  );
});

function SidebarFooter({
  theme,
  handleOpenProject,
  handleHome,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
}: {
  theme: SidebarTheme;
  handleOpenProject: () => void;
  handleHome: () => void;
  handleSettings: () => void;
  labels: {
    addProject: string;
    hosts: string;
    home: string;
    settings: string;
    searchHosts: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
}) {
  const newAgentKeys = useShortcutKeys("new-agent");
  const settingsKeys = useShortcutKeys("toggle-settings");

  return (
    <View style={styles.sidebarFooter}>
      <FooterAddProjectButton
        onPress={handleOpenProject}
        label={labels.addProject}
        shortcutKeys={newAgentKeys}
        theme={theme}
      />
      <View style={styles.footerIconRow}>
        <SidebarHostPicker
          theme={theme}
          label={labels.hosts}
          onAddHost={handleAddHost}
          onOpenHostSettings={handleOpenHostSettings}
        />
        <FooterIconButton
          onPress={handleHome}
          testID="sidebar-home"
          label={labels.home}
          icon={Home}
          theme={theme}
        />
        <SidebarHelpMenu />
        <FooterIconButton
          onPress={handleSettings}
          testID="sidebar-settings"
          label={labels.settings}
          icon={Settings}
          shortcutKeys={settingsKeys}
          theme={theme}
        />
      </View>
    </View>
  );
}

function MobileSidebar({
  theme,
  statusGroups,
  pinnedGroups,
  projects,
  workspaceEntriesByKey,
  projectNamesByViewKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  newWorkspaceKeys,
  handleOpenProject,
  handleHome,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  insetsBottom,
  closeSidebar,
  handleViewMoreNavigate,
  handleViewSchedulesNavigate,
}: MobileSidebarProps) {
  const pathname = usePathname();
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const isSessionsActive = pathname.includes("/sessions");
  const isSchedulesActive = pathname.includes("/schedules");
  const { gesture: closeGesture, gestureRef: closeGestureRef } = useCloseAgentListGesture();
  const dragGestureHostPresented = useIsMobilePanelPresented("agent-list");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isHostsOpen, setIsHostsOpen] = useState(false);
  const [isDisplayPreferencesOpen, setIsDisplayPreferencesOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [importRecentRequest, setImportRecentRequest] = useState(0);
  const [pendingMoreAction, setPendingMoreAction] = useState<MobileMoreAction | null>(null);
  const pendingMoreActionRef = useRef<MobileMoreAction | null>(null);

  const closeMore = useCallback(() => setIsMoreOpen(false), []);
  const openMore = useCallback(() => setIsMoreOpen(true), []);
  const consumeMoreAction = useCallback(() => {
    const action = pendingMoreActionRef.current;
    if (action === null) return;
    pendingMoreActionRef.current = null;
    setPendingMoreAction(null);
    switch (action) {
      case "hosts":
        setIsHostsOpen(true);
        break;
      case "import":
        setImportRecentRequest((value) => value + 1);
        break;
      case "displayPreferences":
        setIsDisplayPreferencesOpen(true);
        break;
      case "help":
        setIsHelpOpen(true);
        break;
      case "settings":
        handleSettings();
        break;
    }
  }, [handleSettings]);
  const requestMoreAction = useCallback((action: MobileMoreAction) => {
    pendingMoreActionRef.current = action;
    setPendingMoreAction(action);
    setIsMoreOpen(false);
  }, []);

  // Some compact web bottom-sheet implementations do not forward the native
  // onDismiss callback. Keep the action pending until the sheet is closed and
  // use a short fallback so the next picker never opens on top of it.
  useEffect(() => {
    if (isMoreOpen || pendingMoreAction === null) return undefined;
    const timeout = setTimeout(consumeMoreAction, 750);
    return () => clearTimeout(timeout);
  }, [consumeMoreAction, isMoreOpen, pendingMoreAction]);

  const moreHeader = useMemo(() => ({ title: labels.more }), [labels.more]);
  const handleMoreHosts = useCallback(() => requestMoreAction("hosts"), [requestMoreAction]);
  const handleMoreImport = useCallback(() => requestMoreAction("import"), [requestMoreAction]);
  const handleMoreDisplayPreferences = useCallback(
    () => requestMoreAction("displayPreferences"),
    [requestMoreAction],
  );
  const handleMoreHelp = useCallback(() => requestMoreAction("help"), [requestMoreAction]);
  const handleMoreSettings = useCallback(() => requestMoreAction("settings"), [requestMoreAction]);

  const handleViewMore = useCallback(() => {
    closeSidebar();
    handleViewMoreNavigate();
  }, [closeSidebar, handleViewMoreNavigate]);

  const handleViewSchedules = useCallback(() => {
    closeSidebar();
    handleViewSchedulesNavigate();
  }, [closeSidebar, handleViewSchedulesNavigate]);

  const handleWorkspacePress = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebar],
  );

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <WindowChromeSafeArea placement="below" />
        <View style={styles.sidebarHeaderGroup}>
          <SidebarNewWorkspaceHeaderRow
            label={labels.newWorkspace}
            testID="sidebar-global-new-workspace"
            variant="mobilePrimary"
            shortcutKeys={newWorkspaceKeys}
            onBeforeNavigate={closeSidebar}
          />
          <SidebarHeaderRow
            icon={History}
            label={labels.sessions}
            onPress={handleViewMore}
            isActive={isSessionsActive}
            testID="sidebar-sessions"
            variant="mobileSecondary"
          />
          <SidebarHeaderRow
            icon={CalendarClock}
            label={labels.schedules}
            onPress={handleViewSchedules}
            isActive={isSchedulesActive}
            testID="sidebar-schedules"
            variant="mobileSecondary"
          />
        </View>
        <WindowChromeSafeArea placement="inline" style={styles.mobileCloseButtonRow}>
          <Pressable
            style={styles.mobileCloseButton}
            onPress={closeSidebar}
            testID="sidebar-close"
            nativeID="sidebar-close"
            accessible
            accessibilityRole="button"
            accessibilityLabel={labels.closeSidebar}
            hitSlop={8}
          >
            {({ hovered, pressed }) => (
              <X
                size={theme.iconSize.md}
                color={hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted}
              />
            )}
          </Pressable>
        </WindowChromeSafeArea>

        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            statusGroups={statusGroups}
            pinnedGroups={pinnedGroups}
            projects={projects}
            workspaceEntriesByKey={workspaceEntriesByKey}
            projectNamesByViewKey={projectNamesByViewKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onWorkspacePress={handleWorkspacePress}
            onAddProject={handleOpenProject}
            parentGestureRef={closeGestureRef}
            dragGestureHostPresented={dragGestureHostPresented}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        <MobileSidebarFooter
          labels={labels}
          onAddProject={handleOpenProject}
          onHome={handleHome}
          onMore={openMore}
        />
      </View>
      <AdaptiveModalSheet
        visible={isMoreOpen}
        header={moreHeader}
        onClose={closeMore}
        onDismiss={consumeMoreAction}
        snapPoints={["55%", "80%"]}
        testID="sidebar-more-sheet"
        contentStyle={styles.mobileMoreSheetContent}
      >
        <MobileMoreActionRow
          icon={Server}
          label={labels.hosts}
          testID="sidebar-more-hosts"
          onPress={handleMoreHosts}
        />
        <MobileMoreActionRow
          icon={Clock}
          label={labels.importRecentSessions}
          testID="sidebar-more-import-recent"
          onPress={handleMoreImport}
        />
        <MobileMoreActionRow
          icon={SlidersHorizontal}
          label={labels.displayPreferences}
          testID="sidebar-more-display-preferences"
          onPress={handleMoreDisplayPreferences}
        />
        <MobileMoreActionRow
          icon={CircleHelp}
          label={labels.help}
          testID="sidebar-more-help"
          onPress={handleMoreHelp}
        />
        <MobileMoreActionRow
          icon={Settings}
          label={labels.settings}
          testID="sidebar-more-settings"
          onPress={handleMoreSettings}
        />
      </AdaptiveModalSheet>
      <View style={styles.mobileHiddenMenuEntrypoints} pointerEvents="none">
        <SidebarHostPicker
          theme={theme}
          label={labels.hosts}
          onAddHost={handleAddHost}
          onOpenHostSettings={handleOpenHostSettings}
          open={isHostsOpen}
          onOpenChange={setIsHostsOpen}
          hideTrigger
        />
        <SidebarImportRecentButton hideTrigger openRequest={importRecentRequest} />
        <SidebarDisplayPreferencesMenu
          open={isDisplayPreferencesOpen}
          onOpenChange={setIsDisplayPreferencesOpen}
          hideTrigger
          testID="sidebar-display-preferences-menu-hidden"
        />
        <SidebarHelpMenu open={isHelpOpen} onOpenChange={setIsHelpOpen} hideTrigger />
      </View>
    </MobilePanelOverlay>
  );
}

function MobileSidebarFooter({
  labels,
  onAddProject,
  onHome,
  onMore,
}: {
  labels: SidebarLabels;
  onAddProject: () => void;
  onHome: () => void;
  onMore: () => void;
}) {
  return (
    <View style={styles.mobileSidebarFooter}>
      <MobileFooterAction
        icon={FolderPlus}
        label={labels.addProject}
        onPress={onAddProject}
        testID="sidebar-mobile-add-project"
      />
      <MobileFooterAction
        icon={Home}
        label={labels.home}
        onPress={onHome}
        testID="sidebar-mobile-home"
      />
      <MobileFooterAction
        icon={MoreHorizontal}
        label={labels.more}
        onPress={onMore}
        testID="sidebar-mobile-more"
      />
    </View>
  );
}

function MobileFooterAction({
  icon: Icon,
  label,
  onPress,
  testID,
}: {
  icon: typeof FolderPlus;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      style={styles.mobileFooterAction}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Icon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      <Text style={styles.mobileFooterActionLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function MobileMoreActionRow({
  icon: Icon,
  label,
  onPress,
  testID,
}: {
  icon: typeof FolderPlus;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      style={mobileMoreActionRowStyle}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Icon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      <Text style={styles.mobileMoreActionLabel}>{label}</Text>
    </Pressable>
  );
}

function mobileMoreActionRowStyle({ pressed }: PressableStateCallbackType) {
  return [styles.mobileMoreActionRow, pressed && styles.mobileMoreActionRowPressed];
}

function DesktopSidebar({
  theme,
  statusGroups,
  pinnedGroups,
  projects,
  workspaceEntriesByKey,
  projectNamesByViewKey,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  newWorkspaceKeys,
  handleOpenProject,
  handleHome,
  handleSettings,
  labels,
  handleAddHost,
  handleOpenHostSettings,
  insetsTop,
  active,
  handleViewMore,
  handleViewSchedules,
}: DesktopSidebarProps) {
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const pathname = usePathname();
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const isSessionsActive = pathname.includes("/sessions");
  const isSchedulesActive = pathname.includes("/schedules");
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: sidebarWidth,
    viewportWidth,
  });

  const startWidthRef = useRef(visibleSidebarWidth);
  const resizeWidth = useSharedValue(visibleSidebarWidth);

  useEffect(() => {
    resizeWidth.value = visibleSidebarWidth;
  }, [resizeWidth, visibleSidebarWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = visibleSidebarWidth;
          resizeWidth.value = visibleSidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          resizeWidth.value = resolveDesktopSidebarWidth({
            requestedWidth: newWidth,
            viewportWidth,
          });
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        }),
    [resizeWidth, setSidebarWidth, viewportWidth, visibleSidebarWidth],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const desktopSidebarStyle = useMemo(
    () => [
      staticStyles.desktopSidebar,
      !active && staticStyles.desktopSidebarHidden,
      resizeAnimatedStyle,
    ],
    [active, resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [styles.desktopSidebarBorder, { flex: 1, paddingTop: insetsTop }],
    [insetsTop],
  );
  const sidebarHeaderGroupStyle = useMemo(
    () => [styles.sidebarHeaderGroup, ownsTopLeft && styles.sidebarHeaderGroupBelowChrome],
    [ownsTopLeft],
  );
  return (
    <Animated.View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={desktopSidebarStyle}
    >
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.sidebarDragArea}>
          {ownsTopLeft ? (
            <View style={styles.desktopChromeRow}>
              <TitlebarDragRegion />
            </View>
          ) : (
            <TitlebarDragRegion />
          )}
          <View style={sidebarHeaderGroupStyle}>
            <SidebarNewWorkspaceHeaderRow
              label={labels.newWorkspace}
              testID="sidebar-global-new-workspace"
              variant="compact"
              shortcutKeys={newWorkspaceKeys}
            />
            <SidebarHeaderRow
              icon={History}
              label={labels.sessions}
              onPress={handleViewMore}
              isActive={isSessionsActive}
              testID="sidebar-sessions"
              variant="compact"
            />
            <SidebarHeaderRow
              icon={CalendarClock}
              label={labels.schedules}
              onPress={handleViewSchedules}
              isActive={isSchedulesActive}
              testID="sidebar-schedules"
              variant="compact"
            />
          </View>
        </View>

        {isInitialLoad && !hasActiveHostFilter ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarWorkspaceList
            collapsedProjectKeys={collapsedProjectKeys}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
            groupMode={groupMode}
            statusGroups={statusGroups}
            pinnedGroups={pinnedGroups}
            projects={projects}
            workspaceEntriesByKey={workspaceEntriesByKey}
            projectNamesByViewKey={projectNamesByViewKey}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onAddProject={handleOpenProject}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        <SidebarCalloutSlot />

        <SidebarFooter
          theme={theme}
          handleOpenProject={handleOpenProject}
          handleHome={handleHome}
          handleSettings={handleSettings}
          labels={labels}
          handleAddHost={handleAddHost}
          handleOpenHostSettings={handleOpenHostSettings}
        />

        <SidebarResizeHandle
          edge="right"
          gesture={resizeGesture}
          testID="left-sidebar-resize-handle"
        />
      </View>
    </Animated.View>
  );
}

function SidebarWorkspacesFilterInput() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const filterContext = useSidebarFilterText();
  if (!filterContext) {
    return null;
  }
  return (
    <View style={styles.workspacesFilterField}>
      <Search size={12} color={theme.colors.foregroundMuted} />
      <TextInput
        value={filterContext.filterText}
        onChangeText={filterContext.setFilterText}
        placeholder={t("sidebar.filter.placeholder")}
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel={t("sidebar.filter.placeholder")}
        testID="sidebar-workspace-filter-input"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={styles.workspacesFilterInput}
      />
    </View>
  );
}

function WorkspacesSectionHeader() {
  const { theme } = useUnistyles();
  const isCompactLayout = useIsCompactFormFactor();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const commandCenterKeys = useShortcutKeys("toggle-command-center");
  const handleSearchPress = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const searchButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );

  return (
    <View style={styles.workspacesSectionHeader}>
      <Text style={styles.workspacesSectionTitle}>Workspaces</Text>
      <View style={styles.workspacesSectionActions}>
        {isCompactLayout ? (
          // On compact screens the magnifier grows into an inline filter; the
          // command center stays one shortcut away from the docked search icon.
          <>
            <SidebarWorkspacesFilterInput />
            <SidebarDisplayPreferencesMenu compact />
          </>
        ) : (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open command center"
                testID="sidebar-command-center-search"
                style={searchButtonStyle}
                onPress={handleSearchPress}
              >
                {({ hovered, pressed }) => (
                  <Search
                    size={14}
                    color={
                      hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                    }
                  />
                )}
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <IconTooltipContent label="Search" shortcutKeys={commandCenterKeys} />
            </TooltipContent>
          </Tooltip>
        )}
        {!isCompactLayout ? <SidebarImportRecentButton /> : null}
        {!isCompactLayout ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <View>
                <SidebarDisplayPreferencesMenu />
              </View>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center" offset={8}>
              <IconTooltipContent label="Display preferences" />
            </TooltipContent>
          </Tooltip>
        ) : null}
      </View>
    </View>
  );
}

// Stable element so the sidebar list's listHeaderComponent prop keeps identity across
// renders (WorkspacesSectionHeader takes no props).
const workspacesSectionHeaderElement = <WorkspacesSectionHeader />;

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  desktopSidebar: {
    position: "relative" as const,
  },
  desktopSidebarHidden: {
    display: "none",
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarHeaderGroup: {
    paddingTop: theme.spacing[2],
    gap: 2,
    paddingBottom: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sidebarHeaderGroupBelowChrome: {
    paddingTop: 0,
  },
  workspacesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // Rendered inside the scroll's listContent (paddingHorizontal spacing[2]), so the
    // title lands at spacing[2] left to align with project icons, and the trailing
    // pill sits flush with the list edge on the right.
    paddingLeft: theme.spacing[2],
    paddingRight: 0,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  workspacesSectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  workspacesSectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    justifyContent: "flex-end",
  },
  workspacesFilterField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    maxWidth: 260,
    height: {
      xs: 44,
      md: 28,
    },
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspacesFilterInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  workspacesHeaderIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  footerIconButtonHidden: {
    opacity: 0,
    position: "absolute",
    left: 0,
    top: 0,
  },
  workspacesHeaderIconButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  mobileSidebarFooter: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-around",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  mobileFooterAction: {
    minHeight: 48,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
  },
  mobileFooterActionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  mobileMoreSheetContent: {
    gap: theme.spacing[1],
  },
  mobileMoreActionRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },
  mobileMoreActionRowPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  mobileMoreActionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  mobileHiddenMenuEntrypoints: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileCloseButtonRow: {
    position: "absolute",
    top: theme.spacing[3],
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: "flex-end",
    pointerEvents: "box-none",
  },
  mobileCloseButton: {
    marginRight: theme.spacing[4],
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopSidebarBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  sidebarDragArea: {
    position: "relative",
  },
  desktopChromeRow: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
  },
  sidebarFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  footerAddProjectButton: {
    minWidth: 0,
    minHeight: 32,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  footerAddProjectButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  footerAddProjectLabel: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  footerAddProjectLabelHovered: {
    color: theme.colors.foreground,
  },
  footerIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
