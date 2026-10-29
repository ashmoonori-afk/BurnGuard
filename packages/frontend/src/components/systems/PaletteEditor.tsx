import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ColorContractError,
  gamutMapOklch,
  isInGamut,
  type OklchColor,
  oklchToCss,
  oklchToRgb,
  parseHexColor,
  type RgbColor,
  rgbToCss,
  rgbToHex,
  rgbToOklch,
  wcag2Contrast,
} from "@bg/shared/color";
import {
  distributePalette,
  PALETTE_DISTRIBUTIONS,
  PALETTE_LIMITS,
  type PaletteAnchor,
  type PaletteCurve,
  type PaletteDisplay,
  type PaletteDistribution,
  type PaletteSample,
  type PaletteScale,
  type PaletteState,
  type PaletteStop,
  parsePaletteState,
  samplePalette,
  sampleScale,
} from "@bg/shared/palette";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns,
  Copy,
  FileCode2,
  FileJson,
  Link2,
  Plus,
  RotateCcw,
  Rows,
  Save,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import "./palette-preview.css";

export type PaletteEditorText =
  | "workspaceLabel"
  | "toolbarLabel"
  | "stateUnsaved"
  | "stateSaved"
  | "stateClean"
  | "stateSaving"
  | "stateUnavailable"
  | "actionUndo"
  | "actionRedo"
  | "actionReset"
  | "actionImport"
  | "actionExportJson"
  | "actionExportCss"
  | "actionCopyLink"
  | "actionSave"
  | "actionSaving"
  | "actionCancel"
  | "actionClose"
  | "actionCopyValue"
  | "copiedValue"
  | "copyFailed"
  | "matrixRegionLabel"
  | "matrixViewScroll"
  | "matrixViewStacked"
  | "matrixScrollCue"
  | "matrixEmptyScales"
  | "stopColumnHeader"
  | "scaleColumnHeader"
  | "p3Badge"
  | "p3BadgeTitle"
  | "swatchSelectLabel"
  | "selectedCue"
  | "inspectorTitle"
  | "inspectorEmpty"
  | "inspectorScale"
  | "inspectorStop"
  | "inspectorPosition"
  | "inspectorGamut"
  | "inspectorHex"
  | "inspectorHexSrgbFallback"
  | "inspectorRgb"
  | "inspectorSrgbFallbackRgb"
  | "inspectorOklch"
  | "inspectorContrastWhite"
  | "inspectorContrastBlack"
  | "inspectorContrastSrgbFallbackNote"
  | "fieldName"
  | "fieldStep"
  | "fieldHex"
  | "fieldRgb"
  | "fieldOklch"
  | "fieldContrastWhite"
  | "fieldContrastBlack"
  | "contrastWhiteShort"
  | "contrastBlackShort"
  | "contrastFallbackSuffix"
  | "stopsSectionTitle"
  | "distributionLabel"
  | "distributionDefault"
  | "distributionEven"
  | "distributionMoreLight"
  | "distributionMoreDark"
  | "distributionEnds"
  | "distributionCustom"
  | "stopCountLabel"
  | "rangeStartLabel"
  | "rangeEndLabel"
  | "axisLabel"
  | "axisInstructions"
  | "stopHandleLabel"
  | "selectedStopTitle"
  | "stopNameLabel"
  | "stopPositionLabel"
  | "stopNudgeLeft"
  | "stopNudgeRight"
  | "stopAddButton"
  | "stopRemoveButton"
  | "stopListLabel"
  | "curveSectionTitle"
  | "chromaAmountLabel"
  | "curveKindLabel"
  | "curveKindEven"
  | "curveKindBell"
  | "curveWidthLabel"
  | "curveSoftnessLabel"
  | "curveLightEndLabel"
  | "curveDarkEndLabel"
  | "lightnessLightLabel"
  | "lightnessDarkLabel"
  | "gamutSectionTitle"
  | "gamutLabel"
  | "gamutSrgb"
  | "gamutDisplayP3"
  | "envelopeLabel"
  | "envelopeSelectedHues"
  | "envelopeAllHues"
  | "allHuesOverviewTitle"
  | "allHuesOverviewDescription"
  | "allHuesPositionLabel"
  | "allHuesSpectrumLabel"
  | "allHuesSelectedStopMarker"
  | "scalesSectionTitle"
  | "addHueScaleButton"
  | "addNeutralScaleButton"
  | "removeNeutralScaleButton"
  | "scaleNameLabel"
  | "scaleHueLabel"
  | "scaleNeutralTag"
  | "scaleRemoveButton"
  | "newHueScaleDefaultName"
  | "newNeutralScaleDefaultName"
  | "anchorsSectionTitle"
  | "anchorsDescription"
  | "addAnchorButton"
  | "anchorEmptyState"
  | "anchorNameLabel"
  | "anchorSpaceLabel"
  | "anchorHexLabel"
  | "anchorHexUnavailableP3"
  | "anchorChannelRLabel"
  | "anchorChannelGLabel"
  | "anchorChannelBLabel"
  | "anchorRemoveButton"
  | "newAnchorDefaultName"
  | "displaySectionTitle"
  | "layoutLabel"
  | "layoutColumns"
  | "layoutRows"
  | "scaleGapLabel"
  | "stepGapLabel"
  | "appearanceLabel"
  | "appearanceLight"
  | "appearanceDark"
  | "appearanceSystem"
  | "informationModeLabel"
  | "informationHover"
  | "informationAlways"
  | "visibleFieldsLabel"
  | "importDialogTitle"
  | "importDialogDescription"
  | "importFileLabel"
  | "importJsonTextareaLabel"
  | "importSubmitButton"
  | "resetConfirmTitle"
  | "resetConfirmDescription"
  | "resetConfirmAction"
  | "validationInvalidName"
  | "validationDuplicateStopName"
  | "validationStopCountBounds"
  | "validationStopPositionOrder"
  | "validationRangeOrder"
  | "validationCurveAmount"
  | "validationCurveWidth"
  | "validationCurveSoftness"
  | "validationCurveEnds"
  | "validationLightnessOrder"
  | "validationScaleBounds"
  | "validationHueRange"
  | "validationAnchorBounds"
  | "validationHexFormat"
  | "validationChannelRange"
  | "validationGapRange"
  | "validationImportEmpty"
  | "validationImportTooLarge"
  | "validationImportInvalidJson"
  | "validationCommitRejected";

export type PaletteEditorProps = {
  state: PaletteState;
  text: Readonly<Record<PaletteEditorText, string>>;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  unavailable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  status: { tone: "info" | "success" | "error"; message: string } | null;
  onGestureStart(): void;
  onGestureCancel(): void;
  onChange(next: PaletteState, phase: "preview" | "commit"): void;
  onSave(): void;
  onUndo(): void;
  onRedo(): void;
  onReset(): void;
  onImport(json: string): void;
  onExport(format: "json" | "css"): void;
  onCopyLink(): void;
};

type DisplayField = PaletteDisplay["fields"][number];

const DISPLAY_FIELDS: readonly DisplayField[] = [
  "name",
  "step",
  "hex",
  "rgb",
  "oklch",
  "contrast-white",
  "contrast-black",
];

const SRGB_WHITE: RgbColor = { space: "srgb", r: 1, g: 1, b: 1 };
const SRGB_BLACK: RgbColor = { space: "srgb", r: 0, g: 0, b: 0 };
const OVERVIEW_HUES: readonly number[] = [
  0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340,
];
const POSITION_EPSILON = 0.0005;

type EvaluatedSwatch = {
  readonly scale: PaletteScale;
  readonly stop: PaletteStop;
  readonly sample: PaletteSample;
  readonly srgbFallback: RgbColor;
  readonly hex: string;
  readonly cssColor: string;
  readonly rgbText: string;
  readonly srgbFallbackText: string;
  readonly oklchText: string;
  readonly contrastWhite: number;
  readonly contrastBlack: number;
  readonly useLightForeground: boolean;
};

type EvaluatedAnchor = {
  readonly anchor: PaletteAnchor;
  readonly oklch: OklchColor;
  readonly srgbFallback: RgbColor;
  readonly hex: string;
  readonly cssColor: string;
  readonly rgbText: string;
  readonly oklchText: string;
  readonly contrastWhite: number;
  readonly contrastBlack: number;
  readonly useLightForeground: boolean;
};

function formatCopy(
  template: string,
  params?: Readonly<Record<string, string | number>>
): string {
  if (!params) return template;
  return template.replace(/\{(name|value|count)\}/g, (match, key: string) => {
    const replacement = params[key];
    return replacement !== undefined ? String(replacement) : match;
  });
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number, digits = 3): string {
  return String(roundTo(value, digits));
}

