import { beforeEach, describe, expect, it } from "vitest";
import { useKeyboardShortcutsStore } from "./keyboard-shortcuts-store";

beforeEach(() => {
  useKeyboardShortcutsStore.setState({
    commandCenterOpen: false,
    commandCenterScope: null,
    shortcutsDialogOpen: false,
    capturingShortcut: false,
    altDown: false,
    cmdOrCtrlDown: false,
    modelSelectorOwner: null,
    sidebarShortcutWorkspaceTargets: [],
  });
});

describe("keyboard-shortcuts-store", () => {
  it("toggles command center open state", () => {
    expect(useKeyboardShortcutsStore.getState().commandCenterOpen).toBe(false);
    useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
    expect(useKeyboardShortcutsStore.getState().commandCenterOpen).toBe(true);
  });

  it("opens the command center with a scope and clears it when closed", () => {
    useKeyboardShortcutsStore.getState().setCommandCenterOpen(true, "files");
    expect(useKeyboardShortcutsStore.getState()).toMatchObject({
      commandCenterOpen: true,
      commandCenterScope: "files",
    });

    useKeyboardShortcutsStore.getState().setCommandCenterOpen(false);
    expect(useKeyboardShortcutsStore.getState()).toMatchObject({
      commandCenterOpen: false,
      commandCenterScope: null,
    });
  });

  it("toggles shortcut capture state", () => {
    expect(useKeyboardShortcutsStore.getState().capturingShortcut).toBe(false);
    useKeyboardShortcutsStore.getState().setCapturingShortcut(true);
    expect(useKeyboardShortcutsStore.getState().capturingShortcut).toBe(true);
  });

  it("holds the model selector chord for the selector that claimed it", () => {
    useKeyboardShortcutsStore.getState().claimModelSelectorOwner("panel-a");
    expect(useKeyboardShortcutsStore.getState().modelSelectorOwner).toBe("panel-a");

    // A second selector closing must not knock the open one off the chord.
    useKeyboardShortcutsStore.getState().releaseModelSelectorOwner("panel-b");
    expect(useKeyboardShortcutsStore.getState().modelSelectorOwner).toBe("panel-a");

    useKeyboardShortcutsStore.getState().releaseModelSelectorOwner("panel-a");
    expect(useKeyboardShortcutsStore.getState().modelSelectorOwner).toBeNull();
  });
});
