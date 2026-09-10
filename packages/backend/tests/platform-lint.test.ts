import { describe, expect, test } from "bun:test";
import {
  CAFE24_MAX_FILE_BYTES,
  CAFE24_MAX_FOLDER_FILES,
  IMWEB_MAX_FRAGMENT_CHARS,
  IMWEB_WARN_FRAGMENT_CHARS,
  hasBlockingFinding,
  lintForPlatform,
  type PlatformLintCode,
  type PlatformLintFinding,
  type PlatformLintInput,
} from "../src/services/platform-lint";

function codes(findings: readonly PlatformLintFinding[]): readonly PlatformLintCode[] {
  return findings.map((finding) => finding.code);
}

function severityOf(findings: readonly PlatformLintFinding[], code: PlatformLintCode): string | undefined {
  return findings.find((finding) => finding.code === code)?.severity;
}

function cafe24(input: Partial<Omit<PlatformLintInput, "platform">>): readonly PlatformLintFinding[] {
  return lintForPlatform({ platform: "cafe24", assets: input.assets ?? [], documents: input.documents ?? [] });
}

function imweb(input: Partial<Omit<PlatformLintInput, "platform">>): readonly PlatformLintFinding[] {
  return lintForPlatform({ platform: "imweb", assets: input.assets ?? [], documents: input.documents ?? [] });
}

describe("cafe24 platform lint", () => {
  test("Given a woff2 font asset When linted Then a disallowed-extension warning names the file", () => {
    // Given / When
    const findings = cafe24({ assets: [{ path: "web/shop/fonts/Pretendard-Regular.woff2", bytes: 1024 }] });

    // Then
    expect(codes(findings)).toContain("cafe24_disallowed_extension");
    expect(severityOf(findings, "cafe24_disallowed_extension")).toBe("warning");
    expect(findings.find((finding) => finding.code === "cafe24_disallowed_extension")?.path).toBe("web/shop/fonts/Pretendard-Regular.woff2");
  });

  test("Given an allowlisted asset When linted Then no extension finding is produced", () => {
    expect(codes(cafe24({ assets: [{ path: "web/shop/img/hero.png", bytes: 1024 }] }))).not.toContain("cafe24_disallowed_extension");
  });

  test("Given a file one byte over the 30MB limit When linted Then the size warning fires", () => {
    const findings = cafe24({ assets: [{ path: "web/shop/img/huge.png", bytes: CAFE24_MAX_FILE_BYTES + 1 }] });
    expect(severityOf(findings, "cafe24_file_over_30mb")).toBe("warning");
    expect(codes(cafe24({ assets: [{ path: "web/shop/img/huge.png", bytes: CAFE24_MAX_FILE_BYTES }] }))).not.toContain("cafe24_file_over_30mb");
  });

  test("Given one folder over the file cap When linted Then exactly one folder warning names that folder", () => {
    // Given
    const assets = Array.from({ length: CAFE24_MAX_FOLDER_FILES + 1 }, (_unused, index) => ({ path: `web/shop/img/a${index}.png`, bytes: 10 }));

    // When
    const findings = cafe24({ assets });

    // Then
    expect(findings.filter((finding) => finding.code === "cafe24_folder_over_1000_files")).toHaveLength(1);
    expect(findings.find((finding) => finding.code === "cafe24_folder_over_1000_files")?.path).toBe("web/shop/img");
  });

  test("Given a Korean asset filename When linted Then the filename warning fires", () => {
    expect(severityOf(cafe24({ assets: [{ path: "web/shop/img/배너.png", bytes: 10 }] }), "cafe24_korean_asset_filename")).toBe("warning");
  });

  test("Given a jQuery include When linted Then the duplicate-library warning fires without a remote-asset error", () => {
    // Given / When
    const findings = cafe24({ documents: [{ path: "pages/index.html", role: "page_fragment", text: '<script src="js/jquery-3.7.1.min.js"></script>' }] });

    // Then
    expect(severityOf(findings, "cafe24_jquery_duplicate")).toBe("warning");
    expect(hasBlockingFinding(findings)).toBe(false);
  });

  test("Given every cafe24 finding class When linted Then none of them block the export", () => {
    const findings = cafe24({
      assets: [{ path: "web/shop/fonts/x.woff2", bytes: CAFE24_MAX_FILE_BYTES + 1 }, { path: "web/shop/img/배너.png", bytes: 1 }],
      documents: [{ path: "pages/index.html", role: "page_fragment", text: '<script src="jquery.js"></script>' }],
    });
    expect(findings.every((finding) => finding.severity !== "error")).toBe(true);
  });
});

