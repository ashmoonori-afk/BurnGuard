import type { ExportOptions, GraphicSetV1, ProjectDetail } from "@bg/shared";
import { ExportError } from "./export-errors";
import type { RenderSession } from "./export-render-session";
import type { ExportValidation } from "./export-receipt-validation";

export type PngZipContext = {
  readonly stagedDir: string;
  readonly outputPath: string;
  readonly project: ProjectDetail;
  readonly graphic_set: GraphicSetV1;
  readonly options: ExportOptions;
  readonly browserSession: RenderSession;
  readonly receiptWriter: (validation: ExportValidation) => Promise<void>;
  readonly signal: AbortSignal;
};

/** Renders frame or slice outputs from the staged tree, project and graphic-set contracts, options, browser session, receipt writer, and cancellation signal. */
export async function renderPngZip(context: PngZipContext): Promise<ExportValidation> {
  void context;
  throw new ExportError("not_implemented");
}
