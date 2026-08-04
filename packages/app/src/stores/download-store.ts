import { create } from "zustand";
import { Platform } from "react-native";
import { File as FSFile, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { HostProfile } from "@/types/host-connection";
import { buildDaemonWebSocketUrl } from "@/utils/daemon-endpoints";
import { openExternalUrl } from "@/utils/open-external-url";
import { isWeb } from "@/constants/platform";
import { i18n } from "@/i18n/i18next";
import {
  copyLocalFileToSafDocument,
  openLocalFileInViewer,
} from "../../modules/paseo-downloads/src/index";

interface DownloadProgress {
  percent: number;
  bytesWritten: number;
  totalBytes: number;
  speed: number;
  eta: number;
}

export interface Download {
  id: string;
  serverId: string;
  scopeId: string;
  fileName: string;
  status: "downloading" | "complete" | "error";
  message?: string;
  /** Where the bytes landed on disk (native only); null/undefined on web. */
  localUri?: string | null;
  mimeType?: string | null;
  /** Feedback for a post-download action (open/save-to-folder), shown in the toast. */
  actionMessage?: string | null;
  progress?: DownloadProgress;
  startedAt: number;
}

interface DownloadState {
  downloads: Map<string, Download>;
  activeDownloadId: string | null;

  startDownload: (params: {
    serverId: string;
    scopeId: string;
    fileName: string;
    path: string;
    workspaceRoot: string;
    client: DaemonClient | null;
    daemonProfile: HostProfile | undefined;
    requestFileDownloadToken: (path: string) => Promise<{
      token: string | null;
      fileName: string | null;
      mimeType: string | null;
      error: string | null;
    }>;
  }) => Promise<void>;

  updateProgress: (id: string, progress: DownloadProgress) => void;
  completeDownload: (
    id: string,
    extras?: { localUri?: string | null; mimeType?: string | null },
  ) => void;
  failDownload: (id: string, message: string) => void;
  dismissDownload: (id: string) => void;
  dismissAllCompleted: () => void;
  /** Post-download actions, gated to Android downloads that have a local file. */
  openDownload: (id: string) => Promise<void>;
  saveDownload: (id: string) => Promise<void>;
  setDownloadActionMessage: (id: string, message: string | null) => void;
}

function generateDownloadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useDownloadStore = create<DownloadState>()((set, get) => ({
  downloads: new Map(),
  activeDownloadId: null,

  startDownload: async ({
    serverId,
    scopeId,
    fileName,
    path,
    workspaceRoot,
    client,
    daemonProfile,
    requestFileDownloadToken,
  }) => {
    const id = generateDownloadId();
    const download: Download = {
      id,
      serverId,
      scopeId,
      fileName,
      status: "downloading",
      startedAt: Date.now(),
    };

    set((state) => ({
      downloads: new Map(state.downloads).set(id, download),
      activeDownloadId: id,
    }));

    try {
      const downloadTarget = resolveDaemonDownloadTarget(daemonProfile);

      // Relay-only hosts have no direct HTTP endpoint — stream the file over
      // the session WebSocket (E2EE) instead of the token+HTTP pipeline.
      if (!downloadTarget) {
        if (!client || !workspaceRoot) {
          throw new Error(i18n.t("downloads.hostUnavailable"));
        }
        await downloadViaSessionStream({ id, client, workspaceRoot, path, fileName });
        return;
      }

      await downloadViaHttpEndpoint({
        id,
        fileName,
        path,
        downloadTarget,
        requestFileDownloadToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : i18n.t("downloads.failed");
      if (isWeb) {
        console.warn("[DownloadStore] Download failed:", message);
        get().failDownload(id, message);
        return;
      }
      get().failDownload(id, message);
    }
  },

  updateProgress: (id, progress) => {
    set((state) => {
      const download = state.downloads.get(id);
      if (!download || download.status !== "downloading") {
        return state;
      }
      const updated = new Map(state.downloads);
      updated.set(id, { ...download, progress });
      return { downloads: updated };
    });
  },

  completeDownload: (id, extras) => {
    set((state) => {
      const download = state.downloads.get(id);
      if (!download) {
        return state;
      }
      const updated = new Map(state.downloads);
      updated.set(id, {
        ...download,
        status: "complete",
        localUri: extras?.localUri ?? null,
        mimeType: extras?.mimeType ?? download.mimeType ?? null,
      });
      return { downloads: updated };
    });
  },

  failDownload: (id, message) => {
    set((state) => {
      const download = state.downloads.get(id);
      if (!download) {
        return state;
      }
      const updated = new Map(state.downloads);
      updated.set(id, { ...download, status: "error", message });
      return { downloads: updated };
    });
  },

  dismissDownload: (id) => {
    const dismissed = get().downloads.get(id);
    if (dismissed) {
      deleteLocalCacheCopy(dismissed);
    }
    set((state) => {
      const updated = new Map(state.downloads);
      updated.delete(id);
      const newActiveId =
        state.activeDownloadId === id ? findMostRecentDownloadId(updated) : state.activeDownloadId;
      return { downloads: updated, activeDownloadId: newActiveId };
    });
  },

  dismissAllCompleted: () => {
    for (const download of get().downloads.values()) {
      if (download.status !== "downloading") {
        deleteLocalCacheCopy(download);
      }
    }
    set((state) => {
      const updated = new Map(state.downloads);
      for (const [id, download] of updated) {
        if (download.status !== "downloading") {
          updated.delete(id);
        }
      }
      let newActiveId: string | null;
      if (!state.activeDownloadId) newActiveId = null;
      else if (updated.has(state.activeDownloadId)) newActiveId = state.activeDownloadId;
      else newActiveId = findMostRecentDownloadId(updated);
      return { downloads: updated, activeDownloadId: newActiveId };
    });
  },

  openDownload: async (id) => {
    const download = get().downloads.get(id);
    if (!download?.localUri) {
      return;
    }
    try {
      await openLocalFileInViewer(download.localUri, download.mimeType ?? null);
      get().setDownloadActionMessage(id, null);
    } catch {
      get().setDownloadActionMessage(id, i18n.t("downloads.openFailed"));
    }
  },

  saveDownload: async (id) => {
    const download = get().downloads.get(id);
    if (!download?.localUri) {
      return;
    }
    try {
      const saved = await saveToAndroidDirectory({
        uri: download.localUri,
        mimeType: download.mimeType ?? null,
        fileName: download.fileName,
      });
      get().setDownloadActionMessage(
        id,
        saved ? i18n.t("downloads.savedToDirectory") : i18n.t("downloads.saveCancelled"),
      );
    } catch {
      get().setDownloadActionMessage(id, i18n.t("downloads.saveFailed"));
    }
  },

  setDownloadActionMessage: (id, message) => {
    set((state) => {
      const download = state.downloads.get(id);
      if (!download) {
        return state;
      }
      const updated = new Map(state.downloads);
      updated.set(id, { ...download, actionMessage: message ?? null });
      return { downloads: updated };
    });
  },
}));

function findMostRecentDownloadId(downloads: Map<string, Download>): string | null {
  let mostRecent: Download | null = null;
  for (const download of downloads.values()) {
    if (!mostRecent || download.startedAt > mostRecent.startedAt) {
      mostRecent = download;
    }
  }
  return mostRecent?.id ?? null;
}

function computeDownloadProgress(
  downloadStartTime: number,
  totalBytesWritten: number,
  totalBytesExpectedToWrite: number,
): DownloadProgress | null {
  if (totalBytesExpectedToWrite <= 0) {
    return null;
  }

  const now = Date.now();
  const percent = totalBytesWritten / totalBytesExpectedToWrite;
  const elapsed = (now - downloadStartTime) / 1000;
  const speed = elapsed > 0 ? totalBytesWritten / elapsed : 0;
  const remaining = totalBytesExpectedToWrite - totalBytesWritten;
  const eta = speed > 0 ? remaining / speed : 0;

  return {
    percent,
    bytesWritten: totalBytesWritten,
    totalBytes: totalBytesExpectedToWrite,
    speed,
    eta,
  };
}

interface SessionDownloadOutcome {
  /** Local file URI on native; null on web where the browser handles delivery. */
  uri: string | null;
  mimeType: string | null;
}

/**
 * Streams a workspace file over the session WebSocket via DaemonClient.streamFile.
 * Native appends each chunk to a cache file through a FileHandle; web buffers the
 * chunks and hands a Blob to the browser. Used when the host has no direct HTTP
 * connection (e.g. relay-only), where the token+HTTP endpoint is unreachable.
 */
async function streamFileDownload(params: {
  client: DaemonClient;
  workspaceRoot: string;
  path: string;
  fileName: string;
  onProgress: (totalBytesWritten: number, totalBytesExpectedToWrite: number) => void;
}): Promise<SessionDownloadOutcome> {
  const { client, workspaceRoot, path, fileName, onProgress } = params;
  let totalBytes = 0;

  if (isWeb) {
    const chunks: BlobPart[] = [];
    const result = await client.streamFile(workspaceRoot, path, {
      onBegin: (metadata) => {
        totalBytes = metadata.size;
      },
      onChunk: (chunk, receivedBytes) => {
        chunks.push(chunk.slice());
        onProgress(receivedBytes, totalBytes);
      },
    });
    const blob = new Blob(chunks, { type: result.mime });
    const url = URL.createObjectURL(blob);
    triggerBrowserDownload(url, fileName);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { uri: null, mimeType: result.mime };
  }

  const targetFile = resolveDownloadTargetFile(fileName);
  // Boxed so control flow keeps the FileHandle across callback assignments.
  const streamState: { handle: ReturnType<FSFile["open"]> | null } = { handle: null };
  try {
    const result = await client.streamFile(workspaceRoot, path, {
      onBegin: (metadata) => {
        totalBytes = metadata.size;
        targetFile.create();
        streamState.handle = targetFile.open();
      },
      onChunk: (chunk, receivedBytes) => {
        streamState.handle?.writeBytes(chunk);
        onProgress(receivedBytes, totalBytes);
      },
    });
    return { uri: targetFile.uri, mimeType: result.mime };
  } catch (error) {
    try {
      if (targetFile.exists) {
        targetFile.delete();
      }
    } catch {
      // best-effort cleanup of the partial download
    }
    throw error;
  } finally {
    streamState.handle?.close();
  }
}

async function shareDownloadedFile(params: {
  uri: string;
  mimeType: string | null;
  fileName: string;
}): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    return;
  }
  await Sharing.shareAsync(params.uri, {
    mimeType: params.mimeType ?? undefined,
    dialogTitle: params.fileName
      ? i18n.t("downloads.shareFileNamed", { fileName: params.fileName })
      : i18n.t("downloads.shareFile"),
  });
}

/**
 * Android's share sheet only lists forward targets (WeChat, QQ, …) with no
 * "save to device" — useless for downloads. Save into a user-picked directory
 * through SAF instead. The picker starts at Download; once granted, the tree
 * URI is cached for the app session so later downloads save without asking.
 * Expo SAF cannot persist URI permissions across cold starts, so each launch
 * reprompts once.
 */
const ANDROID_SAF_INITIAL_URI =
  "content://com.android.externalstorage.documents/document/primary%3ADownload";
let androidSafDirectoryUri: string | null = null;

/**
 * Returns false when the user cancels the directory picker — the file then
 * stays in app cache and no copy landed in shared storage.
 */
async function saveToAndroidDirectory(params: {
  uri: string;
  mimeType: string | null;
  fileName: string;
}): Promise<boolean> {
  const SAF = LegacyFileSystem.StorageAccessFramework;
  if (!androidSafDirectoryUri) {
    const permission = await SAF.requestDirectoryPermissionsAsync(ANDROID_SAF_INITIAL_URI);
    if (!permission.granted) {
      return false; // user cancelled — the file stays in app cache
    }
    androidSafDirectoryUri = permission.directoryUri;
  }
  const targetUri = await SAF.createFileAsync(
    androidSafDirectoryUri,
    params.fileName,
    params.mimeType ?? "application/octet-stream",
  );
  // expo-file-system has no append/streaming write for content:// URIs (base64
  // writeAsStringAsync OOMs on large files), so the copy runs natively.
  try {
    await copyLocalFileToSafDocument(params.uri, targetUri);
  } catch (error) {
    try {
      await SAF.deleteAsync(targetUri);
    } catch {
      // best-effort: drop the empty/truncated doc so it doesn't litter Download
    }
    throw error;
  }
  return true;
}

/** Best-effort cleanup once the toast is dismissed; the SAF copy stays. */
function deleteLocalCacheCopy(download: Download): void {
  if (Platform.OS !== "android" || !download.localUri) {
    return;
  }
  try {
    new FSFile(download.localUri).delete();
  } catch {
    // cache files are disposable — the OS will sweep leftovers
  }
}

async function downloadViaSessionStream(params: {
  id: string;
  client: DaemonClient;
  workspaceRoot: string;
  path: string;
  fileName: string;
}): Promise<void> {
  const { id, client, workspaceRoot, path, fileName } = params;
  const downloadStartTime = Date.now();
  const outcome = await streamFileDownload({
    client,
    workspaceRoot,
    path,
    fileName,
    onProgress: (totalBytesWritten, totalBytesExpectedToWrite) => {
      const progress = computeDownloadProgress(
        downloadStartTime,
        totalBytesWritten,
        totalBytesExpectedToWrite,
      );
      if (progress) {
        useDownloadStore.getState().updateProgress(id, progress);
      }
    },
  });

  useDownloadStore.getState().completeDownload(id, {
    localUri: outcome.uri,
    mimeType: outcome.mimeType,
  });

  // On iOS the share sheet doubles as open-in/save-as and fires right away; on
  // Android the toast offers open/save actions against the cached file instead.
  if (outcome.uri && Platform.OS !== "android") {
    await shareDownloadedFile({ uri: outcome.uri, mimeType: outcome.mimeType, fileName });
  }
}

async function downloadViaHttpEndpoint(params: {
  id: string;
  fileName: string;
  path: string;
  /** Caller has already resolved a direct TCP target. */
  downloadTarget: DownloadTarget;
  requestFileDownloadToken: (path: string) => Promise<{
    token: string | null;
    fileName: string | null;
    mimeType: string | null;
    error: string | null;
  }>;
}): Promise<void> {
  const { id, fileName, path, downloadTarget, requestFileDownloadToken } = params;

  const tokenResponse = await requestFileDownloadToken(path);
  if (tokenResponse.error || !tokenResponse.token) {
    throw new Error(tokenResponse.error ?? i18n.t("downloads.requestTokenFailed"));
  }

  const resolvedFileName = tokenResponse.fileName ?? fileName;
  const downloadUrl = buildDownloadUrl(
    downloadTarget.baseUrl,
    tokenResponse.token,
    isWeb ? downloadTarget.authCredentials : null,
  );

  if (isWeb) {
    triggerBrowserDownload(downloadUrl, resolvedFileName);
    useDownloadStore.getState().completeDownload(id);
    return;
  }

  const downloadStartTime = Date.now();
  const targetFile = resolveDownloadTargetFile(resolvedFileName);
  const downloadResumable = LegacyFileSystem.createDownloadResumable(
    downloadUrl,
    targetFile.uri,
    downloadTarget.authHeader
      ? { headers: { Authorization: downloadTarget.authHeader } }
      : undefined,
    (data) => {
      const progress = computeDownloadProgress(
        downloadStartTime,
        data.totalBytesWritten,
        data.totalBytesExpectedToWrite,
      );
      if (progress) {
        useDownloadStore.getState().updateProgress(id, progress);
      }
    },
  );

  const result = await downloadResumable.downloadAsync();
  if (!result) {
    throw new Error(i18n.t("downloads.cancelled"));
  }

  useDownloadStore.getState().completeDownload(id, {
    localUri: result.uri,
    mimeType: tokenResponse.mimeType,
  });
  if (Platform.OS !== "android") {
    await shareDownloadedFile({
      uri: result.uri,
      mimeType: tokenResponse.mimeType,
      fileName: resolvedFileName,
    });
  }
}

interface DownloadTarget {
  baseUrl: string;
  authHeader: string | null;
  authCredentials: { username: string; password: string } | null;
}

/** Returns null when the host has no direct TCP connection (e.g. relay-only). */
function resolveDaemonDownloadTarget(daemon?: HostProfile): DownloadTarget | null {
  const connection = daemon?.connections.find((conn) => conn.type === "directTcp") ?? null;
  if (!connection) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(
      buildDaemonWebSocketUrl(connection.endpoint, { useTls: connection.useTls ?? false }),
    );
  } catch {
    return null;
  }

  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }

  let authCredentials: { username: string; password: string } | null = null;
  if (parsed.username || parsed.password) {
    authCredentials = {
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
    parsed.username = "";
    parsed.password = "";
  }

  parsed.pathname = parsed.pathname.replace(/\/ws\/?$/, "/");

  const baseUrl = parsed.origin;
  const authHeader = authCredentials
    ? `Basic ${btoa(`${authCredentials.username}:${authCredentials.password}`)}`
    : null;

  return { baseUrl, authHeader, authCredentials };
}

