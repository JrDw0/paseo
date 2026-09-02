import { describe, expect, it } from "vitest";
import type {
  ProviderSelectionModelRow,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  MODEL_ROW_SHORTCUT_LIMIT,
  buildModelRowShortcutIndex,
  resolveModelRowShortcutPick,
  resolveModelShortcutRows,
} from "./model-row-shortcuts";

function modelRow(
  providerId: string,
  providerLabel: string,
  modelId: string,
): ProviderSelectionModelRow {
  return {
    favoriteKey: `${providerId}:${modelId}`,
    provider: providerId,
    providerLabel,
    modelId,
    modelLabel: `${providerLabel} ${modelId}`,
    description: modelId,
  };
}

function providerWithModels(
  id: string,
  label: string,
  modelIds: string[],
): ProviderSelectorProvider {
  return {
    id,
    label,
    modelSelection: {
      kind: "models",
      rows: modelIds.map((modelId) => modelRow(id, label, modelId)),
    },
  };
}

const ALPHABET = Array.from({ length: 12 }, (_, index) => `model-${index + 1}`);
const oneProvider = [providerWithModels("alpha", "Alpha", ALPHABET)];
const twoProviders = [
  providerWithModels("alpha", "Alpha", ["claude-sonnet", "claude-opus"]),
  providerWithModels("beta", "Beta", ["gpt-5"]),
];

const allView = { kind: "all" } as const;
const alphaView = { kind: "provider", providerId: "alpha", providerLabel: "Alpha" } as const;

function allRows(input?: {
  providers?: ProviderSelectorProvider[];
  normalizedQuery?: string;
  isSearchFocused?: boolean;
  searchAllOnFocus?: boolean;
}) {
  return resolveModelShortcutRows({
    view: allView,
    providers: input?.providers ?? oneProvider,
    normalizedQuery: input?.normalizedQuery ?? "",
    isSearchFocused: input?.isSearchFocused ?? true,
    searchAllOnFocus: input?.searchAllOnFocus ?? true,
  });
}

describe("model sheet shortcut rows", () => {
  it("lists every cross-provider row in provider order for an empty focused search", () => {
    expect(allRows({ providers: twoProviders }).map((row) => row.favoriteKey)).toEqual([
      "alpha:claude-sonnet",
      "alpha:claude-opus",
      "beta:gpt-5",
    ]);
  });

  it("numbers the first nine displayed rows in display order", () => {
    const rows = allRows();
    const index = buildModelRowShortcutIndex(rows);

    expect(rows).toHaveLength(12);
    expect(index.size).toBe(MODEL_ROW_SHORTCUT_LIMIT);
    rows.slice(0, MODEL_ROW_SHORTCUT_LIMIT).forEach((row, position) => {
      expect(index.get(row.favoriteKey)).toBe(position + 1);
    });
    expect(index.has("alpha:model-10")).toBe(false);
  });

  it("numbers every row when the list is shorter than the limit", () => {
    const rows = allRows({ providers: twoProviders });
    expect(buildModelRowShortcutIndex(rows)).toEqual(
      new Map([
        ["alpha:claude-sonnet", 1],
        ["alpha:claude-opus", 2],
        ["beta:gpt-5", 3],
      ]),
    );
  });

  it("renumbers after the search re-ranks the list", () => {
    const rows = allRows({ providers: twoProviders, normalizedQuery: "claude" });
    const index = buildModelRowShortcutIndex(rows);

    expect(rows.map((row) => row.favoriteKey).sort()).toEqual([
      "alpha:claude-opus",
      "alpha:claude-sonnet",
    ]);
    rows.forEach((row, position) => {
      expect(index.get(row.favoriteKey)).toBe(position + 1);
    });
  });

  it("numbers the drilled-in provider list from one", () => {
    const rows = resolveModelShortcutRows({
      view: alphaView,
      providers: twoProviders,
      normalizedQuery: "",
      isSearchFocused: true,
      searchAllOnFocus: true,
    });

    expect([...buildModelRowShortcutIndex(rows).values()]).toEqual([1, 2]);
  });

  it("numbers nothing while the all view shows the provider browse root", () => {
    const rows = allRows({ searchAllOnFocus: false, isSearchFocused: false });
    expect(rows).toEqual([]);
    expect(buildModelRowShortcutIndex(rows).size).toBe(0);
  });

  it("numbers nothing when the search matches no model", () => {
    expect(allRows({ normalizedQuery: "nothing-matches-this" })).toEqual([]);
  });

  it.each([
    { name: "loading", modelSelection: { kind: "loading" as const } },
    { name: "error", modelSelection: { kind: "error" as const, message: "unreachable" } },
  ])("ignores a $name provider in the drilled-in view", ({ modelSelection }) => {
    const providers = [{ id: "alpha", label: "Alpha", modelSelection }];
    expect(
      resolveModelShortcutRows({
        view: alphaView,
        providers,
        normalizedQuery: "",
        isSearchFocused: true,
        searchAllOnFocus: true,
      }),
    ).toEqual([]);
  });

  it("keeps the same model id on two providers addressable", () => {
    const providers = [
      providerWithModels("alpha", "Alpha", ["shared"]),
      providerWithModels("beta", "Beta", ["shared"]),
    ];
    const rows = allRows({ providers });

    expect([...buildModelRowShortcutIndex(rows).entries()]).toEqual([
      ["alpha:shared", 1],
      ["beta:shared", 2],
    ]);
  });

  it("resolves a digit to the row it labels", () => {
    const rows = allRows();

    expect(resolveModelRowShortcutPick(rows, 1)).toEqual({
      provider: "alpha",
      modelId: "model-1",
    });
    expect(resolveModelRowShortcutPick(rows, MODEL_ROW_SHORTCUT_LIMIT)).toEqual({
      provider: "alpha",
      modelId: "model-9",
    });
  });

  it("resolves nothing for a digit outside the numbered window", () => {
    const rows = allRows({ providers: twoProviders });

    expect(resolveModelRowShortcutPick(rows, 0)).toBeNull();
    expect(resolveModelRowShortcutPick(rows, 4)).toBeNull();
    expect(resolveModelRowShortcutPick(rows, MODEL_ROW_SHORTCUT_LIMIT + 1)).toBeNull();
  });
});
