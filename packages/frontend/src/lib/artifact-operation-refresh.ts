import type { NormalizedEvent } from "@bg/shared";
import type { MessageKey } from "@/i18n/t";

export type ArtifactOperationOutcome = Extract<NormalizedEvent, { type: "artifact.operation" }>["outcome"];

export type ArtifactOperationRefresh = {
  /** Files and artifact queries no longer describe the tree the coordinator holds. */
  readonly invalidate: boolean;
  /** The open canvas frame shows a document the coordinator has replaced. */
  readonly refreshCanvas: boolean;
  /** A turn published: its changed HTML files open as tabs. */
  readonly openChangedTabs: boolean;
  /** Something happened without a turn asking for it, so the user is told. */
  readonly notice: MessageKey | null;
};

/** Failed operations refresh history findings without reloading the unchanged canvas. */
export function artifactOperationRefresh(outcome: ArtifactOperationOutcome): ArtifactOperationRefresh {
  switch (outcome) {
    case "committed":
      return { invalidate: true, refreshCanvas: true, openChangedTabs: true, notice: null };
    case "conflicted":
      return { invalidate: true, refreshCanvas: true, openChangedTabs: false, notice: "workspace.project.operationConflicted" };
    case "recovered":
      return { invalidate: true, refreshCanvas: true, openChangedTabs: false, notice: "workspace.project.operationRecovered" };
    case "failed":
      return { invalidate: true, refreshCanvas: false, openChangedTabs: false, notice: null };
    case "cancelled":
      return { invalidate: false, refreshCanvas: false, openChangedTabs: false, notice: null };
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
