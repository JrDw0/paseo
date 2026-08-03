import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DaemonClient,
  FetchAgentTimelinePayload,
  FetchAgentTimelineOptions,
} from "@getpaseo/client/internal/daemon-client";
import type { MessageJumpEntry } from "@/components/message-jump-sheet";
import {
  fetchMessageJumpTimelinePage,
  type MessageJumpTimelineRequest,
} from "@/timeline/message-jump-timeline-request";
import {
  TARGET_WINDOW_EXPANSION_DELAY_MS,
  TARGET_WINDOW_INITIAL_LIMIT,
  TARGET_WINDOW_MAX_ITEMS,
  TARGET_WINDOW_PAGE_LIMIT,
  createTargetWindowSnapshot,
  createTargetWindowPlaceholder,
  findTargetWindowMessageId,
  getTargetWindowExpansion,
  hydrateTargetWindowPage,
  mergeTargetWindowPage,
  targetWindowContainsTarget,
  targetWindowItems,
  type TargetWindowSnapshot,
} from "@/agent-stream/target-window";

type TargetWindowClient = Pick<DaemonClient, "fetchAgentTimeline">;

function buildTargetWindowRequest(
  direction: "before" | "after",
  cursor: { epoch: string; seq: number },
  limit: number,
  projection: "projected" | "canonical" = "projected",
  messageKind?: "user",
): MessageJumpTimelineRequest {
  return {
    direction,
    cursor,
    limit,
    projection,
    ...(messageKind ? { messageKind } : {}),
  } satisfies FetchAgentTimelineOptions;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeExpansionPage(input: {
  current: TargetWindowSnapshot;
  direction: "before" | "after";
  page: ReturnType<typeof hydrateTargetWindowPage>;
}): { next: TargetWindowSnapshot; madeProgress: boolean } {
  const nextRows = mergeTargetWindowPage({
    epoch: input.current.epoch ?? "",
    existingRows: input.current.rows,
    page: input.page,
  });
  const next = {
    ...input.current,
    status: "expanding" as const,
    rows: nextRows,
    items: targetWindowItems(nextRows),
    startCursor: input.direction === "before" ? input.page.startCursor : input.current.startCursor,
    endCursor: input.direction === "after" ? input.page.endCursor : input.current.endCursor,
    hasOlder: input.direction === "before" ? input.page.hasOlder : input.current.hasOlder,
    hasNewer: input.direction === "after" ? input.page.hasNewer : input.current.hasNewer,
    focusRevision: input.current.focusRevision + 1,
  };
  return { next, madeProgress: nextRows.length > input.current.rows.length };
}

function canStartExpansion(snapshot: TargetWindowSnapshot): boolean {
  return (
    !snapshot.target ||
    !snapshot.epoch ||
    snapshot.status === "idle" ||
    snapshot.items.length >= TARGET_WINDOW_MAX_ITEMS
  );
}

async function fetchExpansionPage(input: {
  client: TargetWindowClient;
  agentId: string;
  direction: "before" | "after";
  cursor: { epoch: string; seq: number };
}): Promise<FetchAgentTimelinePayload> {
  const payload = await fetchMessageJumpTimelinePage(
    input.client,
    input.agentId,
    buildTargetWindowRequest(input.direction, input.cursor, TARGET_WINDOW_PAGE_LIMIT, "canonical"),
  );
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload;
}

function stopExpansionWithoutProgress(
  snapshot: TargetWindowSnapshot,
  direction: "before" | "after",
): TargetWindowSnapshot {
  return {
    ...snapshot,
    hasOlder: direction === "before" ? false : snapshot.hasOlder,
    hasNewer: direction === "after" ? false : snapshot.hasNewer,
  };
}

export function useMessageJumpTargetWindow(input: {
  client: TargetWindowClient | null;
  agentId: string;
  isActive: boolean;
}) {
  const [snapshot, setSnapshot] = useState(createTargetWindowSnapshot);
  const snapshotRef = useRef(snapshot);
  const generationRef = useRef(0);
  const activeRef = useRef(input.isActive);
  const expansionRunRef = useRef<{ token: number; generation: number } | null>(null);
  const expansionRunTokenRef = useRef(0);
  const expansionScheduledRef = useRef(false);
  const expansionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  snapshotRef.current = snapshot;
  activeRef.current = input.isActive;

  const updateSnapshot = useCallback(
    (updater: (current: TargetWindowSnapshot) => TargetWindowSnapshot) => {
      setSnapshot((current) => {
        const next = updater(current);
        snapshotRef.current = next;
        return next;
      });
    },
    [],
  );

  const cancelScheduledExpansion = useCallback(() => {
    if (expansionTimerRef.current !== null) {
      clearTimeout(expansionTimerRef.current);
      expansionTimerRef.current = null;
    }
    expansionScheduledRef.current = false;
  }, []);

  const nextGeneration = useCallback(() => {
    generationRef.current += 1;
    cancelScheduledExpansion();
    return generationRef.current;
  }, [cancelScheduledExpansion]);

  const loadTarget = useCallback(
    async (target: MessageJumpEntry, generation: number) => {
      const client = input.client;
      if (!client) {
        updateSnapshot((current) => ({
          ...current,
          status: "error",
          target,
          generation,
          error: "Daemon client unavailable",
        }));
        return;
      }

      try {
        const page = await fetchMessageJumpTimelinePage(
          client,
          input.agentId,
          buildTargetWindowRequest(
            "before",
            {
              epoch: target.epoch,
              seq: target.seq + 1,
            },
            TARGET_WINDOW_INITIAL_LIMIT,
            "canonical",
          ),
        );
        if (generationRef.current !== generation) {
          return;
        }
        const hydrated = hydrateTargetWindowPage(page);
        const items = targetWindowItems(hydrated.rows);
        if (!findTargetWindowMessageId(items, target)) {
          throw new Error("Target message was not returned by the daemon");
        }
        const next: TargetWindowSnapshot = {
          status: "ready",
          target: { ...target, epoch: page.epoch },
          epoch: page.epoch,
          rows: hydrated.rows,
          items,
          startCursor: hydrated.startCursor,
          endCursor: hydrated.endCursor,
          hasOlder: hydrated.hasOlder,
          hasNewer: hydrated.hasNewer,
          generation,
          focusRevision: snapshotRef.current.focusRevision + 1,
          error: null,
        };
        setSnapshot(next);
        snapshotRef.current = next;
      } catch (error) {
        if (generationRef.current !== generation) {
          return;
        }
        updateSnapshot((current) => ({
          ...current,
          status: "error",
          target,
          generation,
          error: errorMessage(error),
        }));
      }
    },
    [input.agentId, input.client, updateSnapshot],
  );

  const startExpansion = useCallback(
    // oxlint-disable-next-line complexity
    async (initial: TargetWindowSnapshot) => {
      const activeRun = expansionRunRef.current;
      if (
        (activeRun && activeRun.generation === initial.generation) ||
        canStartExpansion(initial)
      ) {
        return;
      }
      const run = {
        token: expansionRunTokenRef.current + 1,
        generation: initial.generation,
      };
      expansionRunTokenRef.current = run.token;
      expansionRunRef.current = run;
      let current = initial;
      const generation = run.generation;
      try {
        while (
          activeRef.current &&
          generationRef.current === generation &&
          current.items.length < TARGET_WINDOW_MAX_ITEMS
        ) {
          const expansion = getTargetWindowExpansion(current);
          if (!expansion) {
            break;
          }
          const client = input.client;
          const epoch = current.epoch;
          if (!client || !current.target || !epoch) {
            throw new Error("Daemon client unavailable");
          }
          const page = await fetchExpansionPage({
            client,
            agentId: input.agentId,
            direction: expansion.direction,
            cursor: expansion.cursor,
          });
          if (generationRef.current !== generation) {
            return;
          }
          const merged = mergeExpansionPage({
            current: { ...current, epoch },
            direction: expansion.direction,
            page: hydrateTargetWindowPage(page),
          });
          current = merged.next;
          if (!activeRef.current) {
            current = { ...current, status: "ready" };
            break;
          }
          if (!merged.madeProgress) {
            current = stopExpansionWithoutProgress(current, expansion.direction);
          }
          setSnapshot(current);
          snapshotRef.current = current;
          if (!merged.madeProgress) {
            break;
          }
        }
      } catch (error) {
        if (generationRef.current === generation) {
          current = { ...current, status: "error", error: errorMessage(error) };
          setSnapshot(current);
          snapshotRef.current = current;
        }
      } finally {
        if (expansionRunRef.current?.token === run.token) {
          expansionRunRef.current = null;
          if (generationRef.current === generation && current.status === "expanding") {
            const settled = { ...current, status: "ready" as const };
            setSnapshot(settled);
            snapshotRef.current = settled;
          }
        }
      }
    },
    [input.agentId, input.client],
  );

  const scheduleExpansion = useCallback(
    (current: TargetWindowSnapshot) => {
      if (expansionScheduledRef.current || !input.isActive) {
        return;
      }
      expansionScheduledRef.current = true;
      expansionTimerRef.current = setTimeout(() => {
        expansionTimerRef.current = null;
        expansionScheduledRef.current = false;
        void startExpansion(current);
      }, TARGET_WINDOW_EXPANSION_DELAY_MS);
    },
    [input.isActive, startExpansion],
  );

  const open = useCallback(
    (target: MessageJumpEntry) => {
      const current = snapshotRef.current;
      if (current.items.length > 0 && targetWindowContainsTarget(current.rows, target)) {
        const generation = nextGeneration();
        const next = {
          ...current,
          status: "ready" as const,
          target,
          generation,
          focusRevision: current.focusRevision + 1,
          error: null,
        };
        setSnapshot(next);
        snapshotRef.current = next;
        return;
      }

      const generation = nextGeneration();
      const placeholder = createTargetWindowPlaceholder(target);
      const loading: TargetWindowSnapshot = {
        status: "loading",
        target,
        epoch: target.epoch,
        rows: [placeholder],
        items: [placeholder.item],
        startCursor: { epoch: target.epoch, seq: target.seq },
        endCursor: { epoch: target.epoch, seq: target.seq },
        hasOlder: false,
        hasNewer: false,
        generation,
        focusRevision: current.focusRevision + 1,
        error: null,
      };
      setSnapshot(loading);
      snapshotRef.current = loading;
      void loadTarget(target, generation);
    },
    [loadTarget, nextGeneration],
  );

  const retry = useCallback(() => {
    const target = snapshotRef.current.target;
    if (!target) {
      return;
    }
    const generation = nextGeneration();
    const loading = { ...snapshotRef.current, status: "loading" as const, generation, error: null };
    setSnapshot(loading);
    snapshotRef.current = loading;
    void loadTarget(target, generation);
  }, [loadTarget, nextGeneration]);

  const clear = useCallback(() => {
    const generation = nextGeneration();
    const next = createTargetWindowSnapshot();
    next.generation = generation;
    setSnapshot(next);
    snapshotRef.current = next;
  }, [nextGeneration]);

  useEffect(() => {
    if (!input.isActive || snapshot.status !== "ready") {
      return;
    }
    scheduleExpansion(snapshot);
  }, [input.isActive, scheduleExpansion, snapshot]);

  useEffect(() => {
    const generation = nextGeneration();
    const next = createTargetWindowSnapshot();
    next.generation = generation;
    setSnapshot(next);
    snapshotRef.current = next;
  }, [input.agentId, nextGeneration]);

  useEffect(() => {
    if (input.isActive) {
      return;
    }
    const generation = nextGeneration();
    const next = createTargetWindowSnapshot();
    next.generation = generation;
    setSnapshot(next);
    snapshotRef.current = next;
  }, [input.isActive, nextGeneration]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      cancelScheduledExpansion();
    };
  }, [cancelScheduledExpansion]);

  const targetMessageId = snapshot.target
    ? findTargetWindowMessageId(snapshot.items, snapshot.target)
    : null;
  const active = snapshot.items.length > 0 && snapshot.status !== "idle";
  const suppressBottomAnchor = snapshot.target !== null && snapshot.status !== "idle";

  return {
    ...snapshot,
    active,
    suppressBottomAnchor,
    targetMessageId,
    open,
    retry,
    clear,
  };
}
