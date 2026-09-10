import type { FileInfo } from "./harness";

export type SitePage = {
  readonly rel_path: string;
  readonly title: string;
  readonly is_home: boolean;
  readonly nav_order: number;
};

export interface ArtifactSummary {
  project_id: string;
  entrypoint: string;
  // Nullable: a freshly-created project with no HTML files yet has no renderable
  // entrypoint. The canvas should fall back to a placeholder rather than trying
  // to fetch a bare `/fs/` URL (which 404s with `relPath: ""`).
  entrypoint_url: string | null;
  design_system_id: string | null;
  design_system_url: string | null;
  file_count: number;
  current_revision: number;
  current_digest: string;
  updated_at: number;
  pages: readonly SitePage[];
  site_overflow: boolean;
}

export interface FileTreeResponse {
  project_id: string;
  files: FileInfo[];
}

