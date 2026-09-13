import { afterEach, describe, expect, test } from "bun:test";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { logsDir } from "../src/lib/paths";
import { appendSessionTrace } from "../src/services/trace";

const sessionId = `trace-security-${process.pid}`;
const tracePath = path.join(logsDir, `${sessionId}.trace.log`);

afterEach(() => rm(tracePath, { force: true }));

describe("session trace confidentiality", () => {
  test.skipIf(process.platform === "win32")(
    "creates diagnostic traces readable only by the profile owner",
    async () => {
      await appendSessionTrace(sessionId, {
        level: "security-test",
        private: "/Users/local/private-project",
      });

      expect((await stat(logsDir)).mode & 0o777).toBe(0o700);
      expect((await stat(tracePath)).mode & 0o777).toBe(0o600);
    },
  );
});
