import { router, usePathname } from "expo-router";
import {
  CalendarClock,
  FolderPlus,
  History,
  Home,
  Plus,
  Search,
  Server,
  Settings,
  X,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Keyboard,
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
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarHelpMenu } from "@/components/sidebar/sidebar-help-menu";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  SidebarImportRecentButton,
  MobileSidebarImportButton,
} from "./sidebar/sidebar-import-recent-button";
import { SidebarFilterTextProvider } from "./sidebar/sidebar-workspace-list-context";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface SidebarSharedProps {
  theme: SidebarTheme;
  statusGroups: StatusGroup[];
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
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
  filterWorkspaces: string;
  closeFilter: string;
  sessions: string;
  schedules: string;
  importSession: string;
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
  filterText: string;
  setFilterText: (text: string) => void;
}

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
      filterWorkspaces: t("sidebar.filter.placeholder"),
      closeFilter: t("sidebar.filter.close"),
      sessions: t("sidebar.sections.sessions"),
      schedules: t("sidebar.sections.schedules"),
      importSession: t("sidebar.actions.importRecentSessions"),
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
            filterText={filterText}
            setFilterText={setFilterText}
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
  variant = "desktop",
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
    filterWorkspaces: string;
  };
  handleAddHost: () => void;
  handleOpenHostSettings: (serverId: string) => void;
  variant?: "desktop" | "mobile";
}) {
  const newAgentKeys = useShortcutKeys("new-agent");
  const settingsKeys = useShortcutKeys("toggle-settings");

  // Mobile: the footer is only the two big CTA buttons (Import / New workspace).
  // The navigation icons (home/hosts/settings/help) move to the mobile top row.
  if (variant === "mobile") {
    return null;
  }

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
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  groupMode,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleHome,
  handleSettings,
  labels,
  insetsTop,
  insetsBottom,
  closeSidebar,
  filterText,
  setFilterText,
}: MobileSidebarProps) {
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const { gesture: closeGesture, gestureRef: closeGestureRef } = useCloseAgentListGesture();
  const dragGestureHostPresented = useIsMobilePanelPresented("agent-list");
  const [isFilterInputVisible, setIsFilterInputVisible] = useState(false);

  const handleCloseFilterInput = useCallback(() => {
    setFilterText("");
    setIsFilterInputVisible(false);
    Keyboard.dismiss();
  }, [setFilterText]);

  const handleToggleFilterInput = useCallback(() => {
    setIsFilterInputVisible((current) => {
      if (current) {
        setFilterText("");
        Keyboard.dismiss();
      }
      return !current;
    });
  }, [setFilterText]);

  // Opening the FAB menu while the filter is focused leaves the keyboard
  // covering both overlays. Close the search state first.
  const handleFabMenuOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        handleCloseFilterInput();
      }
    },
    [handleCloseFilterInput],
  );

  const handleWorkspacePress = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const handleSettingsPress = useCallback(() => {
    closeSidebar();
    handleSettings();
  }, [closeSidebar, handleSettings]);

  const handleHomePress = useCallback(() => {
    closeSidebar();
    handleHome();
  }, [closeSidebar, handleHome]);

  const handleAddProjectPress = useCallback(() => {
    closeSidebar();
    handleOpenProject();
  }, [closeSidebar, handleOpenProject]);

  const handleNewWorkspace = useCallback(() => {
    closeSidebar();
    router.push(buildNewWorkspaceRoute());
  }, [closeSidebar]);

  const fabSizeStyle = useMemo(() => ({ width: 56, height: 56 }), []);
  const fabTriggerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.mobileCircleButton,
      fabSizeStyle,
      styles.mobileCircleButtonAccent,
      pressed && styles.mobileCircleButtonPressed,
    ],
    [fabSizeStyle],
  );
  const fabPlusSmallIcon = useMemo(
    () => <Plus size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const fabFolderPlusSmallIcon = useMemo(
    () => <FolderPlus size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const fabMainPlusIcon = useMemo(
    () => <Plus size={theme.iconSize.lg} color={theme.colors.accentForeground} />,
    [theme.colors.accentForeground, theme.iconSize.lg],
  );

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
      backgroundColor: theme.colors.surfaceSidebar,
    }),
    [insetsTop, insetsBottom, theme.colors.surfaceSidebar],
  );

  const showFilterInput = isFilterInputVisible || filterText.length > 0;

  return (
    <MobilePanelOverlay
      panel="agent-list"
      closeGesture={closeGesture}
      panelStyle={mobileSidebarInsetStyle}
    >
      <View style={styles.sidebarContent} pointerEvents="auto">
        <WindowChromeSafeArea placement="below" />

        {/* Single chrome row: session management left, the filter toggle right. */}
        <View style={styles.mobileTopNavRow}>
          <MobileNavIconButton
            icon={Settings}
            label={labels.settings}
            onPress={handleSettingsPress}
            size={40}
            testID="sidebar-mobile-settings"
          />
          <MobileNavIconButton
            icon={Home}
            label={labels.home}
            onPress={handleHomePress}
            size={40}
            testID="sidebar-mobile-home"
          />
          <View style={styles.mobileTopNavSpacer} />
          <MobileNavIconButton
            icon={Search}
            label={labels.filterWorkspaces}
            onPress={handleToggleFilterInput}
            active={showFilterInput}
            size={40}
            testID="sidebar-mobile-filter-toggle"
          />
        </View>

        {showFilterInput ? (
          <View style={styles.mobileFilterRow}>
            <MobileFilterInput
              filterText={filterText}
              setFilterText={setFilterText}
              theme={theme}
            />
            <MobileNavIconButton
              icon={X}
              label={labels.closeFilter}
              onPress={handleCloseFilterInput}
              size={40}
              testID="sidebar-mobile-filter-close"
            />
          </View>
        ) : null}

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
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            onWorkspacePress={handleWorkspacePress}
            onAddProject={handleOpenProject}
            parentGestureRef={closeGestureRef}
            dragGestureHostPresented={dragGestureHostPresented}
            listHeaderComponent={workspacesSectionHeaderElement}
          />
        )}

        {/* Footer: circular thumb-reach actions — import on the left, new-workspace/add-project FAB menu on the right */}
        <View style={styles.mobileFooter}>
          <MobileSidebarImportButton onBeforeNavigate={closeSidebar} />
          <DropdownMenu onOpenChange={handleFabMenuOpenChange}>
            <DropdownMenuTrigger
              style={fabTriggerStyle}
              accessibilityRole="button"
              accessibilityLabel={labels.newWorkspace}
              testID="sidebar-footer-new-workspace"
            >
              {fabMainPlusIcon}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" width={220}>
              <DropdownMenuItem leading={fabPlusSmallIcon} onSelect={handleNewWorkspace}>
                {labels.newWorkspace}
              </DropdownMenuItem>
              <DropdownMenuItem leading={fabFolderPlusSmallIcon} onSelect={handleAddProjectPress}>
                {labels.addProject}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      </View>
    </MobilePanelOverlay>
  );
}

