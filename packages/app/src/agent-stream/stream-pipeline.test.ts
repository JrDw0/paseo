import { describe, expect, it } from "vitest";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type ToolCallDetailLevel,
} from "@/tool-calls/detail-level/projection";
import type { StreamItem } from "@/types/stream";
import { layoutStream } from "./layout";
import { buildAgentStreamRenderModel } from "./model";
import { resolveStreamRenderStrategy } from "./strategy-resolver";

/**
 * 档 3 重构 spec:锁 view.tsx 的 useMemo 派生管道「端到端语义」。
 *
 * view.tsx 把 tail/head/toolCallDetailLevel 按顺序穿成
 * prepareToolCallHistory → projectToolCallDetailLevel →
 * buildAgentStreamRenderModel → layoutStream;之后根因 B 的 O(M) 重建
 * 要靠把这套 useMemo 拆细或下沉 hook 来消除。本测试只在「拼装语义」
 * 层断言,档 3 无论怎么拆内部,这些结果都必须保持。
 *
 * 不锁引用稳定 — 现状 head 变化会让 projectedToolCalls 重建,
 * 下游 model/layout 随之整体重算;那是档 3 的目标(性能),不是行为违约。
 */
function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): StreamItem {
  return { kind: "user_message", id, text: id, timestamp: createTimestamp(seed) };
}

function assistantMessage(id: string, seed: number): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: createTimestamp(seed) };
}

function toolCall(id: string, callId: string, seed: number): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: createTimestamp(seed),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId,
        name: "Edit",
        status: "running",
        error: null,
        detail: { type: "edit", filePath: "x.ts", oldString: "a", newString: "b" },
      },
    },
  };
}

interface PipelineInput {
  agentStatus: string;
  tail: StreamItem[];
  head: StreamItem[];
  platform: "web" | "ios" | "android";
  isMobileBreakpoint: boolean;
  toolCallDetailLevel: ToolCallDetailLevel;
}

/** 按 view.tsx 当前拼装顺序跑完整 pipeline。重构后这个函数本身会搬到
 *  提取出的 hook,但调用序与结构必须保持等价。 */
