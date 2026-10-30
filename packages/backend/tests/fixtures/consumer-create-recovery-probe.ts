import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { bootstrapLocalAppData } from "../../src/bootstrap";
import { runMigrations } from "../../src/db/migrate-local";
import { closeSqlite, getSqlite } from "../../src/db/sqlite-client";
import { getPendingSystemOperation, getCurrentSystemContent } from "../../src/db/catalog-repository";
import { systemsDir, appRootDir } from "../../src/lib/paths";
import { analyzeLocalTree } from "../../src/services/extraction-local-tree";
import { persistCanonicalExtraction, readDesignSystemTokens, upsertDesignSystemColorToken } from "../../src/services/design-system-extract";
import { inspectCanonicalTree } from "../../src/services/canonical-tree-manifest";
import { reconcileSystemContentLocks } from "../../src/services/system-content-access";

const [phase, boundary, output] = process.argv.slice(2);
if (output === undefined || (phase !== "prepare" && phase !== "edit" && phase !== "recover") ||
  (boundary !== "receipt-prepared" && boundary !== "candidate-published" && boundary !== "receipt-committed")) {
  throw new TypeError("Expected prepare/edit/recover, creation boundary and output path");
}
const id = "leased-v1-create";
const live = path.join(systemsDir, id);
const exists = async (file: string) => stat(file).then(() => true, error => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
  throw error;
});

if (phase === "prepare") {
  await mkdir(systemsDir, { recursive: true });
  await runMigrations();
  const source = path.join(appRootDir, "source");
  await mkdir(source);
  await writeFile(path.join(source, "tokens.css"), ":root { --brand: #123456; }\r\n");
  const abort = new AbortController();
  const analysis = await analyzeLocalTree(source, "Leased create", abort.signal);
  // Arm the exact parent command before reporting that the durable boundary has been reached.
  const release = new Response(Bun.stdin).text();
  await persistCanonicalExtraction({
    requestedId: id, brandName: "Leased create", sourceType: "upload", sourceReference: "fixture",
    lineage: null, analysis, signal: abort.signal,
    atBoundary: async (name, systemId) => {
      if (name !== boundary) return;
      const root = name === "receipt-prepared"
        ? path.join(systemsDir, (await readdir(systemsDir)).find(entry => entry.startsWith(`.${id}.staging-`)) ?? "missing")
        : live;
      await writeFile(output, JSON.stringify({
        system_id: systemId,
        receipt: getCurrentSystemContent(getSqlite(), id),
        pending: getPendingSystemOperation(getSqlite(), id),
        manifest: await inspectCanonicalTree(root),
        sidecar: await readFile(path.join(root, "extraction-provenance.json"), "utf8"),
        marker: await readFile(path.join(root, ".burnguard-publication"), "utf8"),
      }));
      process.stdout.write("CREATE_BOUNDARY\n");
      if ((await release).trim() !== "exit") throw new Error("Missing parent exit command");
      // Do not execute the creator's catch/finally: this is a real abandoned shared lock.
      process.exit(77);
    },
  });
  throw new Error("Creation boundary was not reached");
}

if (phase === "edit") {
  try {
    await upsertDesignSystemColorToken(id, { name: "brand", value: "#abcdef" });
    throw new Error("Ordinary mutation entered a reserved creation");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "system_content_unavailable") throw error;
  }
  closeSqlite();
} else if (phase === "recover") {
  // The first pass must preserve a nonterminal v1 owner's stale lock.
  const initialLocks = await reconcileSystemContentLocks(getSqlite(), systemsDir);
  const before: unknown = JSON.parse(await readFile(output, "utf8"));
  await bootstrapLocalAppData();
  // This ordinary public read must succeed on the SAME launch, with no manual second recovery.
  await readDesignSystemTokens(id);
  const firstHead = getCurrentSystemContent(getSqlite(), id);
  const firstManifest = await inspectCanonicalTree(live);
  await bootstrapLocalAppData();
  await writeFile(output, JSON.stringify({
    before, initialLocks, firstHead, firstManifest,
    head: getCurrentSystemContent(getSqlite(), id),
    pending: getPendingSystemOperation(getSqlite(), id),
    manifest: await inspectCanonicalTree(live),
    sidecar: await readFile(path.join(live, "extraction-provenance.json"), "utf8"),
    marker_present: await exists(path.join(live, ".burnguard-publication")),
    reservation_present: await exists(path.join(systemsDir, ".extraction-reservations", id)),
    lock_present: await exists(path.join(systemsDir, ".catalog-locks", id)),
  }));
  closeSqlite();
}
