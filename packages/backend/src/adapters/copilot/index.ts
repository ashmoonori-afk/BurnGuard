import type { AdapterRunInput, AdapterRunResult } from "../types";
import { runCliTurn } from "../cli-turn";
import { parseCopilotLine } from "./parser";

/**
 * GitHub Copilot CLI 1.0.83 --help and its published command reference verify these flags.
 * Keep cwd path verification and grant file edits only, not shell or MCP tool execution.
 * runCliTurn substitutes a private UTF-8 input file before spawning, keeping task bytes off argv.
 */
export function buildCopilotCommand(
  binaryPath: string,
  prompt: string,
  generation?: AdapterRunInput["generation"],
): string[] {
  return [
    binaryPath,
    "--prompt", prompt,
    "--allow-tool=write",
    "--output-format", "json",
    "--no-ask-user",
    "--no-auto-update",
    "--disable-builtin-mcps",
    ...(generation?.vanilla ? ["--no-custom-instructions"] : []),
    ...(generation?.model ? ["--model", generation.model] : []),
  ];
}

export async function runCopilotTurn(input: AdapterRunInput): Promise<AdapterRunResult> {
  const ctx = { turnId: input.turnId, projectDir: input.projectDir };
  return runCliTurn(input, {
    provider: "copilot",
    cmd: buildCopilotCommand(input.binaryPath, input.prompt, input.generation),
    stdinPrompt: null,
    parse: (line) => parseCopilotLine(line, ctx),
  });
}
