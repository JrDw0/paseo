import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ModelBrowserView } from "@/components/model-browser-view";
import { normalizeModelSearchQuery } from "@/components/model-browser-view";
import {
  MODEL_ROW_SHORTCUT_LIMIT,
  hasSwitchableModel,
  resolveModelRowShortcutPick,
  resolveModelShortcutBlockedKey,
  resolveModelShortcutRows,
} from "@/components/model-row-shortcuts";
import { resolveModelListViewHeight } from "@/components/model-browser-view";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useToast } from "@/contexts/toast-api-context";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";

interface UseModelSelectorShortcutsInput {
  providers: ProviderSelectorProvider[];
  isLoading: boolean;
  disabled: boolean;
  /** Whether the selector panel is showing. */
  isOpen: boolean;
  /** False for a selector outside the focused composer, and for every surface with no keyboard. */
  isActiveComposer: boolean;
  view: ModelBrowserView;
  searchQuery: string;
  isSearchFocused: boolean;
  /** Digits list every model instead of the provider drill-down. */
  searchAllOnFocus: boolean;
  /** Panel height the selector ships to its popover, before the shortcut grows it. */
  desktopFixedHeight?: number;
  /** Open the panel as if the shortcut had fired it. */
  open: () => void;
  close: () => void;
  onSelectModel: (provider: string, modelId: string) => void;
}

export interface ModelSelectorShortcuts {
  /** Popover height to use: tall enough that every digit-addressable row is on screen. */
  desktopFixedHeight?: number;
}

/**
 * `Cmd/Ctrl+Shift+M` opens the model selector and a digit picks one of the rows it
 * lists. Both keys belong to the panel while it is open: digits are the chord the
 * workspace and tab jumps also claim, so the panel takes the chord off them by
 * holding `modelSelectorOwner` in the shortcuts store (see `keyboard/focus-scope.ts`
 * for the scope that falls out of that, and `keyboard/keyboard-shortcuts.ts` for
 * why the bindings sit above the jump bindings).
 *
 * A selector outside the focused composer — the settings form, a schedule form —
 * never claims anything, so its own digits keep doing what they did before.
 */
export function useModelSelectorShortcuts(
  input: UseModelSelectorShortcutsInput,
): ModelSelectorShortcuts {
  const {
    providers,
    isLoading,
    disabled,
    isOpen,
    isActiveComposer,
    view,
    searchQuery,
    isSearchFocused,
    searchAllOnFocus,
    desktopFixedHeight,
    open,
    close,
    onSelectModel,
  } = input;

  const { t } = useTranslation();
  const toast = useToast();
  const claimModelSelectorOwner = useKeyboardShortcutsStore(
    (state) => state.claimModelSelectorOwner,
  );
  const releaseModelSelectorOwner = useKeyboardShortcutsStore(
    (state) => state.releaseModelSelectorOwner,
  );
  const handlerId = useRef(
    `model-selector-shortcuts:${Math.random().toString(36).slice(2)}`,
  ).current;

  const normalizedQuery = useMemo(() => normalizeModelSearchQuery(searchQuery), [searchQuery]);
  const shortcutRows = useMemo(
    () =>
      resolveModelShortcutRows({
        view,
        providers,
        normalizedQuery,
        isSearchFocused,
        searchAllOnFocus,
      }),
    [isSearchFocused, normalizedQuery, providers, searchAllOnFocus, view],
  );

  useEffect(() => {
    if (!isOpen || !isActiveComposer) {
      return undefined;
    }
    claimModelSelectorOwner(handlerId);
    return () => releaseModelSelectorOwner(handlerId);
  }, [claimModelSelectorOwner, handlerId, isActiveComposer, isOpen, releaseModelSelectorOwner]);

  const handle = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (action.id === "agent.model.open") {
        if (disabled) {
          toast.show(t("modelSelector.shortcutDisabled"));
          return true;
        }
        if (isOpen) {
          close();
          return true;
        }
        if (!hasSwitchableModel(providers)) {
          toast.show(t(resolveModelShortcutBlockedKey({ isLoading, providers })));
          return true;
        }
        open();
        return true;
      }
      if (action.id === "agent.model.pick-index") {
        if (!isOpen) {
          return false;
        }
        const pick = resolveModelRowShortcutPick(shortcutRows, action.index);
        if (!pick) {
          return false;
        }
        onSelectModel(pick.provider, pick.modelId);
        return true;
      }
      return false;
    },
    [close, disabled, isLoading, isOpen, onSelectModel, open, providers, shortcutRows, t, toast],
  );

  useKeyboardActionHandler({
    handlerId,
    actions: ["agent.model.open", "agent.model.pick-index"],
    enabled: isActiveComposer,
    priority: 200,
    handle,
  });

  return {
    desktopFixedHeight: searchAllOnFocus
      ? resolveModelListViewHeight(shortcutRows.length, MODEL_ROW_SHORTCUT_LIMIT)
      : desktopFixedHeight,
  };
}
