import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  effortBelowRecommendation,
  MODEL_CAPABILITY_PROFILES,
  resolveModelCapabilityProfile,
  WEB_ASSET_MCP_SERVER,
  WEB_ASSET_TOOL_NAMES,
  type BackendId,
  type GenerationOptions,
} from "@bg/shared";
import { buildPrompt } from "../src/harness/prompt-builder";
import { CSS_LOGO_RULES } from "../src/harness/prompt-model-profile";
import { CSS_LOGO_RULE_IDS } from "../src/services/css-logo-check";
import { buildClaudeCommand } from "../src/adapters/claude-code/runner";
import { webAssetsMcpCommand, WEB_ASSETS_MCP_FLAG } from "../src/services/web-assets-mcp";
import { defaultConfig, loadConfig, saveConfig } from "../src/config";
import { configFilePath, localConfigFilePath } from "../src/lib/app-paths";
import { homeRoutes } from "../src/routes/home";
import { getSqlite } from "../src/db/sqlite-client";
import { ensureLearningSchema } from "./learning-fixture";

type BuildContext = Parameters<typeof buildPrompt>[0];

const generation = (model: string, provider: GenerationOptions["provider"] = "native"): GenerationOptions => ({ model, effort: "medium", vanilla: false, provider });

function context(projectType = "prototype"): BuildContext {
  return {
    project: { project_id: "p-profile", project_name: "Profile", project_type: projectType, entrypoint: "index.html", project_dir: "/tmp/p-profile", options_json: null },
    files: [], attachments: [], designSystem: null, openComments: [],
  } as unknown as BuildContext;
}

function envelope(prompt: string): Record<string, unknown> | null {
  const match = prompt.match(/<burnguard-model-profile-v1>\n([^\n]+)\n<\/burnguard-model-profile-v1>/);
  return match ? JSON.parse(match[1]!) : null;
}

beforeAll(() => ensureLearningSchema(getSqlite()));

describe("model capability profile selection", () => {
  test("Given Claude Opus or Sonnet in any id shape When resolved Then the frontier profile allows CSS logos and web asset sourcing", () => {
    const cases: Array<readonly [BackendId, GenerationOptions]> = [
      ["claude-code", generation("opus")],
      ["claude-code", generation("sonnet")],
      ["claude-code", generation("claude-opus-5-5")],
      ["claude-code", generation("claude-sonnet-5-5")],
      ["claude-code", generation("opus[1m]")],
      ["claude-code", generation("")],
      ["claude-code", generation("claude-opus-4-6", "commandcode")],
    ];
    for (const [backend, options] of cases) {
      const profile = resolveModelCapabilityProfile(backend, options);
      expect(profile.id, options.model).toBe("claude-frontier");
      expect(profile.logo_authoring).toBe("css_svg");
      expect(profile.asset_strategy).toBe("web_search");
      expect(profile.recommended_min_effort).toBe("medium");
    }
  });

  test("Given GPT on Codex When resolved Then assets are generated and the logo behaviour is unchanged", () => {
    for (const model of ["gpt-5.6-luna", "gpt-5.5", ""]) {
      const profile = resolveModelCapabilityProfile("codex", generation(model));
      expect(profile.id).toBe("gpt-image");
      expect(profile.asset_strategy).toBe("generate");
      expect(profile.logo_authoring).toBe("supplied_or_text");
    }
  });

  test("Given smaller or other models When resolved Then they keep the standard profile", () => {
    const cases: Array<readonly [BackendId, string]> = [["claude-code", "haiku"], ["claude-code", "claude-haiku-4-5"], ["claude-code", "sonnetish-mini"], ["codex", "o4-mini"], ["gemini", "gemini-2.5-pro"], ["copilot", ""]];
    for (const [backend, model] of cases) expect(resolveModelCapabilityProfile(backend, generation(model)), `${backend}/${model}`).toEqual(MODEL_CAPABILITY_PROFILES.standard);
  });

  test("Given the frontier profile When the effort is below medium Then it is flagged, and never for profiles without a recommendation", () => {
    const frontier = MODEL_CAPABILITY_PROFILES["claude-frontier"];
    expect(effortBelowRecommendation(frontier, "low")).toBe(true);
    for (const effort of ["medium", "high", "xhigh", "max", "ultra"] as const) expect(effortBelowRecommendation(frontier, effort)).toBe(false);
    expect(effortBelowRecommendation(MODEL_CAPABILITY_PROFILES.standard, "low")).toBe(false);
  });
});

