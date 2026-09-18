/**
 * SVG export for logo projects.
 *
 * Unlike every other format there is nothing to render: the master `logo.svg` the finalize turn
 * produced is the deliverable. The staged copy is re-validated with the same contract the turn gate
 * uses and then published byte-for-byte, so the file the user downloads is exactly the file the
 * turn accepted.
 */
import { readFile, writeFile } from "node:fs/promises";
import { LOGO_FILES } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import type { SvgValidation } from "./export-receipt-validation";
import { LogoDeliverableError, logoSvgSource, validateLogoSvg } from "./logo-deliverables";

export class LogoSvgExportError extends Error {
  readonly name = "LogoSvgExportError";
  constructor(readonly code: "logo_svg_missing" | "logo_svg_invalid", readonly reason: string) {
    super(`${code}: ${reason}`);
  }
}

export async function renderLogoSvg(input: {
  readonly stagedDir: string;
  readonly entrypointDir: string;
  readonly outputPath: string;
}): Promise<SvgValidation> {
  const relativeDir = input.entrypointDir === "" || input.entrypointDir === "." ? [] : [input.entrypointDir];
  const stagedLogo = resolveWithin(input.stagedDir, ...relativeDir, LOGO_FILES.logo);
  let bytes: Buffer;
  try {
    bytes = await readFile(stagedLogo);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    throw new LogoSvgExportError("logo_svg_missing", LOGO_FILES.logo);
  }
  const text = bytes.toString("utf8");
  try {
    validateLogoSvg(text);
  } catch (error) {
    if (!(error instanceof LogoDeliverableError)) throw error;
    throw new LogoSvgExportError("logo_svg_invalid", error.detail);
  }
  await writeFile(input.outputPath, bytes);
  return { root: text.trimStart().startsWith("<?xml") ? "xml" : "svg", bytes: bytes.byteLength, source: logoSvgSource(text) };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}
