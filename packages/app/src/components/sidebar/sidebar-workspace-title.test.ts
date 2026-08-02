import { describe, expect, it } from "vitest";
import {
  resolveSidebarWorkspaceAccessibilityLabel,
  resolveSidebarWorkspacePrimaryLabel,
} from "@/components/sidebar/sidebar-workspace-title";

describe("resolveSidebarWorkspacePrimaryLabel", () => {
  it("uses the workspace name when there is no title or session title", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", title: null },
    });

    expect(label).toBe("Investigate search");
  });

  it("prefers the session title over the workspace name", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", title: null },
      agentTitle: "Review the sidebar rework",
    });

    expect(label).toBe("Review the sidebar rework");
  });

  it("prefers the session title even when the workspace name is the branch", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "personal", title: null },
      agentTitle: "调查一下为啥导入的会话标题都一样",
    });

    expect(label).toBe("调查一下为啥导入的会话标题都一样");
  });

  it("lets a user-set title win over the session title", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "personal", title: "My custom" },
      agentTitle: "Review the sidebar rework",
    });

    expect(label).toBe("My custom");
  });

  it("falls back to the workspace name when there is no session title", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", title: null },
      agentTitle: null,
    });

    expect(label).toBe("Investigate search");
  });
});

describe("resolveSidebarWorkspaceAccessibilityLabel", () => {
  it("includes the visible host badge with the workspace title", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", statusBucket: "done" },
      hostBadgeLabel: "Build host",
    });

    expect(label).toBe("Investigate search, Build host");
  });

  it("owns every visual row contributor in one accessible label", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: {
        name: "Investigate search",
        currentBranch: "fix/search",
        statusBucket: "running",
      },
      leadingProjectName: "Search project",
      hostBadgeLabel: "Build host",
      pullRequestLabel: "Pull request 42",
      serviceLabel: "Service web running",
    });

    expect(label).toBe(
      "Search project, fix/search, Build host, Pull request 42, Service web running, Working",
    );
  });

  it("omits the idle status from the workspace label", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", statusBucket: "done" },
      leadingProjectName: "Search project",
      hostBadgeLabel: "Build host",
    });

    expect(label).toBe("Search project, Investigate search, Build host");
  });
});
