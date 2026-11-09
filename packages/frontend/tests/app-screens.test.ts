import { expect, test } from "bun:test";
import { fallbackAppScreens } from "@bg/shared";
import { appScreenLinks, appScreenPosition, appScreenScale, appScreenTarget, stepAppScreen } from "../src/lib/app-screens";
import { buildCreateProjectRequest, INITIAL_BRIEF_FORM } from "../src/lib/project-creation";
import { parseCreationDraft, serializeCreationDraft } from "../src/lib/creation-draft";

const manifest = {
  ...fallbackAppScreens([]),
  sections: [
    { id: "intro", name: "Intro", screens: [{ file: "screens/start.html", title: "Start" }, { file: "screens/pair.html", title: "Pair" }] },
    { id: "main", name: "Main", screens: [{ file: "screens/home.html", title: "Home" }] },
  ],
};
const source = "http://localhost/api/projects/p1/fs/screens/start.html";

test("Given relative links When extracting Then only unique manifest targets within the project remain", () => {
  expect(appScreenLinks(["pair.html", "./pair.html#top", "home.html?tab=1", "#top", "start.html", "missing.html", "../../outside.html", "https://evil.test/pair.html", "javascript:alert(1)"], source, manifest))
    .toEqual(["screens/pair.html", "screens/home.html"]);
  expect(appScreenTarget("/api/projects/p2/fs/screens/home.html", source, manifest)).toBeNull();
});
test("Given playback When stepping Then section order and bounds remain stable", () => {
  expect(stepAppScreen(manifest, "screens/start.html", 1)).toBe("screens/pair.html");
  expect(stepAppScreen(manifest, "screens/start.html", -1)).toBeNull();
  expect(stepAppScreen(manifest, "screens/pair.html", 1)).toBeNull();
  expect(appScreenPosition(manifest, "screens/home.html")).toEqual({ section: manifest.sections[1], index: 0 });
  expect(appScreenPosition(manifest, "missing.html")).toBeNull();
});
test.each([
  [{ width: 390, height: 844 }, { width: 780, height: 422 }, 0.5],
  [{ width: 1440, height: 900 }, { width: 720, height: 700 }, 0.5],
  [{ width: 390, height: 844 }, { width: 1440, height: 900 }, 1],
])("Given frame %j and bounds %j When fitting Then aspect is preserved at scale %s", (frame, bounds, scale) => {
  expect(appScreenScale(frame, bounds)).toBe(scale);
});
test.each([
  [undefined, { width: 390, height: 844 }],
  ["desktop", { width: 1440, height: 900 }],
] as const)("Given frame option %s When creating Then its chosen geometry is in the request", (appFrame, frame) => {
  const result = buildCreateProjectRequest({
    ...INITIAL_BRIEF_FORM, ...(appFrame === undefined ? {} : { appFrame }),
    name: "App", objective: "Pair a device", type: "app_screens", backendId: "codex", designSystemId: null,
  }, []);
  if (!result.ok) throw new Error(result.problem);
  expect(result.request.type).toBe("app_screens");
  expect(result.request.options?.app_screens_frame).toEqual(frame);
  expect(result.request.options?.design_brief?.output_type).toBe("app_screens");
});
test("Given a desktop creation draft When saved and restored Then its frame choice survives", () => {
  expect(parseCreationDraft(serializeCreationDraft({ ...INITIAL_BRIEF_FORM, appFrame: "desktop" })).appFrame).toBe("desktop");
});
