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
});
