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
});
