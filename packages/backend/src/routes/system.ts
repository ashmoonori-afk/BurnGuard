import { Hono } from "hono";
import type {
  ApiErrorBody,
  ApiSuccess,
  CreateDesignSystemExtractionRequest,
  CreateDesignSystemExtractionResponse,
  CreateDesignSystemUploadResponse,
  DesignSystemDetail,
  DesignSystemFontUploadResponse,
  DesignSystemExtractionLineageRequest,
  DesignSystemTokensResponse,
  UpsertDesignSystemColorRequest,
} from "@bg/shared";
import { getDesignSystemDetail } from "../db/seed";
import { extractPinterestMood, parsePinterestMoodRequest } from "../services/pinterest-mood";
import {
  DesignSystemAssetEditError,
  DesignSystemExtractError,
  extractDesignSystemFromSource,
  extractDesignSystemFromUpload,
  readDesignSystemTokens,
  uploadDesignSystemFont,
  upsertDesignSystemColorToken,
} from "../services/design-system-extract";

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

function fail(
  code: string,
  message: string,
  details?: unknown,
): ApiErrorBody {
  return { error: { code, message, details } };
}

function parseExtractionLineage(input: unknown): DesignSystemExtractionLineageRequest | null | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "object" || input === null) return null;
  if (!("operation" in input) || (input.operation !== "override" && input.operation !== "re-extraction")) return null;
  if (!("parent_receipt_id" in input) || typeof input.parent_receipt_id !== "string") return null;
  if (!("parent_content_digest" in input) || typeof input.parent_content_digest !== "string") return null;
  if (!("reason" in input) || typeof input.reason !== "string") return null;
  if (!("metadata" in input) || typeof input.metadata !== "object" || input.metadata === null) return null;
  const entries = Object.entries(input.metadata);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) return null;
  return {
    operation: input.operation,
    parent_receipt_id: input.parent_receipt_id,
    parent_content_digest: input.parent_content_digest,
    reason: input.reason,
    metadata: Object.fromEntries(entries),
  };
}

export const systemRoutes = new Hono();

systemRoutes.post("/api/design-systems/pinterest", async (c) => {
  try {
    const request = parsePinterestMoodRequest(await c.req.json<unknown>().catch(() => null));
    return c.json(ok(await extractPinterestMood(request, c.req.raw.signal)), 201);
  } catch (error) {
    if (error instanceof DesignSystemExtractError) return c.json(fail(error.code, error.message), error.code === "publication_failed" ? 500 : error.code === "acquisition_timeout" ? 408 : 400);
    return c.json(fail("pinterest_unavailable", "Pinterest images could not be read. Try a website or uploaded reference."), 400);
  }
});

systemRoutes.post("/api/design-systems/extract", async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json(fail("invalid_body", "Expected a JSON object request body"), 400);
  }

  const allowedFields = new Set(["source_url", "source_type", "name", "system_id", "lineage"]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    return c.json(fail("invalid_body", "Extraction request contains unsupported fields"), 400);
  }

  const sourceUrl = "source_url" in body ? body.source_url : undefined;
  const sourceType = "source_type" in body ? body.source_type : undefined;
  const name = "name" in body ? body.name : undefined;
  const systemId = "system_id" in body ? body.system_id : undefined;
  const lineage = parseExtractionLineage("lineage" in body ? body.lineage : undefined);
  if (
    typeof sourceUrl !== "string" ||
    (sourceType !== undefined && sourceType !== "github" && sourceType !== "website" && sourceType !== "figma") ||
    (name !== undefined && typeof name !== "string") ||
    (systemId !== undefined && typeof systemId !== "string") ||
    lineage === null
  ) {
    return c.json(fail("invalid_body", "Extraction request fields have invalid types"), 400);
  }
  const extractionRequest: CreateDesignSystemExtractionRequest = {
    source_url: sourceUrl,
    ...(sourceType === undefined ? {} : { source_type: sourceType }),
    ...(name === undefined ? {} : { name }),
    ...(systemId === undefined ? {} : { system_id: systemId }),
    ...(lineage === undefined ? {} : { lineage }),
  };

  try {
    const result = await extractDesignSystemFromSource(extractionRequest, { signal: c.req.raw.signal });
    return c.json(ok(result satisfies CreateDesignSystemExtractionResponse), 201);
  } catch (err) {
    if (err instanceof DesignSystemExtractError) {
      return c.json(fail(err.code, err.message), err.code === "publication_failed" ? 500 : err.code === "acquisition_timeout" ? 408 : 400);
    }
    return c.json(
      fail(
        "design_system_extract_failed",
        err instanceof Error ? err.message : String(err),
      ),
      500,
    );
  }
});

