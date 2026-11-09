import { defineMessages } from "../types";

export const logoMessages = defineMessages({
  "logo.candidates.title": { ko: "로고 시안", en: "Logo concepts", "zh-CN": "标志方案" },
  "logo.candidates.round": { ko: "{count}번째 라운드", en: "Round {count}", "zh-CN": "第 {count} 轮" },
  "logo.candidates.hint": { ko: "마음에 드는 시안을 고르면 로고 파일과 가이드라인을 만들어요.", en: "Pick the concept you like and the logo file and guidelines are built from it.", "zh-CN": "选择满意的方案后，即可生成标志文件和规范。" },
  "logo.candidates.busy": { ko: "AI가 작업하는 동안에는 고를 수 없어요.", en: "Selection is unavailable while the AI is working.", "zh-CN": "AI 工作期间无法选择。" },
  "logo.candidates.regenerate": { ko: "재생성", en: "Regenerate", "zh-CN": "重新生成" },
  "logo.candidates.exhausted": { ko: "시안은 최대 {count}라운드까지 만들 수 있어요. 지금까지의 시안 중에서 골라주세요.", en: "Up to {count} rounds of concepts can be generated. Choose from the rounds so far.", "zh-CN": "最多可生成 {count} 轮方案。请从现有方案中选择。" },
  "logo.candidates.select": { ko: "이 시안으로 진행", en: "Use this concept", "zh-CN": "采用此方案" },
  "logo.candidates.selectNamed": { ko: "{number}번 시안으로 진행", en: "Use concept {number}", "zh-CN": "采用第 {number} 个方案" },
  "logo.candidates.selected": { ko: "선택됨", en: "Selected", "zh-CN": "已选择" },
  "logo.candidates.preview": { ko: "{number}번 시안 미리보기", en: "Concept {number} preview", "zh-CN": "第 {number} 个方案预览" },
  "logo.construction.title": { ko: "심볼", en: "Symbol", "zh-CN": "图形标志" },
  "logo.construction.view": { ko: "보기 방식", en: "View", "zh-CN": "查看方式" },
  "logo.construction.design": { ko: "디자인", en: "Design", "zh-CN": "设计" },
  "logo.construction.drawing": { ko: "작도", en: "Construction", "zh-CN": "构造图" },
  "logo.construction.replay": { ko: "다시 그리기", en: "Replay", "zh-CN": "重新播放" },
  "logo.construction.markLabel": { ko: "심볼 디자인", en: "Symbol design", "zh-CN": "图形标志设计" },
  "logo.construction.sheetLabel": { ko: "심볼 작도: 보조선, 원, 직선, 기준점, 외곽선 순서", en: "Symbol construction: guides, circles, lines, key points, then the outline", "zh-CN": "图形标志构造图：辅助线、圆、直线、关键点，然后是轮廓" },
  "logo.construction.hint": { ko: "작도는 심볼을 만든 원과 직선을 그린 순서대로 보여줘요.", en: "Construction shows the circles and lines the symbol is built from, in the order they are drawn.", "zh-CN": "构造图按绘制顺序展示组成图形标志的圆和直线。" },
  "logo.construction.invalid": { ko: "심볼 도형 기록을 읽지 못해 작도를 보여줄 수 없어요.", en: "The symbol's geometry record could not be read, so its construction cannot be shown.", "zh-CN": "无法读取图形标志的几何记录，因此无法显示构造图。" },
});
