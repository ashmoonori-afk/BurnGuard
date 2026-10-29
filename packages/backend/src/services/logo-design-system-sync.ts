import { readFile } from "node:fs/promises";
import { LOGO_FILES, parseLogoDesignSystemPatchV1, UpgradeContractError } from "@bg/shared";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { transformDesignSystemColorTokens } from "./design-system-extract";
import { readManagedCssForEdit } from "./atomic-text-file";
import { authoringContentEnvironment, authoringTokenPath, publishAuthoringFiles, withEditableSystemContent, type AuthoringEnvironment } from "./design-system-authoring";
import { DesignSystemAssetEditError } from "./extraction-asset-errors";
import { readPreservedFile, safeContentChild } from "./system-content-tree";
import { LogoDeliverableError, logoSvgSource, validateLogoSvg } from "./logo-deliverables";

/**
 * Folds a finished logo's guidelines back into the design system the project is pinned to
 * (doc/23-logo-design-deliverable-2026-09-18.md, D8).
 *
 * This only ever updates an existing system: it never creates a row, and it never invents a patch.
 * A project without a system, or a turn that wrote no patch, is a silent no-op. Everything the
 * patch asks for is validated before the first byte is written, so a rejected patch leaves the
 * system exactly as it was.
 */
export class LogoDesignSystemPatchError extends Error {
  readonly name = "LogoDesignSystemPatchError";
  readonly code = "logo_design_system_patch_failed";
  readonly detail: string;

  constructor(detail: string) {
    super("logo_design_system_patch_failed");
    this.detail = detail;
  }
}

export type LogoDesignSystemPatchResult =
  | { readonly applied: false; readonly reason: "no_design_system" | "patch_absent" }
  | {
      readonly applied: true;
      readonly colors: number;
      readonly readme: "replaced" | "appended";
      readonly asset: true;
    };

export async function applyLogoDesignSystemPatch(input: {
  readonly projectDir: string;
  readonly designSystemId: string | null;
  /** Selected candidate captured by the completed turn, never re-derived from the live project. */
  readonly expectedSource: string;
}, env: AuthoringEnvironment = authoringContentEnvironment()): Promise<LogoDesignSystemPatchResult> {
  if (input.designSystemId === null) return { applied: false, reason: "no_design_system" };

  const patchFile = safeProjectPath(input.projectDir, LOGO_FILES.design_system_patch, "patch_path_unsafe");
  const raw = await readFile(patchFile, "utf8").catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (raw === null) return { applied: false, reason: "patch_absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error instanceof SyntaxError) throw new LogoDesignSystemPatchError("patch_invalid:json");
    throw error;
  }
  let patch;
  try {
    patch = parseLogoDesignSystemPatchV1(parsed);
  } catch (error) {
    if (error instanceof UpgradeContractError) throw new LogoDesignSystemPatchError(`patch_invalid:${error.path}`);
    throw error;
  }

  const assetFile = safeProjectPath(input.projectDir, patch.logo_asset, "logo_asset_path_unsafe");
  const asset = await readFile(assetFile).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (asset === null) throw new LogoDesignSystemPatchError("logo_asset_missing");

  // The live file can change after finalization. Validate the exact buffer we will copy, before
  // any destination write, and bind its source claim to the turn's captured selection.
  const text = asset.toString("utf8");
  try {
    validateLogoSvg(text);
  } catch (error) {
    if (error instanceof LogoDeliverableError) throw new LogoDesignSystemPatchError(error.detail);
    throw error;
  }
  const source = logoSvgSource(text);
  if (source === null) throw new LogoDesignSystemPatchError("svg_source_missing");
  if (source !== input.expectedSource) throw new LogoDesignSystemPatchError("svg_source_mismatch");

  try {
    return await withEditableSystemContent(env, input.designSystemId, async (base, lease) => {
      const token = patch.colors.length === 0 ? null : authoringTokenPath(base);
      const colors = token === null ? [] : [{
        path: token,
        bytes: transformDesignSystemColorTokens(await readManagedCssForEdit(await safeContentChild(base.live, ...token.split("/"))), patch.colors),
      }];
      const existing = await readPreservedFile(base.live, "README.md").catch((error: unknown) => {
        if (isMissing(error)) return Buffer.from("");
        throw error;
      });
      const section = mergeLogoSection(existing.toString("utf8"), patch.readme_section);
      await publishAuthoringFiles(env, base, lease, "logo", [
        ...colors, { path: "README.md", bytes: section.text }, { path: "assets/logo.svg", bytes: asset },
      ]);
      return { applied: true, colors: patch.colors.length, readme: section.readme, asset: true } satisfies LogoDesignSystemPatchResult;
    });
  } catch (error) {
    if (error instanceof DesignSystemAssetEditError && error.code === "design_system_not_found") throw new LogoDesignSystemPatchError("design_system_missing");
    if (error instanceof PathBoundaryError || error instanceof DesignSystemAssetEditError && error.code === "unsafe_managed_path") throw new LogoDesignSystemPatchError("design_system_path_unsafe");
    throw error;
  }
}

/**
 * Replaces the `## Logo` section up to the next second-level heading, or appends it. Re-applying
 * the same patch has to produce byte-identical output, otherwise every finalize turn would grow
 * the README.
 */
export function mergeLogoSection(
  readme: string,
  sectionText: string,
): { readonly text: string; readonly readme: "replaced" | "appended" } {
  const section = sectionText.trimEnd();
  const heading = /^## Logo\b/m.exec(readme);
  if (heading === null) {
    const base = readme.trimEnd();
    return { text: base.length === 0 ? `${section}\n` : `${base}\n\n${section}\n`, readme: "appended" };
  }
  const start = heading.index;
  const afterHeading = start + heading[0].length;
  const next = /^## /m.exec(readme.slice(afterHeading));
  const tail = next === null ? "" : readme.slice(afterHeading + next.index);
  return {
    text: `${readme.slice(0, start)}${tail.length === 0 ? `${section}\n` : `${section}\n\n${tail}`}`,
    readme: "replaced",
  };
}

function safeProjectPath(projectDir: string, relative: string, detail: string): string {
  try {
    return resolveWithin(projectDir, ...relative.split("/"));
  } catch (error) {
    if (error instanceof PathBoundaryError) throw new LogoDesignSystemPatchError(detail);
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}
