import type { CreateProjectRequest } from "@bg/shared";
import { UpgradeContractError } from "@bg/shared";
import { parseProjectOptions } from "../services/project-options";

type ProjectInputErrorCode =
  | "invalid_body"
  | "invalid_name"
  | "invalid_type"
  | "invalid_design_system"
  | "invalid_backend"
  | "invalid_project_options";

export class ProjectInputError extends Error {
  readonly name = "ProjectInputError";

  constructor(
    readonly code: ProjectInputErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type ParsedProjectInput = {
  readonly name: string;
  readonly type: CreateProjectRequest["type"];
  readonly designSystemId: string | null;
  readonly backendId: CreateProjectRequest["backend_id"];
  readonly optionsJson: string | null;
  readonly entrypoint: "deck.html" | "index.html";
};

export function parseProjectInput(input: unknown): ParsedProjectInput {
  if (!isRecord(input)) {
    throw new ProjectInputError(
      "invalid_body",
      "Expected a JSON object request body",
    );
  }
  const { name, type, design_system_id: designSystemId, backend_id: backendId } =
    input;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ProjectInputError(
      "invalid_name",
      "Project name is required",
      { name },
    );
  }
  if (!isProjectType(type)) {
    throw new ProjectInputError(
      "invalid_type",
      "Unsupported project type",
      { type },
    );
  }
  if (!(designSystemId === null || typeof designSystemId === "string")) {
    throw new ProjectInputError(
      "invalid_design_system",
      "design_system_id must be string or null",
    );
  }
  if (!isBackendId(backendId)) {
    throw new ProjectInputError(
      "invalid_backend",
      "Unsupported backend id",
      { backend_id: backendId },
    );
  }
  let optionsJson: string | null = null;
  let graphicCanvasPresent = false;
  let graphicSetPresent = false;
  if (input["options"] !== undefined) {
    try {
      const options = parseProjectOptions(input["options"]);
      graphicCanvasPresent = options.graphic_canvas !== null;
      graphicSetPresent = isRecord(input["options"]) && "graphic_set" in input["options"];
      optionsJson = JSON.stringify(options);
    } catch (error) {
      if (error instanceof UpgradeContractError) {
        throw new ProjectInputError(
          "invalid_project_options",
          error.message,
          { code: error.code, path: error.path },
        );
      }
      throw error;
    }
  }
  if ((type === "graphic") !== graphicCanvasPresent || (type !== "graphic" && graphicSetPresent)) {
    throw new ProjectInputError(
      "invalid_project_options",
      type === "graphic"
        ? "graphic projects require options.graphic_canvas"
        : "graphic_canvas is only valid for graphic projects",
      { path: "options.graphic_canvas" },
    );
  }
  return {
    name: name.trim(),
    type,
    designSystemId,
    backendId,
    optionsJson,
    entrypoint: type === "slide_deck" ? "deck.html" : "index.html",
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectType(
  value: unknown,
): value is CreateProjectRequest["type"] {
  return (
    value === "prototype" ||
    value === "slide_deck" ||
    value === "graphic" ||
    value === "from_template" ||
    value === "other"
  );
}

function isBackendId(
  value: unknown,
): value is CreateProjectRequest["backend_id"] {
  return value === "claude-code" || value === "codex";
}
