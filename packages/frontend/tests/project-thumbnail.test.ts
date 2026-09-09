import { describe, expect, test } from "bun:test";
import { resolveThumbnailSource, thumbnailRetryDelay } from "../src/components/home/thumbnail-source";

const url = "/api/projects/p1/thumbnail?v=aaa";
const nextUrl = "/api/projects/p1/thumbnail?v=bbb";

describe("resolveThumbnailSource", () => {
  test("Given a transient cold thumbnail failure When retrying Then backoff is bounded and manual recovery remains available", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(thumbnailRetryDelay)).toEqual([2000, 4000, 8000, 16000, 32000, null, null]);
    expect(resolveThumbnailSource(url, null)).toBe(url);
  });
  test("Given a thumbnail URL that has not failed When resolved Then the real image URL is used", () => {
    expect(resolveThumbnailSource(url, null)).toBe(url);
  });

  test("Given a thumbnail URL that already failed to load When resolved Then the placeholder is used", () => {
    expect(resolveThumbnailSource(url, url)).toBeNull();
  });

  test("Given a changed thumbnail URL after an earlier failure When resolved Then the new URL is retried", () => {
    expect(resolveThumbnailSource(nextUrl, url)).toBe(nextUrl);
  });

  test("Given no thumbnail URL When resolved Then the placeholder is used", () => {
    expect(resolveThumbnailSource(null, null)).toBeNull();
    expect(resolveThumbnailSource(undefined, null)).toBeNull();
    expect(resolveThumbnailSource("", null)).toBeNull();
  });
});
