#!/usr/bin/env bun
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { currentAttemptDirectory, ULW_SESSION_ID } from "./evidence";
import { QaInputError, QaPreflightError, QaTimeoutError } from "./errors";
import { publishManifest, readEvidenceManifest } from "./manifest-publication";
import {
  parseEvidenceManifest,
  type ManifestDraft,
  type ManifestExpectation,
} from "./manifest";
import { readRepositoryIdentity } from "./repository";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new QaInputError("invalid_fixture", "Expected serialized manifest object");
  }
  return value;
}

function rejects(value: unknown, expected: ManifestExpectation): boolean {
  try {
    parseEvidenceManifest(JSON.stringify(value), expected);
    return false;
  } catch (error) {
    if (error instanceof QaInputError) return true;
    throw error;
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== "--json") {
    throw new QaInputError("invalid_arguments", "Usage: manifest-smoke.ts --json");
  }
  const root = path.resolve(import.meta.dir, "../..");
  const attempt = await currentAttemptDirectory(root);
  const repository = await readRepositoryIdentity(root);
  const evidenceDirectory = await mkdtemp(path.join(attempt, "manifest-smoke."));
  const identity = {
    sessionId: ULW_SESSION_ID,
    attemptDirectory: attempt,
    runId: `manifest-smoke-${process.pid}`,
  };
  const expected = {
    evidenceDirectory,
    scenario: "task-1",
    identity,
    repository,
    backendPid: process.pid,
    port: 14079,
  };
  const draft: ManifestDraft = {
    version: 1,
    scenario: "task-1",
    identity,
    repository,
    readiness: {
      exactLog: true,
      processAlive: true,
      portOwned: true,
      authorityReady: true,
      cookieReady: true,
      capabilityReady: true,
    },
    authenticatedBackend: true,
    ownership: {
      backendPid: process.pid,
      port: 14079,
      browser: true,
      context: true,
      page: true,
      isolatedHome: true,
    },
    actions: [{ kind: "assert", name: "machine-authority", passed: true }],
    cleanup: {
      processesExited: true,
      portsFree: true,
      browsersClosed: true,
      homesRemoved: true,
      repeatedCleanupSafe: true,
    },
    execution: { status: "succeeded", exitCode: 0 },
    promptInjection: "not_applicable",
    cancelResume: "interruption_cleanup",
  };
  try {
    await publishManifest(draft, expected);
    const serialized = await readFile(path.join(evidenceDirectory, "manifest.json"), "utf8");
    const valid = object(JSON.parse(serialized));
    const validRepository = object(valid["repository"]);
    const validIdentity = object(valid["identity"]);
    const validReadiness = object(valid["readiness"]);
    const validExecution = object(valid["execution"]);
    const serializedEvidenceSanitized =
      !serialized.includes(root) &&
      !serialized.includes(attempt) &&
      !serialized.includes(process.env.HOME ?? "<missing-home>");
    const staleHeadRejected = rejects({
      ...valid,
      repository: { ...validRepository, head: "stale-head" },
    }, expected);
    const staleTreeRejected = rejects({
      ...valid,
      repository: { ...validRepository, tree: "stale-tree" },
    }, expected);
    const staleSessionRejected = rejects({
      ...valid,
      identity: { ...validIdentity, sessionId: "stale-session" },
    }, expected);
    const staleRunRejected = rejects({
      ...valid,
      identity: { ...validIdentity, runId: "stale-run" },
    }, expected);
    const staleAttemptRejected = rejects({
      ...valid,
      identity: { ...validIdentity, attemptDirectory: "<stale-attempt>" },
    }, expected);
    let missingManifestRejected = false;
    try {
      await readEvidenceManifest(path.join(evidenceDirectory, "missing.json"), expected);
    } catch (error) {
      if (error instanceof QaInputError && error.code === "manifest_missing") {
        missingManifestRejected = true;
      } else {
        throw error;
      }
    }
    let truncatedJsonRejected = false;
    try {
      parseEvidenceManifest('{"version":1', expected);
    } catch (error) {
      if (error instanceof QaInputError && error.code === "invalid_manifest_json") {
        truncatedJsonRejected = true;
      } else {
        throw error;
      }
    }
    const falseAuthorityRejected = rejects({
      ...valid,
      readiness: { ...validReadiness, authorityReady: false },
    }, expected);
    const falseReadinessRejected = rejects({
      ...valid,
      readiness: { ...validReadiness, portOwned: false },
    }, expected);
    const invalidJsonPayloadRejected = rejects([], expected);
    const missingActionsRejected = rejects({ ...valid, actions: [] }, expected);
    const { cleanup: removedCleanup, ...withoutCleanup } = valid;
    const missingCleanupRejected = removedCleanup !== undefined && rejects(withoutCleanup, expected);
    const nonzeroSuccessRejected = rejects({
      ...valid,
      execution: { ...validExecution, status: "succeeded", exitCode: 7 },
    }, expected);
    const receipt = {
      ok: true,
      serializedEvidenceSanitized,
      staleHeadRejected,
      staleTreeRejected,
      staleSessionRejected,
      staleRunRejected,
      staleAttemptRejected,
      missingManifestRejected,
      truncatedJsonRejected,
      falseAuthorityRejected,
      falseReadinessRejected,
      invalidJsonPayloadRejected,
      missingActionsRejected,
      missingCleanupRejected,
      nonzeroSuccessRejected,
    };
    const ok = Object.values(receipt).every(Boolean);
    process.stdout.write(`${JSON.stringify({ ...receipt, ok })}\n`);
    if (!ok) process.exitCode = 1;
  } finally {
    await rm(evidenceDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const code =
      error instanceof QaInputError || error instanceof QaPreflightError
        ? error.code
        : error instanceof QaTimeoutError
          ? `timeout_${error.operation.replaceAll(" ", "_")}`
          : "manifest_smoke_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exit(1);
  }
}