// Native-style circular action button. The single reusable shape for the mobile
// sidebar chrome: filled circle, bigger than the desktop text buttons, no label.
function MobileNavIconButton({
  icon: Icon,
  label,
  onPress,
  testID,
  active = false,
  disabled = false,
  accent = false,
  size = 40,
}: {
  icon: typeof Settings;
  label: string;
  onPress: () => void;
  testID: string;
  active?: boolean;
  disabled?: boolean;
  accent?: boolean;
  size?: number;
}) {
  const { theme } = useUnistyles();
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.mobileCircleButton,
      { width: size, height: size },
      accent && styles.mobileCircleButtonAccent,
      pressed && styles.mobileCircleButtonPressed,
      disabled && styles.mobileNavIconButtonDisabled,
    ],
    [accent, disabled, size],
  );
  const iconSize = size >= 48 ? theme.iconSize.lg : theme.iconSize.md;
  // On-state is a colored icon, not a filled circle: only the accent CTA (FAB)
  // may own a filled accent surface. See docs/design.md §6 "one accent CTA per surface".
  let iconColor = active ? theme.colors.accent : theme.colors.foregroundMuted;
  if (accent) {
    iconColor = theme.colors.accentForeground;
  }
  return (
    <Pressable
      style={style}
      onPress={onPress}
      testID={testID}
      disabled={disabled}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Icon size={iconSize} color={iconColor} />
    </Pressable>
  );
}

