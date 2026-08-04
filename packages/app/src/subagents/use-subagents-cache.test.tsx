/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useSubagentsForParent } from "./select";

const SERVER_ID = "server-cache";
const BASE_TIME = new Date("2026-03-08T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "codex",
  status: "idle",
  createdAt: BASE_TIME,
  updatedAt: BASE_TIME,
  lastUserMessageAt: null,
  lastActivityAt: BASE_TIME,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function setAgents(agents: Agent[]): void {
  useSessionStore.getState().initializeSession(SERVER_ID, null as never);
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((agent) => [agent.id, agent])));
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderHookWithWrapper<Props, Result>(
  render: (props: Props) => Result,
  initialProps: Props,
) {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(render, { wrapper, initialProps });
}

beforeEach(() => {
  setAgents([makeAgent({ id: "parent-a" }), makeAgent({ id: "parent-b" })]);
});

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
});

describe("useSubagentsForParent row cache", () => {
  it("reuses a stable row reference for an unchanged child when a sibling changes", () => {
    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "child-1", parentAgentId: "parent-a" }),
      makeAgent({ id: "child-2", parentAgentId: "parent-a" }),
    ]);

    const { result, rerender } = renderHookWithWrapper(
      ({ parentAgentId }) => ({
        parentAgentId,
        rows: useSubagentsForParent({ serverId: SERVER_ID, parentAgentId }),
      }),
      { parentAgentId: "parent-a" },
    );
    const child1Before = result.current.rows.find((row) => row.id === "child-1");
    expect(child1Before).toBeDefined();

    // Only child-2's status changes; child-1 is unchanged and must keep its ref.
    useSessionStore.getState().setAgents(SERVER_ID, (agents) => {
      const next = new Map(agents);
      const c2 = next.get("child-2") as Agent;
      next.set("child-2", { ...c2, status: "running" });
      return next;
    });

    rerender({ parentAgentId: "parent-a" });

    const child1After = result.current.rows.find((row) => row.id === "child-1");
    const child2After = result.current.rows.find((row) => row.id === "child-2");
    expect(child1After).toBe(child1Before); // cache hit — stable reference
    expect(child2After?.status).toBe("running");
  });

  it("keeps row caches per parent, so switching parents yields independent objects", () => {
    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "parent-b" }),
      makeAgent({ id: "child-a", parentAgentId: "parent-a" }),
      makeAgent({ id: "child-b", parentAgentId: "parent-b" }),
    ]);

    const { result, rerender } = renderHookWithWrapper(
      ({ parentAgentId }) => ({
        parentAgentId,
        rows: useSubagentsForParent({ serverId: SERVER_ID, parentAgentId }),
      }),
      { parentAgentId: "parent-a" },
    );
    const childABefore = result.current.rows.find((row) => row.id === "child-a");
    expect(childABefore).toBeDefined();

    // Switch the same hook instance to a different parent: the new parent's rows
    // must be its own, never a stale reference borrowed from the prior parent.
    rerender({ parentAgentId: "parent-b" });
    const childB = result.current.rows.find((row) => row.id === "child-b");
    expect(childB).toBeDefined();
    expect(result.current.rows).not.toContain(childABefore);
  });
});
