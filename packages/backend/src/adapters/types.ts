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
  /**
   * Whether this run may call the provider's built-in image tool. Repairs of an already-finished
   * artifact set "forbidden": the capability is switched off in the CLI invocation, and the caller
   * refuses the run if an image call shows up regardless. Absent means the default, allowed.
   */
  imageGeneration?: "allowed" | "forbidden";
  /**
   * The BurnGuard web asset MCP server to register and pre-approve for this run. Set only for a model profile
   * that sources assets from the web while web asset search is enabled; adapters without MCP support ignore it.
   */
  webAssetTool?: { readonly command: readonly string[] };
  /**
   * Effective Codex progress signal (Settings, OS-local; on by default unless the user has their own
   * Codex OTel destination): route Codex's OTel metrics to a per-run loopback receiver so stream
   * events count as `onProgress`. Absent or false means the plain Codex launch, telemetry untouched.
   */
  codexProgressMetrics?: boolean;
  onEvent: (event: NormalizedEvent) => Promise<void>;
  /** Proof of life that is not an event: it resets the inactivity watchdog and is never persisted or published. */
  onProgress?: () => void;
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
