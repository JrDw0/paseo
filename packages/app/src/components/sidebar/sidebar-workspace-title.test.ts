import { describe, expect, it } from "vitest";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";

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
