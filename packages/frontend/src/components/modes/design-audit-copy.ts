import { t } from "@/i18n/t";
import type { DesignAuditCheckCode, DesignAuditCheckStatus, DesignAuditTargetedAction, DesignAuditUnknownReason } from "@bg/shared";
import type { DesignAuditErrorCode } from "@/lib/design-audit-state";

export const DESIGN_AUDIT_CHECK_COPY = {
  get font_consistency() { return t("modes.audit.check.fontConsistency"); }, get copy_review() { return t("modes.audit.check.copyReview"); },
  get text_overflow() { return t("modes.audit.check.textOverflow"); }, get element_overlap() { return t("modes.audit.check.elementOverlap"); }, get minimum_text_size() { return t("modes.audit.check.minimumTextSize"); }, get contrast() { return t("modes.audit.check.contrast"); },
  get narrow_width() { return t("modes.audit.check.narrowWidth"); }, get duplicate_node_id() { return t("modes.audit.check.duplicateNodeId"); }, get missing_image() { return t("modes.audit.check.missingImage"); }, get token_usage() { return t("modes.audit.check.tokenUsage"); },
  get site_nav_mismatch() { return t("modes.audit.check.siteNavMismatch"); }, get site_missing_aria_current() { return t("modes.audit.check.currentPage"); }, get site_dangling_link() { return t("modes.audit.check.danglingLink"); },
  get site_missing_shared_block() { return t("modes.audit.check.sharedBlock"); }, get site_root_absolute_asset() { return t("modes.audit.check.absoluteAsset"); },
} as const satisfies Record<DesignAuditCheckCode, string>;

export const DESIGN_AUDIT_STATUS_COPY = {
  get pass() { return t("modes.audit.status.pass"); }, get fail() { return t("modes.audit.status.fail"); }, get skipped() { return t("modes.audit.status.skipped"); }, get unmeasurable() { return t("modes.audit.status.unmeasurable"); },
} as const satisfies Record<DesignAuditCheckStatus, string>;

export const DESIGN_AUDIT_ACTION_COPY = {
  get align_font_roles() { return t("modes.audit.action.alignFonts"); }, get revise_copy() { return t("modes.audit.action.reviseCopy"); },
  get expand_or_reflow_text() { return t("modes.audit.action.reflowText"); }, get separate_overlapping_elements() { return t("modes.audit.action.separateElements"); },
  get set_minimum_font_size() { return t("modes.audit.action.minimumFontSize"); }, get increase_color_contrast() { return t("modes.audit.action.contrast"); },
  get repair_narrow_layout() { return t("modes.audit.action.narrowLayout"); }, get assign_unique_node_ids() { return t("modes.audit.action.uniqueIds"); },
  get restore_image_reference() { return t("modes.audit.action.imageReference"); }, get replace_literal_with_token() { return t("modes.audit.action.useToken"); },
  get repair_site_navigation() { return t("modes.audit.action.siteNavigation"); }, get mark_current_page() { return t("modes.audit.action.currentPage"); },
  get create_or_repair_site_link() { return t("modes.audit.action.siteLink"); }, get add_shared_blocks() { return t("modes.audit.action.sharedBlocks"); },
  get relativize_asset_path() { return t("modes.audit.action.assetPath"); },
} as const satisfies Record<DesignAuditTargetedAction, string>;

export const DESIGN_AUDIT_UNKNOWN_COPY = {
  get no_measurable_candidates() { return t("modes.audit.unknown.noCandidates"); }, get unresolvable_rendering() { return t("modes.audit.unknown.rendering"); },
  get tokens_not_exposed() { return t("modes.audit.unknown.tokens"); },
} as const satisfies Record<DesignAuditUnknownReason, string>;

export const DESIGN_AUDIT_ERROR_COPY = {
  get project_not_found() { return t("modes.audit.error.projectNotFound"); }, get project_path_unavailable() { return t("modes.audit.error.projectPath"); },
  get stale_artifact_identity() { return t("modes.audit.error.staleArtifact"); }, get audit_unavailable() { return t("modes.audit.error.unavailable"); },
  get stale_revision() { return t("modes.audit.error.staleArtifact"); }, get stale_artifact_digest() { return t("modes.audit.error.staleArtifact"); },
  get stale_file_hash() { return t("modes.audit.error.staleFile"); }, get stale_node_fingerprint() { return t("modes.audit.error.staleNode"); },
  get file_not_found() { return t("modes.audit.error.fileNotFound"); }, get node_not_found() { return t("modes.audit.error.nodeNotFound"); },
  get network_error() { return t("modes.audit.error.network"); }, get unknown_error() { return t("modes.audit.error.unknown"); },
} as const satisfies Record<DesignAuditErrorCode, string>;
