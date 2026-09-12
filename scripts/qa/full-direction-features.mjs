import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "packages/backend/package.json"));
const JSZip = require("jszip");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baseline = { schema_version: 1, image_style: "brand", copy_tone: "brand", image_recipe: "auto" };

/** Local SVG layouts only. M rows explicitly alter HTTP responses/requests, not provider outputs. */
export async function run({ page, context, base, home, check, shot, evidence }) {
  const inventory = JSON.parse(execFileSync("bun", ["-e", `
    import { IMAGE_STYLE_PRESETS as styles, COPY_TONE_PRESETS as tones } from './packages/shared/src/generation-style.ts';
    import { IMAGE_PROMPT_RECIPES as recipes, IMAGE_RECIPE_GROUPS as groups } from './packages/shared/src/image-prompt-recipes.ts';
    import { directionsMessages as messages } from './packages/frontend/src/i18n/messages/directions.ts';
    console.log(JSON.stringify({styles,tones,recipes,groups,messages}));
  `], { cwd: root, encoding: "utf8", timeout: 30_000 }));
  const en = (key) => inventory.messages[key].en;
  const observations = [], failures = [], blocked = [], events = [];
  const bus = new EventEmitter();
  const pending = new Set();
  let headers, project, endpoint, state;
  const persist = () => writeFile(path.join(evidence, "direction-observations.json"), JSON.stringify({
    scope: "Local three-SVG layout rendering and preference persistence; no AI image-quality claim.",
    observations, failures, blocked, events,
  }, null, 2));
  const row = async (name, action, mode = "live-local") => {
    try { await check(name, async () => { const result = await action(); observations.push({ name, mode, ...result }); await persist(); return result; }, mode); }
    catch (error) { failures.push({ name, mode, error: String(error.stack ?? error) }); await persist(); console.error(`[direction defect/blocker] ${name}: ${error.message}`); }
  };
  const arm = (predicate) => {
    let listener, timer, rejectWait;
    const cancel = () => { clearTimeout(timer); bus.off("event", listener); pending.delete(cancel); rejectWait(new Error("Owned direction subscription cancelled")); };
    const promise = new Promise((resolve, reject) => {
      rejectWait = reject;
      listener = (event) => { if (predicate(event)) { clearTimeout(timer); bus.off("event", listener); pending.delete(cancel); resolve(event); } };
      bus.on("event", listener);
      timer = setTimeout(() => { bus.off("event", listener); pending.delete(cancel); reject(new Error("Exact direction event deadline exceeded")); }, 30_000);
    });
    promise.catch(() => {}); // The owner awaits the original promise and reports its failure.
    pending.add(cancel);
    return { promise, cancel };
  };
  const api = async (url, method = "GET", data) => {
    assert.equal(new URL(url, base).origin, base);
    const response = await page.request.fetch(new URL(url, base).href, { method, headers, ...(data === undefined ? {} : { data }) });
    const body = await response.json();
    assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${JSON.stringify(body)}`);
    return body.data;
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const cards = () => page.getByRole("region", { name: en("directions.candidates"), exact: true }).locator("article");
  const fields = { image_style: "#direction-image-style", copy_tone: "#direction-copy-tone", image_recipe: "#direction-image-recipe" };
  const saveButton = () => button(en("directions.savePreferences"));
  const values = async () => Object.fromEntries(await Promise.all(Object.entries(fields).map(async ([key, selector]) => [key, await page.locator(selector).inputValue()])));
  const responseFor = (suffix) => page.waitForResponse((r) => new URL(r.url()).pathname === `${endpoint}${suffix}` && r.request().method() === "POST");
  const mutate = async (suffix, action, expectedStatus = 200) => {
    const response = responseFor(suffix);
    await action();
    const result = await response;
    const body = await result.json();
    assert.equal(result.status(), expectedStatus, JSON.stringify(body));
    if (body.data) state = body.data;
    return { body, sent: result.request().postDataJSON(), status: result.status() };
  };
  const open = async (reload = false) => {
    const recovered = page.waitForResponse((r) => new URL(r.url()).pathname === endpoint && r.request().method() === "GET");
    // Empty sessions do not flush SSE headers until their first event. Observe subscription,
    // then await the exact direction event after a mutation (backfill covers request ordering).
    const stream = arm((event) => event.kind === "subscribe" && event.url.includes(`/sessions/${project.session}/stream`));
    if (reload) await page.reload({ waitUntil: "domcontentloaded" });
    else await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    assert.equal((await recovered).status(), 200);
    await stream.promise;
    await button(en("directions.open")).click();
    await page.locator(fields.image_style).waitFor();
  };
  const create = async (name) => {
    const zip = new JSZip();
    zip.file("index.html", '<!doctype html><html><head><title>Direction QA</title></head><body><h1>Owned local direction fixture</h1></body></html>');
    const response = await page.request.post(`${base}/api/projects/import`, { headers, multipart: {
      name, source: "zip", files: { name: "directions.zip", mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) },
    } });
    assert.equal(response.status(), 201, await response.text());
    const data = (await response.json()).data;
    const dir = await realpath(path.join(home, ".burnguard/data/projects", data.id));
    assert.ok(dir.startsWith(`${home}${path.sep}`));
    project = { id: data.id, dir, session: (await api(`/api/projects/${data.id}/session`)).id };
    endpoint = `/api/projects/${project.id}/design-directions`;
    return project;
  };
  const generate = async (terminal = "ready") => {
    const finished = arm((event) => event.event?.type === "design.direction_state" && event.event.state.project_id === project.id && event.event.state.status === terminal);
    const accepted = await mutate("/generate", () => button(en("directions.generate")).click(), 202);
    assert.equal(accepted.body.data.status, "loading");
    state = (await finished.promise).event.state;
    await cards().nth(2).waitFor();
    return state;
  };
  const save = async () => {
    const expected = { schema_version: 1, ...await values() };
    const before = await api(endpoint);
    const changed = arm((event) => event.event?.type === "design.direction_state" && event.event.state.project_id === project.id && event.event.state.selection_revision === before.selection_revision + 1);
    const saved = await mutate("/preferences", () => saveButton().click());
    assert.deepEqual({ image_recipe: "auto", ...saved.sent.creative_preferences }, expected);
    assert.equal(saved.sent.expected_selection_revision, before.selection_revision);
    assert.deepEqual(saved.body.data.creative_preferences, saved.sent.creative_preferences);
    await changed.promise;
    const stored = await api(endpoint);
    assert.deepEqual(stored.creative_preferences, saved.sent.creative_preferences);
    assert.equal(stored.generation_id, before.generation_id);
    assert.equal(stored.selected_id, before.selected_id);
    assert.deepEqual(stored.directions, before.directions, "preference saves must not regenerate previews");
    state = stored;
    return stored;
  };
  const assertPreferences = async (expected) => {
    assert.deepEqual(await values(), { image_style: expected.image_style, copy_tone: expected.copy_tone, image_recipe: expected.image_recipe ?? "auto" });
    assert.equal(await saveButton().isDisabled(), true);
  };
  const previewEvidence = async (name) => {
    assert.equal(state.status, "ready");
    assert.deepEqual(state.directions.map((slot) => slot.layout_key), ["editorial", "modular", "narrative"]);
    assert.equal(await cards().count(), 3);
    const previews = [];
    for (const [index, slot] of state.directions.entries()) {
      const image = cards().nth(index).locator("img");
      await image.waitFor();
      await image.evaluate((element) => element.decode());
      assert.deepEqual(await image.evaluate((element) => [element.naturalWidth, element.naturalHeight]), [640, 360]);
      const response = await page.request.get(new URL(slot.preview_url, base).href, { headers });
      assert.equal(response.status(), 200);
      assert.match(response.headers()["content-type"], /^image\/svg\+xml/);
      const bytes = await response.body();
      const stored = await readFile(path.join(project.dir, ".meta/directions", state.generation_id, `${slot.id}.svg`));
      assert.deepEqual(bytes, stored);
      const parsed = await page.evaluate((svg) => {
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        return { root: doc.documentElement.localName, errors: doc.querySelectorAll("parsererror").length, viewBox: doc.documentElement.getAttribute("viewBox"), external: doc.querySelectorAll('script,image,foreignObject').length };
      }, bytes.toString("utf8"));
      assert.deepEqual(parsed, { root: "svg", errors: 0, viewBox: "0 0 640 360", external: 0 });
      const etag = response.headers().etag;
      assert.equal(etag, `"${sha(bytes)}"`);
      const cached = await page.request.get(new URL(slot.preview_url, base).href, { headers: { ...headers, "if-none-match": etag } });
      assert.equal(cached.status(), 304);
      const filename = `${name}-${slot.id}.svg`;
      await writeFile(path.join(evidence, filename), bytes);
      previews.push({ id: slot.id, sha256: sha(bytes), filename, dimensions: [640, 360], status: 200, conditionalStatus: 304 });
    }
    assert.equal(new Set(previews.map((item) => item.sha256)).size, 3);
    await cards().nth(0).scrollIntoViewIfNeeded();
    await shot(`directions-${name}-three-svg-cards`);
    return previews;
  };
  // Deny all external traffic, provider turns, and publish endpoints before navigation.
  const guard = async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base || (request.method() === "POST" && (/\/sessions\/[^/]+\/events$/.test(url.pathname) || /\/(publish|generate-image|images\/generate)(\/|$)/.test(url.pathname)))) {
      blocked.push({ method: request.method(), url: `${url.origin}${url.pathname}` });
      await route.abort("blockedbyclient");
    } else await route.continue();
  };
  await context.route("**/*", guard);
  await page.exposeBinding("__directionObserved", (_source, event) => { if (event.event?.type === "design.direction_state") events.push(event.event); bus.emit("event", event); });
  await context.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem("burnguard.locale", "en");
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url, options) {
        super(url, options);
        window.__directionObserved({ kind: "subscribe", url: String(url) });
        this.addEventListener("open", () => window.__directionObserved({ kind: "open", url: String(url) }));
        this.addEventListener("message", (message) => window.__directionObserved({ kind: "message", url: String(url), ...JSON.parse(message.data) }));
      }
    };
  });
  try {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const bootstrap = await page.evaluate(async () => { const response = await fetch("/api/bootstrap"); if (!response.ok) throw new Error(`Bootstrap ${response.status}`); return (await response.json()).data; });
    headers = { "x-burnguard-capability": bootstrap.capability, origin: base };
    await create("Owned local SVG directions QA");
    await open();
    await row("directions-empty-and-inventory", async () => {
      assert.equal(await api(endpoint), null);
      assert.equal(await button(en("directions.generate")).isEnabled(), true);
      assert.equal(await cards().count(), 0);
      assert.deepEqual(await values(), { image_style: "brand", copy_tone: "brand", image_recipe: "auto" });
      const styles = await page.locator(`${fields.image_style} option`).evaluateAll((options) => options.map((option) => option.value));
      const tones = await page.locator(`${fields.copy_tone} option`).evaluateAll((options) => options.map((option) => option.value));
      const recipes = await page.locator(`${fields.image_recipe} option`).evaluateAll((options) => options.map((option) => option.value));
      const groups = await page.locator(`${fields.image_recipe} optgroup`).evaluateAll((items) => items.map((group) => ({ label: group.label, values: [...group.children].map((option) => option.value) })));
      assert.equal(styles.length, 21); assert.deepEqual(styles, Object.keys(inventory.styles));
      assert.equal(tones.length, 6); assert.deepEqual(tones, Object.keys(inventory.tones));
      assert.equal(recipes.length, 39); assert.deepEqual(recipes, ["auto", ...Object.keys(inventory.recipes)]);
      assert.equal(groups.length, 13);
      for (const [index, key] of Object.keys(inventory.groups).entries()) {
        assert.equal(groups[index].label, en(`directions.group.${key}`));
        assert.deepEqual(groups[index].values, Object.keys(inventory.recipes).filter((recipe) => inventory.recipes[recipe].group === key));
      }
      return { styles, tones, recipes, groups };
    });
    await row("directions-real-three-svg-generation", async () => {
      await generate();
      const previews = await previewEvidence("initial");
      await open(true);
      assert.deepEqual((await api(endpoint)).directions, state.directions);
      await assertPreferences(baseline);
      return { project: project.id, generation: state.generation_id, previews, renderer: "real local SVG; not AI imagery" };
    });
    // Each axis starts/ends at baseline. Every offered value gets a real changed UI save and reload.
    for (const [axis, keys, description] of [
      ["image_style", [...Object.keys(inventory.styles).slice(1), "brand"], "#direction-image-style-description"],
      ["copy_tone", [...Object.keys(inventory.tones).slice(1), "brand"], "#direction-copy-tone-example"],
      ["image_recipe", [...Object.keys(inventory.recipes), "auto"], "#direction-image-recipe-description"],
    ]) {
      for (const value of keys) await row(`directions-${axis}-${value}`, async () => {
        await page.locator(fields[axis]).selectOption(value);
        const expected = { ...baseline, [axis]: value };
        const displayed = await page.locator(description).textContent();
        // Shipped-copy equality, not prose snapshots: these expectations come from the current translation inventory.
        const expectedDescription = axis === "image_style" ? en(`directions.image.${value}.description`)
          : axis === "copy_tone" ? en("directions.style.example").replace("{name}", en(`directions.tone.${value}.example`))
          : `${value === "auto" ? en("directions.style.autoDescription") : en("directions.style.recipeDescription").replace("{name}", en(`directions.recipe.${value}`))} ${en("directions.style.recipeNote")}`;
        assert.equal(displayed, expectedDescription);
        const saved = await save();
        assert.deepEqual({ ...baseline, ...saved.creative_preferences }, expected);
        await open(true);
        await assertPreferences(expected);
        assert.equal(await page.locator(description).textContent(), expectedDescription);
        return { axis, value, description: displayed, selectionRevision: saved.selection_revision, persistedAcrossReload: true, otherAxes: "baseline", previewsUnchanged: true };
      });
    }
    for (const [index, id] of ["editorial", "modular", "narrative"].entries()) await row(`directions-select-${id}`, async () => {
      const prior = await api(endpoint);
      const result = await mutate("/select", () => cards().nth(index).getByRole("button", { name: en("directions.select"), exact: true }).click());
      assert.equal(result.body.data.selected_id, id);
      assert.equal(state.selection_revision, prior.selection_revision + 1);
      assert.deepEqual(state.selection_history, [...prior.selection_history, prior.selected_id]);
      await cards().nth(index).locator('button[aria-pressed="true"]').waitFor();
      await open(true);
      await cards().nth(index).locator('button[aria-pressed="true"]').waitFor();
      assert.equal((await api(endpoint)).selected_id, id);
      return { id, revision: state.selection_revision, history: state.selection_history, persistedAcrossReload: true };
    });
    for (const expected of ["modular", "editorial", null]) await row(`directions-undo-to-${expected ?? "none"}`, async () => {
      const prior = await api(endpoint);
      await mutate("/undo-selection", () => button(en("directions.undo")).click());
      assert.equal(state.selected_id, expected);
      assert.deepEqual(state.selection_history, prior.selection_history.slice(0, -1));
      await open(true);
      assert.equal((await api(endpoint)).selected_id, expected);
      assert.equal(await cards().locator('button[aria-pressed="true"]').count(), expected === null ? 0 : 1);
      if (expected === null) assert.equal(await button(en("directions.undo")).count(), 0);
      return { selected: expected, revision: state.selection_revision, persistedAcrossReload: true };
    });
    for (const code of ["revision_conflict", "generation_conflict"]) await row(`directions-${code}-and-recovery`, async () => {
      const before = await api(endpoint);
      const url = `${base}${endpoint}/select`;
      const fault = async (route) => {
        const data = route.request().postDataJSON();
        if (code === "revision_conflict") data.expected_selection_revision = before.selection_revision - 1;
        else data.generation_id = "owned-stale-generation";
        await route.continue({ postData: JSON.stringify(data) });
      };
      await page.route(url, fault, { times: 1 });
      try {
        const result = await mutate("/select", () => cards().nth(0).getByRole("button").click(), 409);
        assert.equal(result.body.error.code, code);
        await page.getByRole("alert").waitFor();
        assert.deepEqual(await api(endpoint), before);
        await mutate("/select", () => cards().nth(0).getByRole("button").click());
        assert.equal(state.selected_id, "editorial");
        await page.getByRole("alert").waitFor({ state: "hidden" });
        await mutate("/undo-selection", () => button(en("directions.undo")).click());
        return { injected: "stale request identity only; real backend 409", code, stateUnchangedOnConflict: true, nextUISelection: "recovered" };
      } finally { await page.unroute(url, fault); }
    }, "M-request-fault-real-backend");
    await row("directions-stale-response-does-not-overwrite-live-selection", async () => {
      const before = await api(endpoint);
      const url = `${base}${endpoint}/select`;
      const fault = async (route) => {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.fulfill({ response, json: { data: before } });
      };
      await page.route(url, fault, { times: 1 });
      try {
        const selected = arm((event) => event.event?.type === "design.direction_state" && event.event.state.project_id === project.id && event.event.state.selection_revision === before.selection_revision + 1);
        await mutate("/select", () => cards().nth(2).getByRole("button").click());
        state = (await selected.promise).event.state;
        await cards().nth(2).locator('button[aria-pressed="true"]').waitFor();
        assert.equal(state.selected_id, "narrative");
        await open(true);
        await cards().nth(2).locator('button[aria-pressed="true"]').waitFor();
        return { injected: "old HTTP success snapshot after real select; live SSE and persisted state remain real", selected: state.selected_id, staleRevision: before.selection_revision, currentRevision: state.selection_revision };
      } finally { await page.unroute(url, fault); }
    }, "M-response-fault");
    const primary = { project, endpoint };
    await row("directions-real-render-failure-and-retry", async () => {
      await create("Owned failed SVG renderer QA");
      const obstruction = path.join(project.dir, ".meta/directions");
      await mkdir(path.dirname(obstruction), { recursive: true });
      await writeFile(obstruction, "Owned fixture: ENOTDIR render fault");
      try {
        await open();
        await generate("failed");
        assert.deepEqual(state.directions.map((slot) => slot.status), ["failed", "failed", "failed"]);
        assert.equal(await cards().locator("button").count(), 0);
        await button(en("directions.retryAll")).waitFor();
        const failed = state;
        await shot("directions-real-render-failed");
        await open(true);
        assert.equal((await api(endpoint)).status, "failed");
        await rm(obstruction);
        const ready = arm((event) => event.event?.type === "design.direction_state" && event.event.state.project_id === project.id && event.event.state.status === "ready");
        await mutate("/retry", () => button(en("directions.retryAll")).click(), 202);
        state = (await ready.promise).event.state;
        assert.equal(state.generation_id, failed.generation_id);
        assert.deepEqual(state.creative_preferences, failed.creative_preferences);
        const previews = await previewEvidence("retry");
        assert.equal(await button(en("directions.retryAll")).count(), 0);
        return { fault: "owned filesystem obstruction; real renderer failed and real UI retry succeeded", generation: state.generation_id, failedSlots: failed.directions.map((slot) => ({ id: slot.id, error: slot.error })), previews };
      } finally {
        // Never recursively remove a successfully rendered directory here; the runner owns profile cleanup.
        const { stat } = await import("node:fs/promises");
        const info = await stat(obstruction).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
        if (info?.isFile()) await rm(obstruction);
        project = primary.project; endpoint = primary.endpoint;
        await open(); state = await api(endpoint);
      }
    }, "live-local-owned-filesystem-fault");
    // Rendering is intentionally too quick to race a cancellation click. Expose bounded controlled
    // response states instead; these do NOT claim cancellation of an active real renderer.
    for (const variant of ["partial", "failed", "cancelled", "loading"]) await row(`directions-controlled-${variant}`, async () => {
      const real = await api(endpoint);
      const fake = structuredClone(real);
      fake.updated_at += 1_000_000;
      fake.selected_id = null; fake.selection_history = [];
      fake.status = variant;
      const failedStatus = variant === "loading" ? "pending" : variant === "cancelled" ? "cancelled" : "failed";
      fake.directions = fake.directions.map((slot, index) => variant === "partial" && index === 0 ? slot : {
        ...slot, status: failedStatus, preview_url: null, error: failedStatus === "pending" ? null : `Owned ${variant} response fixture`,
      });
      const getURL = `${base}${endpoint}`;
      const getFault = (route) => route.fulfill({ status: 200, json: { data: fake } });
      await page.route(getURL, getFault);
      let actionFault;
      let actionURL;
      try {
        await open(true);
        await cards().nth(2).waitFor();
        if (variant === "loading") {
          assert.equal(await page.locator(fields.image_style).isDisabled(), true);
          assert.equal(await saveButton().isDisabled(), true);
          assert.equal(await cards().locator("button").count(), 0);
          actionURL = `${base}${endpoint}/cancel`;
          const terminal = { ...fake, updated_at: fake.updated_at + 1, status: "cancelled", directions: fake.directions.map((slot) => ({ ...slot, status: "cancelled", error: "Direction generation was cancelled; retry this direction." })) };
          const intercepted = arm((event) => event.kind === "owned-cancel-route");
          actionFault = (route) => { bus.emit("event", { kind: "owned-cancel-route", route }); };
          await page.route(actionURL, actionFault, { times: 1 });
          const accepted = responseFor("/cancel");
          accepted.catch(() => {}); // Awaited below; pending-state assertion failures must still release the route.
          const clicked = page.locator('main[aria-busy="true"]').getByRole("button", { name: en("directions.cancel"), exact: true }).click();
          clicked.catch(() => {});
          const { route: held } = await intercepted.promise;
          try {
            await clicked;
            const pendingButton = page.locator('main[aria-busy]').getByRole("button", { name: en("directions.cancelPending"), exact: true });
            await pendingButton.waitFor();
            assert.equal(await pendingButton.isDisabled(), true);
            await shot("directions-M-cancel-pending");
          } finally {
            // Finish this route before unroute/reload; never leave a handler racing navigation.
            await held.fulfill({ status: 202, json: { data: terminal } });
          }
          assert.equal((await accepted).status(), 202);
          await button(en("directions.retryAll")).waitFor();
          assert.equal(await page.locator(fields.image_style).isEnabled(), true);
        } else {
          await button(en("directions.retryAll")).waitFor();
          assert.equal(await cards().locator("button").count(), variant === "partial" ? 1 : 0);
          if (variant === "partial") assert.equal(await cards().nth(0).getByRole("button").isEnabled(), true);
          actionURL = `${base}${endpoint}/retry`;
          actionFault = (route) => route.fulfill({ status: 409, json: { error: { code: "session_busy", message: "Owned retry response fault" } } });
          await page.route(actionURL, actionFault, { times: 1 });
          const result = await mutate("/retry", () => button(en("directions.retryAll")).click(), 409);
          assert.equal(result.body.error.code, "session_busy");
          await page.getByRole("alert").waitFor();
          assert.equal(await button(en("directions.retryAll")).isEnabled(), true);
        }
        assert.deepEqual(await api(endpoint), real, "response controls cannot mutate durable state");
        await shot(`directions-M-${variant}-outcome`);
        return { variant, injected: "GET response snapshot and explicit action response fault; durable backend unchanged", readySelectable: variant === "partial", cancellation: variant === "loading" ? "controlled pending -> cancelled; not real active-renderer cancellation" : null };
      } finally {
        await page.unroute(getURL, getFault);
        if (actionURL) await page.unroute(actionURL, actionFault);
        await open(true); state = await api(endpoint);
      }
    }, "M-response-state");
    await row("directions-final-persistence-and-network-guard", async () => {
      state = await api(endpoint);
      const previews = await previewEvidence("final");
      await assertPreferences(baseline);
      const providerPosts = blocked.filter((item) => item.method === "POST");
      assert.deepEqual(providerPosts, [], "no provider or publication POST may be attempted");
      return { axes: { imageStyles: 21, copyTones: 6, recipesIncludingAuto: 39, groups: 13 }, independentOptionRows: observations.filter((item) => item.axis).length, previews, blockedNetwork: blocked, failures: failures.length };
    });
  } finally {
    for (const cancel of [...pending]) cancel();
    await persist();
    await context.unroute("**/*", guard);
  }
  if (failures.length) throw new Error(`${failures.length} direction outcomes failed; see direction-observations.json`);
}
