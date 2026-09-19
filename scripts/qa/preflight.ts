#!/usr/bin/env bun
import { access } from "node:fs/promises";
import path from "node:path";
import { findChromiumExecutable } from "./chromium";
import { currentAttemptDirectory } from "./evidence";
import { QaInputError, QaPreflightError, QaTimeoutError } from "./errors";
import {
  assertExpectedRepository,
  readRepositoryIdentity,
  type RepositoryIdentity,
} from "./repository";
import { isPortFree, parseQaPort } from "./runtime";
import { attemptId, repositoryForEvidence } from "./sanitization";

const DEFAULT_PORT = "14079";
const COMMAND_TIMEOUT_MS = 30_000;

type PreflightChecks = {
  readonly repository: boolean;
  readonly branch: boolean;
  readonly origin: boolean;
  readonly base: boolean;
  readonly headAndTree: boolean;
  readonly attemptIgnored: boolean;
  readonly jq: boolean;
  readonly quickLook: boolean;
  readonly chromium: boolean;
  readonly portFree: boolean;
  readonly authenticatedBackend: boolean;
};

type PreflightManifest = {
  readonly ok: boolean;
  readonly repository: RepositoryIdentity;
  readonly attemptDirectory: string;
  readonly port: number;
  readonly checks: PreflightChecks;
};

async function commandPasses(command: readonly [string, ...string[]]): Promise<boolean> {
  if (Bun.which(command[0]) === null) return false;
  const child = Bun.spawn([...command], {
    stdout: "ignore",
    stderr: "ignore",
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill();
      reject(new QaTimeoutError(`command ${command[0] ?? "unknown"}`));
    }, COMMAND_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([child.exited, timeout])) === 0;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function hasAuthenticatedBackend(): Promise<boolean> {
  const probes = [
    ["codex", "login", "status"],
    ["claude", "auth", "status", "--json"],
  ] as const;
  for (const probe of probes) {
    try {
      if (await commandPasses(probe)) return true;
    } catch (error) {
      if (!(error instanceof QaTimeoutError)) throw error;
    }
  }
  return false;
}

function parseArguments(args: readonly string[]): { readonly json: boolean } {
  if (args.length === 1 && args[0] === "--json") return { json: true };
  throw new QaInputError("invalid_arguments", "Usage: preflight.ts --json");
}

export async function runPreflight(
  repoRoot: string,
  portInput = process.env.BG_PORT ?? DEFAULT_PORT,
): Promise<PreflightManifest> {
  const port = parseQaPort(portInput);
  const [repository, attemptDirectory, jq, quickLook, chromiumInstalled, portFree, authenticated] =
    await Promise.all([
      readRepositoryIdentity(repoRoot),
      currentAttemptDirectory(repoRoot),
      commandPasses(["jq", "--version"]),
      access("/usr/bin/qlmanage").then(() => true, (error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      }),
      findChromiumExecutable().then(() => true),
      isPortFree(port),
      hasAuthenticatedBackend(),
    ]);
  assertExpectedRepository(repository, import.meta.dir);
  const checks = {
    repository: true,
    branch: true,
    origin: true,
    base: true,
    headAndTree: repository.head.length === 40 && repository.tree.length === 40,
    attemptIgnored: true,
    jq,
    quickLook,
    chromium: chromiumInstalled,
    portFree,
    authenticatedBackend: authenticated,
  };
  const failedCheck = Object.entries(checks).find((entry) => !entry[1])?.[0];
  if (failedCheck !== undefined) {
    throw new QaPreflightError(`preflight_${failedCheck}`, "One preflight check failed");
  }
  return { ok: true, repository, attemptDirectory, port, checks };
}

async function main(): Promise<void> {
  parseArguments(process.argv.slice(2));
  const repoRoot = path.resolve(import.meta.dir, "../..");
  const manifest = await runPreflight(repoRoot);
  process.stdout.write(`${JSON.stringify({
    ok: manifest.ok,
    repository: repositoryForEvidence(manifest.repository),
    attemptId: attemptId(repoRoot, manifest.attemptDirectory),
    port: manifest.port,
    checks: manifest.checks,
  })}\n`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    // CLI boundary emits only typed machine codes; never provider output or environment.
    const code =
      error instanceof QaInputError || error instanceof QaPreflightError
        ? error.code
        : error instanceof QaTimeoutError
          ? `timeout_${error.operation.replaceAll(" ", "_")}`
          : "unexpected_failure";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exit(1);
  }
}
