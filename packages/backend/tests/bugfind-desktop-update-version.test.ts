import { describe, expect, test } from "bun:test";
import { compareVersions, selectUpdate, type VelopackFeedAsset } from "../src/services/mac-updates";

const asset = (version: string): VelopackFeedAsset => ({
  PackageId: "BurnGuard", Version: version, Type: "Full", FileName: `BurnGuard-${version}-osx-full.nupkg`, SHA256: "A".repeat(64), Size: 1,
});

describe("macOS updater version ordering", () => {
  test("Given numeric prerelease identifiers When compared Then 1.0.0-rc.10 is newer than 1.0.0-rc.2", () => {
    expect(compareVersions("1.0.0-rc.10", "1.0.0-rc.2")).toBeGreaterThan(0);
  });

  test("Given a current prerelease When the feed lists rc.10 Then rc.10 is selected over rc.2", () => {
    const picked = selectUpdate([asset("1.0.0-rc.10")], "1.0.0-rc.2");
    expect(picked?.Version).toBe("1.0.0-rc.10");
  });
});
