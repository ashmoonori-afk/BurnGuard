import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { insertAttachmentRecord } from "../src/db/attachment-context";
import { getSqlite } from "../src/db/sqlite-client";
import { sessionRoutes } from "../src/routes/session";
import {
  ATTACHMENT_LIMITS,
  UnsupportedAttachmentKindError,
  saveSessionAttachments,
} from "../src/services/attachments";
import { SUPPORTED_UPLOAD_KINDS, inferUploadKind } from "../src/services/upload-kind";

// The real extractor shells out to Python. Mocked at its narrowest seam so the
// intake gate — which runs entirely before extraction — is deterministic here.
let extractorCalls: string[] = [];
let extractorFailureName: string | null = null;
mock.module("../src/services/attachment-extraction", () => ({
  extractAttachmentUpload: async (input: { readonly originalName: string }) => {
    extractorCalls.push(input.originalName);
    if (input.originalName === extractorFailureName) throw new Error("malformed_attachment");
  },
}));

const projectId = `attachment-intake-${process.pid}`;
const sessionId = `${projectId}-session`;
let root = "";

function file(name: string, type = "", sizeBytes = 8): File {
  const value = new File([new Uint8Array(Math.min(sizeBytes, 1024))], name, { type });
  if (sizeBytes > 1024) Object.defineProperty(value, "size", { value: sizeBytes });
  return value;
}

function attachmentRowCount(): number {
  return getSqlite()
    .query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM attachments WHERE session_id=?")
    .get(sessionId)?.count ?? 0;
}

async function storedFileNames(): Promise<readonly string[]> {
  return await readdir(path.join(root, ".attachments")).catch(() => [] as string[]);
}

beforeAll(async () => {
  await runMigrations();
  root = await mkdtemp(path.join(tmpdir(), "burnguard-attachment-intake-"));
  getSqlite()
    .prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)")
    .run(projectId, projectId, root);
  getSqlite()
    .prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)")
    .run(sessionId, projectId);
});

afterEach(() => {
  extractorCalls = [];
  extractorFailureName = null;
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM attachments WHERE session_id=?").run(sessionId);
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(root, { recursive: true, force: true });
  mock.restore();
});

