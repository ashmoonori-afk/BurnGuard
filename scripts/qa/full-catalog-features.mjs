import assert from 'node:assert/strict';
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { documents } from './fixtures/full-catalog/documents.mjs';
import { localSource } from './fixtures/full-catalog/source.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function run({ page, context, base, home, check, shot, evidence }) {
  const failures = [], observations = [], requests = [];
  const fixtures = await documents(path.join(home, 'full-catalog-fixtures'));
  const source = await localSource();
  const imported = {};
  let projectId, system;
  page.setDefaultTimeout(45_000);
  await context.addInitScript(() => localStorage.setItem('burnguard.locale', 'en'));
  const guard = async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base || (!['GET', 'HEAD'].includes(request.method()) && /\/api\/(?:settings|.*(?:events|vercel|share|deploy))/.test(url.pathname))) {
      requests.push({ blocked: true, method: request.method(), path: url.pathname });
      await route.abort('blockedbyclient');
    } else await route.continue();
  };
  await context.route('**/*', guard);
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === base && url.pathname.startsWith('/api/design-systems') && !['GET', 'HEAD'].includes(response.request().method())) requests.push({ method: response.request().method(), path: url.pathname, status: response.status() });
  });
  const button = name => page.getByRole('button', { name, exact: true });
  const visible = locator => locator.waitFor({ state: 'visible' });
  const gone = locator => locator.waitFor({ state: 'hidden' });
  const scenario = async (name, action, mode = 'live-local') => {
    try { await check(`catalog-${name}`, async () => {
      const result = await action(); observations.push({ name, mode, result }); return result;
    }, mode); } catch (error) {
      failures.push({ name, error: String(error.stack ?? error) });
      console.error(`CATALOG FAILURE ${name}: ${error.message}`);
      // Preserve failed checks, then continue independent feature families.
    }
  };
  const responseFor = (suffix, method) => page.waitForResponse(r => new URL(r.url()).pathname === `/api/design-systems${suffix}` && r.request().method() === method, { timeout: 90_000 });
  const submit = async (suffix, method, action, expected) => {
    const pending = responseFor(suffix, method);
    const [response] = await Promise.all([pending, action()]);
    const body = await response.json();
    assert.equal(response.status(), expected, JSON.stringify(body));
    return body;
  };
  const api = (suffix, method = 'GET', body) => page.evaluate(async ({ suffix, method, body }) => {
    const bootstrap = await (await fetch('/api/bootstrap')).json();
    const response = await fetch(`/api/${suffix}`, { method, headers: { 'content-type': 'application/json', 'x-burnguard-capability': bootstrap.data.capability }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { suffix, method, body });
  const get = async id => {
    const response = await api(`design-systems/${id}`);
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.data;
  };
  const file = async (id, relative) => {
    const response = await page.request.get(`${base}/api/design-systems/${id}/files/${relative}`);
    assert.equal(response.status(), 200, `${relative}: ${await response.text()}`); return response.text();
  };
  const library = async () => {
    const fetched = responseFor('', 'GET');
    await page.goto(`${base}/?view=systems`, { waitUntil: 'domcontentloaded' });
    assert.equal((await fetched).status(), 200);
    await visible(page.getByRole('button', { name: /Import design system/ }));
    await visible(page.locator('a[href="/systems/sample-system-original-sonnel"]'));
  };
  const visit = async id => { await page.goto(`${base}/systems/${id}`); await visible(button('Edit details')); };
  const importDialog = async mode => {
    await library(); await page.getByRole('button', { name: /Import design system/ }).click();
    if (mode === 'upload') await button('Upload file').click();
    return page.getByRole('dialog');
  };
  const upload = async (filename, name, expected = 201) => {
    const dialog = await importDialog('upload');
    await page.locator('#system-upload-file').setInputFiles(path.join(fixtures, filename));
    await page.locator('#system-draft-name').fill(name);
    const result = await submit('/upload', 'POST', () => button('Upload design file').click(), expected);
    if (expected === 201) {
      imported[name] = result.data.system;
      await page.waitForURL(`**/systems/${result.data.system.id}`);
      await visible(page.getByRole('heading', { name, exact: true }));
    } else {
      await visible(dialog.getByRole('alert'));
      assert.equal(await page.locator('#system-draft-name').inputValue(), name);
      assert.equal(await button('Upload design file').isEnabled(), true);
    }
    return result;
  };
  const openDelete = async target => {
    await library(); await button(`Options for ${target.name}`).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await visible(page.getByRole('dialog'));
  };
  const eligible = async (id, expected) => {
    const fetched = responseFor('', 'GET');
    await page.goto(`${base}/?view=systems&create=prototype`); await fetched;
    await visible(page.locator('#design-system')); await visible(page.locator('#project-name'));
    const select = page.locator('#design-system');
    assert.equal(await select.inputValue(), '', 'System must not become implicitly selected');
    const values = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
    assert.equal(values.includes(id), expected, `project eligibility ${id}`);
    if (expected) { await select.selectOption(id); assert.equal(await select.inputValue(), id); }
  };
  const previewReady = async title => {
    const selector = `iframe[title=${JSON.stringify(title)}]`;
    await page.locator(selector).evaluate(async iframe => {
      const ready = () => iframe.contentDocument?.URL === iframe.src && iframe.contentDocument.readyState === 'complete';
      if (ready()) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { iframe.removeEventListener('load', loaded); reject(new Error('Preview document load deadline')); }, 45_000);
        function loaded() { if (ready()) { clearTimeout(timer); iframe.removeEventListener('load', loaded); resolve(); } }
        iframe.addEventListener('load', loaded);
      });
    });
    const frame = page.frameLocator(selector);
    await visible(frame.locator('body')); return frame;
  };
  try {
    await scenario('seeded-navigation-preview-library', async () => {
      await library();
      const list = await api('design-systems'); assert.equal(list.status, 200);
      const originals = list.body.data.filter(item => /SONNEL|FOLIOVER|ODDWARD|VELUNE/.test(item.name));
      assert.equal(originals.length, 4);
      const previews = [];
      for (const original of originals) {
        await page.locator(`a[href="/systems/${original.id}"]`).click();
        await visible(page.getByRole('heading', { name: original.name, exact: true }));
        const result = await api(`design-systems/${original.id}/previews`); assert.equal(result.status, 200);
        const titles = ['preview'];
        for (const title of titles) {
          const frame = await previewReady(title);
          assert.ok((await frame.locator('body').innerText()).trim().length > 0, `${original.name}: ${title}`);
        }
        assert.equal(await page.locator('iframe').count(), result.body.data.length);
        await button('Source details').click();
        assert.equal(await page.locator('#system-source-details').getAttribute('open'), '');
        previews.push({ id: original.id, count: result.body.data.length });
        await shot(`catalog-seed-${original.id}`);
        await page.getByRole('link', { name: 'Back to design library', exact: true }).click();
      }
      return previews;
    });
    for (const extension of ['pptx', 'pdf']) await scenario(`import-${extension}-provenance`, async () => {
      const name = `Catalog ${extension.toUpperCase()} QA`, { data } = await upload(`reference.${extension}`, name);
      assert.equal(data.system.status, 'draft'); assert.equal(data.system.source_type, 'upload');
      assert.equal(data.system.source_uri, `reference.${extension}`);
      assert.equal(data.extraction.inferred_source_type, 'upload'); assert.ok(data.extraction.generated_files.length >= 16);
      const provenance = JSON.parse(await file(data.system.id, 'extraction-provenance.json'));
      assert.equal(provenance.schema_version, 1); assert.match(provenance.content_digest, /^[a-f0-9]{64}$/);
      assert.deepEqual(provenance, data.extraction.provenance); assert.ok(provenance.content.entries.length > 0);
      for (const entry of provenance.content.entries) assert.ok(['observed', 'inferred', 'defaulted', 'unknown', 'conflicted'].includes(entry.state), JSON.stringify(entry));
      const notes = page.locator('summary').filter({ hasText: /extraction note/ });
      await visible(notes); await notes.click(); assert.ok(await notes.locator('..').locator('li').count() > 0);
      await button('Source details').click();
      await visible(page.locator('#system-source-details').getByText(`reference.${extension}`, { exact: true }));
      const previewList = await api(`design-systems/${data.system.id}/previews`);
      assert.equal(previewList.body.data.length, 16, 'Canonical document preview library');
      for (const title of ['Brand logos', 'Brand icons', 'Brand colors', 'Neutral colors', 'Full color scales', 'Semantic colors', 'Chart palettes', 'Display', 'Headings', 'Body', 'Spacing', 'Corner radii and shadows', 'Buttons', 'Cards', 'Forms', 'Badges and tables']) {
        const frame = await previewReady(title);
        assert.ok((await frame.locator('body').innerText()).trim().length > 0, title);
      }
      await writeFile(path.join(evidence, `${extension}-provenance.json`), JSON.stringify(provenance, null, 2));
      return { id: data.system.id, source: data.system.source_uri, states: [...new Set(provenance.content.entries.map(entry => entry.state))], previews: previewList.body.data };
    });
    if (source) {
      await scenario('website-controlled-local-fixture-provenance', async () => {
        const dialog = await importDialog('url');
        await page.locator('#system-source-type').selectOption('website');
        await page.locator('#system-source-url').fill(source.url);
        await page.locator('#system-draft-name').fill('Catalog Local Website QA');
        const { data } = await submit('/extract', 'POST', () => dialog.getByRole('button', { name: 'Import design system', exact: true }).click(), 201);
        imported['Catalog Local Website QA'] = data.system;
        await page.waitForURL(`**/systems/${data.system.id}`);
        await visible(button('Edit details'));
        assert.equal(data.system.status, 'draft');
        assert.equal(data.system.source_type, 'website');
        assert.equal(data.system.source_uri, 'qa-adapter:/source');
        const entries = data.extraction.provenance.content.entries;
        assert.ok(entries.some(entry => entry.key === 'catalog-source-primary' && entry.state === 'observed'));
        assert.ok(source.events.some(event => event.pathname === '/styles.css' && event.authorized));
        assert.ok(source.events.some(event => event.pathname === '/brand-logo.svg' && event.authorized));
        await button('Source details').click();
        await visible(page.locator('#system-source-details').getByText('qa-adapter:/source', { exact: true }));
        await writeFile(path.join(evidence, 'local-website-provenance.json'), JSON.stringify(data.extraction.provenance, null, 2));
        return { id: data.system.id, identity: 'controlled local fixture, NOT public website integration', resources: source.events };
      }, 'controlled-local-source');
      await scenario('website-local-acquisition-timeout', async () => {
        const dialog = await importDialog('url');
        await page.locator('#system-source-type').selectOption('website');
        await page.locator('#system-source-url').fill(source.stall);
        const before = (await api('design-systems')).body.data.map(item => item.id).sort();
        const aborted = source.aborted();
        const [result] = await Promise.all([submit('/extract', 'POST', () => dialog.getByRole('button', { name: 'Import design system', exact: true }).click(), 408), aborted]);
        assert.equal(result.error.code, 'acquisition_timeout');
        await visible(dialog.getByRole('alert'));
        assert.equal(await dialog.getByRole('button', { name: 'Import design system', exact: true }).isEnabled(), true);
        assert.deepEqual((await api('design-systems')).body.data.map(item => item.id).sort(), before);
        return { status: 408, code: result.error.code, fixtureConnectionAborted: true, partialSystemAbsent: true };
      }, 'controlled-local-source');
    }
    await scenario('prepare-disposable-editor-fixture', async () => {
      system = imported['Catalog PDF QA']; assert.ok(system, 'UI-imported disposable PDF system required');
      system = await get(system.id);
      const patched = await api(`design-systems/${system.id}`, 'PATCH', { expected_revision: system.metadata_revision, status: 'draft', tags: ['catalog-qa', 'preserve-me'] });
      assert.equal(patched.status, 200); system = patched.body.data; await visit(system.id);
      return { id: system.id, setup: 'UI-imported PDF; API prepares preservation tags only' };
    });
    await scenario('metadata-empty-cancel-save-cas', async () => {
      assert.ok(system); await visit(system.id); const initial = await get(system.id);
      await button('Edit details').click(); await page.locator('#ds-name').fill('');
      assert.equal(await button('Save changes').isDisabled(), true);
      await page.locator('#ds-name').fill('Discarded name'); await page.locator('#ds-description').fill('Discarded description');
      await page.locator('#ds-status').selectOption('review'); await button('Cancel').click();
      assert.deepEqual(await get(system.id), initial);
      await button('Edit details').click(); await page.locator('#ds-name').fill('Catalog Editor Saved');
      await page.locator('#ds-description').fill('Persistent description, preserved during local publication.');
      await submit(`/${system.id}`, 'PATCH', () => button('Save changes').click(), 200);
      await visible(page.getByRole('heading', { name: 'Catalog Editor Saved', exact: true }));
      const saved = await get(system.id);
      assert.equal(saved.description, 'Persistent description, preserved during local publication.');
      assert.equal(saved.metadata_revision, initial.metadata_revision + 1); assert.deepEqual(saved.tags, initial.tags);
      await button('Edit details').click(); await page.locator('#ds-name').fill('Stale overwrite must not win');
      const concurrent = await api(`design-systems/${system.id}`, 'PATCH', { expected_revision: saved.metadata_revision, name: 'Catalog Concurrent Saved' });
      assert.equal(concurrent.status, 200);
      const conflict = await submit(`/${system.id}`, 'PATCH', () => button('Save changes').click(), 412);
      assert.equal(conflict.error.code, 'expected_revision_conflict');
      await visible(page.getByText('The design system was changed elsewhere', { exact: true }));
      assert.equal(await page.locator('#ds-name').inputValue(), 'Catalog Concurrent Saved');
      assert.deepEqual(await get(system.id), concurrent.body.data);
      await button('Cancel').click(); system = concurrent.body.data; await page.reload();
      await visible(page.getByRole('heading', { name: system.name, exact: true }));
      return { revision: system.metadata_revision, preservedTags: system.tags, staleStatus: 412 };
    });
    await scenario('draft-review-published-project-eligibility', async () => {
      assert.ok(system); const before = await get(system.id); assert.equal(before.status, 'draft');
      await eligible(system.id, false); await visit(system.id);
      await submit(`/${system.id}`, 'PATCH', () => button('Start review').click(), 200);
      await visible(button('Publish design system')); assert.equal((await get(system.id)).status, 'review');
      await eligible(system.id, false); await visit(system.id);
      await submit(`/${system.id}`, 'PATCH', () => button('Publish design system').click(), 200);
      await gone(button('Publish design system')); await page.reload(); await visible(button('Edit details'));
      const published = await get(system.id); assert.equal(published.status, 'published');
      assert.equal(published.name, before.name); assert.equal(published.description, before.description); assert.deepEqual(published.tags, before.tags);
      await eligible(system.id, true); await page.locator('#project-name').fill('Catalog Reference Project');
      await page.locator('#brief-audience').fill('Local catalog QA reviewers');
      await page.locator('#brief-objective').fill('Verify published design system selection without invoking generation.');
      const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/projects' && r.request().method() === 'POST');
      await button('Create project').click(); const response = await created;
      assert.equal(response.status(), 201, await response.text()); projectId = (await response.json()).data.id;
      await page.waitForURL(`**/projects/${projectId}`);
      const project = await api(`projects/${projectId}`); assert.equal(project.status, 200); assert.equal(project.body.data.design_system_id, system.id);
      return { status: published.status, projectId, publication: 'local catalog only; no provider turn' };
    });
    await scenario('color-add-empty-invalid-cancel-edit-css-refresh', async () => {
      assert.ok(system); await visit(system.id); await button('Colors and fonts').click();
      const original = await file(system.id, 'colors_and_type.css');
      await button('Add color').click(); await page.locator('#system-color-name').fill('');
      assert.equal(await button('Save color').isDisabled(), true);
      await page.locator('#system-color-name').fill('catalog-accent'); await page.locator('#system-color-value').fill('#123abc');
      await button('Cancel').click(); assert.equal(await file(system.id, 'colors_and_type.css'), original);
      await button('Add color').click(); await page.locator('#system-color-name').fill('bad;token');
      await page.locator('#system-color-value').fill('#123abc');
      assert.equal((await submit(`/${system.id}/colors`, 'PATCH', () => button('Save color').click(), 400)).error.code, 'invalid_color_token');
      await page.getByRole('alert').filter({ hasText: 'Could not save the color' }).getByRole('button', { name: 'Close', exact: true }).click();
      await page.locator('#system-color-name').fill('catalog-accent'); await page.locator('#system-color-value').fill('url(https://invalid.example/x)');
      assert.equal((await submit(`/${system.id}/colors`, 'PATCH', () => button('Save color').click(), 400)).error.code, 'invalid_color_value');
      await page.getByRole('alert').filter({ hasText: 'Could not save the color' }).getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await file(system.id, 'colors_and_type.css'), original);
      await page.locator('#system-color-value').fill('#123abc');
      const refreshed = responseFor(`/${system.id}/files/preview/colors-brand.html`, 'GET');
      await Promise.all([refreshed, submit(`/${system.id}/colors`, 'PATCH', () => button('Save color').click(), 200)]);
      await gone(page.locator('#system-color-editor')); assert.match(await file(system.id, 'colors_and_type.css'), /--catalog-accent:\s*#123abc/);
      const frame = await previewReady('Brand colors');
      const addedPreviewValue = (await frame.locator('body').evaluate(node => getComputedStyle(node).getPropertyValue('--catalog-accent'))).trim();
      await button('Edit catalog-accent color').focus();
      await button('Edit catalog-accent color').press('Enter'); assert.equal(await page.locator('#system-color-name').isDisabled(), true);
      await page.locator('#system-color-value').fill('#654321'); await button('Cancel').click();
      assert.match(await file(system.id, 'colors_and_type.css'), /--catalog-accent:\s*#123abc/);
      await button('Edit catalog-accent color').focus();
      await button('Edit catalog-accent color').press('Enter'); await page.locator('#system-color-value').fill('#654321');
      const edited = responseFor(`/${system.id}/files/preview/colors-brand.html`, 'GET');
      await Promise.all([edited, submit(`/${system.id}/colors`, 'PATCH', () => button('Save color').click(), 200)]); await previewReady('Brand colors');
      assert.match(await file(system.id, 'colors_and_type.css'), /--catalog-accent:\s*#654321/);
      const editedPreviewValue = (await frame.locator('body').evaluate(node => getComputedStyle(node).getPropertyValue('--catalog-accent'))).trim();
      await writeFile(path.join(evidence, 'color-preview.json'), JSON.stringify({ addedPreviewValue, editedPreviewValue, savedCss: await file(system.id, 'colors_and_type.css'), coreOperations: 'add, invalid name/value rejection, cancel add, cancel edit, save edit verified' }, null, 2));
      assert.equal(addedPreviewValue, '#123abc');
      assert.equal(editedPreviewValue, '#654321');
      return { token: 'catalog-accent', value: '#654321', preview: 'actual iframe computed CSS' };
    });
    for (const [role, fontName] of [['sans', 'Figtree'], ['display', 'PlayfairDisplay'], ['serif', 'Newsreader'], ['mono', 'GeistMono']]) await scenario(`font-${role}-upload-token-preview`, async () => {
      assert.ok(system); await visit(system.id); await button('Colors and fonts').click();
      await page.locator('#system-font-file').setInputFiles(path.join(root, 'assets/fonts', `${fontName}.woff2`));
      await page.locator('#system-font-family').fill(`Catalog ${role}`); await page.locator('#system-font-role').selectOption(role);
      const refreshed = responseFor(`/${system.id}/files/preview/type-body.html`, 'GET');
      const [, response] = await Promise.all([refreshed, submit(`/${system.id}/fonts`, 'POST', () => button('Upload font').click(), 201)]);
      assert.equal(response.data.role, role); assert.equal(response.data.family, `Catalog ${role}`);
      await visible(page.getByText('Font uploaded', { exact: true }).first());
      assert.equal(await page.locator('#system-font-family').inputValue(), ''); assert.equal(await button('Upload font').isDisabled(), true);
      assert.match(await file(system.id, 'colors_and_type.css'), new RegExp(`--font-${role}:\\s*['"]Catalog ${role}['"]`));
      assert.match(await file(system.id, 'fonts/fonts.css'), new RegExp(`font-family: ['"]Catalog ${role}['"]`));
      const bytes = await page.request.get(`${base}/api/design-systems/${system.id}/files/${response.data.rel_path}`);
      assert.equal(bytes.status(), 200); assert.deepEqual(await bytes.body(), await readFile(path.join(root, 'assets/fonts', `${fontName}.woff2`)));
      const frame = await previewReady('Body');
      const loaded = await frame.locator('body').evaluate(async (node, role) => {
        const fonts = await document.fonts.load(`16px "Catalog ${role}"`);
        return { count: fonts.length, statuses: fonts.map(font => font.status), token: getComputedStyle(node).getPropertyValue(`--font-${role}`) };
      }, role);
      await writeFile(path.join(evidence, `font-${role}.json`), JSON.stringify({ role, file: response.data.rel_path, exactBundledBytesServed: true, tokenAndFontFaceSaved: true, preview: loaded }, null, 2));
      assert.ok(loaded.count > 0, 'Uploaded font must decode in the actual preview'); assert.ok(loaded.statuses.every(status => status === 'loaded'));
      assert.ok(loaded.token.includes(`Catalog ${role}`)); return { role, file: response.data.rel_path, decoded: loaded.count };
    });
    await scenario('font-unsupported-extension', async () => {
      assert.ok(system); await visit(system.id); const before = await file(system.id, 'fonts/fonts.css');
      await page.locator('#system-font-file').setInputFiles(path.join(fixtures, 'unsupported.txt'));
      const response = await submit(`/${system.id}/fonts`, 'POST', () => button('Upload font').click(), 400);
      assert.equal(response.error.code, 'invalid_font_upload'); await visible(page.getByText('Could not upload the font', { exact: true }));
      assert.equal(await file(system.id, 'fonts/fonts.css'), before); return { status: 400, code: response.error.code };
    });
    await scenario('font-corrupt-supported-format-rejected', async () => {
      assert.ok(system); await visit(system.id); await page.locator('#system-font-file').setInputFiles(path.join(fixtures, 'invalid.woff2'));
      await page.locator('#system-font-family').fill('Corrupt font');
      const response = await submit(`/${system.id}/fonts`, 'POST', () => button('Upload font').click(), 400);
      assert.equal(response.error.code, 'invalid_font_upload'); return { status: 400 };
    });
    for (const filename of ['unsupported.txt', 'invalid.pdf', 'invalid.pptx']) await scenario(`import-negative-${filename.replace('.', '-')}`, async () => {
      await library(); const before = (await api('design-systems')).body.data.map(item => item.id).sort();
      const result = await upload(filename, `Reject ${filename}`, 400);
      assert.deepEqual((await api('design-systems')).body.data.map(item => item.id).sort(), before, 'Failed import must not leave partial catalog rows');
      return { status: 400, code: result.error.code };
    });
    await scenario('import-oversized-client-boundary', async () => {
      const oversized = path.join(fixtures, 'oversized.pdf'), handle = await open(oversized, 'w');
      try { await handle.truncate(48_000_001); } finally { await handle.close(); }
      await importDialog('upload'); assert.equal(await button('Upload design file').isDisabled(), true); const before = requests.length;
      await page.locator('#system-upload-file').setInputFiles(oversized); assert.equal(await button('Upload design file').isDisabled(), true);
      await button('Cancel').click(); await gone(page.getByRole('dialog')); assert.equal(requests.length, before);
      return { bytes: 48_000_001, maximum: 48_000_000, rejectedBeforeNetwork: true };
    });
    await scenario('import-scanned-pdf-bounded-provenance', async () => {
      const result = await upload('scanned.pdf', 'Catalog Scanned QA'), entries = result.data.extraction.provenance.content.entries;
      assert.equal(result.data.system.status, 'draft');
      assert.ok(entries.length > 0 && entries.every(entry => entry.state === 'unknown' && entry.confidence === 0), 'Raster-only input has no source evidence');
      assert.ok(!entries.some(entry => entry.domain === 'typography' && entry.state === 'observed'), 'Raster-only PDF cannot claim observed typography');
      assert.ok(result.data.extraction.notes.length > 0); await visible(page.locator('summary').filter({ hasText: /extraction note/ }));
      return { status: 'draft', scanned: true, behavior: 'Conservative scaffold, not OCR', states: [...new Set(entries.map(entry => entry.state))] };
    });
    await scenario('url-validation-and-figma-missing-key', async () => {
      const cases = [['auto', 'not a URL', 'invalid_source_url'], ['website', 'http://127.0.0.1:1/source', 'invalid_source_url'], ['github', 'file:///tmp/catalog.git', 'invalid_source_url'], ['figma', 'https://www.figma.com/file/CatalogQA/Fixture', 'figma_token_missing'], ['figma', 'not a URL', 'invalid_source_url']];
      const results = [];
      for (const [type, url, code] of cases) {
        const dialog = await importDialog('url');
        assert.equal(await dialog.getByRole('button', { name: 'Import design system', exact: true }).isDisabled(), true);
        await page.locator('#system-source-type').selectOption(type); await page.locator('#system-source-url').fill(url);
        const result = await submit('/extract', 'POST', () => dialog.getByRole('button', { name: 'Import design system', exact: true }).click(), 400);
        assert.equal(result.error.code, code); await visible(dialog.getByRole('alert')); assert.equal(await page.locator('#system-source-url').inputValue(), url);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); results.push({ type, status: 400, code });
      }
      return results;
    });
    await scenario('pinterest-empty-valid-cancel-and-invalid-urls', async () => {
      await library();
      const openPinterest = async () => { await button('Import Pinterest mood').click(); await visible(page.getByRole('dialog')); };
      await openPinterest(); assert.equal(await button('Create mood draft').isDisabled(), true); const before = requests.length;
      await page.getByRole('dialog').locator('textarea').fill('https://www.pinterest.com/pin/123/'); assert.equal(await button('Create mood draft').isEnabled(), true);
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); assert.equal(requests.length, before);
      const invalid = ['https://www.pinterest.com/qa/board/', 'https://pin.it/abc', 'not a URL', 'https://www.pinterest.com/pin/private/', Array.from({ length: 13 }, (_, index) => `https://www.pinterest.com/pin/${index + 1}/`).join('\n')];
      for (const urls of invalid) {
        await openPinterest(); await page.getByRole('dialog').locator('textarea').fill(urls);
        const result = await submit('/pinterest', 'POST', () => button('Create mood draft').click(), 400);
        assert.equal(result.error.code, 'invalid_pinterest_request'); await visible(page.getByRole('dialog').getByRole('alert'));
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      }
      return { invalidCases: invalid.length, acquisition: 'covered separately by full-public-acquisition.mjs' };
    });
    await scenario('library-search-status-combinations', async () => {
      await library(); const all = (await api('design-systems')).body.data;
      const search = page.getByRole('searchbox', { name: 'Search design systems', exact: true });
      for (const status of ['all', 'draft', 'review', 'published']) {
        await page.getByRole('combobox', { name: 'Design system status', exact: true }).selectOption(status); await search.fill('Catalog');
        const expected = all.filter(item => item.name.includes('Catalog') && (status === 'all' || item.status === status)).map(item => `/systems/${item.id}`).sort();
        assert.deepEqual(await page.locator('a[href^="/systems/"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')).sort()), expected);
      }
      await search.fill('no-such-system-catalog-qa'); assert.equal(await page.locator('a[href^="/systems/"]').count(), 0);
      await button('Clear search and filters').click(); assert.equal(await search.inputValue(), '');
      assert.equal(await page.getByRole('combobox', { name: 'Design system status', exact: true }).inputValue(), 'all');
      return { statuses: ['all', 'draft', 'review', 'published'] };
    });
    for (const endpoint of ['tokens', 'previews']) await scenario(`${endpoint}-transport-failure-real-retry`, async () => {
      assert.ok(system); const pattern = `**/api/design-systems/${system.id}/${endpoint}`, fail = route => route.abort('failed');
      await page.route(pattern, fail);
      try {
        await visit(system.id); const section = page.locator(endpoint === 'tokens' ? '#system-style-editor' : '#system-previews');
        await visible(section.getByRole('alert')); await page.unroute(pattern, fail);
        const retried = responseFor(`/${system.id}/${endpoint}`, 'GET');
        await section.getByRole('button', { name: 'Retry', exact: true }).click(); assert.equal((await retried).status(), 200);
        await gone(section.getByRole('alert')); if (endpoint === 'tokens') await visible(button('Add color')); else await previewReady('Brand colors');
        return { fault: 'explicit browser transport abort', recovery: 'real backend 200 via Retry' };
      } finally { await page.unroute(pattern, fail); }
    }, 'transport-fault-real-recovery');
    await scenario('custom-preview-and-empty-library', async () => {
      assert.ok(system);
      const directory = path.join(home, '.burnguard/data/systems', system.id);
      const custom = '<!doctype html><html><head><link rel="stylesheet" href="../colors_and_type.css"></head><body><h1>Catalog custom fixture</h1><button>Custom component</button></body></html>';
      await writeFile(path.join(directory, 'preview/catalog-custom.html'), custom);
      await visit(system.id);
      await visible((await previewReady('catalog custom')).getByRole('heading', { name: 'Catalog custom fixture', exact: true }));
      await shot('catalog-custom-preview');
      await rename(path.join(directory, 'preview'), path.join(directory, 'qa-held-previews'));
      try {
        await visit(system.id);
        const result = await api(`design-systems/${system.id}/previews`);
        assert.deepEqual(result.body.data, []);
        await visible(page.locator('#system-previews').getByRole('status'));
        assert.equal(await page.locator('iframe').count(), 0);
        return { custom: 'owned local HTML fixture', empty: 'temporarily moved owned preview directory; real backend empty list' };
      } finally { await rename(path.join(directory, 'qa-held-previews'), path.join(directory, 'preview')); }
    });
    await scenario('preview-file-transport-failure-real-retry', async () => {
      assert.ok(system);
      const pattern = `**/api/design-systems/${system.id}/files/preview/colors-brand.html*`;
      const fail = route => route.request().method() === 'HEAD' ? route.abort('failed') : route.continue();
      await page.route(pattern, fail);
      try {
        await visit(system.id);
        const article = page.locator('#system-previews article').filter({ has: page.getByText('Brand colors', { exact: true }) });
        await visible(article.getByRole('alert'));
        await page.unroute(pattern, fail);
        const retried = responseFor(`/${system.id}/files/preview/colors-brand.html`, 'HEAD');
        await article.getByRole('button', { name: 'Retry', exact: true }).click();
        assert.equal((await retried).status(), 200);
        await previewReady('Brand colors');
        return { fault: 'HEAD transport abort', recovery: 'real backend Retry and iframe' };
      } finally { await page.unroute(pattern, fail); }
    }, 'transport-fault-real-recovery');
    await scenario('missing-route-real-404-retry', async () => {
      assert.ok(system); await visit(system.id); await page.goto(`${base}/systems/full-catalog-not-found`);
      await visible(page.getByRole('heading', { name: 'Design system not found', exact: true }));
      assert.equal(await page.getByRole('heading', { name: system.name, exact: true }).count(), 0);
      const result = await submit('/full-catalog-not-found', 'GET', () => button('Retry').click(), 404);
      assert.equal(result.error.code, 'design_system_not_found'); await visible(button('Retry')); return { status: 404, staleSystemAbsent: true };
    });
    await scenario('delete-template-blocker', async () => {
      await library(); const template = (await api('design-systems')).body.data.find(item => item.is_template); assert.ok(template);
      await openDelete(template);
      const result = await submit(`/${template.id}`, 'DELETE', () => page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click(), 409);
      assert.equal(result.error.code, 'is_template'); await visible(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first());
      assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).count(), 0);
      assert.equal((await get(template.id)).is_template, true); return { id: template.id, code: result.error.code };
    });
    await scenario('delete-active-project-blocker', async () => {
      assert.ok(projectId, 'Published project fixture unavailable'); await openDelete(await get(system.id));
      const result = await submit(`/${system.id}`, 'DELETE', () => page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click(), 409);
      assert.equal(result.error.code, 'has_active_projects'); assert.ok(result.error.details.project_refs.some(item => item.id === projectId));
      await visible(page.getByRole('dialog').locator(`a[href="/projects/${projectId}"]`)); assert.equal((await get(system.id)).lifecycle, 'active');
      return { id: system.id, projectId, code: result.error.code };
    });
    await scenario('delete-cancel-confirm-persistence', async () => {
      const target = imported['Catalog PPTX QA'] ?? imported['Catalog PDF QA'] ?? imported['Catalog Scanned QA']; assert.ok(target);
      await openDelete(target); const before = await get(target.id);
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await gone(page.getByRole('dialog'));
      assert.deepEqual(await get(target.id), before); await openDelete(target);
      const deletion = await submit(`/${target.id}`, 'DELETE', () => page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click(), 200);
      assert.equal(deletion.data.deleted, true, JSON.stringify(deletion));
      await gone(page.getByRole('dialog'));
      const beforeReloadPresent = await page.locator(`a[href="/systems/${target.id}"]`).count();
      await library();
      const afterReloadPresent = await page.locator(`a[href="/systems/${target.id}"]`).count();
      const trashed = await get(target.id);
      await writeFile(path.join(evidence, 'deletion.json'), JSON.stringify({ deletion, beforeReloadPresent, afterReloadPresent, lifecycle: trashed.lifecycle }, null, 2));
      assert.equal(trashed.lifecycle, 'trashed');
      assert.ok(!(await api('design-systems?lifecycle=active')).body.data.some(item => item.id === target.id));
      assert.equal(beforeReloadPresent, 0, 'Deleted system must leave the library immediately');
      assert.equal(afterReloadPresent, 0, 'Deleted system must remain absent after reload');
      return { id: target.id, canceledWithoutMutation: true, deletedAfterConfirmation: true };
    });
    await scenario('narrow-editor-and-library', async () => {
      assert.ok(system); await page.setViewportSize({ width: 390, height: 844 }); await visit(system.id);
      await button('Colors and fonts').click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await button('Source details').click(); await shot('catalog-narrow-source'); await library();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); return { width: 390, horizontalOverflow: false };
    });
  } finally {
    const externalGaps = [
      { feature: 'Public Website/GitHub/Git acquisition', status: 'separate-module', coverage: 'full-public-acquisition.mjs', tested: source ? 'Controlled local HTTP fixture acquisition and bounded timeout, explicitly NOT public-network success.' : 'Invalid/local/non-HTTPS URLs rejected; optional local fixture needs BG_EXTRACTION_QA_ADAPTER_* before backend startup.' },
      { feature: 'Live Figma success/invalid PAT/inaccessible file/rate limit', status: 'blocked', prerequisite: 'Authorized Figma PAT and known file; no credentials saved or provider calls made.', tested: 'Missing-key and malformed-URL states against isolated backend.' },
      { feature: 'Live Pinterest palette/provenance', status: 'separate-module', coverage: 'full-public-acquisition.mjs', tested: 'Empty/valid/cancel, board, shortened, malformed/private-shaped and >12 validation here; no live success claimed by this module.' },
    ];
    await writeFile(path.join(evidence, 'catalog-report.json'), JSON.stringify({ observations, failures, externalGaps, requests, resources: { fixtures, systems: [system?.id, ...Object.values(imported).map(item => item.id)].filter(Boolean), projectId, cleanup: 'All resources belong to runner-owned home, removed by driver finally along with backend/browser.' } }, null, 2));
    if (source) await source.close();
    await writeFile(path.join(evidence, 'catalog-source-cleanup.json'), JSON.stringify({ localSourceStarted: Boolean(source), localSourceClosed: Boolean(source) }, null, 2));
    await context.unroute('**/*', guard);
  }
  assert.equal(failures.length, 0, `${failures.length} catalog checks failed; see catalog-report.json and results.json`);
}
