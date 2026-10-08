import { WEB_ASSET_MCP_SERVER, WEB_ASSET_TOOL_NAMES } from "@bg/shared";
import { spawnOwnedProcess } from "../owned-process";
import { settleProcessStreams } from "../process-streams";
import { readLines } from "../bounded-lines";

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

export function buildClaudeCommand(options: Pick<RunnerOptions, "binaryPath" | "generation" | "webAssetTool">): string[] {
  return [options.binaryPath, "-p", "--output-format", "stream-json", "--verbose",
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
  const cmd = buildClaudeCommand(options);

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
