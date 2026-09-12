import { CLAUDE_MODELS, GENERATION_EFFORTS, type BackendDetectionResult, type GenerationModel } from "@bg/shared";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const VERSION_PROBE_TIMEOUT_MS = 5_000;

let cachedValue: BackendDetectionResult | null = null;
let cachedAt = 0;

export class CodexAuthenticationProbeError extends Error {
  readonly code = "codex_authentication_probe_failed";
  constructor(readonly diagnostics: { reason: "timeout" | "execution_failed" | "unexpected_response"; exit_code: number | null; elapsed_ms: number }) {
    super("Codex login status could not be checked. Please try again.");
    this.name = "CodexAuthenticationProbeError";
  }
}

/** Only an explicit CLI login/logout response confirms authentication state. */
export async function probeCodexAuthentication(binaryPath: string): Promise<boolean> {
  const started = performance.now();
  const controller = new AbortController();
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let exitCode: number | null = null;
  const failure = (reason: CodexAuthenticationProbeError["diagnostics"]["reason"]) => new CodexAuthenticationProbeError({ reason, exit_code: exitCode, elapsed_ms: Math.round(performance.now() - started) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(failure("timeout")); }, 5_000);
  });
  try {
    const child = Bun.spawn({ cmd: [binaryPath, "login", "status"], stdin: "ignore", stdout: "pipe", stderr: "pipe", signal: controller.signal, killSignal: "SIGKILL" });
    proc = child;
    const [stdout, stderr, exit] = await Promise.race([Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]), timeout]);
    exitCode = exit;
    const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((line) => line.trim());
    if (exit === 0 && lines.some((line) => /^logged in using\s+\S/i.test(line))) return true;
    if (exit === 1 && lines.some((line) => /^not logged in$/i.test(line))) return false;
    throw failure(exit === 0 ? "unexpected_response" : "execution_failed");
  } catch (error) {
    // Never retain raw CLI output, spawn errors, or credentials in diagnostics.
    if (error instanceof CodexAuthenticationProbeError) throw error;
    throw failure(controller.signal.aborted ? "timeout" : "execution_failed");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (controller.signal.aborted && proc) await proc.exited;
  }
}

/** Read model metadata only; authentication and personal instructions never enter the API. */
export async function readCodexModels(): Promise<GenerationModel[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "models_cache.json"), "utf8"));
    if (typeof raw !== "object" || raw === null || !("models" in raw) || !Array.isArray(raw.models)) return [];
    return raw.models.flatMap((model: unknown): GenerationModel[] => {
      if (typeof model !== "object" || model === null) return [];
      const m = model as Record<string, unknown>;
      if (typeof m.slug !== "string" || !/^[a-zA-Z0-9._-]{1,120}$/.test(m.slug) || m.visibility !== "list" || !Array.isArray(m.supported_reasoning_levels)) return [];
      const efforts = GENERATION_EFFORTS.filter((effort) => m.supported_reasoning_levels instanceof Array && m.supported_reasoning_levels.some((level: unknown) => typeof level === "object" && level !== null && "effort" in level && level.effort === effort));
      return efforts.includes("low") ? [{ id: m.slug, label: typeof m.display_name === "string" ? m.display_name.slice(0, 120) : m.slug, efforts }] : [];
    }).slice(0, 100);
  } catch { return []; }
}

/**
 * Runs `<binary> --version`. stdout and stderr are drained concurrently —
 * reading them in sequence deadlocks whenever a CLI fills the stderr pipe
 * buffer while we are still blocked on stdout. A CLI that never answers is
 * abandoned after `VERSION_PROBE_TIMEOUT_MS`; the binary is on PATH either
 * way, so the caller keeps `found: true` and just loses the version string.
 */
async function probeVersion(binaryPath: string): Promise<string | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(undefined); }, VERSION_PROBE_TIMEOUT_MS); });
  try {
    const proc = Bun.spawn({
      cmd: [binaryPath, "--version"],
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    });
    const read = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      .then(([stdout, stderr]) => stdout.trim() || stderr.trim() || undefined)
      .catch(() => undefined);
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function detectOne(id: "claude-code" | "codex", binaryNames: string[], installHint: string) {
  for (const name of binaryNames) {
    const binaryPath = Bun.which(name);
    if (!binaryPath) continue;

    try {
      return {
        id,
        found: true,
        version: await probeVersion(binaryPath),
        binary_path: binaryPath,
      } as const;
    } catch {
      return {
        id,
        found: true,
        binary_path: binaryPath,
        install_hint: `${id} found but version probe failed`,
      } as const;
    }
  }

  return {
    id,
    found: false,
    install_hint: installHint,
  } as const;
}

/**
 * Cache UI probes briefly; turn start forces a fresh authentication check.
 */
export async function detectBackends(options: { force?: boolean } = {}): Promise<BackendDetectionResult> {
  if (!options.force && cachedValue && Date.now() - cachedAt < 30_000) {
    return cachedValue;
  }

  const backends = await Promise.all([
    detectOne("claude-code", ["claude", "claude.cmd"], "Install: https://claude.com/code"),
    detectOne("codex", ["codex", "codex.cmd", "openai-codex"], "Install: https://github.com/openai/codex"),
  ]);

  const codex = backends.find((backend) => backend.id === "codex");
  try {
    const [authenticated, models] = await Promise.all([codex?.binary_path ? probeCodexAuthentication(codex.binary_path) : false, readCodexModels()]);
    cachedValue = { backends: backends.map((backend) => backend.id === "codex" ? { ...backend, authenticated, models } : { ...backend, models: CLAUDE_MODELS }) };
    cachedAt = Date.now();
    return cachedValue;
  } catch (error) {
    // A failed fresh check confirms neither logout nor the previous cached login.
    cachedValue = null;
    throw error;
  }
}
