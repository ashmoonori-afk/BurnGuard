import type { ExportOptions, GraphicSetV1, ProjectDetail } from "@bg/shared";
import type { RenderSession } from "./export-render-session";
import type { ExportValidation } from "./export-receipt-validation";
import { ExportError } from "./export-errors";

export type PlatformPackageContext = {
  readonly stagedDir: string;
  readonly outputPath: string;
  readonly format: "cafe24_package" | "imweb_package";
  readonly project: ProjectDetail;
  readonly graphic_set: GraphicSetV1;
  readonly options: ExportOptions;
  readonly browserSession: RenderSession;
  readonly receiptWriter: (validation: ExportValidation) => Promise<void>;
  readonly signal: AbortSignal;
};

/** Renders a platform ZIP from the staged tree, project and graphic-set contracts, options, browser session, receipt writer, and cancellation signal. */
export async function renderPlatformPackage(context: PlatformPackageContext): Promise<ExportValidation> {
  void context;
  throw new ExportError("not_implemented");
}
