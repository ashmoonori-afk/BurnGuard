/**
 * Logo project helpers (doc/23 D3/D9). A logo project has no persisted canvas:
 * every artboard the turn writes - the candidate sheet and every guidelines page -
 * is the constant page of the shared contract, so the existing graphic preview and
 * frame navigator work by being handed that constant.
 */
import {
  LOGO_ACTION_TAG,
  LOGO_PAGE,
  LOGO_TYPES,
  UpgradeContractError,
  parseLogoManifestV1,
  type GraphicCanvasV1,
  type LogoActionV1,
  type LogoManifestV1,
  type LogoRoundV1,
  type LogoType,
  type ProjectType,
} from "@bg/shared";
import type { MessageKey } from "@/i18n/t";

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
 * Regenerate and select ride the ordinary send path. The sentinel is what the
 * prompt harness reads; the Korean line after it is what the person reading the
 * transcript sees, so the turn never looks like a machine talking to itself.
 */
export function logoActionMessage(action: LogoActionV1): string {
  const sentinel = `<${LOGO_ACTION_TAG}>${JSON.stringify(action)}</${LOGO_ACTION_TAG}>`;
  const line = action.action === "regenerate"
    ? "다른 시안 4개를 새로 만들어주세요."
    : `${candidateNumber(action.candidate_id)}번 시안으로 진행해주세요.`;
  return `${sentinel}\n${line}`;
}

function candidateNumber(candidateId: string): string {
  return candidateId.replace("candidate-", "");
}
