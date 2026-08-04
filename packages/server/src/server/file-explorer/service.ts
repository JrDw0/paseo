import { constants, promises as fs, type BigIntStats } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { expandUserPath, resolvePathFromBase } from "../path-utils.js";

export type ExplorerEntryKind = "file" | "directory";
export type ExplorerFileKind = "text" | "image" | "binary";
export type ExplorerEncoding = "utf-8" | "base64" | "none";

export interface ListDirectoryParams {
  root: string;
  relativePath?: string;
}

export interface ReadFileParams {
  root: string;
  relativePath: string;
  // Preview cap: files larger than this return only their leading maxBytes
  // bytes marked truncated, classified from that prefix. Unset means read and
  // classify the whole file (downloads rely on this).
  maxBytes?: number;
}

export interface WriteFileParams extends ReadFileParams {
  content: string;
  expectedModifiedAt: string;
  expectedRevision?: string;
}

export type ExplorerFileVersion =
  | {
      status: "ready";
      cwd: string;
      path: string;
      size: number;
      modifiedAt: string;
      revision: string;
    }
  | { status: "missing"; cwd: string; path: string }
  | { status: "error"; cwd: string; path: string; error: string };

export type ExplorerFileWriteResult =
  | { status: "written"; modifiedAt: string; size: number; revision: string }
  | { status: "conflict"; version: ExplorerFileVersion }
  | { status: "error"; error: string };

export interface FileExplorerEntry {
  name: string;
  path: string;
  kind: ExplorerEntryKind;
  size: number;
  modifiedAt: string;
}

export interface FileExplorerDirectory {
  path: string;
  entries: FileExplorerEntry[];
}

export interface FileExplorerFile {
  path: string;
  kind: ExplorerFileKind;
  encoding: ExplorerEncoding;
  content?: string;
  mimeType?: string;
  size: number;
  modifiedAt: string;
  revision: string;
  truncated: boolean;
}

export interface FileExplorerFileBytes {
  path: string;
  kind: ExplorerFileKind;
  encoding: "utf-8" | "binary";
  bytes: Uint8Array;
  mimeType: string;
  size: number;
  modifiedAt: string;
  revision: string;
  truncated: boolean;
}

export interface FileExplorerFileStream {
  path: string;
  kind: ExplorerFileKind;
  encoding: "utf-8" | "binary";
  mimeType: string;
  size: number;
  modifiedAt: string;
  revision: string;
  truncated: boolean;
  chunks: AsyncIterable<Uint8Array>;
}

const TEXT_MIME_TYPES: Record<string, string> = {
  ".json": "application/json",
};

const DEFAULT_TEXT_MIME_TYPE = "text/plain";
const FILE_TYPE_SAMPLE_BYTES = 8192;
// Only files above this size get the pre-read sniff; reading anything smaller
// whole is already fast, so the sniff would only double-read its first bytes.
const BINARY_SNIFF_MIN_BYTES = 1024 * 1024;
export const FILE_EXPLORER_STREAM_CHUNK_BYTES = 256 * 1024;
export const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;
const READ_FILE_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
const ACCESS_OUTSIDE_WORKSPACE_MESSAGE = "Access outside of workspace is not allowed";

function fileRevision(stats: BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
}

