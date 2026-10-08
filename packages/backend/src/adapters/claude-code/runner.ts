import { WEB_ASSET_MCP_SERVER, WEB_ASSET_TOOL_NAMES } from "@bg/shared";
import { spawnOwnedProcess } from "../owned-process";
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
  webAssetTool?: { readonly command: readonly string[] };
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

/** `--mcp-config` and `--allowedTools` take variadic values, so they sit before another flag, never last. */
function webAssetToolArgs(tool: RunnerOptions["webAssetTool"]): string[] {
  if (tool === undefined || tool.command.length === 0) return [];
  const [command, ...args] = tool.command;
  const config = { mcpServers: { [WEB_ASSET_MCP_SERVER]: { type: "stdio", command, args } } };
  const allowed = Object.values(WEB_ASSET_TOOL_NAMES).map((name) => `mcp__${WEB_ASSET_MCP_SERVER}__${name}`);
  return ["--mcp-config", JSON.stringify(config), "--allowedTools", allowed.join(",")];
}

const PARTIAL_MESSAGES_FLAG = "--include-partial-messages";
const HELP_PROBE_TIMEOUT_MS = 5_000;
const HELP_PROBE_OUTPUT_BYTES = 256 * 1024;
const partialMessagesSupport = new Map<string, boolean>();

async function readHelpText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remaining = HELP_PROBE_OUTPUT_BYTES;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (remaining === 0) continue;
      const accepted = value.subarray(0, remaining);
      output += decoder.decode(accepted, { stream: true });
      remaining -= accepted.length;
    }
    return output + decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

async function probeHelp(binaryPath: string, turnSignal?: AbortSignal): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HELP_PROBE_TIMEOUT_MS);
  // A cancelled turn stops the probe at once instead of waiting for its own timeout.
  const signal = turnSignal ? AbortSignal.any([controller.signal, turnSignal]) : controller.signal;
  try {
    const owned = spawnOwnedProcess({ cmd: [binaryPath, "--help"], stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let stdout = "";
    const code = await settleProcessStreams(owned, [
      readHelpText(owned.proc.stdout).then((text) => { stdout = text; }),
      readHelpText(owned.proc.stderr).then(() => {}),
    ], signal);
    return !signal.aborted && code === 0 ? stdout : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether this binary knows `--include-partial-messages`; an older CLI rejects unknown flags and would fail every turn.
 * Cached per binary path. A probe that fails, times out or is cancelled by `signal` is not cached and the flag is left off for that turn.
 */
export async function supportsPartialMessages(binaryPath: string, probe: (binaryPath: string, signal?: AbortSignal) => Promise<string | undefined> = probeHelp, signal?: AbortSignal): Promise<boolean> {
  const cached = partialMessagesSupport.get(binaryPath);
  if (cached !== undefined) return cached;
  const help = await probe(binaryPath, signal);
  if (help === undefined) return false;
  const supported = help.includes(PARTIAL_MESSAGES_FLAG);
  partialMessagesSupport.set(binaryPath, supported);
  return supported;
}

export function resetPartialMessagesSupportCache(): void {
  partialMessagesSupport.clear();
}

export function buildClaudeCommand(options: Pick<RunnerOptions, "binaryPath" | "generation" | "webAssetTool"> & { partialMessages?: boolean }): string[] {
  return [options.binaryPath, "-p", "--output-format", "stream-json", "--verbose",
    // Without partial messages a single large tool input (a first full scaffold write) is silent until it completes.
    ...(options.partialMessages ? [PARTIAL_MESSAGES_FLAG] : []),
    "--permission-mode", "acceptEdits",
    ...webAssetToolArgs(options.webAssetTool),
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
  const cmd = buildClaudeCommand({ ...options, partialMessages: await supportsPartialMessages(options.binaryPath, undefined, options.signal) });

  // eslint-disable-next-line no-console
  console.log(
    `[claude-code] spawn cwd=${options.projectDir} binary=${options.binaryPath}`,
  );

  const owned = spawnOwnedProcess({
    cmd,
    cwd: options.projectDir,
    stdin: new Blob([options.prompt]),
    stdout: "pipe",
    stderr: "pipe",
    env: buildClaudeEnvironment(options),
  });
  const proc = owned.proc;

  const readers = [
    readLines(proc.stdout, options.onStdoutLine),
    options.onStderrLine
      ? readLines(proc.stderr, options.onStderrLine)
      : readLines(proc.stderr, () => {}),
  ];

  const exitCode = await settleProcessStreams(owned, readers, options.signal);
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
