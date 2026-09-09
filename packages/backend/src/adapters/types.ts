import type { NormalizedEvent, UserEvent } from "@bg/shared";

/**
 * Shape of a user tool-decision delivered from the permission-gate UI.
 * Derived from `UserEvent` so downstream consumers can re-use the same
 * type without importing the full UserEvent union.
 */
export type ToolDecisionPayload = Extract<
  UserEvent,
  { type: "user.tool_decision" }
>;

/** Decision handler contract passed to adapters via `AdapterRunInput.onDecision`. */
export type DecisionHandler = (decision: ToolDecisionPayload) => void;

/** Input passed from turns.ts → adapters/registry → each adapter. */
export interface AdapterRunInput {
  generation?: import("@bg/shared").GenerationOptions;
  /** Write-only server credential. Never log this input or persist this field. */
  commandcodeApiKey?: string;
  sessionId: string;
  turnId: string;
  projectDir: string;
  binaryPath: string;
  prompt: string;
  userEvent: Extract<UserEvent, { type: "user.message" }>;
  signal?: AbortSignal;
  onEvent: (event: NormalizedEvent) => Promise<void>;
  onStderr?: (line: string) => Promise<void>;
  /**
   * Register a handler that will be invoked whenever the session's
   * permission-gate UI submits a `user.tool_decision`. The adapter is
   * expected to forward the decision into the CLI — today's Claude
   * Code `-p` mode can't accept mid-turn input so the handler is
   * informational; a follow-up slice that moves to
   * `--input-format stream-json` will gain functional round-trip.
   *
   * Returns an unsubscribe function. Any decisions submitted before
   * the adapter registers are drained to the handler on register.
   */
  onDecision?: (handler: DecisionHandler) => () => void;
}

export interface AdapterRunResult {
  exitCode: number;
}
