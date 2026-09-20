import { type OwnedProcess, OwnedProcessHostError, settleOwnedProcess, terminateOwnedProcess } from "../adapters/owned-process";
import { OwnedProcessTreeCleanupError } from "../adapters/owned-process-tree";

const TERM_GRACE_MS = 250;
const KILL_GRACE_MS = 2_000;

export const MAX_LOCAL_DEPTH = 16;
export const MAX_LOCAL_FILES = 512;
export const MAX_AGGREGATE_SOURCE_BYTES = 16_000_000;
export const MAX_SOURCE_FILE_BYTES = 2_000_000;
export const MAX_HTML_BYTES = 900_000;
export const MAX_CSS_BYTES = 700_000;
export const MAX_UPLOAD_BYTES = 48_000_000;
export const MAX_FIGMA_BODY_BYTES = 8_000_000;
export const MAX_PARSED_ITEMS = 10_000;
export const MAX_FETCH_REDIRECTS = 5;
export const MAX_FETCH_ASSETS = 64;
export const MAX_PUBLICATION_UNITS = 2_000;
export const MAX_CSS_DECLARATIONS = 10_000;
export const MAX_CSS_ISSUES = 1_000;
export const MAX_CSS_WORKER_INPUT_BYTES = 1_500_000;
export const MAX_CSS_WORKER_OUTPUT_BYTES = 4_000_000;
export const MAX_ASSET_BYTES = 64_000_000;
export const MAX_PUBLICATION_BYTES = 96_000_000;

export type AcquisitionLimits = {
  readonly localDepth: number;
  readonly localFiles: number;
  readonly aggregateSourceBytes: number;
  readonly sourceFileBytes: number;
  readonly htmlBytes: number;
  readonly cssBytes: number;
  readonly uploadBytes: number;
  readonly figmaBodyBytes: number;
  readonly parsedItems: number;
  readonly redirects: number;
  readonly assets: number;
  readonly assetBytes: number;
  readonly publicationUnits: number;
  readonly publicationBytes: number;
  readonly cssDeclarations: number;
  readonly cssIssues: number;
  readonly cssWorkerInputBytes: number;
  readonly cssWorkerOutputBytes: number;
};

export const DEFAULT_ACQUISITION_LIMITS: AcquisitionLimits = Object.freeze({
  localDepth: MAX_LOCAL_DEPTH,
  localFiles: MAX_LOCAL_FILES,
  aggregateSourceBytes: MAX_AGGREGATE_SOURCE_BYTES,
  sourceFileBytes: MAX_SOURCE_FILE_BYTES,
  htmlBytes: MAX_HTML_BYTES,
  cssBytes: MAX_CSS_BYTES,
  uploadBytes: MAX_UPLOAD_BYTES,
  figmaBodyBytes: MAX_FIGMA_BODY_BYTES,
  parsedItems: MAX_PARSED_ITEMS,
  redirects: MAX_FETCH_REDIRECTS,
  assets: MAX_FETCH_ASSETS,
  assetBytes: MAX_ASSET_BYTES,
  publicationUnits: MAX_PUBLICATION_UNITS,
  publicationBytes: MAX_PUBLICATION_BYTES,
  cssDeclarations: MAX_CSS_DECLARATIONS,
  cssIssues: MAX_CSS_ISSUES,
  cssWorkerInputBytes: MAX_CSS_WORKER_INPUT_BYTES,
  cssWorkerOutputBytes: MAX_CSS_WORKER_OUTPUT_BYTES,
});

export function acquisitionLimits(overrides: Partial<AcquisitionLimits>): AcquisitionLimits {
  return Object.freeze({ ...DEFAULT_ACQUISITION_LIMITS, ...overrides });
}

export type AcquisitionLimit =
  | "local_depth" | "local_files" | "aggregate_source_bytes" | "source_file_bytes"
  | "html_bytes" | "css_bytes" | "upload_bytes" | "figma_body_bytes"
  | "parsed_items" | "redirects" | "assets" | "asset_bytes" | "publication_units" | "publication_bytes"
  | "css_declarations" | "css_issues" | "css_worker_input_bytes" | "css_worker_output_bytes";