function numberInput(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function formatChannel(value: number): string {
  return roundTo(value, 4).toFixed(3).replace(/\.?0+$/, "");
}

function formatRgbNumbers(color: RgbColor): string {
  const prefix = color.space === "display-p3" ? "color(display-p3 " : "rgb(";
  const suffix = ")";
  if (color.space === "display-p3") {
    return `${prefix}${formatChannel(color.r)} ${formatChannel(color.g)} ${formatChannel(color.b)}${suffix}`;
  }
  const r255 = Math.round(Math.min(1, Math.max(0, color.r)) * 255);
  const g255 = Math.round(Math.min(1, Math.max(0, color.g)) * 255);
  const b255 = Math.round(Math.min(1, Math.max(0, color.b)) * 255);
  return `${prefix}${r255}, ${g255}, ${b255}${suffix}`;
}

function formatOklchNumbers(color: OklchColor): string {
  const lPct = `${roundTo(color.l * 100, 1)}%`;
  const cVal = roundTo(color.c, 4);
  const hVal = roundTo(color.h, 1);
  return `oklch(${lPct} ${cVal} ${hVal})`;
}

function formatContrast(ratio: number): string {
  return `${roundTo(ratio, 2).toFixed(2)}:1`;
}

function isValidEntityName(name: string): boolean {
  if (name.length < 1 || name.length > 80) return false;
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

function makeUniqueId(
  prefix: "stop" | "scale" | "anchor",
): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function makeUniqueStopName(stops: readonly PaletteStop[], preferred?: string): string {
  const names = new Set(stops.map((s) => s.name));
  if (preferred && isValidEntityName(preferred) && !names.has(preferred)) {
    return preferred;
  }
  let numericCandidate = 50;
  while (names.has(String(numericCandidate))) {
    numericCandidate += 25;
  }
  return String(numericCandidate);
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = target instanceof HTMLInputElement ? target.type.toLowerCase() : "";
    return type !== "button" && type !== "checkbox" && type !== "radio" && type !== "range";
  }
  return Boolean(target.closest('[role="textbox"], [contenteditable="true"]'));
}

export default function PaletteEditor(props: PaletteEditorProps): React.ReactElement {
  const {
    state,
    text,
    dirty,
    saving,
    saved,
    unavailable,
    canUndo,
    canRedo,
    status,
    onGestureStart,
    onGestureCancel,
    onChange,
    onSave,
    onUndo,
    onRedo,
    onReset,
    onImport,
    onExport,
    onCopyLink,
  } = props;

  const baseId = useId();

  const [selectedStopId, setSelectedStopId] = useState<string>(() => state.stops[0]?.id ?? "");
  const [selectedSwatch, setSelectedSwatch] = useState<{
    scaleId: string;
    stopId: string;
  } | null>(() =>
    state.scales[0] && state.stops[0]
      ? { scaleId: state.scales[0].id, stopId: state.stops[0].id }
      : null
  );
  const [focusedSwatchKey, setFocusedSwatchKey] = useState<string | null>(null);
  const [stackedMatrixView, setStackedMatrixView] = useState<boolean>(false);
  const [overviewPosition, setOverviewPosition] = useState<number>(() =>
    state.stops[Math.floor(state.stops.length / 2)]?.position ?? 0.5
  );

  const [draftInputs, setDraftInputs] = useState<Readonly<Record<string, string>>>({});
  const [invalidDrafts, setInvalidDrafts] = useState<ReadonlySet<string>>(() => new Set());
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importDraft, setImportDraft] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState<boolean>(false);

  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const resetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const axisTrackRef = useRef<HTMLDivElement | null>(null);

  const activeGestureRef = useRef<{
    kind: "axis-stop" | "slider";
    pointerId: number;
    stopId?: string;
    minPos?: number;
    maxPos?: number;
    latestState: PaletteState;
    hasPreviewed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!state.stops.some((s) => s.id === selectedStopId)) {
      setSelectedStopId(state.stops[0]?.id ?? "");
    }
    if (selectedSwatch) {
      const hasScale = state.scales.some((sc) => sc.id === selectedSwatch.scaleId);
      const hasStop = state.stops.some((st) => st.id === selectedSwatch.stopId);
      if (!hasScale || !hasStop) {
        setSelectedSwatch(
          state.scales[0] && state.stops[0]
            ? { scaleId: state.scales[0].id, stopId: state.stops[0].id }
            : null
        );
      }
    } else if (state.scales[0] && state.stops[0]) {
      setSelectedSwatch({ scaleId: state.scales[0].id, stopId: state.stops[0].id });
    }
  }, [state.stops, state.scales, selectedStopId, selectedSwatch]);

  const setDraftValue = (key: string, value: string): void => {
    setDraftInputs((prev) => ({ ...prev, [key]: value }));
    setInvalidDrafts(previous => new Set([...previous].filter(name => name !== key)));
  };

  const fieldError = (key: string, message: string): void => {
    setInvalidDrafts(previous => new Set([...previous, key]));
    setValidationError(message);
  };

  const clearDraftValue = (key: string): void => {
    setInvalidDrafts(previous => new Set([...previous].filter(name => name !== key)));
    setDraftInputs((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearAllDrafts = (): void => {
    setDraftInputs({});
    setInvalidDrafts(new Set());
    setValidationError(null);
  };

  const tryCommitState = (
    candidate: unknown,
    fallbackMessageKey: PaletteEditorText = "validationCommitRejected",
    draftKeyToClear?: string
  ): boolean => {
    let validated: PaletteState;
    try { validated = parsePaletteState(candidate); }
    catch (error) {
      if (!(error instanceof UpgradeContractError)) throw error;
      if (draftKeyToClear) fieldError(draftKeyToClear, text[fallbackMessageKey]);
      else setValidationError(text[fallbackMessageKey]);
      return false;
    }
    setValidationError(null);
    if (draftKeyToClear) clearDraftValue(draftKeyToClear);
    onChange(validated, "commit");
    return true;
  };

  const tryPreviewState = (candidate: PaletteState): PaletteState | null => {
    let validated: PaletteState;
    try { validated = parsePaletteState(candidate); }
    catch (error) {
      if (!(error instanceof UpgradeContractError)) throw error;
      return null;
    }
    setValidationError(null);
    onChange(validated, "preview");
    return validated;
  };

  const cancelActiveGesture = (): void => {
    if (!activeGestureRef.current) return;
    activeGestureRef.current = null;
    onGestureCancel();
  };

  const restoreHistory = (restore: () => void): void => {
    cancelActiveGesture();
    clearAllDrafts();
    restore();
  };

  const generatedStopMap = useMemo(() => {
    const byStopId = new Map<string, ReadonlyMap<string, EvaluatedSwatch>>();
    const scaleById = new Map<string, PaletteScale>();
    for (const sc of state.scales) {
      scaleById.set(sc.id, sc);
    }

    for (const stop of state.stops) {
      const samples = samplePalette(state, stop.position);
      const scaleMap = new Map<string, EvaluatedSwatch>();
      for (const sample of samples) {
        const scale = scaleById.get(sample.id);
        if (!scale) continue;
        const srgbFallback: RgbColor =
          sample.rgb.space === "srgb"
            ? sample.rgb
            : oklchToRgb(gamutMapOklch(sample.color, "srgb"), "srgb");
        const hex = rgbToHex(srgbFallback).toUpperCase();
        const cssColor =
          sample.rgb.space === "display-p3"
            ? rgbToCss(sample.rgb)
            : oklchToCss(sample.color);
        const rgbText = formatRgbNumbers(sample.rgb);
        const srgbFallbackText = formatRgbNumbers(srgbFallback);
        const oklchText = formatOklchNumbers(sample.color);
        const contrastWhite = wcag2Contrast(srgbFallback, SRGB_WHITE);
        const contrastBlack = wcag2Contrast(srgbFallback, SRGB_BLACK);
        const useLightForeground = contrastWhite >= contrastBlack;

        scaleMap.set(scale.id, {
          scale,
          stop,
          sample,
          srgbFallback,
          hex,
          cssColor,
          rgbText,
          srgbFallbackText,
          oklchText,
          contrastWhite,
          contrastBlack,
          useLightForeground,
        });
      }
      byStopId.set(stop.id, scaleMap);
    }

    return byStopId;
  }, [state]);

  const evaluatedAnchors = useMemo<readonly EvaluatedAnchor[]>(() => {
    return state.anchors.map((anchor) => {
      const oklch = rgbToOklch(anchor.color);
      const srgbFallback: RgbColor =
        anchor.color.space === "srgb"
          ? anchor.color
          : oklchToRgb(gamutMapOklch(oklch, "srgb"), "srgb");
      const hex = rgbToHex(srgbFallback).toUpperCase();
      const cssColor = rgbToCss(anchor.color);
      const rgbText = formatRgbNumbers(anchor.color);
      const oklchText = formatOklchNumbers(oklch);
      const contrastWhite = wcag2Contrast(srgbFallback, SRGB_WHITE);
      const contrastBlack = wcag2Contrast(srgbFallback, SRGB_BLACK);
      const useLightForeground = contrastWhite >= contrastBlack;
      return {
        anchor,
        oklch,
        srgbFallback,
        hex,
        cssColor,
        rgbText,
        oklchText,
        contrastWhite,
        contrastBlack,
        useLightForeground,
      };
    });
  }, [state.anchors]);

  const allHuesOverviewCells = useMemo(() => {
    const context = {
      scales: state.scales,
      gamut: state.gamut,
      envelope: state.envelope,
    } as const;
    const { l, c } = sampleScale(overviewPosition, state.curve, context);
    return OVERVIEW_HUES.map((hue) => {
      const rawOklch: OklchColor = { l, c, h: hue };
      const mapped = gamutMapOklch(rawOklch, state.gamut);
      const rgb = oklchToRgb(mapped, state.gamut);
      const srgbMapped = gamutMapOklch(rawOklch, "srgb");
      const srgbRgb = oklchToRgb(srgbMapped, "srgb");
      const outsideSrgb = !isInGamut(mapped, "srgb");
      const contrastWhite = wcag2Contrast(srgbRgb, SRGB_WHITE);
      const contrastBlack = wcag2Contrast(srgbRgb, SRGB_BLACK);
      return {
        hue,
        oklch: mapped,
        rgb,
        srgbFallback: srgbRgb,
        hex: rgbToHex(srgbRgb).toUpperCase(),
        cssColor: rgbToCss(rgb),
        outsideSrgb,
        useLightForeground: contrastWhite >= contrastBlack,
      };
    });
  }, [
    overviewPosition,
    state.curve,
    state.scales,
    state.gamut,
    state.envelope,
  ]);

  const selectedStopIndex = state.stops.findIndex((s) => s.id === selectedStopId);
  const selectedStop: PaletteStop | undefined =
    selectedStopIndex >= 0 ? state.stops[selectedStopIndex] : state.stops[0];

  const activeInspectorSwatch: EvaluatedSwatch | null = useMemo(() => {
    if (!selectedSwatch) return null;
    const stopRow = generatedStopMap.get(selectedSwatch.stopId);
    if (!stopRow) return null;
    return stopRow.get(selectedSwatch.scaleId) ?? null;
  }, [generatedStopMap, selectedSwatch]);

  const handleWorkspaceKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      if (activeGestureRef.current) {
        event.preventDefault();
        event.stopPropagation();
        cancelActiveGesture();
        return;
      }
      if (resetConfirmOpen) {
        event.preventDefault();
        event.stopPropagation();
        setResetConfirmOpen(false);
        resetTriggerRef.current?.focus();
        return;
      }
    }

    if (isTextEditingTarget(event.target)) {
      return;
    }

    const isMod = event.metaKey || event.ctrlKey;
    if (isMod && !event.altKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        if (canRedo) restoreHistory(onRedo);
      } else if (canUndo) {
        restoreHistory(onUndo);
      }
      return;
    }
    if (isMod && !event.altKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      if (canRedo) restoreHistory(onRedo);
    }
  };

  const startSliderGesture = (event: React.PointerEvent<HTMLInputElement>): void => {
    if (activeGestureRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activeGestureRef.current = {
      kind: "slider",
      pointerId: event.pointerId,
      latestState: state,
      hasPreviewed: false,
    };
    onGestureStart();
  };

  const updateSliderGesturePreview = (candidate: PaletteState): void => {
    if (activeGestureRef.current) {
      const validated = tryPreviewState(candidate);
      if (validated) {
        activeGestureRef.current.latestState = validated;
        activeGestureRef.current.hasPreviewed = true;
      }
    } else {
      tryCommitState(candidate);
    }
  };

  const finishSliderGesture = (): void => {
    const active = activeGestureRef.current;
    if (!active || active.kind !== "slider") return;
    activeGestureRef.current = null;
    if (active.hasPreviewed) {
      onChange(active.latestState, "commit");
    } else {
      onGestureCancel();
    }
  };

  const computeStopBounds = (stopIndex: number): { min: number; max: number } => {
    const prevPos =
      stopIndex > 0
        ? state.stops[stopIndex - 1].position + POSITION_EPSILON
        : 0;
    const nextPos =
      stopIndex < state.stops.length - 1
        ? state.stops[stopIndex + 1].position - POSITION_EPSILON
        : 1;
    return {
      min: roundTo(prevPos, 4),
      max: roundTo(nextPos, 4),
    };
  };

  const buildStateWithStopPosition = (
    baseState: PaletteState,
    stopId: string,
    rawPosition: number,
    minPos: number,
    maxPos: number
  ): PaletteState => {
    const clamped = roundTo(Math.min(maxPos, Math.max(minPos, rawPosition)), 4);
    const nextStops = baseState.stops.map((st) =>
      st.id === stopId ? { ...st, position: clamped } : st
    );
    return {
      ...baseState,
      distribution: "custom",
      range: {
        start: baseState.stops[0].id === stopId ? clamped : baseState.range.start,
        end: baseState.stops[baseState.stops.length - 1].id === stopId ? clamped : baseState.range.end,
      },
      stops: nextStops,
    };
  };

  const handleStopHandlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    stop: PaletteStop,
    stopIndex: number
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedStopId(stop.id);
    const bounds = computeStopBounds(stopIndex);
    event.currentTarget.setPointerCapture(event.pointerId);
    activeGestureRef.current = {
      kind: "axis-stop",
      pointerId: event.pointerId,
      stopId: stop.id,
      minPos: bounds.min,
      maxPos: bounds.max,
      latestState: state,
      hasPreviewed: false,
    };
    onGestureStart();
  };

  const handleStopHandlePointerMove = (
    event: React.PointerEvent<HTMLButtonElement>
  ): void => {
    const active = activeGestureRef.current;
    if (
      !active ||
      active.kind !== "axis-stop" ||
      active.pointerId !== event.pointerId ||
      !active.stopId ||
      active.minPos === undefined ||
      active.maxPos === undefined
    ) {
      return;
    }
    const track = axisTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const nextCandidate = buildStateWithStopPosition(
      active.latestState,
      active.stopId,
      ratio,
      active.minPos,
      active.maxPos
    );
    const validated = tryPreviewState(nextCandidate);
    if (validated) {
      active.latestState = validated;
      active.hasPreviewed = true;
      clearDraftValue(`stop-pos-${active.stopId}`);
    }
  };

  const handleStopHandlePointerUp = (
    event: React.PointerEvent<HTMLButtonElement>
  ): void => {
    const active = activeGestureRef.current;
    if (!active || active.kind !== "axis-stop" || active.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeGestureRef.current = null;
    if (active.hasPreviewed) {
      onChange(active.latestState, "commit");
    } else {
      onGestureCancel();
    }
  };

  const handleStopHandlePointerCancel = (
    event: React.PointerEvent<HTMLButtonElement>
  ): void => {
    const active = activeGestureRef.current;
    if (!active || active.kind !== "axis-stop" || active.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    cancelActiveGesture();
  };

  const nudgeStopPosition = (stopIndex: number, delta: number): void => {
    const stop = state.stops[stopIndex];
    if (!stop) return;
    const bounds = computeStopBounds(stopIndex);
    if (bounds.max < bounds.min) {
      setValidationError(text.validationStopPositionOrder);
      return;
    }
    const nextCandidate = buildStateWithStopPosition(
      state,
      stop.id,
      stop.position + delta,
      bounds.min,
      bounds.max
    );
    if (
      tryCommitState(
        nextCandidate,
        "validationStopPositionOrder",
        `stop-pos-${stop.id}`
      )
    ) {
      setOverviewPosition(nextCandidate.stops[stopIndex].position);
    }
  };

  const handleStopHandleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    stopIndex: number
  ): void => {
    const step = event.shiftKey ? 0.05 : 0.01;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      nudgeStopPosition(stopIndex, -step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      nudgeStopPosition(stopIndex, step);
    } else if (event.key === "Home") {
      event.preventDefault();
      nudgeStopPosition(stopIndex, -1);
    } else if (event.key === "End") {
      event.preventDefault();
      nudgeStopPosition(stopIndex, 1);
    }
  };

  const handleDistributionChange = (rawDistribution: string): void => {
    const nextDistribution = PALETTE_DISTRIBUTIONS.find(value => value === rawDistribution);
    if (nextDistribution === undefined) {
      setValidationError(text.validationCommitRejected);
      return;
    }
    try {
      const distributed = distributePalette(state, nextDistribution);
      const validated = parsePaletteState(distributed);
      clearAllDrafts();
      onChange(validated, "commit");
    } catch (error) {
      if (!(error instanceof UpgradeContractError)) throw error;
      setValidationError(text.validationCommitRejected);
    }
  };

  const commitStopCount = (rawText: string): void => {
    if (draftInputs["stop-count"] === undefined) return;
    const parsed = numberInput(rawText);
    if (
      !Number.isInteger(parsed) ||
      parsed < 2 ||
      parsed > PALETTE_LIMITS.stops
    ) {
      fieldError("stop-count", text.validationStopCountBounds);
      return;
    }
    if (parsed === state.stops.length) {
      clearDraftValue("stop-count");
      setValidationError(null);
      return;
    }

    const nextStops: PaletteStop[] = [];
    const span = state.range.end - state.range.start;
    for (let i = 0; i < parsed; i += 1) {
      const existing = state.stops[i];
      const ratio = parsed === 1 ? 0.5 : i / (parsed - 1);
      const fallbackPos = roundTo(state.range.start + span * ratio, 4);
      if (existing) {
        nextStops.push({
          ...existing,
          position: fallbackPos,
        });
      } else {
        const id = makeUniqueId("stop");
        const name = makeUniqueStopName(nextStops);
        nextStops.push({
          id,
          name,
          position: fallbackPos,
        });
      }
    }

    const targetDist: PaletteDistribution =
      state.distribution === "custom" ? "even" : state.distribution;
    try {
      const seeded: PaletteState = {
        ...state,
        stops: nextStops,
        distribution: targetDist,
      };
      const distributed = distributePalette(seeded, targetDist);
      const validated = parsePaletteState(distributed);
      clearDraftValue("stop-count");
      setValidationError(null);
      onChange(validated, "commit");
    } catch (error) {
      if (!(error instanceof UpgradeContractError)) throw error;
      fieldError("stop-count", text.validationStopCountBounds);
    }
  };

  const handleAddStop = (): void => {
    if (state.stops.length >= PALETTE_LIMITS.stops) {
      setValidationError(text.validationStopCountBounds);
      return;
    }

    const currentIdx =
      selectedStopIndex >= 0 ? selectedStopIndex : state.stops.length - 1;
    let insertIndex = currentIdx + 1;
    let newPos: number | null = null;

    if (currentIdx < state.stops.length - 1) {
      const a = state.stops[currentIdx].position;
      const b = state.stops[currentIdx + 1].position;
      if (b - a > POSITION_EPSILON * 2) {
        newPos = roundTo((a + b) / 2, 4);
        insertIndex = currentIdx + 1;
      }
    }
    if (newPos === null && currentIdx > 0) {
      const a = state.stops[currentIdx - 1].position;
      const b = state.stops[currentIdx].position;
      if (b - a > POSITION_EPSILON * 2) {
        newPos = roundTo((a + b) / 2, 4);
        insertIndex = currentIdx;
      }
    }
    if (newPos === null) {
      for (let i = 0; i < state.stops.length - 1; i += 1) {
        const a = state.stops[i].position;
        const b = state.stops[i + 1].position;
        if (b - a > POSITION_EPSILON * 2) {
          newPos = roundTo((a + b) / 2, 4);
          insertIndex = i + 1;
          break;
        }
      }
    }
    if (newPos === null) {
      setValidationError(text.validationStopPositionOrder);
      return;
    }

    const newId = makeUniqueId("stop");
    const newName = makeUniqueStopName(state.stops);
    const created: PaletteStop = {
      id: newId,
      name: newName,
      position: newPos,
    };
    const nextStops = [
      ...state.stops.slice(0, insertIndex),
      created,
      ...state.stops.slice(insertIndex),
    ];
    const nextState: PaletteState = {
      ...state,
      distribution: "custom",
      stops: nextStops,
    };
    if (tryCommitState(nextState, "validationStopPositionOrder")) {
      setSelectedStopId(newId);
    }
  };

  const handleRemoveStop = (stopId: string): void => {
    if (state.stops.length <= 2) {
      setValidationError(text.validationStopCountBounds);
      return;
    }
    const idx = state.stops.findIndex((s) => s.id === stopId);
    if (idx < 0) return;
    const nextStops = state.stops.filter((s) => s.id !== stopId);
    const nextState: PaletteState = {
      ...state,
      distribution: "custom",
      stops: nextStops,
    };
    if (tryCommitState(nextState, "validationStopCountBounds")) {
      const fallbackStop = nextStops[Math.min(idx, nextStops.length - 1)];
      if (fallbackStop) {
        setSelectedStopId(fallbackStop.id);
      }
    }
  };

  const commitStopName = (stop: PaletteStop, rawName: string): void => {
    const trimmed = rawName.trim();
    const draftKey = `stop-name-${stop.id}`;
    if (draftInputs[draftKey] === undefined) return;
    if (!isValidEntityName(trimmed)) {
      fieldError(draftKey, text.validationInvalidName);
      return;
    }
    if (state.stops.some((s) => s.id !== stop.id && s.name === trimmed)) {
      fieldError(draftKey, text.validationDuplicateStopName);
      return;
    }
    const nextState: PaletteState = {
      ...state,
      stops: state.stops.map((s) =>
        s.id === stop.id ? { ...s, name: trimmed } : s
      ),
    };
    tryCommitState(nextState, "validationInvalidName", draftKey);
  };

  const commitStopPosition = (
    stop: PaletteStop,
    stopIndex: number,
    rawPos: string
  ): void => {
    const draftKey = `stop-pos-${stop.id}`;
    if (draftInputs[draftKey] === undefined) return;
    const parsed = numberInput(rawPos);
    if (!Number.isFinite(parsed)) {
      fieldError(draftKey, text.validationStopPositionOrder);
      return;
    }
    const nextStops = state.stops.map((s) =>
      s.id === stop.id ? { ...s, position: parsed } : s
    );
    const nextState: PaletteState = {
      ...state,
      distribution: "custom",
      range: {
        start: stopIndex === 0 ? parsed : state.range.start,
        end: stopIndex === state.stops.length - 1 ? parsed : state.range.end,
      },
      stops: nextStops,
    };
    tryCommitState(nextState, "validationStopPositionOrder", draftKey);
  };

  const commitRangeEdge = (edge: "start" | "end", rawValue: string): void => {
    const draftKey = `range-${edge}`;
    if (draftInputs[draftKey] === undefined) return;
    const parsed = numberInput(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      fieldError(draftKey, text.validationRangeOrder);
      return;
    }
    const nextRange = {
      start: edge === "start" ? parsed : state.range.start,
      end: edge === "end" ? parsed : state.range.end,
    };
    const firstStopPos = state.stops[0]?.position ?? 0;
    const lastStopPos = state.stops[state.stops.length - 1]?.position ?? 1;
    if (
      nextRange.start >= nextRange.end ||
      nextRange.start > firstStopPos ||
      nextRange.end < lastStopPos
    ) {
      fieldError(draftKey, text.validationRangeOrder);
      return;
    }
    const nextState: PaletteState = {
      ...state,
      range: nextRange,
    };
    tryCommitState(nextState, "validationRangeOrder", draftKey);
  };

  const commitCurveField = (
    field: "amountPct" | "width" | "softness" | "light_end" | "dark_end" | "lightness_light" | "lightness_dark",
    rawValue: string
  ): void => {
    const draftKey = `curve-${field}`;
    if (draftInputs[draftKey] === undefined) return;
    const parsed = numberInput(rawValue);
    if (!Number.isFinite(parsed)) {
      fieldError(draftKey, text.validationCommitRejected);
      return;
    }

    let nextCurve: PaletteCurve = state.curve;
    let errorKey: PaletteEditorText = "validationCommitRejected";

    if (field === "amountPct") {
      errorKey = "validationCurveAmount";
      const amount = parsed / 100;
      if (amount < 0 || amount > 4) {
        fieldError(draftKey, text[errorKey]);
        return;
      }
      nextCurve = { ...state.curve, amount };
    } else if (field === "width") {
      errorKey = "validationCurveWidth";
      if (parsed < 0.01 || parsed > 1) {
        fieldError(draftKey, text[errorKey]);
        return;
      }
      nextCurve = { ...state.curve, width: parsed };
    } else if (field === "softness") {
      errorKey = "validationCurveSoftness";
      if (parsed < 0.1 || parsed > 8) {
        fieldError(draftKey, text[errorKey]);
        return;
      }
      nextCurve = { ...state.curve, softness: parsed };
    } else if (field === "light_end") {
      errorKey = "validationCurveEnds";
      if (parsed < 0 || parsed > 1) {
        fieldError(draftKey, text[errorKey]);
        return;
      }
      nextCurve = { ...state.curve, light_end: parsed };
    } else if (field === "dark_end") {
      errorKey = "validationCurveEnds";
      if (parsed < 0 || parsed > 1) {
        fieldError(draftKey, text[errorKey]);
        return;
      }
      nextCurve = { ...state.curve, dark_end: parsed };
    } else if (field === "lightness_light") {
      errorKey = "validationLightnessOrder";
      if (parsed < 0 || parsed > 1 || parsed < state.curve.lightness.dark) {
        fieldError(draftKey, text[errorKey]);
        return;
      }
      nextCurve = {
        ...state.curve,
        lightness: {
          ...state.curve.lightness,
          light: parsed,
        },
      };
    } else if (field === "lightness_dark") {
      errorKey = "validationLightnessOrder";
      if (parsed < 0 || parsed > 1 || parsed > state.curve.lightness.light) {
        fieldError(draftKey, text[errorKey]);
        return;
      }
      nextCurve = {
        ...state.curve,
        lightness: {
          ...state.curve.lightness,
          dark: parsed,
        },
      };
    }

    tryCommitState({ ...state, curve: nextCurve }, errorKey, draftKey);
  };

  const handleAddHueScale = (): void => {
    if (state.scales.length >= PALETTE_LIMITS.scales) {
      setValidationError(text.validationScaleBounds);
      return;
    }
    const id = makeUniqueId("scale");
    const hueIndex = state.scales.filter((s) => s.kind === "hue").length + 1;
    const defaultName = formatCopy(text.newHueScaleDefaultName, {
      count: hueIndex,
      value: hueIndex,
    });
    const safeName = isValidEntityName(defaultName) ? defaultName : `Hue ${hueIndex}`;
    const newScale: PaletteScale = {
      id,
      name: safeName,
      kind: "hue",
      hue: roundTo((hueIndex * 47) % 360, 1),
    };
    tryCommitState(
      { ...state, scales: [...state.scales, newScale] },
      "validationScaleBounds"
    );
  };

  const hasNeutralScale = state.scales.some((s) => s.kind === "neutral");

  const handleToggleNeutralScale = (): void => {
    if (hasNeutralScale) {
      const neutralScales = state.scales.filter((s) => s.kind === "neutral");
      const targetNeutral = neutralScales[neutralScales.length - 1];
      if (!targetNeutral) return;
      if (state.scales.length <= 1) {
        setValidationError(text.validationScaleBounds);
        return;
      }
      tryCommitState(
        {
          ...state,
          scales: state.scales.filter((s) => s.id !== targetNeutral.id),
        },
        "validationScaleBounds"
      );
    } else {
      if (state.scales.length >= PALETTE_LIMITS.scales) {
        setValidationError(text.validationScaleBounds);
        return;
      }
      const id = makeUniqueId("scale");
      const safeName = isValidEntityName(text.newNeutralScaleDefaultName)
        ? text.newNeutralScaleDefaultName
        : "Neutral";
      const neutralScale: PaletteScale = {
        id,
        name: safeName,
        kind: "neutral",
      };
      tryCommitState(
        {
          ...state,
          scales: [...state.scales, neutralScale],
        },
        "validationScaleBounds"
      );
    }
  };

  const handleRemoveScale = (scaleId: string): void => {
    if (state.scales.length <= 1) {
      setValidationError(text.validationScaleBounds);
      return;
    }
    tryCommitState(
      {
        ...state,
        scales: state.scales.filter((s) => s.id !== scaleId),
      },
      "validationScaleBounds"
    );
  };

  const commitScaleName = (scale: PaletteScale, rawName: string): void => {
    const draftKey = `scale-name-${scale.id}`;
    if (draftInputs[draftKey] === undefined) return;
    const trimmed = rawName.trim();
    if (!isValidEntityName(trimmed)) {
      fieldError(draftKey, text.validationInvalidName);
      return;
    }
    tryCommitState(
      {
        ...state,
        scales: state.scales.map((s) =>
          s.id === scale.id ? { ...s, name: trimmed } : s
        ),
      },
      "validationInvalidName",
      draftKey
    );
  };

  const commitScaleHue = (scale: PaletteScale, rawHue: string): void => {
    if (scale.kind !== "hue") return;
    const draftKey = `scale-hue-${scale.id}`;
    if (draftInputs[draftKey] === undefined) return;
    const parsed = numberInput(rawHue);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 360) {
      fieldError(draftKey, text.validationHueRange);
      return;
    }
    tryCommitState(
      {
        ...state,
        scales: state.scales.map((s) =>
          s.id === scale.id && s.kind === "hue"
            ? { ...s, hue: parsed }
            : s
        ),
      },
      "validationHueRange",
      draftKey
    );
  };

  const handleAddAnchor = (): void => {
    if (state.anchors.length >= PALETTE_LIMITS.anchors) {
      setValidationError(text.validationAnchorBounds);
      return;
    }
    const id = makeUniqueId("anchor");
    const idx = state.anchors.length + 1;
    const defaultName = formatCopy(text.newAnchorDefaultName, {
      count: idx,
      value: idx,
    });
    const safeName = isValidEntityName(defaultName) ? defaultName : `Brand ${idx}`;
    const newAnchor: PaletteAnchor = {
      id,
      name: safeName,
      color: {
        space: state.gamut,
        r: 0.12,
        g: 0.36,
        b: 0.84,
      },
    };
    tryCommitState(
      {
        ...state,
        anchors: [...state.anchors, newAnchor],
      },
      "validationAnchorBounds"
    );
  };

  const handleRemoveAnchor = (anchorId: string): void => {
    tryCommitState(
      {
        ...state,
        anchors: state.anchors.filter((a) => a.id !== anchorId),
      },
      "validationAnchorBounds"
    );
  };

  const commitAnchorName = (anchor: PaletteAnchor, rawName: string): void => {
    const draftKey = `anchor-name-${anchor.id}`;
    if (draftInputs[draftKey] === undefined) return;
    const trimmed = rawName.trim();
    if (!isValidEntityName(trimmed)) {
      fieldError(draftKey, text.validationInvalidName);
      return;
    }
    tryCommitState(
      {
        ...state,
        anchors: state.anchors.map((a) =>
          a.id === anchor.id ? { ...a, name: trimmed } : a
        ),
      },
      "validationInvalidName",
      draftKey
    );
  };

  const handleAnchorSpaceChange = (
    anchor: PaletteAnchor,
    space: string
  ): void => {
    const nextColor = {
      ...anchor.color,
      space,
    };
    if (
      tryCommitState(
        {
          ...state,
          anchors: state.anchors.map((a) =>
            a.id === anchor.id ? { ...a, color: nextColor } : a
          ),
        },
        "validationCommitRejected"
      )
    ) {
      clearDraftValue(`anchor-hex-${anchor.id}`);
    }
  };

  const commitAnchorHex = (anchor: PaletteAnchor, rawHex: string): void => {
    if (anchor.color.space !== "srgb") return;
    const draftKey = `anchor-hex-${anchor.id}`;
    if (draftInputs[draftKey] === undefined) return;
    try {
      const parsedRgb = parseHexColor(rawHex.trim());
      if (
        tryCommitState(
          {
            ...state,
            anchors: state.anchors.map((a) =>
              a.id === anchor.id ? { ...a, color: parsedRgb } : a
            ),
          },
          "validationHexFormat",
          draftKey
        )
      ) {
        clearDraftValue(`anchor-r-${anchor.id}`);
        clearDraftValue(`anchor-g-${anchor.id}`);
        clearDraftValue(`anchor-b-${anchor.id}`);
      }
    } catch (error) {
      if (!(error instanceof ColorContractError)) throw error;
      fieldError(draftKey, text.validationHexFormat);
    }
  };

  const commitAnchorChannel = (
    anchor: PaletteAnchor,
    channel: "r" | "g" | "b",
    rawVal: string
  ): void => {
    const draftKey = `anchor-${channel}-${anchor.id}`;
    if (draftInputs[draftKey] === undefined) return;
    const parsed = numberInput(rawVal);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      fieldError(draftKey, text.validationChannelRange);
      return;
    }
    const nextColor: RgbColor = {
      ...anchor.color,
      [channel]: parsed,
    };
    if (
      tryCommitState(
        {
          ...state,
          anchors: state.anchors.map((a) =>
            a.id === anchor.id ? { ...a, color: nextColor } : a
          ),
        },
        "validationChannelRange",
        draftKey
      )
    ) {
      clearDraftValue(`anchor-hex-${anchor.id}`);
    }
  };

  const commitDisplayGap = (
    kind: "scale_gap" | "step_gap",
    rawVal: string
  ): void => {
    const draftKey = `display-${kind}`;
    if (draftInputs[draftKey] === undefined) return;
    const parsed = numberInput(rawVal);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 128) {
      fieldError(draftKey, text.validationGapRange);
      return;
    }
    tryCommitState(
      {
        ...state,
        display: {
          ...state.display,
          [kind]: parsed,
        },
      },
      "validationGapRange",
      draftKey
    );
  };

  const toggleDisplayField = (field: DisplayField): void => {
    const hasField = state.display.fields.includes(field);
    const nextFields = hasField
      ? state.display.fields.filter((f) => f !== field)
      : DISPLAY_FIELDS.filter(
          (candidate) =>
            candidate === field || state.display.fields.includes(candidate)
        );
    tryCommitState({
      ...state,
      display: {
        ...state.display,
        fields: nextFields,
      },
    });
  };

  const handleImportFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > PALETTE_LIMITS.json * 4) {
      setImportError(text.validationImportTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      if (content.length > PALETTE_LIMITS.json) {
        setImportError(text.validationImportTooLarge);
        return;
      }
      setImportDraft(content);
      setImportError(null);
    };
    reader.onerror = () => {
      setImportError(text.validationImportInvalidJson);
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = importDraft.trim();
    if (!trimmed) {
      setImportError(text.validationImportEmpty);
      return;
    }
    if (importDraft.length > PALETTE_LIMITS.json) {
      setImportError(text.validationImportTooLarge);
      return;
    }
    try {
      const parsedJson: unknown = JSON.parse(trimmed);
      parsePaletteState(parsedJson);
      setImportError(null);
      clearAllDrafts();
      onImport(trimmed);
      setImportOpen(false);
      importTriggerRef.current?.focus();
    } catch (error) {
      if (!(error instanceof UpgradeContractError) && !(error instanceof SyntaxError)) throw error;
      setImportError(text.validationImportInvalidJson);
    }
  };

  const copyValueToClipboard = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedFeedback(value);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setValidationError(text.copyFailed);
    }
  };

  const getDistributionLabel = (dist: PaletteDistribution): string => {
    switch (dist) {
      case "default":
        return text.distributionDefault;
      case "even":
        return text.distributionEven;
      case "more-light":
        return text.distributionMoreLight;
      case "more-dark":
        return text.distributionMoreDark;
      case "ends":
        return text.distributionEnds;
      case "custom":
        return text.distributionCustom;
    }
  };

  const getFieldLabel = (field: DisplayField): string => {
    switch (field) {
      case "name":
        return text.fieldName;
      case "step":
        return text.fieldStep;
      case "hex":
        return text.fieldHex;
      case "rgb":
        return text.fieldRgb;
      case "oklch":
        return text.fieldOklch;
      case "contrast-white":
        return text.fieldContrastWhite;
      case "contrast-black":
        return text.fieldContrastBlack;
    }
  };

  const hasDrafts = Object.keys(draftInputs).length > 0;
  const hasChanges = dirty || hasDrafts;
  const saveDisabled = !hasChanges || saving || unavailable || invalidDrafts.size > 0;

  const persistenceBadgeText = unavailable
    ? text.stateUnavailable
    : saving
      ? text.stateSaving
      : hasChanges
        ? text.stateUnsaved
        : saved
          ? text.stateSaved
          : text.stateClean;

  const activeFields = state.display.fields;
  const alwaysShowInfo = state.display.information === "always";

  const renderSwatchCell = (swatch: EvaluatedSwatch): React.ReactElement => {
    const key = `${swatch.scale.id}:${swatch.stop.id}`;
    const isSelected =
      selectedSwatch?.scaleId === swatch.scale.id &&
      selectedSwatch?.stopId === swatch.stop.id;
    const isFocused = focusedSwatchKey === key;
    const showDetails =
      activeFields.length > 0 && (alwaysShowInfo || isSelected || isFocused);

    const fgClass = swatch.useLightForeground ? "text-white" : "text-black";
    const pillBgClass = swatch.useLightForeground
      ? "bg-black/45 text-white border-white/30"
      : "bg-white/75 text-black border-black/20";

    return (
      <button
        key={key}
        type="button"
        aria-pressed={isSelected}
        aria-label={formatCopy(text.swatchSelectLabel, {
          name: `${swatch.scale.name} ${swatch.stop.name}`,
          value: swatch.hex,
        })}
        onClick={() => {
          setSelectedSwatch({ scaleId: swatch.scale.id, stopId: swatch.stop.id });
          setSelectedStopId(swatch.stop.id);
          setOverviewPosition(swatch.stop.position);
        }}
        onFocus={() => setFocusedSwatchKey(key)}
        onBlur={() =>
          setFocusedSwatchKey((prev) => (prev === key ? null : prev))
        }
        style={{ backgroundColor: swatch.cssColor }}
        className={cn(
          "group relative flex min-h-[52px] min-w-[84px] w-full flex-col justify-between rounded-control border p-2 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isSelected
            ? "border-accent ring-2 ring-ring"
            : "border-border/70 hover:border-foreground/50",
          fgClass
        )}
      >
        <div className="flex w-full items-start justify-between gap-1">
          <div className="flex flex-wrap items-center gap-1">
            {isSelected ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight border",
                  pillBgClass
                )}
              >
                <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{text.selectedCue}</span>
              </span>
            ) : null}
          </div>
          {swatch.sample.outside_srgb ? (
            <span
              title={text.p3BadgeTitle}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
                pillBgClass
              )}
            >
              <span
                className="h-1.5 w-1.5 rotate-45 bg-current"
                aria-hidden="true"
              />
              {text.p3Badge}
            </span>
          ) : null}
        </div>

        { activeFields.length > 0 ? (
          <div
            className={cn(
              "mt-1.5 flex flex-col gap-0.5 text-[11px] leading-[1.45] transition-opacity",
              showDetails
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            )}
          >
            {activeFields.includes("name") ? (
              <span className="break-words font-medium">{swatch.scale.name}</span>
            ) : null}
            {activeFields.includes("step") ? (
              <span className="font-mono">{swatch.stop.name}</span>
            ) : null}
            {activeFields.includes("hex") ? (
              <span className="font-mono">
                {swatch.hex}
                {swatch.sample.outside_srgb ? ` (${text.contrastFallbackSuffix})` : ""}
              </span>
            ) : null}
            {activeFields.includes("rgb") ? (
              <span className="break-words font-mono">{swatch.rgbText}</span>
            ) : null}
            {activeFields.includes("oklch") ? (
              <span className="break-words font-mono">{swatch.oklchText}</span>
            ) : null}
            {activeFields.includes("contrast-white") ? (
              <span className="font-mono">
                {text.contrastWhiteShort} {formatContrast(swatch.contrastWhite)}
                {swatch.sample.outside_srgb ? ` ${text.contrastFallbackSuffix}` : ""}
              </span>
            ) : null}
            {activeFields.includes("contrast-black") ? (
              <span className="font-mono">
                {text.contrastBlackShort} {formatContrast(swatch.contrastBlack)}
                {swatch.sample.outside_srgb ? ` ${text.contrastFallbackSuffix}` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
      </button>
    );
  };

  return (
    <section
      aria-label={text.workspaceLabel}
      data-palette-state={unavailable ? "unavailable" : saving ? "saving" : hasChanges ? "dirty" : saved ? "saved" : "draft"}
      onKeyDown={handleWorkspaceKeyDown}
      className="w-full rounded-control border border-border bg-card text-foreground text-sm leading-[1.45]"
    >
      {/* Status & Live Region */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {validationError ??
          status?.message ??
          (copiedFeedback
            ? formatCopy(text.copiedValue, { value: copiedFeedback })
            : "")}
      </div>

      {/* Top Action & Interchange Bar */}
      <div
        role="toolbar"
        aria-label={text.toolbarLabel}
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs font-medium",
              unavailable
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : hasChanges
                  ? "border-border bg-muted text-foreground"
                  : "border-border bg-background text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                unavailable
                  ? "bg-destructive"
                  : hasChanges
                    ? "bg-accent"
                    : "bg-muted-foreground"
              )}
              aria-hidden="true"
            />
            {persistenceBadgeText}
          </span>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUndo}
              onClick={() => restoreHistory(onUndo)}
              data-palette-action="undo"
              aria-label={text.actionUndo}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span>{text.actionUndo}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canRedo}
              onClick={() => restoreHistory(onRedo)}
              data-palette-action="redo"
              aria-label={text.actionRedo}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              <Redo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span>{text.actionRedo}</span>
            </Button>
            <Button
              ref={resetTriggerRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setResetConfirmOpen((prev) => !prev)}
              aria-expanded={resetConfirmOpen}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              <span>{text.actionReset}</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={importTriggerRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setImportError(null);
              setImportOpen(true);
            }}
            className="min-h-[44px] sm:min-h-[36px]"
          >
            <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            <span>{text.actionImport}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onExport("json")}
            className="min-h-[44px] sm:min-h-[36px]"
          >
            <FileJson className="mr-1.5 h-4 w-4" aria-hidden="true" />
            <span>{text.actionExportJson}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onExport("css")}
            className="min-h-[44px] sm:min-h-[36px]"
          >
            <FileCode2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            <span>{text.actionExportCss}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCopyLink}
            className="min-h-[44px] sm:min-h-[36px]"
          >
            <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            <span>{text.actionCopyLink}</span>
          </Button>
          <Button
            type="button"
            variant="cta"
            size="sm"
            disabled={saveDisabled}
            onClick={onSave}
              data-palette-action="save"
            className="min-h-[44px] bg-accent text-accent-foreground hover:opacity-95 sm:min-h-[36px]"
          >
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            <span>{saving ? text.actionSaving : text.actionSave}</span>
          </Button>
        </div>
      </div>

      {/* Reversible Reset Inline Confirmation Banner */}
      {resetConfirmOpen ? (
        <div
          role="region"
          aria-label={text.resetConfirmTitle}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-3 py-2.5 sm:px-4"
        >
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">
              {text.resetConfirmTitle}
            </span>
            <span className="text-xs text-muted-foreground">
              {text.resetConfirmDescription}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setResetConfirmOpen(false);
                resetTriggerRef.current?.focus();
              }}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {text.actionCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                clearAllDrafts();
                setResetConfirmOpen(false);
                onReset();
                resetTriggerRef.current?.focus();
              }}
              className="min-h-[44px] sm:min-h-[36px]"
            >
              {text.resetConfirmAction}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Parent Status & Local Validation Banner */}
      {status || validationError ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs sm:px-4",
            validationError || status?.tone === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-muted text-foreground"
          )}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{validationError ?? status?.message}</span>
          </div>
          {validationError ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setValidationError(null)}
              data-palette-action="dismiss-validation"
              aria-label={text.actionClose}
              className="h-7 px-2"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Main Workspace Split: Priority 1 Matrix & Swatch Inspector + Priority 2/3 Controls */}
      <div className="grid grid-cols-1 gap-4 p-3 sm:p-4 xl:grid-cols-12">
        {/* Primary Palette Matrix Region (Priority 1) */}
        <div className="flex flex-col gap-4 xl:col-span-8">
          {/* Matrix Header Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{text.matrixScrollCue}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant={!stackedMatrixView ? "secondary" : "outline"}
                size="sm"
                aria-pressed={!stackedMatrixView}
                onClick={() => setStackedMatrixView(false)}
                className="min-h-[44px] sm:min-h-[34px] text-xs"
              >
                <Columns className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {text.matrixViewScroll}
              </Button>
              <Button
                type="button"
                variant={stackedMatrixView ? "secondary" : "outline"}
                size="sm"
                aria-pressed={stackedMatrixView}
                onClick={() => setStackedMatrixView(true)}
                className="min-h-[44px] sm:min-h-[34px] text-xs"
              >
                <Rows className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {text.matrixViewStacked}
              </Button>
            </div>
          </div>

          {/* Named Vertical Scrolling Owner for Palette Swatches */}
          <div
            role="region"
            aria-label={text.matrixRegionLabel}
             data-palette-appearance={state.display.appearance}
             className="palette-preview max-h-[640px] overflow-y-auto rounded-control border border-border bg-card p-3 text-foreground sm:p-4"
          >
            {state.scales.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                {text.matrixEmptyScales}
              </p>
            ) : stackedMatrixView ? (
              /* Practical Stacked Alternative (No Horizontal Scroll Required) */
              <div
                className="flex flex-col"
                style={{ rowGap: `${state.display.scale_gap}px` }}
              >
                {state.scales.map((scale) => (
                  <div
                    key={scale.id}
                    className="rounded-control border border-border/60 p-2.5"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium break-words">
                        {scale.name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {scale.kind === "hue"
                          ? `${scale.hue}°`
                          : text.scaleNeutralTag}
                      </span>
                    </div>
                    <div
                      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
                      style={{ gap: `${state.display.step_gap}px` }}
                    >
                      {state.stops.map((stop) => {
                        const swatch = generatedStopMap
                          .get(stop.id)
                          ?.get(scale.id);
                        if (!swatch) return null;
                        return renderSwatchCell(swatch);
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : state.display.layout === "columns" ? (
              /* Columns Layout: Each Column is a Stop, Each Row is a Scale */
              <div className="overflow-x-auto pb-1">
                <div
                  className="flex flex-col min-w-max"
                  style={{ rowGap: `${state.display.scale_gap}px` }}
                >
                  <div
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: `140px repeat(${state.stops.length}, minmax(88px, 1fr))`,
                      columnGap: `${state.display.step_gap}px`,
                    }}
                  >
                    <div className="px-1 text-xs font-medium text-muted-foreground">
                      {text.scaleColumnHeader} / {text.stopColumnHeader}
                    </div>
                    {state.stops.map((stop) => (
                      <button
                        key={stop.id}
                        type="button"
                        onClick={() => {
                          setSelectedStopId(stop.id);
                          setOverviewPosition(stop.position);
                        }}
                        className={cn(
                          "min-h-[36px] rounded-control border px-2 py-1 text-left font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedStop?.id === stop.id
                            ? "border-accent bg-accent text-accent-foreground font-semibold"
                            : "border-transparent hover:border-border text-muted-foreground"
                        )}
                      >
                        <div className="truncate">{stop.name}</div>
                        <div className="text-[10px] opacity-80">
                          {formatNumber(stop.position, 3)}
                        </div>
                      </button>
                    ))}
                  </div>

                  {state.scales.map((scale) => (
                    <div
                      key={scale.id}
                      className="grid items-stretch"
                      style={{
                        gridTemplateColumns: `140px repeat(${state.stops.length}, minmax(88px, 1fr))`,
                        columnGap: `${state.display.step_gap}px`,
                      }}
                    >
                      <div className="flex flex-col justify-center pr-2">
                        <span className="break-words font-medium leading-snug">
                          {scale.name}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {scale.kind === "hue"
                            ? `${scale.hue}°`
                            : text.scaleNeutralTag}
                        </span>
                      </div>
                      {state.stops.map((stop) => {
                        const swatch = generatedStopMap
                          .get(stop.id)
                          ?.get(scale.id);
                        if (!swatch) return null;
                        return renderSwatchCell(swatch);
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Rows Layout: Each Column is a Scale, Each Row is a Stop */
              <div className="overflow-x-auto pb-1">
                <div
                  className="flex flex-col min-w-max"
                  style={{ rowGap: `${state.display.step_gap}px` }}
                >
                  <div
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: `100px repeat(${state.scales.length}, minmax(108px, 1fr))`,
                      columnGap: `${state.display.scale_gap}px`,
                    }}
                  >
                    <div className="px-1 text-xs font-medium text-muted-foreground">
                      {text.stopColumnHeader} / {text.scaleColumnHeader}
                    </div>
                    {state.scales.map((scale) => (
                      <div key={scale.id} className="px-1">
                        <div className="break-words font-medium text-xs">
                          {scale.name}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {scale.kind === "hue"
                            ? `${scale.hue}°`
                            : text.scaleNeutralTag}
                        </div>
                      </div>
                    ))}
                  </div>

                  {state.stops.map((stop) => (
                    <div
                      key={stop.id}
                      className="grid items-stretch"
                      style={{
                        gridTemplateColumns: `100px repeat(${state.scales.length}, minmax(108px, 1fr))`,
                        columnGap: `${state.display.scale_gap}px`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStopId(stop.id);
                          setOverviewPosition(stop.position);
                        }}
                        className={cn(
                          "flex flex-col justify-center rounded-control border px-2 py-1 text-left font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedStop?.id === stop.id
                            ? "border-accent bg-accent text-accent-foreground font-semibold"
                            : "border-transparent hover:border-border text-muted-foreground"
                        )}
                      >
                        <span className="truncate">{stop.name}</span>
                        <span className="text-[10px] opacity-80">
                          {formatNumber(stop.position, 3)}
                        </span>
                      </button>
                      {state.scales.map((scale) => {
                        const swatch = generatedStopMap
                          .get(stop.id)
                          ?.get(scale.id);
                        if (!swatch) return null;
                        return renderSwatchCell(swatch);
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Selected Swatch Readout & Exact Value Inspector */}
          <div className="rounded-control border border-border bg-background p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {text.inspectorTitle}
              </h3>
              {activeInspectorSwatch?.sample.outside_srgb ? (
                <span className="inline-flex items-center gap-1.5 rounded-control border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                  <span
                    className="h-2 w-2 rotate-45 bg-accent"
                    aria-hidden="true"
                  />
                  {text.p3Badge} — {text.p3BadgeTitle}
                </span>
              ) : null}
            </div>

            {!activeInspectorSwatch ? (
              <p className="text-xs text-muted-foreground">
                {text.inspectorEmpty}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center gap-3 rounded-control border border-border p-2.5">
                  <div
                    className="h-11 w-11 shrink-0 rounded-control border border-border"
                    style={{ backgroundColor: activeInspectorSwatch.cssColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {activeInspectorSwatch.scale.name} ·{" "}
                      {activeInspectorSwatch.stop.name}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {text.inspectorPosition}:{" "}
                      {formatNumber(activeInspectorSwatch.stop.position, 4)}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {text.inspectorGamut}:{" "}
                      {activeInspectorSwatch.sample.rgb.space === "display-p3"
                        ? text.gamutDisplayP3
                        : text.gamutSrgb}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between rounded-control border border-border p-2.5">
                  <span className="text-xs text-muted-foreground">
                    {activeInspectorSwatch.sample.outside_srgb
                      ? text.inspectorHexSrgbFallback
                      : text.inspectorHex}
                  </span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="font-mono text-xs font-semibold">
                      {activeInspectorSwatch.hex}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyValueToClipboard(activeInspectorSwatch.hex)
                      }
                      aria-label={formatCopy(text.actionCopyValue, {
                        name: text.inspectorHex,
                        value: activeInspectorSwatch.hex,
                      })}
                      className="h-8 w-8 p-0"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col justify-between rounded-control border border-border p-2.5">
                  <span className="text-xs text-muted-foreground">
                    {text.inspectorRgb}
                  </span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="break-words font-mono text-xs">
                      {activeInspectorSwatch.rgbText}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyValueToClipboard(activeInspectorSwatch.rgbText)
                      }
                      aria-label={formatCopy(text.actionCopyValue, {
                        name: text.inspectorRgb,
                        value: activeInspectorSwatch.rgbText,
                      })}
                      className="h-8 w-8 shrink-0 p-0"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  {activeInspectorSwatch.sample.outside_srgb ? (
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {text.inspectorSrgbFallbackRgb}:{" "}
                      {activeInspectorSwatch.srgbFallbackText}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col justify-between rounded-control border border-border p-2.5">
                  <span className="text-xs text-muted-foreground">
                    {text.inspectorOklch}
                  </span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="break-words font-mono text-xs">
                      {activeInspectorSwatch.oklchText}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyValueToClipboard(activeInspectorSwatch.oklchText)
                      }
                      aria-label={formatCopy(text.actionCopyValue, {
                        name: text.inspectorOklch,
                        value: activeInspectorSwatch.oklchText,
                      })}
                      className="h-8 w-8 shrink-0 p-0"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                    <span>
                      {text.inspectorContrastWhite}:{" "}
                      {formatContrast(activeInspectorSwatch.contrastWhite)}
                    </span>
                    <span>
                      {text.inspectorContrastBlack}:{" "}
                      {formatContrast(activeInspectorSwatch.contrastBlack)}
                    </span>
                    {activeInspectorSwatch.sample.outside_srgb ? (
                      <span>({text.inspectorContrastSrgbFallbackNote})</span>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Stop Sampling & 0-1 Axis Control Card (Priority 2) */}
          <div className="rounded-control border border-border bg-background p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {text.stopsSectionTitle}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={state.stops.length >= PALETTE_LIMITS.stops}
                  onClick={handleAddStop}
                  className="min-h-[44px] sm:min-h-[34px]"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {text.stopAddButton}
                </Button>
                {selectedStop ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={state.stops.length <= 2}
                    onClick={() => handleRemoveStop(selectedStop.id)}
                    className="min-h-[44px] sm:min-h-[34px]"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {text.stopRemoveButton}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${baseId}-distribution`}
                  className="text-xs font-medium text-foreground"
                >
                  {text.distributionLabel}
                </label>
                <select
                  id={`${baseId}-distribution`}
                  value={state.distribution}
                  onChange={(e) =>
                    handleDistributionChange(
                      e.target.value
                    )
                  }
                  className="min-h-[44px] sm:min-h-[36px] rounded-control border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {PALETTE_DISTRIBUTIONS.map((dist) => (
                    <option key={dist} value={dist}>
                      {getDistributionLabel(dist)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${baseId}-stop-count`}
                  className="text-xs font-medium text-foreground"
                >
                  {text.stopCountLabel}
                </label>
                <Input
                  id={`${baseId}-stop-count`}
                  aria-invalid={invalidDrafts.has("stop-count")}
                  type="number"
                  min={2}
                  max={PALETTE_LIMITS.stops}
                  step={1}
                  value={draftInputs["stop-count"] ?? String(state.stops.length)}
                  onChange={(e) => setDraftValue("stop-count", e.target.value)}
                  onBlur={(e) => commitStopCount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="min-h-[44px] sm:min-h-[36px] font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${baseId}-range-start`}
                  className="text-xs font-medium text-foreground"
                >
                  {text.rangeStartLabel}
                </label>
                <Input
                  id={`${baseId}-range-start`}
                  aria-invalid={invalidDrafts.has("range-start")}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={
                    draftInputs["range-start"] ??
                    String(state.range.start)
                  }
                  onChange={(e) => setDraftValue("range-start", e.target.value)}
                  onBlur={(e) => commitRangeEdge("start", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="min-h-[44px] sm:min-h-[36px] font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${baseId}-range-end`}
                  className="text-xs font-medium text-foreground"
                >
                  {text.rangeEndLabel}
                </label>
                <Input
                  id={`${baseId}-range-end`}
                  aria-invalid={invalidDrafts.has("range-end")}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={
                    draftInputs["range-end"] ?? String(state.range.end)
                  }
                  onChange={(e) => setDraftValue("range-end", e.target.value)}
                  onBlur={(e) => commitRangeEdge("end", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="min-h-[44px] sm:min-h-[36px] font-mono"
                />
              </div>
            </div>

            {/* Interactive 0..1 Stop Position Axis */}
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{text.axisLabel}</span>
                <span>{text.axisInstructions}</span>
              </div>
              <div className="overflow-x-auto px-6" role="region" aria-label={text.axisLabel}>
              <div
                ref={axisTrackRef}
                role="group"
                aria-label={text.axisLabel}
                style={{ minWidth: state.stops.length * 64 }}
                className="relative my-2 h-12 w-full select-none rounded-control border border-border bg-muted px-2"
              >
                {/* Active Range Highlight */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded bg-foreground/15"
                  style={{
                    left: `${state.range.start * 100}%`,
                    width: `${(state.range.end - state.range.start) * 100}%`,
                  }}
                />
                {/* Tick Labels 0, 0.25, 0.5, 0.75, 1 */}
                {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
                  <span
                    key={tick}
                    aria-hidden="true"
                    style={{ left: `${tick * 100}%` }}
                    className="pointer-events-none absolute bottom-0.5 -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
                  >
                    {tick}
                  </span>
                ))}

                {/* Draggable + Keyboard Operable Stop Handles */}
                {state.stops.map((stop, idx) => {
                  const isCurrent = selectedStop?.id === stop.id;
                  return (
                    <button
                      key={stop.id}
                      type="button"
                      aria-label={formatCopy(text.stopHandleLabel, {
                        name: stop.name,
                        value: formatNumber(stop.position, 3),
                      })}
                      aria-pressed={isCurrent}
                      onPointerDown={(e) =>
                        handleStopHandlePointerDown(e, stop, idx)
                      }
                      onPointerMove={handleStopHandlePointerMove}
                      onPointerUp={handleStopHandlePointerUp}
                      onPointerCancel={handleStopHandlePointerCancel}
                      onKeyDown={(e) => handleStopHandleKeyDown(e, idx)}
                      onClick={() => {
                        setSelectedStopId(stop.id);
                        setOverviewPosition(stop.position);
                      }}
                      style={{ left: `${stop.position * 100}%` }}
                      className={cn(
                        "absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isCurrent ? "z-20" : "z-10"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-6 min-w-[24px] items-center justify-center rounded-full border px-1 font-mono text-[10px] font-semibold shadow-sm transition-transform",
                          isCurrent
                            ? "scale-110 border-accent bg-accent text-accent-foreground"
                            : "border-border bg-card text-foreground hover:border-foreground"
                        )}
                      >
                        {stop.name}
                      </span>
                    </button>
                  );
                })}
              </div>
              </div>
            </div>

            {/* Selected Stop Exact Editor & Stop Selector Pills */}
            {selectedStop ? (
              <div className="mt-3 rounded-control border border-border bg-card p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {text.selectedStopTitle}: {selectedStop.name}
                  </span>
                  <div
                    role="group"
                    aria-label={text.stopListLabel}
                    className="flex flex-wrap gap-1"
                  >
                    {state.stops.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        aria-pressed={st.id === selectedStop.id}
                        onClick={() => {
                          setSelectedStopId(st.id);
                          setOverviewPosition(st.position);
                        }}
                        className={cn(
                          "min-h-[44px] sm:min-h-[32px] rounded-control border px-2 py-0.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          st.id === selectedStop.id
                            ? "border-accent bg-accent text-accent-foreground font-semibold"
                            : "border-border bg-background text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {st.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`${baseId}-stop-name`}
                      className="text-xs font-medium text-foreground"
                    >
                      {text.stopNameLabel}
                    </label>
                    <Input
                      id={`${baseId}-stop-name`}
                      aria-invalid={invalidDrafts.has(`stop-name-${selectedStop.id}`)}
                      type="text"
                      value={
                        draftInputs[`stop-name-${selectedStop.id}`] ??
                        selectedStop.name
                      }
                      onChange={(e) =>
                        setDraftValue(
                          `stop-name-${selectedStop.id}`,
                          e.target.value
                        )
                      }
                      onBlur={(e) => commitStopName(selectedStop, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="min-h-[44px] sm:min-h-[36px] font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`${baseId}-stop-position`}
                      className="text-xs font-medium text-foreground"
                    >
                      {text.stopPositionLabel}
                    </label>
                    <Input
                      id={`${baseId}-stop-position`}
                      aria-invalid={invalidDrafts.has(`stop-pos-${selectedStop.id}`)}
                      type="number"
                      min={0}
                      max={1}
                      step={0.005}
                      value={
                        draftInputs[`stop-pos-${selectedStop.id}`] ??
                        String(selectedStop.position)
                      }
                      onChange={(e) =>
                        setDraftValue(
                          `stop-pos-${selectedStop.id}`,
                          e.target.value
                        )
                      }
                      onBlur={(e) =>
                        commitStopPosition(
                          selectedStop,
                          selectedStopIndex >= 0 ? selectedStopIndex : 0,
                          e.target.value
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="min-h-[44px] sm:min-h-[36px] font-mono"
                    />
                  </div>

                  <div className="flex items-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        nudgeStopPosition(
                          selectedStopIndex >= 0 ? selectedStopIndex : 0,
                          -0.01
                        )
                      }
                      aria-label={text.stopNudgeLeft}
                      className="min-h-[44px] flex-1 sm:min-h-[36px]"
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                      {text.stopNudgeLeft}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        nudgeStopPosition(
                          selectedStopIndex >= 0 ? selectedStopIndex : 0,
                          0.01
                        )
                      }
                      aria-label={text.stopNudgeRight}
                      className="min-h-[44px] flex-1 sm:min-h-[36px]"
                    >
                      {text.stopNudgeRight}
                      <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Gamut, Envelope & Continuous All-Hues Overview (Feature 5) */}
          <div className="rounded-control border border-border bg-background p-3 sm:p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {text.gamutSectionTitle}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${baseId}-gamut`}
                  className="text-xs font-medium text-foreground"
                >
                  {text.gamutLabel}
                </label>
                <select
                  id={`${baseId}-gamut`}
                  value={state.gamut}
                  onChange={(e) =>
                    tryCommitState({
                      ...state,
                      gamut: e.target.value,
                    })
                  }
                  className="min-h-[44px] sm:min-h-[36px] rounded-control border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="srgb">{text.gamutSrgb}</option>
                  <option value="display-p3">{text.gamutDisplayP3}</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${baseId}-envelope`}
                  className="text-xs font-medium text-foreground"
                >
                  {text.envelopeLabel}
                </label>
                <select
                  id={`${baseId}-envelope`}
                  value={state.envelope}
                  onChange={(e) =>
                    tryCommitState({
                      ...state,
                      envelope: e.target.value,
                    })
                  }
                  className="min-h-[44px] sm:min-h-[36px] rounded-control border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="selected-hues">
                    {text.envelopeSelectedHues}
                  </option>
                  <option value="all-hues">{text.envelopeAllHues}</option>
                </select>
              </div>
            </div>

            {/* Continuous All-Hues 0-360° Spectrum Overview using sampleScale & oklchToRgb */}
            <div className="mt-4 rounded-control border border-border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    {text.allHuesOverviewTitle}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {text.allHuesOverviewDescription}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`${baseId}-overview-pos`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.allHuesPositionLabel}:{" "}
                    <span className="font-mono">
                      {formatNumber(overviewPosition, 3)}
                    </span>
                  </label>
                  <input
                    id={`${baseId}-overview-pos`}
                    type="range"
                    min={state.range.start}
                    max={state.range.end}
                    step={0.01}
                    value={overviewPosition}
                    onChange={(e) =>
                      setOverviewPosition(Number(e.target.value))
                    }
                    className="h-6 w-28 accent-accent"
                  />
                </div>
              </div>

              <div
                role="group"
                aria-label={text.allHuesSpectrumLabel}
                className="grid grid-cols-6 gap-1.5 sm:grid-cols-9 md:grid-cols-18"
              >
                {allHuesOverviewCells.map((cell) => (
                  <div
                    key={cell.hue}
                    style={{ backgroundColor: cell.cssColor }}
                    className={cn(
                      "flex min-h-[44px] flex-col items-center justify-between rounded border border-border/60 p-1 font-mono text-[10px]",
                      cell.useLightForeground ? "text-white" : "text-black"
                    )}
                  >
                    <span>{cell.hue}°</span>
                    {cell.outsideSrgb ? (
                      <span className="rounded bg-black/40 px-1 text-[9px] text-white">
                        {text.p3Badge}
                      </span>
                    ) : (
                      <span className="opacity-75">
                        {roundTo(cell.oklch.c, 2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Control Column: Curve, Scales, Exact Brand Anchors, Display Settings */}
        <div className="flex flex-col gap-4 xl:col-span-4">
          {/* Chroma & Lightness Curve Controls (Feature 4) */}
          <div className="rounded-control border border-border bg-background p-3 sm:p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {text.curveSectionTitle}
            </h3>

            <div className="flex flex-col gap-3">
              {/* Curve Kind: Even vs Bell */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${baseId}-curve-kind`}
                  className="text-xs font-medium text-foreground"
                >
                  {text.curveKindLabel}
                </label>
                <select
                  id={`${baseId}-curve-kind`}
                  value={state.curve.kind}
                  onChange={(e) =>
                    tryCommitState({
                      ...state,
                      curve: {
                        ...state.curve,
                        kind: e.target.value,
                      },
                    })
                  }
                  className="min-h-[44px] sm:min-h-[36px] rounded-control border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="even">{text.curveKindEven}</option>
                  <option value="bell">{text.curveKindBell}</option>
                </select>
              </div>

              {/* Chroma Amount Displayed as Percent (state.amount = percent / 100) */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={`${baseId}-curve-amount`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.chromaAmountLabel} (%)
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatNumber(state.curve.amount * 100, 1)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={text.chromaAmountLabel}
                    type="range"
                    min={0}
                    max={400}
                    step={1}
                    value={roundTo(state.curve.amount * 100, 1)}
                    onPointerDown={startSliderGesture}
                    onPointerUp={finishSliderGesture}
                    onPointerCancel={cancelActiveGesture}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      updateSliderGesturePreview({
                        ...state,
                        curve: {
                          ...state.curve,
                          amount: roundTo(pct / 100, 4),
                        },
                      });
                    }}
                    className="h-6 flex-1 accent-accent"
                  />
                  <Input
                    id={`${baseId}-curve-amount`}
                    aria-invalid={invalidDrafts.has("curve-amountPct")}
                    type="number"
                    min={0}
                    max={400}
                    step={1}
                    value={
                      draftInputs["curve-amountPct"] ??
                      String(state.curve.amount * 100)
                    }
                    onChange={(e) =>
                      setDraftValue("curve-amountPct", e.target.value)
                    }
                    onBlur={(e) =>
                      commitCurveField("amountPct", e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="w-24 min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>
              </div>

              {/* Curve Width (0.01..1) */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={`${baseId}-curve-width`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.curveWidthLabel}
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatNumber(state.curve.width, 3)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={text.curveWidthLabel}
                    type="range"
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={state.curve.width}
                    onPointerDown={startSliderGesture}
                    onPointerUp={finishSliderGesture}
                    onPointerCancel={cancelActiveGesture}
                    onChange={(e) =>
                      updateSliderGesturePreview({
                        ...state,
                        curve: {
                          ...state.curve,
                          width: roundTo(Number(e.target.value), 4),
                        },
                      })
                    }
                    className="h-6 flex-1 accent-accent"
                  />
                  <Input
                    id={`${baseId}-curve-width`}
                    aria-invalid={invalidDrafts.has("curve-width")}
                    type="number"
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={
                      draftInputs["curve-width"] ??
                      String(state.curve.width)
                    }
                    onChange={(e) =>
                      setDraftValue("curve-width", e.target.value)
                    }
                    onBlur={(e) => commitCurveField("width", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="w-24 min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>
              </div>

              {/* Curve Softness (0.1..8) */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={`${baseId}-curve-softness`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.curveSoftnessLabel}
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatNumber(state.curve.softness, 3)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={text.curveSoftnessLabel}
                    type="range"
                    min={0.1}
                    max={8}
                    step={0.1}
                    value={state.curve.softness}
                    onPointerDown={startSliderGesture}
                    onPointerUp={finishSliderGesture}
                    onPointerCancel={cancelActiveGesture}
                    onChange={(e) =>
                      updateSliderGesturePreview({
                        ...state,
                        curve: {
                          ...state.curve,
                          softness: roundTo(Number(e.target.value), 4),
                        },
                      })
                    }
                    className="h-6 flex-1 accent-accent"
                  />
                  <Input
                    id={`${baseId}-curve-softness`}
                    aria-invalid={invalidDrafts.has("curve-softness")}
                    type="number"
                    min={0.1}
                    max={8}
                    step={0.1}
                    value={
                      draftInputs["curve-softness"] ??
                      String(state.curve.softness)
                    }
                    onChange={(e) =>
                      setDraftValue("curve-softness", e.target.value)
                    }
                    onBlur={(e) => commitCurveField("softness", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="w-24 min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>
              </div>

              {/* Independent Light End & Dark End Controls (0..1) */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${baseId}-curve-light-end`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.curveLightEndLabel}
                  </label>
                  <Input
                    id={`${baseId}-curve-light-end`}
                    aria-invalid={invalidDrafts.has("curve-light_end")}
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={
                      draftInputs["curve-light_end"] ??
                      String(state.curve.light_end)
                    }
                    onChange={(e) =>
                      setDraftValue("curve-light_end", e.target.value)
                    }
                    onBlur={(e) =>
                      commitCurveField("light_end", e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${baseId}-curve-dark-end`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.curveDarkEndLabel}
                  </label>
                  <Input
                    id={`${baseId}-curve-dark-end`}
                    aria-invalid={invalidDrafts.has("curve-dark_end")}
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={
                      draftInputs["curve-dark_end"] ??
                      String(state.curve.dark_end)
                    }
                    onChange={(e) =>
                      setDraftValue("curve-dark_end", e.target.value)
                    }
                    onBlur={(e) => commitCurveField("dark_end", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>
              </div>

              {/* Endpoint Lightness Light & Dark (0..1, light >= dark) */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${baseId}-lightness-light`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.lightnessLightLabel}
                  </label>
                  <Input
                    id={`${baseId}-lightness-light`}
                    aria-invalid={invalidDrafts.has("curve-lightness_light")}
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={
                      draftInputs["curve-lightness_light"] ??
                      String(state.curve.lightness.light)
                    }
                    onChange={(e) =>
                      setDraftValue("curve-lightness_light", e.target.value)
                    }
                    onBlur={(e) =>
                      commitCurveField("lightness_light", e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${baseId}-lightness-dark`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.lightnessDarkLabel}
                  </label>
                  <Input
                    id={`${baseId}-lightness-dark`}
                    aria-invalid={invalidDrafts.has("curve-lightness_dark")}
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={
                      draftInputs["curve-lightness_dark"] ??
                      String(state.curve.lightness.dark)
                    }
                    onChange={(e) =>
                      setDraftValue("curve-lightness_dark", e.target.value)
                    }
                    onBlur={(e) =>
                      commitCurveField("lightness_dark", e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Scales Editor: Hue Scales + Neutral Scale (Feature 8) */}
          <div className="rounded-control border border-border bg-background p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {text.scalesSectionTitle}
              </h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={state.scales.length >= PALETTE_LIMITS.scales}
                  onClick={handleAddHueScale}
                  className="min-h-[44px] sm:min-h-[34px] text-xs"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {text.addHueScaleButton}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    !hasNeutralScale &&
                    state.scales.length >= PALETTE_LIMITS.scales
                  }
                  onClick={handleToggleNeutralScale}
                  className="min-h-[44px] sm:min-h-[34px] text-xs"
                >
                  {hasNeutralScale
                    ? text.removeNeutralScaleButton
                    : text.addNeutralScaleButton}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              {state.scales.map((scale) => (
                <div
                  key={scale.id}
                  className="flex flex-col gap-2 rounded-control border border-border bg-card p-2.5"
                >
                  <div className="flex items-end gap-2">
                    <div className="flex flex-1 flex-col gap-1">
                      <label
                        htmlFor={`${baseId}-scale-name-${scale.id}`}
                        className="text-xs font-medium text-foreground"
                      >
                        {text.scaleNameLabel}
                      </label>
                      <Input
                        id={`${baseId}-scale-name-${scale.id}`}
                        aria-invalid={invalidDrafts.has(`scale-name-${scale.id}`)}
                        type="text"
                        value={
                          draftInputs[`scale-name-${scale.id}`] ?? scale.name
                        }
                        onChange={(e) =>
                          setDraftValue(
                            `scale-name-${scale.id}`,
                            e.target.value
                          )
                        }
                        onBlur={(e) => commitScaleName(scale, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        className="min-h-[44px] sm:min-h-[34px]"
                      />
                    </div>

                    {scale.kind === "hue" ? (
                      <div className="flex w-28 flex-col gap-1">
                        <label
                          htmlFor={`${baseId}-scale-hue-${scale.id}`}
                          className="text-xs font-medium text-foreground"
                        >
                          {text.scaleHueLabel}
                        </label>
                        <Input
                          id={`${baseId}-scale-hue-${scale.id}`}
                          aria-invalid={invalidDrafts.has(`scale-hue-${scale.id}`)}
                          type="number"
                          min={0}
                          max={360}
                          step={1}
                          value={
                            draftInputs[`scale-hue-${scale.id}`] ??
                            String(scale.hue)
                          }
                          onChange={(e) =>
                            setDraftValue(
                              `scale-hue-${scale.id}`,
                              e.target.value
                            )
                          }
                          onBlur={(e) => commitScaleHue(scale, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          className="min-h-[44px] sm:min-h-[34px] font-mono"
                        />
                      </div>
                    ) : (
                      <span className="inline-flex min-h-[34px] items-center rounded-control border border-border bg-muted px-2.5 font-mono text-xs text-muted-foreground">
                        {text.scaleNeutralTag}
                      </span>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={state.scales.length <= 1}
                      onClick={() => handleRemoveScale(scale.id)}
                      aria-label={formatCopy(text.scaleRemoveButton, {
                        name: scale.name,
                      })}
                      className="min-h-[44px] w-10 p-0 sm:min-h-[34px]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Exact Brand Anchors (Separate from Generated Scales, Explicit sRGB/P3 & Channels) */}
          <div className="rounded-control border border-border bg-background p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {text.anchorsSectionTitle}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {text.anchorsDescription}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={state.anchors.length >= PALETTE_LIMITS.anchors}
                onClick={handleAddAnchor}
                    data-palette-action="add-anchor"
                className="min-h-[44px] sm:min-h-[34px] text-xs"
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {text.addAnchorButton}
              </Button>
            </div>

            {evaluatedAnchors.length === 0 ? (
              <p className="rounded-control border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                {text.anchorEmptyState}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {evaluatedAnchors.map((item) => {
                  const { anchor } = item;
                  const isP3 = anchor.color.space === "display-p3";
                  return (
                    <div
                      key={anchor.id}
                      className="flex flex-col gap-2.5 rounded-control border border-border bg-card p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div
                            className="h-9 w-9 shrink-0 rounded-control border border-border"
                            style={{ backgroundColor: item.cssColor }}
                          />
                          <div className="min-w-0 flex-1">
                            <label
                              htmlFor={`${baseId}-anchor-name-${anchor.id}`}
                              className="sr-only"
                            >
                              {text.anchorNameLabel}
                            </label>
                            <Input
                              id={`${baseId}-anchor-name-${anchor.id}`}
                              aria-invalid={invalidDrafts.has(`anchor-name-${anchor.id}`)}
                              type="text"
                              value={
                                draftInputs[`anchor-name-${anchor.id}`] ??
                                anchor.name
                              }
                              onChange={(e) =>
                                setDraftValue(
                                  `anchor-name-${anchor.id}`,
                                  e.target.value
                                )
                              }
                              onBlur={(e) =>
                                commitAnchorName(anchor, e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              className="min-h-[44px] sm:min-h-[34px]"
                            />
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveAnchor(anchor.id)}
                          aria-label={formatCopy(text.anchorRemoveButton, {
                            name: anchor.name,
                          })}
                          className="min-h-[44px] w-10 p-0 sm:min-h-[34px]"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`${baseId}-anchor-space-${anchor.id}`}
                            className="text-xs font-medium text-foreground"
                          >
                            {text.anchorSpaceLabel}
                          </label>
                          <select
                            id={`${baseId}-anchor-space-${anchor.id}`}
                            value={anchor.color.space}
                            onChange={(e) =>
                              handleAnchorSpaceChange(
                                anchor,
                                e.target.value
                              )
                            }
                            className="min-h-[44px] sm:min-h-[34px] rounded-control border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="srgb">{text.gamutSrgb}</option>
                            <option value="display-p3">
                              {text.gamutDisplayP3}
                            </option>
                          </select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`${baseId}-anchor-hex-${anchor.id}`}
                            className="text-xs font-medium text-foreground"
                          >
                            {text.anchorHexLabel}
                          </label>
                          {isP3 ? (
                            <div
                              id={`${baseId}-anchor-hex-${anchor.id}`}
                              aria-invalid={invalidDrafts.has(`anchor-hex-${anchor.id}`)}
                              className="flex min-h-[44px] sm:min-h-[34px] items-center rounded-control border border-border bg-muted px-2 font-mono text-[11px] text-muted-foreground"
                            >
                              {text.anchorHexUnavailableP3} ({item.hex})
                            </div>
                          ) : (
                            <Input
                              id={`${baseId}-anchor-hex-${anchor.id}`}
                              type="text"
                              value={
                                draftInputs[`anchor-hex-${anchor.id}`] ??
                                item.hex
                              }
                              onChange={(e) =>
                                setDraftValue(
                                  `anchor-hex-${anchor.id}`,
                                  e.target.value
                                )
                              }
                              onBlur={(e) =>
                                commitAnchorHex(anchor, e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              className="min-h-[44px] sm:min-h-[34px] font-mono text-xs"
                            />
                          )}
                        </div>
                      </div>

                      {/* Explicit 0..1 RGB Channel Inputs for Exact sRGB or Display P3 Representation */}
                      <div className="grid grid-cols-3 gap-2">
                        {(["r", "g", "b"] as const).map((ch) => {
                          const label =
                            ch === "r"
                              ? text.anchorChannelRLabel
                              : ch === "g"
                                ? text.anchorChannelGLabel
                                : text.anchorChannelBLabel;
                          return (
                            <div key={ch} className="flex flex-col gap-1">
                              <label
                                htmlFor={`${baseId}-anchor-${ch}-${anchor.id}`}
                                className="text-xs font-medium text-foreground"
                              >
                                {label}
                              </label>
                              <Input
                                id={`${baseId}-anchor-${ch}-${anchor.id}`}
                                aria-invalid={invalidDrafts.has(`anchor-${ch}-${anchor.id}`)}
                                type="number"
                                min={0}
                                max={1}
                                step={0.005}
                                value={
                                  draftInputs[`anchor-${ch}-${anchor.id}`] ??
                                  String(anchor.color[ch])
                                }
                                onChange={(e) =>
                                  setDraftValue(
                                    `anchor-${ch}-${anchor.id}`,
                                    e.target.value
                                  )
                                }
                                onBlur={(e) =>
                                  commitAnchorChannel(
                                    anchor,
                                    ch,
                                    e.target.value
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                }}
                                className="min-h-[44px] sm:min-h-[34px] font-mono text-xs"
                              />
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-1.5 font-mono text-[11px] text-muted-foreground">
                        <span>{item.rgbText}</span>
                        <span>{item.oklchText}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Display, Appearance & Swatch Information Fields (Features 6 & 7) */}
          <div className="rounded-control border border-border bg-background p-3 sm:p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {text.displaySectionTitle}
            </h3>

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${baseId}-display-layout`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.layoutLabel}
                  </label>
                  <select
                    id={`${baseId}-display-layout`}
                    value={state.display.layout}
                    onChange={(e) =>
                      tryCommitState({
                        ...state,
                        display: {
                          ...state.display,
                          layout: e.target.value,
                        },
                      })
                    }
                    className="min-h-[44px] sm:min-h-[36px] rounded-control border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="columns">{text.layoutColumns}</option>
                    <option value="rows">{text.layoutRows}</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${baseId}-display-appearance`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.appearanceLabel}
                  </label>
                  <select
                    id={`${baseId}-display-appearance`}
                    value={state.display.appearance}
                    onChange={(e) =>
                      tryCommitState({
                        ...state,
                        display: {
                          ...state.display,
                          appearance: e.target.value,
                        },
                      })
                    }
                    className="min-h-[44px] sm:min-h-[36px] rounded-control border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="light">{text.appearanceLight}</option>
                    <option value="dark">{text.appearanceDark}</option>
                    <option value="system">{text.appearanceSystem}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${baseId}-scale-gap`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.scaleGapLabel}
                  </label>
                  <Input
                    id={`${baseId}-scale-gap`}
                    aria-invalid={invalidDrafts.has("display-scale_gap")}
                    type="number"
                    min={0}
                    max={128}
                    step={1}
                    value={
                      draftInputs["display-scale_gap"] ??
                      String(state.display.scale_gap)
                    }
                    onChange={(e) =>
                      setDraftValue("display-scale_gap", e.target.value)
                    }
                    onBlur={(e) =>
                      commitDisplayGap("scale_gap", e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${baseId}-step-gap`}
                    className="text-xs font-medium text-foreground"
                  >
                    {text.stepGapLabel}
                  </label>
                  <Input
                    id={`${baseId}-step-gap`}
                    aria-invalid={invalidDrafts.has("display-step_gap")}
                    type="number"
                    min={0}
                    max={128}
                    step={1}
                    value={
                      draftInputs["display-step_gap"] ??
                      String(state.display.step_gap)
                    }
                    onChange={(e) =>
                      setDraftValue("display-step_gap", e.target.value)
                    }
                    onBlur={(e) => commitDisplayGap("step_gap", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="min-h-[44px] sm:min-h-[36px] font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${baseId}-display-information`}
                  className="text-xs font-medium text-foreground"
                >
                  {text.informationModeLabel}
                </label>
                <select
                  id={`${baseId}-display-information`}
                  value={state.display.information}
                  onChange={(e) =>
                    tryCommitState({
                      ...state,
                      display: {
                        ...state.display,
                        information: e.target.value,
                      },
                    })
                  }
                  className="min-h-[44px] sm:min-h-[36px] rounded-control border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="hover">{text.informationHover}</option>
                  <option value="always">{text.informationAlways}</option>
                </select>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium text-foreground">
                  {text.visibleFieldsLabel}
                </legend>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {DISPLAY_FIELDS.map((field) => {
                    const checked = state.display.fields.includes(field);
                    const checkId = `${baseId}-field-${field}`;
                    return (
                      <label
                        key={field}
                        htmlFor={checkId}
                        className={cn(
                          "flex min-h-[44px] sm:min-h-[34px] cursor-pointer items-center gap-2 rounded-control border px-2.5 py-1 text-xs transition-colors",
                          checked
                            ? "border-accent bg-accent/10 text-foreground font-medium"
                            : "border-border bg-card text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <input
                          id={checkId}
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDisplayField(field)}
                          className="h-4 w-4 rounded border-input accent-accent"
                        />
                        <span>{getFieldLabel(field)}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </div>
        </div>
      </div>

      {/* Import JSON Dialog (Using Supplied Radix Dialog Primitive) */}
      <Dialog
        open={importOpen}
        onOpenChange={(nextOpen) => {
          setImportOpen(nextOpen);
          if (!nextOpen) {
            setImportError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{text.importDialogTitle}</DialogTitle>
            <DialogDescription>
              {text.importDialogDescription}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleImportSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${baseId}-import-file`}
                className="text-xs font-medium text-foreground"
              >
                {text.importFileLabel}
              </label>
              <Input
                id={`${baseId}-import-file`}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFileChange}
                className="min-h-[44px] sm:min-h-[36px]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${baseId}-import-textarea`}
                className="text-xs font-medium text-foreground"
              >
                {text.importJsonTextareaLabel}
              </label>
              <textarea
                id={`${baseId}-import-textarea`}
                rows={8}
                value={importDraft}
                onChange={(e) => {
                  setImportDraft(e.target.value);
                  setImportError(null);
                }}
                className="w-full rounded-control border border-input bg-background p-2.5 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {importError ? (
              <div
                role="alert"
                className="rounded-control border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {importError}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setImportOpen(false);
                  importTriggerRef.current?.focus();
                }}
                className="min-h-[44px] sm:min-h-[36px]"
              >
                {text.actionCancel}
              </Button>
              <Button
                type="submit"
                variant="cta"
                size="sm"
                className="min-h-[44px] bg-accent text-accent-foreground sm:min-h-[36px]"
              >
                {text.importSubmitButton}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
