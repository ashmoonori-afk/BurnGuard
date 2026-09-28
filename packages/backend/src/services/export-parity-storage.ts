import { readFile } from "node:fs/promises";
import {
  parseExportParitySummary,
  type ExportJob,
  type ExportParitySummary,
} from "@bg/shared";
import { getExportJob } from "../db/exports";
import { exportsDir } from "../lib/paths";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import {
  EXPORT_PARITY_DIRECTORY,
  EXPORT_PARITY_FILE,
} from "./export-parity-artifacts";
import { parsePng } from "./export-png-validation";
import { parseExportReceipt, sha256 } from "./export-receipt";
import { buildStructuralParity } from "./export-parity";

export class ExportParityStorageError extends Error {
  readonly name = "ExportParityStorageError";
  constructor(readonly code: "not_found" | "unavailable" | "corrupt") {
    super(code);
  }
}

export async function attachExportParity(job: ExportJob): Promise<ExportJob> {
  return { ...job, parity: await readParitySummary(job) };
}

export async function readExportParityThumbnail(
  jobId: string,
  page: number,
): Promise<Uint8Array> {
  const job = await getExportJob(jobId);
  if (job === null) throw new ExportParityStorageError("not_found");
  const summary = await readParitySummary(job);
  const parityPage = summary?.pages[page - 1];
  if (
    parityPage === undefined ||
    parityPage.page !== page ||
    !parityPage.thumbnail_available ||
    parityPage.thumbnail_sha256 === null
  ) {
    throw new ExportParityStorageError("unavailable");
  }
  const attempt = job.latest_attempt;
  if (attempt === null) throw new ExportParityStorageError("unavailable");
  const filePath = resolveWithin(
    exportsDir,
    "attempts",
    assertSafeName(attempt.id),
    EXPORT_PARITY_DIRECTORY,
    "thumbnails",
    `page-${String(page).padStart(3, "0")}.png`,
  );
  try {
    const bytes = new Uint8Array(await readFile(filePath));
    parsePng(bytes);
    if (sha256(bytes) !== parityPage.thumbnail_sha256) {
      throw new ExportParityStorageError("corrupt");
    }
    return bytes;
  } catch (error) {
    if (error instanceof ExportParityStorageError) throw error;
    throw new ExportParityStorageError("corrupt");
  }
}

async function readParitySummary(
  job: ExportJob,
): Promise<ExportParitySummary | null> {
  const attempt = job.latest_attempt;
  if (
    job.status !== "succeeded" ||
    attempt === null ||
    attempt.status !== "validated" ||
    !attempt.retention.output_available
  ) {
    return null;
  }
  const attemptRoot = resolveWithin(exportsDir, "attempts", assertSafeName(attempt.id));
  let expectedDigest: string | undefined;
  try {
    expectedDigest = parseExportReceipt(JSON.parse(await readFile(resolveWithin(attemptRoot, "receipt.json"), "utf8"))).digests.parity;
  } catch (error) {
    if (error instanceof Error) return unavailableParity();
    throw error;
  }
  // Attempts published before parity evidence existed carry no parity digest and no summary.
  if (expectedDigest === undefined) return null;
  try {
    const bytes = new Uint8Array(await readFile(resolveWithin(attemptRoot, EXPORT_PARITY_DIRECTORY, EXPORT_PARITY_FILE)));
    if (sha256(bytes) !== expectedDigest) return unavailableParity();
    return parseExportParitySummary(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof Error) return unavailableParity();
    throw error;
  }
}

/** Missing or corrupt evidence is shown as an explicit warning; it never blocks the download. */
function unavailableParity(): ExportParitySummary {
  return buildStructuralParity({ sourcePageCount: null, outputPageCount: null, comparisonUnavailable: true });
}
