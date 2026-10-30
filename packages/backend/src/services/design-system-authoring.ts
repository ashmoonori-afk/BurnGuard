import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDesignSystemRules } from "@bg/shared";
import { getCatalogRow, getCurrentSystemContent } from "../db/catalog-repository";
import { getSqlite } from "../db/sqlite-client";
import { resolveManagedPath, systemsDir } from "../lib/paths";
import { DesignSystemAssetEditError } from "./extraction-asset-errors";
import { isValidFontData } from "./font-validation";
import { validateLogoSvg } from "./logo-deliverables";
import { withSystemContentAccess, type SystemContentLease } from "./system-content-access";
import { contentHash, parseContentProvenance, SystemContentError } from "./system-content-format";
import {
  contentObservationDigest, observeSystemContent, publishSystemContent,
  type ContentEnvironment, type ContentObservation, type ContentValidator,
} from "./system-content-publication";
import { readPreservedFile, safeContentChild } from "./system-content-tree";

type AuthoringWriter = "token" | "font" | "rules" | "logo";
export type AuthoringFile = { readonly path: string; readonly bytes: string | Uint8Array };
export type AuthoringEnvironment = ContentEnvironment & {
  /** Test event emitted only after the actual shared access request has entered its queue. */
  readonly onAccessQueued?: () => void;
};

async function textFile(root: string, name: string): Promise<string> {
  const bytes = await readPreservedFile(root, name);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new SystemContentError("system_content_corrupt");
  return text;
}
function authoringJournal(journal: Parameters<ContentValidator>[1]): void {
  if (journal.mode !== "replace" || journal.palette_history !== null) throw new SystemContentError("system_content_corrupt");
}

/** Stable identities shared by runtime publication and the startup recovery registry. */
export const validateTokenContent: ContentValidator = async (root, journal) => {
  authoringJournal(journal);
  if (journal.write_set.length > 1) throw new SystemContentError("system_content_corrupt");
  for (const name of journal.write_set) await textFile(root, name);
};
export const validateFontContent: ContentValidator = async (root, journal) => {
  authoringJournal(journal);
  for (const name of journal.write_set) {
    if (name.startsWith("fonts/") && name !== "fonts/fonts.css") {
      const bytes = await readPreservedFile(root, name, undefined, 16_000_000);
      if (!/\.(woff2?|ttf|otf)$/i.test(name) || !(await isValidFontData(bytes))) throw new SystemContentError("system_content_corrupt");
    } else await textFile(root, name);
  }
};
export const validateRulesContent: ContentValidator = async (root, journal) => {
  authoringJournal(journal);
  if (journal.write_set.some(name => name !== "rules.json")) throw new SystemContentError("system_content_corrupt");
  parseDesignSystemRules(JSON.parse(await textFile(root, "rules.json")));
};
export const validateLogoContent: ContentValidator = async (root, journal) => {
  authoringJournal(journal);
  for (const name of journal.write_set) await textFile(root, name);
  validateLogoSvg(await textFile(root, "assets/logo.svg"));
};
export const authoringContentValidators = {
  token: validateTokenContent, font: validateFontContent, rules: validateRulesContent, logo: validateLogoContent,
} as const;
export function authoringContentEnvironment(db: Database = getSqlite(), root: string = systemsDir): AuthoringEnvironment {
  return { db, systemsRoot: root, operationId: randomUUID, now: Date.now,
    validators: authoringContentValidators };
}

export async function withEditableSystemContent<T>(
  env: AuthoringEnvironment, id: string,
  run: (base: ContentObservation, lease: SystemContentLease) => Promise<T>,
): Promise<T> {
  const requested = withSystemContentAccess(env.db, env.systemsRoot, [id], async lease => {
    const row = getCatalogRow(env.db, id);
    if (row === null) throw new DesignSystemAssetEditError("design_system_not_found", "Design system not found");
    if (row.archivedAt !== null || row.lifecycle === "archived") throw new DesignSystemAssetEditError("design_system_archived", "Archived design systems cannot be edited");
    if (resolveManagedPath(env.systemsRoot, row.dirPath) !== path.join(env.systemsRoot, id)) {
      throw new DesignSystemAssetEditError("unsafe_managed_path", "Design system path is outside its canonical managed directory");
    }
    let base: ContentObservation;
    try { base = await observeSystemContent(env, id, lease); }
    catch (error) {
      if (error instanceof Error && "code" in error && "path" in error && typeof error.path === "string" &&
          (error.code === "EACCES" || error.code === "EPERM" || error.code === "EISDIR") &&
          row.tokensCssPath !== null &&
          resolveManagedPath(path.join(env.systemsRoot, id), error.path) === resolveManagedPath(path.join(env.systemsRoot, id), row.tokensCssPath)) {
        throw new DesignSystemAssetEditError("token_file_unreadable", "The token file cannot be read");
      }
      throw error;
    }
    return run(base, lease);
  });
  env.onAccessQueued?.();
  return requested;
}

/** The observation's validated record paths are relative to the leased live root. */
export function authoringTokenPath(base: ContentObservation): string {
  const name = base.recordPaths[2];
  if (name == null) throw new DesignSystemAssetEditError("tokens_file_missing", "Design system does not have a colors_and_type.css token file");
  return name;
}

/** Publish planned bytes once; the approved publisher owns every receipt, move and rollback. */
export async function publishAuthoringFiles(
  env: ContentEnvironment, base: ContentObservation, lease: SystemContentLease,
  writer: AuthoringWriter, files: readonly AuthoringFile[],
) {
  const changed = files.filter(file => {
    const bytes = typeof file.bytes === "string" ? Buffer.from(file.bytes) : file.bytes;
    const entry = base.tree?.inventory.find(entry => entry[1] === file.path);
    return entry?.[0] !== "file" || entry[2] !== bytes.byteLength || entry[3] !== contentHash(bytes);
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const prior = getCurrentSystemContent(env.db, base.systemId);
  const source = prior === null ? null : prior.schemaVersion === 2
    ? parseContentProvenance(JSON.parse(prior.provenanceJson)).source_extraction
    : { receipt_id: prior.operation === "content" ? prior.id : prior.parentReceiptId, digest: prior.digest };
  const validate = authoringContentValidators[writer];
  return publishSystemContent(env, {
    systemId: base.systemId, mode: "replace", expectedDigest: contentObservationDigest(base), lease,
    adapter: {
      provenance: parseContentProvenance({ format: "system-content-v1", writer, source_extraction: source }),
      writeSet: () => changed.map(file => file.path),
      transform: async (stage, _base, boundary) => {
        for (const file of changed) {
          const target = await safeContentChild(stage, ...file.path.split("/"));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, file.bytes);
        }
        await boundary("stage-state-written");
        await boundary("stage-css-written");
      },
      validate,
    },
  });
}
