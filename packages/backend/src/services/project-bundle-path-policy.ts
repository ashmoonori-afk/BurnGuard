import path from "node:path";

const CREDENTIAL_NAMES = new Set([
  "config.json",
  ".npmrc",
  ".yarnrc",
  ".pnpmrc",
  ".netrc",
  ".git-credentials",
  "credentials",
  "credentials.json",
  "token.json",
  "tokens.json",
]);
const CREDENTIAL_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);
const CREDENTIAL_DIRECTORIES = new Set([".aws", ".azure", ".ssh"]);
const PROTECTED_DIRECTORIES = new Set([".git", ".omc", ".claude", ".codex"]);

export function isProjectBundleCredentialPath(relativePath: string): boolean {
  const parts = relativePath.split("/").map((part) => part.toLocaleLowerCase("en-US"));
  const name = parts.at(-1) ?? "";
  return name === ".env" || name.startsWith(".env.") ||
    CREDENTIAL_NAMES.has(name) ||
    CREDENTIAL_EXTENSIONS.has(path.posix.extname(name)) ||
    parts.some((part) => CREDENTIAL_DIRECTORIES.has(part));
}

export function isProjectBundleProtectedPath(relativePath: string): boolean {
  const parts = relativePath.split("/").map((part) => part.toLocaleLowerCase("en-US"));
  return parts.some((part) => PROTECTED_DIRECTORIES.has(part)) ||
    parts.join("/").startsWith(".meta/artifact-baseline/") ||
    parts.join("/").startsWith(".meta/artifact-operations/");
}
