import { closeOwnedProcessTree, ownedProcessSpawnOptions } from "../owned-process-tree";
import { settleProcessStreams } from "../process-streams";

/**
 * Runs `claude -p --output-format stream-json --verbose` against a project dir,
 * piping the built prompt to stdin and parsing newline-delimited JSON on stdout.
 *
 * Claude Code 1.x stream-json schema (observed):
 *   {"type":"system","subtype":"init",...}
 *   {"type":"assistant","message":{"content":[{type:"text"|"thinking"|"tool_use",...}]}}
 *   {"type":"user","message":{"content":[{type:"tool_result",tool_use_id,content,is_error}]}}
 *   {"type":"result","subtype":"success","usage":{...}}
 */

export interface RunnerOptions {
  generation?: import("@bg/shared").GenerationOptions;
  commandcodeApiKey?: string;
  binaryPath: string;
  projectDir: string;
  prompt: string;
  signal?: AbortSignal;
  onStdoutLine: (line: string) => Promise<void> | void;
  onStderrLine?: (line: string) => Promise<void> | void;
  sessionId?: string;
}

export interface RunnerResult {
  exitCode: number;
}

export function buildClaudeCommand(options: Pick<RunnerOptions, "binaryPath" | "generation">): string[] {
  return [options.binaryPath, "-p", "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits",
    "--effort", options.generation?.effort ?? "low",
    ...(options.generation?.model ? ["--model", options.generation.model] : []),
    ...(options.generation?.vanilla ? ["--safe-mode"] : []),
  ];
}

export function buildClaudeEnvironment(options: Pick<RunnerOptions, "generation" | "commandcodeApiKey">, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...inherited };
  if (options.generation?.provider === "commandcode") {
    if (!options.commandcodeApiKey) throw new Error("commandcode_unavailable");
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.CLAUDE_CODE_USE_BEDROCK;
    delete env.CLAUDE_CODE_USE_VERTEX;
    delete env.CLAUDE_CODE_USE_FOUNDRY;
    delete env.ANTHROPIC_CUSTOM_HEADERS;
    env.ANTHROPIC_BASE_URL = "https://api.commandcode.ai/provider";
    env.ANTHROPIC_AUTH_TOKEN = options.commandcodeApiKey;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  }
  return env;
}

export async function runClaudeCode(options: RunnerOptions): Promise<RunnerResult> {
  // Direct invocation — Bun.spawn's `cwd` option propagates to the child,
  // and on Windows the `claude.cmd` wrapper inherits that cwd so the node
  // process inside sees `process.cwd()` equal to projectDir. This path was
  // previously verified with real Claude output; wrapping in `cmd.exe /c`
  // broke stdin piping on Windows and caused the CLI to hang.
  const cmd = buildClaudeCommand(options);

  // eslint-disable-next-line no-console
  console.log(
    `[claude-code] spawn cwd=${options.projectDir} binary=${options.binaryPath}`,
  );

  const proc = Bun.spawn({
    cmd,
    cwd: options.projectDir,
    stdin: new Blob([options.prompt]),
    stdout: "pipe",
    stderr: "pipe",
    env: buildClaudeEnvironment(options),
    signal: options.signal,
    killSignal: "SIGKILL",
    ...ownedProcessSpawnOptions(),
  });

  // Bun's `signal` option only kills the spawned root. On Windows that root
  // is the `claude.cmd` wrapper, so the real CLI survives an interrupt and
  // keeps writing into the project. Tear the whole owned tree down the
  // moment the abort fires instead of waiting for the root to exit.
  const onAbort = () => { void closeOwnedProcessTree(proc.pid).catch(() => {}); };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const readers = [
    readLines(proc.stdout, options.onStdoutLine),
    options.onStderrLine
      ? readLines(proc.stderr, options.onStderrLine)
      : readLines(proc.stderr, () => {}),
  ];

  let exitCode: number;
  try {
    exitCode = await settleProcessStreams(proc, readers);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
  // eslint-disable-next-line no-console
  console.log(`[claude-code] exit=${exitCode}`);
  return { exitCode };
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => Promise<void> | void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) {
          await onLine(line);
        }
        idx = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) {
      await onLine(buffer);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}
