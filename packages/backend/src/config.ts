import { BACKEND_IDS } from "@bg/shared";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import type { BackendId, ThemeMode } from "@bg/shared";
import { APP_VERSION, LLM_CONNECTIONS, parseGenerationOptions, type GenerationOptions, type LlmConnectionId } from "@bg/shared";
import { appRootDir, configFilePath, localConfigFilePath } from "./lib/paths";

export type AppLocale = "ko" | "en" | "zh-CN";

export interface AppConfig {
  generationDefaults: Partial<Record<BackendId, GenerationOptions>>;
  commandcodeApiKey: string | null;
  llmApiKeys: Record<LlmConnectionId, string | null>;
  defaultBackend: BackendId;
  theme: ThemeMode;
  locale: AppLocale | null;
  port: number | null;
  autoOpenBrowser: boolean;
  playwright: { installed: boolean; installPath: string | null };
  harness: { maxConcurrentSessions: number; checkpointEveryTurns: number; toolAutoAllow: boolean };
  chat: { abortThresholdMs: number; contextMode: "compact" | "full" };
  logs: { level: "debug" | "info" | "warn" | "error" };
  user: { id: "local"; displayName: string };
  /** OS-local Figma credential. The API exposes only figma_token_set. */
  figmaPersonalAccessToken: string | null;
  appVersion: string;
}

export const defaultConfig: AppConfig = {
  generationDefaults: {},
  commandcodeApiKey: null,
  llmApiKeys: { gemini: null, deepseek: null, xai: null },
  defaultBackend: "claude-code",
  theme: "light",
  locale: null,
  port: null,
  autoOpenBrowser: true,
  playwright: { installed: false, installPath: null },
  harness: { maxConcurrentSessions: 3, checkpointEveryTurns: 5, toolAutoAllow: true },
  chat: { abortThresholdMs: 300_000, contextMode: "compact" },
  logs: { level: "info" },
  user: { id: "local", displayName: "You" },
  figmaPersonalAccessToken: null,
  appVersion: APP_VERSION,
};

interface SharedConfigV1 {
  schemaVersion: 1;
  generationDefaults: AppConfig["generationDefaults"];
  defaultBackend: BackendId;
  theme: ThemeMode;
  locale: AppLocale | null;
  chat: AppConfig["chat"];
  user: { displayName: string };
}

