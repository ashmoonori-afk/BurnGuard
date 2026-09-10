import type { DesignDirectionState } from "./design-direction";
import type { UploadedVisualSourceSelection, VisualSourceManifestV1 } from "./visual-source";

export type TurnErrorCode =
  | "graphic_requires_authenticated_codex"
  | "graphic_starter_unchanged"
  | "commandcode_unavailable"
  | "unsupported_generation_model_effort"
  | "backend_unavailable"
  | "path_unavailable"
  | "immutable_reference_mutated"
  | "immutable_reference_path_unavailable"
  | "immutable_reference_escaped"
  | "private_input_unavailable"
  | "publication_failed"
  | "operation_conflict"
  | "operation_cancelled"
  | "turn_failed";

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
