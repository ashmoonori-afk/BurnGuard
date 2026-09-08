import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRepoRoot } from "../lib/paths";
import {
  AcquisitionLimitError,
  DEFAULT_ACQUISITION_LIMITS,
  ExtractionAcquisitionError,
  acquisitionAbort,
  createAcquisitionBudget,
  throwIfAcquisitionAborted,
  type AcquisitionLimits,
  type OwnedWorkerCleanupReceipt,
} from "./extraction-acquisition";

export const MAX_CSS_PARSE_BYTES = DEFAULT_ACQUISITION_LIMITS.cssBytes;
export const MAX_CSS_DECLARATIONS = DEFAULT_ACQUISITION_LIMITS.cssDeclarations;

export type CssParseIssue = {
  readonly key: string;
  readonly reason: "malformed_css" | "unsupported_css_value" | "css_input_too_large" | "css_declaration_limit" | "css_issue_limit";
  readonly sourceLocator: string;
};

export type CssDeclarationEvidence = {
  readonly property: string;
  readonly value: string;
  readonly sourceLocator: string;
  readonly fileOrder: number;
  readonly declarationOrder: number;
  readonly parseStatus: "observed";
};

export type CssParseResult = {
  readonly declarations: readonly CssDeclarationEvidence[];
  readonly issues: readonly CssParseIssue[];
};

export type CssParseRequest = {
  readonly content: string;
  readonly sourceId?: string;
  readonly fileOrder?: number;
  readonly signal?: AbortSignal;
  readonly limits?: AcquisitionLimits;
  readonly workerUrl?: URL;
};

type WorkerOutcome =
  | { readonly kind: "message"; readonly value: unknown }
  | { readonly kind: "error"; readonly error: Error };
type AbortOutcome = { readonly kind: "aborted" };

export async function parseCssSource(request: CssParseRequest): Promise<CssParseResult> {
  const limits = request.limits ?? DEFAULT_ACQUISITION_LIMITS;
  const sourceId = request.sourceId ?? "inline.css";
  const bytes = Buffer.byteLength(request.content);
  if (bytes > limits.cssBytes) {
    return { declarations: [], issues: [{ key: "css-input", reason: "css_input_too_large", sourceLocator: `${sourceId}:1:1` }] };
  }
  const ownedBudget = request.signal === undefined ? createAcquisitionBudget(undefined, 30_000, limits) : null;
  const signal = request.signal ?? ownedBudget?.signal;
  if (signal === undefined) throw new ExtractionAcquisitionError("acquisition_aborted");
  throwIfAcquisitionAborted(signal);
  const workerToken = randomUUID();
  const workerInput = {
    content: request.content,
    sourceId,
    fileOrder: request.fileOrder ?? 0,
    workerToken,
    declarationLimit: limits.cssDeclarations,
    issueLimit: limits.cssIssues,
  };
  const inputBytes = Buffer.byteLength(JSON.stringify(workerInput));
  if (inputBytes > limits.cssWorkerInputBytes) {
    ownedBudget?.dispose();
    throw new AcquisitionLimitError("css_worker_input_bytes", limits.cssWorkerInputBytes, inputBytes);
  }
  const packagedWorker = path.join(resolveRepoRoot(), "extraction-css-worker.js");
  const workerUrl = existsSync(packagedWorker) ? pathToFileURL(packagedWorker) : new URL("./extraction-css-worker.ts", import.meta.url);
  const worker = new Worker(request.workerUrl ?? workerUrl);
  let resolveMessage: ((outcome: WorkerOutcome) => void) | undefined;
  let resolveAbort: ((outcome: AbortOutcome) => void) | undefined;
  let resolveClose: ((closeCode: number) => void) | undefined;
  const message = new Promise<WorkerOutcome>((resolve) => { resolveMessage = resolve; });
  const aborted = new Promise<AbortOutcome>((resolve) => { resolveAbort = resolve; });
  const closed = new Promise<number>((resolve) => { resolveClose = resolve; });
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (isRecord(event.data) && event.data.kind === "started") return;
    resolveMessage?.({ kind: "message", value: event.data });
  };
  const onError = (event: ErrorEvent): void => resolveMessage?.({ kind: "error", error: new CssParserWorkerError(event.message) });
  const onClose = (event: Event): void => resolveClose?.(event instanceof CloseEvent ? event.code : 0);
  const onAbort = (): void => resolveAbort?.({ kind: "aborted" });
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError, { once: true });
  worker.addEventListener("close", onClose, { once: true });
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) resolveAbort?.({ kind: "aborted" });
    worker.postMessage(workerInput);
    const outcome = await Promise.race([message, aborted]);
    if (outcome.kind === "aborted") {
      worker.terminate();
      const closeCode = await closed;
      throw acquisitionAbort(signal, workerReceipt(workerToken, closeCode));
    }
    const completion = signal.aborted
      ? { kind: "aborted" as const }
      : await Promise.race([closed.then(() => ({ kind: "closed" as const })), aborted]);
    if (completion.kind === "aborted") {
      worker.terminate();
      const closeCode = await closed;
      throw acquisitionAbort(signal, workerReceipt(workerToken, closeCode));
    }
    if (outcome.kind === "error") throw outcome.error;
    const outputBytes = Buffer.byteLength(JSON.stringify(outcome.value));
    if (outputBytes > limits.cssWorkerOutputBytes) {
      throw new AcquisitionLimitError("css_worker_output_bytes", limits.cssWorkerOutputBytes, outputBytes);
    }
    return parseWorkerResult(outcome.value, limits);
  } finally {
    signal.removeEventListener("abort", onAbort);
    worker.removeEventListener("message", onMessage);
    ownedBudget?.dispose();
  }
}

class CssParserWorkerError extends Error {
  readonly name = "CssParserWorkerError";
}

function parseWorkerResult(value: unknown, limits: AcquisitionLimits): CssParseResult {
  if (!isRecord(value) || value.kind !== "result" || !isRecord(value.result) || !Array.isArray(value.result.declarations) || !Array.isArray(value.result.issues)) {
    throw new CssParserWorkerError("css_parser_worker_invalid_output");
  }
  if (value.result.declarations.length > limits.cssDeclarations) {
    throw new AcquisitionLimitError("css_declarations", limits.cssDeclarations, value.result.declarations.length);
  }
  if (value.result.issues.length > limits.cssIssues + 1) {
    throw new AcquisitionLimitError("css_issues", limits.cssIssues, value.result.issues.length);
  }
  if (!value.result.declarations.every(isCssDeclaration) || !value.result.issues.every(isCssIssue)) {
    throw new CssParserWorkerError("css_parser_worker_invalid_output");
  }
  return { declarations: value.result.declarations, issues: value.result.issues };
}

function isCssDeclaration(value: unknown): value is CssDeclarationEvidence {
  return isRecord(value) && typeof value.property === "string" && typeof value.value === "string" && typeof value.sourceLocator === "string" &&
    typeof value.fileOrder === "number" && typeof value.declarationOrder === "number" && value.parseStatus === "observed";
}

function isCssIssue(value: unknown): value is CssParseIssue {
  return isRecord(value) && typeof value.key === "string" && typeof value.sourceLocator === "string" &&
    ["malformed_css", "unsupported_css_value", "css_input_too_large", "css_declaration_limit", "css_issue_limit"].includes(String(value.reason));
}

function workerReceipt(workerToken: string, closeCode: number): OwnedWorkerCleanupReceipt {
  return { kind: "worker", workerToken, terminated: true, closed: true, closeCode };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