function runPipeline(input: PipelineInput) {
  const preparedToolCallHistory = prepareToolCallHistory(input.toolCallDetailLevel, input.tail);
  const projectedToolCalls = projectToolCallDetailLevel({
    level: input.toolCallDetailLevel,
    tail: input.tail,
    head: input.head,
    preparedHistory: preparedToolCallHistory,
    isTurnActive: input.agentStatus === "running",
  });
  const strategy = resolveStreamRenderStrategy({
    platform: input.platform,
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
  const model = buildAgentStreamRenderModel({
    isTurnActive: input.agentStatus === "running",
    activeTurnStartedAt: null,
    tail: projectedToolCalls.tail,
    head: projectedToolCalls.head,
    platform: input.platform === "web" ? "web" : "native",
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
  const layout = layoutStream({
    strategy,
    isTurnActive: input.agentStatus === "running",
    history: model.history,
    liveHead: model.segments.liveHead,
    timingByAssistantId: model.turnTiming.byAssistantId,
  });
  return { strategy, preparedToolCallHistory, projectedToolCalls, model, layout };
}

describe("stream pipeline: prepare → project → model → layout", () => {
  it("routes streaming assistant into liveHead, committed user+assistant into history (web)", () => {
    const tail: StreamItem[] = [userMessage("u1", 1), assistantMessage("a1", 2)];
    const head: StreamItem[] = [assistantMessage("live-a", 3)];

    const { projectedToolCalls, model, layout } = runPipeline({
      agentStatus: "running",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
      toolCallDetailLevel: "detailed",
    });

    expect(projectedToolCalls.tail).toBe(tail);
    expect(projectedToolCalls.head).toBe(head);
    expect(model.segments.liveHead.map((item) => item.id)).toEqual(["live-a"]);
    expect(layout.history.map((item) => item.item.id)).toEqual(["u1", "a1"]);
    expect(layout.liveHead.map((item) => item.item.id)).toEqual(["live-a"]);
    expect(layout.auxiliaryTurnFooter).toBeNull();
  });

  it("places turn footer host on assistant when turn completes (web, idle)", () => {
    const tail: StreamItem[] = [userMessage("u1", 1), assistantMessage("a1", 4)];
    const { model, layout } = runPipeline({
      agentStatus: "idle",
      tail,
      head: [],
      platform: "web",
      isMobileBreakpoint: false,
      toolCallDetailLevel: "detailed",
    });

    expect(model.turnTiming.byAssistantId.get("a1")).toEqual({
      startedAt: tail[0]?.timestamp,
      completedAt: tail[1]?.timestamp,
      durationMs: 3000,
    });
    expect(layout.auxiliaryTurnFooter?.itemId).toBe("a1");
    expect(layout.liveHead).toHaveLength(0);
  });

  it("keeps user-message footer host anchored on the preceding assistant turn across chained runs", () => {
    // 两个 turn:user1→a1 完成后 user2→a2;后 turn footer 只绑 a2。
    const tail: StreamItem[] = [
      userMessage("u1", 1),
      assistantMessage("a1", 2),
      userMessage("u2", 5),
      assistantMessage("a2", 8),
    ];
    const { model, layout } = runPipeline({
      agentStatus: "idle",
      tail,
      head: [],
      platform: "web",
      isMobileBreakpoint: false,
      toolCallDetailLevel: "detailed",
    });

    const footerA1 = model.turnTiming.byAssistantId.get("a1");
    const footerA2 = model.turnTiming.byAssistantId.get("a2");
    expect(footerA1).toEqual({
      startedAt: tail[0].timestamp,
      completedAt: tail[1].timestamp,
      durationMs: 1000,
    });
    expect(footerA2).toEqual({
      startedAt: tail[2].timestamp,
      completedAt: tail[3].timestamp,
      durationMs: 3000,
    });
    // auxiliaryTurnFooter 锚定最新 turn。
    expect(layout.auxiliaryTurnFooter?.itemId).toBe("a2");
  });

  it("detailLevel=detailed bypasses grouping; returned tail/head are the input refs", () => {
    const tail: StreamItem[] = [
      userMessage("u1", 1),
      toolCall("tc1", "call-1", 2),
      toolCall("tc1b", "call-1", 3),
      assistantMessage("a1", 4),
    ];
    const head: StreamItem[] = [toolCall("live-tc", "call-2", 5)];

    const { preparedToolCallHistory, projectedToolCalls } = runPipeline({
      agentStatus: "idle",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
      toolCallDetailLevel: "detailed",
    });

    expect(preparedToolCallHistory).toBeNull();
    expect(projectedToolCalls.tail).toBe(tail);
    expect(projectedToolCalls.head).toBe(head);
    expect(projectedToolCalls.groupsByHostId.size).toBe(0);
    expect(projectedToolCalls.historyGroupUpdatesByHostId.size).toBe(0);
  });

  it("detailLevel=overview throws if pipeline forgets to prepare history", () => {
    expect(() =>
      projectToolCallDetailLevel({
        level: "overview",
        tail: [userMessage("u1", 1)],
        head: [],
        preparedHistory: null,
        isTurnActive: false,
      }),
    ).toThrow("Missing prepared overview tool call history");
  });

  it("native inverted strategy reverses rendered order but keeps timing semantics", () => {
    const tail: StreamItem[] = [userMessage("u1", 1), assistantMessage("a1", 4)];
    const { model, layout, strategy } = runPipeline({
      agentStatus: "idle",
      tail,
      head: [],
      platform: "android",
      isMobileBreakpoint: false,
      toolCallDetailLevel: "detailed",
    });

    expect(strategy.getFlatListInverted()).toBe(true);
    expect(model.segments.historyMounted.map((item) => item.id)).toEqual(["a1", "u1"]);
    expect(model.turnTiming.byAssistantId.get("a1")).toEqual({
      startedAt: tail[0].timestamp,
      completedAt: tail[1].timestamp,
      durationMs: 3000,
    });
    expect(layout.auxiliaryTurnFooter?.itemId).toBe("a1");
  });

  it("scales correctly on a long committed tail plus streaming head", () => {
    const tail: StreamItem[] = [];
    for (let index = 0; index < 100; index += 1) {
      tail.push(userMessage(`u${index}`, index * 2));
      tail.push(assistantMessage(`a${index}`, index * 2 + 1));
    }
    const head: StreamItem[] = [assistantMessage("live-final", 300)];

    const { model, layout } = runPipeline({
      agentStatus: "running",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: true,
      toolCallDetailLevel: "detailed",
    });

    // mobile web keeps the whole committed tail mounted.
    expect(model.segments.historyMounted).toBe(tail);
    expect(layout.history).toHaveLength(200);
    expect(layout.liveHead.map((item) => item.item.id)).toEqual(["live-final"]);
  });
});
