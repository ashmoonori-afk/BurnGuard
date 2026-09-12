import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Real local CRUD only. The runner owns the browser, backend, and disposable home.
// Pass --live-auth yes for the original graphic-template readiness check; no turns are sent.
export async function run({ page, context, base, home, check, shot, evidence }) {
  const failures = [], mutations = [], createdProjects = [];
  const brands = ['SONNEL', 'FOLIOVER', 'ODDWARD', 'VELUNE'];
  const formats = [['prototype', 'Web'], ['slide_deck', 'Slides'], ['graphic', 'Graphic']];
  const button = name => page.getByRole('button', { name, exact: true });
  const field = id => page.locator(`#${id}`);
  const cards = kind => page.locator(`a[href^="/${kind}/"]:has([data-qa="project-card-details"])`);
  const visible = locator => locator.waitFor({ state: 'visible' });
  const pendingMutations = new Map();
  await context.addInitScript(() => localStorage.setItem('burnguard.locale', 'en'));
  // Subscribe before the first navigation, including any unexpected automatic turn.
  const onRequest = request => {
    const url = new URL(request.url());
    if (url.origin !== base || ['GET', 'HEAD'].includes(request.method())) return;
    const record = { method: request.method(), path: url.pathname, body: request.postData(), status: null };
    mutations.push(record); pendingMutations.set(request, record);
  };
  const onResponse = response => {
    const record = pendingMutations.get(response.request());
    if (record) { record.status = response.status(); pendingMutations.delete(response.request()); }
  };
  const onFailed = request => {
    const record = pendingMutations.get(request);
    if (record) { record.failure = request.failure(); pendingMutations.delete(request); }
  };
  context.on('request', onRequest); context.on('response', onResponse); context.on('requestfailed', onFailed);
  const guard = async route => {
    if (route.request().method() === 'POST') await route.abort('blockedbyclient');
    else await route.continue();
  };
  await context.route('**/api/sessions/*/events**', guard);
  const noTurn = () => assert.deepEqual(mutations.filter(m => m.method === 'POST' && /^\/api\/sessions\/[^/]+\/events$/.test(m.path)), [], 'Automatic provider turn attempted (blocked before dispatch)');
  const scenario = async (name, action) => {
    try { await check(`creation-${name}`, action); }
    catch (error) { failures.push({ name, error: String(error.stack ?? error) }); }
    await writeFile(path.join(evidence, 'creation-network.json'), JSON.stringify(mutations, null, 2));
  };
  const responseFor = (pathname, method = 'GET') => page.waitForResponse(r => new URL(r.url()).pathname === pathname && r.request().method() === method, { timeout: 45_000 });
  const mutate = async (pathname, method, action, status) => {
    const [response] = await Promise.all([responseFor(pathname, method), action()]);
    const body = await response.json();
    assert.equal(response.status(), status, JSON.stringify(body));
    const request = response.request();
    return { data: body.data, request: request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : { contentType: request.headers()['content-type'] } };
  };
  const get = async pathname => {
    const response = await page.request.get(`${base}/api/${pathname}`);
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).data;
  };
  const onlyInitializationEvents = async sessionId => {
    const events = await get(`sessions/${sessionId}/events`);
    assert.ok(events.length > 0, 'Expected a durable artifact initialization receipt');
    for (const { event } of events) {
      assert.equal(event.type, 'artifact.operation', `Unexpected provider/session event: ${JSON.stringify(event)}`);
      assert.equal(event.outcome, 'committed'); assert.equal(event.revision, 1);
    }
    return events.map(({ event }) => ({ type: event.type, outcome: event.outcome, revision: event.revision }));
  };
  const library = async view => {
    await page.goto(`${base}/?view=${view}`);
    await visible(page.getByRole('searchbox'));
    await visible(cards(view === 'systems' ? 'systems' : 'projects').first());
  };
  const form = async type => {
    const lists = Promise.all(['draft', 'review', 'published'].map(status => page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.pathname === '/api/design-systems' && url.searchParams.get('status') === status;
    })));
    await Promise.all([lists, responseFor('/api/backends/detect'), page.goto(`${base}/?view=mine&create=${type}`)]);
    await visible(field('project-name'));
    // Waiting for this option also covers React's consumption of the list response.
    if (type !== 'other') await field('design-system').locator('option[value="sample-system-original-sonnel"]').waitFor({ state: 'attached' });
  };
  const fillBrief = async name => {
    await field('project-name').fill(name);
    await field('brief-audience').fill('Local project creation reviewers');
    await field('brief-objective').fill('Inspect the created artifact without sending a provider turn.');
  };
  const details = async () => {
    const summary = page.locator('details:has(#brief-content-source) > summary');
    if (!await field('brief-content-source').isVisible()) await summary.click();
  };
  const canvas = async (type, brand) => {
    const frame = page.frameLocator('iframe').first();
    // Exclude the temporary placeholder iframe; only canonical artifacts carry node IDs.
    const anchor = type === 'slide_deck' ? '[data-slide]' : type === 'graphic' ? '[data-bg-node-id="poster"], [data-graphic-artboard]' : '[data-bg-node-id]';
    await visible(frame.locator(anchor).first());
    const observation = await frame.locator('body').evaluate(async (body, type) => {
      await document.fonts.ready;
      await Promise.all([...body.querySelectorAll('img')].map(image => image.decode()));
      const box = (type === 'slide_deck' ? body.querySelector('[data-slide]') : body).getBoundingClientRect();
      const board = body.querySelector('[data-graphic-artboard], [data-bg-node-id="poster"]');
      const boardBox = board?.getBoundingClientRect();
      return { title: document.title, textLength: body.innerText.trim().length, width: box.width, height: box.height,
        slides: body.querySelectorAll('[data-slide]').length,
        board: board ? { width: board.offsetWidth, height: board.offsetHeight } : null,
        renderedBoard: boardBox ? { width: boardBox.width, height: boardBox.height } : null,
        images: [...body.querySelectorAll('img')].map(image => ({ width: image.naturalWidth, height: image.naturalHeight })), type };
    }, type);
    assert.ok(observation.textLength > 20 && observation.width > 0 && observation.height > 0, JSON.stringify(observation));
    if (brand) assert.match(observation.title, new RegExp(brand, 'i'));
    if (type === 'slide_deck') assert.equal(observation.slides, brand ? 6 : 3);
    if (type === 'graphic') assert.deepEqual(observation.board, { width: 1080, height: 1350 });
    noTurn(); return observation;
  };
  const create = async (expectedType, expectedSystem = null, brand) => {
    assert.equal(await button('Create project').isEnabled(), true, `Create disabled: ${await page.getByRole('dialog').innerText()}`);
    const { data, request } = await mutate('/api/projects', 'POST', () => button('Create project').click(), 201);
    createdProjects.push(data);
    assert.equal(request.type, expectedType); assert.equal(request.design_system_id, expectedSystem);
    await page.waitForURL(`**/projects/${data.id}`);
    const preview = await canvas(expectedType, brand);
    const project = await get(`projects/${data.id}`);
    const options = JSON.parse(project.options_json);
    assert.equal(project.type, expectedType); assert.equal(project.design_system_id, expectedSystem);
    assert.deepEqual(options.design_brief, request.options.design_brief);
    assert.ok(path.resolve(project.dir_path).startsWith(`${path.resolve(home)}${path.sep}`), 'Artifact must be in owned home');
    const html = await readFile(path.join(project.dir_path, project.entrypoint), 'utf8');
    assert.ok(html.length > 100);
    const session = await get(`projects/${data.id}/session`);
    assert.equal(session.id, data.session_id); assert.equal(session.status, 'idle');
    await onlyInitializationEvents(data.session_id);
    assert.ok(Object.values(session.usage).every(value => value === 0), 'Creation must not consume provider tokens');
    await page.reload(); await canvas(expectedType, brand);
    assert.deepEqual(JSON.parse((await get(`projects/${data.id}`)).options_json), options);
    noTurn(); return { id: data.id, entrypoint: project.entrypoint, request, options, preview, html };
  };

  try {
    await scenario('home-project-search-no-results-reset', async () => {
      await library('examples');
      const search = page.getByRole('searchbox');
      const total = await cards('projects').count();
      assert.equal(await cards('projects').filter({ hasText: /(?:SONNEL|FOLIOVER|ODDWARD|VELUNE) · (?:Web|Slides|Graphic)/ }).count(), 12);
      await search.fill('VELUNE'); await visible(cards('projects').filter({ hasText: 'VELUNE' }).first());
      assert.equal(await cards('projects').count(), 3);
      await search.fill('basic-creation-missing-project'); await visible(button('Clear search'));
      assert.equal(await cards('projects').count(), 0);
      await button('Clear search').click(); await visible(cards('projects').first());
      assert.equal(await search.inputValue(), ''); assert.equal(await search.evaluate(node => node === document.activeElement), true);
      assert.equal(await cards('projects').count(), total);
      await search.fill('SONNEL'); await search.press('Escape');
      assert.equal(await search.inputValue(), ''); assert.equal(await cards('projects').count(), total);
      return { total, matching: 3, noResults: 0, resetFocus: true };
    });
    await scenario('home-system-search-status-no-results-reset', async () => {
      await library('systems');
      const search = page.getByRole('searchbox'), status = page.getByRole('combobox', { name: 'Design system status' });
      const total = await cards('systems').count();
      await search.fill('SONNEL'); await visible(cards('systems').filter({ hasText: 'SONNEL' })); assert.equal(await cards('systems').count(), 1);
      await status.selectOption('published'); assert.equal(await cards('systems').count(), 1);
      await status.selectOption('draft'); await visible(button('Clear search and filters')); assert.equal(await cards('systems').count(), 0);
      await status.selectOption('review'); assert.equal(await cards('systems').count(), 0);
      await button('Clear search and filters').click(); await visible(cards('systems').first());
      assert.equal(await status.inputValue(), 'all'); assert.equal(await search.inputValue(), '');
      assert.equal(await search.evaluate(node => node === document.activeElement), true);
      await search.fill('basic-creation-missing-system'); await visible(button('Clear search and filters')); assert.equal(await cards('systems').count(), 0);
      await search.press('Escape'); assert.equal(await search.inputValue(), ''); assert.equal(await cards('systems').count(), total);
      return { total, matching: 1, statuses: ['all', 'draft', 'review', 'published'], resetFocus: true };
    });
    for (const brand of brands) for (const [type, label] of formats) {
      await scenario(`example-${brand.toLowerCase()}-${type}`, async () => {
        await library('examples');
        await cards('projects').filter({ hasText: `${brand} · ${label}` }).click();
        await page.waitForURL('**/projects/*');
        return canvas(type, brand);
      });
    }
    for (const type of ['prototype', 'slide_deck', 'other', 'from_template']) {
      await scenario(`draft-${type}-reload-and-isolation`, async () => {
        await form(type); await fillBrief(`Draft ${type}`); await details();
        await field('brief-content-source').selectOption('existing_files'); await field('brief-visual-mood').selectOption('premium');
        await field('brief-density').selectOption('dense'); await field('brief-output-size').selectOption('letter');
        if (type === 'prototype') { await field('section-count').fill('8'); await button('Add About page').click(); }
        if (type === 'slide_deck') await page.getByRole('switch', { name: 'Use speaker notes' }).click();
        if (type === 'from_template') await page.getByRole('switch', { name: 'Copy template as is' }).click();
        const draft = await page.evaluate(type => JSON.parse(localStorage.getItem(`bg.new-project.${type}`)), type);
        await page.reload(); await visible(field('project-name')); await details();
        assert.equal(await field('project-name').inputValue(), `Draft ${type}`);
        for (const [id, key] of [['brief-audience', 'audience'], ['brief-objective', 'objective'], ['brief-content-source', 'contentSource'], ['brief-visual-mood', 'visualMood'], ['brief-density', 'density'], ['brief-output-size', 'outputSize']]) assert.equal(await field(id).inputValue(), draft[key]);
        if (type === 'prototype') { assert.equal(await field('section-count').inputValue(), '8'); assert.equal(await button('Remove About page').getAttribute('aria-pressed'), 'true'); }
        if (type === 'slide_deck') assert.equal(await page.getByRole('switch', { name: 'Use speaker notes' }).getAttribute('aria-checked'), 'true');
        if (type === 'from_template') assert.equal(await page.getByRole('switch', { name: 'Copy template as is' }).getAttribute('aria-checked'), 'true');
        await form(type === 'other' ? 'prototype' : 'other');
        assert.notEqual(await field('project-name').inputValue(), `Draft ${type}`);
        await form(type); assert.equal(await field('project-name').inputValue(), `Draft ${type}`);
        return { type, draft };
      });
    }
    await scenario('required-name-brief-and-section-validation', async () => {
      await form('prototype'); await fillBrief('Validation');
      const before = mutations.filter(m => m.path === '/api/projects' && m.method === 'POST').length;
      for (const id of ['project-name', 'brief-audience', 'brief-objective']) {
        const previous = await field(id).inputValue(); await field(id).fill('   ');
        assert.equal(await button('Create project').isDisabled(), true, `${id} whitespace must be invalid`);
        await field(id).fill(''); assert.equal(await field(id).evaluate(node => node.validity.valueMissing), true);
        await field(id).fill(previous);
      }
      for (const [id, limit] of [['brief-audience', 200], ['brief-objective', 1000]]) {
        await field(id).fill('x'.repeat(limit + 1)); assert.equal((await field(id).inputValue()).length, limit);
      }
      await fillBrief('Validation');
      for (const value of ['0', '31', '1.5', '']) { await field('section-count').fill(value); assert.equal(await button('Create project').isDisabled(), true, `section count ${value}`); }
      for (const value of ['1', '30', '8']) { await field('section-count').fill(value); assert.equal(await button('Create project').isEnabled(), true); }
      assert.equal(mutations.filter(m => m.path === '/api/projects' && m.method === 'POST').length, before);
      return { required: ['name', 'audience', 'objective'], maxLengths: [200, 1000], invalidSections: [0, 31, 1.5, ''], validSections: [1, 30, 8], mutations: 0 };
    });
    await scenario('page-validation-at-persisted-draft-boundary', async () => {
      await form('prototype'); await fillBrief('Page validation'); await field('section-count').fill('6');
      const key = 'bg.new-project.prototype';
      const original = await page.evaluate(key => localStorage.getItem(key), key);
      const draft = JSON.parse(original), observed = [];
      const before = mutations.filter(m => m.path === '/api/projects' && m.method === 'POST').length;
      // The real UI offers only five safe presets. Malformed paths can enter only
      // through a persisted draft, so these are storage-boundary fixtures, not CRUD mocks.
      try {
        for (const pages of [['../escape.html'], ['index.html'], ['about.html', 'ABOUT.html'], ['bad page.html'], Array.from({ length: 13 }, (_, index) => `page-${index}.html`)]) {
          await page.evaluate(({ key, draft, pages }) => localStorage.setItem(key, JSON.stringify({ ...draft, pages })), { key, draft, pages });
          await page.reload(); await visible(field('project-name'));
          assert.equal(await button('Create project').isDisabled(), true, JSON.stringify(pages));
          observed.push({ pages, createDisabled: true, screenshot: await shot(`creation-invalid-pages-${observed.length}`) });
        }
        assert.equal(mutations.filter(m => m.path === '/api/projects' && m.method === 'POST').length, before);
      } finally {
        await page.evaluate(({ key, original }) => localStorage.setItem(key, original), { key, original });
        await page.reload(); await visible(field('project-name'));
      }
      return { observed, mutations: 0, fixture: 'persisted creation draft only' };
    });
    await scenario('prototype-page-presets-create-persist', async () => {
      await form('prototype'); await fillBrief('Basic prototype pages'); await field('section-count').fill('8');
      for (const name of ['About', 'Services', 'Portfolio', 'Contact', 'Announcements']) {
        const add = button(`Add ${name} page`); if (await add.count()) await add.click();
        assert.equal(await button(`Remove ${name} page`).getAttribute('aria-pressed'), 'true');
      }
      await button('Remove Contact page').click(); await button('Add Contact page').click();
      const result = await create('prototype');
      assert.equal(result.options.design_brief.section_count, 8);
      assert.deepEqual([...result.options.design_brief.pages].sort(), ['about.html', 'contact.html', 'notice.html', 'portfolio.html', 'services.html']);
      assert.equal(result.entrypoint, 'index.html');
      // Presets are generation brief inputs: creation intentionally does not run generation.
      return { ...result, html: undefined, pagesAreBriefInputs: true };
    });
    await scenario('slide-deck-create-speaker-notes', async () => {
      await form('slide_deck'); await fillBrief('Basic slide deck'); await details(); await field('brief-output-size').selectOption('widescreen-16x9');
      const notes = page.getByRole('switch', { name: 'Use speaker notes' }); if (await notes.getAttribute('aria-checked') !== 'true') await notes.click();
      const result = await create('slide_deck'); assert.equal(result.options.use_speaker_notes, true); assert.equal(result.entrypoint, 'deck.html');
      assert.match(result.html, /data-speaker-notes/); return { ...result, html: undefined };
    });
    await scenario('other-create', async () => {
      await form('other'); await fillBrief('Basic other'); const result = await create('other'); assert.equal(result.entrypoint, 'index.html'); return { ...result, html: undefined };
    });
    for (const [type] of formats) await scenario(`from-template-original-${type}`, async () => {
      await form('from_template'); await fillBrief(`Basic template ${type}`);
      assert.equal(await field('design-system').inputValue(), ''); assert.equal(await button('Create project').isDisabled(), true);
      const id = 'sample-system-original-sonnel'; await field('design-system').selectOption(id); await field('template-format').selectOption(type);
      assert.equal(await page.getByRole('switch', { name: 'Copy template as is' }).count(), 0);
      if (type === 'graphic') {
        const detection = await get('backends/detect');
        await writeFile(path.join(evidence, 'creation-graphic-readiness.json'), JSON.stringify(detection, null, 2));
        assert.ok(detection.backends.some(backend => backend.id === 'codex' && backend.found && backend.authenticated === true), `Graphic template creation blocked by real Codex readiness: ${JSON.stringify(detection)}`);
      }
      const result = await create(type, id, 'SONNEL');
      const directory = type === 'prototype' ? 'web' : type === 'slide_deck' ? 'slides' : 'graphic';
      assert.equal(result.html, await readFile(new URL(`../../samples/original/sonnel/${directory}/${result.entrypoint}`, import.meta.url), 'utf8'), 'Original template artifact must match the shipped source');
      if (type === 'graphic') { assert.equal(result.request.backend_id, 'codex'); assert.deepEqual(result.options.graphic_canvas, { schema_version: 1, width: 1080, height: 1350 }); }
      return { ...result, html: undefined };
    });
    await scenario('from-template-nonoriginal-copy-as-is', async () => {
      await form('from_template'); await fillBrief('Basic template copy');
      const published = await get('design-systems?status=published&lifecycle=active');
      const template = published.find(system => system.is_template && !system.id.startsWith('sample-system-original-'));
      assert.ok(template, 'No non-original published template offered by this clean catalog');
      await field('design-system').selectOption(template.id);
      assert.equal(await field('template-format').count(), 0);
      const copy = page.getByRole('switch', { name: 'Copy template as is' }); if (await copy.getAttribute('aria-checked') !== 'true') await copy.click();
      const source = await page.request.get(`${base}/api/design-systems/${template.id}/files/preview.html`);
      assert.equal(source.status(), 200, 'Published template preview must be available');
      const result = await create('from_template', template.id); assert.equal(result.options.copy_as_is, true);
      assert.equal(result.html, await source.text(), 'Copy-as-is must preserve the source template artifact');
      return { ...result, html: undefined, template: template.id, sourceEquality: true };
    });
    await scenario('explicit-published-system-eligibility', async () => {
      await library('systems'); await page.getByRole('button', { name: /Import design system/ }).click(); await button('Upload file').click();
      const require = createRequire(new URL('../../packages/backend/package.json', import.meta.url));
      const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const reference = pdf.addPage([640, 480]);
      reference.drawText('Basic creation eligibility', { x: 40, y: 400, size: 28, font, color: rgb(0.1, 0.3, 0.6) });
      reference.drawText('Local catalog publication and selection reference.', { x: 40, y: 340, size: 16, font });
      await field('system-upload-file').setInputFiles({ name: 'basic-creation-system.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
      await field('system-draft-name').fill('Basic creation eligibility');
      const imported = await mutate('/api/design-systems/upload', 'POST', () => button('Upload design file').click(), 201);
      const id = imported.data.system.id;
      const statuses = [];
      for (const status of ['draft', 'review', 'published']) {
        await form('prototype');
        assert.equal((await get(`design-systems/${id}`)).status, status);
        assert.equal(await field('design-system').inputValue(), '', `${status} must never be automatically selected`);
        const values = await field('design-system').locator('option').evaluateAll(options => options.map(option => option.value));
        assert.equal(values.includes(id), status === 'published'); statuses.push({ status, eligible: values.includes(id), selected: '' });
        if (status !== 'published') {
          await page.goto(`${base}/systems/${id}`); await visible(button('Edit details'));
          await mutate(`/api/design-systems/${id}`, 'PATCH', () => button(status === 'draft' ? 'Start review' : 'Publish design system').click(), 200);
        }
      }
      await field('design-system').selectOption(id); await fillBrief('Basic explicitly selected system');
      const result = await create('prototype', id);
      return { id, statuses, project: result.id };
    });
    await scenario('no-automatic-provider-turn', async () => {
      noTurn();
      assert.ok(createdProjects.length > 0, 'No project session was created; provider-turn behavior remains blocked');
      for (const project of createdProjects) await onlyInitializationEvents(project.session_id);
      return { attemptedProviderPosts: 0, createdSessionsChecked: createdProjects.length, screenshot: await shot('creation-final-no-provider-turn') };
    });
  } finally {
    await writeFile(path.join(evidence, 'creation-network.json'), JSON.stringify(mutations, null, 2));
    await writeFile(path.join(evidence, 'creation-summary.json'), JSON.stringify({ failures, createdProjects, cleanupOwner: 'full-feature-runner', fixtureStorage: 'generated PDF uploaded through browser and persisted-draft boundary fixtures; owned home removed by runner' }, null, 2));
    context.off('request', onRequest); context.off('response', onResponse); context.off('requestfailed', onFailed);
    await context.unroute('**/api/sessions/*/events**', guard);
  }
  if (failures.length) throw new AggregateError(failures.map(f => new Error(`${f.name}: ${f.error}`)), `${failures.length} project-creation cases failed; see creation-summary.json`);
}
