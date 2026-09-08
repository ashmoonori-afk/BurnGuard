import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import type { BackendId, ThemeMode } from "@bg/shared";
import { APP_VERSION } from "@bg/shared";
import { appRootDir, configFilePath } from "./lib/paths";

export interface AppConfig {
  defaultBackend: BackendId;
  theme: ThemeMode;
  port: number | null;
  autoOpenBrowser: boolean;
  playwright: {
    installed: boolean;
    installPath: string | null;
  };
  harness: {
    maxConcurrentSessions: number;
    checkpointEveryTurns: number;
    toolAutoAllow: boolean;
  };
  chat: {
    /**
     * Minimum time (ms) a single CLI turn must run before the UI
     * surfaces the Interrupt button. Keeps fast turns uncluttered
     * while still giving the user a hard-stop on stuck ones.
     */
    abortThresholdMs: number;
    /**
     * Controls how much stable context is injected on every CLI turn.
     * Compact mode keeps long-running sessions cheaper by referencing
     * stable design-system files instead of re-inlining them every time.
     */
    contextMode: "compact" | "full";
  };
  logs: {
    level: "debug" | "info" | "warn" | "error";
  };
  user: {
    id: "local";
    displayName: string;
  };
  /**
   * Figma Personal Access Token used by the design-system Figma
   * extractor (P4.3). Persisted to ~/.burnguard/config.json — keep
   * the file readable only by the local user. Never echoed back
   * through the public settings API; only a boolean
   * `figma_token_set` flag is surfaced.
   */
  figmaPersonalAccessToken: string | null;
  appVersion: string;
}

export const defaultConfig: AppConfig = {
  defaultBackend: "claude-code",
  theme: "light",
  port: null,
  autoOpenBrowser: true,
  playwright: {
    installed: false,
    installPath: null,
  },
  harness: {
    maxConcurrentSessions: 3,
    checkpointEveryTurns: 5,
    toolAutoAllow: true,
  },
  chat: {
    abortThresholdMs: 300_000,
    contextMode: "compact",
  },
  logs: {
    level: "info",
  },
  user: {
    id: "local",
    displayName: "You",
  },
  figmaPersonalAccessToken: null,
  appVersion: APP_VERSION,
};

function mergeConfig(input: unknown): AppConfig {
  const source = record(input);
  const playwright = record(source.playwright);
  const harness = record(source.harness);
  const chat = record(source.chat);
  const logs = record(source.logs);
  const user = record(source.user);
  return {
    defaultBackend: source.defaultBackend === "codex" ? "codex" : "claude-code",
    theme: source.theme === "dark" || source.theme === "auto" ? source.theme : "light",
    port: typeof source.port === "number" && Number.isInteger(source.port) && source.port >= 1024 && source.port <= 65535 ? source.port : null,
    autoOpenBrowser: typeof source.autoOpenBrowser === "boolean" ? source.autoOpenBrowser : defaultConfig.autoOpenBrowser,
    playwright: {
      installed: playwright.installed === true,
      installPath: typeof playwright.installPath === "string" ? playwright.installPath : null,
    },
    harness: {
      maxConcurrentSessions: boundedInteger(harness.maxConcurrentSessions, 1, 100, defaultConfig.harness.maxConcurrentSessions),
      checkpointEveryTurns: boundedInteger(harness.checkpointEveryTurns, 1, 1000, defaultConfig.harness.checkpointEveryTurns),
      toolAutoAllow: typeof harness.toolAutoAllow === "boolean" ? harness.toolAutoAllow : defaultConfig.harness.toolAutoAllow,
    },
    chat: {
      abortThresholdMs: boundedInteger(chat.abortThresholdMs, 0, 86_400_000, defaultConfig.chat.abortThresholdMs),
      contextMode: chat.contextMode === "full" ? "full" : "compact",
    },
    logs: {
      level: logs.level === "debug" || logs.level === "warn" || logs.level === "error" ? logs.level : "info",
    },
    user: {
      id: "local",
      displayName: typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : defaultConfig.user.displayName,
    },
    figmaPersonalAccessToken:
      typeof source.figmaPersonalAccessToken === "string" &&
      source.figmaPersonalAccessToken.trim().length > 0
        ? source.figmaPersonalAccessToken
        : null,
    appVersion: APP_VERSION,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configFilePath, "utf8");
    return mergeConfig(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return structuredClone(defaultConfig);
    // Never overwrite an unreadable/corrupt existing file with defaults.
    throw new Error("config_read_failed");
  }
}

async function writeConfigAtomically(config: AppConfig): Promise<void> {
  await mkdir(appRootDir, { recursive: true });
  const temporary = `${configFilePath}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(mergeConfig(config), null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, configFilePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

let configWrites: Promise<unknown> = Promise.resolve();
function serializeConfigWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = configWrites.then(operation, operation);
  configWrites = result.catch(() => undefined);
  return result;
}

export function saveConfig(config: AppConfig): Promise<void> {
  const snapshot = structuredClone(config);
  return serializeConfigWrite(() => writeConfigAtomically(snapshot));
}

/** Read and change the latest config within the same serialized operation. */
export function updateConfig(update: (current: AppConfig) => AppConfig): Promise<AppConfig> {
  return serializeConfigWrite(async () => {
    const next = mergeConfig(update(await loadConfig()));
    await writeConfigAtomically(next);
    return next;
  });
}

export async function ensureConfig(): Promise<AppConfig> {
  return serializeConfigWrite(async () => {
    try {
      await readFile(configFilePath, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new Error("config_read_failed");
      await writeConfigAtomically(defaultConfig);
    }
    return loadConfig();
  });
}
