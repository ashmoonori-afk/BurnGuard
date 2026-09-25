import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import UserMessage from "../../src/components/chat/blocks/UserMessage";

const container = document.getElementById("root");
if (!container) throw new Error("User message fixture root missing");
const root = createRoot(container);
const state = { reverted: [] as string[], nativeConfirms: 0 };
// The macOS WKWebView shell implements no confirm panel, so a native confirm() always answers Cancel.
window.confirm = () => { state.nativeConfirms += 1; return false; };
Object.assign(globalThis, {
  userMessageState: state,
  mountUserMessage(turnId: string) {
    flushSync(() => root.render(createElement(UserMessage, { text: "make the deck", turnId, onRevert: (reverted: string) => { state.reverted.push(reverted); } })));
  },
});