describe("prompt assembly per profile", () => {
  test("Given each profile When the prompt is built Then the envelope and only the enabled blocks are emitted", async () => {
    const request = { type: "user.message", text: "Landing page for a bakery" } as const;
    const frontier = await buildPrompt(context(), request, { backendId: "claude-code", generation: generation("opus"), webAssetTools: true });
    expect(envelope(frontier)).toEqual({ schema_version: 1, profile: "claude-frontier", logo_authoring: "css_svg", asset_strategy: "web_search", web_asset_tools: "available" });
    expect(frontier).toContain("CSS_LOGO_AUTHORING");
    for (const id of CSS_LOGO_RULE_IDS) expect(frontier).toContain(`${id}:`);
    expect(frontier).toContain("data-bg-css-logo");
    expect(frontier).toContain("WEB_ASSET_SOURCING:");
    expect(frontier).toContain(`mcp__${WEB_ASSET_MCP_SERVER}__${WEB_ASSET_TOOL_NAMES.search}`);
    expect(frontier).not.toContain("ASSET_GENERATION:");

    const off = await buildPrompt(context(), request, { backendId: "claude-code", generation: generation("sonnet"), webAssetTools: false });
    expect(envelope(off)?.web_asset_tools).toBe("unavailable");
    expect(off).toContain("WEB_ASSET_SOURCING_OFF");
    expect(off).not.toContain("WEB_ASSET_SOURCING:");

    const gpt = await buildPrompt(context(), request, { backendId: "codex", generation: generation("gpt-5.6-luna"), webAssetTools: true });
    expect(envelope(gpt)).toEqual({ schema_version: 1, profile: "gpt-image", logo_authoring: "supplied_or_text", asset_strategy: "generate", web_asset_tools: "not_applicable" });
    expect(gpt).toContain("ASSET_GENERATION:");
    for (const tag of ["CSS_LOGO_AUTHORING", "WEB_ASSET_SOURCING", "data-bg-css-logo"]) expect(gpt).not.toContain(tag);

    const standard = await buildPrompt(context(), request, { backendId: "gemini", generation: generation("gemini-2.5-pro") });
    expect(envelope(standard)?.profile).toBe("standard");
    for (const tag of ["CSS_LOGO_AUTHORING", "WEB_ASSET_SOURCING", "ASSET_GENERATION"]) expect(standard).not.toContain(tag);

    const none = await buildPrompt(context(), request, {});
    expect(envelope(none)).toBeNull();
  });

  test("Given a logo project on the frontier profile When built Then the CSS logo block never overrides the logo contract", async () => {
    const prompt = await buildPrompt(context("logo"), { type: "user.message", text: "logo" }, { backendId: "claude-code", generation: generation("opus"), webAssetTools: true });
    expect(envelope(prompt)?.logo_authoring).toBe("supplied_or_text");
    expect(prompt).not.toContain("CSS_LOGO_AUTHORING");
  });

  test("Given the profile block When placed Then it follows the visual craft and precedes the delivery rules", async () => {
    const prompt = await buildPrompt(context(), { type: "user.message", text: "x" }, { backendId: "claude-code", generation: generation("opus"), webAssetTools: true });
    expect(prompt.indexOf("## Visual craft")).toBeLessThan(prompt.indexOf("<burnguard-model-profile-v1>"));
    expect(prompt.indexOf("<burnguard-model-profile-v1>")).toBeLessThan(prompt.indexOf("## Delivery"));
    expect(CSS_LOGO_RULES.map((rule) => rule.split(":")[0])).toEqual([...CSS_LOGO_RULE_IDS]);
  });
});

describe("web asset tool registration", () => {
  test("Given a web asset tool When the Claude command is built Then the MCP server is registered and only its tools are pre-approved", () => {
    const command = buildClaudeCommand({ binaryPath: "claude", generation: generation("opus"), webAssetTool: { command: ["/bin/bg", WEB_ASSETS_MCP_FLAG, "--dir", "/stage dir"] } });
    const config = JSON.parse(command[command.indexOf("--mcp-config") + 1]!);
    expect(config).toEqual({ mcpServers: { [WEB_ASSET_MCP_SERVER]: { type: "stdio", command: "/bin/bg", args: [WEB_ASSETS_MCP_FLAG, "--dir", "/stage dir"] } } });
    expect(command[command.indexOf("--allowedTools") + 1]).toBe(Object.values(WEB_ASSET_TOOL_NAMES).map((name) => `mcp__${WEB_ASSET_MCP_SERVER}__${name}`).join(","));
    // Variadic flags must be followed by another flag, never end the argv.
    expect(command[command.indexOf("--allowedTools") + 2]?.startsWith("--")).toBe(true);
    expect(buildClaudeCommand({ binaryPath: "claude", generation: generation("opus") })).not.toContain("--mcp-config");
  });

  test("Given compiled and source runs When the worker command is built Then both dispatch the MCP worker flag for the stage", () => {
    expect(webAssetsMcpCommand("/stage", true)).toEqual([process.execPath, WEB_ASSETS_MCP_FLAG, "--dir", "/stage"]);
    const source = webAssetsMcpCommand("/stage", false);
    expect(source[1]!.endsWith("index.ts")).toBe(true);
    expect(source.slice(2)).toEqual([WEB_ASSETS_MCP_FLAG, "--dir", "/stage"]);
  });
});

describe("web asset search setting", () => {
  const platforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];
  const reset = async () => {
    await rm(configFilePath, { force: true });
    await Promise.all(platforms.map((platform) => rm(localConfigFilePath(platform), { force: true })));
    await saveConfig(structuredClone(defaultConfig));
  };
  beforeEach(reset);
  afterAll(reset);

  test("Given the settings API When web asset search is toggled Then it persists and rejects non-boolean values", async () => {
    const patch = (body: unknown) => homeRoutes.request("http://local/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await (await homeRoutes.request("http://local/api/settings")).json()).data.web_asset_search).toBe(true);
    const off = await patch({ web_asset_search: false });
    expect(off.status).toBe(200);
    expect((await off.json()).data.web_asset_search).toBe(false);
    expect((await loadConfig()).webAssets.searchEnabled).toBe(false);
    const invalid = await patch({ web_asset_search: "no" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_web_asset_search");
  });
});