function MobileFilterInput({
  filterText,
  setFilterText,
  theme,
}: {
  filterText: string;
  setFilterText: (text: string) => void;
  theme: SidebarTheme;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.mobileFilterField}>
      <Search size={16} color={theme.colors.foregroundMuted} />
      <TextInput
        value={filterText}
        onChangeText={setFilterText}
        placeholder={t("sidebar.filter.placeholder")}
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel={t("sidebar.filter.placeholder")}
        testID="sidebar-workspace-filter-input"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={styles.mobileFilterInput}
        autoFocus
      />
    </View>
  );
}

function DesktopSidebar({
  theme,
  statusGroups,
  pinnedGroups,
  projects,
  workspaceEntriesByKey,
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

function WorkspacesSectionHeader() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isCompactLayout = useIsCompactFormFactor();
  const pathname = usePathname();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const isSessionsActive = pathname.includes("/sessions");
  const isSchedulesActive = pathname.includes("/schedules");
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const commandCenterKeys = useShortcutKeys("toggle-command-center");
  const handleSearchPress = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const handleSessionsPress = useCallback(() => {
    showMobileAgent();
    router.push(buildSessionsRoute());
  }, [showMobileAgent]);
  const handleSchedulesPress = useCallback(() => {
    showMobileAgent();
    router.push(buildSchedulesRoute());
  }, [showMobileAgent]);
  const searchButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );

  // On compact the drawers demote history/schedules/display-preferences into the
  // list header's trailing slot so the top chrome stays a single row (mirrors the
  // desktop actions below). The header reads stores and routes itself so the
  // stable listHeaderComponent element keeps identity.
  if (isCompactLayout) {
    return (
      <View style={styles.workspacesSectionHeader}>
        <Text style={styles.workspacesSectionTitle}>{t("sidebar.sections.workspaces")}</Text>
        <View style={styles.workspacesSectionActions}>
          <SectionHeaderNavButton
            icon={History}
            label={t("sidebar.sections.sessions")}
            onPress={handleSessionsPress}
            active={isSessionsActive}
            testID="sidebar-sessions"
          />
          <SectionHeaderNavButton
            icon={CalendarClock}
            label={t("sidebar.sections.schedules")}
            onPress={handleSchedulesPress}
            active={isSchedulesActive}
            testID="sidebar-schedules"
          />
          <SidebarDisplayPreferencesMenu />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.workspacesSectionHeader}>
      <Text style={styles.workspacesSectionTitle}>{t("sidebar.sections.workspaces")}</Text>
      <View style={styles.workspacesSectionActions}>
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
        <SidebarImportRecentButton />
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <SidebarDisplayPreferencesMenu />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={8}>
            <IconTooltipContent label={t("sidebar.actions.displayPreferences")} />
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

// Demoted-chrome nav button for the compact workspaces header: small, muted,
// accent icon when its destination is the active route.
function SectionHeaderNavButton({
  icon: Icon,
  label,
  onPress,
  active,
  testID,
}: {
  icon: typeof History;
  label: string;
  onPress: () => void;
  active: boolean;
  testID: string;
}) {
  const { theme } = useUnistyles();
  const buttonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.workspacesHeaderIconButton,
      (hovered || pressed) && styles.workspacesHeaderIconButtonHovered,
    ],
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={buttonStyle}
      testID={testID}
    >
      {({ hovered, pressed }) => {
        let color = theme.colors.foregroundMuted;
        if (active) {
          color = theme.colors.accent;
        } else if (hovered || pressed) {
          color = theme.colors.foreground;
        }
        return <Icon size={14} color={color} />;
      }}
    </Pressable>
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
    // Rendered inside the scroll's listContent (paddingHorizontal spacing[2]). The title
    // lands at spacing[2] left to align with project icons. Settings2's painted path stops
    // inside its 14px SVG, so 4px aligns the ink rather than the SVG box to the row rail.
    paddingLeft: theme.spacing[2],
    paddingRight: 4,
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
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileTopNavRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  // Sits on the same 16px rail as the top nav row and the workspaces section
  // header below it (docs/design.md §8 — off the rail reads as unconsidered).
  mobileFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  mobileFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  mobileCircleButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface4,
  },
  mobileCircleButtonAccent: {
    backgroundColor: theme.colors.accent,
  },
  mobileCircleButtonPressed: {
    opacity: 0.82,
  },
  mobileNavIconButtonDisabled: {
    opacity: 0.4,
  },
  mobileTopNavSpacer: {
    flex: 1,
  },
  mobileFilterField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    height: 40,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  mobileFilterInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
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
