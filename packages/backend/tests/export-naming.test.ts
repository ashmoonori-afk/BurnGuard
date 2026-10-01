import { describe, expect, test } from "bun:test";
import {
  buildContentDisposition,
  buildDownloadFilename,
  formatExtension,
  formatMime,
  slugifyProjectName,
} from "../src/services/export-naming";

describe("formatExtension / formatMime", () => {
  test("PDF maps to application/pdf and .pdf", () => {
    expect(formatExtension("pdf")).toBe("pdf");
    expect(formatMime("pdf")).toBe("application/pdf");
  });

  test("PPTX maps to the PowerPoint MIME and .pptx", () => {
    expect(formatExtension("pptx")).toBe("pptx");
    expect(formatMime("pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  test("Given the SVG format When named Then it maps to image/svg+xml and .svg", () => {
    // Given / When / Then
    expect(formatExtension("svg")).toBe("svg");
    expect(formatMime("svg")).toBe("image/svg+xml");
  });

  test("Given archive formats When named Then extension and MIME remain ZIP", () => {
    // Given / When / Then
    for (const f of ["html_zip", "handoff", "cafe24_package", "imweb_package", "png_zip"] as const) {
      expect(formatExtension(f)).toBe("zip");
      expect(formatMime(f)).toBe("application/zip");
    }
  });
});

describe("slugifyProjectName", () => {
  test("turns spaces into hyphens and preserves case-insensitive readability", () => {
    expect(slugifyProjectName("Series A Investor Landing")).toBe(
      "Series-A-Investor-Landing",
    );
  });

  test("strips path and reserved Windows characters", () => {
    expect(slugifyProjectName('foo/bar:baz?<>|"')).toBe("foo-bar-baz");
  });

  test("collapses runs of whitespace and dashes into a single dash", () => {
    expect(slugifyProjectName("a   b  c--d")).toBe("a-b-c-d");
  });

  test("preserves Unicode (Korean / Japanese / accented) project names", () => {
    expect(slugifyProjectName("다온 SaaS 랜딩")).toBe("다온-SaaS-랜딩");
    expect(slugifyProjectName("Café résumé")).toBe("Café-résumé");
  });

  test("falls back to 'export' when nothing slug-worthy survives", () => {
    expect(slugifyProjectName("///")).toBe("export");
    expect(slugifyProjectName("")).toBe("export");
    expect(slugifyProjectName("   ")).toBe("export");
  });

  test("truncates absurdly long names to a sane length", () => {
    const long = "a".repeat(500);
    expect(slugifyProjectName(long).length).toBeLessThanOrEqual(80);
  });

  test("Given a long name whose 80th character is a word break When slugified Then no trailing hyphen remains and the filename has no doubled hyphen", () => {
    // Given
    const name = `${"a".repeat(79)} final review`;
    // When
    const slug = slugifyProjectName(name);
    const filename = buildDownloadFilename({ projectName: name, revision: 2, format: "pdf", projectType: "slide_deck" });
    // Then
    expect(slug).toBe("a".repeat(79));
    expect(filename).not.toContain("--");
  });

  test("Given a hyphen then an emoji straddling the 80-unit cut When slugified Then the orphan surrogate and the exposed hyphen are both dropped", () => {
    // Given
    const name = `${"a".repeat(78)} \u{1F680}`;
    // When
    const slug = slugifyProjectName(name);
    // Then
    expect(slug).toBe("a".repeat(78));
  });
});

describe("buildDownloadFilename", () => {
  // Wed Apr 23 2025 00:00:00 UTC.
  const APR23 = Date.UTC(2025, 3, 23);

  test("composes <slug>-<tag>-<date>.<ext> for each format", () => {
    const base = { projectName: "Quarterly Review Deck", job: { format: "pdf", completed_at: APR23, created_at: APR23 - 1000 } } as const;
    expect(buildDownloadFilename(base)).toBe(
      "Quarterly-Review-Deck-deck-2025-04-23.pdf",
    );

    expect(
      buildDownloadFilename({
        ...base,
        job: { ...base.job, format: "pptx" },
      }),
    ).toBe("Quarterly-Review-Deck-deck-2025-04-23.pptx");

    expect(
      buildDownloadFilename({
        ...base,
        job: { ...base.job, format: "html_zip" },
      }),
    ).toBe("Quarterly-Review-Deck-html-2025-04-23.zip");

    expect(
      buildDownloadFilename({
        ...base,
        job: { ...base.job, format: "handoff" },
      }),
    ).toBe("Quarterly-Review-Deck-handoff-2025-04-23.zip");

    expect(buildDownloadFilename({ projectName: "Shop", revision: 4, format: "cafe24_package" })).toBe("Shop-cafe24-r4.zip");
    expect(buildDownloadFilename({ projectName: "Shop", revision: 4, format: "imweb_package" })).toBe("Shop-imweb-r4.zip");
    expect(buildDownloadFilename({ projectName: "Cards", revision: 4, format: "png_zip" })).toBe("Cards-frames-r4.zip");
  });

  test("Given a logo project When named Then the deliverable tag replaces the deck tag", () => {
    // Given / When / Then
    expect(buildDownloadFilename({ projectName: "Acme", revision: 3, format: "svg", projectType: "logo" })).toBe("Acme-logo-r3.svg");
    expect(buildDownloadFilename({ projectName: "Acme", revision: 3, format: "pdf", projectType: "logo" })).toBe("Acme-guidelines-r3.pdf");
    expect(buildDownloadFilename({ projectName: "Acme", revision: 3, format: "html_zip", projectType: "logo" })).toBe("Acme-guidelines-html-r3.zip");
    expect(buildDownloadFilename({ projectName: "Acme", job: { format: "pdf", completed_at: APR23, created_at: APR23 }, projectType: "logo" })).toBe("Acme-guidelines-2025-04-23.pdf");
  });

  test("Given a graphic project When named Then the existing tags are unchanged", () => {
    // Given / When / Then
    expect(buildDownloadFilename({ projectName: "Acme", revision: 3, format: "pdf", projectType: "graphic" })).toBe("Acme-deck-r3.pdf");
    expect(buildDownloadFilename({ projectName: "Acme", revision: 3, format: "pdf" })).toBe("Acme-deck-r3.pdf");
    expect(buildDownloadFilename({ projectName: "Acme", revision: 3, format: "html_zip", projectType: "prototype" })).toBe("Acme-html-r3.zip");
  });

  test("uses the creation timestamp when completed_at is missing", () => {
    expect(
      buildDownloadFilename({
        projectName: "Demo",
        job: { format: "pdf", completed_at: null, created_at: APR23 },
      }),
    ).toBe("Demo-deck-2025-04-23.pdf");
  });

  test("falls back to 'export' when project name is missing", () => {
    expect(
      buildDownloadFilename({
        projectName: null,
        job: { format: "pdf", completed_at: APR23, created_at: APR23 },
      }),
    ).toBe("export-deck-2025-04-23.pdf");
  });
});

describe("buildContentDisposition", () => {
  test("emits both ASCII filename and RFC 5987 filename* parameters", () => {
    const header = buildContentDisposition("Project A.pdf");
    expect(header).toContain('attachment;');
    expect(header).toContain('filename="Project A.pdf"');
    expect(header).toContain("filename*=UTF-8''Project%20A.pdf");
  });

  test("scrubs non-ASCII from the legacy filename and percent-encodes filename*", () => {
    const header = buildContentDisposition("다온-SaaS.zip");
    // 다온 is 2 Hangul syllable codepoints, so two underscores in the
    // ASCII-scrubbed filename, not three.
    expect(header).toContain('filename="__-SaaS.zip"');
    // Korean letters become percent-encoded UTF-8 byte sequences.
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("다온-SaaS.zip"));
  });

  test("removes inner double-quotes from the ASCII filename to keep the header valid", () => {
    const header = buildContentDisposition('Some "Quoted" project.zip');
    expect(header).toContain('filename="Some _Quoted_ project.zip"');
  });

  test("Given a project name whose 80th code unit is the high surrogate of an emoji When the download header is built Then it does not throw and filename* decodes to a well-formed slug", () => {
    // Given
    const name = `${"가".repeat(79)}🚀 런칭`;
    // When
    const slug = slugifyProjectName(name);
    const header = buildContentDisposition(buildDownloadFilename({ projectName: name, revision: 2, format: "html_zip" }));
    // Then
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).not.toMatch(/[\uD800-\uDBFF]$/u);
    const encoded = /filename\*=UTF-8''(.+)$/u.exec(header)?.[1] ?? "";
    expect(decodeURIComponent(encoded)).toBe(`${slug}-html-r2.zip`);
  });

  test("Given a project name with an apostrophe and parentheses When the download header is built Then filename* uses only RFC 8187 attr-char", () => {
    // Given
    const filename = buildDownloadFilename({ projectName: "Bob's deck (draft)", revision: 1, format: "pdf", projectType: "slide_deck" });
    // When
    const header = buildContentDisposition(filename);
    const extValue = /filename\*=UTF-8''(.*)$/u.exec(header)?.[1] ?? "";
    // Then
    expect(extValue).toBe("Bob%27s-deck-%28draft%29-deck-r1.pdf");
    expect(extValue).toMatch(/^(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-F]{2})+$/u);
    expect(decodeURIComponent(extValue)).toBe(filename);
  });

  test("Given a filename containing an asterisk When the download header is built Then the asterisk is percent-encoded in filename*", () => {
    // Given / When
    const header = buildContentDisposition("a*b.zip");
    // Then
    expect(/filename\*=UTF-8''(.*)$/u.exec(header)?.[1]).toBe("a%2Ab.zip");
  });
});
