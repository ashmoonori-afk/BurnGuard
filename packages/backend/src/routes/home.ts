import { Hono } from "hono";
import type {
  ApiErrorBody,
  ApiMeta,
  ApiSuccess,
  BackendDetectionResult,
  DesignSystemStatus,
  LlmApiKeysPatch,
  LlmConnectionId,
  SettingsSummary,
} from "@bg/shared";
import { APP_VERSION, LLM_CONNECTIONS, parseGenerationOptions } from "@bg/shared";
import { loadConfig, updateConfig, type AppConfig } from "../config";
import {
  createProjectRecord,
  listHomeDesignSystems,
  listHomeProjects,
} from "../db/seed";
import { getPromptSampleBySlug, promptSampleDesignSystemId, seedTutorialsOnce } from "../db/seed-tutorials";
import { CodexAuthenticationProbeError, detectBackends } from "../services/backends";
import { ensureProjectWatcher } from "../services/watchers";
import {
  parseProjectInput,
  ProjectInputError,
} from "./home-project-input";
import { serveProjectThumbnail } from "./project-thumbnail-handler";
import { importProject, ProjectImportError } from "../services/project-import";

const VALID_PROJECT_TABS = new Set(["recent", "mine", "examples"]);
const VALID_SYSTEM_STATUSES = new Set<DesignSystemStatus>([
  "draft",
  "review",
  "published",
]);

function ok<T>(data: T, meta?: ApiMeta): ApiSuccess<T> {
  return meta ? { data, meta } : { data };
}

function fail(
  code: string,
  message: string,
  details?: unknown,
): ApiErrorBody {
  return { error: { code, message, details } };
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBackendId(
  value: unknown,
): value is SettingsSummary["default_backend"] {
  return value === "claude-code" || value === "codex";
}

function isApiKeyValue(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 4096 && !/[\r\n]/.test(value));
}

function isTheme(value: unknown): value is SettingsSummary["theme"] {
  return value === "light" || value === "dark" || value === "auto";
}

function isChatContextMode(
  value: unknown,
): value is SettingsSummary["chat_context_mode"] {
  return value === "compact" || value === "full";
}

function toSettingsSummary(config: Awaited<ReturnType<typeof loadConfig>>): SettingsSummary {
  return {
    generation_defaults: config.generationDefaults,
    commandcode_api_key_set: Boolean(config.commandcodeApiKey),
    llm_connections: LLM_CONNECTIONS.map((connection) => ({
      ...connection,
      api_key_set: Boolean(config.llmApiKeys[connection.id]),
    })),
    user: {
      id: config.user.id,
      display_name: config.user.displayName,
    },
    app_version: APP_VERSION,
    default_backend: config.defaultBackend,
    theme: config.theme,
    chat_abort_threshold_ms: config.chat.abortThresholdMs,
    chat_context_mode: config.chat.contextMode,
    // Surface only whether a Figma PAT is configured; never the value.
    figma_token_set:
      typeof config.figmaPersonalAccessToken === "string" &&
      config.figmaPersonalAccessToken.trim().length > 0,
  };
}

export const homeRoutes = new Hono();

homeRoutes.post("/api/projects/import", async (c) => {
  try {
    const form = await c.req.formData().catch(() => null);
    if (!form) throw new ProjectImportError("invalid_project_import");
    const imported = await importProject(form);
    await ensureProjectWatcher(imported.id);
    return c.json(ok(imported), 201);
  } catch (error) {
    if (error instanceof ProjectImportError) return c.json(fail(error.code, "프로젝트 파일을 가져오지 못했어요."), error.code === "project_import_limit" ? 413 : 400);
    throw error;
  }
});

homeRoutes.get("/api/projects", async (c) => {
  const tab = c.req.query("tab") ?? "recent";
  if (!VALID_PROJECT_TABS.has(tab)) {
    return c.json(
      fail("invalid_tab", "Unsupported project tab", { tab }),
      400,
    );
  }

  const limit = parseNumber(c.req.query("limit"), 50);
  const offset = parseNumber(c.req.query("offset"), 0);
  const result = await listHomeProjects(tab, limit, offset);
  return c.json(ok(result.items, { total: result.total, limit, offset }));
});

homeRoutes.get("/api/projects/:id/thumbnail", serveProjectThumbnail);

