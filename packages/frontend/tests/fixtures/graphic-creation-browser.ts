import { createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { GraphicSetFields } from "../../src/components/home/GraphicSetFields";
import { INITIAL_BRIEF_FORM, buildCreateProjectRequest, type ProjectDraft } from "../../src/lib/project-creation";

function Form({ frames }: { frames: ProjectDraft["frames"] }) {
  const [form, setForm] = useState<ProjectDraft>({
    ...INITIAL_BRIEF_FORM, name: "Dimension seam", audience: "Customers",
    objective: "Verify dimensions", type: "graphic", backendId: "codex",
    designSystemId: null, graphicKind: "banner_set", frameCount: frames.length, frames,
  });
  return createElement(Fragment, null,
    createElement(GraphicSetFields, { form, disabled: false, onChange: patch => setForm(current => ({ ...current, ...patch })) }),
    createElement("output", { id: "request" }, JSON.stringify(buildCreateProjectRequest(form, []))),
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Graphic fixture root missing");
const root = createRoot(container);
let revision = 0;
Object.assign(globalThis, {
  mountGraphic(frames: ProjectDraft["frames"]) {
    flushSync(() => root.render(createElement(Form, { key: ++revision, frames })));
  },
});
