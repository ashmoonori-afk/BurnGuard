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

/**
 * What the workspace does with an `artifact.operation` event. A committed turn refreshes and opens
 * its files; an external conflict or a startup recovery replaced the tree with nothing on screen
 * announcing it, so those refresh and notify; a cancelled or failed operation left the tree as it
 * was and needs nothing.
 */
export function artifactOperationRefresh(outcome: ArtifactOperationOutcome): ArtifactOperationRefresh {
  switch (outcome) {
    case "committed":
      return { invalidate: true, refreshCanvas: true, openChangedTabs: true, notice: null };
    case "conflicted":
      return { invalidate: true, refreshCanvas: true, openChangedTabs: false, notice: "workspace.project.operationConflicted" };
    case "recovered":
      return { invalidate: true, refreshCanvas: true, openChangedTabs: false, notice: "workspace.project.operationRecovered" };
    case "cancelled":
    case "failed":
      return { invalidate: false, refreshCanvas: false, openChangedTabs: false, notice: null };
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
