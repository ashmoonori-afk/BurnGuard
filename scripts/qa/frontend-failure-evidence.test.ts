import { expect, test } from "bun:test";
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureOutput, failedTestDigests, sealEvidence, testRecords } from "./frontend-failure-evidence";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
const recipient = publicKey.export({ type: "spki", format: "pem" }).toString();

function unseal(serialized: string): string {
  const envelope = JSON.parse(serialized);
  const key = privateDecrypt({ key: privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.key, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

test("Given oversized output When capturing Then retained bytes are capped and the stream is completely drained", async () => {
  let drained = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) controller.enqueue(new Uint8Array(4 * 1024 * 1024).fill(65));
      else if (pulls === 2) controller.enqueue(new TextEncoder().encode("overflow"));
      else {
        controller.close();
        drained = true;
      }
    },
  });
  const output = await captureOutput(stream);
  expect({ retained: output.text.length, bytes: output.bytes, truncated: output.truncated, drained }).toEqual({
    retained: 4 * 1024 * 1024, bytes: 4 * 1024 * 1024 + 8, truncated: true, drained: true,
  });
  expect(stream.locked).toBe(false);
});

test("Given a failed output stream When capturing Then the original failure propagates and the reader is released", async () => {
  const failure = new Error("output_failed");
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(failure);
    },
  });
  await expect(captureOutput(stream)).rejects.toBe(failure);
  expect(stream.locked).toBe(false);
});

test("Given a descendant holding stdout When the phase deadline fires Then partial output returns without waiting for the descendant", async () => {
  const seen = Promise.withResolvers<void>();
  const deadline = new AbortController();
  const descendantSource = 'console.log("PRIVATE_PARTIAL_OUTPUT"); Bun.serve({ port: 0, fetch: () => new Response("held") });';
  const parentSource = `const child = Bun.spawn([process.execPath, "-e", ${JSON.stringify(descendantSource)}], { stdout: "inherit", stderr: "ignore" }); console.error(child.pid); Bun.serve({ port: 0, fetch: () => new Response("parent") });`;
  const parent = Bun.spawn([process.execPath, "-e", parentSource], { stdout: "pipe", stderr: "pipe" });
  let descendantPid: number | undefined;
  const bounded = Promise.withResolvers<never>();
  const timer = setTimeout(() => bounded.reject(new Error("capture_did_not_finish")), 5000);
  const pidReader = parent.stderr.getReader();
  const capture = captureOutput(parent.stdout.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      seen.resolve();
    },
  })), deadline.signal);
  try {
    const first = await Promise.race([pidReader.read(), bounded.promise]);
    descendantPid = Number(new TextDecoder().decode(first.value).trim());
    expect(Number.isSafeInteger(descendantPid) && descendantPid > 0).toBe(true);
    await Promise.race([seen.promise, bounded.promise]);
    process.kill(descendantPid, 0);
    // Match the phase deadline: Windows may terminate descendants with their parent.
    parent.kill("SIGKILL");
    deadline.abort();
    const output = await Promise.race([capture, bounded.promise]);
    expect(output.text).toContain("PRIVATE_PARTIAL_OUTPUT");
    expect(output.complete).toBe(false);
  } finally {
    clearTimeout(timer);
    pidReader.releaseLock();
    if (parent.exitCode === null) parent.kill("SIGKILL");
    if (descendantPid) {
      try { process.kill(descendantPid, "SIGKILL"); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
    }
    await parent.exited;
    await capture;
  }
});

test("Given POSIX and Windows runner headers When reading results Then names retain their file and skip status", () => {
  expect(testRecords([
    "packages/frontend/tests/one.test.ts:",
    "(pass) group > one [1.23ms]",
    ".\\packages\\frontend\\tests\\two.test.ts:",
    "(skip) group > two",
    "(fail) group > three [12.00ms]",
    "packages/frontend/tests/theme-tokens.test.ts:",
    "(pass) tokens [1.00ms]",
    "",
    "1 tests skipped:",
    "(skip) group > two",
    "",
    "1 tests failed:",
    "(fail) group > three [12.00ms]",
  ].join("\n"))).toEqual([
    { file: "packages/frontend/tests/one.test.ts", status: "pass", name: "group > one" },
    { file: "packages/frontend/tests/two.test.ts", status: "skip", name: "group > two" },
    { file: "packages/frontend/tests/two.test.ts", status: "fail", name: "group > three" },
    { file: "packages/frontend/tests/theme-tokens.test.ts", status: "pass", name: "tokens" },
  ]);
});