describe("imweb platform lint", () => {
  test("Given a fragment one character over the million-character cap When linted Then it is a blocking error", () => {
    // Given
    const text = "a".repeat(IMWEB_MAX_FRAGMENT_CHARS + 1);

    // When
    const findings = imweb({ documents: [{ path: "pages/index.imweb.html", role: "page_fragment", text }] });

    // Then
    expect(severityOf(findings, "imweb_page_over_1m_chars")).toBe("error");
    expect(hasBlockingFinding(findings)).toBe(true);
  });

  test("Given a fragment at the cap When linted Then only the soft warning fires", () => {
    const findings = imweb({ documents: [{ path: "pages/index.imweb.html", role: "page_fragment", text: "a".repeat(IMWEB_MAX_FRAGMENT_CHARS) }] });
    expect(codes(findings)).not.toContain("imweb_page_over_1m_chars");
    expect(severityOf(findings, "imweb_page_over_500k_chars")).toBe("warning");
    expect(hasBlockingFinding(findings)).toBe(false);
  });

  test("Given a fragment one character over the soft threshold When linted Then the soft warning fires", () => {
    expect(codes(imweb({ documents: [{ path: "pages/a.imweb.html", role: "page_fragment", text: "a".repeat(IMWEB_WARN_FRAGMENT_CHARS + 1) }] }))).toContain("imweb_page_over_500k_chars");
    expect(codes(imweb({ documents: [{ path: "pages/a.imweb.html", role: "page_fragment", text: "a".repeat(IMWEB_WARN_FRAGMENT_CHARS) }] }))).not.toContain("imweb_page_over_500k_chars");
  });

  test("Given a form and an iframe When linted Then the unsupported-element warning fires once per document", () => {
    const findings = imweb({ documents: [{ path: "pages/a.imweb.html", role: "page_fragment", text: '<form action="/x"></form><iframe src="about:blank"></iframe>' }] });
    expect(findings.filter((finding) => finding.code === "imweb_form_or_iframe")).toHaveLength(1);
    expect(severityOf(findings, "imweb_form_or_iframe")).toBe("warning");
  });

  test("Given a local font-face source in the common code When linted Then the local-font warning fires", () => {
    const findings = imweb({ documents: [{ path: "common/header-code.html", role: "common_code", text: "<style>@font-face{font-family:X;src:url(fonts/x.woff2)}</style>" }] });
    expect(severityOf(findings, "imweb_local_font")).toBe("warning");
  });

  test("Given the same element id in two fragments When linted Then a duplicate-id warning names the id", () => {
    const findings = imweb({
      documents: [
        { path: "pages/a.imweb.html", role: "page_fragment", text: '<div id="hero"></div>' },
        { path: "pages/b.imweb.html", role: "page_fragment", text: '<div id="hero"></div>' },
      ],
    });
    expect(codes(findings)).toContain("imweb_duplicate_id");
    expect(findings.find((finding) => finding.code === "imweb_duplicate_id")?.evidence).toContain("hero");
  });

  test("Given an unscoped selector in the common code When linted Then the global-selector warning fires", () => {
    expect(codes(imweb({ documents: [{ path: "common/header-code.html", role: "common_code", text: "<style>body{margin:0}</style>" }] }))).toContain("imweb_global_selector");
    expect(codes(imweb({ documents: [{ path: "common/header-code.html", role: "common_code", text: "<style>.bg-site{margin:0}</style>" }] }))).not.toContain("imweb_global_selector");
  });

  test("Given a document-wide script When linted Then the script-scope warning fires", () => {
    expect(codes(imweb({ documents: [{ path: "pages/a.imweb.html", role: "page_fragment", text: "<script>document.body.classList.add('x')</script>" }] }))).toContain("imweb_document_script");
  });
});
