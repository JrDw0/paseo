/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageJumpSheet, type MessageJumpEntry } from "./message-jump-sheet";

const compactState = vi.hoisted(() => ({ value: false }));
const theme = vi.hoisted(() => ({
  colors: {
    foreground: "#111",
    foregroundMuted: "#666",
    surface2: "#eee",
    surfaceSidebarHover: "#ddd",
    borderAccent: "#ddd",
    palette: { zinc: { 600: "#555" } },
  },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 12: 48 },
  fontSize: { xs: 11, sm: 13, base: 15, lg: 18 },
  fontWeight: { semibold: "600" },
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

vi.mock("@/constants/layout", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/constants/layout");
  return {
    ...actual,
    useIsCompactFormFactor: () => compactState.value,
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({ uniProps: _uniProps, ...props }: { uniProps?: unknown } & Record<string, unknown>) =>
      React.createElement(Component, props),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    children,
    testID,
  }: {
    visible: boolean;
    children: ReactNode;
    testID?: string;
  }) => (visible ? <section data-testid={testID}>{children}</section> : null),
}));

vi.mock("@/components/ui/isolated-bottom-sheet-modal", () => ({
  IsolatedBottomSheetModal: ({ children }: { children: ReactNode }) => (
    <section data-testid="message-jump-mobile-sheet">{children}</section>
  ),
  useIsolatedBottomSheetVisibility: () => ({
    sheetRef: { current: null },
    handleSheetChange: vi.fn(),
    handleSheetDismiss: vi.fn(),
  }),
}));

vi.mock("@gorhom/bottom-sheet", async () => {
  const { FlatList } = await vi.importActual<typeof import("react-native")>("react-native");
  return {
    BottomSheetBackdrop: () => null,
    BottomSheetFlatList: FlatList,
  };
});

vi.mock("lucide-react-native", () => ({
  Image: () => null,
  X: () => null,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => <span data-testid="message-jump-loading" />,
}));

const ENTRY: MessageJumpEntry = {
  id: "message-1",
  epoch: "epoch-1",
  seq: 1,
  preview: "First prompt",
  timestampLabel: "2m ago",
  hasImages: false,
};

afterEach(() => {
  cleanup();
  compactState.value = false;
});

describe("MessageJumpSheet presentation", () => {
  it("uses a scrollable desktop dialog and selects rows with a pointer click", () => {
    const onSelect = vi.fn();
    render(<MessageJumpSheet visible entries={[ENTRY]} onSelect={onSelect} onClose={vi.fn()} />);

    expect(screen.getByTestId("message-jump-dialog")).not.toBeNull();
    expect(screen.getByTestId("message-jump-desktop-list")).not.toBeNull();
    expect(screen.queryByTestId("message-jump-mobile-sheet")).toBeNull();

    fireEvent.click(screen.getByTestId("message-jump-row-message-1"));
    expect(onSelect).toHaveBeenCalledWith(ENTRY);
  });

  it("keeps the compact bottom-sheet presentation", () => {
    compactState.value = true;
    render(<MessageJumpSheet visible entries={[ENTRY]} onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId("message-jump-mobile-sheet")).not.toBeNull();
    expect(screen.queryByTestId("message-jump-dialog")).toBeNull();
  });
});