homeRoutes.get("/api/design-systems", async (c) => {
  const status = (c.req.query("status") ?? "published") as DesignSystemStatus;
  if (!VALID_SYSTEM_STATUSES.has(status)) {
    return c.json(
      fail("invalid_status", "Unsupported design system status", { status }),
      400,
    );
  }

  const systems = await listHomeDesignSystems(status);
  return c.json(ok(systems, { total: systems.length }));
});

homeRoutes.post("/api/projects", async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  let input: ReturnType<typeof parseProjectInput>;
  try {
    input = parseProjectInput(body);
  } catch (error) {
    if (error instanceof ProjectInputError) {
      return c.json(fail(error.code, error.message, error.details), 400);
    }
    throw error;
  }

  if (input.type === "graphic") {
    let detection: BackendDetectionResult;
    try { detection = await detectBackends({ force: true }); }
    catch (error) {
      if (!(error instanceof CodexAuthenticationProbeError)) throw error;
      c.header("Cache-Control", "no-store");
      return c.json(fail(error.code, error.message, error.diagnostics), 503);
    }
    if (input.backendId !== "codex" || !detection.backends.some((backend) => backend.id === "codex" && backend.found && backend.authenticated === true)) return c.json(fail("graphic_requires_authenticated_codex", "그래픽 생성에는 로그인된 Codex 연결이 필요해요."), 409);
  }

  const response = await createProjectRecord({
    name: input.name,
    type: input.type,
    designSystemId: input.designSystemId,
    backendId: input.backendId,
    optionsJson: input.optionsJson,
    entrypoint: input.entrypoint,
    thumbnailPath: null,
  });
  await ensureProjectWatcher(response.id);

  return c.json(ok(response), 201);
});

homeRoutes.get("/api/backends/detect", async (c) => {
  try {
    const detection = await detectBackends();
    c.header("Cache-Control", "private, max-age=30");
    return c.json(ok(detection));
  } catch (error) {
    if (!(error instanceof CodexAuthenticationProbeError)) throw error;
    c.header("Cache-Control", "no-store");
    return c.json(fail(error.code, error.message, error.diagnostics), 503);
  }
});

// Re-runs the tutorial / prompt-sample seed. Idempotent — only the
// missing tagged projects are recreated, so callers can hit this any
// time after deleting samples to bring them back. P4.7(d).
homeRoutes.post("/api/home/restore-samples", async (c) => {
  await seedTutorialsOnce();
  return c.json(ok({ restored: true }));
});

// One-click "Try this prompt" entrypoint for prompt-sample artifacts.
// The form button on each rendered sample posts here with target=_top;
// the route creates a fresh prototype project and 302-redirects to it
// with the prompt encoded in the query string so the project view can
// pre-fill the chat composer. P4.7(e).
homeRoutes.post("/api/home/use-sample/:slug", async (c) => {
  const slug = c.req.param("slug");
  const sample = getPromptSampleBySlug(slug);
  if (!sample) {
    return c.json(fail("unknown_sample", `unknown prompt sample: ${slug}`), 404);
  }

  const baseName = sample.name.replace(/^\[burnguard:prompt-sample\]\s*/, "");
  const created = await createProjectRecord({
    name: `Try: ${baseName}`,
    type: "prototype",
    designSystemId: promptSampleDesignSystemId(sample.slug),
    backendId: "claude-code",
    optionsJson: null,
    entrypoint: "index.html",
    thumbnailPath: null,
  });
  await ensureProjectWatcher(created.id);

  // base64url so it survives in a URL; the project view decodes and
  // pre-fills the composer text on first mount.
  const encoded = Buffer.from(sample.prompt, "utf8").toString("base64url");
  return c.redirect(`/projects/${created.id}?prefill_prompt=${encoded}`);
});

homeRoutes.get("/api/settings", async (c) => {
  const config = await loadConfig();
  return c.json(ok(toSettingsSummary(config)));
});

