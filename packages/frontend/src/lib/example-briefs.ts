import type { ProjectType } from "@bg/shared";
import type { Locale } from "@/i18n/locale";
import { INITIAL_BRIEF_FORM, type BriefForm } from "@/lib/project-creation";

/** The brief that would produce one bundled example: what "See the brief" shows and "Start from this" pre-fills. */
export type ExampleBrief = {
  readonly type: Extract<ProjectType, "prototype" | "slide_deck" | "graphic">;
  readonly designSystemId: string;
  readonly name: string;
  readonly audience: string;
  readonly objective: string;
};

type Copy = Readonly<Record<Locale, string>>;
type Sample = { readonly slug: string; readonly brand: string; readonly audience: Copy; readonly web: Copy; readonly slides: Copy; readonly graphic: Copy };

const SAMPLES: readonly Sample[] = [
  { slug: "sonnel", brand: "SONNEL", audience: { en: "Musicians and sound designers looking for precise hardware", ko: "정밀한 하드웨어를 찾는 음악가와 사운드 디자이너", "zh-CN": "寻找精密硬件的音乐人和声音设计师" },
    web: { en: "A product website for a cobalt sound-synthesis lab: hero with the instrument, three feature columns, specifications and a pre-order call to action.", ko: "코발트빛 사운드 합성 연구소의 제품 웹사이트: 악기를 보여 주는 첫 화면, 기능 세 칸, 사양, 사전 주문 버튼.", "zh-CN": "一家钴蓝色声音合成实验室的产品网站：展示乐器的首屏、三栏功能、规格和预购按钮。" },
    slides: { en: "A launch deck for a sound-synthesis instrument: the problem, the instrument, how it sounds, specifications and availability.", ko: "사운드 합성 악기 출시 발표 자료: 해결하려는 문제, 악기, 소리, 사양, 구매 시기.", "zh-CN": "声音合成乐器的发布演示：要解决的问题、乐器、音色、规格和上市时间。" },
    graphic: { en: "A social launch poster for a sound-synthesis instrument with the product name, one line of copy and the release date.", ko: "제품명, 한 줄 문구, 출시일을 담은 사운드 합성 악기 SNS 출시 포스터.", "zh-CN": "包含产品名称、一句文案和发布日期的声音合成乐器社交发布海报。" } },
  { slug: "foliover", brand: "FOLIOVER", audience: { en: "Readers interested in materials, craft and culture", ko: "재료, 공예, 문화에 관심 있는 독자", "zh-CN": "对材料、工艺和文化感兴趣的读者" },
    web: { en: "A website for an independent journal of materials and culture: current issue, featured essays, archive and subscription.", ko: "재료와 문화를 다루는 독립 저널 웹사이트: 이번 호, 주요 글, 지난 호, 구독.", "zh-CN": "一本关于材料与文化的独立期刊网站：本期内容、精选文章、往期和订阅。" },
    slides: { en: "A deck presenting the new issue of an independent journal: theme, featured essays, contributors and how to subscribe.", ko: "독립 저널 새 호 소개 자료: 주제, 주요 글, 필진, 구독 방법.", "zh-CN": "介绍独立期刊新一期的演示：主题、精选文章、作者和订阅方式。" },
    graphic: { en: "A cover-style poster announcing the new issue of an independent journal with its theme and issue number.", ko: "주제와 호수를 담아 독립 저널 새 호를 알리는 표지형 포스터.", "zh-CN": "以封面形式宣布独立期刊新一期的海报，包含主题和期号。" } },
  { slug: "oddward", brand: "ODDWARD", audience: { en: "Prospective clients of an experimental creative studio", ko: "실험적인 크리에이티브 스튜디오의 예비 고객", "zh-CN": "实验性创意工作室的潜在客户" },
    web: { en: "A portfolio website for an experimental creative studio with expressive typography: selected work, services and contact.", ko: "표현력 있는 타이포그래피를 쓰는 실험적 크리에이티브 스튜디오의 포트폴리오 웹사이트: 대표 작업, 서비스, 연락처.", "zh-CN": "使用富有表现力字体的实验性创意工作室作品集网站：精选作品、服务和联系方式。" },
    slides: { en: "A credentials deck for an experimental creative studio: approach, selected projects, services and team.", ko: "실험적 크리에이티브 스튜디오 소개 자료: 작업 방식, 대표 프로젝트, 서비스, 팀.", "zh-CN": "实验性创意工作室的资历演示：工作方法、精选项目、服务和团队。" },
    graphic: { en: "A typographic poster for an experimental creative studio's open studio night.", ko: "실험적 크리에이티브 스튜디오의 오픈 스튜디오 행사 타이포그래피 포스터.", "zh-CN": "实验性创意工作室开放之夜的字体海报。" } },
  { slug: "velune", brand: "VELUNE", audience: { en: "Interior designers and homeowners choosing lighting", ko: "조명을 고르는 인테리어 디자이너와 집주인", "zh-CN": "正在挑选灯具的室内设计师和房主" },
    web: { en: "A product website for moonlit glass lighting in deep plum and opal mint: collection, materials, room views and stockists.", ko: "짙은 자두색과 오팔 민트색의 달빛 유리 조명 제품 웹사이트: 컬렉션, 소재, 공간 연출, 판매처.", "zh-CN": "深梅色与蛋白石薄荷色的月光玻璃灯具产品网站：系列、材质、空间效果和经销商。" },
    slides: { en: "A collection deck for a glass lighting brand: the collection, materials, rooms it suits and ordering.", ko: "유리 조명 브랜드 컬렉션 소개 자료: 컬렉션, 소재, 어울리는 공간, 주문 방법.", "zh-CN": "玻璃灯具品牌的系列演示：系列、材质、适合的空间和订购方式。" },
    graphic: { en: "A product poster for a new glass pendant light with the product name and one line of copy.", ko: "제품명과 한 줄 문구를 담은 새 유리 펜던트 조명 제품 포스터.", "zh-CN": "包含产品名称和一句文案的新款玻璃吊灯产品海报。" } },
  { slug: "halide", brand: "HALIDE", audience: { en: "Clients who need optical design and lens engineering", ko: "광학 설계와 렌즈 엔지니어링이 필요한 고객", "zh-CN": "需要光学设计和镜头工程的客户" },
    web: { en: "A website for an optics studio built on refracting liquid-glass rings: what the studio designs, process, selected work and a consultation request.", ko: "빛을 굴절시키는 액체 유리 고리를 상징으로 삼은 광학 스튜디오 웹사이트: 설계 분야, 작업 과정, 대표 작업, 상담 요청.", "zh-CN": "以折射液态玻璃环为标志的光学工作室网站：设计领域、流程、精选作品和咨询申请。" },
    slides: { en: "A capabilities deck for an optics studio: what it designs, process, selected work and how to start a project.", ko: "광학 스튜디오 역량 소개 자료: 설계 분야, 작업 과정, 대표 작업, 프로젝트 시작 방법.", "zh-CN": "光学工作室的能力介绍演示：设计领域、流程、精选作品和如何开始项目。" },
    graphic: { en: "A poster for an optics studio with a refracting glass ring as the key visual and one line about what it designs.", ko: "굴절하는 유리 고리를 핵심 이미지로 쓰고 설계 분야를 한 줄로 소개하는 광학 스튜디오 포스터.", "zh-CN": "以折射玻璃环为主视觉、用一句话介绍设计领域的光学工作室海报。" } },
];

