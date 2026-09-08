import os from "node:os";
import path from "node:path";

const configuredRoot = process.env.BG_APP_ROOT;
if (configuredRoot !== undefined && !path.isAbsolute(configuredRoot)) {
  throw new Error("BG_APP_ROOT must be an absolute directory");
}
if (process.env.NODE_ENV === "test" && !configuredRoot) {
  throw new Error("Tests require an isolated BG_APP_ROOT; run bun test from the repository root");
}
export const appRootDir = configuredRoot ?? path.join(os.homedir(), ".burnguard");
export const dataDir = path.join(appRootDir, "data");
export const systemsDir = path.join(dataDir, "systems");
export const projectsDir = path.join(dataDir, "projects");
export const cacheDir = path.join(appRootDir, "cache");
export const logsDir = path.join(appRootDir, "logs");
export const exportsDir = path.join(cacheDir, "exports");
export const configFilePath = path.join(appRootDir, "config.json");
