import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRouter, type Href } from "expo-router";
import { Clock } from "lucide-react-native";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useHostChooser } from "@/hosts/host-chooser";
import { useOpenProject } from "@/hooks/use-open-project";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { usePanelStore } from "@/stores/panel-store";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import type { Theme } from "@/styles/theme";

const ThemedClock = withUnistyles(Clock);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * Quick action in the workspaces list header that opens the cross-host "import
 * recent session" picker — the same unscoped ImportSessionSheet the home tile
 * uses, so users don't have to navigate back to the home screen. Unlike the
 * workspace header's import entry, no cwd/workspaceId is locked in, so every
 * recent session across all projects is offered.
 */
export function SidebarImportRecentButton() {
  const { t } = useTranslation();
  const router = useRouter();
  const chooseHost = useHostChooser();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const [importServerId, setImportServerId] = useState<string | null>(null);
  const importClient = useHostRuntimeClient(importServerId ?? "");
  const openImportedProject = useOpenProject(importServerId);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);

  const handlePress = useCallback(() => {
    chooseHost({
      title: "Import from host",
      onChooseHost: (serverId) => {
        setImportServerId(serverId);
        setIsImportSheetOpen(true);
      },
    });
  }, [chooseHost]);

  const handleCloseImportSession = useCallback(() => setIsImportSheetOpen(false), []);

  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      if (!importServerId) return;
      // Collapse the compact sidebar before navigating to the imported agent.
      showMobileAgent();
      void (async () => {
        const result = await openImportedProject(agent.cwd);
        if (result.ok) {
          router.push(buildHostAgentDetailRoute(importServerId, agent.id) as Href);
        }
      })();
    },
    [importServerId, openImportedProject, router, showMobileAgent],
  );

  const buttonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (hovered || pressed) && styles.buttonHovered,
    ],
    [],
  );

  return (
    <>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.actions.importRecentSessions")}
        hitSlop={8}
        style={buttonStyle}
        testID="sidebar-import-recent-sessions"
      >
        {({ hovered, pressed }) => (
          <ThemedClock
            size={14}
            uniProps={hovered || pressed ? foregroundColorMapping : mutedColorMapping}
          />
        )}
      </Pressable>
      <ImportSessionSheet
        visible={isImportSheetOpen}
        client={importClient}
        serverId={importServerId}
        onClose={handleCloseImportSession}
        onImported={handleImported}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
}));
