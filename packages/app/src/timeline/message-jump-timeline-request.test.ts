import { describe, expect, it, vi } from "vitest";
import type { FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import {
  consumeMessageJumpTimelineResponse,
  fetchMessageJumpTimeline,
} from "./message-jump-timeline-request";

describe("message jump timeline requests", () => {
  it("registers the response before sending and consumes it exactly once", async () => {
    let resolveFetch: ((payload: FetchAgentTimelinePayload) => void) | undefined;
    const fetchAgentTimeline = vi.fn(
      (_agentId: string, options: { requestId?: string }) =>
        new Promise<FetchAgentTimelinePayload>((resolve) => {
          expect(options.requestId).toMatch(/^message-jump-index:/);
          expect(consumeMessageJumpTimelineResponse(options.requestId ?? "")).toBe(true);
          expect(consumeMessageJumpTimelineResponse(options.requestId ?? "")).toBe(false);
          resolveFetch = resolve;
        }),
    );

    const request = fetchMessageJumpTimeline({ fetchAgentTimeline } as never, "agent-1");
    expect(fetchAgentTimeline).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ messageKind: "user", requestId: expect.any(String) }),
    );
    resolveFetch?.({} as FetchAgentTimelinePayload);
    await request;
  });

  it("does not consume normal timeline responses", () => {
    expect(consumeMessageJumpTimelineResponse("ordinary-request")).toBe(false);
  });
});
