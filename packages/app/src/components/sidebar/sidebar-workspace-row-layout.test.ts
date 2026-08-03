import { describe, expect, it } from "vitest";
import { shouldShowSidebarWorkspaceDiffStat } from "./sidebar-workspace-row-layout";

describe("shouldShowSidebarWorkspaceDiffStat", () => {
  it("keeps diff stats in desktop sidebar rows", () => {
    expect(shouldShowSidebarWorkspaceDiffStat({ hasDiffStat: true, isTouchPlatform: false })).toBe(
      true,
    );
  });

  it("hides diff stats from touch sidebar rows", () => {
    expect(shouldShowSidebarWorkspaceDiffStat({ hasDiffStat: true, isTouchPlatform: true })).toBe(
      false,
    );
  });

  it("does not render a missing diff stat", () => {
    expect(shouldShowSidebarWorkspaceDiffStat({ hasDiffStat: false, isTouchPlatform: false })).toBe(
      false,
    );
  });
});
