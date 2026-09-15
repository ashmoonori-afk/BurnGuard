import type { AdapterRunInput, AdapterRunResult } from "../types";
import { runCliTurn } from "../cli-turn";
import { parseGeminiLine } from "./parser";

/**
 * Gemini CLI argv, from the installed binary's own `--help`:
 *   -p/--prompt          non-interactive (headless) mode; appended to stdin input, if any
 *   -m/--model           model id
 *   -o/--output-format   text | json | stream-json
 *   --approval-mode      default | auto_edit | yolo | plan
 *
 * The prompt travels on stdin, matching the Claude Code and Codex adapters: a BurnGuard prompt is
 * tens of kilobytes and Windows caps a command line at 32,767 characters. `-p` is still passed so
 * the CLI selects headless mode, and the CLI appends its (empty) value to the stdin prompt.
 */
export function buildGeminiCommand(
  binaryPath: string,
  generation?: AdapterRunInput["generation"],
): string[] {
  return [
    binaryPath,
    "--output-format", "stream-json",
    "--approval-mode", "yolo",
    ...(generation?.model ? ["--model", generation.model] : []),
    "--prompt", "",
  ];
}

export async function runGeminiTurn(input: AdapterRunInput): Promise<AdapterRunResult> {
  const ctx = { turnId: input.turnId, projectDir: input.projectDir };
  return runCliTurn(input, {
    provider: "gemini",
    cmd: buildGeminiCommand(input.binaryPath, input.generation),
    stdinPrompt: input.prompt,
    parse: (line) => parseGeminiLine(line, ctx),
  });
}
