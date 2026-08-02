import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import {
  normalizeSidebarFilterQuery,
  resolveSidebarWorkspaceFilterFields,
  sidebarWorkspaceFilterFieldsMatch,
  type SidebarWorkspaceFilterRow,
} from "./sidebar-workspace-filter";

function createEntry(input: {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  name: string;
  projectName: string;
  title?: string | null;
  currentBranch?: string | null;
}): SidebarWorkspaceEntry {
  return {
    ...input,
    title: input.title ?? null,
    currentBranch: input.currentBranch ?? null,
    projectViewKey: `project-${input.projectName}`,
    projectKind: "directory",
    workspaceKind: "local_checkout",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo/ws",
    workspaceDirectoryLabel: "ws",
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  } as SidebarWorkspaceEntry;
}

describe("normalizeSidebarFilterQuery", () => {
  it("trims and lowercases the query", () => {
    expect(normalizeSidebarFilterQuery("  Paseo ")).toBe("paseo");
  });

  it("collapses to empty for whitespace-only input", () => {
    expect(normalizeSidebarFilterQuery("   ")).toBe("");
  });
});

describe("sidebarWorkspaceFilterFieldsMatch", () => {
  const fields = {
    label: "Plan the auth rework",
    name: "main",
    projectName: "paseo",
    currentBranch: "feature/login",
    provider: "claude",
    hostLabel: "MacBook",
  };

  it("matches every visible field", () => {
    expect(sidebarWorkspaceFilterFieldsMatch(fields, "auth")).toBe(true); // label
    expect(sidebarWorkspaceFilterFieldsMatch(fields, "main")).toBe(true); // name
    expect(sidebarWorkspaceFilterFieldsMatch(fields, "pas")).toBe(true); // project
    expect(sidebarWorkspaceFilterFieldsMatch(fields, "login")).toBe(true); // branch
    expect(sidebarWorkspaceFilterFieldsMatch(fields, "clau")).toBe(true); // provider
    expect(sidebarWorkspaceFilterFieldsMatch(fields, "macbook")).toBe(true); // host
  });

  it("is case-insensitive against the normalized query", () => {
    expect(sidebarWorkspaceFilterFieldsMatch(fields, normalizeSidebarFilterQuery("PAseO"))).toBe(
      true,
    );
  });

  it("rejects queries that hit no field", () => {
    expect(sidebarWorkspaceFilterFieldsMatch(fields, "terminal")).toBe(false);
  });

  it("treats an empty query as a match for everything", () => {
    expect(sidebarWorkspaceFilterFieldsMatch(fields, "")).toBe(true);
  });
});

describe("resolveSidebarWorkspaceFilterFields", () => {
  const row: SidebarWorkspaceFilterRow = {
    workspaceKey: "local:ws-1",
    serverId: "local",
    workspaceId: "ws-1",
    name: "main",
    projectName: "paseo",
  };

  const entry = createEntry({
    workspaceKey: "local:ws-1",
    serverId: "local",
    workspaceId: "ws-1",
    name: "main",
    projectName: "paseo",
    currentBranch: "main",
  });

  it("falls back to the placement name when there is no session entry", () => {
    const fields = resolveSidebarWorkspaceFilterFields({
      row,
      entry: null,
      agentMeta: null,
      hostLabel: "MacBook",
      workspaceTitleSource: "title",
    });
    expect(fields.label).toBe("main");
    expect(fields.provider).toBeNull();
  });

  it("uses the agent title for the label in agent mode", () => {
    const fields = resolveSidebarWorkspaceFilterFields({
      row,
      entry,
      agentMeta: {
        provider: "claude",
        lastActivityAt: new Date("2026-08-02T10:00:00Z"),
        agentTitle: "Review the sidebar rework",
      },
      hostLabel: "MacBook",
      workspaceTitleSource: "agent",
    });
    expect(fields.label).toBe("Review the sidebar rework");
    expect(fields.provider).toBe("claude");
  });

  it("keeps the user-set title ahead of the agent title", () => {
    const titled = { ...entry, title: "My custom workspace" };
    const fields = resolveSidebarWorkspaceFilterFields({
      row,
      entry: titled,
      agentMeta: {
        provider: "claude",
        lastActivityAt: new Date("2026-08-02T10:00:00Z"),
        agentTitle: "Review the sidebar rework",
      },
      hostLabel: "MacBook",
      workspaceTitleSource: "agent",
    });
    expect(fields.label).toBe("My custom workspace");
  });
});
