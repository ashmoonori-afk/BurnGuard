import { describe, expect, test } from "bun:test";
import { compareVersions, selectUpdate, type VelopackFeedAsset } from "../src/services/mac-updates";

const asset = (version: string): VelopackFeedAsset => ({
  PackageId: "BurnGuard", Version: version, Type: "Full", FileName: `BurnGuard-${version}-osx-full.nupkg`, SHA256: "AB".repeat(32), Size: 3,
});

describe("macOS updater prerelease ordering", () => {
  test("Given numeric prerelease identifiers When compared Then 1.0.0-rc.10 is newer than 1.0.0-rc.2", () => {
    expect(compareVersions("1.0.0-rc.10", "1.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
  });

  test("Given a current prerelease When the feed lists rc.10 Then rc.10 is selected over rc.2", () => {
    expect(selectUpdate([asset("1.0.0-rc.10")], "1.0.0-rc.2")?.Version).toBe("1.0.0-rc.10");
  });

  test("Given a numeric and an alphanumeric identifier at the same position When compared Then the numeric identifier sorts lower", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.x")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc.x", "1.0.0-rc.1")).toBeGreaterThan(0);
  });

  test("Given identifier sets that share every earlier field When one set is shorter Then the shorter set sorts lower", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBeGreaterThan(0);
  });

  test("Given equal prerelease identifiers When compared Then they are equal and a release outranks them", () => {
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.2")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.10")).toBeGreaterThan(0);
  });
});
