import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeAndRestore } from './platform-guide-regression.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'packages/backend/package.json'));
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const labels = {html_zip:'HTML ZIP file',pdf:'PDF',pptx:'PowerPoint',handoff:'Developer handoff',png:'PNG',png_zip:'Frame ZIP',cafe24_package:'Cafe24 package',imweb_package:'Imweb package'};

// Exact response subscription, installed before the trigger. No timing sleeps or polling.
function observe(page, predicate, timeout = 180_000) {
  let finish;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Expected terminal response did not arrive')), timeout);
    finish = (error, value) => { clearTimeout(timer); page.off('response', listener); error ? reject(error) : resolve(value); };
    async function listener(response) {
      try { const value = await predicate(response); if (value) finish(null, value); }
      catch (error) { finish(error); }
    }
    page.on('response', listener);
  });
  // Mark rejection handled while the triggering click is in flight; callers still await it.
  promise.catch(() => {});
  return { promise, dispose: () => finish(null, null) };
}

export async function run({page, context, base, home, check, shot, evidence}) {
  assert.ok(path.basename(await realpath(home)).startsWith('burnguard-e2e-home-'));
  await mkdir(path.join(evidence, 'downloads'), {recursive:true});
  const defects = [], coverage = [], blocked = [], browserErrors = [];
  page.on('pageerror',error=>browserErrors.push({url:page.url(),error:String(error)}));
  page.on('response',response=>{if(response.status()>=400 && /\.(js|css)(?:\?|$)/.test(response.url()))browserErrors.push({url:response.url(),status:response.status()});});
  const save = (name, value) => writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value,null,2));
  const denied = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== base || /\/vercel(?:\/|$)|\/sessions\/[^/]+\/events$/.test(url.pathname) && req.method() === 'POST') {
      denied.push({method:req.method(),path:url.pathname}); await route.abort('blockedbyclient'); return;
    }
    await route.continue();
  });
  await context.addInitScript(() => { if(window.top===window)localStorage.setItem('burnguard.locale', 'en'); });
  await page.goto(base);
  await page.getByRole('tab',{name:'Recent work',exact:true}).waitFor();
  const bootstrap = await page.evaluate(async()=> (await (await fetch('/api/bootstrap')).json()));
  assert.ok(bootstrap.data,JSON.stringify(bootstrap));
  const headers = {'x-burnguard-capability':bootstrap.data.capability,origin:base};
  const seeded = await execute('bun', [path.join(root,'scripts/qa/fixtures/full-export/seed.ts'), home], {cwd:root,env:{...process.env,BG_APP_ROOT:path.join(home,'.burnguard')},timeout:60_000});
  const fixtures = JSON.parse(seeded.stdout.trim().split('\n').at(-1));
  await save('fixtures', Object.fromEntries(Object.entries(fixtures).map(([key,p])=>[key,{id:p.id,entrypoint:p.entrypoint,setup:'owned fixture service; no authenticated creation claim'}])));
  async function scenario(name, action, mode='live-local') {
    try { await check(name, async () => { const observation = await action(); coverage.push({name,status:'passed',mode}); return observation; }, mode); }
    catch (error) {
      const defect = {name,error:String(error.stack ?? error),url:page.url()}; defects.push(defect); coverage.push({name,status:'failed',mode});
      await writeFile(path.join(evidence,`${name}-dom.txt`),await page.locator('body').innerText());
      console.error(`EXPORT BLOCKER ${JSON.stringify(defect)}`);
      await save('defects',defects);
    }
  }
  async function open(key) {
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(`${base}/projects/${fixtures[key].id}`,{waitUntil:'domcontentloaded'});
    await page.locator('iframe[title="Canvas"]').waitFor({timeout:60_000});
    await page.frameLocator('iframe[title="Canvas"]').locator('h1').first().waitFor();
  }
  async function menu() {
    if (!await page.locator('[data-export-menu-content]').isVisible()) await page.getByRole('button',{name:'Export',exact:true}).click();
    await page.locator('[data-export-menu-content]').waitFor();
  }
  const rows = async key => (await (await page.request.get(`${base}/api/projects/${fixtures[key].id}/exports`)).json()).data;
  function terminal(key, previous) {
    return observe(page, async response => {
      const url = new URL(response.url());
      if (response.request().method() !== 'GET' || !response.ok() || !(url.pathname === `/api/projects/${fixtures[key].id}/exports` || /^\/api\/exports\/[^/]+$/.test(url.pathname))) return;
      const data = (await response.json()).data;
      return (Array.isArray(data)?data:[data]).find(job => job.project_id === fixtures[key].id && !previous.has(job.latest_attempt?.id) && ['succeeded','failed'].includes(job.status));
    });
  }
  async function job(key, name, format, label, options, trigger, expectedStatus='succeeded') {
    await menu();
    const previous = new Set((await rows(key)).map(row=>row.latest_attempt?.id));
    const settled = terminal(key, previous);
    const created = observe(page, async response => {
      if (response.request().method() !== 'POST' || !(new URL(response.url()).pathname === `/api/projects/${fixtures[key].id}/exports` || /\/retry$/.test(new URL(response.url()).pathname))) return;
      const body = await response.json(); await save(`${name}-create`,{status:response.status(),request:response.request().postDataJSON(),body});
      assert.equal(response.status(),202,JSON.stringify(body)); return body.data;
    });
    try {
      await (trigger ? trigger() : page.getByRole('menuitem',{name:label,exact:typeof label==='string'}).click());
      const first = await created.promise, finished = await settled.promise;
      assert.equal(finished.id,first.id); assert.equal(finished.format,format);
      await save(`${name}-job`,finished);
      if (options) for (const [key,value] of Object.entries(options)) assert.equal(finished.options[key],value);
      assert.equal(finished.status,expectedStatus,`${finished.error_message}; ${JSON.stringify(finished.latest_attempt)}`);
      return finished;
    } finally { created.dispose(); settled.dispose(); }
  }
  async function download(name, finished) {
    await menu();
    const button = page.getByRole('button',{name:`Download ${labels[finished.format]}`,exact:true}).first();
    await button.waitFor();
    const event = page.waitForEvent('download',{timeout:30_000});
    const requested=page.waitForResponse(response=>/\/api\/exports\/[^/]+\/download$/.test(new URL(response.url()).pathname));
    await button.click();
    const [downloaded,response] = await Promise.all([event,requested]);
    await save(`${name}-download-identity`,{expectedJob:finished.id,actualPath:new URL(response.url()).pathname,status:response.status()});
    assert.equal(new URL(response.url()).pathname,`/api/exports/${finished.id}/download`,'The visible Download action must target the job just prepared');
    assert.equal(await downloaded.failure(),null);
    const filename = downloaded.suggestedFilename(); assert.ok(!/[\\/]/.test(filename));
    const target = path.join(evidence,'downloads',`${name}-${filename}`);
    await downloaded.saveAs(target);
    const bytes = await readFile(target); assert.ok(bytes.length > 50);assert.equal(digest(bytes),finished.latest_attempt.digests.output);
    await save(`${name}-download`,{job:finished.id,filename,bytes:bytes.length,sha256:digest(bytes),target});
    return bytes;
  }
  async function image(bytes, dimensions, name) {
    const decoded = await loadImage(bytes); assert.deepEqual([decoded.width,decoded.height],dimensions);
    const canvas = createCanvas(decoded.width,decoded.height), ctx = canvas.getContext('2d'); ctx.drawImage(decoded,0,0);
    const rgba = [...ctx.getImageData(10,Math.min(200,decoded.height-1),1,1).data];
    assert.ok(Math.max(...rgba.slice(0,3))-Math.min(...rgba.slice(0,3)) > 40, 'Expected colored artwork, not blank/editor chrome');
    return {name,width:decoded.width,height:decoded.height,sample:rgba};
  }
  async function archive(bytes) {
    const zip = await JSZip.loadAsync(bytes,{checkCRC32:true});
    for (const entry of Object.values(zip.files)) {
      assert.ok(!entry.name.startsWith('/') && !entry.name.split('/').includes('..'));
      assert.ok(!/^(?:\.attachments|\.meta|\.burnguard-inputs)\//.test(entry.name));
      if (!entry.dir) assert.ok(!(await entry.async('nodebuffer')).includes(Buffer.from('PRIVATE_EXPORT_SENTINEL')));
    }
    return zip;
  }
  async function offline(zip, entrypoint, name, sentinel) {
    const directory = path.join(evidence,'offline',name); await mkdir(directory,{recursive:true});
    for (const entry of Object.values(zip.files).filter(file=>!file.dir)) {
      const target = path.join(directory,entry.name); await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,await entry.async('nodebuffer'));
    }
    const offlineContext = await context.browser().newContext();
    await offlineContext.route(/^https?:/, route=>route.abort('blockedbyclient'));
    const browserPage = await offlineContext.newPage();
    try {
      await browserPage.goto(pathToFileURL(path.join(directory,entrypoint)).href,{waitUntil:'load'});
      assert.ok((await browserPage.locator('body').innerText()).includes(sentinel));
      assert.equal(await browserPage.locator('[data-testid="quick-comment-popup"], [data-export-menu-content]').count(),0);
      const assets = await browserPage.locator('img').evaluateAll(images=>images.map(image=>({complete:image.complete,width:image.naturalWidth})));
      assert.ok(assets.every(asset=>asset.complete && asset.width>0));
      await browserPage.screenshot({path:path.join(evidence,`${name}-offline.png`),animations:'disabled'});
      return {entrypoint,assets,offline:true};
    } finally { await offlineContext.close(); }
  }
  async function html(bytes,key,name) {
    const zip = await archive(bytes), manifest = JSON.parse(await zip.file('burnguard-export.json').async('string'));
    assert.equal(manifest.entrypoint,fixtures[key].entrypoint);
    for (const entry of manifest.entries) { const data=await zip.file(entry.path).async('nodebuffer'); assert.equal(digest(data),entry.sha256); assert.equal(data.length,entry.size); }
    const sentinel = key==='web'?'EXPORT_WEB_SENTINEL':key==='deck'?'EXPORT_SLIDE_1':`EXPORT_${key}_SENTINEL`;
    return {manifest,render:await offline(zip,manifest.entrypoint,name,sentinel)};
  }
  async function pdf(bytes,dimensions,count,name) {
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    const document = await PDFDocument.load(bytes); assert.equal(document.getPageCount(),count);
    const sizes=document.getPages().map(page=>[page.getWidth(),page.getHeight()]);
    for (const size of sizes) dimensions.forEach((dimension,i)=>{ assert.ok(Math.abs(size[i]-dimension)<1,`${size} != ${dimensions}`); });
    const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
    const loading=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,disableFontFace:true});
    const rendered=await loading.promise;
    try {
      for (let i=1;i<=count;i++) {
        const p=await rendered.getPage(i), viewport=p.getViewport({scale:0.5}), canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        await writeFile(path.join(evidence,`${name}-page-${i}.png`),canvas.toBuffer('image/png'));
        const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let colored=0; for(let n=0;n<pixels.length;n+=4) if(Math.max(pixels[n],pixels[n+1],pixels[n+2])-Math.min(pixels[n],pixels[n+1],pixels[n+2])>40) colored++;
        assert.ok(colored>canvas.width*canvas.height*.15,'PDF lost background artwork');
        const text=(await p.getTextContent()).items.map(item=>item.str??'').join(' '); assert.ok(!text.includes('NOTES_SENTINEL'));
      }
    } finally { await loading.destroy(); }
    return {count,sizes,rasterized:true};
  }
  async function pptx(bytes,size) {
    const zip=await archive(bytes), slides=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort();
    assert.equal(slides.length,2);
    const presentation=await zip.file('ppt/presentation.xml').async('string');
    const dimensions=/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presentation); assert.ok(dimensions);
    assert.ok(Math.abs(Number(dimensions[1])/Number(dimensions[2])-(size==='16x9'?16/9:4/3))<.001);
    for(let i=0;i<slides.length;i++) {
      const xml=await zip.file(slides[i]).async('string'); assert.equal((xml.match(/<p:pic>/g)??[]).length,1); assert.equal((xml.match(/<p:sp>/g)??[]).length,0);
      assert.ok((await zip.file(`ppt/notesSlides/notesSlide${i+1}.xml`).async('string')).includes(`NOTES_SENTINEL_${i+1}`));
    }
    const media=Object.values(zip.files).filter(file=>/^ppt\/media\/.*\.png$/.test(file.name)); assert.equal(media.length,2);
    const images=[]; for(const entry of media) images.push(await image(await entry.async('nodebuffer'),[2560,1440],entry.name));
    return {size,slides:slides.length,editableObjects:false,speakerNotes:true,images};
  }
  async function pngZip(bytes,dimensions) {
    const zip=await archive(bytes), entries=Object.values(zip.files).filter(file=>/\.(png|jpe?g)$/.test(file.name)).sort((a,b)=>a.name.localeCompare(b.name));
    assert.equal(entries.length,dimensions.length);
    const images=[]; for(let i=0;i<entries.length;i++) images.push(await image(await entries[i].async('nodebuffer'),dimensions[i],entries[i].name));
    return images;
  }

  for (const key of ['web','deck','other','from_template']) await scenario(`html-${key}`,async()=>{
    await open(key); const name=`html-${key}`, finished=await job(key,name,'html_zip','HTML ZIP file');
    const result=await html(await download(name,finished),key,name); await save(`${name}-inspection`,result); return result;
  });
  for(const [paper,label,dimensions] of [['a4','PDF · A4 landscape',[841.89,595.28]],['letter','PDF · Letter landscape',[792,612]],['widescreen-16x9','PDF · 16:9 widescreen',[959.976,540]]]) await scenario(`pdf-${paper}`,async()=>{
    await open('deck'); const name=`pdf-${paper}`,finished=await job('deck',name,'pdf',label,{pdf_paper:paper});
    const result=await pdf(await download(name,finished),dimensions,2,name); await save(`${name}-inspection`,result); return result;
  });
  for(const size of ['16x9','4x3']) await scenario(`pptx-${size}`,async()=>{
    await open('deck');const name=`pptx-${size}`,finished=await job('deck',name,'pptx',new RegExp(`^PowerPoint · ${size.replace('x',':')}`),{pptx_size:size});
    const result=await pptx(await download(name,finished),size);await save(`${name}-inspection`,result);return result;
  });
  await scenario('handoff',async()=>{
    await open('web');const finished=await job('web','handoff','handoff','Developer handoff (.zip)'),zip=await archive(await download('handoff',finished));
    const spec=JSON.parse(await zip.file('spec.json').async('string'));assert.equal(spec.project.id,fixtures.web.id);assert.ok(spec.pages[0].nodes.some(node=>node.bg_id==='hero'));
    assert.ok(zip.file('README.txt'));await offline(zip,'source/index.html','handoff','EXPORT_WEB_SENTINEL');return {entries:Object.keys(zip.files),spec};
  });
  await scenario('graphic-single-png',async()=>{
    await open('single');const finished=await job('single','single-png','png','PNG · 640×480',{png_width:640,png_height:480,png_dpr:1});return image(await download('single-png',finished),[640,480],'single');
  });
  for(const [key,dimensions] of [['deck',[[1280,720],[1280,720]]],['multi',[[640,480],[640,480]]],['mixed',[[640,480],[800,400]]]]) await scenario(`png-zip-${key}`,async()=>{
    await open(key);const name=`png-zip-${key}`,finished=await job(key,name,'png_zip','PNG bundle (ZIP)');const result=await pngZip(await download(name,finished),dimensions);await save(`${name}-inspection`,result);return result;
  });
  for(const key of ['single','multi']) await scenario(`artboard-pdf-${key}`,async()=>{
    await open(key);const name=`artboard-pdf-${key}`,finished=await job(key,name,'pdf','PDF · Artboard size',{pdf_paper:'artboard'});return pdf(await download(name,finished),[480,360],key==='single'?1:2,name);
  });
  await scenario('mixed-artboard-pdf-rejection',async()=>{
    await open('mixed');await menu();assert.equal(await page.getByRole('menuitem',{name:/^PDF · Artboard size/}).getAttribute('aria-disabled'),'true');
    const response=await page.request.post(`${base}/api/projects/${fixtures.mixed.id}/exports`,{headers,data:{format:'pdf',options:{pdf_paper:'artboard'}}});const body=await response.json();assert.equal(response.status(),400);await save('mixed-pdf-api-rejection',body);return body;
  });
  for(const [height,format,quality,dimensions] of [[3000,'png',85,[[640,2000],[640,3000],[640,1500]]],[5000,'png',85,[[640,2000],[640,4500]]],[5000,'jpeg',60,[[640,2000],[640,4500]]],[3000,'jpeg',95,[[640,2000],[640,3000],[640,1500]]]]) await scenario(`slices-${height}-${format}-${quality}`,async()=>{
    await open('detail');await menu();await page.locator('#export-slice-height').selectOption(String(height));await page.locator('#export-slice-format').selectOption(format);
    if(format==='jpeg') {await page.locator('#export-jpeg-quality').fill(String(quality));}
    await page.reload();await menu();assert.equal(await page.locator('#export-slice-height').inputValue(),String(height));assert.equal(await page.locator('#export-slice-format').inputValue(),format);
    if(format==='jpeg')assert.equal(await page.locator('#export-jpeg-quality').inputValue(),String(quality));
    const name=`slices-${height}-${format}-${quality}`,finished=await job('detail',name,'png_zip','PNG bundle (ZIP)',{slice_height:height,slice_format:format,...(format==='jpeg'?{jpeg_quality:quality}:{})});
    const bytes=await download(name,finished),result=await pngZip(bytes,dimensions);assert.ok(result.every(row=>row.name.endsWith(format==='png'?'.png':'.jpg')));assert.equal(result.reduce((sum,row)=>sum+row.height,0),6500);
    const zip=await archive(bytes),stitched=createCanvas(640,6500),ctx=stitched.getContext('2d');let top=0;
    for(const row of result) {ctx.drawImage(await loadImage(await zip.file(row.name).async('nodebuffer')),0,top);top+=row.height;}
    for(const [y,expected] of [[500,[18,120,196]],[2500,[212,107,36]],[5200,[212,107,36]],[6000,[38,136,74]]]) {
      const actual=ctx.getImageData(10,y,1,1).data;expected.forEach((value,index)=>{assert.ok(Math.abs(actual[index]-value)<8,'Slice concatenation must preserve source regions without gaps');});
    }
    assert.equal(finished.latest_attempt.findings.some(f=>f.code==='png_zip:cut_through_content'),height===3000);
    await save(`${name}-inspection`,{images:result,gapFreeSourceRegions:true,forcedCut:height===3000});return result;
  });

  for (const [platform,assetUrl] of [['cafe24',''],['cafe24','/web/upload/qa-custom/'],['imweb',''],['imweb','https://assets.example.invalid/qa/']]) await scenario(`platform-${platform}-${assetUrl?'custom':'default'}`,async()=>{
    await open('web');await menu();await page.locator('#export-asset-base-url').fill(assetUrl);
    await page.reload();await menu();assert.equal(await page.locator('#export-asset-base-url').inputValue(),assetUrl);
    const name=`platform-${platform}-${assetUrl?'custom':'default'}`,format=`${platform}_package`;
    const finished=await job('web',name,format,platform==='cafe24'?'Cafe24 Smart Design package':'Imweb code widget package');
    const zip=await archive(await download(name,finished));
    const manifestName='burnguard-export.json';assert.ok(zip.file(manifestName));
    const manifest=JSON.parse(await zip.file(manifestName).async('string'));assert.equal(manifest.platform,platform);
    assert.equal(manifest.asset_base_url,assetUrl || (platform==='cafe24'?'/web/upload/burnguard/':null));
    for(const entry of manifest.entries) { const bytes=await zip.file(entry.path).async('nodebuffer');assert.equal(digest(bytes),entry.sha256);assert.equal(bytes.length,entry.size); }
    const lint=JSON.parse(await zip.file('lint.json').async('string'));assert.equal(lint.verification_status,'documentation_tested');
    const htmlNames=Object.keys(zip.files).filter(file=>/^pages\/.*\.html$/.test(file));assert.equal(htmlNames.length,2);
    const snippets=(await Promise.all(htmlNames.map(file=>zip.file(file).async('string')))).join('\n');
    if(platform==='imweb') {
      assert.ok(zip.file('common/header-code.html'));assert.ok(zip.file('common/footer-code.html'));
      assert.ok(snippets.includes(assetUrl || 'data:image/svg+xml'));
      assert.ok(!snippets.includes('fonts.googleapis.com'));
    } else assert.ok(zip.file('layout/burnguard-layout.html'));
    const guideName=manifest.roles.find(role=>role.role==='guide' && role.path.endsWith('.html'))?.path;assert.ok(guideName);
    await offline(zip,guideName,`${name}-guide`,'');
    await save(`${name}-inspection`,{manifest,lint,downloadInspected:true,guideRenderedOffline:true});
    const guideButton=page.getByRole('button',{name:`View ${labels[format]} installation guide`,exact:true,includeHidden:true}).first();
    await guideButton.click();const dialog=page.getByRole('dialog');await dialog.waitFor();
    await page.setViewportSize({width:390,height:844});
    for(let i=0;i<4;i++) {await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);}
    await dialog.getByRole('heading',{name:'Rollback',exact:true}).scrollIntoViewIfNeeded();
    await dialog.getByRole('heading',{name:'Not supported',exact:true}).scrollIntoViewIfNeeded();
    assert.ok((await dialog.boundingBox()).width<=390);await shot(`${name}-guide-narrow`);
    await scenario(`${name}-guide-unobscured`,async()=>{
      const hit=await dialog.getByRole('heading',{name:'Not supported',exact:true}).evaluate(node=>{const rect=node.getBoundingClientRect(),target=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return {unobscured:node.closest('[role="dialog"]').contains(target),hitRole:target?.getAttribute('role'),hitTag:target?.tagName};});
      await save(`${name}-guide-hit-test`,hit);assert.equal(hit.unobscured,true,'The open guide must paint above the Export menu');return hit;
    });
    await closeAndRestore(page,guideButton,()=>page.keyboard.press('Escape'));
    await save(`${name}-guide-focus`,await page.evaluate(()=>({activeTag:document.activeElement?.tagName,activeRole:document.activeElement?.getAttribute('role'),activeLabel:document.activeElement?.getAttribute('aria-label'),dialogCount:document.querySelectorAll('[role="dialog"]').length})));
    assert.equal(await guideButton.evaluate(node=>node===document.activeElement),true);
    await save(`${name}-inspection`,{manifest,lint});return {manifest,lint,guideNarrow:true,externalInstallation:false};
  });
  await scenario('asset-url-validation',async()=>{
    await open('web');await menu();const observations=[];
    for(const value of ['https://name:password@example.invalid/a/','https://example.invalid/a/?x=1','https://example.invalid/a/#fragment','/assets/../secret/','//example.invalid/assets/','http://example.invalid/assets/']) {
      await page.locator('#export-asset-base-url').fill(value);
      const response=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/projects/${fixtures.web.id}/exports`);
      await page.getByRole('menuitem',{name:'Cafe24 Smart Design package',exact:true}).click();const rejected=await response,body=await rejected.json();
      assert.equal(rejected.status(),400,JSON.stringify(body));assert.equal(body.error.code,'invalid_export_options');assert.equal(await page.locator('#export-asset-base-url').inputValue(),value);
      observations.push({value,status:rejected.status(),body});
    }
    await page.locator('#export-asset-base-url').fill('/retained/options/');await open('other');await menu();assert.equal(await page.locator('#export-asset-base-url').inputValue(),'');
    await open('web');await menu();assert.equal(await page.locator('#export-asset-base-url').inputValue(),'/retained/options/');await save('asset-validation',observations);return observations;
  });

  let qualityReport;
  await scenario('quality-real-findings-and-advisory-export',async()=>{
    await open('web');await page.getByRole('button',{name:'Quality review',exact:true}).click();
    await page.getByRole('button',{name:'Check again',exact:true}).waitFor();
    const response=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/projects/${fixtures.web.id}/design-audit/retry`,{timeout:120_000});
    await page.getByRole('button',{name:'Check again',exact:true}).click();const result=await response;assert.equal(result.status(),200);qualityReport=(await result.json()).data;await save('quality-real-report',qualityReport);
    const findings=qualityReport.checks.flatMap(check=>check.findings);assert.ok(findings.length>0);assert.ok(qualityReport.checks.some(check=>check.status==='pass'));
    await page.getByRole('heading',{name:/^Issues to fix/}).waitFor();await page.getByRole('heading',{name:/^Recommended/}).waitFor();
    const reveal=page.getByRole('button',{name:'Show location',exact:true}).first();if(await reveal.count())await reveal.click();
    const file=page.getByRole('button',{name:'Open file',exact:true}).first();if(await file.count())await file.click();
    await shot('quality-real-findings');
    const finished=await job('web','advisory-export','html_zip','HTML ZIP file');await html(await download('advisory-export',finished),'web','advisory-export');return {overall:qualityReport.overall_status,findings:findings.length,exportSucceeded:true};
  });
  await scenario('ux-real-findings-library-and-empty',async()=>{
    await open('web');await page.getByRole('button',{name:'Quality review',exact:true}).click();
    const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${fixtures.web.id}/ux-review`);
    await page.getByRole('tab',{name:'UX improvements',exact:true}).click();const reviewed=await response;assert.equal(reviewed.status(),200);const report=(await reviewed.json()).data;await save('ux-real-report',report);
    assert.ok(report.findings.some(f=>f.code==='input_label'));assert.ok(report.findings.some(f=>f.code==='heading_jump'));assert.equal(report.basis,'local_html_heuristics');
    await page.getByRole('button',{name:'Review again',exact:true}).waitFor();
    const rerun=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${fixtures.web.id}/ux-review`);
    await page.getByRole('button',{name:'Review again',exact:true}).click();assert.equal((await rerun).status(),200);
    const search=page.getByRole('searchbox',{name:'Search patterns',exact:true});await search.fill('zz-no-such-pattern-zz');
    const library=page.locator('section[aria-labelledby="ux-pattern-title"]');assert.equal(await library.locator('article').count(),0);
    await search.fill('');assert.ok(await library.locator('article').count()>0);await library.locator('summary').first().click();await shot('ux-pattern-guidance');
    await open('clean');await page.getByRole('button',{name:'Quality review',exact:true}).click();
    const empty=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${fixtures.clean.id}/ux-review`);
    await page.getByRole('tab',{name:'UX improvements',exact:true}).click();const emptyReport=(await (await empty).json()).data;assert.deepEqual(emptyReport.findings,[]);await save('ux-empty-report',emptyReport);return {findings:report.findings,emptyReport};
  });
  await scenario('quality-cold-error-and-retry',async()=>{
    const endpoint=`**/api/projects/${fixtures.clean.id}/design-audit`;const fail=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'audit_unavailable',message:'Explicit synthetic cold audit failure'}})});
    await page.route(endpoint,fail);
    try {await open('clean');await page.getByRole('button',{name:'Quality review',exact:true}).click();await page.locator('[role="tabpanel"]').filter({has:page.getByRole('heading',{name:'Quality review',exact:true})}).getByRole('alert').waitFor();await shot('quality-cold-error');}
    finally {await page.unroute(endpoint,fail);}
    const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${fixtures.clean.id}/design-audit/retry`,{timeout:120_000});
    await page.getByRole('button',{name:'Check again',exact:true}).click();assert.equal((await response).status(),200);return {syntheticFailure:true,realRetry:true};
  },'synthetic-failure-real-recovery');

  for(const state of ['stale','error'])await scenario(`ux-${state}-and-recovery`,async()=>{
    const endpoint=`**/api/projects/${fixtures.web.id}/ux-review*`;
    const intercept=async route=>{
      if(state==='error')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'review_unavailable',message:'Synthetic UX error'}})});
      else {const real=await route.fetch(),body=await real.json();assert.ok(body.data);await route.fulfill({response:real,json:{data:{...body.data,artifact_revision:0,artifact_digest:'0'.repeat(64)}}});}
    };
    await page.route(endpoint,intercept);
    try {
      await open('web');await page.getByRole('button',{name:'Quality review',exact:true}).click();
      const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${fixtures.web.id}/ux-review`);await page.getByRole('tab',{name:'UX improvements',exact:true}).click();await response;
      const panel=page.locator('[role="tabpanel"]').filter({has:page.getByRole('heading',{name:'UX review and improvements',exact:true})});
      if(state==='error')await panel.getByRole('alert').waitFor();
      else {await page.getByRole('button',{name:'Ask AI to apply this proposal',exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Ask AI to apply this proposal',exact:true}).first().isDisabled(),true);}
      await shot(`ux-${state}`);
    } finally {await page.unroute(endpoint,intercept);}
    const recovered=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${fixtures.web.id}/ux-review`);await page.getByRole('button',{name:'Review again',exact:true}).click();assert.equal((await recovered).status(),200);await page.getByRole('button',{name:'Ask AI to apply this proposal',exact:true}).first().waitFor();return {syntheticState:state,realRecovery:true};
  },'synthetic-state-real-recovery');
  for(const key of ['web','deck','single'])await scenario(`share-prepare-${key}`,async()=>{
    await open(key);await page.getByRole('button',{name:'Share',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
    const token=dialog.getByLabel('Vercel token',{exact:true}),publish=dialog.getByRole('button',{name:'Publish publicly to Vercel',exact:true});
    assert.equal(await token.inputValue(),'');assert.equal(await publish.isDisabled(),true);
    const previous=new Set((await rows(key)).map(row=>row.latest_attempt?.id)),settled=terminal(key,previous);
    const created=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/projects/${fixtures[key].id}/exports`);
    let finished;
    try {await dialog.getByRole('button',{name:'Prepare current output',exact:true}).click();const response=await created;assert.equal(response.status(),202);assert.deepEqual(response.request().postDataJSON(),{format:'html_zip',options:{skip_quality_check:true}});finished=await settled.promise;}
    finally {settled.dispose();}
    await save(`share-${key}-job`,finished);assert.equal(finished.status,'succeeded',finished.error_message);
    await dialog.getByRole('status').filter({hasText:/Revision \d+ ready/}).waitFor();assert.equal(await publish.isDisabled(),true);
    // Synthetic, never submitted and cleared before screenshots/evidence.
    await token.fill('LOCAL_ONLY_NOT_A_TOKEN');assert.equal(await publish.isEnabled(),true);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    await page.getByRole('button',{name:'Share',exact:true}).click();assert.equal(await page.getByLabel('Vercel token',{exact:true}).inputValue(),'');
    assert.equal(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes('LOCAL_ONLY_NOT_A_TOKEN')),false);
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
    await scenario(`share-menu-current-${key}`,async()=>{await download(`share-current-${key}`,finished);return {currentJobVisible:true};});
    // A stale menu remains a separate failing check; reload permits independent inspection
    // of the actual prepared output without mistaking an older Download action for it.
    await open(key);const bytes=await download(`share-${key}`,finished),zip=await archive(bytes);const manifest=JSON.parse(await zip.file('burnguard-export.json').async('string'));
    assert.equal(manifest.project_revision,finished.latest_attempt.project_revision);await save(`share-${key}-manifest`,manifest);return {preparedRevision:manifest.project_revision,format:finished.format,tokenCleared:true,published:false};
  });
  await scenario('share-preparation-failure',async()=>{
    await open('web');await page.getByRole('button',{name:'Share',exact:true}).click();
    const endpoint=`**/api/projects/${fixtures.web.id}/exports`,fail=async route=>{if(route.request().method()==='POST')await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'stale_artifact_identity',message:'Synthetic share failure'}})});else await route.continue();};
    await page.route(endpoint,fail);
    try {await page.getByRole('button',{name:'Prepare current output',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Publish publicly to Vercel',exact:true}).isDisabled(),true);await shot('share-prepare-failure');}
    finally {await page.unroute(endpoint,fail);await page.keyboard.press('Escape');}
    return {syntheticFailure:true,noPublication:true};
  },'synthetic-ui');
  await scenario('quality-safe-fix-stale-and-undo',async()=>{
    await open('web');await page.getByRole('button',{name:'Quality review',exact:true}).click();
    const rerun=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${fixtures.web.id}/design-audit/retry`,{timeout:120_000});
    await page.getByRole('button',{name:'Check again',exact:true}).click();const report=(await (await rerun).json()).data;
    const finding=report.checks.flatMap(check=>check.findings).find(f=>f.safe_fix);assert.ok(finding,'Fixture must produce an actionable real safe fix');
    const before=await readFile(path.join(fixtures.web.dir_path,finding.safe_fix.rel_path),'utf8');
    const patched=page.waitForResponse(r=>r.request().method()==='PATCH' && new URL(r.url()).pathname===`/api/projects/${fixtures.web.id}/fs/${finding.safe_fix.rel_path}`);
    await page.getByRole('button',{name:'Apply safe fix',exact:true}).first().click();const response=await patched;assert.equal(response.status(),200);const change=(await response.json()).data;
    const after=await readFile(path.join(fixtures.web.dir_path,finding.safe_fix.rel_path),'utf8');assert.notEqual(after,before);await save('quality-safe-fix',{finding,change,beforeHash:digest(before),afterHash:digest(after)});
    const endpoint=`**/api/projects/${fixtures.web.id}/design-audit`,stale=route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:report})});
    await page.route(endpoint,stale);
    try {await open('web');await page.getByRole('button',{name:'Quality review',exact:true}).click();const fix=page.getByRole('button',{name:'Apply safe fix',exact:true}).first();await fix.waitFor();assert.equal(await fix.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Fix issues automatically',exact:true}).isDisabled(),true);await shot('quality-stale-disabled');}
    finally {await page.unroute(endpoint,stale);}
    const undone=page.waitForResponse(r=>r.request().method()==='POST' && /\/undo$/.test(new URL(r.url()).pathname));
    await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('Control+z');assert.equal((await undone).status(),200);
    assert.equal(await readFile(path.join(fixtures.web.dir_path,finding.safe_fix.rel_path),'utf8'),before);return {realSafeFix:true,syntheticOldReport:true,staleActionsDisabled:true,realUndo:true};
  },'live-local-and-synthetic-stale-report');
  await scenario('ux-ai-request-routing-no-repair',async()=>{
    await open('web');await page.getByRole('button',{name:'Quality review',exact:true}).click();await page.getByRole('tab',{name:'UX improvements',exact:true}).click();
    const before=digest(await readFile(path.join(fixtures.web.dir_path,'index.html'))),endpoint=`**/api/sessions/${fixtures.web.session_id}/events`;
    const model=page.getByRole('combobox',{name:'Generation model',exact:true});await model.selectOption('sonnet');
    const intercept=async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'backend_unavailable',message:'Explicit synthetic routing-only response'}})});else await route.continue();};
    await page.route(endpoint,intercept);
    try {
      const sent=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/sessions/${fixtures.web.session_id}/events`);
      await page.getByRole('button',{name:'Ask AI to apply this proposal',exact:true}).first().click();const response=await sent,request=response.request().postDataJSON();
      await save('ux-ai-routing',{mode:'explicit synthetic 503; no provider send and no repaired output',request});
      assert.equal(response.status(),503);assert.ok(request.text.includes('index.html'));assert.equal(request.generation.model,'sonnet');assert.ok(request.generation.effort);
      await save('ux-ai-routing',{mode:'explicit synthetic 503; no provider send and no repaired output',request});assert.equal(digest(await readFile(path.join(fixtures.web.dir_path,'index.html'))),before);return {requestCaptured:true,repairedOutput:false};
    } finally {await page.unroute(endpoint,intercept);}
  },'synthetic-ai-routing-only');
  await scenario('platform-lint-failure',async()=>{
    await open('lintFailure');const finished=await job('lintFailure','imweb-lint-failure','imweb_package','Imweb code widget package',undefined,undefined,'failed');
    assert.ok(finished.latest_attempt.findings.some(f=>f.code==='imweb_page_over_1m_chars'));assert.equal(await page.getByRole('button',{name:'Download Imweb package',exact:true}).count(),0);
    return {job:finished,failedBeforeDownload:true};
  });
  for(const family of ['quality','platform'])await scenario(`${family}-ai-request-routing-no-repair`,async()=>{
    const key=family==='quality'?'web':'lintFailure';await open(key);
    await page.getByRole('combobox',{name:'Generation model',exact:true}).selectOption('sonnet');
    if(family==='quality') {
      await page.getByRole('button',{name:'Quality review',exact:true}).click();
      await page.getByRole('button',{name:'Fix issues automatically',exact:true}).and(page.locator(':enabled')).waitFor();
      const rerun=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/projects/${fixtures[key].id}/design-audit/retry`,{timeout:120_000});await page.getByRole('button',{name:'Check again',exact:true}).click();assert.equal((await rerun).status(),200);
    } else await menu();
    const endpoint=`**/api/sessions/${fixtures[key].session_id}/events`,before=digest(await readFile(path.join(fixtures[key].dir_path,'index.html')));
    const intercept=async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'backend_unavailable',message:'Synthetic request capture only'}})});else await route.continue();};
    await page.route(endpoint,intercept);
    try {
      const sent=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/sessions/${fixtures[key].session_id}/events`);
      await page.getByRole('button',{name:family==='quality'?'Fix issues automatically':'Ask AI to fix',exact:true}).first().click();
      const response=await sent,request=response.request().postDataJSON();await save(`${family}-ai-routing`,{request,repairedOutput:false,synthetic:true});
      assert.equal(response.status(),503);assert.equal(typeof request.text,'string');assert.ok(request.text.includes(family==='quality'?'minimum_text_size':'imweb_page_over_1m_chars'));assert.equal(request.generation.model,'sonnet');
      assert.equal(digest(await readFile(path.join(fixtures[key].dir_path,'index.html'))),before);return {captured:true,repairedOutput:false};
    } finally {await page.unroute(endpoint,intercept);}
  },'synthetic-ai-routing-only');
  await scenario('export-list-error-and-retry',async()=>{
    const endpoint=`**/api/projects/${fixtures.other.id}/exports`,fail=async route=>{if(route.request().method()==='GET')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'export_unavailable',message:'Synthetic list failure'}})});else await route.continue();};
    await page.route(endpoint,fail);
    try {await open('other');await menu();await page.locator('[data-export-menu-content]').getByRole('alert').waitFor();await shot('export-list-error');}
    finally {await page.unroute(endpoint,fail);}
    const loaded=page.waitForResponse(r=>r.request().method()==='GET' && new URL(r.url()).pathname===`/api/projects/${fixtures.other.id}/exports`);await page.locator('[data-export-menu-content]').getByRole('alert').getByRole('button',{name:'Retry',exact:true}).click();assert.equal((await loaded).status(),200);await page.getByRole('button',{name:'Download HTML ZIP file',exact:true}).waitFor();return {syntheticFailure:true,realRecovery:true};
  },'synthetic-failure-real-recovery');
  for(const behavior of ['pause','fail'])await scenario(`export-lifecycle-${behavior}`,async()=>{
    await open('single');await menu();const token=`full_export_${behavior}_${Date.now()}`;
    const armed=await page.request.post(`${base}/api/exports/qa/barriers`,{headers,data:{token,phase:'after_partial_render',behavior}});
    assert.equal(armed.status(),201,'Controlled lifecycle requires BG_EXPORT_QA=1 on the owned backend');
    // The wait request is subscribed before creating the job, including the fast failure case.
    const hit=page.request.get(`${base}/api/exports/qa/barriers/${token}/wait`,{headers,timeout:180_000});hit.catch(()=>{});
    const endpoint=`**/api/projects/${fixtures.single.id}/exports`,inject=async route=>{if(route.request().method()==='POST')await route.continue({headers:{...route.request().headers(),'x-bg-export-qa-barrier':token}});else await route.continue();};
    await page.route(endpoint,inject);
    let failed;
    try {
      failed=await job('single',`lifecycle-${behavior}`,'png','PNG · 640×480',{png_width:640,png_height:480,png_dpr:1},async()=>{
        await page.getByRole('menuitem',{name:'PNG · 640×480',exact:true}).click();const reached=await hit;assert.equal(reached.status(),200);
        if(behavior==='pause') {const cancel=page.waitForResponse(r=>r.request().method()==='POST' && /\/cancel$/.test(new URL(r.url()).pathname));await page.getByRole('button',{name:'Cancel PNG',exact:true}).first().click();assert.equal((await cancel).status(),202);}
      },'failed');
    } finally {await page.unroute(endpoint,inject);}
    if(behavior==='pause')assert.equal(failed.latest_attempt.stop_reason,'user_cancelled');
    const retried=await job('single',`retry-${behavior}`,'png','PNG · 640×480',failed.options,()=>page.getByRole('button',{name:'Retry PNG',exact:true}).first().click());
    assert.equal(retried.id,failed.id);assert.notEqual(retried.latest_attempt.id,failed.latest_attempt.id);assert.equal(retried.latest_attempt.parent_attempt_id,failed.latest_attempt.id);assert.equal(retried.latest_attempt.project_revision,failed.latest_attempt.project_revision);await image(await download(`retry-${behavior}`,retried),[640,480],behavior);
    return {controlledPhase:'after_partial_render',failed,retried};
  },'real-backend-qa-barrier');
  await scenario('corrupt-download-unavailable',async()=>{
    await open('other');const finished=await job('other','corrupt-source','html_zip','HTML ZIP file');
    const ownedOutput=await realpath(finished.output_path);assert.ok(ownedOutput.startsWith(path.join(home,'.burnguard','cache','exports')+path.sep));
    await writeFile(ownedOutput,Buffer.concat([await readFile(ownedOutput),Buffer.from('OWNED_QA_CORRUPTION')]));
    const rejected=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/exports/${finished.id}/download`);await page.getByRole('button',{name:'Download HTML ZIP file',exact:true}).first().click();assert.equal((await rejected).status(),410);
    const corrupt=(await (await page.request.get(`${base}/api/exports/${finished.id}`)).json()).data;await save('corrupt-job',corrupt);assert.equal(corrupt.latest_attempt.status,'corrupt');
    await open('other');await menu();const sourceRows=await rows('other');assert.equal(sourceRows.find(row=>row.id===finished.id).latest_attempt.retention.output_available,false);await page.getByText('File corrupted',{exact:true}).waitFor();return {realByteCorruption:true,downloadRejected:true};
  });
  await scenario('download-conflict-and-expiry',async()=>{
    await open('clean');const finished=await job('clean','expiry-source','html_zip','HTML ZIP file');
    const endpoint=`**/api/exports/${finished.id}/download`,fail=route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'export_not_ready',message:'Synthetic expired download conflict'}})});
    await page.route(endpoint,fail);
    try {const rejected=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/exports/${finished.id}/download`);await page.getByRole('button',{name:'Download HTML ZIP file',exact:true}).first().click();assert.equal((await rejected).status(),409);await page.getByText('Could not complete the export request',{exact:true}).waitFor();await shot('download-conflict');}
    finally {await page.unroute(endpoint,fail);}
    const expired=await page.request.post(`${base}/api/exports/qa/gc`,{headers,data:{now:Date.now()+1000,attempt_id:finished.latest_attempt.id}});assert.equal(expired.status(),200);await save('expiry-gc',await expired.json());
    const expiredJob=(await (await page.request.get(`${base}/api/exports/${finished.id}`)).json()).data;await save('expiry-job',expiredJob);assert.equal(expiredJob.latest_attempt.status,'expired');
    await open('clean');await menu();assert.equal(await page.getByRole('button',{name:'Download HTML ZIP file',exact:true}).count(),0);await page.getByText('Retention expired',{exact:true}).waitFor();
    return {synthetic409:true,realRetentionExpiry:true};
  },'synthetic-download-error-real-gc');
  blocked.push({feature:'Vercel public publish/READY/copy live link',reason:'No publication authorization or account token; no publish request made.'},{feature:'Cafe24/Imweb installation',reason:'No authorized destination site; local package and guide only.'},{feature:'Actual AI repair',reason:'Owned by live-AI worker; this module never sends to providers.'});
  assert.deepEqual(denied,[],'No forbidden request should even be attempted');
  await save('coverage',coverage);await save('defects',defects);await save('external-gaps',blocked);await save('denied-requests',denied);await save('browser-errors',browserErrors);
  if(defects.length)throw new AggregateError(defects.map(item=>new Error(`${item.name}: ${item.error}`)),`${defects.length} export feature checks failed`);
}
