import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, readFile, rename, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { insertAttachmentRecord } from "../src/db/attachment-context";
import { canonicalizeAttachmentRequest } from "../src/services/attachment-request";
import { captureImmutableAttachments, verifyImmutableAttachments } from "../src/services/immutable-attachment-guard";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { listSequencedSessionEvents, parsePersistedNormalizedEvent } from "../src/db/event-sequence-repository";
import { sessionRoutes } from "../src/routes/session";
import { releaseUserTurnReservation, reserveUserTurn } from "../src/services/turns";
import { withPrivateAttachmentInputs } from "../src/services/stage-attachment-inputs";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

let root = "";
let projectId = "";
let sessionId = "";

beforeEach(async () => {
  await runMigrations();
  root = await mkdtemp(path.join(tmpdir(), "burnguard-visual-security-"));
  await mkdir(path.join(root, ".attachments"));
  projectId = `visual-security-${crypto.randomUUID()}`;
  sessionId = `${projectId}-session`;
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
});

afterEach(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(root, { recursive: true, force: true });
});

async function stored(role: "ordinary_content" | "immutable_reference", name = "source.pdf"): Promise<string> {
  const filePath = path.join(root, ".attachments", name);
  const bytes = new TextEncoder().encode("original");
  await writeFile(filePath, bytes);
  insertAttachmentRecord({ sessionId, filePath, mimeType: "application/pdf", originalName: name, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), sourceRole: role });
  return filePath;
}

describe("canonical attachment request", () => {
  test("Given unmatched duplicate unsafe cross-session and newline paths When canonicalized Then each fails before use", async () => {
    const valid = await stored("ordinary_content");
    const foreignRoot = await mkdtemp(path.join(tmpdir(), "burnguard-foreign-"));
    const foreignProject = `foreign-${crypto.randomUUID()}`;
    const foreignSession = `${foreignProject}-session`;
    getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(foreignProject, foreignProject, foreignRoot);
    getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(foreignSession, foreignProject);
    const foreign = path.join(foreignRoot, ".attachments", "foreign.pdf");
    await mkdir(path.dirname(foreign)); await writeFile(foreign, "x");
    insertAttachmentRecord({ sessionId: foreignSession, filePath: foreign, mimeType: "application/pdf", originalName: "foreign.pdf", sizeBytes: 1, sha256: "a".repeat(64) });
    for (const paths of [[valid, valid], ["https://example.test/a.pdf"], ["../../escape.pdf"], [foreign], [`${valid}\nforged`], [path.join(root, ".attachments", "missing.pdf")]]) {
      await expect(canonicalizeAttachmentRequest({ sessionId, requestedPaths: paths })).rejects.toThrow("invalid_attachments");
    }
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(foreignProject); await rm(foreignRoot, { recursive: true, force: true });
  });

  test("Given unsafe JSON attachment strings When routed Then bounded 4xx occurs before any event or status write", async () => {
    const valid = await stored("ordinary_content");
    for (const attachment of ["https://example.test/a.pdf", "/tmp/unmatched.pdf", "../../escape.pdf", `${valid}\nforged`]) {
      const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "user.message", text: "x", attachments: [attachment] }) });
      expect(response.status).toBe(400);
    }
    expect(getSqlite().query<{ readonly count: number }, []>("SELECT COUNT(*) count FROM events WHERE session_id=?").get(sessionId)?.count).toBe(0);
  });

  test("Given omitted or empty client roles When canonicalized Then persisted role remains authoritative", async () => {
    const immutable = await stored("immutable_reference", "deck.pptx");
    for (const selections of [undefined, []]) {
      const result = await canonicalizeAttachmentRequest({ sessionId, requestedPaths: [immutable], selections });
      expect(result.selections).toEqual([{ source_type: "uploaded_attachment", attachment_path: immutable, role: "immutable_reference" }]);
    }
    const mismatch = [{ source_type: "uploaded_attachment" as const, attachment_path: immutable, role: "ordinary_content" as const }];
    await expect(canonicalizeAttachmentRequest({ sessionId, requestedPaths: [immutable], selections: mismatch })).rejects.toThrow("invalid_attachments");
    const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "user.message", text: "x", attachments: [immutable], visualSources: mismatch }) });
    expect(response.status).toBe(400);
    expect(getSqlite().query<{ readonly count: number }, []>("SELECT COUNT(*) count FROM events WHERE session_id=?").get(sessionId)?.count).toBe(0);
  });
});

