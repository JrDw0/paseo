import type {
  DaemonClient,
  FetchAgentTimelinePayload,
} from "@getpaseo/client/internal/daemon-client";
import { generateMessageId } from "@/types/stream";
import { planTimelineFullIndexFetch } from "./timeline-sync-plan";

const pendingRequestIds = new Set<string>();
const inFlightByClient = new WeakMap<object, Map<string, Promise<FetchAgentTimelinePayload>>>();

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

  const requestId = `message-jump-index:${generateMessageId()}`;
  pendingRequestIds.add(requestId);
  const fetch = client.fetchAgentTimeline(agentId, {
    ...planTimelineFullIndexFetch(),
    requestId,
  });
  inFlight.set(agentId, fetch);
  const clear = () => {
    pendingRequestIds.delete(requestId);
    if (inFlight.get(agentId) === fetch) {
      inFlight.delete(agentId);
    }
  };
  void fetch.then(clear, clear);
  return fetch;
}
