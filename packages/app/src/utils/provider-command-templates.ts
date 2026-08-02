export type ProviderCommandId = "resume";

/**
 * Declarative command templates for provider-native CLIs.
 *
 * Note: these are NOT Paseo agent IDs. They take provider-native session IDs.
 * Example placeholders:
 * - {sessionId}
 */
export const PROVIDER_COMMAND_TEMPLATES: Record<
  string,
  Partial<Record<ProviderCommandId, string>>
> = {
  codex: {
    resume: "codex resume {sessionId}",
  },
  claude: {
    resume: "claude --resume {sessionId}",
  },
  pi: {
    resume: "pi --session {sessionId}",
  },
  omp: {
    resume: "omp --session {sessionId}",
  },
  opencode: {
    resume: "opencode --session {sessionId}",
  },
};

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? "");
}

export function buildProviderCommand(input: {
  provider: string;
  id: ProviderCommandId;
  sessionId: string;
}): string | null {
  const template = PROVIDER_COMMAND_TEMPLATES[input.provider]?.[input.id] ?? null;
  if (!template) {
    return null;
  }
  return renderTemplate(template, { sessionId: input.sessionId });
}

function shellQuotePath(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

/**
 * Build a ready-to-paste shell command that resumes a provider session from
 * the directory the agent started in, so the resumed agent lands in the same
 * checkout. Falls back to the bare resume command when no working directory
 * is known, or returns null when the provider has no resume template.
 */
export function buildProviderResumeCommand(input: {
  provider: string;
  sessionId: string;
  /** The directory the agent was launched in. If absent, no `cd` is prepended. */
  cwd?: string | null;
  /** Windows shells need `cd /d`; POSIX shells (incl. Git Bash/WSL on Windows) take plain `cd`. */
  isWindows?: boolean;
}): string | null {
  const command = buildProviderCommand({
    provider: input.provider,
    id: "resume",
    sessionId: input.sessionId,
  });
  if (!command) {
    return null;
  }
  const cwd = input.cwd;
  if (!cwd) {
    return command;
  }
  const cd = input.isWindows ? `cd /d ${cwd} &&` : `cd ${shellQuotePath(cwd)} &&`;
  return `${cd} ${command}`;
}