interface LocalConfigV1 {
  schemaVersion: 1;
  platform: NodeJS.Platform;
  commandcodeApiKey: string | null;
  llmApiKeys: AppConfig["llmApiKeys"];
  port: number | null;
  autoOpenBrowser: boolean;
  playwright: AppConfig["playwright"];
  harness: AppConfig["harness"];
  logs: AppConfig["logs"];
  figmaPersonalAccessToken: string | null;
  pendingShared?: SharedConfigV1;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

function generationDefaults(source: Record<string, unknown>): AppConfig["generationDefaults"] {
  const result: AppConfig["generationDefaults"] = {};
  const stored = record(source.generationDefaults);
  for (const backend of BACKEND_IDS) {
    const value = stored[backend];
    if (value !== undefined) {
      try { result[backend] = parseGenerationOptions(value); } catch { /* Unsupported legacy values use defaults. */ }
    }
  }
  return result;
}

function parseLocale(value: unknown): AppLocale | null {
  return value === "ko" || value === "en" || value === "zh-CN" ? value : null;
}

function sharedFrom(input: unknown): SharedConfigV1 {
  const source = record(input);
  const chat = record(source.chat);
  const user = record(source.user);
  return {
    schemaVersion: 1,
    generationDefaults: generationDefaults(source),
    defaultBackend: BACKEND_IDS.find((id) => id === source.defaultBackend) ?? defaultConfig.defaultBackend,
    theme: source.theme === "dark" || source.theme === "auto" ? source.theme : "light",
    locale: parseLocale(source.locale),
    chat: {
      abortThresholdMs: boundedInteger(chat.abortThresholdMs, 0, 86_400_000, defaultConfig.chat.abortThresholdMs),
      contextMode: chat.contextMode === "full" ? "full" : "compact",
    },
    user: { displayName: typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : defaultConfig.user.displayName },
  };
}

function localFrom(input: unknown, platform: NodeJS.Platform): LocalConfigV1 {
  const source = record(input);
  const playwright = record(source.playwright);
  const harness = record(source.harness);
  const logs = record(source.logs);
  const storedKeys = record(source.llmApiKeys);
  const llmApiKeys = { ...defaultConfig.llmApiKeys };
  for (const { id } of LLM_CONNECTIONS) {
    const value = storedKeys[id];
    llmApiKeys[id] = typeof value === "string" ? value.trim() || null : null;
  }
  return {
    schemaVersion: 1,
    platform,
    commandcodeApiKey: typeof source.commandcodeApiKey === "string" && source.commandcodeApiKey.trim() ? source.commandcodeApiKey.trim() : null,
    llmApiKeys,
    port: typeof source.port === "number" && Number.isInteger(source.port) && source.port >= 1024 && source.port <= 65535 ? source.port : null,
    autoOpenBrowser: typeof source.autoOpenBrowser === "boolean" ? source.autoOpenBrowser : defaultConfig.autoOpenBrowser,
    playwright: { installed: playwright.installed === true, installPath: typeof playwright.installPath === "string" ? playwright.installPath : null },
    harness: {
      maxConcurrentSessions: boundedInteger(harness.maxConcurrentSessions, 1, 100, defaultConfig.harness.maxConcurrentSessions),
      checkpointEveryTurns: boundedInteger(harness.checkpointEveryTurns, 1, 1000, defaultConfig.harness.checkpointEveryTurns),
      toolAutoAllow: typeof harness.toolAutoAllow === "boolean" ? harness.toolAutoAllow : defaultConfig.harness.toolAutoAllow,
    },
    logs: { level: logs.level === "debug" || logs.level === "warn" || logs.level === "error" ? logs.level : "info" },
    figmaPersonalAccessToken: typeof source.figmaPersonalAccessToken === "string" && source.figmaPersonalAccessToken.trim() ? source.figmaPersonalAccessToken : null,
  };
}

function parseSharedV1(input: unknown): SharedConfigV1 {
  const source = record(input);
  if (source.schemaVersion !== 1) throw new Error("config_read_failed");
  return sharedFrom(source);
}

function parseLocalV1(input: unknown, platform: NodeJS.Platform): LocalConfigV1 {
  const source = record(input);
  if (source.schemaVersion !== 1 || source.platform !== platform) throw new Error("config_read_failed");
  const parsed = localFrom(source, platform);
  if (source.pendingShared !== undefined) parsed.pendingShared = parseSharedV1(source.pendingShared);
  return parsed;
}

function sharedPart(config: AppConfig): SharedConfigV1 { return sharedFrom(config); }
function localPart(config: AppConfig, platform: NodeJS.Platform): LocalConfigV1 { return localFrom(config, platform); }

function effective(shared: SharedConfigV1, local: LocalConfigV1): AppConfig {
  return {
    generationDefaults: shared.generationDefaults,
    defaultBackend: shared.defaultBackend,
    theme: shared.theme,
    locale: shared.locale,
    chat: shared.chat,
    user: { id: "local", displayName: shared.user.displayName },
    commandcodeApiKey: local.commandcodeApiKey,
    llmApiKeys: local.llmApiKeys,
    port: local.port,
    autoOpenBrowser: local.autoOpenBrowser,
    playwright: local.playwright,
    harness: local.harness,
    logs: local.logs,
    figmaPersonalAccessToken: local.figmaPersonalAccessToken,
    appVersion: APP_VERSION,
  };
}

async function readJson(filePath: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error("config_read_failed");
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(appRootDir, { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, filePath);
    if (process.platform !== "win32") {
      const directory = await open(appRootDir, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
}

async function publish(platform: NodeJS.Platform, shared: SharedConfigV1, local: LocalConfigV1): Promise<void> {
  const localPath = localConfigFilePath(platform);
  await writeJsonAtomically(localPath, { ...local, pendingShared: shared });
  await writeJsonAtomically(configFilePath, shared);
  await writeJsonAtomically(localPath, local);
}

async function loadConfigUnlocked(platform: NodeJS.Platform): Promise<AppConfig> {
  const [sharedRaw, localRaw] = await Promise.all([readJson(configFilePath), readJson(localConfigFilePath(platform))]);
  const local = localRaw === undefined ? localFrom(defaultConfig, platform) : parseLocalV1(localRaw, platform);

  if (sharedRaw === undefined) {
    if (local.pendingShared) {
      const pending = local.pendingShared;
      const clean = { ...local }; delete clean.pendingShared;
      await writeJsonAtomically(configFilePath, pending);
      await writeJsonAtomically(localConfigFilePath(platform), clean);
      return effective(pending, clean);
    }
    return effective(sharedFrom(defaultConfig), local);
  }

  const sharedRecord = record(sharedRaw);
  if (sharedRecord.schemaVersion === undefined) {
    const migratedShared = local.pendingShared ?? sharedFrom(sharedRaw);
    const migratedLocal = localRaw === undefined ? localFrom(sharedRaw, platform) : local;
    const clean = { ...migratedLocal }; delete clean.pendingShared;
    await publish(platform, migratedShared, clean);
    return effective(migratedShared, clean);
  }

  let shared = parseSharedV1(sharedRaw);
  if (local.pendingShared) {
    shared = local.pendingShared;
    const clean = { ...local }; delete clean.pendingShared;
    await writeJsonAtomically(configFilePath, shared);
    await writeJsonAtomically(localConfigFilePath(platform), clean);
    return effective(shared, clean);
  }
  return effective(shared, local);
}

let configWrites: Promise<unknown> = Promise.resolve();
function serializeConfigWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = configWrites.then(operation, operation);
  configWrites = result.catch(() => undefined);
  return result;
}

/** Platform injection is a test seam; production callers always use process.platform. */
export function loadConfigForPlatform(platform: NodeJS.Platform): Promise<AppConfig> {
  return serializeConfigWrite(() => loadConfigUnlocked(platform));
}

export function loadConfig(): Promise<AppConfig> { return loadConfigForPlatform(process.platform); }

export function saveConfigForPlatform(config: AppConfig, platform: NodeJS.Platform): Promise<void> {
  const snapshot = structuredClone(config);
  return serializeConfigWrite(() => publish(platform, sharedPart(snapshot), localPart(snapshot, platform)));
}

export function saveConfig(config: AppConfig): Promise<void> { return saveConfigForPlatform(config, process.platform); }

export function updateConfig(update: (current: AppConfig) => AppConfig): Promise<AppConfig> {
  return serializeConfigWrite(async () => {
    const current = await loadConfigUnlocked(process.platform);
    const updated = update(current);
    const next = effective(sharedPart(updated), localPart(updated, process.platform));
    await publish(process.platform, sharedPart(next), localPart(next, process.platform));
    return next;
  });
}

export function ensureConfig(): Promise<AppConfig> {
  return serializeConfigWrite(async () => {
    const sharedBefore = await readJson(configFilePath);
    const localBefore = await readJson(localConfigFilePath(process.platform));
    const config = await loadConfigUnlocked(process.platform);
    if (sharedBefore === undefined && localBefore === undefined) await publish(process.platform, sharedPart(config), localPart(config, process.platform));
    else if (sharedBefore === undefined) await writeJsonAtomically(configFilePath, sharedPart(config));
    else if (localBefore === undefined) await writeJsonAtomically(localConfigFilePath(process.platform), localPart(config, process.platform));
    return config;
  });
}
