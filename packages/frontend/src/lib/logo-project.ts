/**
 * Logo project helpers (doc/23 D3/D9). A logo project has no persisted canvas:
 * every artboard the turn writes - the candidate sheet and every guidelines page -
 * is the constant page of the shared contract, so the existing graphic preview and
 * frame navigator work by being handed that constant.
 */
import {
  LOGO_ACTION_TAG,
  LOGO_GEOMETRIC_TAG,
  LOGO_PAGE,
  LOGO_TYPES,
  UpgradeContractError,
  parseLogoManifestV1,
  parseLogoAction,
  type GraphicCanvasV1,
  type LogoActionV1,
  type LogoGeometricActionV1,
  type LogoManifestV1,
  type LogoRoundV1,
  type LogoType,
  type ProjectType,
} from "@bg/shared";
import { t, type MessageKey } from "@/i18n/t";

export const LOGO_CANVAS: GraphicCanvasV1 = {
  schema_version: 1,
  width: LOGO_PAGE.width,
  height: LOGO_PAGE.height,
};

export type LogoTypeChoice = {
  readonly value: LogoType;
  readonly label: MessageKey;
};

export const LOGO_TYPE_CHOICES: readonly LogoTypeChoice[] = LOGO_TYPES.map((value) => ({
  value,
  label: `home.logo.type.${value}`,
}));

export function parseProjectLogoCanvas(projectType: ProjectType): GraphicCanvasV1 | null {
  return projectType === "logo" ? LOGO_CANVAS : null;
}

/**
 * The manifest is authored by the agent, so a half-written or outdated file is
 * expected: it means "no candidates to show yet", never a broken workspace.
 */
export function parseProjectLogoManifest(json: unknown): LogoManifestV1 | null {
  try {
    return parseLogoManifestV1(json);
  } catch (error) {
    if (error instanceof UpgradeContractError) return null;
    throw error;
  }
}

/** The picker always works on the newest round; earlier rounds stay in the file as history. */
export function latestLogoRound(manifest: LogoManifestV1): LogoRoundV1 | null {
  return manifest.rounds.at(-1) ?? null;
}

/**
 * Logo actions ride the ordinary send path. The sentinel is what the
 * prompt harness reads; the localized line after it is what the person reading the
 * transcript sees, so the turn never looks like a machine talking to itself.
 */
export function logoActionMessage(action: LogoActionV1): string {
  const sentinel = `<${LOGO_ACTION_TAG}>${JSON.stringify(action)}</${LOGO_ACTION_TAG}>`;
  let line: string;
  switch (action.action) {
    case "regenerate": line = t("home.logo.regenerateLine"); break;
    case "select": line = t("home.logo.selectLine", { number: candidateNumber(action.candidate_id) }); break;
    case "ideate": line = t("logo.pipeline.ideateLine"); break;
    case "adopt": line = t("logo.pipeline.adoptLine"); break;
    default: {
      const unreachable: never = action;
      throw new TypeError(`Unknown logo action: ${unreachable}`);
    }
  }
  return `${sentinel}\n${line}`;
}

/**
 * A geometric-method action on the same send path (doc/31). The revision note rides in the sentinel
 * and is repeated in the visible line, so the transcript shows what the person asked for.
 */
export function logoGeometricActionMessage(action: LogoGeometricActionV1): string {
  const sentinel = `<${LOGO_GEOMETRIC_TAG}>${JSON.stringify(action)}</${LOGO_GEOMETRIC_TAG}>`;
  let line: string;
  switch (action.action) {
    case "answer": line = t("logo.geometric.answerLine"); break;
    case "approve": line = t("logo.geometric.approveLine"); break;
    case "revise": line = t("logo.geometric.reviseLine", { note: action.note }); break;
    default: {
      const unreachable: never = action;
      throw new TypeError(`Unknown geometric logo action: ${unreachable}`);
    }
  }
  return `${sentinel}\n${line}`;
}

/** Makes the current step again from the saved answers: a plain message, no sentinel. */
export function logoGeometricMakeMessage(): string {
  return t("logo.geometric.makeLine");
}

export function logoIdeationMessage(text: string): string {
  if (parseLogoAction(text) !== null) return text;
  return `<${LOGO_ACTION_TAG}>{"action":"ideate"}</${LOGO_ACTION_TAG}>\n${text}`;
}

function candidateNumber(candidateId: string): string {
  return candidateId.replace("candidate-", "");
}
