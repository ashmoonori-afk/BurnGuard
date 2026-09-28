export type ProjectBundleErrorCode =
  | "project_bundle_not_found"
  | "project_bundle_unavailable"
  | "project_bundle_limit"
  | "project_bundle_digest"
  | "project_bundle_credentials"
  | "invalid_project_bundle";

export class ProjectBundleError extends Error {
  readonly name = "ProjectBundleError";

  constructor(readonly code: ProjectBundleErrorCode) {
    super(code);
  }
}
