import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readCodexModelCatalog } from "../src/services/backends";

const FIXTURE = path.join(import.meta.dir, "fixtures", "codex-models-cache.json");
const KEYS = ["CODEX_HOME", "HOME", "USERPROFILE"] as const;

let root: string;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bg-codex-catalog-"));
  for (const key of KEYS) saved[key] = process.env[key];
});

afterEach(async () => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await rm(root, { recursive: true, force: true });
});

test("Given a recorded Codex cache When it is read Then only listed models with a low effort survive with their efforts", async () => {
  process.env.CODEX_HOME = root;
  await copyFile(FIXTURE, path.join(root, "models_cache.json"));
  const catalog = await readCodexModelCatalog();
  expect(catalog.models).toEqual([
    { id: "gpt-6-astra", label: "GPT-6 Astra", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "gpt-6-luna", label: "GPT-6 Luna", efforts: ["low", "medium"] },
  ]);
  expect(catalog.fetchedAt).not.toBeNull();
});

test("Given CODEX_HOME is unset When the cache sits under the home directory Then the default path is used on every OS", async () => {
  // Bun resolves the home directory once per process, so the default path is exercised in a child
  // that starts with HOME and USERPROFILE already pointing at the fixture home.
  await Bun.write(path.join(root, ".codex", "models_cache.json"), Bun.file(FIXTURE));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== "CODEX_HOME") env[key] = value;
  env.HOME = root;
  env.USERPROFILE = root;
  const script = `import { readCodexModelCatalog } from ${JSON.stringify(path.join(import.meta.dir, "../src/services/backends"))};
console.log(JSON.stringify((await readCodexModelCatalog()).models.map((model) => model.id)));`;
  const child = Bun.spawn([process.execPath, "-e", script], { env, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0);
  expect(JSON.parse(out.trim())).toEqual(["gpt-6-astra", "gpt-6-luna"]);
});

test("Given a missing cache When it is read Then the catalog is empty with no freshness, so callers fall back to the tool default", async () => {
  process.env.CODEX_HOME = root;
  expect(await readCodexModelCatalog()).toEqual({ models: [], fetchedAt: null });
});

test("Given unparseable or wrongly shaped cache files When read Then they never throw and yield no models", async () => {
  process.env.CODEX_HOME = root;
  const file = path.join(root, "models_cache.json");
  await writeFile(file, "{ not json");
  expect(await readCodexModelCatalog()).toEqual({ models: [], fetchedAt: null });
  await writeFile(file, JSON.stringify({ models: "nope" }));
  expect((await readCodexModelCatalog()).models).toEqual([]);
  await writeFile(file, JSON.stringify([1, 2, 3]));
  expect((await readCodexModelCatalog()).models).toEqual([]);
});

test("Given more than 100 listed models When read Then the catalog is capped", async () => {
  process.env.CODEX_HOME = root;
  const models = Array.from({ length: 150 }, (_, index) => ({
    slug: `m-${index}`,
    visibility: "list",
    supported_reasoning_levels: [{ effort: "low" }],
  }));
  await writeFile(path.join(root, "models_cache.json"), JSON.stringify({ models }));
  expect((await readCodexModelCatalog()).models).toHaveLength(100);
});
