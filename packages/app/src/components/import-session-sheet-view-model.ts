import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { i18n } from "@/i18n/i18next";

export const PER_PROVIDER_LIMIT = 15;
export const ALL_FILTER_VALUE = "__all__";

export function requiresImportSessionsHostUpgrade(input: {
  supportsSnapshot: boolean;
  workspaceId?: string | null;
  supportsWorkspaceTarget: boolean;
}): boolean {
  return !input.supportsSnapshot || (Boolean(input.workspaceId) && !input.supportsWorkspaceTarget);
}

export interface SessionsQueryResult {
  data:
    | {
        entries: FetchRecentProviderSessionEntry[];
        filteredAlreadyImportedCount?: number;
      }
    | undefined;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
}

export function resolveProvidersToFetch(
  supportsSnapshot: boolean,
  snapshotEntries: ReadonlyArray<{ provider: string; enabled?: boolean }> | undefined,
): AgentProvider[] | null {
  // COMPAT(providersSnapshot): the import-recent-sessions feature ships alongside
  // providersSnapshot (v0.1.48, 2026-04-05). Daemons older than that lack both —
  // we render an "update host" empty state instead of degrading. Drop this gate
  // when the supported daemon floor is >= v0.1.48 (target: 2026-10-05).
  if (!supportsSnapshot) return null;
  if (!snapshotEntries) return null;
  return snapshotEntries.filter((entry) => entry.enabled !== false).map((entry) => entry.provider);
}

export function buildProviderLabelMap(
  snapshotEntries: ReadonlyArray<{ provider: string; label?: string }> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!snapshotEntries) return map;
  for (const entry of snapshotEntries) {
    if (entry.label) {
      map.set(entry.provider, entry.label);
    }
  }
  return map;
}

export function aggregateSessionEntries(
  queries: ReadonlyArray<SessionsQueryResult>,
): FetchRecentProviderSessionEntry[] {
  const seen = new Set<string>();
  const collected: FetchRecentProviderSessionEntry[] = [];
  for (const query of queries) {
    if (!query.data) continue;
    for (const entry of query.data.entries) {
      const key = `${entry.providerId}:${entry.providerHandleId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(entry);
    }
  }
  collected.sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
  return collected;
}

export interface SessionFilters {
  query: string;
  providerId: string;
  projectCwd: string;
}

export function filterSessions(
  entries: ReadonlyArray<FetchRecentProviderSessionEntry>,
  filters: SessionFilters,
): FetchRecentProviderSessionEntry[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (filters.providerId !== ALL_FILTER_VALUE && entry.providerId !== filters.providerId) {
      return false;
    }
    if (filters.projectCwd !== ALL_FILTER_VALUE && entry.cwd !== filters.projectCwd) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    // Match raw fields only. getSessionTitle/getPromptPreview fall back to placeholder
    // copy ("Untitled session" / "No prompt preview"); matching the fallback would let a
    // query like "no" hit every contentless session.
    const haystacks = [entry.title, entry.firstPromptPreview, entry.lastPromptPreview, entry.cwd];
    return haystacks.some((field) => field?.toLocaleLowerCase().includes(normalizedQuery));
  });
}

export function collectProjectCwds(
  entries: ReadonlyArray<FetchRecentProviderSessionEntry>,
): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.cwd.trim()) {
      seen.add(entry.cwd);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function sumFilteredAlreadyImportedCount(
  queries: ReadonlyArray<SessionsQueryResult>,
): number {
  let total = 0;
  for (const query of queries) {
    total += query.data?.filteredAlreadyImportedCount ?? 0;
  }
  return total;
}

export function collectErroredProviderLabels(
  providersToFetch: AgentProvider[] | null,
  queries: ReadonlyArray<SessionsQueryResult>,
  providerLabelById: ReadonlyMap<string, string>,
): string[] {
  if (providersToFetch === null) return [];
  const labels: string[] = [];
  for (let index = 0; index < queries.length; index++) {
    if (queries[index]?.isError) {
      const provider = providersToFetch[index];
      labels.push(providerLabelById.get(provider) ?? provider);
    }
  }
  return labels;
}

export function getSessionTitle(entry: FetchRecentProviderSessionEntry): string {
  const title = entry.title?.trim();
  if (title) {
    return title;
  }
  const firstPromptPreview = entry.firstPromptPreview?.trim();
  if (firstPromptPreview) {
    return firstPromptPreview;
  }
  return i18n.t("importSession.preview.untitledSession");
}

export function getPromptPreview(entry: FetchRecentProviderSessionEntry): string {
  return (
    entry.lastPromptPreview?.trim() ||
    entry.firstPromptPreview?.trim() ||
    i18n.t("importSession.preview.noPrompt")
  );
}

export interface EmptyStateInputs {
  isLoadingSessions: boolean;
  allQueriesErrored: boolean;
  isQueryingProviders: boolean;
  allQueriesSettled: boolean;
  selectedProvider: string;
  aggregatedCount: number;
  visibleCount: number;
  totalAlreadyImportedCount: number;
  providerLabelById: ReadonlyMap<string, string>;
  hasActiveQuery: boolean;
  isProjectFilterActive: boolean;
}

export function computeEmptyState(input: EmptyStateInputs): {
  showEmptyState: boolean;
  emptyStateTitle: string;
} {
  const showEmptyState =
    !input.isLoadingSessions &&
    !input.allQueriesErrored &&
    input.isQueryingProviders &&
    input.allQueriesSettled &&
    input.visibleCount === 0;
  if (!showEmptyState) {
    return { showEmptyState, emptyStateTitle: "" };
  }
  const isProviderOnlyFilter =
    input.selectedProvider !== ALL_FILTER_VALUE &&
    input.aggregatedCount > 0 &&
    !input.hasActiveQuery &&
    !input.isProjectFilterActive;
  if (isProviderOnlyFilter) {
    const label = input.providerLabelById.get(input.selectedProvider) ?? input.selectedProvider;
    return {
      showEmptyState,
      emptyStateTitle: i18n.t("importSession.empty.noProviderSessions", { provider: label }),
    };
  }
  // Query or project filter active: don't claim everything is already imported when the
  // user narrowed the list themselves.
  if (input.hasActiveQuery || input.isProjectFilterActive) {
    return {
      showEmptyState,
      emptyStateTitle: i18n.t("importSession.empty.noMatchingResults"),
    };
  }
  if (input.totalAlreadyImportedCount > 0) {
    return {
      showEmptyState,
      emptyStateTitle: i18n.t("importSession.empty.alreadyImported"),
    };
  }
  return { showEmptyState, emptyStateTitle: i18n.t("importSession.empty.noRecent") };
}
