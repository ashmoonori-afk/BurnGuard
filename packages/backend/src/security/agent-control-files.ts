import { readdir } from "node:fs/promises";
import path from "node:path";

const AGENT_CONTROL_FILE_NAMES = new Set([
  ".mcp.json",
  "agents.md",
  "agents.override.md",
  "claude.local.md",
  "claude.md",
]);

const AGENT_CONTROL_DIRECTORY_NAMES = new Set([".claude", ".codex"]);

export function isAgentControlFilePath(relativePath: string): boolean {
  const name = relativePath.replaceAll("\\", "/").split("/").at(-1);
  return (
    name !== undefined &&
    AGENT_CONTROL_FILE_NAMES.has(name.normalize("NFC").toLowerCase())
  );
}

export function isAgentControlPath(relativePath: string): boolean {
  const components = relativePath
    .replaceAll("\\", "/")
    .split("/")
    .map((component) => component.normalize("NFC").toLowerCase());
  return (
    components.some((component) =>
      AGENT_CONTROL_DIRECTORY_NAMES.has(component),
    ) || isAgentControlFilePath(relativePath)
  );
}

const OWNED_TOP_LEVEL_DIRECTORIES = new Set([
  ".attachments",
  ".burnguard-inputs",
  ".git",
  ".meta",
  ".omc",
]);

export async function hasAgentControlFiles(root: string): Promise<boolean> {
  const visit = async (directory: string, topLevel: boolean): Promise<boolean> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = entry.name.normalize("NFC").toLowerCase();
      if (topLevel && OWNED_TOP_LEVEL_DIRECTORIES.has(name)) continue;
      if (
        entry.isDirectory() &&
        AGENT_CONTROL_DIRECTORY_NAMES.has(name)
      ) {
        return true;
      }
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (await visit(target, false)) return true;
      } else if (isAgentControlFilePath(entry.name)) {
        return true;
      }
    }
    return false;
  };
  return visit(root, true);
}
