import { BACKEND_IDS, type BackendId } from "@bg/shared";
import type {
  RuntimeCapability,
  RuntimePromptTransport,
} from "@bg/shared/runtime-diagnostics";
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

export interface RuntimeBackendProfile {
  readonly id: BackendId;
  readonly promptTransport: RuntimePromptTransport;
  readonly capabilities: readonly RuntimeCapability[];
}

const RUNTIME_BACKEND_PROFILES = [
  {
    id: "claude-code",
    promptTransport: "stdin",
    capabilities: ["text_generation", "file_edits", "tool_events", "usage"],
  },
  {
    id: "codex",
    promptTransport: "stdin",
    capabilities: ["text_generation", "file_edits", "tool_events", "usage", "image_generation"],
  },
  {
    id: "gemini",
    promptTransport: "stdin",
    capabilities: ["text_generation", "file_edits"],
  },
  {
    id: "copilot",
    promptTransport: "saved_file",
    capabilities: ["text_generation", "file_edits"],
  },
] as const satisfies readonly RuntimeBackendProfile[];

/** Static facts owned beside the adapter dispatch they describe. */
export function runtimeBackendProfiles(): readonly RuntimeBackendProfile[] {
  return RUNTIME_BACKEND_PROFILES;
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