systemRoutes.post("/api/design-systems/upload", async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.json(
      fail("invalid_body", "Expected a multipart/form-data request body"),
      400,
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json(
      fail("invalid_upload", "Expected a .pptx or .pdf file in the `file` field"),
      400,
    );
  }

  const name = form.get("name");
  const systemId = form.get("system_id");

  try {
    const result = await extractDesignSystemFromUpload({
      file,
      body: {
        name: typeof name === "string" ? name : undefined,
        system_id: typeof systemId === "string" ? systemId : undefined,
      },
      signal: c.req.raw.signal,
    });
    return c.json(ok(result satisfies CreateDesignSystemUploadResponse), 201);
  } catch (err) {
    if (err instanceof DesignSystemExtractError) {
      return c.json(fail(err.code, err.message), err.code === "publication_failed" ? 500 : err.code === "acquisition_timeout" ? 408 : 400);
    }
    return c.json(
      fail(
        "design_system_upload_failed",
        err instanceof Error ? err.message : String(err),
      ),
      500,
    );
  }
});

systemRoutes.get("/api/design-systems/:id", async (c) => {
  const id = c.req.param("id");
  const system = await getDesignSystemDetail(id);
  if (!system) {
    return c.json(
      fail("design_system_not_found", "Design system not found", { id }),
      404,
    );
  }
  return c.json(ok(system satisfies DesignSystemDetail));
});

systemRoutes.get("/api/design-systems/:id/tokens", async (c) => {
  const id = c.req.param("id");
  try {
    const tokens = await readDesignSystemTokens(id);
    return c.json(ok(tokens satisfies DesignSystemTokensResponse));
  } catch (err) {
    if (err instanceof DesignSystemAssetEditError) {
      return c.json(fail(err.code, err.message), err.code === "design_system_not_found" ? 404 : 400);
    }
    return c.json(
      fail(
        "design_system_tokens_failed",
        err instanceof Error ? err.message : String(err),
      ),
      500,
    );
  }
});

systemRoutes.patch("/api/design-systems/:id/colors", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json<unknown>().catch(() => null)) as
    | UpsertDesignSystemColorRequest
    | null;
  if (!body || typeof body !== "object") {
    return c.json(fail("invalid_body", "Expected a JSON object body"), 400);
  }

  try {
    const tokens = await upsertDesignSystemColorToken(id, body);
    return c.json(ok(tokens satisfies DesignSystemTokensResponse));
  } catch (err) {
    if (err instanceof DesignSystemAssetEditError) {
      return c.json(fail(err.code, err.message), err.code === "design_system_not_found" ? 404 : 400);
    }
    return c.json(
      fail(
        "design_system_color_update_failed",
        err instanceof Error ? err.message : String(err),
      ),
      500,
    );
  }
});

systemRoutes.post("/api/design-systems/:id/fonts", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.json(
      fail("invalid_body", "Expected a multipart/form-data request body"),
      400,
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json(
      fail("invalid_font_upload", "Expected a font file in the `file` field"),
      400,
    );
  }
  const family = form.get("family");
  const rawRole = form.get("role");
  const role =
    rawRole === "display" ||
    rawRole === "sans" ||
    rawRole === "serif" ||
    rawRole === "mono"
      ? rawRole
      : null;

  try {
    const uploaded = await uploadDesignSystemFont({
      systemId: id,
      file,
      family: typeof family === "string" ? family : undefined,
      role,
    });
    return c.json(ok(uploaded satisfies DesignSystemFontUploadResponse), 201);
  } catch (err) {
    if (err instanceof DesignSystemAssetEditError) {
      return c.json(fail(err.code, err.message), err.code === "design_system_not_found" ? 404 : 400);
    }
    return c.json(
      fail(
        "design_system_font_upload_failed",
        err instanceof Error ? err.message : String(err),
      ),
      500,
    );
  }
});
