import { describe, expect, test } from "vitest";

import {
  buildProviderCommand,
  buildProviderResumeCommand,
} from "@/utils/provider-command-templates";

describe("buildProviderCommand", () => {
  test("builds OpenCode resume commands from native session ids", () => {
    expect(
      buildProviderCommand({
        provider: "opencode",
        id: "resume",
        sessionId: "ses_abc123",
      }),
    ).toBe("opencode --session ses_abc123");
  });
});

describe("buildProviderResumeCommand", () => {
  test("prepends a cd to the resume command on POSIX shells", () => {
    expect(
      buildProviderResumeCommand({
        provider: "claude",
        sessionId: "ac7be308-d999-4cf6-94a9-162b06c6b6fd",
        cwd: "/Users/jrd/work/my-project",
      }),
    ).toBe(
      "cd '/Users/jrd/work/my-project' && claude --resume ac7be308-d999-4cf6-94a9-162b06c6b6fd",
    );
  });

  test("falls back to the bare resume command when no cwd is known", () => {
    expect(
      buildProviderResumeCommand({
        provider: "claude",
        sessionId: "ac7be308-d999-4cf6-94a9-162b06c6b6fd",
      }),
    ).toBe("claude --resume ac7be308-d999-4cf6-94a9-162b06c6b6fd");
  });

  test("uses cd /d on Windows", () => {
    expect(
      buildProviderResumeCommand({
        provider: "claude",
        sessionId: "ac7be308-d999-4cf6-94a9-162b06c6b6fd",
        cwd: "C:\\Users\\jrd\\work\\my-project",
        isWindows: true,
      }),
    ).toBe(
      "cd /d C:\\Users\\jrd\\work\\my-project && claude --resume ac7be308-d999-4cf6-94a9-162b06c6b6fd",
    );
  });

  test("single-quotes a POSIX path that contains whitespace", () => {
    expect(
      buildProviderResumeCommand({
        provider: "claude",
        sessionId: "ac7be308-d999-4cf6-94a9-162b06c6b6fd",
        cwd: "/Users/jrd/work/my project",
      }),
    ).toBe(
      "cd '/Users/jrd/work/my project' && claude --resume ac7be308-d999-4cf6-94a9-162b06c6b6fd",
    );
  });

  test("returns null for providers without a resume template", () => {
    expect(
      buildProviderResumeCommand({
        provider: "unknown-provider",
        sessionId: "ac7be308-d999-4cf6-94a9-162b06c6b6fd",
        cwd: "/Users/jrd/work/my-project",
      }),
    ).toBeNull();
  });
});