function matchesExpectedRevision(
  stats: BigIntStats,
  expectedModifiedAt: string,
  expectedRevision?: string,
): boolean {
  return expectedRevision
    ? fileRevision(stats) === expectedRevision
    : stats.mtime.toISOString() === expectedModifiedAt;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

interface ScopedPathParams {
  root: string;
  relativePath?: string;
}

interface ScopedPath {
  requestedPath: string;
  resolvedPath: string;
}

interface EntryPayloadParams {
  root: string;
  targetPath: string;
  name: string;
  kind: ExplorerEntryKind;
}

export async function listDirectoryEntries({
  root,
  relativePath = ".",
}: ListDirectoryParams): Promise<FileExplorerDirectory> {
  const directoryPath = await resolveScopedPath({ root, relativePath });
  const stats = await fs.stat(directoryPath.resolvedPath);

  if (!stats.isDirectory()) {
    throw new Error("Requested path is not a directory");
  }

  const dirents = await fs.readdir(directoryPath.resolvedPath, { withFileTypes: true });

  const entriesWithNulls = await Promise.all(
    dirents.map(async (dirent) => {
      const targetPath = path.join(directoryPath.requestedPath, dirent.name);
      const kind: ExplorerEntryKind = dirent.isDirectory() ? "directory" : "file";
      try {
        return await buildEntryPayload({
          root,
          targetPath,
          name: dirent.name,
          kind,
        });
      } catch (error) {
        // Directories can contain dangling links (e.g. AGENTS.md -> CLAUDE.md).
        // Skip entries whose targets disappeared instead of failing the whole listing.
        if (isMissingEntryError(error) || isOutsideWorkspaceError(error)) {
          return null;
        }
        throw error;
      }
    }),
  );
  const entries = entriesWithNulls.filter((entry): entry is FileExplorerEntry => entry !== null);

  entries.sort((a, b) => {
    const modifiedComparison = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
    if (modifiedComparison !== 0) {
      return modifiedComparison;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    path: normalizeRelativePath({ root, targetPath: directoryPath.requestedPath }),
    entries,
  };
}

export async function readExplorerFile({
  root,
  relativePath,
  maxBytes,
}: ReadFileParams): Promise<FileExplorerFile> {
  const file = await readExplorerFileBytes({ root, relativePath, maxBytes });

  if (file.kind === "image") {
    return {
      path: file.path,
      kind: file.kind,
      encoding: "base64",
      content: Buffer.from(file.bytes).toString("base64"),
      mimeType: file.mimeType,
      size: file.size,
      modifiedAt: file.modifiedAt,
      revision: file.revision,
      truncated: file.truncated,
    };
  }

  if (file.kind === "binary") {
    return {
      path: file.path,
      kind: file.kind,
      encoding: "none",
      mimeType: file.mimeType,
      size: file.size,
      modifiedAt: file.modifiedAt,
      revision: file.revision,
      truncated: file.truncated,
    };
  }

  return {
    path: file.path,
    kind: file.kind,
    encoding: "utf-8",
    content: Buffer.from(file.bytes).toString("utf-8"),
    mimeType: file.mimeType,
    size: file.size,
    modifiedAt: file.modifiedAt,
    revision: file.revision,
    truncated: file.truncated,
  };
}

export async function readExplorerFileBytes({
  root,
  relativePath,
  maxBytes,
}: ReadFileParams): Promise<FileExplorerFileBytes> {
  const filePath = await resolveScopedPath({ root, relativePath });
  const handle = await openFileForRead(filePath.resolvedPath);

  try {
    const stats = await handle.stat({ bigint: true });

    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const ext = path.extname(filePath.resolvedPath).toLowerCase();
    const isImage = ext in IMAGE_MIME_TYPES;
    const basePayload = {
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      size: Number(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      revision: fileRevision(stats),
    };

    // Preview cap: the caller only wants the leading maxBytes. Reading (and
    // scanning) anything beyond that stalls the daemon for seconds on a
    // multi-hundred-MB log, which freezes every client waiting on it — so the
    // prefix alone decides the kind. (Images are excluded: a truncated image
    // cannot render, so they keep the full-read path below.)
    if (!isImage && maxBytes !== undefined && stats.size > maxBytes) {
      const buffer = Buffer.allocUnsafe(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      const prefix = buffer.subarray(0, bytesRead);
      if (prefix.includes(0) || !isValidUtf8Prefix(prefix)) {
        return {
          ...basePayload,
          kind: "binary",
          encoding: "binary",
          bytes: Buffer.alloc(0),
          mimeType: "application/octet-stream",
          truncated: true,
        };
      }
      return {
        ...basePayload,
        kind: "text",
        encoding: "utf-8",
        bytes: prefix,
        mimeType: textMimeTypeForExtension(ext),
        truncated: true,
      };
    }

    // Sniff the leading bytes before reading a large file. A big binary (e.g.
    // an .apk the user tapped by accident) must fail fast here — the eager
    // readFile() + byte-by-byte scan below stalls the daemon for seconds,
    // which freezes every client waiting on that daemon.
    //
    // The sniff only looks for null bytes: they are the one binary signal that
    // stays unambiguous in a partial sample. The control-byte ratio in
    // isLikelyBinary is calibrated for whole buffers, and sampling it would
    // misclassify control-dense text headers (ANSI-colored logs) as binary.
    // Everything else falls through to the full-buffer checks below, so
    // classification stays identical to scanning the whole file up front.
    //
    // Files below BINARY_SNIFF_MIN_BYTES skip the sniff: readFile() on them is
    // already fast, and sniffing would just read their first bytes twice.
    if (!isImage && stats.size > BINARY_SNIFF_MIN_BYTES) {
      const sampleLength = Math.min(FILE_TYPE_SAMPLE_BYTES, Number(stats.size));
      const sample = Buffer.allocUnsafe(sampleLength);
      const { bytesRead } = await handle.read(sample, 0, sampleLength, 0);
      if (sample.subarray(0, bytesRead).includes(0)) {
        return {
          ...basePayload,
          kind: "binary",
          encoding: "binary",
          bytes: Buffer.alloc(0),
          mimeType: "application/octet-stream",
          truncated: false,
        };
      }
    }

    const buffer = await handle.readFile();
    if (isImage) {
      return {
        ...basePayload,
        kind: "image",
        encoding: "binary",
        bytes: buffer,
        mimeType: IMAGE_MIME_TYPES[ext],
        truncated: false,
      };
    }

    if (isLikelyBinary(buffer) || !isValidUtf8(buffer)) {
      return {
        ...basePayload,
        kind: "binary",
        encoding: "binary",
        bytes: buffer,
        mimeType: "application/octet-stream",
        truncated: false,
      };
    }

    return {
      ...basePayload,
      kind: "text",
      encoding: "utf-8",
      bytes: buffer,
      mimeType: textMimeTypeForExtension(ext),
      truncated: false,
    };
  } finally {
    await handle.close();
  }
}

export async function streamExplorerFile(
  { root, relativePath, maxBytes }: ReadFileParams,
  consume: (file: FileExplorerFileStream) => Promise<void>,
): Promise<void> {
  const filePath = await resolveScopedPath({ root, relativePath });
  const handle = await openFileForRead(filePath.resolvedPath);

  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const advertisedSize = Number(stats.size);
    const advertisedRevision = fileRevision(stats);
    const ext = path.extname(filePath.resolvedPath).toLowerCase();
    const isImage = ext in IMAGE_MIME_TYPES;

    // Preview cap: classify from and stream only the leading maxBytes. The
    // full-file classification scan (isFileHandleBinary) used on the download
    // path stalls the daemon for seconds on a multi-hundred-MB file before a
    // single chunk goes out, which freezes every client waiting on the daemon.
    if (!isImage && maxBytes !== undefined && advertisedSize > maxBytes) {
      const isBinary = await isPreviewPrefixBinary(handle, maxBytes);
      await consume({
        path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
        kind: isBinary ? "binary" : "text",
        encoding: isBinary ? "binary" : "utf-8",
        mimeType: isBinary ? "application/octet-stream" : textMimeTypeForExtension(ext),
        size: advertisedSize,
        modifiedAt: stats.mtime.toISOString(),
        revision: advertisedRevision,
        truncated: true,
        chunks: isBinary
          ? emptyFileChunks()
          : readFileHandleChunks(handle, maxBytes, advertisedRevision),
      });
      return;
    }

    const isBinary = isImage || (await isFileHandleBinary(handle, advertisedSize));
    let kind: ExplorerFileKind = "text";
    let mimeType = textMimeTypeForExtension(ext);
    if (isImage) {
      kind = "image";
      mimeType = IMAGE_MIME_TYPES[ext];
    } else if (isBinary) {
      kind = "binary";
      mimeType = "application/octet-stream";
    }

    await consume({
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      kind,
      encoding: isBinary ? "binary" : "utf-8",
      mimeType,
      size: advertisedSize,
      modifiedAt: stats.mtime.toISOString(),
      revision: advertisedRevision,
      truncated: false,
      chunks: readFileHandleChunks(handle, advertisedSize, advertisedRevision),
    });
  } finally {
    await handle.close();
  }
}

// Classification for the preview cap: same rules as readExplorerFileBytes, so
// a file previews identically whether it arrives over the binary channel (this
// path) or the JSON fallback.
async function isPreviewPrefixBinary(handle: FileHandle, maxBytes: number): Promise<boolean> {
  const buffer = Buffer.allocUnsafe(maxBytes);
  const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
  const prefix = buffer.subarray(0, bytesRead);
  return prefix.includes(0) || !isValidUtf8Prefix(prefix);
}

async function* emptyFileChunks(): AsyncIterable<Uint8Array> {
  // A truncated binary preview delivers no body, matching the JSON payload,
  // which carries no content for binary files.
}

async function isFileHandleBinary(handle: FileHandle, advertisedSize: number): Promise<boolean> {
  if (advertisedSize === 0) return false;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let position = 0;
  let suspiciousBytes = 0;
  while (position < advertisedSize) {
    const block = Buffer.allocUnsafe(
      Math.min(FILE_EXPLORER_STREAM_CHUNK_BYTES, advertisedSize - position),
    );
    const { bytesRead } = await handle.read(block, 0, block.byteLength, position);
    if (bytesRead === 0) {
      throw new Error("File changed during transfer");
    }
    const bytes = block.subarray(0, bytesRead);
    for (const byte of bytes) {
      if (byte === 0) return true;
      const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
      if (isControl || byte === 127) suspiciousBytes += 1;
    }
    try {
      decoder.decode(bytes, { stream: true });
    } catch {
      return true;
    }
    position += bytesRead;
  }

  try {
    decoder.decode();
  } catch {
    return true;
  }
  return suspiciousBytes / advertisedSize > 0.3;
}

async function* readFileHandleChunks(
  handle: FileHandle,
  advertisedSize: number,
  advertisedRevision: string,
): AsyncIterable<Uint8Array> {
  let position = 0;
  while (position < advertisedSize) {
    const chunk = Buffer.allocUnsafe(
      Math.min(FILE_EXPLORER_STREAM_CHUNK_BYTES, advertisedSize - position),
    );
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
    if (bytesRead === 0) {
      throw new Error("File changed during transfer");
    }
    position += bytesRead;
    yield chunk.subarray(0, bytesRead);
  }

  const finalStats = await handle.stat({ bigint: true });
  if (fileRevision(finalStats) !== advertisedRevision) {
    throw new Error("File changed during transfer");
  }
}

export async function getExplorerFileVersion({
  root,
  relativePath,
}: ReadFileParams): Promise<ExplorerFileVersion> {
  const cwd = expandUserPath(root);
  try {
    const filePath = await resolveScopedPath({ root, relativePath });
    const stats = await fs.stat(filePath.resolvedPath, { bigint: true });
    if (!stats.isFile()) {
      return { status: "error", cwd, path: relativePath, error: "Requested path is not a file" };
    }
    return {
      status: "ready",
      cwd,
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      size: Number(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      revision: fileRevision(stats),
    };
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { status: "missing", cwd, path: relativePath };
    }
    return {
      status: "error",
      cwd,
      path: relativePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resolveExplorerFilePath({
  root,
  relativePath,
}: ReadFileParams): Promise<string> {
  return (await resolveScopedPath({ root, relativePath })).resolvedPath;
}

export async function writeExplorerFile({
  root,
  relativePath,
  content,
  expectedModifiedAt,
  expectedRevision,
}: WriteFileParams): Promise<ExplorerFileWriteResult> {
  const encoded = Buffer.from(content, "utf8");
  if (encoded.byteLength > MAX_EDITABLE_FILE_BYTES) {
    return { status: "error", error: "File is too large to edit" };
  }

  let filePath: ScopedPath;
  let currentMode = 0o600;
  try {
    filePath = await resolveScopedPath({ root, relativePath });
    const handle = await openFileForRead(filePath.resolvedPath);
    try {
      const stats = await handle.stat({ bigint: true });
      if (!stats.isFile()) {
        return { status: "error", error: "Requested path is not a file" };
      }
      if (stats.size > BigInt(MAX_EDITABLE_FILE_BYTES)) {
        return { status: "error", error: "File is too large to edit" };
      }
      const current = await handle.readFile();
      if (isLikelyBinary(current) || !isValidUtf8(current)) {
        return { status: "error", error: "Binary files cannot be edited" };
      }
      currentMode = Number(stats.mode);
      const modifiedAt = stats.mtime.toISOString();
      if (!matchesExpectedRevision(stats, expectedModifiedAt, expectedRevision)) {
        return {
          status: "conflict",
          version: {
            status: "ready",
            cwd: expandUserPath(root),
            path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
            size: Number(stats.size),
            modifiedAt,
            revision: fileRevision(stats),
          },
        };
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissingEntryError(error)) {
      return {
        status: "conflict",
        version: { status: "missing", cwd: expandUserPath(root), path: relativePath },
      };
    }
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }

  const temporaryPath = path.join(
    path.dirname(filePath.resolvedPath),
    `.${path.basename(filePath.resolvedPath)}.paseo-${randomUUID()}.tmp`,
  );
  let temporaryHandle: FileHandle | null = null;
  try {
    temporaryHandle = await fs.open(temporaryPath, "wx", currentMode);
    if (process.platform !== "win32") {
      await temporaryHandle.chmod(currentMode & 0o7777);
    }
    await temporaryHandle.writeFile(encoded);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    const latestStats = await fs.stat(filePath.resolvedPath, { bigint: true });
    if (!matchesExpectedRevision(latestStats, expectedModifiedAt, expectedRevision)) {
      return {
        status: "conflict",
        version: {
          status: "ready",
          cwd: expandUserPath(root),
          path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
          size: Number(latestStats.size),
          modifiedAt: latestStats.mtime.toISOString(),
          revision: fileRevision(latestStats),
        },
      };
    }
    await fs.rename(temporaryPath, filePath.resolvedPath);
    const stats = await fs.stat(filePath.resolvedPath, { bigint: true });
    return {
      status: "written",
      modifiedAt: stats.mtime.toISOString(),
      size: Number(stats.size),
      revision: fileRevision(stats),
    };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    await temporaryHandle?.close().catch(() => undefined);
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function getDownloadableFileInfo({ root, relativePath }: ReadFileParams): Promise<{
  path: string;
  absolutePath: string;
  fileName: string;
  mimeType: string;
  size: number;
}> {
  const filePath = await resolveScopedPath({ root, relativePath });
  const handle = await openFileForRead(filePath.resolvedPath);

  try {
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const ext = path.extname(filePath.resolvedPath).toLowerCase();
    let mimeType = "application/octet-stream";
    if (ext in IMAGE_MIME_TYPES) {
      mimeType = IMAGE_MIME_TYPES[ext];
    } else {
      const sample = Buffer.alloc(FILE_TYPE_SAMPLE_BYTES);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      const chunk = bytesRead < sample.length ? sample.subarray(0, bytesRead) : sample;
      if (!isLikelyBinary(chunk)) {
        mimeType = textMimeTypeForExtension(ext);
      }
    }

    return {
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      absolutePath: filePath.resolvedPath,
      fileName: path.basename(filePath.requestedPath),
      mimeType,
      size: stats.size,
    };
  } finally {
    await handle.close();
  }
}

async function resolveScopedPath({
  root,
  relativePath = ".",
}: ScopedPathParams): Promise<ScopedPath> {
  const normalizedRoot = expandUserPath(root);
  const requestedPath = resolvePathFromBase(normalizedRoot, relativePath);
  const relative = path.relative(normalizedRoot, requestedPath);

  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
  }

  const realRoot = await fs.realpath(normalizedRoot);

  try {
    const realPath = await fs.realpath(requestedPath);
    const realRelative = path.relative(realRoot, realPath);
    if (realRelative !== "" && (realRelative.startsWith("..") || path.isAbsolute(realRelative))) {
      throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
    }
    return { requestedPath, resolvedPath: realPath };
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { requestedPath, resolvedPath: requestedPath };
    }
    throw error;
  }
}

async function openFileForRead(filePath: string): Promise<FileHandle> {
  return fs.open(filePath, READ_FILE_OPEN_FLAGS);
}

async function buildEntryPayload({
  root,
  targetPath,
  name,
  kind,
}: EntryPayloadParams): Promise<FileExplorerEntry> {
  const entryPath = await resolveScopedPath({
    root,
    relativePath: normalizeRelativePath({ root, targetPath }),
  });
  const stats = await fs.stat(entryPath.resolvedPath);
  return {
    name,
    path: normalizeRelativePath({ root, targetPath }),
    kind,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

function isMissingEntryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

function isOutsideWorkspaceError(error: unknown): boolean {
  return error instanceof Error && error.message === ACCESS_OUTSIDE_WORKSPACE_MESSAGE;
}

function normalizeRelativePath({ root, targetPath }: { root: string; targetPath: string }): string {
  const normalizedRoot = expandUserPath(root);
  const normalizedTarget = expandUserPath(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

function textMimeTypeForExtension(ext: string): string {
  return TEXT_MIME_TYPES[ext] ?? DEFAULT_TEXT_MIME_TYPE;
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  let suspicious = 0;
  for (let idx = 0; idx < buffer.length; idx += 1) {
    const byte = buffer[idx];
    if (byte === 0) {
      return true;
    }

    const isControl =
      byte < 32 &&
      byte !== 9 && // tab
      byte !== 10 && // newline
      byte !== 13; // carriage return

    if (isControl || byte === 127) {
      suspicious += 1;
    }
  }

  return suspicious / buffer.length > 0.3;
}

function isValidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

// A preview cap can slice a multi-byte UTF-8 character at the boundary, which
// would read as invalid encoding and misclassify the file as binary. UTF-8
// sequences are at most 4 bytes, so at most 3 dangling tail bytes can be
// incomplete — validate excluding them.
function isValidUtf8Prefix(bytes: Uint8Array): boolean {
  const end = Math.max(0, bytes.length - 3);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}
