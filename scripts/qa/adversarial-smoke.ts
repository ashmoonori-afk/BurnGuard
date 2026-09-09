#!/usr/bin/env bun
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { __testParseStatus } from "./evidence";
import { QaInputError, QaPreflightError } from "./errors";
import { parseSanitizedAction } from "./manifest";
import {
  assertRepositoryIdentity,
  readRepositoryIdentity,
} from "./repository";
import { parseQaPort } from "./runtime";

function rejectsTyped(action: () => void): boolean {
  try {
    action();
    return false;
  } catch (error) {
    if (error instanceof QaInputError || error instanceof QaPreflightError) return true;
    throw error;
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== "--json") {
    throw new QaInputError("invalid_arguments", "Usage: adversarial-smoke.ts --json");
  }
  const root = path.resolve(import.meta.dir, "../..");
  const controlPlane = path.join(root, ".omo", `qa-control-${process.pid}`);
  await mkdir(path.dirname(controlPlane), { recursive: true });
  await writeFile(controlPlane, "control before\n", { flag: "wx" });
  const controlBaseline = await readRepositoryIdentity(root);
  await writeFile(controlPlane, "control after\n");
  const controlAfter = await readRepositoryIdentity(root);
  const controlPlaneStable =
    controlBaseline.statusDigest === controlAfter.statusDigest &&
    controlBaseline.statusCount === controlAfter.statusCount;
  await rm(controlPlane, { force: true });

  const sentinel = path.join(root, `.qa-sentinel-${process.pid}`);
  let dirtyDeltaRejected = false;
  try {
    await writeFile(sentinel, "worker-owned sentinel before\n", { flag: "wx" });
    const baseline = await readRepositoryIdentity(root);
    await writeFile(sentinel, "worker-owned sentinel after\n");
    try {
      assertRepositoryIdentity(await readRepositoryIdentity(root), baseline);
    } catch (error) {
      if (error instanceof QaPreflightError && error.code === "dirty_worktree_delta") {
        dirtyDeltaRejected = true;
      } else {
        throw error;
      }
    }
  } finally {
    await rm(sentinel, { force: true });
  }
  const trackedPath = path.join(root, "package.json");
  const trackedContent = await readFile(trackedPath, "utf8");
  const trackedBaseline = await readRepositoryIdentity(root);
  let trackedProductMutationRejected = false;
  try {
    const trackedMutation = trackedContent.replace(
      '"name": "burnguard-design"',
      '"name": "burnguard-design-qa"',
    );
    if (trackedMutation === trackedContent) {
      throw new QaPreflightError("mutation_missing", "Tracked fixture mutation did not apply");
    }
    await writeFile(trackedPath, trackedMutation);
    try {
      assertRepositoryIdentity(await readRepositoryIdentity(root), trackedBaseline);
    } catch (error) {
      if (error instanceof QaPreflightError && error.code === "dirty_worktree_delta") {
        trackedProductMutationRejected = true;
      } else {
        throw error;
      }
    }
  } finally {
    await writeFile(trackedPath, trackedContent);
  }

  const baseline = await readRepositoryIdentity(root);
  let staleIdentityRejected = false;
  try {
    assertRepositoryIdentity(baseline, { ...baseline, tree: "stale-tree" });
  } catch (error) {
    if (error instanceof QaPreflightError && error.code === "stale_repository") {
      staleIdentityRejected = true;
    } else {
      throw error;
    }
  }
  const malformedStatusRejected = rejectsTyped(() => __testParseStatus('{"currentAttemptDir":'));
  const malformedActionRejected = rejectsTyped(() =>
    parseSanitizedAction({ kind: "provider-output", name: "unsafe", passed: true }),
  );
  const malformedPortRejected = rejectsTyped(() => parseQaPort("14079-token"));
  const receipt = {
    ok:
      controlPlaneStable &&
      dirtyDeltaRejected &&
      trackedProductMutationRejected &&
      staleIdentityRejected &&
      malformedStatusRejected &&
      malformedActionRejected &&
      malformedPortRejected,
    controlPlaneStable,
    dirtyDeltaRejected,
    trackedProductMutationRejected,
    staleIdentityRejected,
    malformedStatusRejected,
    malformedActionRejected,
    malformedPortRejected,
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.ok) process.exit(1);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const code = error instanceof QaInputError ? error.code : "adversarial_failure";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exit(1);
  }
}
