import { BACKEND_IDS, type BackendId } from "@bg/shared";
import type { AdapterRunInput, AdapterRunResult } from "./types";
import { runClaudeCodeTurn } from "./claude-code";
import { runCodexTurn } from "./codex";
import { runCopilotTurn } from "./copilot";
import { runGeminiTurn } from "./gemini";

/**
 * Backends this registry can actually dispatch. Kept beside the switch so a provider added to the
 * shared contract without an adapter is caught by a test instead of by a user's "Unknown backend".
 */
export function adapterBackendIds(): readonly BackendId[] {
  return BACKEND_IDS;
}

export async function runAdapterTurn(
  backendId: BackendId,
  input: AdapterRunInput,
): Promise<AdapterRunResult> {
  switch (backendId) {
    case "claude-code":
      return runClaudeCodeTurn(input);
    case "codex":
      return runCodexTurn(input);
    case "gemini":
      return runGeminiTurn(input);
    case "copilot":
      return runCopilotTurn(input);
    default:
      throw new Error(`Unknown backend: ${backendId}`);
  }
}
