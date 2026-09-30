import { describe, expect, test } from "bun:test";
import { buildContentDisposition, buildDownloadFilename, slugifyProjectName } from "../src/services/export-naming";

describe("bugfind export naming", () => {
  test("Given a long project name whose 80th character is a word break When the download filename is built Then it has no doubled hyphen before the tag", () => {
    // Given
    const name = `${"a".repeat(79)} final review`;
    // When
    const slug = slugifyProjectName(name);
    const filename = buildDownloadFilename({ projectName: name, revision: 2, format: "pdf", projectType: "slide_deck" });
    // Then
    expect(slug.endsWith("-")).toBe(false);
    expect(filename).not.toContain("--");
  });

  test("Given a project name with an apostrophe and parentheses When the download header is built Then filename* uses only RFC 8187 attr-char in its value", () => {
    // Given
    const filename = buildDownloadFilename({ projectName: "Bob's deck (draft)", revision: 1, format: "pdf", projectType: "slide_deck" });
    // When
    const header = buildContentDisposition(filename);
    const extValue = /filename\*=UTF-8''(.*)$/u.exec(header)?.[1] ?? "";
    // Then
    expect(extValue).toMatch(/^(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-F]{2})+$/u);
  });
});
