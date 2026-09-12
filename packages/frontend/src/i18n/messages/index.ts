import { settingsMessages } from "./settings";
import { shellMessages } from "./shell";
import { errorsMessages } from "./errors";
import { homeMessages } from "./home";
import { systemMessages } from "./system";
import { filesMessages } from "./files";
import { exportMessages } from "./export";
import { directionsMessages } from "./directions";
import { canvasMessages } from "./canvas";
import { modesMessages } from "./modes";
import { chatMessages } from "./chat";
import { workspaceMessages } from "./workspace";

export const messagePacks = [settingsMessages, shellMessages, errorsMessages, homeMessages, systemMessages, filesMessages, exportMessages, directionsMessages, canvasMessages, modesMessages, chatMessages, workspaceMessages] as const;
export const messages = { ...settingsMessages, ...shellMessages, ...errorsMessages, ...homeMessages, ...systemMessages, ...filesMessages, ...exportMessages, ...directionsMessages, ...canvasMessages, ...modesMessages, ...chatMessages, ...workspaceMessages };
export type MessageKey = keyof typeof messages;
