import { APP_SCREENS_DEFAULT_FRAME, type AppScreenFrame } from "@bg/shared";
import { escapeHtml } from "./index";

export function renderAppScreen(name: string, frame: AppScreenFrame = APP_SCREENS_DEFAULT_FRAME): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>html,body{margin:0;width:${frame.width}px;height:${frame.height}px}body{box-sizing:border-box;padding:32px;font:16px/1.5 system-ui;background:#fff;color:#17191a}main{height:100%;display:grid;place-content:center}h1{font-size:32px}</style>
</head><body><main><h1>${escapeHtml(name)}</h1><p>Your first app screen. Describe the screens you want in chat.</p></main></body></html>`;
}
