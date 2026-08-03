import { describe, expect, it } from "vitest";
import {
  shouldShowSidebarWorkspaceDiffStat,
  shouldShowSidebarWorkspaceMetadataDiff,
} from "./sidebar-workspace-row-layout";

describe("shouldShowSidebarWorkspaceDiffStat", () => {
  it("keeps diff stats in desktop sidebar rows", () => {
    expect(shouldShowSidebarWorkspaceDiffStat({ hasDiffStat: true, isCompact: false })).toBe(true);
  });

  it("moves diff stats to compact metadata instead of the desktop trailing slot", () => {
    expect(shouldShowSidebarWorkspaceDiffStat({ hasDiffStat: true, isCompact: true })).toBe(false);
    expect(shouldShowSidebarWorkspaceMetadataDiff({ hasDiffStat: true, isCompact: true })).toBe(
      true,
    );
  });

  it("does not render a missing diff stat", () => {
    expect(shouldShowSidebarWorkspaceDiffStat({ hasDiffStat: false, isCompact: false })).toBe(
      false,
    );
  });
});
