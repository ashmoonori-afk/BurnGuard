import type { ProjectType } from "./app";

export const HANDOFF_CONTINUATION = {
  prompt_file: "handoff/prompt.md",
  commands: {
    claude_code:
      'claude --add-dir ./source "Read ./handoff/prompt.md and continue the production handoff."',
    codex:
      'codex --cd ./source "Read ../handoff/prompt.md and continue the production handoff."',
  },
} as const;

export type HandoffContinuation = {
  readonly prompt_file: string;
  readonly commands: {
    readonly claude_code: string;
    readonly codex: string;
  };
};

export type HandoffNode = {
  readonly bg_id: string;
  readonly tag: string;
  readonly parent_bg_id: string | null;
  readonly text: string;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  readonly styles: Readonly<Partial<Record<string, string>>>;
};

export type HandoffPage = {
  readonly slide_index: number | null;
  readonly title: string;
  readonly rect: {
    readonly w: number;
    readonly h: number;
  };
  readonly nodes: readonly HandoffNode[];
};

export type HandoffSpec = {
  readonly spec_version: 1;
  readonly generated_at: number;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly type: ProjectType;
    readonly entrypoint: string;
  };
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly design_system: {
    readonly name: string | null;
    readonly tokens_file: string | null;
  };
  readonly pages: readonly HandoffPage[];
};

export type HandoffRegion = {
  readonly node_id: string;
  readonly tag: string;
  readonly component: string | null;
  readonly route: string | null;
  readonly token_refs: readonly string[];
};

export type HandoffManifest = {
  readonly schema_version: 1;
  readonly project: HandoffSpec["project"];
  readonly design_system: {
    readonly name: string | null;
    readonly revision: number | null;
    readonly digest: string | null;
    readonly tokens_file: string | null;
    readonly rules_file: string | null;
  };
  readonly pages: readonly {
    readonly id: string;
    readonly kind: "page" | "slide" | "artboard";
    readonly title: string;
    readonly source_path: string;
    readonly regions: readonly HandoffRegion[];
  }[];
  readonly routes: readonly {
    readonly path: string;
    readonly source_file: string;
    readonly kind: "page" | "linked";
  }[];
  readonly components: readonly {
    readonly name: string;
    readonly kind: "explicit" | "semantic";
    readonly source_file: string;
    readonly node_ids: readonly string[];
  }[];
  readonly interactions: readonly {
    readonly id: string;
    readonly kind: "link" | "button" | "form";
    readonly label: string | null;
    readonly source_file: string;
    readonly node_id: string | null;
    readonly target: string | null;
    readonly status: "implemented" | "mocked";
  }[];
  readonly assets: readonly {
    readonly path: string;
    readonly kind: "image" | "font" | "stylesheet" | "script" | "other";
  }[];
  readonly responsive_rules: readonly {
    readonly source_file: string;
    readonly condition: string;
  }[];
  readonly acceptance_checks: readonly {
    readonly id: string;
    readonly status: "required" | "unverified";
    readonly related_paths: readonly string[];
  }[];
  readonly unresolved_backend_work: readonly {
    readonly id: string;
    readonly interaction_id: string;
    readonly source_file: string;
    readonly node_id: string | null;
    readonly reason: "button_without_handler" | "form_without_backend";
  }[];
  readonly continuation: HandoffContinuation;
};
