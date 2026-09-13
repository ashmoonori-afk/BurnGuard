import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Subscribe before input; read cancellation after the real key has bubbled.
async function press(page, target, chord, actions) {
  await target.evaluate(() => {
    window.__shortcutKey = new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Space keydown not received')), 5000);
      const keydown = event => {
        // Opening a composer can move focus out of the iframe before keyup.
        if (event.code === 'Space') queueMicrotask(() => finish(null, { prevented: event.defaultPrevented, trusted: event.isTrusted,
          ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, repeat: event.repeat }));
      };
      function finish(error, value) {
        clearTimeout(timer);
        window.removeEventListener('keydown', keydown);
        error ? reject(error) : resolve(value);
      }
      window.addEventListener('keydown', keydown);
    });
  });
  await page.keyboard.press(chord);
  const observed = await target.evaluate(() => window.__shortcutKey);
  assert.equal(observed.trusted, true);
  actions.push({ chord, surface: target === page ? 'parent' : 'iframe', ...observed });
  return observed;
}

// postMessage ordering gives a barrier after the iframe's pointer/shortcut events.
async function barrier(page, frame) {
  await page.evaluate(() => {
    window.__shortcutBarrier = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Frame barrier missing')); }, 5000);
      function receive(event) {
        if (event.source !== document.querySelector('iframe[title="Canvas"]').contentWindow || event.data !== 'shortcut-qa-barrier') return;
        clearTimeout(timer); window.removeEventListener('message', receive); resolve();
      }
      window.addEventListener('message', receive);
    });
  });
  await frame.evaluate(() => parent.postMessage('shortcut-qa-barrier', '*'));
  await page.evaluate(() => window.__shortcutBarrier);
}