describe("session attachment intake", () => {
  test("Given a source kind the extractor cannot process When saving Then it throws a typed unsupported error and persists nothing", async () => {
    const before = attachmentRowCount();

    const failure = await saveSessionAttachments(sessionId, [file("notes.txt", "text/plain")]).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(UnsupportedAttachmentKindError);
    expect(failure).toMatchObject({ code: "unsupported_file_kind", fileNames: ["notes.txt"] });
    expect(attachmentRowCount()).toBe(before);
    expect(await storedFileNames()).toEqual([]);
    expect(extractorCalls).toEqual([]);
  });

  test("Given a batch mixing supported and unsupported kinds When saving Then the whole batch is rejected before any write", async () => {
    const before = attachmentRowCount();

    const failure = await saveSessionAttachments(sessionId, [
      file("deck.pdf", "application/pdf"),
      file("archive.zip", "application/zip"),
    ]).then(() => null, (error: unknown) => error);

    expect(failure).toMatchObject({ code: "unsupported_file_kind", fileNames: ["archive.zip"] });
    expect(attachmentRowCount()).toBe(before);
    expect(await storedFileNames()).toEqual([]);
    expect(extractorCalls).toEqual([]);
  });

  test("Given a supported source kind When saving Then it is persisted and handed to the extractor", async () => {
    const before = attachmentRowCount();

    const saved = await saveSessionAttachments(sessionId, [file("deck.pdf", "application/pdf")]);

    expect(saved).toHaveLength(1);
    expect(attachmentRowCount()).toBe(before + 1);
    expect(getSqlite().query<{ readonly source_role: string; readonly source_role_explicit: number }, [string]>("SELECT source_role,source_role_explicit FROM attachments WHERE file_path=?").get(saved[0] ?? "missing")).toEqual({ source_role: "ordinary_content", source_role_explicit: 0 });
    expect((await storedFileNames()).some((name) => name.endsWith("-deck.pdf"))).toBe(true);
    expect(extractorCalls).toEqual(["deck.pdf"]);
  });

  test("Given the second upload fails extraction When saving Then the complete batch leaves no rows or files", async () => {
    const before = attachmentRowCount();
    const beforeFiles = await storedFileNames();
    extractorFailureName = "broken.pdf";

    await expect(saveSessionAttachments(sessionId, [file("first.pdf", "application/pdf"), file("broken.pdf", "application/pdf")])).rejects.toThrow("malformed_attachment");

    expect(attachmentRowCount()).toBe(before);
    expect(await storedFileNames()).toEqual(beforeFiles);
    const originals = await readdir(path.join(root, "docs/attachments"));
    expect(originals.some((name) => name.endsWith("-first.pdf"))).toBe(true);
    expect(originals.some((name) => name.endsWith("-broken.pdf"))).toBe(true);
  });

  test("Given an immutable visual upload When saving Then its durable role and SHA-256 provenance are stored", async () => {
    const saved = await saveSessionAttachments(sessionId, [{ file: file("reference.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), role: "immutable_reference" }]);

    const row = getSqlite().query<{ readonly source_role: string; readonly source_role_explicit: number; readonly sha256: string }, [string]>("SELECT source_role,source_role_explicit,sha256 FROM attachments WHERE file_path=?").get(saved[0] ?? "missing");
    expect(row).toMatchObject({ source_role: "immutable_reference", source_role_explicit: 1 });
    expect(row?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("Given previously stored unsupported attachments When a new upload is rejected Then the stored rows survive", async () => {
    const legacyPath = path.join(root, ".attachments", "legacy-note.txt");
    insertAttachmentRecord({
      sessionId,
      filePath: legacyPath,
      mimeType: "text/plain",
      originalName: "legacy-note.txt",
      sizeBytes: 4,
      sha256: "deadbeef",
    });

    await saveSessionAttachments(sessionId, [file("legacy-note.txt", "text/plain")]).catch(() => null);

    const legacy = getSqlite()
      .query<{ readonly file_path: string }, [string]>("SELECT file_path FROM attachments WHERE session_id=? AND original_name='legacy-note.txt'")
      .all(sessionId);
    expect(legacy).toEqual([{ file_path: legacyPath }]);
  });

  test("Given batches past the count and size limits When saving Then the existing limit errors still fire", async () => {
    const tooMany = Array.from({ length: ATTACHMENT_LIMITS.maxCount + 1 }, (_, i) => file(`deck-${i}.pdf`, "application/pdf"));
    await expect(saveSessionAttachments(sessionId, tooMany)).rejects.toThrow(/attachment_limit_exceeded/);

    const oversized = file("huge.pdf", "application/pdf", ATTACHMENT_LIMITS.maxBytesPerFile + 1);
    await expect(saveSessionAttachments(sessionId, [oversized])).rejects.toThrow(/attachment_too_large/);

    const overTotal = Array.from({ length: 3 }, (_, i) => file(`big-${i}.pdf`, "application/pdf", 9 * 1024 * 1024));
    await expect(saveSessionAttachments(sessionId, overTotal)).rejects.toThrow(/attachment_total_too_large/);
  });

  test("Given the upload kind extractor When asked what it can process Then only its declared kinds are accepted", () => {
    expect([...SUPPORTED_UPLOAD_KINDS]).toEqual(["pdf", "pptx"]);
    expect(inferUploadKind("deck.pdf", null)).toBe("pdf");
    expect(inferUploadKind("deck.pptx", null)).toBe("pptx");
    expect(inferUploadKind("notes.txt", "text/plain")).toBeNull();
    expect(inferUploadKind("image.png", "image/png")).toBeNull();
  });
});

describe("session events multipart route", () => {
  test("Given URL-shaped visual metadata When posted with a supported upload Then it is rejected before any write", async () => {
    const before = attachmentRowCount();
    const form = new FormData();
    form.set("type", "user.message");
    form.set("text", "웹 이미지를 써줘");
    form.set("visual_sources", JSON.stringify({ schema_version: 1, sources: [{ source_type: "url", url: "https://example.test/image" }] }));
    form.append("files", file("deck.pdf", "application/pdf"));

    const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", body: form });
    const body = (await response.json()) as { readonly error: { readonly code: string } };

    expect(response.status).toBe(415);
    expect(body.error.code).toBe("unsupported_visual_source");
    expect(attachmentRowCount()).toBe(before);
    expect(extractorCalls).toEqual([]);
  });

  test("Given an unsupported upload When posted as multipart Then the route answers a structured typed error", async () => {
    const before = attachmentRowCount();
    const form = new FormData();
    form.set("type", "user.message");
    form.set("text", "이 파일 좀 봐줘");
    form.append("files", file("notes.txt", "text/plain"));

    const response = await sessionRoutes.request(`http://local/api/sessions/${sessionId}/events`, { method: "POST", body: form });
    const body = (await response.json()) as { readonly error: { readonly code: string; readonly details: { readonly files: readonly string[]; readonly supported_kinds: readonly string[] } } };

    expect(response.status).toBe(415);
    expect(body.error.code).toBe("unsupported_file_kind");
    expect(body.error.details.files).toEqual(["notes.txt"]);
    expect(body.error.details.supported_kinds).toEqual(["pdf", "pptx"]);
    expect(attachmentRowCount()).toBe(before);
  });
});
