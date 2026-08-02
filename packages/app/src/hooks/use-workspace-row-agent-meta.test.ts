import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "./use-aggregated-agents";
import { buildWorkspaceRowAgentMeta } from "./workspace-row-agent-meta";

function createAgent(input: {
  id: string;
  serverId: string;
  workspaceId: string;
  parentAgentId?: string | null;
  provider?: string;
  title?: string | null;
  lastActivityAt: Date;
}): AggregatedAgent {
  return {
    id: input.id,
    serverId: input.serverId,
    serverLabel: input.serverId,
    parentAgentId: input.parentAgentId ?? null,
    title: input.title ?? null,
    status: "idle",
    lastActivityAt: input.lastActivityAt,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    provider: input.provider ?? "claude",
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    labels: {},
    projectPlacement: undefined,
  };
}

describe("buildWorkspaceRowAgentMeta", () => {
  it("picks the most recently active agent per workspace", () => {
    const meta = buildWorkspaceRowAgentMeta([
      createAgent({
        id: "a-old",
        serverId: "local",
        workspaceId: "ws-1",
        title: "Plan the migration",
        lastActivityAt: new Date("2026-08-01T10:00:00Z"),
      }),
      createAgent({
        id: "a-new",
        serverId: "local",
        workspaceId: "ws-1",
        provider: "codex",
        title: "Review the diff",
        lastActivityAt: new Date("2026-08-02T10:00:00Z"),
      }),
    ]);

    expect(meta.get("local:ws-1")).toEqual({
      provider: "codex",
      lastActivityAt: new Date("2026-08-02T10:00:00Z"),
      agentTitle: "Review the diff",
    });
  });

  it("ignores subagents that share the workspace with their parent", () => {
    const meta = buildWorkspaceRowAgentMeta([
      createAgent({
        id: "parent",
        serverId: "local",
        workspaceId: "ws-1",
        provider: "claude",
        title: "Root conversation",
        lastActivityAt: new Date("2026-08-01T10:00:00Z"),
      }),
      createAgent({
        id: "child",
        serverId: "local",
        workspaceId: "ws-1",
        parentAgentId: "parent",
        provider: "opencode",
        lastActivityAt: new Date("2026-08-02T10:00:00Z"),
      }),
    ]);

    expect(meta.get("local:ws-1")?.provider).toBe("claude");
    expect(meta.get("local:ws-1")?.agentTitle).toBe("Root conversation");
  });

  it("treats a nested-workspace subagent as a root agent of its own workspace", () => {
    const meta = buildWorkspaceRowAgentMeta([
      createAgent({
        id: "parent",
        serverId: "local",
        workspaceId: "ws-1",
        lastActivityAt: new Date("2026-08-01T10:00:00Z"),
      }),
      createAgent({
        id: "nested-child",
        serverId: "local",
        workspaceId: "ws-2",
        parentAgentId: "parent",
        provider: "kimi",
        lastActivityAt: new Date("2026-08-02T10:00:00Z"),
      }),
    ]);

    expect(meta.get("local:ws-2")?.provider).toBe("kimi");
  });

  it("keys workspaces per server so two hosts keep separate meta", () => {
    const meta = buildWorkspaceRowAgentMeta([
      createAgent({
        id: "a",
        serverId: "laptop",
        workspaceId: "ws-1",
        provider: "claude",
        title: "Laptop agent",
        lastActivityAt: new Date("2026-08-01T10:00:00Z"),
      }),
      createAgent({
        id: "b",
        serverId: "server",
        workspaceId: "ws-1",
        provider: "codex",
        title: "Server agent",
        lastActivityAt: new Date("2026-08-01T12:00:00Z"),
      }),
    ]);

    expect(meta.get("laptop:ws-1")?.agentTitle).toBe("Laptop agent");
    expect(meta.get("server:ws-1")?.agentTitle).toBe("Server agent");
  });

  it("omits workspaces with no agents at all", () => {
    const meta = buildWorkspaceRowAgentMeta([
      createAgent({
        id: "a",
        serverId: "local",
        workspaceId: "ws-1",
        lastActivityAt: new Date("2026-08-01T10:00:00Z"),
      }),
    ]);
    expect(meta.has("local:ws-2")).toBe(false);
  });
});
