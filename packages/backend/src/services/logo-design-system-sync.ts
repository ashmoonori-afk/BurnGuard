import { mkdir, readFile, writeFile } from "node:fs/promises";
import { LOGO_FILES, parseLogoDesignSystemPatchV1, UpgradeContractError } from "@bg/shared";
import { getDesignSystemDetail } from "../db/seed";
import { resolveManagedPath, systemsDir } from "../lib/paths";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { upsertDesignSystemColorToken } from "./design-system-extract";

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
}): Promise<LogoDesignSystemPatchResult> {
  if (input.designSystemId === null) return { applied: false, reason: "no_design_system" };

  const patchFile = safeProjectPath(input.projectDir, LOGO_FILES.design_system_patch, "patch_path_unsafe");
  const raw = await readFile(patchFile, "utf8").catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (raw === null) return { applied: false, reason: "patch_absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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

  const detail = await getDesignSystemDetail(input.designSystemId);
  if (detail === null) throw new LogoDesignSystemPatchError("design_system_missing");
  let systemDir: string;
  try {
    systemDir = resolveManagedPath(systemsDir, detail.dir_path);
  } catch (error) {
    if (error instanceof PathBoundaryError) throw new LogoDesignSystemPatchError("design_system_path_unsafe");
    throw error;
  }

  const assetFile = safeProjectPath(input.projectDir, patch.logo_asset, "logo_asset_path_unsafe");
  const asset = await readFile(assetFile).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (asset === null) throw new LogoDesignSystemPatchError("logo_asset_missing");

  for (const color of patch.colors) {
    await upsertDesignSystemColorToken(input.designSystemId, { name: color.name, value: color.value });
  }

  const readmeFile = resolveWithin(systemDir, "README.md");
  const existing = await readFile(readmeFile, "utf8").catch((error: unknown) => {
    if (isMissing(error)) return "";
    throw error;
  });
  const section = mergeLogoSection(existing, patch.readme_section);
  await writeFile(readmeFile, section.text, "utf8");

  const assetsDir = resolveWithin(systemDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  await writeFile(resolveWithin(assetsDir, LOGO_FILES.logo), asset);

  return { applied: true, colors: patch.colors.length, readme: section.readme, asset: true };
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
