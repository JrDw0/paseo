/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React from "react";

const { theme } = vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  return {
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12 },
      colors: {
        foregroundMuted: "#777",
        foreground: "#fff",
      },
    },
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

// useIsCompactFormFactor hooks into useWindowDimensions + breakpoint math; stub
// the boolean so the test doesn't need the layout runtime.
vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

// Real highlightToKeyedLines pulls in @getpaseo/highlight + Lezer — heavy and
// unnecessary here since we only care about *when* it's invoked, not its
// output. Stub it with a one-line, one-token keyed line so the highlighted
// branch renders something deterministic.
const highlightToKeyedLinesMock = vi.hoisted(() =>
  vi.fn((code: string) => [
    {
      key: `line-${code.length}`,
      tokens: [{ key: "t0", token: { type: "plain", text: code, style: undefined } }],
    },
  ]),
);

vi.mock("@/utils/highlight-cache", () => ({
  highlightToKeyedLines: highlightToKeyedLinesMock,
}));

vi.mock("@/styles/syntax-token-styles", () => ({
  syntaxTokenStyleFor: () => ({}),
}));

vi.mock("@/styles/code-surface", () => ({
  CODE_SURFACE_DATASET: { "data-code-surface": "true" },
}));

// MarkdownTextSpan is an RN Text wrapper; in a jsdom test we only need a plain
// host element that strings flow through. Keep it shallow.
vi.mock("@/components/markdown-text", () => ({
  MarkdownTextSpan: (props: { children?: React.ReactNode; style?: unknown }) =>
    React.createElement("span", null, props.children),
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(async () => undefined),
}));

vi.mock("lucide-react-native", () => ({
  Check: (_props: Record<string, unknown>) => React.createElement("span", { "data-icon": "check" }),
  Copy: (_props: Record<string, unknown>) => React.createElement("span", { "data-icon": "copy" }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { HighlightedCodeBlock } from "./highlighted-code-block";

const SETTLE_MS = 250;

const EMPTY_INHERITED_STYLES = {} as const;
const TEXT_STYLE = { fontSize: 13 } as const;

function renderBlock(root: Root, code: string) {
  act(() => {
    root.render(
      <HighlightedCodeBlock
        code={code}
        language="ts"
        inheritedStyles={EMPTY_INHERITED_STYLES}
        textStyle={TEXT_STYLE}
      />,
    );
  });
}

describe("HighlightedCodeBlock streaming settle debounce", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    highlightToKeyedLinesMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("highlights a static block immediately on mount", () => {
    renderBlock(root, "const x = 1;");
    expect(highlightToKeyedLinesMock).toHaveBeenCalledTimes(1);
    expect(highlightToKeyedLinesMock).toHaveBeenCalledWith("const x = 1;", "ts");
  });

  it("defers highlight while code keeps growing and runs once on settle", () => {
    renderBlock(root, "const x = 1;");
    expect(highlightToKeyedLinesMock).toHaveBeenCalledTimes(1);

    renderBlock(root, "const x = 1;\nconst y = 2;");
    renderBlock(root, "const x = 1;\nconst y = 2;\nconst z = 3;");
    expect(highlightToKeyedLinesMock).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(highlightToKeyedLinesMock).toHaveBeenCalledTimes(2);
    expect(highlightToKeyedLinesMock).toHaveBeenLastCalledWith(
      "const x = 1;\nconst y = 2;\nconst z = 3;",
      "ts",
    );
  });

  it("resets the settle timer when code keeps streaming during the delay", () => {
    renderBlock(root, "a");
    expect(highlightToKeyedLinesMock).toHaveBeenCalledTimes(1);

    renderBlock(root, "ab");
    act(() => vi.advanceTimersByTime(SETTLE_MS - 50));
    expect(highlightToKeyedLinesMock).toHaveBeenCalledTimes(1);

    renderBlock(root, "abc");
    act(() => vi.advanceTimersByTime(SETTLE_MS - 50));
    expect(highlightToKeyedLinesMock).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(50));
    expect(highlightToKeyedLinesMock).toHaveBeenCalledTimes(2);
    expect(highlightToKeyedLinesMock).toHaveBeenLastCalledWith("abc", "ts");
  });

  it("renders the latest streamed text plainly while the highlight is pending", () => {
    renderBlock(root, "first");
    renderBlock(root, "first second");
    expect(container.textContent).toContain("first second");

    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(container.textContent).toContain("first second");
  });

  it("trims a single trailing newline from the fence end before settling", () => {
    renderBlock(root, "line1\n");
    expect(highlightToKeyedLinesMock).toHaveBeenCalledWith("line1", "ts");
  });
});
