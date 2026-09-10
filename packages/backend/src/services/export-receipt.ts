import { createHash } from "node:crypto";
import { parseExportOptions, type ExportFormat, type ExportOptions } from "@bg/shared";
import { parseExportValidation, type ExportValidation } from "./export-receipt-validation";
import { formatExtension } from "./export-naming";

export type ExportReceipt = {
  readonly schema_version: 1;
  readonly job_id: string;
  readonly attempt_id: string;
  readonly parent_attempt_id: string | null;
  readonly format: ExportFormat;
  readonly project: { readonly id: string; readonly revision: number; readonly digest: string };
  readonly options: ExportOptions;
  readonly output_file: string;
  readonly output_size: number;
  readonly digests: { readonly input_closure: string; readonly design_system: string | null; readonly options: string; readonly renderer: string; readonly capture: string; readonly output: string };
  readonly validation: ExportValidation;
};
export class ExportReceiptError extends Error {
  readonly name = "ExportReceiptError";
  constructor(readonly code: "invalid_receipt" | "identity_mismatch" | "digest_mismatch") { super(code); }
}

export function canonicalJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
export function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function receiptDigest(receipt: ExportReceipt): string { return sha256(canonicalJson(receipt)); }

export function parseExportReceipt(input: unknown): ExportReceipt {
  if (!isRecord(input) || !exact(input, ["schema_version", "job_id", "attempt_id", "parent_attempt_id", "format", "project", "options", "output_file", "output_size", "digests", "validation"]) || input["schema_version"] !== 1) fail("invalid_receipt");
  const project = input["project"]; const digests = input["digests"];
  if (!isRecord(project) || !exact(project, ["id", "revision", "digest"]) || !isRecord(digests) || !exact(digests, ["input_closure", "design_system", "options", "renderer", "capture", "output"]) || !isRecord(input["options"])) fail("invalid_receipt");
  const format = input["format"];
  if (format !== "html_zip" && format !== "pdf" && format !== "png" && format !== "pptx" && format !== "handoff" && format !== "cafe24_package" && format !== "imweb_package" && format !== "png_zip") fail("invalid_receipt");
  const parent = input["parent_attempt_id"]; const design = digests["design_system"];
  if (!string(input["job_id"]) || !string(input["attempt_id"]) || (parent !== null && !string(parent)) || !string(project["id"]) || !integer(project["revision"]) || !digest(project["digest"]) || input["output_file"] !== `artifact.${formatExtension(format)}` || !positiveInteger(input["output_size"]) || !digest(digests["input_closure"]) || (design !== null && !digest(design)) || !digest(digests["options"]) || !digest(digests["renderer"]) || !digest(digests["capture"]) || !digest(digests["output"])) fail("invalid_receipt");
  try {
    const options = parseExportOptions(format, input["options"]); if (canonicalJson(options) !== canonicalJson(input["options"]) || digests["options"] !== sha256(canonicalJson(options))) fail("invalid_receipt"); const validation = parseExportValidation(format, options, input["validation"]);
    return { schema_version: 1, job_id: input["job_id"], attempt_id: input["attempt_id"], parent_attempt_id: parent, format, project: { id: project["id"], revision: project["revision"], digest: project["digest"] }, options, output_file: input["output_file"], output_size: input["output_size"], digests: { input_closure: digests["input_closure"], design_system: design, options: digests["options"], renderer: digests["renderer"], capture: digests["capture"], output: digests["output"] }, validation };
  } catch (error) { if (error instanceof ExportReceiptError) throw error; fail("invalid_receipt"); }
}

export type ReceiptAuthority = { readonly jobId: string; readonly attemptId: string; readonly parentAttemptId: string | null; readonly projectId: string; readonly projectRevision: number; readonly projectDigest: string; readonly format: ExportFormat; readonly options: ExportOptions; readonly optionsDigest: string; readonly inputClosureDigest: string | null; readonly designSystemDigest: string | null; readonly rendererDigest: string; readonly captureDigest: string; readonly outputFile: string; readonly outputDigest: string; readonly outputSize: number };
export function requireReceiptIdentity(receipt: ExportReceipt, expected: ReceiptAuthority): void {
  if (receipt.job_id !== expected.jobId || receipt.attempt_id !== expected.attemptId || receipt.parent_attempt_id !== expected.parentAttemptId || receipt.project.id !== expected.projectId || receipt.project.revision !== expected.projectRevision || receipt.project.digest !== expected.projectDigest || receipt.format !== expected.format || canonicalJson(receipt.options) !== canonicalJson(expected.options) || receipt.output_file !== expected.outputFile || receipt.output_size !== expected.outputSize) fail("identity_mismatch");
  if (receipt.digests.options !== expected.optionsDigest || receipt.digests.input_closure !== expected.inputClosureDigest || receipt.digests.design_system !== expected.designSystemDigest || receipt.digests.renderer !== expected.rendererDigest || receipt.digests.capture !== expected.captureDigest || receipt.digests.output !== expected.outputDigest) fail("digest_mismatch");
}
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function string(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function positiveInteger(value: unknown): value is number { return integer(value) && value > 0; }
function digest(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value); }
function fail(code: ExportReceiptError["code"]): never { throw new ExportReceiptError(code); }
