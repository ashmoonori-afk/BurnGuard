import { chatPolishKo } from "../ko/chat-polish";
import { defineMessages } from "../types";

export const chatPolishMessages = defineMessages({
  "chat.polish.activity": {
    ko: chatPolishKo["chat.polish.activity"],
    en: { one: "{count} background step", other: "{count} background steps" },
    "zh-CN": "{count} 个后台步骤",
  },
  "chat.polish.activityRunning": {
    ko: chatPolishKo["chat.polish.activityRunning"],
    en: { one: "Working in the background · {count} step", other: "Working in the background · {count} steps" },
    "zh-CN": "正在后台处理 · {count} 个步骤",
  },
});