describe("busy intake reservation", () => {
  test("Given a concurrent reserved turn When multipart arrives Then it is rejected before attachment persistence", async () => {
    const reservation = reserveUserTurn(sessionId);
    expect(reservation).not.toBeNull();
    const form = new FormData(); form.set("type", "user.message"); form.set("text", "busy"); form.append("files", new File(["pdf"], "busy.pdf", { type: "application/pdf" }));

    const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", body: form });

    expect(response.status).toBe(409);
    expect(getSqlite().query<{ readonly count: number }, []>("SELECT COUNT(*) count FROM attachments").get()?.count).toBe(0);
    if (reservation !== null) releaseUserTurnReservation(reservation);
  });
});

describe("immutable attachment guard", () => {
  test("Given immutable private input bytes are copied to nested authored output When published Then typed rejection publishes zero result bytes", async () => {
    await writeFile(path.join(root, "index.html"), "base");
    const immutable = await stored("immutable_reference");
    const immutableHash = createHash("sha256").update("original").digest("hex");
    const coordinator = new ArtifactCoordinator(getSqlite());
    const base = await coordinator.initialize(projectId, root);
    const attachment = { id: "immutable-input", file_path: immutable, original_name: "source.pdf", size_bytes: 8, sha256: immutableHash, source_role: "immutable_reference" as const };

    await expect(coordinator.run({ projectId, projectDir: root, kind: "turn", operationId: "private-copy", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, publicationPolicy: { forbiddenSha256: new Set([immutableHash]) }, mutate: async (stage) => {
      await writeFile(path.join(stage, "index.html"), "changed");
      await mkdir(path.join(stage, "nested"));
      await withPrivateAttachmentInputs({ operationDir: path.dirname(stage), projectDir: root, attachments: [attachment], requestedPaths: [immutable], immutableSnapshots: [] }, async (sources) => {
        await copyFile(sources[0]?.sourcePath ?? "missing", path.join(stage, "nested", "authored-source.pdf"));
      });
    } })).rejects.toMatchObject({ code: "immutable_reference_escaped" });

    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("base");
    await expect(readFile(path.join(root, "nested", "authored-source.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(root, ".meta", "artifact-operations", "private-copy", "stage", "nested", "authored-source.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(immutable, "utf8")).toBe("original");
  });

  test("Given adapter mutation When postflight runs Then original bytes are restored and staged output is not committed", async () => {
    await writeFile(path.join(root, "index.html"), "base");
    const immutable = await stored("immutable_reference");
    const snapshot = await captureImmutableAttachments([{ file_path: immutable, source_role: "immutable_reference", size_bytes: 8, sha256: createHash("sha256").update("original").digest("hex") }]);
    const coordinator = new ArtifactCoordinator(getSqlite());
    const base = await coordinator.initialize(projectId, root);

    await expect(coordinator.run({ projectId, projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => {
      await writeFile(path.join(stage, "index.html"), "changed");
      await writeFile(immutable, "mutated");
      await verifyImmutableAttachments(snapshot);
    } })).rejects.toThrow("immutable_reference_mutated");

    expect(await readFile(immutable, "utf8")).toBe("original");
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("base");
  });

  test.skipIf(!canCreateSymlink())(`Given parent directory symlink swap When postflight runs Then outside bytes stay untouched and staged output is not published (${SYMLINK_SKIP_REASON})`, async () => {
    await writeFile(path.join(root, "index.html"), "base");
    const immutable = await stored("immutable_reference");
    const snapshots = await captureImmutableAttachments([{ file_path: immutable, source_role: "immutable_reference", size_bytes: 8, sha256: createHash("sha256").update("original").digest("hex") }]);
    const outside = await mkdtemp(path.join(tmpdir(), "burnguard-immutable-outside-"));
    const outsideSentinel = path.join(outside, path.basename(immutable));
    await writeFile(outsideSentinel, "outside");
    const displaced = `${path.dirname(immutable)}-captured`;
    const coordinator = new ArtifactCoordinator(getSqlite());
    const base = await coordinator.initialize(projectId, root);

    try {
      await expect(coordinator.run({ projectId, projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, mutate: async (stage) => {
        await writeFile(path.join(stage, "index.html"), "changed");
        await writeFile(immutable, "mutated");
        await rename(path.dirname(immutable), displaced);
        await symlink(outside, path.dirname(immutable), "dir");
        try {
          await verifyImmutableAttachments(snapshots);
        } catch (error) {
          await rm(path.dirname(immutable), { recursive: true, force: true });
          await rename(displaced, path.dirname(immutable));
          throw error;
        }
      } })).rejects.toThrow("immutable_reference_path_unavailable");
      expect(await readFile(outsideSentinel, "utf8")).toBe("outside");
      expect(await readFile(immutable, "utf8")).toBe("original");
      expect(await readFile(path.join(root, "index.html"), "utf8")).toBe("base");
      const handle = snapshots[0]?.handle;
      expect(handle).toBeDefined();
      await expect(handle?.stat()).rejects.toMatchObject({ code: "EBADF" });
    } finally {
      await rm(path.dirname(immutable), { recursive: true, force: true });
      await rename(displaced, path.dirname(immutable)).catch(() => undefined);
      await rm(outside, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform !== "win32")("Given a Windows junction parent before capture When immutable inputs open Then outside bytes stay untouched", async () => {
    const immutable = await stored("immutable_reference");
    const displaced = `${path.dirname(immutable)}-captured`;
    const outside = await mkdtemp(path.join(tmpdir(), "burnguard-immutable-junction-"));
    const sentinel = path.join(outside, path.basename(immutable));
    await writeFile(sentinel, "original");
    await rename(path.dirname(immutable), displaced);
    try {
      await symlink(outside, path.dirname(immutable), "junction");
      await expect(captureImmutableAttachments([{ file_path: immutable, source_role: "immutable_reference", size_bytes: 8, sha256: createHash("sha256").update("original").digest("hex") }])).rejects.toThrow("immutable_reference_path_unavailable");
      expect(await readFile(sentinel, "utf8")).toBe("original");
    } finally {
      await rmdir(path.dirname(immutable));
      await rename(displaced, path.dirname(immutable));
      await rm(outside, { recursive: true, force: true });
    }
  });

  for (const alias of ["hardlink", "symlink"] as const) {
  test.skipIf(alias === "symlink" && !canCreateSymlink())(`Given file replacement ${alias} swap When postflight runs Then only captured inode is restored (${alias === "symlink" ? SYMLINK_SKIP_REASON : "actual inode alias"})`, async () => {
    const immutable = await stored("immutable_reference");
    const snapshots = await captureImmutableAttachments([{ file_path: immutable, source_role: "immutable_reference", size_bytes: 8, sha256: createHash("sha256").update("original").digest("hex") }]);
    const outside = path.join(root, "outside-sentinel");
    const displaced = `${immutable}.captured`;
    await writeFile(outside, "outside");
    await writeFile(immutable, "mutated");
    await rename(immutable, displaced);
    if (alias === "hardlink") await link(outside, immutable); else await symlink(outside, immutable);

    try {
      await expect(verifyImmutableAttachments(snapshots)).rejects.toThrow("immutable_reference_path_unavailable");
      expect(await readFile(outside, "utf8")).toBe("outside");
      expect(await readFile(displaced, "utf8")).toBe("original");
      const handle = snapshots[0]?.handle;
      await expect(handle?.stat()).rejects.toMatchObject({ code: "EBADF" });
    } finally {
      await rm(immutable, { force: true });
      await rename(displaced, immutable).catch(() => undefined);
    }
  });
  }

  test("Given direct immutable mutation When postflight runs Then original bytes are atomically restored and the turn fails bounded", async () => {
    const immutable = await stored("immutable_reference");
    const snapshot = await captureImmutableAttachments([{ file_path: immutable, source_role: "immutable_reference", size_bytes: 8, sha256: createHash("sha256").update("original").digest("hex") }]);
    await writeFile(immutable, "mutated");

    await expect(verifyImmutableAttachments(snapshot)).rejects.toThrow("immutable_reference_mutated");
    expect(await readFile(immutable, "utf8")).toBe("original");
    await expect(snapshot[0]?.handle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  test("Given unchanged immutable attachment When postflight succeeds Then its pre-opened handle is closed", async () => {
    const immutable = await stored("immutable_reference");
    const snapshots = await captureImmutableAttachments([{ file_path: immutable, source_role: "immutable_reference", size_bytes: 8, sha256: createHash("sha256").update("original").digest("hex") }]);
    await expect(verifyImmutableAttachments(snapshots)).resolves.toBeUndefined();
    await expect(snapshots[0]?.handle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  test("Given ordinary attachment When guarded Then no handle or immutable failure is introduced", async () => {
    const ordinary = await stored("ordinary_content");
    const snapshots = await captureImmutableAttachments([{ file_path: ordinary, source_role: "ordinary_content", size_bytes: 8, sha256: createHash("sha256").update("original").digest("hex") }]);
    expect(snapshots).toEqual([]);
    await expect(verifyImmutableAttachments(snapshots)).resolves.toBeUndefined();
  });
});

describe("authoritative replay provenance", () => {
  test("Given duplicate manifest identity or mismatched turn When parsed Then replay fails closed", () => {
    const source = { source_type: "uploaded_attachment", role: "ordinary_content", role_origin: "explicit", attachment_id: "a", original_name: "a.pdf", mime_type: "application/pdf", size_bytes: 1, preflight_verified_sha256: "a".repeat(64), managed_path: ".attachments/a.pdf", provenance: { session_id: sessionId, turn_id: "turn-1", storage: "managed_attachment" } };
    const base = { id: "event", ts: 1, type: "chat.user_message", turnId: "turn-1", text: "x", attachmentCount: 1 };
    expect(() => parsePersistedNormalizedEvent(JSON.stringify({ ...base, visualSources: { schema_version: 1, network_sources: "unsupported", sources: [source, source] } }), "event")).toThrow("corrupt_json");
    expect(() => parsePersistedNormalizedEvent(JSON.stringify({ ...base, visualSources: { schema_version: 1, network_sources: "unsupported", sources: [{ ...source, provenance: { ...source.provenance, turn_id: "stale" } }] } }), "event")).toThrow("corrupt_json");
    const wrongSession = { ...source, provenance: { ...source.provenance, session_id: "foreign-session" } };
    getSqlite().prepare("INSERT INTO events(id,session_id,direction,type,payload_json,turn_id,processed_at,created_at,sequence) VALUES ('corrupt-replay',?,'down','chat.user_message',?,'turn-1',1,1,1)").run(sessionId, JSON.stringify({ ...base, id: "corrupt-replay", visualSources: { schema_version: 1, network_sources: "unsupported", sources: [wrongSession] } }));
    expect(() => listSequencedSessionEvents(getSqlite(), sessionId, 0)).toThrow("corrupt_json");
  });
});