const FORMATS = { prototype: "web", slide_deck: "slides", graphic: "graphic" } as const;
const LABELS = { prototype: "Web", slide_deck: "Slides", graphic: "Graphic" } as const;
const LABELS_KO = { prototype: "웹", slide_deck: "슬라이드", graphic: "그래픽" } as const;
const LABELS_ZH = { prototype: "网页", slide_deck: "演示", graphic: "图形" } as const;

/** The starter brief for a bundled example card, or null for anything that is not a bundled sample. */
export function exampleBrief(card: { readonly kind?: string; readonly designSystemId?: string | null }, locale: Locale = "en"): ExampleBrief | null {
  const type = card.kind === "prototype" || card.kind === "slide_deck" || card.kind === "graphic" ? card.kind : null;
  const slug = card.designSystemId?.startsWith("sample-system-original-") ? card.designSystemId.slice("sample-system-original-".length) : null;
  const sample = SAMPLES.find((entry) => entry.slug === slug);
  if (type === null || !sample || !card.designSystemId) return null;
  const name = locale === "ko" ? `내 ${sample.brand} ${LABELS_KO[type]}` : locale === "zh-CN" ? `我的 ${sample.brand} ${LABELS_ZH[type]}` : `My ${sample.brand} ${LABELS[type]}`;
  return { type, designSystemId: card.designSystemId, name, audience: sample.audience[locale], objective: sample[FORMATS[type]][locale] };
}

/**
 * The creation draft "Start from this" writes: the example's brief on an otherwise empty form. Nothing is sent, and the
 * sample's own design system is not preselected because choosing it copies the finished example instead of generating.
 */
export function exampleBriefForm(brief: ExampleBrief): BriefForm {
  return { ...INITIAL_BRIEF_FORM, name: brief.name, audience: brief.audience, objective: brief.objective };
}
