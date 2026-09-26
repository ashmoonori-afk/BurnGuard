import type { DesignDirectionState } from "./design-direction";
import type { UploadedVisualSourceSelection, VisualSourceManifestV1 } from "./visual-source";

export type TurnErrorCode =
  | "graphic_requires_authenticated_codex"
  | "graphic_starter_unchanged"
  | "logo_requires_authenticated_codex"
  | "logo_deliverables_missing"
  | "logo_image_provenance_missing"
  | "design_review_failed"
  | "commandcode_unavailable"
  | "unsupported_generation_model_effort"
  | "backend_unavailable"
  | "agent_control_files_present"
  | "path_unavailable"
  | "immutable_reference_mutated"
  | "immutable_reference_path_unavailable"
  | "immutable_reference_escaped"
  | "private_input_unavailable"
  | "publication_failed"
  | "operation_conflict"
  | "operation_cancelled"
  | "turn_failed"
  | "deck_source_page_limit";

/**
 * Why a turn that ran to completion was refused, in a closed machine-readable vocabulary.
 *
 * A `TurnErrorCode` says which apology the client shows; a reason says which contract the finished
 * work broke, so the client and the trace can tell "the mark itself is malformed" from "the image
 * history was rewritten" without reading prose. The private `detail` a domain error records names a
 * candidate id or a manifest path, so it is mapped onto one of these before it can leave the
 * server: a reason is always one of this list and never carries a path, an id or model-authored text.
 */
export type TurnRejectionReason =
  | "logo_manifest_missing"
  | "logo_manifest_invalid"
  | "logo_history_changed"
  | "logo_selection_invalid"
  | "logo_candidate_invalid"
  | "logo_candidate_provenance"
  | "logo_svg_missing"
  | "logo_svg_invalid"
  | "logo_svg_source_mismatch"
  | "logo_guidelines_invalid";

/**
 * A turn that finished and was then refused. Nothing it produced reached the project, so a client
 * can say "not applied" instead of leaving the last streamed message looking committed. The turn id
 * correlates the notice with the bubbles already on screen; `repairs` is how many bounded targeted
 * corrections the server attempted before giving up.
 */
export type TurnNotApplied = {
  readonly turnId: string;
  readonly operationId: string;
  readonly repairs: number;
};

export type NormalizedEvent =
  | {
      id: string;
      ts: number;
      type: "chat.user_message";
      turnId: string;
      text: string;
      attachmentCount: number;
      visualSources?: VisualSourceManifestV1;
    }
  | { id: string; ts: number; type: "chat.delta"; turnId: string; text: string }
  | {
      id: string;
      ts: number;
      type: "chat.thinking";
      turnId: string;
      text: string;
    }
  | { id: string; ts: number; type: "chat.message_end"; turnId: string }
  | {
      id: string;
      ts: number;
      type: "tool.started";
      turnId: string;
      toolCallId: string;
      tool: string;
      input: unknown;
    }
  | {
      id: string;
      ts: number;
      type: "tool.finished";
      turnId: string;
      toolCallId: string;
      tool: string;
      ok: boolean;
      output?: unknown;
    }
  | {
      id: string;
      ts: number;
      type: "tool.permission_required";
      turnId: string;
      toolCallId: string;
      tool: string;
      input: unknown;
    }
  | {
      id: string;
      ts: number;
      type: "tool.permission_decided";
      turnId: string;
      toolCallId: string;
      decision: "allow" | "deny";
    }
  | {
      id: string;
      ts: number;
      type: "artifact.preview";
      projectId: string;
      previewId: string;
      path: string;
      version: number;
      active: boolean;
    }
  | {
      id: string;
      ts: number;
      type: "artifact.operation";
      operationId: string;
      revision: number;
      digest: string;
      changedPaths: readonly string[];
      outcome: "committed" | "cancelled" | "failed" | "conflicted" | "recovered";
    }
  | {
      id: string;
      ts: number;
      type: "export.attempt";
      jobId: string;
      attemptId: string;
      status: import("./export-attempt").ExportAttemptStatus;
      progress: import("./export-attempt").ExportProgress;
      projectRevision: number;
      projectDigest: string;
      stopReason: import("./export-attempt").ExportStopReason | null;
    }
  | {
      id: string;
      ts: number;
      type: "design.direction_state";
      state: DesignDirectionState;
    }
  | {
      id: string;
      ts: number;
      type: "file.changed";
      turnId: string;
      action: "created" | "edited" | "deleted";
      path: string;
    }
  | { id: string; ts: number; type: "status.running" }
  | {
      id: string;
      ts: number;
      type: "status.idle";
      stopReason: "end_turn" | "requires_action" | "interrupted" | "error";
    }
  | {
      id: string;
      ts: number;
      type: "status.error";
      code?: TurnErrorCode;
      /** Which contract the finished work broke, when the server refused a completed turn. */
      reason?: TurnRejectionReason;
      /** Set when the turn published nothing; the project tree is exactly what it was. */
      notApplied?: TurnNotApplied;
      message: string;
      recoverable: boolean;
    }
  | {
      id: string;
      ts: number;
      type: "usage.delta";
      input: number;
      output: number;
      cached?: number;
    };

export type SequencedEventEnvelope = {
  readonly sequence: number;
  readonly event: NormalizedEvent;
};

export type UserEvent =
  | {
      type: "user.message";
      generation?: import("./generation").GenerationOptions;
      text: string;
      active_rel_path?: string;
      attachments?: string[];
      visualSources?: readonly UploadedVisualSourceSelection[];
    }
  | { type: "user.interrupt" }
  | {
      type: "user.tool_decision";
      toolCallId: string;
      decision: "allow" | "deny";
      reason?: string;
    };
