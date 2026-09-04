import { create } from "zustand";
import type { SidebarShortcutWorkspaceTarget } from "@/utils/sidebar-shortcuts";

const SHORTCUT_BADGE_DELAY_MS = 150;

export type CommandCenterScope = "files" | null;

interface KeyboardShortcutsState {
  commandCenterOpen: boolean;
  commandCenterScope: CommandCenterScope;
  shortcutsDialogOpen: boolean;
  capturingShortcut: boolean;
  altDown: boolean;
  cmdOrCtrlDown: boolean;
  showShortcutBadges: boolean;
  /**
   * Handler id of the composer model selector that owns digit keys right now, or
   * null. Its panel answers the same chord the workspace/tab jump shortcuts use,
   * so the shortcut engine has to know the panel holds focus. Only a selector
   * inside a live composer claims it — the selector on the settings and schedule
   * forms never does. Ownership, not a boolean, so a second selector mounting
   * while one is open cannot knock it off.
   */
  modelSelectorOwner: string | null;
  /** Sidebar-visible workspace targets (up to 9), in top-to-bottom visual order. */
  sidebarShortcutWorkspaceTargets: SidebarShortcutWorkspaceTarget[];

  setCommandCenterOpen: (open: boolean, scope?: CommandCenterScope) => void;
  setCommandCenterScope: (scope: CommandCenterScope) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  setCapturingShortcut: (capturing: boolean) => void;
  setAltDown: (down: boolean) => void;
  setCmdOrCtrlDown: (down: boolean) => void;
  claimModelSelectorOwner: (owner: string) => void;
  releaseModelSelectorOwner: (owner: string) => void;
  setSidebarShortcutWorkspaceTargets: (targets: SidebarShortcutWorkspaceTarget[]) => void;
  resetModifiers: () => void;
}

let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function updateBadgeTimer(
  set: (partial: Partial<KeyboardShortcutsState>) => void,
  get: () => KeyboardShortcutsState,
) {
  const { altDown, cmdOrCtrlDown } = get();
  const modifierDown = altDown || cmdOrCtrlDown;

  if (badgeTimer) {
    clearTimeout(badgeTimer);
    badgeTimer = null;
  }

  if (modifierDown) {
    badgeTimer = setTimeout(() => {
      set({ showShortcutBadges: true });
    }, SHORTCUT_BADGE_DELAY_MS);
  } else {
    set({ showShortcutBadges: false });
  }
}

export const useKeyboardShortcutsStore = create<KeyboardShortcutsState>((set, get) => ({
  commandCenterOpen: false,
  commandCenterScope: null,
  shortcutsDialogOpen: false,
  capturingShortcut: false,
  altDown: false,
  cmdOrCtrlDown: false,
  showShortcutBadges: false,
  modelSelectorOwner: null,
  sidebarShortcutWorkspaceTargets: [],

  setCommandCenterOpen: (open, scope = null) =>
    set({ commandCenterOpen: open, commandCenterScope: open ? scope : null }),
  setCommandCenterScope: (scope) => set({ commandCenterScope: scope }),
  setShortcutsDialogOpen: (open) => set({ shortcutsDialogOpen: open }),
  setCapturingShortcut: (capturing) => set({ capturingShortcut: capturing }),
  setAltDown: (down) => {
    set({ altDown: down });
    updateBadgeTimer(set, get);
  },
  setCmdOrCtrlDown: (down) => {
    set({ cmdOrCtrlDown: down });
    updateBadgeTimer(set, get);
  },
  setSidebarShortcutWorkspaceTargets: (targets) =>
    set({ sidebarShortcutWorkspaceTargets: targets }),
  claimModelSelectorOwner: (owner) => set({ modelSelectorOwner: owner }),
  releaseModelSelectorOwner: (owner) => {
    if (get().modelSelectorOwner !== owner) return;
    set({ modelSelectorOwner: null });
  },
  resetModifiers: () => {
    set({ altDown: false, cmdOrCtrlDown: false });
    updateBadgeTimer(set, get);
  },
}));
