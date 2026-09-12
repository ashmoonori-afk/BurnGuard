import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const kinds = ["single", "card_news", "product_detail", "banner_set", "thumbnail", "print"];
const detailKeys = ["persona_pain", "arrival_scene", "mechanism", "evidence", "journey", "risk_reducers", "urgency"];
// Independent contract expectations, not imported from the implementation under test.
const presets = {
  single: [],
  card_news: [
    ["instagram-feed-square",1080,1080], ["instagram-feed-portrait",1080,1350],
    ["instagram-feed-three-four",1080,1440], ["facebook-feed-carousel",1080,1080],
    ["facebook-stories-carousel",1080,1920], ["kakao-channel-card-square",720,720],
    ["kakao-channel-card-portrait",720,960],
  ],
  product_detail: [["smartstore-product-detail",860,16000], ["coupang-product-detail",780,16000]],
  banner_set: [
    ["meta-square",1080,1080], ["meta-feed-portrait",1080,1350], ["meta-story",1080,1920],
    ["naver-gfa-mobile-da",1250,560], ["naver-gfa-native-wide",1200,628],
    ["naver-gfa-native-square",1200,1200], ["naver-gfa-native-thumbnail",342,228],
    ["naver-gfa-image-feed",1200,680], ["naver-gfa-smart-channel",750,160],
    ["naver-gfa-smart-channel-tall",750,200], ["naver-gfa-special-da",750,280],
    ["naver-gfa-collection",600,600], ["naver-gfa-comment",112,112],
    ["naver-gfa-mobile-da-legacy",1250,370], ["kakao-bizboard",1029,258],
    ["google-display-medium-rectangle",300,250],
  ],
  thumbnail: [["youtube-thumbnail",1280,720], ["marketplace-thumbnail",1000,1000]],
  print: [["business-card-working-area",1110,626]],
};
const common = [[1080,1080], [1200,628], [1080,1920]];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function run({ page, context, base, home, check, shot, evidence }) {
  const owned = await realpath(home);
  assert.ok(path.basename(owned).startsWith("burnguard-e2e-home-"));
  const failures = [], outcomes = [], http = [], deniedTurns = [], created = new Set();
  const save = (name, value) => writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value, null, 2));
  let headers;
  let baselineRequest;
  let posts = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/projects") posts += 1;
  });
  await context.route("**/api/sessions/*/events", async route => {
    if (route.request().method() !== "POST") return route.continue();
    deniedTurns.push({ method: "POST", url: route.request().url() });
    await route.abort("blockedbyclient");
  });
  await context.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem("burnguard.locale", "en");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      original.call(this, key, value);
      if (this === localStorage) window.dispatchEvent(new CustomEvent("qa-creation-draft", { detail: { key, value } }));
    };
  });

  async function scenario(name, action, mode = "live-local") {
    try {
      await check(name, async () => {
        const observation = await action();
        outcomes.push({ name, ok: true });
        return observation;
      }, mode);
    } catch (error) {
      failures.push({ name, error: String(error.stack ?? error), url: page.url() });
      outcomes.push({ name, ok: false });
      await writeFile(path.join(evidence, `${name}-dom.txt`), await page.locator("body").innerText());
      await save("defects", failures);
      console.error(`GRAPHIC FAILURE ${name}: ${error.message}`);
    }
  }
  async function api(url, method = "GET", body) {
    // This helper cannot issue a model turn, even if a future case supplies a bad path.
    assert.ok(!/\/sessions\/[^/]+\/events$/.test(url) || method === "GET");
    const response = await context.request.fetch(`${base}${url}`, { method, headers, ...(body === undefined ? {} : { data: body }) });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    const record = { method, path: url, ...(body === undefined ? {} : { request: body }), status: response.status(), body: json };
    http.push(record);
    await save("http", http);
    return record;
  }
  async function get(url) {
    const response = await api(url);
    assert.equal(response.status, 200, JSON.stringify(response));
    return response.body.data;
  }
  const input = id => page.locator(`#${id}`);
  const submit = () => page.locator("form:has(#graphic-kind) button[type=submit]");
  const rows = () => page.locator('ul[aria-labelledby="graphic-frames-label"] > li');
  const platformButtons = () => page.locator('[role="group"][aria-labelledby="graphic-preset-label"] button');

  // Subscribe to the actual draft write before changing the final field, then await it.
  async function draftAction(expected, action, type = "graphic") {
    await page.evaluate(({expected, type}) => {
      window.__qaDraft = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { window.removeEventListener("qa-creation-draft", listener); reject(new Error("Expected creation draft write did not occur")); }, 15000);
        function listener(event) {
          if (event.detail.key !== `bg.new-project.${type}`) return;
          const value = JSON.parse(event.detail.value);
          if (!Object.entries(expected).every(([key, wanted]) => JSON.stringify(value[key]) === JSON.stringify(wanted))) return;
          clearTimeout(timer); window.removeEventListener("qa-creation-draft", listener); resolve(value);
        }
        window.addEventListener("qa-creation-draft", listener);
      });
      window.__qaDraft.catch(() => {});
    }, {expected, type});
    await action();
    return page.evaluate(() => window.__qaDraft);
  }

  async function enabledForm() {
    // Auth detection can finish after the draft renders. Observe the exact disabled
    // attribute transition before submission, rather than sampling a loading frame.
    await submit().evaluate(button => new Promise((resolve, reject) => {
      const observer = new MutationObserver(ready);
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error("Valid graphic form never became enabled after authentication detection")); }, 15000);
      function ready() { if (!button.disabled) { clearTimeout(timer); observer.disconnect(); resolve(); } }
      observer.observe(button,{attributes:true,attributeFilter:["disabled"]});
      ready();
    }));
  }
  async function open(kind, name) {
    await page.goto(`${base}/?create=graphic`, { waitUntil: "domcontentloaded" });
    await input("graphic-kind").waitFor();
    await input("graphic-width").fill("1080");
    await input("graphic-height").fill("1080");
    // The real kind-change handler resets dependent fields; no storage or API seeding.
    await input("graphic-kind").selectOption("single");
    await input("graphic-kind").selectOption(kind);
    await input("project-name").fill(`QA graphic ${name}`);
    await input("brief-audience").fill("Local QA customers");
    await input("brief-objective").fill("Verify local graphic creation without model execution.");
    await page.locator("details:has(#brief-content-source) > summary").click();
    await input("brief-content-source").selectOption("none");
    await input("brief-visual-mood").selectOption("formal");
    await input("brief-density").selectOption("balanced");
    assert.equal(await input("creation-backend").inputValue(), "codex");
    assert.equal(await input("creation-backend").isDisabled(), true);
    assert.equal(await input("brief-output-size").count(), 0);
    await enabledForm();
  }
  async function dimensions(width, height) {
    await input("graphic-width").fill(String(width));
    await input("graphic-height").fill(String(height));
  }
  async function reloadDraft(kind, name) {
    const draft = await draftAction({ name: `QA draft ${name}`, graphicKind: kind }, () => input("project-name").fill(`QA draft ${name}`));
    await page.reload({waitUntil:"domcontentloaded"});
    await input("graphic-kind").waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("bg.new-project.graphic")));
    assert.deepEqual(stored, draft);
    assert.equal(await input("graphic-kind").inputValue(), kind);
    for (const [id,key] of [["project-name","name"],["brief-audience","audience"],["brief-objective","objective"],["graphic-width","graphicWidth"],["graphic-height","graphicHeight"],["brief-content-source","contentSource"],["brief-visual-mood","visualMood"],["brief-density","density"]]) {
      assert.equal(await input(id).inputValue(), String(draft[key]));
    }
    if (!["single","product_detail"].includes(kind)) assert.equal(await input("graphic-frame-count").inputValue(), String(draft.frameCount));
    if (kind === "banner_set") {
      assert.equal(await rows().count(), draft.frames.length);
      for (let index=0; index<draft.frames.length; index++) {
        const values = await rows().nth(index).locator("input").evaluateAll(elements => elements.map(element => element.value));
        const frame = draft.frames[index];
        assert.deepEqual(values, [String(frame.width),String(frame.height),frame.label]);
      }
    }
    if (kind === "product_detail") for (const key of detailKeys) assert.equal(await input(`detail-brief-${key}`).inputValue(), draft.detailBrief[key] ?? "");
    await save(`${name}-draft`, draft);
    return draft;
  }

  async function create(name, expected = {}) {
    await enabledForm();
    assert.equal(await submit().isEnabled(), true, "Valid graphic form must permit creation");
    await shot(`${name}-form`);
    const responseSignal = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/projects", {timeout:60000});
    responseSignal.catch(() => {});
    await submit().click();
    const response = await responseSignal;
    const request = response.request().postDataJSON();
    const body = await response.json();
    http.push({method:"POST",path:"/api/projects",request,status:response.status(),body});
    await save("http",http);
    assert.equal(response.status(),201,JSON.stringify(body));
    const projectId = body.data.id;
    created.add(projectId);
    baselineRequest ??= structuredClone(request);
    await page.waitForURL(`${base}/projects/${projectId}`);
    const project = await get(`/api/projects/${projectId}`);
    const session = await get(`/api/projects/${projectId}/session`);
    const events = await get(`/api/sessions/${session.id}/events`);
    assert.equal(request.backend_id,"codex");
    assert.equal(project.backend_id,"codex");
    assert.equal(session.backend_id,"codex");
    assert.equal(session.status,"idle");
    assert.deepEqual(session.usage,{input:0,output:0,cached:0,cache_write:0});
    assert.equal(events.length,1,"Creation emits exactly its local artifact commit, never a model turn");
    assert.equal(events[0].event.type,"artifact.operation");
    assert.equal(events[0].event.outcome,"committed");
    assert.equal(events[0].event.revision,1);
    assert.ok(events[0].event.changedPaths.includes("index.html"));
    assert.equal(project.type,"graphic");
    assert.equal(project.entrypoint,"index.html");
    const options = JSON.parse(project.options_json);
    for (const key of ["graphic_canvas","graphic_set","design_brief"]) assert.deepEqual(options[key],request.options[key]);
    for (const [key,value] of Object.entries(expected)) assert.deepEqual(options[key],value);
    const directory = await realpath(project.dir_path);
    assert.ok(directory.startsWith(`${owned}${path.sep}`),"Created output must belong to the isolated profile");
    const filename = path.join(directory,project.entrypoint);
    const html = await readFile(filename,"utf8");
    const fonts = await readFile(path.join(directory,"fonts/fonts.css"),"utf8");
    assert.ok(fonts.includes("@font-face"));
    const served = await context.request.get(`${base}/api/projects/${projectId}/fs/index.html`,{headers});
    assert.equal(served.status(),200);
    const servedHtml = await served.text();
    const serialized = await page.evaluate(html => Array.from(new DOMParser().parseFromString(html,"text/html").querySelectorAll("[data-graphic-artboard]")).map(element => ({id:element.id,width:Number.parseFloat(element.style.width),height:Number.parseFloat(element.style.height)})),html);
    const servedFrames = await page.evaluate(html => Array.from(new DOMParser().parseFromString(html,"text/html").querySelectorAll("[data-graphic-artboard]")).map(element => ({id:element.id,width:Number.parseFloat(element.style.width),height:Number.parseFloat(element.style.height)})),servedHtml);
    assert.deepEqual(servedFrames,serialized);
    await writeFile(path.join(evidence,`${name}-index.html`),html);
    await save(`${name}-state`,{project,session,events,request,options,file:{sha256:sha256(html),bytes:Buffer.byteLength(html)},serialized});
    const frame = page.frameLocator('iframe[title="Canvas"]');
    await page.locator('iframe[title="Canvas"][aria-busy="false"]').waitFor({ timeout: 60000 });
    await frame.locator("[data-graphic-artboard]").first().waitFor({state:"visible",timeout:60000});
    const rendered = await frame.locator("[data-graphic-artboard]").evaluateAll(elements => elements.map(element => ({width:Number.parseFloat(getComputedStyle(element).width),height:Number.parseFloat(getComputedStyle(element).height)})));
    const intended = options.graphic_set.kind === "banner_set" ? options.graphic_set.frames.map(({width,height})=>({width,height})) : Array.from({length:options.graphic_set.frame_count},()=>({width:options.graphic_canvas.width,height:options.graphic_canvas.height}));
    await save(`${name}-geometry`,{intended,serialized,rendered});
    assert.deepEqual(serialized.map(({width,height})=>({width,height})),intended,"Actual HTML artboard dimensions must equal the submitted options");
    assert.deepEqual(rendered,intended,"Rendered artboards must retain their actual pixel dimensions");
    return {projectId,kind:options.graphic_set.kind,options,frames:rendered,fileSha256:sha256(html),sessionStatus:session.status};
  }
  async function cleanProjects() {
    // Delete only successful creations owned by this matrix; retain compact evidence first.
    if (created.size) await page.goto(`${base}/?create=graphic`,{waitUntil:"domcontentloaded"});
    for (const id of created) {
      const result = await api(`/api/projects/${id}`,"DELETE");
      if (result.status === 409) {
        assert.equal(result.body.error.code,"project_in_use",JSON.stringify(result));
        // A pending filesystem signal can temporarily block deletion. No timing retry:
        // the driver's finally removes the entire owned profile after stopping the backend.
        await save(`cleanup-deferred-${id}`,{id,reason:"project_in_use",owner:"driver isolated-profile cleanup"});
      } else assert.equal(result.status,204,JSON.stringify(result));
      created.delete(id);
    }
  }
  async function creationCase(name, action) {
    await scenario(name,action);
    await cleanProjects();
  }
  async function rejectApi(name, mutate, status=400, code="invalid_project_options") {
    assert.ok(baselineRequest,"A real browser creation must establish the boundary request");
    const request = structuredClone(baselineRequest);
    request.name = `QA negative ${name}`;
    mutate(request);
    const before = (await get("/api/projects?tab=mine&limit=1000")).map(project=>project.id).sort();
    const response = await api("/api/projects","POST",request);
    if (response.status === 201) created.add(response.body.data.id);
    assert.equal(response.status,status,JSON.stringify(response));
    assert.equal(response.body.error.code,code);
    const after = (await get("/api/projects?tab=mine&limit=1000")).map(project=>project.id).sort();
    assert.deepEqual(after,before,"Rejected creation must not create a database row");
    return response;
  }

  // Readiness is the first runnable check. login status never sends a provider turn.
  await scenario("graphic-authenticated-codex-readiness",async()=>{
    await page.goto(`${base}/?create=graphic`,{waitUntil:"domcontentloaded"});
    await input("graphic-kind").waitFor({timeout:60000});
    const bootstrap = await page.evaluate(async()=> (await (await fetch("/api/bootstrap")).json()).data);
    assert.equal(typeof bootstrap.capability,"string");
    headers = {"x-burnguard-capability":bootstrap.capability,origin:base};
    const detection = await get("/api/backends/detect");
    const codex = detection.backends.find(backend=>backend.id === "codex");
    assert.equal(codex?.found,true);
    assert.equal(codex.authenticated,true);
    const status = await promisify(execFile)(codex.binary_path,["login","status"],{timeout:10000});
    assert.match(`${status.stdout}\n${status.stderr}`,/logged in using/i);
    assert.deepEqual(await input("graphic-kind").locator("option").evaluateAll(options=>options.map(option=>option.value)),kinds);
    await save("readiness",{found:codex.found,authenticated:codex.authenticated,version:codex.version,loginStatus: `${status.stdout}${status.stderr}`.trim(),turnsSent:0});
    return {found:true,authenticated:true,probe:"codex login status",turnsSent:0};
  });
  if (!headers || failures.length) throw new Error("Authenticated readiness failed; see readiness scenario evidence");

  try {
    for (const kind of kinds) {
      const name = `graphic-kind-${kind}-draft-reload-create`;
      await creationCase(name,async()=>{
        await open(kind,name);
        assert.equal(await input("graphic-frame-count").count(),["single","product_detail"].includes(kind)?0:1);
        assert.equal(await rows().count(),kind === "banner_set"?1:0);
        assert.equal(await page.locator('[id^="detail-brief-"]:is(textarea)').count(),kind === "product_detail"?7:0);
        assert.equal(await platformButtons().count(),presets[kind].length);
        if (kind === "product_detail") {
          await dimensions(860,16000);
          for (const key of detailKeys) await input(`detail-brief-${key}`).fill(`${key}: local QA evidence`);
        }
        if (kind === "banner_set") {
          await input("graphic-frame-count").fill("3");
          for (const [index,[width,height,label]] of [[320,240,"Small"],[1200,628,"Wide"],[1080,1920,"Tall"]].entries()) {
            const fields = rows().nth(index).locator("input");
            await fields.nth(0).fill(String(width)); await fields.nth(1).fill(String(height)); await fields.nth(2).fill(label);
          }
        }
        const draft = await reloadDraft(kind,name);
        assert.equal(draft.frameCount,kind === "card_news"?6:kind === "banner_set"?3:1);
        return create(name);
      });
    }
    for (let index=0;index<common.length;index++) {
      const [width,height] = common[index], name = `graphic-common-preset-${width}x${height}`;
      await creationCase(name,async()=>{
        await open("single",name);
        const buttons = page.locator("fieldset:has(#graphic-width) button");
        assert.equal(await buttons.count(),3);
        await buttons.nth(index).click();
        assert.equal(await input("graphic-width").inputValue(),String(width));
        assert.equal(await input("graphic-height").inputValue(),String(height));
        return create(name,{graphic_canvas:{schema_version:1,width,height}});
      });
    }
    for (const kind of kinds) for (const [index,[id,width,height]] of presets[kind].entries()) {
      const name = `graphic-platform-${id}`;
      await creationCase(name,async()=>{
        await open(kind,name);
        assert.equal(await platformButtons().count(),presets[kind].length);
        const button = platformButtons().nth(index);
        if (width < 320 || height < 240) {
          assert.equal(await button.isDisabled(),true);
          assert.equal(await button.getAttribute("aria-pressed"),"false");
          return {id,width,height,disabled:true,reason:"below canvas minimum; no resizing or creation"};
        }
        assert.equal(await button.isEnabled(),true);
        await button.click();
        assert.equal(await button.getAttribute("aria-pressed"),"true");
        assert.equal(await input("graphic-width").inputValue(),String(width));
        assert.equal(await input("graphic-height").inputValue(),String(height));
        await reloadDraft(kind,name);
        assert.equal(await platformButtons().nth(index).getAttribute("aria-pressed"),"true");
        const observation = await create(name,{graphic_canvas:{schema_version:1,width,height}});
        assert.equal(observation.options.graphic_set.preset_id,id);
        if (kind === "banner_set") assert.deepEqual(observation.frames,[{width,height}],"Selecting a banner preset must size its default banner, not just unused canvas metadata");
        return observation;
      });
    }

    // Enumerate each independent brief choice once, not a Cartesian product.
    for (const [id,key,values] of [
      ["brief-content-source","content_source",["none","attached","template","existing_files"]],
      ["brief-visual-mood","visual_mood",["formal","friendly","premium"]],
      ["brief-density","density",["sparse","balanced","dense"]],
    ]) for (const value of values) {
      const name = `graphic-choice-${key}-${value}`;
      await creationCase(name,async()=>{
        await open("single",name);
        assert.deepEqual(await input(id).locator("option").evaluateAll(options=>options.map(option=>option.value)),values);
        await input(id).selectOption(value);
        const observation = await create(name);
        assert.equal(observation.options.design_brief[key],value);
        assert.equal(observation.options.design_brief.output_size,"custom");
        return observation;
      });
    }

    for (const [name,width,height] of [["minimum",320,240],["maximum-width",4096,240],["maximum-height",320,16384],["pixel-ceiling",4000,4000]]) {
      await creationCase(`graphic-canvas-${name}`,async()=>{
        await open("single",name); await dimensions(width,height);
        return create(`graphic-canvas-${name}`,{graphic_canvas:{schema_version:1,width,height}});
      });
    }
    const invalidDimensions = [
      ["width-empty","width","",0], ["width-nonnumeric","width","e",null],
      ["width-below","width","319",319], ["width-above","width","4097",4097], ["width-fraction","width","320.5",320.5],
      ["height-empty","height","",0], ["height-nonnumeric","height","e",null],
      ["height-below","height","239",239], ["height-above","height","16385",16385], ["height-fraction","height","240.5",240.5],
    ];
    for (const [name,dimension,uiValue,apiValue] of invalidDimensions) {
      await creationCase(`graphic-invalid-${name}`,async()=>{
        await open("single",name);
        const before = posts;
        if (uiValue === "e") {
          await input(`graphic-${dimension}`).fill("");
          await input(`graphic-${dimension}`).press("e");
        } else await input(`graphic-${dimension}`).fill(uiValue);
        assert.equal(await submit().isDisabled(),true);
        assert.equal(posts,before,"Invalid UI value must not submit");
        await shot(`graphic-invalid-${name}-form`);
        return rejectApi(name,request=>{request.options.graphic_canvas[dimension]=apiValue;});
      });
    }
    await creationCase("graphic-pixel-ceiling-over",async()=>{
      await open("single","pixel-ceiling-plus-one"); await dimensions(3201,5000);
      assert.equal(await submit().isDisabled(),true);
      return rejectApi("pixel-ceiling-plus-one",request=>{request.options.graphic_canvas={schema_version:1,width:3201,height:5000};});
    });

    for (const kind of ["card_news","banner_set","thumbnail","print"]) {
      for (const count of [1,40]) {
        const name = `graphic-${kind}-frame-count-${count}`;
        await creationCase(name,async()=>{
          await open(kind,name); await dimensions(320,240);
          await input("graphic-frame-count").fill(String(count));
          if (kind === "banner_set") assert.equal(await rows().count(),count);
          const observation = await create(name);
          assert.equal(observation.options.graphic_set.frame_count,count);
          assert.equal(observation.frames.length,count);
          return observation;
        });
      }
      for (const [name,value,apiValue] of [["empty","",null],["zero","0",0],["over","41",41],["fraction","1.5",1.5]]) {
        await creationCase(`graphic-${kind}-count-invalid-${name}`,async()=>{
          await open(kind,`${kind}-${name}`);
          await input("graphic-frame-count").fill(value);
          assert.equal(await submit().isDisabled(),true);
          return rejectApi(`${kind}-count-${name}`,request=>{
            request.options.graphic_set={schema_version:1,kind,frame_count:apiValue,...(kind === "banner_set"?{frames:[]}:{})};
          });
        });
      }
    }

    for (const key of detailKeys) {
      await creationCase(`graphic-detail-${key}-length-500`,async()=>{
        await open("product_detail",key); await dimensions(860,16000);
        const field = input(`detail-brief-${key}`);
        assert.equal(await field.getAttribute("maxlength"),"500");
        await field.fill("x".repeat(501));
        assert.equal((await field.inputValue()).length,500,"Browser must enforce the 500-character limit");
        await reloadDraft("product_detail",`detail-${key}`);
        const observation = await create(`graphic-detail-${key}-length-500`);
        assert.equal(observation.options.graphic_set.detail_brief[key],"x".repeat(500));
        return observation;
      });
      await creationCase(`graphic-detail-${key}-length-501-rejected`,()=>rejectApi(`detail-${key}-501`,request=>{
        request.options.graphic_set={schema_version:1,kind:"product_detail",frame_count:1,detail_brief:{[key]:"x".repeat(501)}};
      }));
    }
    await creationCase("graphic-detail-empty-optional-fields",async()=>{
      await open("product_detail","empty-detail"); await dimensions(860,16000);
      for (const key of detailKeys) await input(`detail-brief-${key}`).fill("");
      const observation = await create("graphic-detail-empty-optional-fields");
      assert.equal(observation.options.graphic_set.detail_brief,undefined);
      return observation;
    });

    for (const [name,width,height,valid] of [["minimum",320,240,true],["max-width",4096,240,true],["max-height",320,16384,true],["pixel-ceiling",4000,4000,true],["width-below",319,240,false],["height-below",320,239,false],["width-above",4097,240,false],["height-above",320,16385,false],["fraction",320.5,240,false],["pixel-over",3201,5000,false]]) {
      await creationCase(`graphic-banner-frame-${name}`,async()=>{
        await open("banner_set",name);
        await rows().first().locator("input").nth(0).fill(String(width));
        await rows().first().locator("input").nth(1).fill(String(height));
        if (valid) return create(`graphic-banner-frame-${name}`);
        assert.equal(await submit().isDisabled(),true);
        return rejectApi(`banner-${name}`,request=>{request.options.graphic_set={schema_version:1,kind:"banner_set",frame_count:1,frames:[{width,height,label:"Boundary"}]};});
      });
    }
    await creationCase("graphic-banner-label-length-80",async()=>{
      await open("banner_set","label-80");
      const label = rows().first().locator("input").nth(2);
      assert.equal(await label.getAttribute("maxlength"),"80");
      await label.fill("l".repeat(81));
      assert.equal((await label.inputValue()).length,80);
      const observation = await create("graphic-banner-label-length-80");
      assert.equal(observation.options.graphic_set.frames[0].label,"l".repeat(80));
      return observation;
    });
    await creationCase("graphic-banner-label-length-81-rejected",()=>rejectApi("label-81",request=>{request.options.graphic_set={schema_version:1,kind:"banner_set",frame_count:1,frames:[{width:320,height:240,label:"l".repeat(81)}]};}));
    await creationCase("graphic-backend-cannot-bypass-codex",()=>rejectApi("backend",request=>{request.backend_id="claude-code";},409,"graphic_requires_authenticated_codex"));
    await creationCase("graphic-kind-invalid-api",()=>rejectApi("kind",request=>{request.options.graphic_set.kind="unknown";}));
    await creationCase("graphic-banner-frame-count-mismatch",()=>rejectApi("mismatch",request=>{request.options.graphic_set={schema_version:1,kind:"banner_set",frame_count:2,frames:[{width:320,height:240,label:"only one"}]};}));

    await scenario("graphic-draft-project-type-isolation",async()=>{
      await open("thumbnail","type-isolation");
      const graphic = await draftAction({name:"QA graphic isolated"},()=>input("project-name").fill("QA graphic isolated"));
      await page.goto(`${base}/?create=prototype`,{waitUntil:"domcontentloaded"}); await input("project-name").waitFor();
      await draftAction({name:"QA prototype independent"},()=>input("project-name").fill("QA prototype independent"),"prototype");
      await page.goto(`${base}/?create=graphic`,{waitUntil:"domcontentloaded"}); await input("graphic-kind").waitFor();
      assert.equal(await input("project-name").inputValue(),graphic.name);
      assert.equal(await input("graphic-kind").inputValue(),graphic.graphicKind);
      await page.reload({waitUntil:"domcontentloaded"}); await input("graphic-kind").waitFor();
      assert.equal(await input("project-name").inputValue(),graphic.name);
      return {graphicDraftPreserved:true,prototypeDraftSeparate:true};
    });
    await scenario("graphic-no-paid-execution",async()=>{
      assert.deepEqual(deniedTurns,[],"Creation must not even attempt a model turn (all POSTs guarded)");
      return {guard:"POST /api/sessions/*/events aborted",attemptedTurns:0,realBrowserCreationRequests:posts};
    });
  } finally {
    await cleanProjects();
    await save("matrix",{outcomes,failures,deniedTurns,realBrowserCreationRequests:posts,assumptions:["Graphic subkinds share one graphic draft; each selected kind survives reload, not six simultaneous per-kind drafts.","Model execution is outside creation scope and is blocked.","Preset choice should produce the advertised default banner size; custom mixed frames are tested separately."]});
    await save("http",http);
  }
  if (failures.length) throw new Error(`${failures.length} graphic creation scenarios failed; see ${path.join(evidence,"defects.json")}`);
}
