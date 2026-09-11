import { parseGenerationStyle, type GenerationStyle } from "./generation-style";
import {
  UpgradeContractError,
  decodeContract,
  isRecord,
  requiredArray,
  requiredNumber,
  requiredString,
  stringArray,
  type UnknownRecord,
} from "./contract-parser";

export const DESIGN_DIRECTION_LAYOUTS = ["editorial", "modular", "narrative"] as const;
export const DESIGN_DIRECTION_SLOT_STATUSES = ["pending", "ready", "failed", "cancelled"] as const;
export const DESIGN_DIRECTION_STATUSES = ["loading", "ready", "partial", "failed", "cancelled"] as const;

export type DesignDirectionLayout = (typeof DESIGN_DIRECTION_LAYOUTS)[number];
export type DesignDirectionSlotStatus = (typeof DESIGN_DIRECTION_SLOT_STATUSES)[number];
export type DesignDirectionStatus = (typeof DESIGN_DIRECTION_STATUSES)[number];

export type DesignDirectionSlot = {
  readonly id: string;
  readonly order: number;
  readonly layout_key: DesignDirectionLayout;
  readonly title: string;
  readonly summary: string;
  readonly style_facts: readonly string[];
  readonly status: DesignDirectionSlotStatus;
  readonly preview_url: string | null;
  readonly error: string | null;
};

export type DesignDirectionState = {
  readonly creative_preferences?: GenerationStyle;
  readonly schema_version: 1;
  readonly project_id: string;
  readonly session_id: string;
  readonly generation_id: string;
  readonly status: DesignDirectionStatus;
  readonly content_outline: readonly string[];
  readonly directions: readonly DesignDirectionSlot[];
  readonly selected_id: string | null;
  readonly selection_revision: number;
  readonly selection_history: readonly (string | null)[];
  readonly error: string | null;
  readonly updated_at: number;
};

export function parseDesignDirectionState(input: unknown): DesignDirectionState {
  const record = decodeContract(input);
  exact(record, ["schema_version", "project_id", "session_id", "generation_id", "status", "content_outline", "directions", "selected_id", "selection_revision", "selection_history", "error", "updated_at"], ["creative_preferences"]);
  if (requiredNumber(record, "schema_version") !== 1) invalid("schema_version");
  const contentOutline = stringArray(record, "content_outline");
  if (contentOutline.length === 0 || contentOutline.length > 12 || contentOutline.some((entry) => entry.trim().length === 0)) invalid("content_outline");
  const rawDirections = requiredArray(record, "directions");
  if (rawDirections.length !== 3) invalid("directions");
  const directions = rawDirections.map(parseSlot);
  if (new Set(directions.map((slot) => slot.id)).size !== 3) invalid("directions.id");
  if (new Set(directions.map((slot) => slot.layout_key)).size !== 3) invalid("directions.layout_key");
  for (const [index, slot] of directions.entries()) if (slot.order !== index) invalid(`directions.${index}.order`);
  const selectedId = nullableString(record, "selected_id");
  if (selectedId !== null && !directions.some((slot) => slot.id === selectedId && slot.status === "ready")) invalid("selected_id");
  const selectionRevision = requiredNumber(record, "selection_revision");
  const selectionHistory = requiredArray(record, "selection_history").map((value, index) => {
    if (value === null) return null;
    if (typeof value !== "string" || !directions.some((slot) => slot.id === value && slot.status === "ready")) invalid(`selection_history.${index}`);
    return value;
  });
  if (selectionRevision < selectionHistory.length) invalid("selection_revision");
  const status = parseStatus(requiredString(record, "status"));
  validateAggregateStatus(status, directions);
  return {
    ...(record.creative_preferences === undefined ? {} : { creative_preferences: parseGenerationStyle(record.creative_preferences) }),
    schema_version: 1,
    project_id: requiredString(record, "project_id"),
    session_id: requiredString(record, "session_id"),
    generation_id: requiredString(record, "generation_id"),
    status,
    content_outline: contentOutline,
    directions,
    selected_id: selectedId,
    selection_revision: selectionRevision,
    selection_history: selectionHistory,
    error: nullableString(record, "error"),
    updated_at: requiredNumber(record, "updated_at"),
  };
}

function parseSlot(value: unknown, index: number): DesignDirectionSlot {
  if (!isRecord(value)) invalid(`directions.${index}`);
  exact(value, ["id", "order", "layout_key", "title", "summary", "style_facts", "status", "preview_url", "error"]);
  const status = parseSlotStatus(requiredString(value, "status"));
  const previewUrl = nullableString(value, "preview_url");
  const error = nullableString(value, "error");
  if ((status === "ready") !== (previewUrl !== null)) invalid(`directions.${index}.preview_url`);
  if ((status === "failed" || status === "cancelled") !== (error !== null)) invalid(`directions.${index}.error`);
  return {
    id: requiredString(value, "id"), order: requiredNumber(value, "order"),
    layout_key: parseLayout(requiredString(value, "layout_key")),
    title: requiredString(value, "title"), summary: requiredString(value, "summary"),
    style_facts: nonEmptyStrings(value, "style_facts"), status, preview_url: previewUrl, error,
  };
}

function validateAggregateStatus(status: DesignDirectionStatus, slots: readonly DesignDirectionSlot[]): void {
  const statuses = slots.map((slot) => slot.status);
  if (status === "loading" && statuses.includes("pending")) return;
  if (status === "ready" && statuses.every((value) => value === "ready")) return;
  if (status === "partial" && !statuses.includes("pending") && statuses.includes("ready") && statuses.includes("failed")) return;
  if (status === "failed" && statuses.every((value) => value === "failed")) return;
  if (status === "cancelled" && !statuses.includes("pending") && statuses.includes("cancelled")) return;
  invalid("status");
}

function parseLayout(value: string): DesignDirectionLayout { switch (value) { case "editorial": case "modular": case "narrative": return value; default: return invalid("layout_key"); } }
function parseSlotStatus(value: string): DesignDirectionSlotStatus { switch (value) { case "pending": case "ready": case "failed": case "cancelled": return value; default: return invalid("slot.status"); } }
function parseStatus(value: string): DesignDirectionStatus { switch (value) { case "loading": case "ready": case "partial": case "failed": case "cancelled": return value; default: return invalid("status"); } }
function nullableString(record: UnknownRecord, key: string): string | null { const value = record[key]; if (value === null) return null; if (typeof value !== "string" || value.length === 0) invalid(key); return value; }
function nonEmptyStrings(record: UnknownRecord, key: string): readonly string[] { const values = stringArray(record, key); if (values.length === 0 || values.length > 8) invalid(key); return values; }
function exact(record: UnknownRecord, keys: readonly string[], optional: readonly string[] = []): void { const allowed = new Set([...keys, ...optional]); for (const key of Object.keys(record)) if (!allowed.has(key)) invalid(key); for (const key of keys) if (!(key in record)) throw new UpgradeContractError("missing_required_field", key); }
function invalid(path: string): never { throw new UpgradeContractError("invalid_field", path); }
