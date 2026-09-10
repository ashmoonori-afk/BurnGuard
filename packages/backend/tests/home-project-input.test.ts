import { describe, expect, test } from "bun:test";
import { homeRoutes } from "../src/routes/home";
import { parseProjectInput, ProjectInputError } from "../src/routes/home-project-input";

type ErrorEnvelope = {
  readonly error: {
    readonly code: string;
    readonly details?: unknown;
  };
};

function errorEnvelope(value: unknown): ErrorEnvelope {
  if (
    typeof value !== "object" ||
    value === null ||
    !("error" in value) ||
    typeof value.error !== "object" ||
    value.error === null ||
    !("code" in value.error) ||
    typeof value.error.code !== "string"
  ) {
    throw new Error("Expected an error envelope");
  }
  return { error: { code: value.error.code } };
}

async function createProject(body: unknown): Promise<Response> {
  return homeRoutes.request("http://local/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("home project input boundary", () => {
  test("Given a graphic canvas When parsed Then graphic creation uses index.html", () => {
    expect(parseProjectInput({
      name: "SNS 카드",
      type: "graphic",
      design_system_id: null,
      backend_id: "claude-code",
      options: { graphic_canvas: { schema_version: 1, width: 1200, height: 628 } },
    })).toMatchObject({
      type: "graphic",
      entrypoint: "index.html",
      optionsJson: JSON.stringify({
        use_speaker_notes: false,
        copy_as_is: false,
        design_brief: null,
        graphic_canvas: { schema_version: 1, width: 1200, height: 628 },
        graphic_set: { schema_version: 1, kind: "single", frame_count: 1 },
      }),
    });
  });

  test("Given a graphic-set creation request When parsed Then the set is persisted with the canvas", () => {
    // Given / When
    const parsed = parseProjectInput({
      name: "카드 뉴스",
      type: "graphic",
      design_system_id: null,
      backend_id: "codex",
      options: {
        graphic_canvas: { schema_version: 1, width: 1080, height: 1080 },
        graphic_set: { schema_version: 1, kind: "card_news", frame_count: 6 },
      },
    });

    // Then
    expect(JSON.parse(parsed.optionsJson ?? "null")).toMatchObject({
      graphic_set: { schema_version: 1, kind: "card_news", frame_count: 6 },
    });
  });

  test.each([
    {
      name: "Graphic without canvas",
      type: "graphic",
      design_system_id: null,
      backend_id: "claude-code",
    },
    {
      name: "Prototype with stale canvas",
      type: "prototype",
      design_system_id: null,
      backend_id: "claude-code",
      options: { graphic_canvas: { schema_version: 1, width: 1080, height: 1080 } },
    },
    {
      name: "Prototype with stale graphic set",
      type: "prototype",
      design_system_id: null,
      backend_id: "claude-code",
      options: { graphic_set: { schema_version: 1, kind: "single", frame_count: 1 } },
    },
  ])("Given canvas/type mismatch When parsed Then project options reject it", (input) => {
    try {
      parseProjectInput(input);
      throw new TypeError("expected project options rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectInputError);
      if (!(error instanceof ProjectInputError)) throw error;
      expect(error.code).toBe("invalid_project_options");
    }
  });

  test.each([
    [{}, "invalid_name"],
    [
      {
        name: "Project",
        type: "prototype",
        design_system_id: 7,
        backend_id: "claude-code",
      },
      "invalid_design_system",
    ],
    [
      {
        name: "Project",
        type: "prototype",
        design_system_id: null,
        backend_id: "unknown",
      },
      "invalid_backend",
    ],
    [
      {
        name: "Project",
        type: "prototype",
        design_system_id: null,
        backend_id: "claude-code",
        options: { design_brief: { schema_version: 1 } },
      },
      "invalid_project_options",
    ],
  ])("Given malformed project input When posted Then the boundary returns its error code", async (body, code) => {
    const response = await createProject(body);
    const error = errorEnvelope(await response.json());
    expect(response.status).toBe(400);
    expect(error.error.code).toBe(code);
  });
});
