import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parsePypdfVersion,
  parsePythonVersion,
  pypdfHealth,
  pypdfInstallCommand,
} from "../src/services/python-health";
import { PYPDF_REQUIRED_VERSION, isSupportedPypdfVersion } from "../src/services/pypdf-version";
import { UPLOAD_EXTRACTOR_PY } from "../src/services/upload-extractor-py";

describe("parsePythonVersion", () => {
  test("extracts the first non-empty line verbatim", () => {
    expect(parsePythonVersion("Python 3.13.5\n")).toBe("Python 3.13.5");
    expect(parsePythonVersion("\n  Python 3.11.2  \n")).toBe("Python 3.11.2");
  });

  test("returns null on an empty probe", () => {
    expect(parsePythonVersion("")).toBeNull();
    expect(parsePythonVersion("   \n\n")).toBeNull();
  });

  test("falls back to the raw first line even for unusual output", () => {
    expect(parsePythonVersion("Conda Python wrapper\n")).toBe(
      "Conda Python wrapper",
    );
  });
});

describe("parsePypdfVersion", () => {
  test("accepts standard dotted versions", () => {
    expect(parsePypdfVersion("4.3.1\n")).toBe("4.3.1");
    expect(parsePypdfVersion("5.0.0+local\n")).toBe("5.0.0+local");
  });

  test("rejects non-version output", () => {
    expect(parsePypdfVersion("ImportError: no module named pypdf")).toBeNull();
    expect(parsePypdfVersion("")).toBeNull();
  });
});

describe("pypdf version gate", () => {
  test("Given installed pypdf versions When compared with the pinned minimum Then only the reviewed line or newer is supported", () => {
    expect(PYPDF_REQUIRED_VERSION).toBe("6.18.0");
    expect(isSupportedPypdfVersion("6.18.0")).toBe(true);
    expect(isSupportedPypdfVersion("6.18.1")).toBe(true);
    expect(isSupportedPypdfVersion("7.0.0")).toBe(true);
    expect(isSupportedPypdfVersion("6.13.3")).toBe(false);
    expect(isSupportedPypdfVersion("4.3.1+local")).toBe(false);
    expect(isSupportedPypdfVersion(null)).toBe(false);
  });

  test("Given an unsupported installed pypdf When health is summarized Then it is found but not supported", () => {
    expect(pypdfHealth("6.13.3")).toEqual({ found: true, version: "6.13.3", supported: false, required_version: PYPDF_REQUIRED_VERSION });
    expect(pypdfHealth("6.18.0")).toEqual({ found: true, version: "6.18.0", supported: true, required_version: PYPDF_REQUIRED_VERSION });
    expect(pypdfHealth(null)).toEqual({ found: false, version: null, supported: false, required_version: PYPDF_REQUIRED_VERSION });
  });

  test("Given the in-app installer, requirements.txt and the embedded extractor When compared Then all three pin the same pypdf version", async () => {
    expect(pypdfInstallCommand(["python3"])).toEqual(["python3", "-m", "pip", "install", "--user", `pypdf==${PYPDF_REQUIRED_VERSION}`]);
    const requirements = await readFile(path.join(import.meta.dir, "..", "requirements.txt"), "utf8");
    expect(requirements.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"))).toEqual([`pypdf==${PYPDF_REQUIRED_VERSION}`]);
    expect(UPLOAD_EXTRACTOR_PY).toContain(`REQUIRED_PYPDF = (${PYPDF_REQUIRED_VERSION.split(".").join(", ")})`);
  });
});
