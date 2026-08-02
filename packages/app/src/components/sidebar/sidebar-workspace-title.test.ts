import { describe, expect, it } from "vitest";
import {
  resolveSidebarWorkspaceAccessibilityLabel,
  resolveSidebarWorkspacePrimaryLabel,
} from "@/components/sidebar/sidebar-workspace-title";

describe("resolveSidebarWorkspacePrimaryLabel", () => {
  it("uses the workspace name in title mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", title: null },
      workspaceTitleSource: "title",
    });

    expect(label).toBe("Investigate search");
  });

  it("uses the branch name in branch mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", title: null },
      workspaceTitleSource: "branch",
    });

    expect(label).toBe("fix/search");
  });

  it("falls back to the workspace name in branch mode without a branch", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Local folder", currentBranch: null, title: null },
      workspaceTitleSource: "branch",
    });

    expect(label).toBe("Local folder");
  });

  it("uses the agent title in agent mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", title: null },
      workspaceTitleSource: "agent",
      agentTitle: "Review the sidebar rework",
    });

    expect(label).toBe("Review the sidebar rework");
  });

  it("falls back to the workspace name in agent mode without an agent title", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", title: null },
      workspaceTitleSource: "agent",
      agentTitle: null,
    });

    expect(label).toBe("Investigate search");
  });

  it("ignores the agent title in branch mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", title: null },
      workspaceTitleSource: "branch",
      agentTitle: "Review the sidebar rework",
    });

    expect(label).toBe("fix/search");
  });

  it("lets a user-set title win over every source", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", title: "My custom" },
      workspaceTitleSource: "agent",
      agentTitle: "Review the sidebar rework",
    });

    expect(label).toBe("My custom");
  });
});

describe("resolveSidebarWorkspaceAccessibilityLabel", () => {
  it("includes the visible host badge with the workspace title", () => {
    const label = resolveSidebarWorkspaceAccessibilityLabel({
      workspace: { name: "Investigate search", currentBranch: "fix/search", statusBucket: "done" },
      workspaceTitleSource: "title",
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
      workspaceTitleSource: "branch",
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
      workspaceTitleSource: "title",
      leadingProjectName: "Search project",
      hostBadgeLabel: "Build host",
    });

    expect(label).toBe("Search project, Investigate search, Build host");
  });
});
