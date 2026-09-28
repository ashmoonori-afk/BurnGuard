import { expect, test } from "bun:test";
import { projectBundleFilename } from "../src/api/project-bundle";

test("Given UTF-8 and fallback bundle dispositions When parsed Then the download filename stays safe", () => {
  // Given / When
  const encoded = projectBundleFilename("attachment; filename=\"fallback\"; filename*=UTF-8''%ED%95%9C%EA%B8%80.burnguard-project");
  const unsafe = projectBundleFilename('attachment; filename="folder/name.burnguard-project"');

  // Then
  expect(encoded).toBe("한글.burnguard-project");
  expect(unsafe).toBe("folder_name.burnguard-project");
});
