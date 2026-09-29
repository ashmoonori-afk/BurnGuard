import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION, WEB_ASSET_KINDS, WEB_ASSET_MCP_SERVER, WEB_ASSET_TOOL_NAMES } from "@bg/shared";
import { importWebAsset, MAX_WEB_ASSET_RESULTS, searchWebAssets, WebAssetError, type WebAssetDependencies } from "./web-assets";

/**
 * A minimal Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0) exposing the web asset
 * search and import tools to the Claude Code CLI. It runs as a worker mode of the backend executable, dispatched
 * before any application module loads, and can write only inside the stage directory it was started for.
 */

export const WEB_ASSETS_MCP_FLAG = "--bg-web-assets-mcp";
const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcId = string | number;
interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

const TOOLS = [
  {
    name: WEB_ASSET_TOOL_NAMES.search,
    description: "Search openly licensed photos and illustrations (Openverse) or open-source icons (Iconify). Returns candidates with id, title, creator, source_url, license and attribution_required. Use short English keywords.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 100, description: "Short English keywords describing the subject." },
        kind: { type: "string", enum: [...WEB_ASSET_KINDS] },
        limit: { type: "integer", minimum: 1, maximum: MAX_WEB_ASSET_RESULTS },
      },
      required: ["query", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: WEB_ASSET_TOOL_NAMES.import,
    description: "Download one search candidate into the project's assets/web/ folder and record its source URL and license in assets/web/credits.json. Returns the project-relative file path and the attribution line.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The id of a candidate returned by search_assets." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
] as const;

export interface WebAssetsMcpContext {
  readonly stageDir: string;
  readonly deps?: WebAssetDependencies;
}

const toolResult = (payload: unknown, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
  ...(isError ? { isError: true } : {}),
});

async function callTool(name: unknown, args: unknown, context: WebAssetsMcpContext) {
  try {
    if (name === WEB_ASSET_TOOL_NAMES.search) return toolResult({ ok: true, results: await searchWebAssets(args, context.deps) });
    if (name === WEB_ASSET_TOOL_NAMES.import) {
      const imported = await importWebAsset(context.stageDir, args, context.deps);
      return toolResult({ ok: true, file: imported.credit.file, attribution: imported.attribution, attribution_required: imported.credit.attribution_required, license: imported.credit.license });
    }
    return toolResult({ ok: false, error: "unknown_tool" }, true);
  } catch (error) {
    // Only stable codes leave this process; provider messages and local paths never reach the model.
    const code = error instanceof WebAssetError ? error.code : "provider_error";
    return toolResult({ ok: false, error: code }, true);
  }
}

/** Handles one decoded JSON-RPC message; returns null for notifications and anything without a usable id. */
export async function handleWebAssetsMcpMessage(message: unknown, context: WebAssetsMcpContext): Promise<JsonRpcResponse | null> {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
  const { id, method, params } = message as Record<string, unknown>;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize": {
      const requested = typeof (params as Record<string, unknown> | undefined)?.protocolVersion === "string" ? (params as Record<string, string>).protocolVersion : PROTOCOL_VERSION;
      return reply({ protocolVersion: requested, capabilities: { tools: {} }, serverInfo: { name: WEB_ASSET_MCP_SERVER, version: APP_VERSION } });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const call = typeof params === "object" && params !== null ? params as Record<string, unknown> : {};
      return reply(await callTool(call.name, call.arguments ?? {}, context));
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  }
}

/** The argv that starts this server as a worker of the running backend, compiled or from source. */
export function webAssetsMcpCommand(stageDir: string, compiled = /\$bunfs|~BUN/i.test(import.meta.url)): readonly string[] {
  const worker = [WEB_ASSETS_MCP_FLAG, "--dir", stageDir];
  return compiled ? [process.execPath, ...worker] : [process.execPath, fileURLToPath(new URL("../index.ts", import.meta.url)), ...worker];
}

export async function runWebAssetsMcpServer(argv: readonly string[] = process.argv): Promise<void> {
  const dirIndex = argv.indexOf("--dir");
  const stageDir = dirIndex === -1 ? undefined : argv[dirIndex + 1];
  if (stageDir === undefined || !path.isAbsolute(stageDir)) {
    process.exitCode = 2;
    return;
  }
  const context: WebAssetsMcpContext = { stageDir };
  const decoder = new TextDecoder();
  let buffer = "";
  const handleLine = async (line: string) => {
    if (line.trim() === "") return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    const response = await handleWebAssetsMcpMessage(message, context);
    if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
  };
  for await (const chunk of process.stdin) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await handleLine(line);
      newline = buffer.indexOf("\n");
    }
  }
  await handleLine(buffer);
}
