import { expect, test } from "bun:test";
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureOutput, sealEvidence, testRecords } from "./frontend-failure-evidence";

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

test("Given POSIX and Windows runner headers When reading results Then names retain their file and skip status", () => {
  expect(testRecords([
    "packages/frontend/tests/one.test.ts:",
    "(pass) group > one [1.23ms]",
    ".\\packages\\frontend\\tests\\two.test.ts:",
    "(skip) group > two",
    "(fail) group > three [12.00ms]",
  ].join("\n"))).toEqual([
    { file: "packages/frontend/tests/one.test.ts", status: "pass", name: "group > one" },
    { file: "packages/frontend/tests/two.test.ts", status: "skip", name: "group > two" },
    { file: "packages/frontend/tests/two.test.ts", status: "fail", name: "group > three" },
  ]);
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

test("Given an import failure before three registrations When the real CLI compares Then both failures and the surviving named test are retained privately", async () => {
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
    await writeFile(path.join(fixture, "packages/frontend/tests/missing.test.ts"), [
      'import { test } from "bun:test";',
      'throw new Error("F06_PRIVATE_IMPORT_FAILURE");',
      'for (const id of [1, 2, 3]) test(`unregistered-${id}`, () => {});',
    ].join("\n"));
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
    expect(result.exit).toBe(1);
    expect(result.stdout + result.stderr).not.toContain("F06_PRIVATE_IMPORT_FAILURE");
    const envelope = await readFile(path.join(output, "frontend-failure.encrypted.json"), "utf8");
    const retained = JSON.parse(unseal(envelope));
    expect(retained.results.map((item: { phase: string; exit: number }) => [item.phase, item.exit])).toEqual([
      ["install", 0], ["fresh", 1], ["warm", 1],
    ]);
    expect(retained.tests.map((item: { records: unknown[] }) => item.records.length)).toEqual([1, 1]);
    expect(retained.receipt.manifest).toHaveLength(2);
    expect(retained.same_names).toBe(true);
    expect(retained.first_failure).toBe("fresh");
    expect(retained.results[1].stderr.text).toContain("F06_PRIVATE_IMPORT_FAILURE");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
