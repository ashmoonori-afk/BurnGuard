import { mkdir, readdir, writeFile } from "node:fs/promises";
import { CANONICAL_THEME_EMITTER, emitArtifactThemeCss, emitCanonicalThemeGuide, parseCanonicalTransferProof, parseSemanticTheme, serializeSemanticTheme, type CanonicalTransferProof, type SemanticTheme } from "@bg/shared/theme";
import { parsePaletteState, serializePalette } from "@bg/shared/palette";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import { ColorContractError } from "@bg/shared/color";
import { PathBoundaryError } from "../security/path-boundary";
import { contentHash, SystemContentError } from "./system-content-format";
import type { ContentValidator } from "./system-content-publication";
import { pathStat, readPreservedFile, safeContentChild, type ContentTree } from "./system-content-tree";

export type CanonicalSnapshot = {
  readonly theme: SemanticTheme; readonly json: string; readonly css: string; readonly skill: string;
  readonly proof: CanonicalTransferProof;
};
const MEMBERS = ["SKILL.md", "theme.css", "theme.json"] as const;
function corrupt(): never { throw new SystemContentError("system_content_corrupt"); }
function conflict(): never { throw new SystemContentError("system_content_conflict"); }

export function canonicalFiles(input: SemanticTheme): CanonicalSnapshot {
  const theme = parseSemanticTheme(input);
  const json = serializeSemanticTheme(theme), css = emitArtifactThemeCss(theme), skill = emitCanonicalThemeGuide(theme);
  const file = (text: string) => ({ size_bytes: Buffer.byteLength(text), sha256: contentHash(text) });
  return { theme, json, css, skill, proof: parseCanonicalTransferProof({
    schema_version: 1, emitter_version: CANONICAL_THEME_EMITTER, json: file(json), css: file(css), skill: file(skill),
  }) };
}

/** Reads a complete deterministic triple; this function alone grants no ownership. */
export async function readCanonicalCandidate(root: string, tree?: ContentTree): Promise<CanonicalSnapshot | null> {
  try {
    const names = (await readdir(root)).filter(name => name.normalize("NFC").toLowerCase() === "canonical");
    if (names.length === 0) return null;
    if (names.length !== 1 || names[0] !== "canonical") return corrupt();
    const directory = await safeContentChild(root, "canonical");
    if (!(await pathStat(directory))?.isDirectory()) return corrupt();
    if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(MEMBERS)) return corrupt();
    const read = async (relative: string, limit: number): Promise<string> => {
      const expected = tree?.inventory.find(entry => entry[1] === relative);
      if (tree !== undefined && (expected === undefined || expected[0] !== "file")) return corrupt();
      const bytes = await readPreservedFile(root, relative, expected, limit);
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!Buffer.from(text).equals(bytes)) return corrupt();
        return text;
      }
      catch (error) { if (error instanceof TypeError) return corrupt(); throw error; }
    };
    const json = await read("canonical/theme.json", 262144);
    const css = await read("canonical/theme.css", 262144);
    const skill = await read("canonical/SKILL.md", 65536);
    const expected = canonicalFiles(parseSemanticTheme(json));
    if (json !== expected.json || css !== expected.css || skill !== expected.skill) return corrupt();
    const palette = parsePaletteState(await read("palette/state.json", 262144));
    if (serializePalette(palette) !== serializePalette(expected.theme.palette)) return conflict();
    return expected;
  } catch (error) {
    if (error instanceof UpgradeContractError || error instanceof ColorContractError || error instanceof PathBoundaryError ||
      error instanceof SyntaxError || error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return corrupt();
    throw error;
  }
}

export function matchCanonicalTransfer(snapshot: CanonicalSnapshot, input: CanonicalTransferProof): void {
  const proof = parseCanonicalTransferProof(input);
  if (JSON.stringify(snapshot.proof) !== JSON.stringify(proof)) return conflict();
}
export async function validateCanonicalTransferAtRoot(root: string, proof: CanonicalTransferProof): Promise<void> {
  const snapshot = await readCanonicalCandidate(root);
  if (snapshot === null) return corrupt();
  matchCanonicalTransfer(snapshot, proof);
}
export const validateCanonicalContent: ContentValidator = async root => {
  if (await readCanonicalCandidate(root) === null) return corrupt();
};

/** Only a previously authorized private publication stage may call this writer. */
export async function writeCanonicalCandidate(stage: string, theme: SemanticTheme): Promise<CanonicalSnapshot> {
  const files = canonicalFiles(theme);
  await mkdir(await safeContentChild(stage, "canonical"), { recursive: true });
  for (const [name, text] of [["theme.json", files.json], ["theme.css", files.css], ["SKILL.md", files.skill]] as const) {
    await writeFile(await safeContentChild(stage, "canonical", name), text);
  }
  return files;
}
