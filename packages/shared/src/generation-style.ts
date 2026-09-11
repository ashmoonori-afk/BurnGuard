import { decodeContract, UpgradeContractError } from "./contract-parser";
import { IMAGE_PROMPT_RECIPES, type ImageRecipe } from "./image-prompt-recipes";

export const IMAGE_STYLE_PRESETS = {
  brand: { label: "브랜드 기준", description: "선택한 디자인 시스템과 자료에 어울리는 이미지", prompt: "Follow the selected brand and supplied visual references; keep a coherent photographic or illustration treatment." },
  studio: { label: "스튜디오 제품사진", description: "정돈된 배경, 부드러운 조명, 선명한 제품 디테일", prompt: "Studio product photography with controlled soft lighting, uncluttered backgrounds, accurate materials and crisp product detail." },
  lifestyle: { label: "라이프스타일 실사", description: "자연광과 실제 사용 장면이 있는 사진", prompt: "Natural-light lifestyle photography showing plausible real usage and environments, with candid compositions and realistic materials." },
  cinematic: { label: "시네마틱", description: "영화 같은 구도, 깊이감 있는 빛과 분위기", prompt: "Cinematic photography with intentional framing, layered depth and motivated directional lighting; preserve the brand palette." },
  three_d: { label: "3D 오브젝트", description: "입체적인 형태와 재질을 강조한 렌더 이미지", prompt: "Raster 3D-style object renders with coherent materials, readable silhouettes and physically plausible lighting; do not replace requested images with code-based scenes." },
  illustration: { label: "에디토리얼 일러스트", description: "핵심 메시지를 설명하는 절제된 일러스트", prompt: "Editorial raster illustration with deliberate shapes, restrained detail and a consistent mark-making style that explains the content." },
  collage: { label: "페이퍼 콜라주", description: "종이 질감과 오려 붙인 구성을 살린 이미지", prompt: "Paper collage imagery with tactile cut edges, layered paper textures and clear focal hierarchy; use distinct compositions rather than repeating a cutout." },
  watercolor: { label: "수채화", description: "물 번짐과 종이의 밝기를 살린 투명한 색", prompt: "Build form through translucent pigment washes, controlled wet edges and exposed paper; retain focal detail without outlining every surface." },
  ink: { label: "잉크 드로잉", description: "붓의 압력, 선의 밀도와 여백이 있는 드로잉", prompt: "Use pressure-sensitive ink marks and deliberate pools of tone, with open space shaping the subject; preserve readable silhouettes." },
  oil: { label: "유화·회화", description: "붓질의 방향과 물감의 두께가 보이는 회화", prompt: "Describe volume through directional paint strokes, layered pigment and selective impasto; keep light and perspective coherent." },
  print: { label: "인쇄·판화", description: "별색과 잉크의 겹침을 활용한 그래픽", prompt: "Compose with a limited set of print separations, purposeful overprint and subtle registration variation; preserve clean focal edges and text clarity." },
  pencil: { label: "연필·크레용", description: "손으로 그린 선과 건조한 표면 질감", prompt: "Use visible pencil or wax marks that follow form, with purposeful line weight and restrained smudging; keep the drawing intentional rather than randomly distressed." },
  clay: { label: "클레이·미니어처", description: "손으로 빚은 형태와 작은 세트의 입체감", prompt: "Model a tactile miniature with softened sculpted edges, small surface variations and believable contact shadows; preserve the subject's identifying proportions." },
  glass: { label: "유리·굴절", description: "투명도, 두께와 빛의 굴절을 강조한 이미지", prompt: "Show glass thickness through edge reflections, transmission and restrained caustics; keep objects behind it optically consistent and avoid hiding the silhouette in glare." },
  metal: { label: "금속·하드 서피스", description: "금속 가공 흔적과 정돈된 반사가 있는 이미지", prompt: "Use controlled reflection bands to explain metal curvature, with plausible roughness, machined edges and small wear appropriate to the brief." },
  analog: { label: "아날로그 필름", description: "필름 입자와 절제된 색 번짐이 있는 사진", prompt: "Use restrained film grain, gentle highlight roll-off and natural exposure variation; keep the intended subject sharp enough for its final placement." },
  flash: { label: "다이렉트 플래시", description: "선명한 정면광과 대비가 있는 스냅사진", prompt: "Use a direct flash with a credible falloff, crisp subject separation and readable cast shadows; keep highlights within material limits." },
  macro: { label: "매크로 디테일", description: "표면과 작은 구조에 초점을 맞춘 근접사진", prompt: "Choose a close focus plane that reveals the relevant texture or mechanism; preserve scale cues and avoid blurring the very feature being explained." },
  monochrome: { label: "흑백·듀오톤", description: "명암과 실루엣을 강조한 제한된 색 표현", prompt: "Separate subject and setting through tonal values and deliberate edge contrast; use monochrome or the approved two-color treatment without losing material detail." },
  pixel: { label: "픽셀 아트", description: "일정한 픽셀 크기와 제한된 팔레트", prompt: "Use one consistent pixel grid, deliberate clusters and a small palette; preserve a legible silhouette and avoid mixing smooth photographic edges into the pixel artwork." },
  low_poly: { label: "로우폴리", description: "단순한 면과 빛으로 구조를 드러내는 이미지", prompt: "Describe the subject with purposeful planar facets and a coherent light source; reserve enough geometry for recognition and avoid arbitrary surface triangulation." },
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
  readonly image_recipe?: ImageRecipe;
};

export const DEFAULT_GENERATION_STYLE: GenerationStyle = { schema_version: 1, image_style: "brand", copy_tone: "brand" };

export function parseGenerationStyle(input: unknown): GenerationStyle {
  const record = decodeContract(input);
  for (const key of Object.keys(record)) if (!["schema_version", "image_style", "copy_tone", "image_recipe"].includes(key)) throw new UpgradeContractError("invalid_field", key);
  if (record.schema_version !== 1) throw new UpgradeContractError("invalid_field", "schema_version");
  const imageStyle = record.image_style;
  const copyTone = record.copy_tone;
  if (typeof imageStyle !== "string" || !Object.hasOwn(IMAGE_STYLE_PRESETS, imageStyle)) throw new UpgradeContractError("invalid_field", "image_style");
  if (typeof copyTone !== "string" || !Object.hasOwn(COPY_TONE_PRESETS, copyTone)) throw new UpgradeContractError("invalid_field", "copy_tone");
  const recipe = record.image_recipe;
  if (recipe !== undefined && (typeof recipe !== "string" || (recipe !== "auto" && !Object.hasOwn(IMAGE_PROMPT_RECIPES, recipe)))) throw new UpgradeContractError("invalid_field", "image_recipe");
  return { schema_version: 1, image_style: imageStyle as GenerationStyle["image_style"], copy_tone: copyTone as GenerationStyle["copy_tone"], ...(recipe === undefined ? {} : { image_recipe: recipe as ImageRecipe }) };
}
