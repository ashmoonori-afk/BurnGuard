import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { QaInputError, QaPreflightError, QaTimeoutError } from "./errors";
import {
  parseUlwStatus,
  ULW_SESSION_ID,
  type UlwStatus,
} from "./ulw-status";

export { ULW_SESSION_ID };

export type IsolatedHome = {
  readonly path: string;
  readonly environment: Readonly<Record<string, string>>;
};

function parseStatus(raw: string): UlwStatus {
  try {
    return parseUlwStatus(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new QaInputError("truncated_status", "ULW status was not valid JSON");
    }
    throw new QaInputError("invalid_attempt", "ULW status has no current attempt directory");
  }
}

async function runToolkit(args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["omo-agent-toolkit", "ulw-loop", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill();
      reject(new QaTimeoutError("ULW status"));
    }, 30_000);
  });
  try {
    const [exitCode, output] = await Promise.race([
      Promise.all([child.exited, new Response(child.stdout).text()]),
      timeout,
    ]);
    if (exitCode !== 0) {
      throw new QaPreflightError("ulw_status_failed", "ULW status command failed");
    }
    return output;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function currentAttemptDirectory(repoRoot: string): Promise<string> {
  let status = parseStatus(
    await runToolkit(["status", "--session-id", ULW_SESSION_ID, "--json"]),
  );
  if (status.currentAttemptDir.length === 0) {
    await runToolkit(["complete-goals", "--session-id", ULW_SESSION_ID, "--json"]);
    status = parseStatus(
      await runToolkit(["status", "--session-id", ULW_SESSION_ID, "--json"]),
    );
  }
  const absolute = path.resolve(repoRoot, status.currentAttemptDir);
  const evidenceRoot = path.resolve(repoRoot, ".omo/evidence");
  if (!absolute.startsWith(`${evidenceRoot}${path.sep}`)) {
    throw new QaInputError("invalid_attempt_path", "Attempt directory is outside ignored evidence");
  }
  await mkdir(absolute, { recursive: true });
  const ignored = Bun.spawn(["git", "check-ignore", "-q", `${absolute}/probe`], {
    cwd: repoRoot,
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await ignored.exited) !== 0) {
    throw new QaPreflightError("attempt_not_ignored", "Attempt directory is not ignored by Git");
  }
  return absolute;
}

export async function createIsolatedHome(
  attemptDirectory: string,
  realHome: string,
): Promise<IsolatedHome> {
  if (!path.isAbsolute(attemptDirectory) || !path.isAbsolute(realHome)) {
    throw new QaInputError("invalid_home_path", "HOME roots must be absolute paths");
  }
  const home = await mkdtemp(path.join(attemptDirectory, "qa-home."));
  return {
    path: home,
    environment: {
      HOME: home,
      CODEX_HOME: path.join(realHome, ".codex"),
      BG_NO_OPEN: "1",
    },
  };
}

export async function removeIsolatedHome(home: IsolatedHome): Promise<void> {
  await rm(home.path, { recursive: true, force: true });
}

export const __testParseStatus = parseStatus;
