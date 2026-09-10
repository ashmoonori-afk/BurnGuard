import { useCallback, useState } from "react";
import {
  DEFAULT_EXPORT_OPTION_VALUES,
  type ExportOptionValues,
} from "./export-options";

function storageKey(projectId: string): string {
  return `bg.export-options.${projectId}`;
}

function readStored(projectId: string): ExportOptionValues {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (raw === null) return DEFAULT_EXPORT_OPTION_VALUES;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return DEFAULT_EXPORT_OPTION_VALUES;
    const record = stored as Partial<ExportOptionValues>;
    return {
      assetBaseUrl: typeof record.assetBaseUrl === "string" ? record.assetBaseUrl : DEFAULT_EXPORT_OPTION_VALUES.assetBaseUrl,
      sliceHeight: record.sliceHeight === 3000 ? 3000 : 5000,
      sliceFormat: record.sliceFormat === "jpeg" ? "jpeg" : "png",
      jpegQuality:
        typeof record.jpegQuality === "number" && record.jpegQuality >= 60 && record.jpegQuality <= 95
          ? Math.round(record.jpegQuality)
          : DEFAULT_EXPORT_OPTION_VALUES.jpegQuality,
    };
  } catch (error) {
    if (error instanceof SyntaxError) return DEFAULT_EXPORT_OPTION_VALUES;
    throw error;
  }
}

/**
 * Export option inputs are a draft: they survive navigation, reload, and a
 * failed export, so a rejected package never costs the user the URL they typed.
 */
export function useExportOptionValues(
  projectId: string,
): readonly [ExportOptionValues, (next: ExportOptionValues) => void] {
  const [values, setValues] = useState<ExportOptionValues>(() => readStored(projectId));
  const update = useCallback(
    (next: ExportOptionValues) => {
      setValues(next);
      window.localStorage.setItem(storageKey(projectId), JSON.stringify(next));
    },
    [projectId],
  );
  return [values, update];
}
