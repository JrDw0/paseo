import { describe, expect, it } from "vitest";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";

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
