import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repository = 'https://github.com/mdn/beginner-html-site';
const website = 'https://mdn.github.io/beginner-html-site/';
const publicPin = 'https://www.pinterest.com/pin/1138847824555282273/';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Real public GETs and real UI submissions only. No source adapters, response
// fulfillment, credentials, model turns, publication, or external writes.
export async function run({ page, context, base, home, check, shot, evidence }) {
  const observations = [], failures = [], network = [], blockedWrites = [];
  const ownedSystems = [];
  const save = (name, value) => writeFile(path.join(evidence, name), JSON.stringify(value, null, 2));
  const visible = locator => locator.waitFor({ state: 'visible' });
  const button = name => page.getByRole('button', { name, exact: true });
  const apiPath = '/api/design-systems';
  const guard = async route => {
    const request = route.request(), url = new URL(request.url());
    const readOnly = ['GET', 'HEAD'].includes(request.method());
    const acquisition = url.origin === base && request.method() === 'POST' &&
      [`${apiPath}/extract`, `${apiPath}/pinterest`].includes(url.pathname);
    if (!readOnly && !acquisition) {
      blockedWrites.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
    } else await route.continue();
  };
  const record = response => {
    const url = new URL(response.url());
    if (url.origin === base && url.pathname.startsWith('/api/')) network.push({
      method: response.request().method(), url: response.url(), status: response.status(),
    });
  };
  const get = async suffix => {
    const response = await page.request.get(`${base}${apiPath}${suffix}`);
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).data;
  };
  const library = async () => {
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === apiPath && r.request().method() === 'GET');
    await Promise.all([loaded, page.goto(`${base}/?view=systems`, { waitUntil: 'domcontentloaded' })]);
    await visible(page.getByRole('button', { name: /Import design system/ }));
  };
  const publicGet = async (url, label) => {
    const response = await context.request.get(url, { timeout: 30_000, maxRedirects: 5 });
    const bytes = await response.body();
    const result = { url, finalUrl: response.url(), status: response.status(),
      contentType: response.headers()['content-type'], bytes: bytes.length, sha256: digest(bytes) };
    await save(`${label}-http.json`, result);
    await writeFile(path.join(evidence, `${label}-body.txt`), bytes);
    return { ...result, text: bytes.toString('utf8') };
  };
  const preview = async title => {
    const iframe = page.locator(`iframe[title=${JSON.stringify(title)}]`);
    await visible(iframe);
    await iframe.evaluate(async element => {
      const ready = () => element.contentDocument?.URL === element.src && element.contentDocument.readyState === 'complete';
      if (ready()) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { element.removeEventListener('load', loaded); reject(new Error('Preview load deadline')); }, 30_000);
        function loaded() {
          if (ready()) { clearTimeout(timer); element.removeEventListener('load', loaded); resolve(); }
        }
        element.addEventListener('load', loaded);
      });
    });
    const frame = page.frameLocator(`iframe[title=${JSON.stringify(title)}]`);
    assert.ok((await frame.locator('body').innerText()).trim().length > 0);
    return { title, source: await iframe.getAttribute('src') };
  };
  const persisted = async (data, mode, url) => {
    const { system, extraction } = data;
    ownedSystems.push(system.id);
    await page.waitForURL(`**/systems/${system.id}`);
    await visible(button('Edit details'));
    assert.equal(system.status, 'draft');
    assert.equal(system.source_uri, url);
    assert.equal(system.source_type, ['github', 'git'].includes(mode) ? 'github' : 'website');
    assert.equal(extraction.inferred_source_type, system.source_type);
    const directory = path.join(home, '.burnguard/data/systems', system.id);
    const files = [];
    for (const relative of extraction.generated_files) {
      const response = await page.request.get(`${base}${apiPath}/${system.id}/files/${relative}`);
      assert.equal(response.status(), 200, relative);
      const bytes = await response.body();
      assert.deepEqual(bytes, await readFile(path.join(directory, relative)), relative);
      files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
    }
    const provenance = JSON.parse(await readFile(path.join(directory, 'extraction-provenance.json'), 'utf8'));
    assert.deepEqual(provenance, extraction.provenance);
    assert.equal(provenance.schema_version, 1);
    assert.equal(provenance.digest_algorithm, 'sha256');
    assert.equal(provenance.content_digest, digest(JSON.stringify(provenance.content)));
    assert.ok(provenance.content.entries.length > 0);
    const report = JSON.parse(await readFile(path.join(directory, 'uploads/extraction-report.json'), 'utf8'));
    assert.equal(report.source_url, url);
    assert.equal((await readFile(path.join(directory, 'uploads/source-url.txt'), 'utf8')).trim(), url);
    const assets = files.filter(file => file.path.startsWith('assets/'));
    assert.equal(assets.length, extraction.copied_logo_count);
    const tokens = await get(`/${system.id}/tokens`);
    assert.ok(tokens.colors.length > 0, 'Canonical scaffold must have persisted color tokens');
    if (mode === 'pinterest') {
      assert.deepEqual(data.pins, [{ url, status: 'analyzed' }]);
      const samples = provenance.content.entries.filter(entry => entry.key.startsWith('sample-') && entry.state === 'observed');
      assert.ok(samples.length > 0);
      assert.ok(samples.every(entry => entry.source_locators.includes(url)));
      for (const color of report.detected_colors) assert.ok(tokens.colors.some(token => token.value.toLowerCase() === color.toLowerCase()));
      assert.equal(assets.length, 0, 'Pinterest samples pixels but intentionally does not retain pin image assets');
    } else {
      // The requested beginner HTML repository has neither CSS nor logo/brand
      // filenames. Do not mistake default canonical styling for source evidence.
      assert.deepEqual(report.detected_colors, []);
      assert.equal(assets.length, 0);
      assert.ok(!provenance.content.entries.some(entry => entry.domain === 'token' && entry.state === 'observed'));
      assert.ok(files.some(file => file.path === 'ui_kits/website/index.html'));
      if (mode === 'website') assert.equal(report.fetched_page_count, 1);
    }
    await button('Source details').click();
    await visible(page.locator('#system-source-details').getByText(url, { exact: true }));
    await shot(`public-${mode}-source`);
    const previews = await get(`/${system.id}/previews`);
    assert.equal(previews.length, 16);
    const titles = await page.locator('iframe').evaluateAll(nodes => nodes.map(node => node.title));
    assert.equal(titles.length, previews.length);
    const rendered = [];
    for (const title of titles) rendered.push(await preview(title));
    await button('Colors and fonts').click();
    await visible(button('Add color'));
    await shot(`public-${mode}-colors`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await visible(button('Edit details'));
    assert.equal((await get(`/${system.id}`)).source_uri, url);
    assert.deepEqual(await get(`/${system.id}/tokens`), tokens);
    await preview('Brand colors');
    await save(`${mode}-persisted.json`, { system, provenance, report, files, assets, tokens, rendered });
    return { status: 'acquired', url, id: system.id, sourceType: system.source_type,
      persistedFiles: files.length, previewsRendered: rendered.length, assets: assets.length,
      detectedColors: report.detected_colors, colorAttribution: mode === 'pinterest' ? 'Observed quantized pin-image colors; other styling is scaffold.' : 'No source CSS colors or logo-like assets; persisted canonical colors are scaffold, not extracted.',
      reloadVerified: true };
  };
  const submit = async (mode, url, selection) => {
    await library();
    const before = (await get('')).map(item => item.id).sort();
    let dialog, suffix;
    if (mode === 'pinterest') {
      await button('Import Pinterest mood').click();
      dialog = page.getByRole('dialog');
      await dialog.locator('textarea').fill(url);
      await dialog.locator('input').fill('Public Pinterest QA');
      suffix = '/pinterest';
    } else {
      await page.getByRole('button', { name: /Import design system/ }).click();
      dialog = page.getByRole('dialog');
      await page.locator('#system-source-type').selectOption(selection);
      await page.locator('#system-source-url').fill(url);
      await page.locator('#system-draft-name').fill(`Public ${mode} QA`);
      suffix = '/extract';
    }
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === `${apiPath}${suffix}` && r.request().method() === 'POST', { timeout: 150_000 });
    const [response] = await Promise.all([pending, dialog.getByRole('button', {
      name: mode === 'pinterest' ? 'Create mood draft' : 'Import design system', exact: true,
    }).click()]);
    const body = await response.json();
    await save(`${mode}-import-http.json`, { url: response.url(), method: 'POST', status: response.status(), request: response.request().postDataJSON(), body });
    if (response.status() === 201) return persisted(body.data, mode, url);
    await visible(dialog.getByRole('alert'));
    assert.deepEqual((await get('')).map(item => item.id).sort(), before, 'Failed acquisition must not leave a catalog row');
    // Keep network failures distinct from product defects and unexpected errors.
    const external = ['git_clone_failed', 'website_fetch_failed', 'pinterest_unavailable', 'acquisition_timeout'].includes(body.error?.code);
    if (!external) observations.push({ mode, status: 'product-rejected', url,
      http: response.status(), error: body.error, backendImportAttempted: true,
      persisted: false, failedImportLeftNoCatalogRow: true });
    assert.ok(external, `Unexpected import failure: HTTP ${response.status()} ${JSON.stringify(body)}`);
    return { status: 'external-blocked', url, http: response.status(), error: body.error,
      qualification: 'Actual UI/backend failure; public preflight evidence is separate and does not establish that the backend request succeeded.' };
  };
  const scenario = async (mode, action) => {
    try {
      await check(`public-${mode}`, async () => {
        const result = await action(); observations.push({ mode, ...result }); return result;
      }, 'live-public-read-only');
    } catch (error) {
      failures.push({ mode, error: String(error.stack ?? error) });
      console.error(`PUBLIC ${mode}: ${error.message}`);
    }
  };
  page.setDefaultTimeout(30_000);
  await context.addInitScript(() => localStorage.setItem('burnguard.locale', 'en'));
  await context.route('**/*', guard);
  page.on('response', record);
  try {
    for (const [mode, url, selection] of [
      ['website', website, 'website'],
      ['github', repository, 'auto'],
      ['git', `${repository}.git`, 'github'],
    ]) await scenario(mode, async () => {
      const reachable = await publicGet(mode === 'git' ? `${url}/info/refs?service=git-upload-pack` : url, `${mode}-public-preflight`);
      if (mode === 'website' && reachable.status === 200) assert.match(reachable.contentType, /text\/html/);
      const result = await submit(mode, url, selection);
      return { ...result, preflight: { status: reachable.status, finalUrl: reachable.finalUrl, bytes: reachable.bytes },
        selection: mode === 'git' ? 'Git repository (shared backend source_type=github), generic .git URL' : selection };
    });
    await scenario('pinterest', async () => {
      // Discovered through public web search, not a guessed ID or a login session.
      const reachable = await publicGet(publicPin, 'pinterest-pin-public-preflight');
      const result = await submit('pinterest', publicPin);
      return { ...result, preflight: { status: reachable.status, finalUrl: reachable.finalUrl },
        attribution: { title: 'Minimal Typography Poster Design', pinUrl: publicPin } };
    });
  } finally {
    page.off('response', record);
    await context.unroute('**/*', guard);
    const report = { observations, failures, network, blockedWrites,
      sources: { repository, website, genericGit: `${repository}.git`, pinterestPin: publicPin },
      assumptions: ['GitHub auto-detection and the Git repository selector share source_type=github.',
        'The requested beginner HTML source has no CSS; no source colors or logo assets are invented.',
        'Figma remains external-blocked on an authorized token and was not attempted.'],
      resources: { ownedSystems, home, cleanup: 'Driver finally closes browser/backend and deletes its isolated home, including clones and catalog records. See cleanup.json.' } };
    await save('public-acquisition-report.json', report);
    await writeFile(path.join(evidence, 'public-acquisition-report.md'), [
      '# Real public acquisition', '',
      ...observations.map(item => `- ${item.mode}: ${item.status}. Tested ${item.url}. ${item.reason ?? item.colorAttribution ?? JSON.stringify(item.error)}`),
      '', `Attribution: MDN beginner-html-site (GitHub repository and GitHub Pages). Public Pinterest source: ${publicPin}`,
      'Git repository and GitHub imports share the github backend mode. No external writes, model turns, private credentials, or Figma calls.',
      'Each successful source has import HTTP, persisted bytes/provenance/tokens, all 16 rendered previews, and reload evidence. Blockers are not acquisition passes.',
      `Failures: ${failures.length}. Cleanup is recorded by the runner in cleanup.json.`, '',
    ].join('\n'));
  }
  assert.equal(failures.length, 0, 'See public-acquisition-report.json and results.json');
  assert.equal(observations.length, 4, 'Every public source mode must have actual evidence or a proven blocker');
}
