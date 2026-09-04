import { resolveModelBrowserAllView, type ModelBrowserView } from "@/components/model-browser-view";
import {
  filterAndRankModelRows,
  getProviderModelRows,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

/**
 * Digits 1-9 address the numbered rows of an open model sheet. Nine is the key
 * cap a `Digit` wildcard binding can produce, and the sheet grows its viewport
 * to this many rows when a shortcut opened it.
 */
export const MODEL_ROW_SHORTCUT_LIMIT = 9;

/**
 * The model rows a digit can address, in the order the sheet lists them.
 *
 * This mirrors the two row computations in `components/model-browser.tsx` —
 * `resolveModelBrowserAllView` for the all-provider view and
 * `filterAndRankModelRows(getProviderModelRows(...))` for a drilled-in provider —
 * so a digit and the badge on its row cannot disagree. Change one, change the other.
 * Profiles render as the list header, outside `rows`, so they are never numbered.
 */
export function resolveModelShortcutRows(input: {
  view: ModelBrowserView;
  providers: ProviderSelectorProvider[];
  normalizedQuery: string;
  isSearchFocused: boolean;
  searchAllOnFocus: boolean;
}): ProviderSelectionModelRow[] {
  const { view, providers, normalizedQuery, isSearchFocused, searchAllOnFocus } = input;

  if (view.kind === "provider") {
    const provider = providers.find((entry) => entry.id === view.providerId);
    return provider ? filterAndRankModelRows(getProviderModelRows(provider), normalizedQuery) : [];
  }

  const allView = resolveModelBrowserAllView({
    providers,
    normalizedQuery,
    isSearchFocused: searchAllOnFocus && isSearchFocused,
  });
  return allView.kind === "searchResults" ? allView.rows : [];
}

/** `favoriteKey` → digit, assigned in display order and capped at `limit`. */
export function buildModelRowShortcutIndex(
  rows: readonly ProviderSelectionModelRow[],
  limit: number = MODEL_ROW_SHORTCUT_LIMIT,
): Map<string, number> {
  const index = new Map<string, number>();
  rows.slice(0, limit).forEach((row, position) => {
    index.set(row.favoriteKey, position + 1);
  });
  return index;
}

/** The pick a digit stands for, or null when the digit labels no row. */
export function resolveModelRowShortcutPick(
  rows: readonly ProviderSelectionModelRow[],
  index: number,
): { provider: string; modelId: string } | null {
  if (!Number.isInteger(index) || index < 1 || index > MODEL_ROW_SHORTCUT_LIMIT) {
    return null;
  }
  const row = rows[index - 1];
  return row ? { provider: row.provider, modelId: row.modelId } : null;
}

/**
 * Why the shortcut cannot open the selector, as a translation key. The four states
 * ask different things of the user — wait, retry the provider, or nothing at all —
 * so they are not one message.
 */
export function resolveModelShortcutBlockedKey({
  isLoading,
  providers,
}: {
  isLoading: boolean;
  providers: readonly ProviderSelectorProvider[];
}): string {
  if (isLoading || providers.some((provider) => provider.modelSelection.kind === "loading")) {
    return "modelSelector.shortcutLoading";
  }
  if (providers.some((provider) => provider.modelSelection.kind === "error")) {
    return "modelSelector.shortcutProviderError";
  }
  return "modelSelector.shortcutUnavailable";
}

/** Whether the selector has a model the shortcut could put on screen. */
export function hasSwitchableModel(providers: readonly ProviderSelectorProvider[]): boolean {
  return providers.some(
    (provider) =>
      provider.modelSelection.kind === "models" && provider.modelSelection.rows.length > 0,
  );
}
