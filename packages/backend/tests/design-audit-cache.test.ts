import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DesignAuditResult } from "@bg/shared";
import { DESIGN_AUDIT_POLICY_VERSION, writeProjectAuditCache } from "../src/services/design-audit";

function audited(revision: number, digest: string): DesignAuditResult {
  return { schema_version: 1, project_id: "cache", artifact_revision: revision, artifact_digest: digest, created_at: revision, overall_status: "ready", checks: [] };
}

test("Given a cached audit at revision 1 When revision 2 is cached Then the audits directory holds only the revision 2 file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bg-audit-cache-"));
  try {
    await writeProjectAuditCache(root, audited(1, "a".repeat(64)));
    await writeProjectAuditCache(root, audited(2, "b".repeat(64)));
    const audits = path.join(root, ".meta", "audits");
    expect(await readdir(audits)).toEqual([`2-${"b".repeat(64)}-${DESIGN_AUDIT_POLICY_VERSION}.json`]);
    expect(JSON.parse(await readFile(path.join(audits, `2-${"b".repeat(64)}-${DESIGN_AUDIT_POLICY_VERSION}.json`), "utf8"))).toEqual(audited(2, "b".repeat(64)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