test("Given failed test records When publishing diagnostics Then only stable identity digests leave the runner", () => {
  const records = [
    { file: "packages/frontend/tests/one.test.ts", status: "fail", name: "private failure name" },
    { file: "packages/frontend/tests/two.test.ts", status: "pass", name: "passing name" },
  ];
  const digests = failedTestDigests(records);
  expect(digests).toEqual(["f49310e7d69e3848baa5eb18ce120e435cf8ab94925422ad1d2313ba3281d19c"]);
  expect(JSON.stringify(digests)).not.toContain("private failure name");
});

test("Given private failure diagnostics When sealing Then only the owner key recovers authenticated plaintext", () => {
  const plaintext = JSON.stringify({ first_failure: "PRIVATE_FAILURE_SENTINEL", path: "/private/fixture" });
  const sealed = sealEvidence(plaintext, recipient);
  expect(sealed).not.toContain("PRIVATE_FAILURE_SENTINEL");
  expect(unseal(sealed)).toBe(plaintext);
  const tampered = JSON.parse(sealed);
  const bytes = Buffer.from(tampered.ciphertext, "base64");
  bytes[0] ^= 1;
  tampered.ciphertext = bytes.toString("base64");
  expect(() => unseal(JSON.stringify(tampered))).toThrow();
});

test("Given an unsuitable recipient When sealing Then plaintext publication is rejected", () => {
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ type: "spki", format: "pem" }).toString();
  expect(() => sealEvidence("PRIVATE_FAILURE_SENTINEL", weak)).toThrow("evidence_recipient_invalid");
});