export class AcquisitionLimitError extends Error {
  readonly name = "AcquisitionLimitError";
  constructor(readonly limit: AcquisitionLimit, readonly maximum: number, readonly observed: number) {
    super(`acquisition_limit:${limit}:${observed}>${maximum}`);
  }
}

export type OwnedChildCleanupReceipt = {
  readonly pid: number;
  readonly exitCode: number;
  readonly termSent: boolean;
  readonly killSent: boolean;
  readonly pidAbsent: boolean;
};

export type OwnedWorkerCleanupReceipt = {
  readonly kind: "worker";
  readonly workerToken: string;
  readonly terminated: true;
  readonly closed: true;
  readonly closeCode: number;
};

export type OwnedCleanupReceipt = OwnedChildCleanupReceipt | OwnedWorkerCleanupReceipt;

export class ExtractionAcquisitionError extends Error {
  readonly name = "ExtractionAcquisitionError";
  constructor(
    readonly code: "acquisition_timeout" | "acquisition_aborted",
    readonly cleanupReceipt: OwnedCleanupReceipt | null = null,
  ) {
    super(code);
  }
}

export class OwnedChildCleanupError extends Error {
  readonly name = "OwnedChildCleanupError";
  constructor(readonly pid: number) {
    super(`owned_child_cleanup_unproven:${pid}`);
  }
}

export type AcquisitionBudget = {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  readonly limits: AcquisitionLimits;
  readonly dispose: () => void;
};

export function createAcquisitionBudget(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
): AcquisitionBudget {
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(new ExtractionAcquisitionError("acquisition_aborted"));
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new ExtractionAcquisitionError("acquisition_timeout")), timeoutMs);
  return {
    signal: controller.signal,
    deadlineAt: Date.now() + timeoutMs,
    limits,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

export function throwIfAcquisitionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw acquisitionAbort(signal);
}

export async function awaitChildWithAbort(
  child: OwnedProcess<Bun.Subprocess>,
  signal: AbortSignal,
): Promise<OwnedChildCleanupReceipt> {
  const proc = child.proc;
  const exactExit = proc.exited;
  let notifyAbort: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => { notifyAbort = resolve; });
  let cleanup: Promise<{ readonly exitCode: number; readonly killSent: boolean }> | undefined;
  const onAbort = (): void => {
    // The async helper snapshots and signals synchronously, before ancestry can be lost.
    cleanup ??= terminateOwnedProcess(child, TERM_GRACE_MS, KILL_GRACE_MS);
    // Observe rejection immediately; the exit path below still awaits and propagates it.
    void cleanup.then(() => notifyAbort?.(), () => notifyAbort?.());
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    await Promise.race([exactExit, aborted]);
    if (cleanup === undefined) {
      const exitCode = await exactExit;
      if (child.ownership.kind === "windows-job") await settleOwnedProcess(child, exitCode);
      return receipt(proc.pid, exitCode, false, false);
    }
    const result = await cleanup;
    throw acquisitionAbort(signal, receipt(proc.pid, result.exitCode, true, result.killSent));
  } catch (error) {
    if (error instanceof OwnedProcessTreeCleanupError || error instanceof OwnedProcessHostError) throw new OwnedChildCleanupError(proc.pid);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function abortable<T>(operation: Promise<T>, signal: AbortSignal, cancel: () => void): Promise<T> {
  throwIfAcquisitionAborted(signal);
  let rejectAbort: ((error: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = (): void => {
    cancel();
    rejectAbort?.(acquisitionAbort(signal));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function acquisitionAbort(signal: AbortSignal, cleanupReceipt: OwnedCleanupReceipt | null = null): ExtractionAcquisitionError {
  const code = signal.reason instanceof ExtractionAcquisitionError ? signal.reason.code : "acquisition_aborted";
  return new ExtractionAcquisitionError(code, cleanupReceipt);
}

function receipt(pid: number, exitCode: number, termSent: boolean, killSent: boolean): OwnedChildCleanupReceipt {
  return { pid, exitCode, termSent, killSent, pidAbsent: isPidAbsent(pid) };
}

function isPidAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}
