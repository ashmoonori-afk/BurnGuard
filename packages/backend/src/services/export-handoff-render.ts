import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildHandoffSpec, copyProjectIntoBundle, EXTRACT_HANDOFF_FN, HandoffExportError, type HandoffPage, type HandoffSpec } from "./export-handoff";
import { inspectRenderedPage } from "./design-audit-dom";
import type { DesignSystemPin } from "./project-design-system-pin";

export async function renderHandoffBundle(input: {
  readonly stagedProjectDir: string;
  readonly stagingDir: string;
  readonly entrypoint: string;
  readonly tokensSrcPath: string | null;
  readonly tokensFileName: string | null;
  readonly designSystemName: string | null;
  readonly project: HandoffSpec["project"];
  readonly isDeck: boolean;
  readonly signal?: AbortSignal;
  readonly designSystemPin?: DesignSystemPin | null;
}): Promise<void> {
  await mkdir(input.stagingDir, { recursive: true });
  const bundleSourceDir = path.join(input.stagingDir, "source");
  await copyProjectIntoBundle(input.stagedProjectDir, bundleSourceDir);
  const bundledEntrypoint = path.join(bundleSourceDir, input.entrypoint);
  try { if (!(await stat(bundledEntrypoint)).isFile()) throw new HandoffExportError("render_failed", `Bundle entrypoint missing at ${bundledEntrypoint}`); }
  catch (error) { if (error instanceof HandoffExportError) throw error; throw new HandoffExportError("render_failed", error instanceof Error ? error.message : String(error)); }
  const { openRenderSession, RenderSessionError } = await import("./export-render-session");
  let session;
  try { session = await openRenderSession({ stagedDir: bundleSourceDir, entrypoint: input.entrypoint, viewport: { width: 1280, height: 720, dpr: 1 }, deck: input.isDeck, signal: input.signal ?? new AbortController().signal }); }
  catch (error) { if (error instanceof RenderSessionError) throw new HandoffExportError(error.code === "deck_not_ready" ? "artifact_not_ready" : error.code === "chromium_not_installed" ? "chromium_not_installed" : error.code === "chromium_launch_timeout" ? "chromium_launch_timeout" : "render_failed", error.message); throw error; }
  try {
    const page = session.page;
    if (input.isDeck) await page.addStyleTag({ content: "[data-deck-nav],[data-deck-nav-style]{display:none!important}[data-slide]{display:block!important}" });
    const value: unknown = await page.evaluate(`(${EXTRACT_HANDOFF_FN})()`);
    if (!isHandoffExtract(value)) throw new HandoffExportError("render_failed", "Handoff extraction returned invalid pages");
    const tokensFileInZip = input.designSystemPin ? "tokens/colors_and_type.css" : input.tokensSrcPath !== null && input.tokensFileName !== null ? `tokens/${input.tokensFileName}` : null;
    const spec = buildHandoffSpec({ project: input.project, viewport: value.viewport, pages: value.pages, designSystem: { name: input.designSystemName, tokensFileInZip } });
    await writeFile(path.join(input.stagingDir, "spec.json"), JSON.stringify(spec, null, 2), "utf8");
    const observed = await inspectRenderedPage(page, input.isDeck);
    await page.screenshot({ path: path.join(input.stagingDir, "preview.png"), fullPage: false });
    await writeFile(path.join(input.stagingDir, "review.json"), JSON.stringify({
      schema_version: 1, scope: "entrypoint_at_1280x720_only",
      visual_review: "not_performed", responsive_review: "not_performed",
      measurements: observed,
      design_system: input.designSystemPin ? { revision: input.designSystemPin.revision, digest: input.designSystemPin.digest } : null,
    }, null, 2));
    if (input.designSystemPin) {
      await mkdir(path.join(input.stagingDir, "tokens"), { recursive: true });
      await writeFile(path.join(input.stagingDir, "tokens", "colors_and_type.css"), input.designSystemPin.tokens);
      await writeFile(path.join(input.stagingDir, "design-system.md"), input.designSystemPin.context);
    }
    if (input.tokensSrcPath !== null && tokensFileInZip !== null) { const destination = path.join(input.stagingDir, tokensFileInZip); await mkdir(path.dirname(destination), { recursive: true }); try { await copyFile(input.tokensSrcPath, destination); } catch (error) { if (!(error instanceof Error) || !Reflect.has(error, "code") || Reflect.get(error, "code") !== "ENOENT") throw error; } }
    await writeFile(path.join(input.stagingDir, "README.txt"), `${README.trim()}\n\nEntrypoint: source/${input.entrypoint}\nProject type: ${input.project.type}\n`, "utf8");
  } finally { await session.close(); }
}

function isHandoffExtract(value: unknown): value is { readonly viewport: { readonly width: number; readonly height: number }; readonly pages: HandoffPage[] } {
  if (typeof value !== "object" || value === null) return false;
  const viewport = Reflect.get(value, "viewport"); const pages = Reflect.get(value, "pages");
  return typeof viewport === "object" && viewport !== null && typeof Reflect.get(viewport, "width") === "number" && typeof Reflect.get(viewport, "height") === "number" && Array.isArray(pages);
}
const README = `BurnGuard Handoff bundle
========================
source/ contains the validated project closure.
spec.json contains editable node geometry and styles.
tokens/ contains the pinned colour and type tokens when available.
design-system.md contains the pinned, format-specific design rules when available.
preview.png is a capture of the entrypoint at 1280x720, not a whole-site visual approval.
review.json contains measured findings and explicitly unverified checks.

Implementation:
1. Open source/ at the entrypoint below and compare it with preview.png.
2. Reuse the pinned rules and tokens; adapt components to the target repository.
3. Preserve links, interactions, slide order and responsive behaviour.
4. Resolve remaining findings in review.json, then verify every page, mobile layout,
   keyboard navigation, content accuracy and real integrations. Those checks are not
   certified by this bundle. Do not describe this package as production-ready.`;