for (const scenario of [
  { kind: "import", name: "an import failure before three registrations", retain: true },
  { kind: "skip", name: "a pass-to-skip transition", retain: true },
  { kind: "todo", name: "a pass-to-todo transition", retain: true },
  { kind: "stable_skip", name: "the same expected skipped test", retain: false },
  { kind: "stable_todo", name: "the same expected todo test", retain: false },
] as const) {
test(`Given ${scenario.name} When the real CLI compares Then execution statuses determine private retention`, async () => {
  const home = process.env.BG_APP_ROOT;
  if (!home) throw new Error("test_profile_missing");
  const fixture = await mkdtemp(path.join(home, "frontend-evidence-"));
  const source = path.resolve(import.meta.dir, "../..");
  const run = async (command: string[], cwd: string, environment = process.env) => {
    const child = Bun.spawn(command, { cwd, env: environment, stdout: "pipe", stderr: "pipe", timeout: 60000, killSignal: "SIGKILL" });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exit };
  };
  try {
    await mkdir(path.join(fixture, "scripts/qa"), { recursive: true });
    await mkdir(path.join(fixture, "packages/frontend/tests"), { recursive: true });
    await mkdir(path.join(fixture, "packages/dependency"), { recursive: true });
    await writeFile(path.join(fixture, "scripts/qa/frontend-failure-evidence.ts"), await readFile(path.join(import.meta.dir, "frontend-failure-evidence.ts")));
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({
      name: "evidence-fixture", workspaces: ["packages/dependency"], dependencies: { "evidence-dependency": "workspace:*" },
    }));
    await writeFile(path.join(fixture, "packages/dependency/package.json"), JSON.stringify({ name: "evidence-dependency" }));
    await writeFile(path.join(fixture, "bun.lock"), JSON.stringify({
      lockfileVersion: 1, configVersion: 1,
      workspaces: {
        "": { name: "evidence-fixture", dependencies: { "evidence-dependency": "workspace:*" } },
        "packages/dependency": { name: "evidence-dependency" },
      },
      packages: { "evidence-dependency": ["evidence-dependency@workspace:packages/dependency"] },
    }));
    await writeFile(path.join(fixture, "packages/frontend/tests/missing.test.ts"), (scenario.kind === "import" ? [
      'import { test } from "bun:test";',
      'throw new Error("F06_PRIVATE_IMPORT_FAILURE");',
      'for (const id of [1, 2, 3]) test(`unregistered-${id}`, () => {});',
    ] : [
      'import { expect, test } from "bun:test";',
      'import { existsSync, writeFileSync } from "node:fs";',
      'const fresh = !existsSync("phase-marker"); writeFileSync("phase-marker", "warm");',
      `const mode = ${JSON.stringify(scenario.kind)};`,
      'const status = mode.startsWith("stable_") ? mode.slice(7) : fresh ? "pass" : mode;',
      'if (status === "skip") test.skip("phase-status", () => expect(true).toBe(true));',
      'else if (status === "todo") test.todo("phase-status", () => expect(true).toBe(true));',
      'else test("phase-status", () => expect(true).toBe(true));',
    ]).join("\n"));
    await writeFile(path.join(fixture, "packages/frontend/tests/survives.test.ts"), [
      'import { expect, test } from "bun:test";',
      'test("survives", () => expect(process.env.BG_FRONTEND_EVIDENCE_PUBLIC_KEY).toBeUndefined());',
    ].join("\n"));
    const git = await run(["git", "rev-parse", "--absolute-git-dir"], source);
    expect(git.exit).toBe(0);
    const output = path.join(fixture, "private");
    const result = await run([process.execPath, "scripts/qa/frontend-failure-evidence.ts"], fixture, {
      ...process.env, GIT_DIR: git.stdout.trim(), GIT_WORK_TREE: fixture,
      BG_FRONTEND_EVIDENCE_PUBLIC_KEY: recipient, BG_FRONTEND_EVIDENCE_DIRECTORY: output,
    });
    expect(result.exit).toBe(scenario.retain ? 1 : 0);
    expect(result.stdout + result.stderr).not.toContain("F06_PRIVATE_IMPORT_FAILURE");
    const summary = JSON.parse(result.stdout.split("\n").find(line => line.startsWith("{")) ?? "null");
    const changed = scenario.kind === "skip" || scenario.kind === "todo";
    const expectedCounts = ["fresh", "warm"].map(phase => ({
      phase,
      passed: changed && phase === "fresh" ? 2 : 1,
      failed: 0,
      skipped: scenario.kind === "stable_skip" || (scenario.kind === "skip" && phase === "warm") ? 1 : 0,
      todo: scenario.kind === "stable_todo" || (scenario.kind === "todo" && phase === "warm") ? 1 : 0,
    }));
    expect(summary).toEqual({
      event: "frontend_evidence_summary", counts: expectedCounts,
      failed_test_ids: ["fresh", "warm"].map(phase => ({ phase, ids: [] })),
      same_names: true, same_statuses: !changed, retained: scenario.retain,
    });
    if (!scenario.retain) {
      expect(await Bun.file(path.join(output, "frontend-failure.encrypted.json")).exists()).toBe(false);
      return;
    }
    const envelope = await readFile(path.join(output, "frontend-failure.encrypted.json"), "utf8");
    const retained = JSON.parse(unseal(envelope));
    expect(retained.results.map((item: { phase: string; exit: number }) => [item.phase, item.exit])).toEqual([
      ["install", 0], ["fresh", scenario.kind === "import" ? 1 : 0], ["warm", scenario.kind === "import" ? 1 : 0],
    ]);
    expect(retained.tests.map((item: { records: unknown[] }) => item.records.length)).toEqual(scenario.kind === "import" ? [1, 1] : [2, 2]);
    expect(retained.receipt.manifest).toHaveLength(2);
    expect(retained.same_names).toBe(true);
    expect(retained.same_statuses).toBe(!changed);
    expect(retained.counts).toEqual(expectedCounts);
    expect(retained.first_failure).toBe(scenario.kind === "import" ? "fresh" : null);
    if (scenario.kind === "import") expect(retained.results[1].stderr.text).toContain("F06_PRIVATE_IMPORT_FAILURE");
    const proofDirectory = process.env.BG_FRONTEND_EVIDENCE_PROOF_DIRECTORY;
    if (proofDirectory && scenario.kind === "import") {
      const ownerRecipient = process.env.BG_FRONTEND_EVIDENCE_PUBLIC_KEY;
      if (!ownerRecipient || !path.isAbsolute(proofDirectory)) throw new Error("evidence_proof_configuration");
      const proof = await run([process.execPath, "scripts/qa/frontend-failure-evidence.ts"], fixture, {
        ...process.env, GIT_DIR: git.stdout.trim(), GIT_WORK_TREE: fixture,
        BG_FRONTEND_EVIDENCE_PUBLIC_KEY: ownerRecipient, BG_FRONTEND_EVIDENCE_DIRECTORY: proofDirectory,
      });
      expect(proof.exit).toBe(1);
      const ownerEnvelope = await readFile(path.join(proofDirectory, "frontend-failure.encrypted.json"), "utf8");
      expect(ownerEnvelope).not.toContain("F06_PRIVATE_IMPORT_FAILURE");
      expect(JSON.parse(ownerEnvelope)).toMatchObject({ schema: 1, algorithm: "RSA-OAEP-SHA256/AES-256-GCM" });
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
}
