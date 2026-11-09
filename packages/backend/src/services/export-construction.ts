/**
 * Construction sheet export for geometric logo projects (doc/35-logo-construction-export-2026-11-09.md).
 *
 * The sheet is drawn here, from the staged geometry record, by the same construction renderer the
 * app plays, as a still drawing. Nothing the model wrote reaches the file except the record's
 * numbers: the record is parsed and compiled, the sheet is rendered from a fixed template, and the
 * result must pass the master vector allowlist before it is published.
 */
import { readFile, writeFile } from "node:fs/promises";
import { compileLogoGeometry, LOGO_GEOMETRY_FILE, LogoGeometryError, parseLogoGeometryV1, renderLogoConstructionSheet } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import type { SvgValidation } from "./export-receipt-validation";
import { LogoDeliverableError, validateLogoSvg } from "./logo-deliverables";

export class LogoConstructionExportError extends Error {
  readonly name = "LogoConstructionExportError";
  constructor(readonly code: "construction_missing" | "construction_invalid" | "construction_too_large" | "construction_mp4_unsupported", readonly reason: string) {
    super(`${code}: ${reason}`);
  }
}

export async function renderLogoConstructionSvg(input: {
  readonly stagedDir: string;
  readonly entrypointDir: string;
  readonly outputPath: string;
  /** The accessible name of the sheet; the same name the symbol step gives the mark. */
  readonly label: string;
}): Promise<SvgValidation> {
  const relativeDir = input.entrypointDir === "" || input.entrypointDir === "." ? [] : [input.entrypointDir];
  let source: string;
  try {
    source = await readFile(resolveWithin(input.stagedDir, ...relativeDir, LOGO_GEOMETRY_FILE), "utf8");
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    throw new LogoConstructionExportError("construction_missing", LOGO_GEOMETRY_FILE);
  }
  let sheet: string;
  try {
    const { geometry } = parseLogoGeometryV1(source.replace(/^\uFEFF/, ""));
    sheet = renderLogoConstructionSheet(geometry, compileLogoGeometry(geometry), input.label);
  } catch (error) {
    if (!(error instanceof LogoGeometryError)) throw error;
    throw new LogoConstructionExportError("construction_invalid", error.code);
  }
  try {
    validateLogoSvg(sheet);
  } catch (error) {
    if (!(error instanceof LogoDeliverableError)) throw error;
    throw new LogoConstructionExportError("construction_invalid", error.detail);
  }
  const bytes = Buffer.from(sheet, "utf8");
  await writeFile(input.outputPath, bytes);
  return { root: "svg", bytes: bytes.byteLength, source: null };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}
