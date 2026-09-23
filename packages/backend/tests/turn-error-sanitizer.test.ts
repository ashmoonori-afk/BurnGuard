import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logsDir } from "../src/lib/paths";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { broker, sequencedBroker } from "../src/services/broker";
import { persistAndPublish } from "../src/services/turns";
import { LogoDeliverableError } from "../src/services/logo-deliverables";
import { sanitizeTurnEvent } from "../src/services/turn-error-sanitizer";
import { PathBoundaryError } from "../src/security/path-boundary";
import { sessionRoutes } from "../src/routes/session";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

beforeAll(async () => {
  await runMigrations();
  const db = getSqlite();
  db.prepare("INSERT OR IGNORE INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('turn-error-project','P','prototype','/tmp/project','index.html','codex',1,1)").run();
  db.prepare("INSERT OR IGNORE INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('turn-error-session','turn-error-project','codex','idle',1,1,1)").run();
});

beforeEach(() => {
  getSqlite().prepare("DELETE FROM events WHERE session_id='turn-error-session'").run();
});

const readyCodex = async () => ({
  backends: [{ id: "codex" as const, found: true, authenticated: true, image_generation: true, models: [] }],
});

describe("turn error event boundary", () => {
  test.skipIf(!canCreateSymlink())(`Given artifact preparation fails with a private path When the route responds Then diagnostics stay server-side (${SYMLINK_SKIP_REASON})`, async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "burnguard-private-prepare-"),
    );
    try {
      await writeFile(path.join(root, "index.html"), "<h1>safe</h1>");
      await mkdir(path.join(root, ".attachments"));
      await writeFile(path.join(root, ".attachments", "private-original"), "private source");
      await link(
        path.join(root, ".attachments", "private-original"),
        path.join(root, "escaped-link"),
      );
      getSqlite()
        .prepare("UPDATE projects SET dir_path=? WHERE id='turn-error-project'")
        .run(root);

      let readinessCalls = 0;
      const response = await sessionRoutes.request(
        "http://local/api/sessions/turn-error-session/events",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "user.message", text: "safe request" }),
        },
        {
          detectBackends: async () => {
            readinessCalls += 1;
            return readyCodex();
          },
        },
      );
      expect(readinessCalls).toBe(1);
      const body = (await response.json()) as {
        readonly error: { readonly code: string };
      };
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("artifact_prepare_failed");
      expect(serialized.length).toBeLessThan(512);
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain("/private/Users");
    } finally {
      getSqlite()
        .prepare(
          "UPDATE projects SET dir_path='/tmp/project' WHERE id='turn-error-project'",
        )
        .run();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given a legacy project control file When generation is requested Then it is preserved and blocked before provider execution", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "burnguard-agent-control-"),
    );
    try {
      await writeFile(path.join(root, "index.html"), "<h1>safe</h1>");
      await writeFile(
        path.join(root, "CLAUDE.md"),
        "untrusted project instructions",
      );
      getSqlite()
        .prepare("UPDATE projects SET dir_path=? WHERE id='turn-error-project'")
        .run(root);

      const response = await sessionRoutes.request(
        "http://local/api/sessions/turn-error-session/events",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "user.message", text: "safe request" }),
        },
        { detectBackends: readyCodex },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "agent_control_files_present" },
      });
      expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toBe(
        "untrusted project instructions",
      );
      expect(
        getSqlite()
          .query<{ count: number }, []>(
            "SELECT COUNT(*) count FROM events WHERE session_id='turn-error-session'",
          )
          .get()?.count,
      ).toBe(0);
    } finally {
      getSqlite()
        .prepare(
          "UPDATE projects SET dir_path='/tmp/project' WHERE id='turn-error-project'",
        )
        .run();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given parent symlink PathBoundaryError When persisted and published Then DB SSE and replay contain only typed bounded Korean copy", async () => {
    const raw = "/private/Users/alice/project/.attachments/source.pdf escaped root";
    const observed: unknown[] = [];
    const sequenced: unknown[] = [];
    const unsubscribe = broker.subscribe("turn-error-session", (event) => { observed.push(event); });
    const unsubscribeSequenced = sequencedBroker.subscribe("turn-error-session", (event) => { sequenced.push(event); });
    try {
      await persistAndPublish("turn-error-session", { id: "path-error", ts: 2, type: "status.error", message: raw, recoverable: true }, new PathBoundaryError("outside_root", raw));
    } finally {
      unsubscribe();
      unsubscribeSequenced();
    }
    const row = getSqlite().query<{ readonly payload_json: string }, []>("SELECT payload_json FROM events WHERE id='path-error'").get();
    const combined = JSON.stringify({ row, observed, sequenced });
    expect(combined).not.toContain("/private/");
    expect(combined).not.toContain("source.pdf");
    expect(combined).toContain("path_unavailable");
    expect(combined).toContain("프로젝트 파일에 안전하게 접근할 수 없어요");
  });

  test("Given arbitrary POSIX Windows multiline and stack error When crossing boundary Then generic bounded copy replaces all diagnostics", async () => {
    const raw = "failed /private/a C:\\Users\\alice\\secret\nError: boom\n at internal (/srv/app.ts:4)";
    const tracePath = path.join(logsDir, "turn-error-session.trace.log");
    await rm(tracePath, { force: true });
    await persistAndPublish("turn-error-session", { id: "unknown-error", ts: 3, type: "status.error", message: raw, recoverable: true }, new Error(raw));
    const payload = getSqlite().query<{ readonly payload_json: string }, []>("SELECT payload_json FROM events WHERE id='unknown-error'").get()?.payload_json ?? "";
    expect(payload).not.toContain("/private/");
    expect(payload).not.toContain("C:\\\\Users");
    expect(payload).not.toContain("internal");
    expect(payload).toContain("turn_failed");
    expect(payload).toContain("요청을 처리하지 못했어요");
    expect(payload.length).toBeLessThan(300);
    const trace = await readFile(tracePath, "utf8");
    expect(trace).not.toContain("/private/");
    expect(trace).not.toContain("C:\\Users");
    expect(trace).not.toContain("alice");
    expect(trace).toContain('"name":"Error"');
  });

  test("Given ordinary user cancellation When crossing boundary Then interrupted idle semantics remain unchanged", async () => {
    await persistAndPublish("turn-error-session", { id: "cancelled", ts: 4, type: "status.idle", stopReason: "interrupted" });
    expect(getSqlite().query<{ readonly payload_json: string }, []>("SELECT payload_json FROM events WHERE id='cancelled'").get()?.payload_json).toContain('"stopReason":"interrupted"');
    expect(getSqlite().query<{ readonly count: number }, []>("SELECT COUNT(*) count FROM events WHERE session_id='turn-error-session' AND type='status.error'").get()?.count).toBe(0);
  });

  test("Given a logo deliverable refusal When crossing the boundary Then the finite reason ships and the private detail does not", async () => {
    const error = new LogoDeliverableError("candidate_unprovenanced:candidate-3");
    await persistAndPublish("turn-error-session", { id: "logo-reason", ts: 5, type: "status.error", message: error.message, recoverable: true }, error);
    const payload = getSqlite().query<{ readonly payload_json: string }, []>("SELECT payload_json FROM events WHERE id='logo-reason'").get()?.payload_json ?? "";
    expect(payload).toContain("logo_image_provenance_missing");
    expect(payload).toContain("logo_candidate_provenance");
    expect(payload).not.toContain("candidate_unprovenanced");
    expect(payload).not.toContain("candidate-3");
  });

  test.each([
    ["svg_forbidden_attribute:data-variant", "logo_svg_invalid"],
    ["svg_source_mismatch", "logo_svg_source_mismatch"],
    ["svg_missing", "logo_svg_missing"],
    ["prior_candidate_changed:1:candidate-2", "logo_history_changed"],
    ["manifest_invalid:rounds.0.candidates", "logo_manifest_invalid"],
    ["guidelines_pages_over", "logo_guidelines_invalid"],
    ["candidate_truncated:candidate-1", "logo_candidate_invalid"],
    ["selection_not_recorded", "logo_selection_invalid"],
  ])("Given the private detail %p Then the published reason is %p", (detail, reason) => {
    expect(sanitizeTurnEvent({ id: "r", ts: 1, type: "status.error", message: detail, recoverable: true }, new LogoDeliverableError(detail)))
      .toMatchObject({ reason });
  });

  test("Given an unrecognised detail Then no reason is claimed at all", () => {
    expect(sanitizeTurnEvent({ id: "r", ts: 1, type: "status.error", message: "x", recoverable: true }, new LogoDeliverableError("brand_new_failure:secret")))
      .not.toHaveProperty("reason");
  });

  test("Given a wrapped logo refusal Then the reason survives the cause chain", () => {
    const wrapped = new Error("outer", { cause: new Error("inner", { cause: new LogoDeliverableError("svg_forbidden_element:script") }) });
    expect(sanitizeTurnEvent({ id: "r", ts: 1, type: "status.error", message: "x", recoverable: true }, wrapped)).toMatchObject({ reason: "logo_svg_invalid" });
  });

  test.each([
    ["an unknown reason", { reason: "totally_made_up" }],
    ["a not-applied notice with a path", { notApplied: { turnId: "/private/x", operationId: "op", repairs: 0 } }],
    ["a not-applied notice with a fractional count", { notApplied: { turnId: "t", operationId: "op", repairs: 1.5 } }],
    ["a not-applied notice with an absurd count", { notApplied: { turnId: "t", operationId: "op", repairs: 99 } }],
    ["a not-applied notice that is not an object", { notApplied: "yes" }],
  ])("Given %s claimed on the event Then it is dropped rather than forwarded", (_label, claim) => {
    const sanitized = sanitizeTurnEvent({ id: "r", ts: 1, type: "status.error", message: "x", recoverable: true, ...claim } as never);
    expect(sanitized).not.toHaveProperty("reason");
    expect(sanitized).not.toHaveProperty("notApplied");
  });

  test("Given a well-formed not-applied notice Then it is preserved", () => {
    expect(sanitizeTurnEvent({ id: "r", ts: 1, type: "status.error", message: "x", recoverable: true, notApplied: { turnId: "01ABC", operationId: "01DEF", repairs: 1 } }))
      .toMatchObject({ notApplied: { turnId: "01ABC", operationId: "01DEF", repairs: 1 } });
  });

  test("Given an allowlisted immutable failure When crossing boundary Then its stable code and Korean copy survive", async () => {
    const error = Object.assign(new Error("raw /private/source.pdf"), { code: "immutable_reference_escaped" });
    await persistAndPublish("turn-error-session", { id: "known-error", ts: 4, type: "status.error", message: error.message, recoverable: true }, error);
    const payload = getSqlite().query<{ readonly payload_json: string }, []>("SELECT payload_json FROM events WHERE id='known-error'").get()?.payload_json ?? "";
    expect(payload).toContain("immutable_reference_escaped");
    expect(payload).toContain("읽기 전용 참조 파일은 결과물에 복사할 수 없어요");
    expect(payload).not.toContain("/private/");
  });
});