export async function run({ page, context, base, home, check, shot, evidence }) {
  const actions = [], writes = [], denied = [], errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push({ method: request.method(), path: new URL(request.url()).pathname });
  });
  await context.addInitScript(() => {
    if (window.top === window) localStorage.setItem('burnguard.locale', 'en');
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && (url.origin !== base ||
      (request.method() === 'POST' && /\/(events|generate|regenerate|deploy|publish)(\/|$)/.test(url.pathname)))) {
      denied.push({ method: request.method(), path: url.pathname });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  try {
    await page.goto(base);
    await page.getByRole('tab', { name: 'Recent work', exact: true }).waitFor();
    const seeded = await promisify(execFile)('bun', [path.join(root, 'scripts/qa/fixtures/full-export/seed.ts'), home], {
      cwd: root, env: { ...process.env, BG_APP_ROOT: path.join(home, '.burnguard') }, timeout: 60000,
    });
    const projectId = JSON.parse(seeded.stdout.trim().split('\n').at(-1)).web.id;
    const endpoint = `${base}/api/projects/${projectId}/comments`;
    const popup = page.getByTestId('quick-comment-popup');
    const comments = async () => {
      const response = await page.request.get(endpoint);
      assert.equal(response.status(), 200);
      return (await response.json()).data;
    };
    await page.goto(`${base}/projects/${projectId}`);
    await page.locator('iframe[title="Canvas"][aria-busy="false"]').waitFor();
    await shot('desktop-loaded');
    const frame = page.locator('iframe[title="Canvas"]').contentFrame();
    // Resolve the actual Canvas element, not a browser-specific srcdoc URL spelling.
    const child = await (await page.locator('iframe[title="Canvas"]').elementHandle()).contentFrame();
    assert.ok(child);
    const platform = await page.evaluate(() => navigator.platform);
    assert.match(platform, /^Mac/);
    assert.equal(await child.evaluate(() => navigator.platform), platform);
    assert.equal(await page.locator('iframe[title="Canvas"]').getAttribute('sandbox'), 'allow-scripts');
    let pointer = { x: 30, y: 20 };
    const focusFrame = async () => {
      // Avoid previously created parent-overlay pins when focusing authored HTML.
      pointer = { x: pointer.x + 30, y: 20 };
      await frame.locator('h1').click({ position: pointer });
      await barrier(page, child);
      assert.equal(await page.locator('iframe[title="Canvas"]').evaluate(node => document.activeElement === node), true);
    };
    const focusParent = async () => {
      await focusFrame();
      await page.getByRole('button', { name: 'Preview', exact: true }).focus();
    };
    const open = async (target) => {
      const response = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST');
      const key = await press(page, target, 'Control+Alt+Space', actions);
      assert.equal(key.prevented, true);
      assert.equal((await response).status(), 201);
      await popup.locator('textarea').waitFor();
      assert.equal(await popup.count(), 1);
      return (await comments()).at(-1);
    };
    const close = async () => { await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' }); };

    await check('desktop-parent-rejects-reserved-chords', async () => {
      await focusParent();
      await shot('desktop-resting');
      for (const chord of ['Control+Space', 'Control+Shift+Space', 'Control+Alt+Shift+Space', 'Meta+Space', 'Alt+Space']) {
        assert.equal((await press(page, page, chord, actions)).prevented, false);
        assert.equal(await popup.count(), 0);
      }
      assert.equal((await comments()).length, 0);
      return { platform, commentCount: 0 };
    });
    await check('desktop-parent-one-anchored-composer-draft', async () => {
      await focusParent();
      const anchor = await frame.locator('h1').boundingBox();
      const created = await open(page);
      const bounds = await popup.boundingBox();
      assert.ok(bounds.x >= 12 && bounds.y >= 12 && bounds.x + bounds.width <= 1440 && bounds.y + bounds.height <= 900);
      assert.ok(Math.abs(bounds.x - (anchor.x + pointer.x + 12)) < 2);
      assert.ok(Math.abs(bounds.y - (anchor.y + pointer.y + 12)) < 2);
      assert.equal(created.node_selector, '[data-bg-node-id="hero"]');
      await shot('desktop-parent-open');
      // Existing composer focuses its textarea and keeps the same comment.
      await page.getByRole('button', { name: 'Preview', exact: true }).focus();
      await press(page, page, 'Control+Alt+Space', actions);
      assert.equal((await comments()).length, 1);
      assert.equal(await popup.count(), 1);
      await popup.locator('textarea').fill('Mac shortcut draft - 한글 메모');
      assert.equal((await press(page, page, 'Control+Alt+Space', actions)).prevented, false);
      assert.equal((await comments()).length, 1);
      await shot('desktop-draft');
      const saved = page.waitForResponse(response => response.url() === `${endpoint}/${created.id}` && response.request().method() === 'PATCH');
      await close();
      assert.equal((await saved).status(), 200);
      assert.match((await comments())[0].body, /^Mac shortcut draft/);
      await shot('desktop-escape-saved');
      return { bounds, anchor, comment: created, count: 1 };
    });
    await check('desktop-iframe-chords-editable-and-pointer-bounds', async () => {
      await focusFrame();
      for (const chord of ['Control+Space', 'Control+Shift+Space', 'Control+Alt+Shift+Space']) {
        assert.equal((await press(page, child, chord, actions)).prevented, false);
        await barrier(page, child);
        assert.equal(await popup.count(), 0);
      }
      await open(child);
      assert.equal((await comments()).length, 2);
      await shot('desktop-iframe-open');
      await close();
      await frame.locator('input').click();
      assert.equal((await press(page, child, 'Control+Alt+Space', actions)).prevented, false);
      await barrier(page, child);
      assert.equal(await popup.count(), 0);
      await focusParent();
      await page.mouse.move(10, 10);
      await barrier(page, child);
      assert.equal((await press(page, page, 'Control+Alt+Space', actions)).prevented, false);
      assert.equal((await comments()).length, 2);
      return { count: 2, editableIgnored: true, outsideIgnored: true };
    });
    await check('mobile-390-anchored-composer-and-reload-persistence', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const workspace = page.getByRole('button', { name: 'Workspace', exact: true });
      if (await workspace.isVisible()) await workspace.click();
      await focusFrame();
      await shot('mobile-resting');
      assert.equal((await press(page, child, 'Control+Space', actions)).prevented, false);
      await barrier(page, child);
      assert.equal(await popup.count(), 0);
      await open(child);
      const bounds = await popup.boundingBox();
      assert.ok(bounds.x >= 12 && bounds.y >= 12 && bounds.x + bounds.width <= 378 && bounds.y + bounds.height <= 832);
      await shot('mobile-open');
      await close();
      await shot('mobile-closed');
      await page.reload();
      await page.getByRole('button', { name: 'Workspace', exact: true }).click();
      await page.locator('iframe[title="Canvas"][aria-busy="false"]').waitFor();
      const persisted = await comments();
      assert.equal(persisted.length, 3);
      assert.match(persisted[0].body, /^Mac shortcut draft/);
      return { bounds, persistedCount: persisted.length, draft: persisted[0].body };
    });
    assert.deepEqual(denied, []);
    assert.deepEqual(errors, []);
  } finally {
    await writeFile(path.join(evidence, 'action-log.json'), JSON.stringify({ actions, writes, denied, errors }, null, 2));
  }
}
