import type { AppScreenFrame } from "@bg/shared";

/** A machine-readable output contract accompanies the selected, shipped skill. */
export function appScreensSkill(frame: AppScreenFrame, activeFile: string): string {
  return `<burnguard-app-screens-v1>
${JSON.stringify({ schema_version: 1, frame, manifest: "screens.json", directory: "screens", active_file: activeFile })}
</burnguard-app-screens-v1>
## App screens skill
Build linked app screens at exactly ${frame.width} x ${frame.height} CSS pixels each.
Keep the chosen frame, including phone frames; do not substitute a desktop or responsive website.
Write one HTML document per screen at screens/<slug>.html. Each document owns one screen.
Use plain relative <a href="other.html"> links for navigation to sibling screen files.
Do not use a SPA router, absolute file paths, window.open, or navigation to the parent app.
Update screens.json on EVERY turn, preserving other screens and their order unless asked to change them.
The manifest is {"schema_version":1,"frame":{"width":${frame.width},"height":${frame.height}},"sections":[{"id":"main","name":"Main","screens":[{"file":"screens/start.html","title":"Start"}]}]}.
Group related screens in named sections. Every file must be under screens/ and end in .html.
Keep shared navigation and tokens consistent. Edit the active screen when the request targets it.
Check all screen files, frame geometry, keyboard actions, and relative links before completing the turn.`;
}
