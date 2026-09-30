import { afterAll, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createDesignSystemRecord } from "../src/db/seed";
import { systemsDir } from "../src/lib/paths";
import { systemRoutes } from "../src/routes/system";

const SYSTEM_ID = "bugfind-sec-error-leak";
const systemDir = path.join(systemsDir, SYSTEM_ID);

afterAll(async () => {
  await rm(systemDir, { recursive: true, force: true });
});

test("Given a design system whose token file cannot be written When a color token is saved Then the API error body carries no absolute managed path or raw filesystem diagnostic", async () => {
  // Given: the managed token file path exists but cannot be written (a directory stands in for a locked or read-only file).
  const tokenPath = path.join(systemDir, "colors_and_type.css");
  await mkdir(tokenPath, { recursive: true });
  await createDesignSystemRecord({
    id: SYSTEM_ID,
    name: "Bugfind error leak",
    description: null,
    status: "published",
    sourceType: "manual",
    sourceUri: null,
    dirPath: systemDir,
    skillMdPath: null,
    tokensCssPath: tokenPath,
    readmeMdPath: null,
    thumbnailPath: null,
  });

  // When: the color editor saves a token.
  const response = await systemRoutes.fetch(new Request(`http://127.0.0.1:14070/api/design-systems/${SYSTEM_ID}/colors`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "brand", value: "#112233" }),
  }));
  const body = await response.text();

  // Then: the failure is a stable code without private paths or errno text.
  expect(response.status).toBe(500);
  expect(body).not.toContain(systemsDir);
  expect(body).not.toMatch(/\bE(?:ISDIR|NOENT|ACCES|PERM|BUSY)\b/u);
});
