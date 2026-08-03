import type {
  DaemonClient,
  FetchAgentTimelinePayload,
} from "@getpaseo/client/internal/daemon-client";
import { generateMessageId } from "@/types/stream";
import { planTimelineFullIndexFetch } from "./timeline-sync-plan";

const pendingRequestIds = new Set<string>();
const inFlightByClient = new WeakMap<object, Map<string, Promise<FetchAgentTimelinePayload>>>();

export type MessageJumpTimelineRequest = Parameters<DaemonClient["fetchAgentTimeline"]>[1];

export function createMessageJumpTimelineRequestId(kind: "index" | "window"): string {
  const requestId = `message-jump-${kind}:${generateMessageId()}`;
  pendingRequestIds.add(requestId);
  return requestId;
}

function releaseMessageJumpTimelineRequest(requestId: string): void {
  pendingRequestIds.delete(requestId);
}

/** Consume an index-only response before the normal session timeline reducer sees it. */
export function consumeMessageJumpTimelineResponse(requestId: string): boolean {
  if (!pendingRequestIds.has(requestId)) {
    return false;
  }
  pendingRequestIds.delete(requestId);
  return true;
}

export function fetchMessageJumpTimeline(
  client: Pick<DaemonClient, "fetchAgentTimeline">,
  agentId: string,
): Promise<FetchAgentTimelinePayload> {
  let inFlight = inFlightByClient.get(client);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByClient.set(client, inFlight);
  }

  const existing = inFlight.get(agentId);
  if (existing) {
    return existing;
  }

  const requestId = createMessageJumpTimelineRequestId("index");
  const fetch = client.fetchAgentTimeline(agentId, {
    ...planTimelineFullIndexFetch(),
    requestId,
  });
  inFlight.set(agentId, fetch);
  const clear = () => {
    releaseMessageJumpTimelineRequest(requestId);
    if (inFlight.get(agentId) === fetch) {
      inFlight.delete(agentId);
    }
  };
  void fetch.then(clear, clear);
  return fetch;
}

/**
 * Fetch a target window without allowing the SessionContext canonical reducer
 * to consume the same response. The caller owns the returned page and may
 * merge it into an ephemeral target-window state.
 */
export function fetchMessageJumpTimelinePage(
  client: Pick<DaemonClient, "fetchAgentTimeline">,
  agentId: string,
  request: MessageJumpTimelineRequest,
): Promise<FetchAgentTimelinePayload> {
  const requestId = createMessageJumpTimelineRequestId("window");
  const fetch = client.fetchAgentTimeline(agentId, {
    ...request,
    requestId,
  });
  const clear = () => releaseMessageJumpTimelineRequest(requestId);
  void fetch.then(clear, clear);
  return fetch;
}
