import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Whether the user already sends Codex telemetry to an OpenTelemetry destination of their own.
 *
 * Codex builds its exporters from `[otel]` in `$CODEX_HOME/config.toml` (`exporter`,
 * `trace_exporter`, `metrics_exporter`; only the `otlp-http` / `otlp-grpc` tables name a
 * destination, while `"none"` and `"statsig"` do not), and its OTLP clients read
 * `OTEL_EXPORTER_OTLP_*` from the environment the backend passes on. The check is read-only and
 * bounded, never logs, and is conservative: a config file that exists but cannot be read or parsed
 * counts as configured. Only a missing file counts as not configured.
 */
const MAX_CONFIG_BYTES = 1024 * 1024;
const EXPORTER_KEYS = ["exporter", "trace_exporter", "metrics_exporter"] as const;

function namesDestination(kind: unknown): boolean {
  return typeof kind === "object" && kind !== null;
}

function otelTableConfigured(otel: unknown): boolean {
  if (typeof otel !== "object" || otel === null) return false;
  return EXPORTER_KEYS.some((key) => namesDestination(Reflect.get(otel, key)));
}

async function configFileConfigured(file: string): Promise<boolean> {
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_CONFIG_BYTES) return true;
    return otelTableConfigured(Reflect.get(Bun.TOML.parse(await readFile(file, "utf8")), "otel"));
  } catch (error) {
    const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

export function userOtelEnvConfigured(env: NodeJS.ProcessEnv): boolean {
  return Object.entries(env).some(([name, value]) => name.startsWith("OTEL_EXPORTER_OTLP_") && typeof value === "string" && value.trim() !== "");
}

export async function detectUserCodexOtel(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (userOtelEnvConfigured(env)) return true;
  return configFileConfigured(path.join(env.CODEX_HOME ?? path.join(homedir(), ".codex"), "config.toml"));
}

/** Unset follows the automatic default (on unless the user has their own destination); an explicit choice wins. */
export function codexProgressMetricsEffective(choice: boolean | null, userOtelConfigured: boolean): boolean {
  return choice ?? !userOtelConfigured;
}

/** The effective setting for one run; detection is skipped when the user has already chosen. */
export async function resolveCodexProgressMetrics(choice: boolean | null, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return choice ?? codexProgressMetricsEffective(null, await detectUserCodexOtel(env));
}
