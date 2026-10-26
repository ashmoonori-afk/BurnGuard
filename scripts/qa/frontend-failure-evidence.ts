#!/usr/bin/env bun
// F06: preserve the next failure, not a guessed fix for the unrecovered hpdesk failure.
import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const OUTPUT_LIMIT = 4 * 1024 * 1024;
const RUN_TIMEOUT = 15 * 60 * 1000;

export interface CapturedOutput {
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly complete: boolean;
}

/** Drain even after the byte cap so evidence collection cannot deadlock the test process. */
export async function captureOutput(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<CapturedOutput> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let retained = 0;
  const reader = stream.getReader();
  let complete = true;
  const cancel = () => {
    complete = false;
    // Closing this reader releases a pending read even if a descendant still owns the pipe.
    void reader.cancel().catch(() => console.error("frontend_evidence_output_cancel_failed"));
  };
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      bytes += chunk.length;
      const kept = chunk.subarray(0, Math.max(0, OUTPUT_LIMIT - retained));
      if (kept.length > 0) chunks.push(kept);
      retained += kept.length;
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes, truncated: retained < bytes, complete };
}

/** Identities come from executed runner records, never source-text test-name guesses. */
export function testRecords(text: string): readonly { readonly file: string; readonly status: string; readonly name: string }[] {
  let file = "";
  const records: { file: string; status: string; name: string }[] = [];
  for (const line of text.split("\n")) {
    // Bun's final recap repeats records without their original file headers.
    if (/^\d+ tests? (?:skipped|failed):$/.test(line)) file = "";
    const header = line.replaceAll("\\", "/").replace(/^\.\//, "");
    if (/^packages\/frontend\/tests\/.*\.test\.tsx?:$/.test(header)) file = header.slice(0, -1);
    const match = /^\((pass|fail|skip|todo)\) (.*?)(?: \[\d+(?:\.\d+)?m?s\])?$/.exec(line);
    if (match && file) records.push({ file, status: match[1], name: match[2] });
  }
  return records;
}

/** Public logs carry only stable digests; names and diagnostics remain in the encrypted evidence. */
export function failedTestDigests(
  records: readonly { readonly file: string; readonly status: string; readonly name: string }[],
): readonly string[] {
  return records
    .filter(record => record.status === "fail")
    .map(record => createHash("sha256").update(`${record.file}\t${record.name}`).digest("hex"))
    .sort();
}

/** Only ciphertext leaves the runner. The RSA private key stays with the evidence owner. */
export function sealEvidence(plaintext: string, recipientPem: string): string {
  const recipient = createPublicKey(recipientPem);
  if (recipient.asymmetricKeyType !== "rsa" || (recipient.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
    throw new Error("evidence_recipient_invalid");
  }
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({
    schema: 1, algorithm: "RSA-OAEP-SHA256/AES-256-GCM",
    key: publicEncrypt({ key: recipient, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, key).toString("base64"),
    iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

if (import.meta.main) {
  try {
    if (Bun.version !== "1.3.14") throw new Error("evidence_bun_version");
    const recipient = process.env.BG_FRONTEND_EVIDENCE_PUBLIC_KEY;
    if (!recipient) throw new Error("evidence_recipient_missing");
    // Validate before any install/test starts; never fall back to publishing plaintext.
    sealEvidence("", recipient);
    const root = path.resolve(import.meta.dir, "../..");
    const destination = process.env.BG_FRONTEND_EVIDENCE_DIRECTORY;
    if (!destination || !path.isAbsolute(destination)) throw new Error("evidence_directory_required");
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
    const revision = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [commit, revisionError, revisionExit] = await Promise.all([
      new Response(revision.stdout).text(), new Response(revision.stderr).text(), revision.exited,
    ]);
    if (revisionExit !== 0 || revisionError) throw new Error("evidence_revision_failed");
    const manifest = [...new Bun.Glob("packages/frontend/tests/**/*.test.{ts,tsx}").scanSync({ cwd: root })].sort();
    if (manifest.length === 0) throw new Error("evidence_manifest_empty");
    const lock = await readFile(path.join(root, "bun.lock"));
    // No provider credentials, launch authority or recipient configuration reach the child.
    const environment = {
      PATH: process.env.PATH ?? "", HOME: os.homedir(), TMPDIR: os.tmpdir(),
      CI: "1", LANG: "en_US.UTF-8", TZ: "Asia/Seoul", NO_COLOR: "1", FORCE_COLOR: "0",
    };
    const command = [process.execPath, "test", "--timeout", "30000", ...manifest];
    const receipt = {
      schema: 1, commit: commit.trim(), lock_sha256: digest(lock),
      manifest, manifest_sha256: digest(JSON.stringify(manifest)), command,
      environment, bun: Bun.version, platform: process.platform, arch: process.arch,
      output_limit_per_stream: OUTPUT_LIMIT,
    };
    const results: { phase: string; command: string[]; exit: number; signal: string | null; timed_out: boolean; stdout: CapturedOutput; stderr: CapturedOutput }[] = [];
    for (const [phase, invocation] of [
      ["install", [process.execPath, "install", "--frozen-lockfile"]],
      ["fresh", command],
      ["warm", command],
    ] satisfies [string, string[]][]) {
      const child = Bun.spawn(invocation, {
        cwd: root, env: environment, stdout: "pipe", stderr: "pipe",
      });
      const deadline = new AbortController();
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        deadline.abort();
      }, RUN_TIMEOUT);
      try {
        const [stdout, stderr, exit] = await Promise.all([
          captureOutput(child.stdout, deadline.signal), captureOutput(child.stderr, deadline.signal), child.exited,
        ]);
        results.push({ phase, command: invocation, exit, signal: child.signalCode, timed_out: deadline.signal.aborted, stdout, stderr });
        console.log(`frontend evidence: ${phase} exit=${exit} timed_out=${deadline.signal.aborted}`);
        if ((phase === "install" && exit !== 0) || deadline.signal.aborted) break;
      } finally {
        clearTimeout(timer);
      }
      if (digest(await readFile(path.join(root, "bun.lock"))) !== receipt.lock_sha256) throw new Error("evidence_lock_changed");
    }
    const tests = results.filter(result => result.phase !== "install").map(result => ({
      phase: result.phase, records: testRecords(`${result.stdout.text}\n${result.stderr.text}`),
    }));
    const names = tests.map(run => run.records.map(record => `${record.file}\t${record.name}`).sort());
    const sameNames = names.length === 2 && names.every(run => run.length > 0) && JSON.stringify(names[0]) === JSON.stringify(names[1]);
    const statuses = tests.map(run => run.records.map(record => `${record.file}\t${record.name}\t${record.status}`).sort());
    const sameStatuses = statuses.length === 2 && JSON.stringify(statuses[0]) === JSON.stringify(statuses[1]);
    const counts = tests.map(run => ({
      phase: run.phase,
      passed: run.records.filter(record => record.status === "pass").length,
      failed: run.records.filter(record => record.status === "fail").length,
      skipped: run.records.filter(record => record.status === "skip").length,
      todo: run.records.filter(record => record.status === "todo").length,
    }));
    const failedTestIds = tests.map(run => ({ phase: run.phase, ids: failedTestDigests(run.records) }));
    const incomplete = results.some(result => result.stdout.truncated || result.stderr.truncated || !result.stdout.complete || !result.stderr.complete);
    const failed = results.some(result => result.exit !== 0) || !sameNames || !sameStatuses || incomplete;
    const retained = failed || process.env.BG_FRONTEND_EVIDENCE_RETAIN_ALL === "1";
    if (retained) {
      await writeFile(path.join(destination, "frontend-failure.encrypted.json"), sealEvidence(JSON.stringify({
        receipt, results, tests, counts, same_names: sameNames, same_statuses: sameStatuses,
        first_failure: results.find(result => result.exit !== 0 || result.timed_out)?.phase ?? null,
        incomplete,
      }), recipient), { mode: 0o600, flag: "wx" });
    }
    console.log(JSON.stringify({
      event: "frontend_evidence_summary",
      counts,
      failed_test_ids: failedTestIds,
      same_names: sameNames,
      same_statuses: sameStatuses,
      retained,
    }));
    process.exitCode = failed ? 1 : 0;
  } catch {
    // A CLI boundary must not print diagnostics containing private paths, output or recipient data.
    console.error("frontend_evidence_capture_failed");
    process.exitCode = 1;
  }
}
