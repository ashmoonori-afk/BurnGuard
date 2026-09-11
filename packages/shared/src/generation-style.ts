import { decodeContract, UpgradeContractError } from "./contract-parser";

export const IMAGE_STYLE_PRESETS = {
  brand: { label: "브랜드 기준", description: "선택한 디자인 시스템과 자료에 어울리는 이미지", prompt: "Follow the selected brand and supplied visual references; keep a coherent photographic or illustration treatment." },
  studio: { label: "스튜디오 제품사진", description: "정돈된 배경, 부드러운 조명, 선명한 제품 디테일", prompt: "Studio product photography with controlled soft lighting, uncluttered backgrounds, accurate materials and crisp product detail." },
  lifestyle: { label: "라이프스타일 실사", description: "자연광과 실제 사용 장면이 있는 사진", prompt: "Natural-light lifestyle photography showing plausible real usage and environments, with candid compositions and realistic materials." },
  cinematic: { label: "시네마틱", description: "영화 같은 구도, 깊이감 있는 빛과 분위기", prompt: "Cinematic photography with intentional framing, layered depth and motivated directional lighting; preserve the brand palette." },
  three_d: { label: "3D 오브젝트", description: "입체적인 형태와 재질을 강조한 렌더 이미지", prompt: "Raster 3D-style object renders with coherent materials, readable silhouettes and physically plausible lighting; do not replace requested images with code-based scenes." },
  illustration: { label: "에디토리얼 일러스트", description: "핵심 메시지를 설명하는 절제된 일러스트", prompt: "Editorial raster illustration with deliberate shapes, restrained detail and a consistent mark-making style that explains the content." },
  collage: { label: "페이퍼 콜라주", description: "종이 질감과 오려 붙인 구성을 살린 이미지", prompt: "Paper collage imagery with tactile cut edges, layered paper textures and clear focal hierarchy; use distinct compositions rather than repeating a cutout." },
} as const;

export const COPY_TONE_PRESETS = {
  brand: { label: "브랜드 기준", example: "기존 브랜드의 문장과 말투를 이어가요.", prompt: "Follow the supplied brand voice and existing approved wording consistently." },
  professional: { label: "전문적인 합니다체", example: "필요한 정보를 정확하게 안내합니다.", prompt: "Use clear, precise professional language. In Korean, use consistent 합니다체 with evidence-based claims and no inflated jargon." },
  friendly: { label: "친근한 해요체", example: "필요한 정보를 쉽게 찾아보세요.", prompt: "Use approachable, natural language. In Korean, use consistent polite 해요체; avoid childish expressions and unrequested slang." },
  concise: { label: "간결한 브랜드 카피", example: "필요한 정보. 한눈에, 정확하게.", prompt: "Use concise, concrete brand copy with short headlines and direct calls to action. Keep necessary explanations complete rather than making every sentence a fragment." },
  energetic: { label: "활기찬 제안형", example: "지금, 새로운 가능성을 만나보세요.", prompt: "Use energetic, action-oriented invitations with clear benefits; avoid excessive exclamation marks, fake urgency and unsupported promises." },
  calm: { label: "차분한 설명형", example: "선택에 필요한 내용을 차근차근 살펴보세요.", prompt: "Use calm, measured explanations with a consistent polite register, concrete details and unhurried transitions; avoid pressure and ornate filler." },
} as const;

export type GenerationStyle = {
  readonly schema_version: 1;
  readonly image_style: keyof typeof IMAGE_STYLE_PRESETS;
  readonly copy_tone: keyof typeof COPY_TONE_PRESETS;
};

export const DEFAULT_GENERATION_STYLE: GenerationStyle = { schema_version: 1, image_style: "brand", copy_tone: "brand" };

export function parseGenerationStyle(input: unknown): GenerationStyle {
  const record = decodeContract(input);
  for (const key of Object.keys(record)) if (!["schema_version", "image_style", "copy_tone"].includes(key)) throw new UpgradeContractError("invalid_field", key);
  if (record.schema_version !== 1) throw new UpgradeContractError("invalid_field", "schema_version");
  const imageStyle = record.image_style;
  const copyTone = record.copy_tone;
  if (typeof imageStyle !== "string" || !Object.hasOwn(IMAGE_STYLE_PRESETS, imageStyle)) throw new UpgradeContractError("invalid_field", "image_style");
  if (typeof copyTone !== "string" || !Object.hasOwn(COPY_TONE_PRESETS, copyTone)) throw new UpgradeContractError("invalid_field", "copy_tone");
  return { schema_version: 1, image_style: imageStyle as GenerationStyle["image_style"], copy_tone: copyTone as GenerationStyle["copy_tone"] };
}
