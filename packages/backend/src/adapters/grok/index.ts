import type { AdapterRunInput, AdapterRunResult } from "../types";
import { runCliTurn } from "../cli-turn";
import { parseGrokLine } from "./parser";

/** Bounds a headless run so a tool loop cannot spin for the whole turn timeout. */
const MAX_TOOL_ROUNDS = "50";

/**
 * Grok CLI argv, from the published CLI reference:
 *   -p/--prompt <prompt>    process a single prompt and exit (headless mode)
 *   -m/--model <model>      grok-code-fast-1, grok-4-latest, ...
 *   --directory <path>      working directory
 *   --max-tool-rounds <n>   bound on tool iterations
 *
 * The prompt travels in argv because the CLI documents no stdin path.
 */
export function buildGrokCommand(
  binaryPath: string,
  prompt: string,
  projectDir: string,
  generation?: AdapterRunInput["generation"],
): string[] {
  return [
    binaryPath,
    "--prompt", prompt,
    "--directory", projectDir,
    "--max-tool-rounds", MAX_TOOL_ROUNDS,
    ...(generation?.model ? ["--model", generation.model] : []),
  ];
}

export async function runGrokTurn(input: AdapterRunInput): Promise<AdapterRunResult> {
  const ctx = { turnId: input.turnId, projectDir: input.projectDir };
  return runCliTurn(input, {
    provider: "grok",
    cmd: buildGrokCommand(input.binaryPath, input.prompt, input.projectDir, input.generation),
    stdinPrompt: null,
    parse: (line) => parseGrokLine(line, ctx),
  });
}
