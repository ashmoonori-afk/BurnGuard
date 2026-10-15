import { defineMessages } from "../types";

export const revisionMessages = defineMessages({
  "revision.scope": { ko: "수정 범위", en: "Edit scope", "zh-CN": "\u7f16\u8f91\u8303\u56f4" },
  "revision.unrestricted": { ko: "제한 없음", en: "Unrestricted", "zh-CN": "\u4e0d\u9650\u5236" },
  "revision.text_only": { ko: "문구만 수정", en: "Text only", "zh-CN": "\u4ec5\u6587\u5b57" },
  "revision.image_only": { ko: "이미지만 수정", en: "Images only", "zh-CN": "\u4ec5\u56fe\u7247" },
  "revision.targets": { ko: "대상 페이지와 요소", en: "Target pages and nodes", "zh-CN": "\u76ee\u6807\u9875\u9762\u548c\u8282\u70b9" },
  "revision.targetHint": { ko: "선택 사항: 한 줄에 페이지 경로, 아트보드 ID, 요소 ID를 쉼표로 구분해요. 비워 두면 전체예요.", en: "Optional: one page path, artboard ID, node ID per line, separated by commas. Empty means all pages.", "zh-CN": "\u53ef\u9009\uff1a\u6bcf\u884c\u586b\u5199\u9875\u9762\u8def\u5f84\u3001\u753b\u677f ID\u3001\u8282\u70b9 ID\uff0c\u7528\u9017\u53f7\u5206\u9694\u3002\u7559\u7a7a\u8868\u793a\u6240\u6709\u9875\u9762\u3002" },
  "revision.invalid": { ko: "수정 범위가 올바르지 않아요. 페이지 경로와 대상 ID를 확인해 주세요.", en: "The edit scope is invalid. Check the page paths and target IDs.", "zh-CN": "\u7f16\u8f91\u8303\u56f4\u65e0\u6548\uff0c\u8bf7\u68c0\u67e5\u9875\u9762\u8def\u5f84\u548c\u76ee\u6807 ID\u3002" },
  "revision.blocked": { ko: "수정 범위 밖의 변경이 있어 반영하지 않았어요. 대상을 수정하거나 수정 범위를 직접 넓혀 다시 요청해 주세요.", en: "Changes outside the edit scope were not applied. Correct the changes or explicitly widen the scope and send again.", "zh-CN": "\u53d1\u73b0\u8303\u56f4\u5916\u66f4\u6539\uff0c\u672a\u5e94\u7528\u3002\u8bf7\u4fee\u6b63\u66f4\u6539\u6216\u660e\u786e\u6269\u5927\u8303\u56f4\u540e\u91cd\u8bd5\u3002" },
  "revision.title": { ko: "이전 버전과 비교", en: "Changes from the previous revision", "zh-CN": "\u4e0e\u4e0a\u4e00\u7248\u672c\u6bd4\u8f83" },
  "revision.sourceOnly": { ko: "소스와 파일 해시를 비교했어요. 렌더 이미지의 동일성을 뜻하지 않아요.", en: "Source and file hashes compared. This does not establish rendered-image equality.", "zh-CN": "\u5df2\u6bd4\u8f83\u6e90\u7801\u548c\u6587\u4ef6\u54c8\u5e0c\uff0c\u4e0d\u4ee3\u8868\u6e32\u67d3\u56fe\u50cf\u76f8\u540c\u3002" },
  "revision.noChanges": { ko: "문구, 이미지, 스타일 변경이 없어요.", en: "No text, image or style changes.", "zh-CN": "\u6587\u5b57\u3001\u56fe\u7247\u548c\u6837\u5f0f\u5747\u65e0\u53d8\u5316\u3002" },
  "revision.text": { ko: "문구", en: "Text", "zh-CN": "\u6587\u5b57" },
  "revision.image": { ko: "이미지", en: "Image", "zh-CN": "\u56fe\u7247" },
  "revision.style": { ko: "스타일", en: "Style", "zh-CN": "\u6837\u5f0f" },
  "revision.structure": { ko: "구조", en: "Structure", "zh-CN": "\u7ed3\u6784" },
  "revision.script": { ko: "스크립트", en: "Script", "zh-CN": "\u811a\u672c" },
  "revision.asset": { ko: "파일", en: "Asset", "zh-CN": "\u8d44\u6e90" },
  "revision.before": { ko: "이전", en: "Before", "zh-CN": "\u4fee\u6539\u524d" },
  "revision.after": { ko: "이후", en: "After", "zh-CN": "\u4fee\u6539\u540e" },
});
