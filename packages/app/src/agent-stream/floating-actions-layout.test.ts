import { describe, expect, it } from "vitest";
import {
  DESKTOP_FLOATING_ACTIONS_CLEARANCE,
  resolveFloatingActionsRight,
} from "./floating-actions-layout";

describe("resolveFloatingActionsRight", () => {
  it("uses a symmetric desktop rail clearance equal to the action plus its gap", () => {
    expect(DESKTOP_FLOATING_ACTIONS_CLEARANCE).toBe(56);
  });

  it("keeps compact actions at the viewport edge", () => {
    expect(resolveFloatingActionsRight({ containerWidth: 1200, isCompact: true })).toBe(16);
  });

  it("places desktop actions beside the centered content rail", () => {
    expect(resolveFloatingActionsRight({ containerWidth: 1600, isCompact: false })).toBe(334);
  });

  it("falls back to the edge when the pane has no room beside the content rail", () => {
    expect(resolveFloatingActionsRight({ containerWidth: 900, isCompact: false })).toBe(16);
  });
});
