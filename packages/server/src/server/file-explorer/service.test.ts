import { appendFile, chmod, mkdtemp, rm, stat, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getExplorerFileVersion,
  readExplorerFile,
  readExplorerFileBytes,
  streamExplorerFile,
  writeExplorerFile,
} from "./service.js";

async function createHomeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.homedir(), prefix));
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("file explorer service", () => {
  it("atomically writes an existing text file at the expected revision", async () => {
    const root = await createTempDir("paseo-file-write-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "before", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "after",
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: current.revision,
      });

      expect(result.status).toBe("written");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("after");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves the original file permissions across atomic replacement",
    async () => {
      const root = await createTempDir("paseo-file-mode-");
      try {
        const filePath = path.join(root, "script.sh");
        await writeFile(filePath, "before", "utf8");
        await chmod(filePath, 0o764);
        const current = await getExplorerFileVersion({ root, relativePath: "script.sh" });
        expect(current.status).toBe("ready");
        if (current.status !== "ready") return;

        const result = await writeExplorerFile({
          root,
          relativePath: "script.sh",
          content: "after",
          expectedModifiedAt: current.modifiedAt,
          expectedRevision: current.revision,
        });

        expect(result.status).toBe("written");
        expect((await stat(filePath)).mode & 0o7777).toBe(0o764);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("preserves a newer disk revision instead of overwriting it", async () => {
    const root = await createTempDir("paseo-file-conflict-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "newer on disk", "utf8");

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "stale local edit",
        expectedModifiedAt: "2020-01-01T00:00:00.000Z",
      });

      expect(result).toMatchObject({ status: "conflict", version: { status: "ready" } });
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe(
        "newer on disk",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers the high-precision revision token over the display timestamp", async () => {
    const root = await createTempDir("paseo-file-revision-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "on disk", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "stale local edit",
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: `${current.revision}-stale`,
      });

      expect(result.status).toBe("conflict");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("on disk");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never creates a missing file through the write API", async () => {
    const root = await createTempDir("paseo-file-missing-");
    try {
      const result = await writeExplorerFile({
        root,
        relativePath: "missing.txt",
        content: "new file",
        expectedModifiedAt: "2020-01-01T00:00:00.000Z",
      });

      expect(result).toMatchObject({ status: "conflict", version: { status: "missing" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads .ex files as text", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "sample.ex");
      const content = "defmodule Sample do\nend\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "sample.ex",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads unknown extension text files as text", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "notes.customext");
      const content = "hello from a custom text file\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "notes.customext",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies files with null bytes as binary", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "blob.weird");
      await writeFile(filePath, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));

      const result = await readExplorerFile({
        root,
        relativePath: "blob.weird",
      });

      expect(result.kind).toBe("binary");
      expect(result.encoding).toBe("none");
      expect(result.content).toBeUndefined();
      expect(result.mimeType).toBe("application/octet-stream");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a large sampled binary file without reading its full contents", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "payload.bin");
      // Null byte inside the 8KB sniff window, in a file above the sniff size
      // gate: a regression that falls back to reading the whole file is
      // observable through the returned bytes.
      const content = Buffer.alloc(1024 * 1024 + 4096, 0x61);
      content[0] = 0x00;
      await writeFile(filePath, content);

      const result = await readExplorerFileBytes({ root, relativePath: "payload.bin" });

      expect(result.kind).toBe("binary");
      expect(result.bytes.length).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not misclassify a large text file with a control-dense header as binary", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "colored.log");
      // The first 8KB is pure ESC bytes (0x1b — a control byte, as in an
      // ANSI-colored log banner): 100% of the sniff window, far above the 30%
      // binary ratio. The body is plain text, so the whole-file ratio is far
      // below it and the file must preview as text.
      const content = Buffer.alloc(1024 * 1024 + 8192, 0x61);
      content.fill(0x1b, 0, 8192);
      await writeFile(filePath, content);

      const result = await readExplorerFile({ root, relativePath: "colored.log" });

      expect(result.kind).toBe("text");
      expect(result.content).toBe(content.toString("utf-8"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies a small binary below the sniff gate via the full-buffer path", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "small.bin");
      // Below the sniff gate the sniff is skipped entirely, so binary bytes
      // stay populated exactly as the pre-sniff behavior returned them.
      const content = Buffer.alloc(8192 * 4, 0x61);
      content[0] = 0x00;
      await writeFile(filePath, content);

      const result = await readExplorerFileBytes({ root, relativePath: "small.bin" });

      expect(result.kind).toBe("binary");
      expect(result.bytes.length).toBe(content.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns only the leading maxBytes for a large text file, marked truncated", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "huge.log");
      const maxBytes = 64 * 1024;
      const content = Buffer.alloc(300 * 1024, 0x61);
      await writeFile(filePath, content);

      const result = await readExplorerFileBytes({ root, relativePath: "huge.log", maxBytes });

      expect(result.kind).toBe("text");
      expect(result.truncated).toBe(true);
      expect(result.size).toBe(content.length);
      expect(result.bytes.length).toBe(maxBytes);
      expect(Buffer.from(result.bytes).equals(content.subarray(0, maxBytes))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns no body for a large binary above maxBytes, marked truncated", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "huge.bin");
      const maxBytes = 64 * 1024;
      const content = Buffer.alloc(300 * 1024, 0x61);
      // Truncated previews classify from the served prefix only — real
      // binaries (zip/apk/ELF/images) carry a null in their header, which is
      // what puts them inside this window.
      content[32 * 1024] = 0x00;
      await writeFile(filePath, content);

      const result = await readExplorerFileBytes({ root, relativePath: "huge.bin", maxBytes });

      expect(result.kind).toBe("binary");
      expect(result.truncated).toBe(true);
      expect(result.bytes.length).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a file within maxBytes complete and untruncated", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "small.log");
      const content = "a full small file\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFileBytes({
        root,
        relativePath: "small.log",
        maxBytes: 1024 * 1024,
      });

      expect(result.kind).toBe("text");
      expect(result.truncated).toBe(false);
      expect(Buffer.from(result.bytes).toString("utf-8")).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats a multi-byte UTF-8 character cut at the maxBytes boundary as text", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "unicode.log");
      // "中" encodes to 3 bytes (e4 b8 ad); size the file so the cap lands
      // after its lead byte, then append more text past the cap.
      const maxBytes = 64 * 1024;
      const head = Buffer.alloc(maxBytes - 1, 0x61);
      const tail = Buffer.concat([Buffer.from("中文"), Buffer.alloc(64 * 1024, 0x62)]);
      await writeFile(filePath, Buffer.concat([head, tail]));

      const result = await readExplorerFileBytes({ root, relativePath: "unicode.log", maxBytes });

      expect(result.kind).toBe("text");
      expect(result.truncated).toBe(true);
      // The cap sliced the lead byte of "中"; the preview must trim back to a
      // complete character so decoding never yields U+FFFD.
      expect(result.bytes.length).toBe(maxBytes - 1);
      expect(new TextDecoder().decode(result.bytes)).not.toContain("�");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a non-UTF-8 latin1 text file as text instead of binary (full path)", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "latin1.log");
      // Alternating ASCII + high latin1 bytes (0xe9): no nulls, no control
      // bytes, but not valid UTF-8. The pre-fix whole-file `!isValidUtf8`
      // check misclassified these as binary.
      const content = Buffer.alloc(512);
      for (let i = 0; i < content.length; i += 1) {
        content[i] = i % 2 === 0 ? 0x61 : 0xe9;
      }
      await writeFile(filePath, content);

      const result = await readExplorerFileBytes({ root, relativePath: "latin1.log" });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("latin1");
      expect(result.truncated).toBe(false);
      expect(result.bytes.length).toBe(content.length);
      // latin1 decode round-trips the exact bytes, not replacement chars.
      expect(new TextDecoder("latin1").decode(result.bytes)).not.toContain("�");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("previews a >cap non-UTF-8 latin1 log as text, not binary", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "big-latin1.log");
      const maxBytes = 64 * 1024;
      const content = Buffer.alloc(maxBytes * 3);
      for (let i = 0; i < content.length; i += 1) {
        content[i] = i % 2 === 0 ? 0x61 : 0xe9;
      }
      await writeFile(filePath, content);

      const result = await readExplorerFileBytes({
        root,
        relativePath: "big-latin1.log",
        maxBytes,
      });

      expect(result.kind).toBe("text");
      expect(result.truncated).toBe(true);
      expect(result.encoding).toBe("latin1");
      // latin1 has no multi-byte structure, so the full cap is served untrimmed.
      expect(result.bytes.length).toBe(maxBytes);
      expect(new TextDecoder("latin1").decode(result.bytes)).not.toContain("�");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a >cap file with a null byte inside the served prefix as binary", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "huge-null.bin");
      const maxBytes = 64 * 1024;
      const content = Buffer.alloc(maxBytes * 3, 0x61);
      content[1024] = 0x00;
      await writeFile(filePath, content);

      const result = await readExplorerFileBytes({ root, relativePath: "huge-null.bin", maxBytes });

      expect(result.kind).toBe("binary");
      expect(result.truncated).toBe(true);
      expect(result.bytes.length).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the full maxBytes when a utf-8 preview ends on a character boundary", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "aligned.log");
      // "é" is two bytes; build a file whose cap slices exactly on a boundary.
      const maxBytes = 64 * 1024;
      const content = Buffer.alloc(maxBytes * 2);
      for (let i = 0; i < content.length; i += 2) {
        content[i] = 0xc3;
        content[i + 1] = 0xa9;
      }
      await writeFile(filePath, content);

      const result = await readExplorerFileBytes({ root, relativePath: "aligned.log", maxBytes });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.bytes.length).toBe(maxBytes);
      expect(new TextDecoder().decode(result.bytes)).not.toContain("�");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("streams only the maxBytes prefix for a large text file", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "huge.log");
      const maxBytes = 64 * 1024;
      const content = Buffer.alloc(300 * 1024, 0x61);
      await writeFile(filePath, content);

      await streamExplorerFile({ root, relativePath: "huge.log", maxBytes }, async (file) => {
        expect(file.kind).toBe("text");
        expect(file.truncated).toBe(true);
        expect(file.size).toBe(content.length);
        const chunks: Buffer[] = [];
        for await (const chunk of file.chunks) {
          chunks.push(Buffer.from(chunk));
        }
        const received = Buffer.concat(chunks);
        expect(received.length).toBe(maxBytes);
        expect(received.equals(content.subarray(0, maxBytes))).toBe(true);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("streams no body for a large binary above maxBytes", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const filePath = path.join(root, "huge.bin");
      const maxBytes = 64 * 1024;
      const content = Buffer.alloc(300 * 1024, 0x61);
      content[32 * 1024] = 0x00;
      await writeFile(filePath, content);

      await streamExplorerFile({ root, relativePath: "huge.bin", maxBytes }, async (file) => {
        expect(file.kind).toBe("binary");
        expect(file.truncated).toBe(true);
        let received = 0;
        for await (const chunk of file.chunks) {
          received += chunk.byteLength;
        }
        expect(received).toBe(0);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file grows after its revision is advertised", async () => {
    const root = await createTempDir("paseo-file-stream-growth-");

    try {
      const filePath = path.join(root, "growing.log");
      const initial = Buffer.alloc(300 * 1024, 0x61);
      await writeFile(filePath, initial);
      await expect(
        streamExplorerFile({ root, relativePath: "growing.log" }, async (file) => {
          await appendFile(filePath, Buffer.alloc(300 * 1024, 0x62));
          for await (const _chunk of file.chunks) {
            // Consume through the advertised prefix before validating the revision.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file shrinks below its advertised size", async () => {
    const root = await createTempDir("paseo-file-stream-truncate-");

    try {
      const filePath = path.join(root, "shrinking.log");
      await writeFile(filePath, Buffer.alloc(300 * 1024, 0x61));

      await expect(
        streamExplorerFile({ root, relativePath: "shrinking.log" }, async (file) => {
          await truncate(filePath, 100 * 1024);
          for await (const _chunk of file.chunks) {
            // Consume until the stream detects the premature EOF.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file is overwritten in place", async () => {
    const root = await createTempDir("paseo-file-stream-overwrite-");

    try {
      const filePath = path.join(root, "changing.log");
      const initial = Buffer.alloc(600 * 1024, 0x61);
      await writeFile(filePath, initial);

      await expect(
        streamExplorerFile({ root, relativePath: "changing.log" }, async (file) => {
          let chunkIndex = 0;
          for await (const _chunk of file.chunks) {
            chunkIndex += 1;
            if (chunkIndex === 1) {
              const replacement = Buffer.alloc(initial.byteLength, 0x62);
              await writeFile(filePath, replacement);
            }
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies sampled text when UTF-8 crosses the sample boundary", async () => {
    const root = await createTempDir("paseo-file-stream-utf8-");

    try {
      const content = Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from("€"), Buffer.from("z")]);
      await writeFile(path.join(root, "sample.txt"), content);
      let kind: string | undefined;
      let encoding: string | undefined;

      await streamExplorerFile({ root, relativePath: "sample.txt" }, async (file) => {
        kind = file.kind;
        encoding = file.encoding;
      });

      expect(kind).toBe("text");
      expect(encoding).toBe("utf-8");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects incomplete UTF-8 when the whole file was sampled", async () => {
    const root = await createTempDir("paseo-file-stream-invalid-utf8-");

    try {
      await writeFile(path.join(root, "invalid.txt"), Buffer.from([0x61, 0xe2, 0x82]));
      let kind: string | undefined;

      await streamExplorerFile({ root, relativePath: "invalid.txt" }, async (file) => {
        kind = file.kind;
      });

      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects binary bytes beyond the initial classification block", async () => {
    const root = await createTempDir("paseo-file-stream-late-binary-");

    try {
      const content = Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0xff])]);
      await writeFile(path.join(root, "late-binary.unknown"), content);
      let kind: string | undefined;

      await streamExplorerFile({ root, relativePath: "late-binary.unknown" }, async (file) => {
        kind = file.kind;
      });

      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("expands a ~ prefix in relative paths against the user home directory", async () => {
    const root = await createHomeTempDir(".paseo-file-explorer-home-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root,
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.content).toBe("hello from home\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows home to be the scoped root for tilde file previews", async () => {
    const root = await createHomeTempDir(".paseo-file-explorer-home-root-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home root\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root: "~",
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.path).toBe(path.relative(os.homedir(), filePath).split(path.sep).join("/"));
      expect(result.content).toBe("hello from home root\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ~-prefixed paths that resolve outside the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-file-explorer-outside-home-"));

    try {
      await expect(
        readExplorerFile({
          root,
          relativePath: "~/some/file.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
