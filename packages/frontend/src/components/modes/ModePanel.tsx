import type { Comment } from "@bg/shared";
import type { CanvasMode } from "./types";
import type { SelectedNode } from "@/types/project";
import type { EditTarget } from "@/components/canvas/EditLayer";
import type { DrawTool } from "@/components/canvas/DrawLayer";
import type {
  TweaksStyleKey,
  TweaksTarget,
} from "@/components/canvas/TweaksLayer";
import CommentPanel from "./CommentPanel";
import DrawPanel from "./DrawPanel";
import EditPanel from "./EditPanel";
import SelectorReadOnlyPanel from "./SelectorReadOnlyPanel";
import TweaksPanel from "./TweaksPanel";
import type { TweakChangePreview } from "./TweaksPanel";
import QualityPanel, { type QualityPanelBinding } from "./QualityPanel";
import UxReviewPanel, { type UxReviewBinding } from "./UxReviewPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Right-side mode pane. Renders nothing when no mode is active so the canvas
 * uses the full width; the iframe is then directly interactive (copy text,
 * click links, right-click, etc.).
 */
export default function ModePanel({
  mode,
  selection,
  onPromoteToTweaks,
  comments,
  activeRelPath,
  activeSlideIdx,
  focusedCommentId,
  onFocusComment,
  onUpdateCommentBody,
  onToggleCommentResolved,
  onRequestCommentEdit,
  commentEditDisabled,
  editTarget,
  editSaving,
  onSaveEdit,
  onClearEdit,
  tweaksTarget,
  tweaksSaving,
  onApplyTweak,
  onResetTweaks,
  onClearTweaks,
  tweakReview,
  drawTool,
  drawColor,
  drawStrokeWidth,
  drawHasShapes,
  onChangeDrawTool,
  onChangeDrawColor,
  onChangeDrawWidth,
  onUndoDraw,
  onRedoDraw,
  onClearDraw,
  quality,
  uxReview,
}: {
  mode: CanvasMode | null;
  selection: SelectedNode | null;
  onPromoteToTweaks: () => void;
  comments: Comment[];
  activeRelPath: string | null;
  activeSlideIdx: number | null;
  focusedCommentId: string | null;
  onFocusComment: (id: string | null) => void;
  onUpdateCommentBody: (id: string, body: string) => void;
  onToggleCommentResolved: (id: string, resolved: boolean) => void;
  onRequestCommentEdit?: (comment: Comment, body: string) => Promise<void>;
  commentEditDisabled?: boolean;
  editTarget: EditTarget | null;
  editSaving: boolean;
  onSaveEdit: (patch: {
    text?: string;
    attributes?: Record<string, string | null>;
  }) => void;
  onClearEdit: () => void;
  tweaksTarget: TweaksTarget | null;
  tweaksSaving: boolean;
  onApplyTweak: (patch: Partial<Record<TweaksStyleKey, string | null>>) => void;
  onResetTweaks: () => void;
  onClearTweaks: () => void;
  tweakReview: TweakChangePreview | null;
  drawTool: DrawTool;
  drawColor: string;
  drawStrokeWidth: number;
  drawHasShapes: boolean;
  onChangeDrawTool: (t: DrawTool) => void;
  onChangeDrawColor: (c: string) => void;
  onChangeDrawWidth: (w: number) => void;
  onUndoDraw: () => void;
  onRedoDraw: () => void;
  onClearDraw: () => void;
  quality: QualityPanelBinding;
  uxReview: UxReviewBinding;
}) {
  if (!mode) return null;

  return (
    <aside aria-label="캔버스 도구 설정" className="flex min-h-0 w-[280px] shrink-0 flex-col overflow-hidden border-l border-border bg-background min-[1400px]:w-[320px] max-[1200px]:max-h-[40%] max-[1200px]:w-full max-[1200px]:shrink max-[1200px]:border-l-0 max-[1200px]:border-t">
      {mode === "select" && (
        <SelectorReadOnlyPanel
          selection={selection}
          onPromoteToTweaks={onPromoteToTweaks}
        />
      )}
      {mode === "tweaks" && (
        <TweaksPanel
          target={tweaksTarget}
          saving={tweaksSaving}
          onApply={onApplyTweak}
          onResetAll={onResetTweaks}
          onClear={onClearTweaks}
          review={tweakReview}
        />
      )}
      {mode === "comment" && (
        <CommentPanel
          comments={comments}
          activeRelPath={activeRelPath}
          activeSlideIdx={activeSlideIdx}
          focusedId={focusedCommentId}
          onFocus={onFocusComment}
          onUpdateBody={onUpdateCommentBody}
          onToggleResolved={onToggleCommentResolved}
          onRequestEdit={onRequestCommentEdit}
          editDisabled={commentEditDisabled}
        />
      )}
      {mode === "edit" && (
        <EditPanel
          target={editTarget}
          saving={editSaving}
          onSave={onSaveEdit}
          onClear={onClearEdit}
        />
      )}
      {mode === "quality" && <Tabs defaultValue="quality" className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="결과물 검토" className="m-2 h-auto shrink-0"><TabsTrigger value="quality" className="min-h-11 flex-1">품질 검사</TabsTrigger><TabsTrigger value="ux" className="min-h-11 flex-1">UX 개선</TabsTrigger></TabsList>
        <TabsContent value="quality" className="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"><QualityPanel quality={quality} /></TabsContent>
        <TabsContent value="ux" className="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"><UxReviewPanel key={`${uxReview.projectId}:${uxReview.relPath}:${uxReview.digest}:${uxReview.revision}`} binding={uxReview} /></TabsContent>
      </Tabs>}
      {mode === "draw" && (
        <DrawPanel
          tool={drawTool}
          color={drawColor}
          strokeWidth={drawStrokeWidth}
          hasShapes={drawHasShapes}
          onChangeTool={onChangeDrawTool}
          onChangeColor={onChangeDrawColor}
          onChangeWidth={onChangeDrawWidth}
          onUndo={onUndoDraw}
          onRedo={onRedoDraw}
          onClear={onClearDraw}
        />
      )}
    </aside>
  );
}
