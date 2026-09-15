import type { AdapterRunInput, AdapterRunResult } from "../types";
import { runCliTurn } from "../cli-turn";
import { parseCopilotLine } from "./parser";

/**
 * GitHub Copilot CLI argv.
 *
 * `--prompt`/`-p` for a programmatic session is documented
 * (https://docs.github.com/copilot/concepts/agents/about-copilot-cli). `--allow-all-tools` is the
 * documented way to run without interactive approval, but it is an UNVERIFIED ASSUMPTION here: the
 * CLI is not installed on this machine, so the flag could not be exercised. The backend is
 * detection-gated, so an installation that rejects the flag fails visibly at turn start rather than
 * silently producing nothing.
 *
 * The prompt travels in argv because the CLI documents no stdin path; callers must keep prompts
 * below the platform command-line limit.
 */
export function buildCopilotCommand(
  binaryPath: string,
  prompt: string,
  generation?: AdapterRunInput["generation"],
): string[] {
  return [
    binaryPath,
    "--prompt", prompt,
    "--allow-all-tools",
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