homeRoutes.patch("/api/settings", async (c) => {
  const patch = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(patch)) {
    return c.json(fail("invalid_body", "Expected a JSON object request body"), 400);
  }

  const changes: Pick<Partial<AppConfig>, "theme" | "defaultBackend" | "figmaPersonalAccessToken" | "commandcodeApiKey" | "generationDefaults"> & {
    llmApiKeys?: LlmApiKeysPatch;
    chat?: Partial<AppConfig["chat"]>;
    user?: Partial<AppConfig["user"]>;
  } = {};
  if ("generation_defaults" in patch) {
    if (!isRecord(patch.generation_defaults) || Object.keys(patch.generation_defaults).some((key) => !isBackendId(key))) return c.json(fail("invalid_generation_options", "Generation defaults are invalid"), 400);
    changes.generationDefaults = {};
    try {
      for (const backend of ["codex", "claude-code"] as const) {
        const value = patch.generation_defaults[backend];
        if (value !== undefined) changes.generationDefaults[backend] = parseGenerationOptions(value);
      }
    } catch { return c.json(fail("invalid_generation_options", "Generation defaults are invalid"), 400); }
  }
  if ("commandcode_api_key" in patch) {
    const value = patch.commandcode_api_key;
    if (!isApiKeyValue(value)) return c.json(fail("invalid_commandcode_key", "API key is invalid"), 400);
    changes.commandcodeApiKey = typeof value === "string" ? value.trim() || null : null;
  }
  if ("llm_api_keys" in patch) {
    if (!isRecord(patch.llm_api_keys)) return c.json(fail("invalid_llm_api_keys", "LLM API keys are invalid"), 400);
    changes.llmApiKeys = {};
    for (const [id, value] of Object.entries(patch.llm_api_keys)) {
      if (!LLM_CONNECTIONS.some((connection) => connection.id === id) || !isApiKeyValue(value)) return c.json(fail("invalid_llm_api_keys", "LLM API keys are invalid"), 400);
      changes.llmApiKeys[id as LlmConnectionId] = typeof value === "string" ? value.trim() || null : null;
    }
  }
  if ("theme" in patch) {
    if (!isTheme(patch.theme)) {
      return c.json(fail("invalid_theme", "Unsupported theme value"), 400);
    }
    changes.theme = patch.theme;
  }
  if ("default_backend" in patch) {
    if (!isBackendId(patch.default_backend)) {
      return c.json(
        fail("invalid_backend", "Unsupported default backend"),
        400,
      );
    }
    changes.defaultBackend = patch.default_backend;
  }
  if ("chat_abort_threshold_ms" in patch) {
    const raw = patch.chat_abort_threshold_ms;
    if (
      typeof raw !== "number" ||
      !Number.isFinite(raw) ||
      raw < 0 ||
      raw > 86_400_000
    ) {
      return c.json(
        fail(
          "invalid_chat_abort_threshold",
          "chat_abort_threshold_ms must be a finite number between 0 and 86_400_000 (24h)",
        ),
        400,
      );
    }
    changes.chat = { ...changes.chat, abortThresholdMs: Math.round(raw) };
  }
  if ("chat_context_mode" in patch) {
    if (!isChatContextMode(patch.chat_context_mode)) {
      return c.json(
        fail(
          "invalid_chat_context_mode",
          "chat_context_mode must be compact or full",
        ),
        400,
      );
    }
    changes.chat = { ...changes.chat, contextMode: patch.chat_context_mode };
  }
  if ("user" in patch) {
    if (!isRecord(patch.user)) {
      return c.json(fail("invalid_user", "user patch must be an object"), 400);
    }
    if (
      "display_name" in patch.user &&
      typeof patch.user.display_name === "string" &&
      patch.user.display_name.trim()
    ) {
      changes.user = { displayName: patch.user.display_name.trim() };
    }
  }
  if ("figma_personal_access_token" in patch) {
    const raw = patch.figma_personal_access_token;
    if (raw === null) {
      changes.figmaPersonalAccessToken = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      // Empty string also clears, so the UI can use "" as a clear path.
      changes.figmaPersonalAccessToken = trimmed.length > 0 ? trimmed : null;
    } else {
      return c.json(
        fail(
          "invalid_figma_token",
          "figma_personal_access_token must be a string or null",
        ),
        400,
      );
    }
  }

  const config = await updateConfig((current) => ({
    ...current,
    ...changes,
    generationDefaults: { ...current.generationDefaults, ...changes.generationDefaults },
    llmApiKeys: { ...current.llmApiKeys, ...changes.llmApiKeys },
    chat: { ...current.chat, ...changes.chat },
    user: { ...current.user, ...changes.user },
  }));
  return c.json(ok(toSettingsSummary(config)));
});
