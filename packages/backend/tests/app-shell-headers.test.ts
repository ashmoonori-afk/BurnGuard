import { describe, expect, test } from "bun:test";
import { createApp } from "../src/server";

describe("application shell headers", () => {
  test("Given the SPA shell When served Then it refuses to be framed and is not sniffed", async () => {
    const app = createApp();
    for (const route of ["/", "/projects/example"]) {
      const response = await app.request(route);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
});
