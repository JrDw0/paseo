import { useCallback, useMemo } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { useDownloadStore } from "@/stores/download-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useSessionStore } from "@/stores/session-store";

interface UseFileDownloadParams {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
}

/**
 * Returns a stable callback that downloads a single workspace file by its
 * workspace-relative path. Shared by the file explorer tree and the git diff
 * pane so both surfaces download through the same host token + download-store
 * pipeline instead of duplicating the plumbing. When the host has no direct
 * HTTP connection (e.g. relay-only), the store streams the file over the
 * session WebSocket via the session client.
 */
export function useFileDownload({
  serverId,
  workspaceId,
  workspaceRoot,
}: UseFileDownloadParams): (input: { fileName: string; path: string }) => void {
  const daemons = useHosts();
  const daemonProfile = useMemo(
    () => daemons.find((daemon) => daemon.serverId === serverId),
    [daemons, serverId],
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const workspaceScopeId = useMemo(
    () => workspaceId?.trim() || normalizedWorkspaceRoot,
    [normalizedWorkspaceRoot, workspaceId],
  );
  const { requestFileDownloadToken } = useFileExplorerActions({
    serverId,
    workspaceId,
    workspaceRoot: normalizedWorkspaceRoot,
  });
  const startDownload = useDownloadStore((state) => state.startDownload);

  return useCallback(
    ({ fileName, path }) => {
      if (!workspaceScopeId) {
        return;
      }
      void startDownload({
        serverId,
        scopeId: workspaceScopeId,
        fileName,
        path,
        workspaceRoot: normalizedWorkspaceRoot,
        client,
        daemonProfile,
        requestFileDownloadToken: (targetPath) => requestFileDownloadToken(targetPath),
      });
    },
    [
      client,
      daemonProfile,
      normalizedWorkspaceRoot,
      requestFileDownloadToken,
      serverId,
      startDownload,
      workspaceScopeId,
    ],
  );
}