function buildDownloadUrl(
  baseUrl: string,
  token: string,
  authCredentials: { username: string; password: string } | null,
): string {
  const url = new URL("/api/files/download", baseUrl);
  url.searchParams.set("token", token);
  if (authCredentials) {
    url.username = authCredentials.username;
    url.password = authCredentials.password;
  }
  return url.toString();
}

function triggerBrowserDownload(url: string, fileName: string) {
  if (typeof document === "undefined") {
    if (typeof window !== "undefined") {
      void openExternalUrl(url);
    }
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function resolveDownloadTargetFile(fileName: string): FSFile {
  const directory = Paths.cache ?? Paths.document;
  if (!directory) {
    throw new Error("No download directory available.");
  }

  const safeName = sanitizeDownloadFileName(fileName);
  const split = splitFileName(safeName);
  let targetFile = new FSFile(directory, safeName);
  let suffix = 1;

  while (targetFile.exists) {
    targetFile = new FSFile(directory, `${split.base} (${suffix})${split.ext}`);
    suffix += 1;
  }

  return targetFile;
}

function sanitizeDownloadFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "download";
  }
  return trimmed.replace(/[\\/:*?"<>|]+/g, "_");
}

function splitFileName(fileName: string): { base: string; ext: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return { base: fileName, ext: "" };
  }
  return {
    base: fileName.slice(0, lastDot),
    ext: fileName.slice(lastDot),
  };
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${Math.round(bytesPerSecond)} B/s`;
  }
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatEta(seconds: number): string {
  if (seconds < 1) {
    return "< 1s";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}
