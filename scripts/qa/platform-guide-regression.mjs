import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Subscribe before the export click; the real UI's job-list response is the signal.
function terminalExport(page, projectId, format) {
  let dispose;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Export did not settle')), 60_000);
    const finish = (error, job) => {
      clearTimeout(timer);
      page.off('response', listener);
      error ? reject(error) : resolve(job);
    };
    async function listener(response) {
      if (response.request().method() !== 'GET' ||
          new URL(response.url()).pathname !== `/api/projects/${projectId}/exports` || !response.ok()) return;
      try {
        const job = (await response.json()).data.find(row => row.format === format && ['succeeded', 'failed'].includes(row.status));
        if (job) finish(null, job);
      } catch (error) { finish(error); }
    }
    page.on('response', listener);
    dispose = () => finish(null, null);
  });
  promise.catch(() => {});
  return { promise, dispose };
}

// Radix restores focus on unmount asynchronously. Observe focusin, not timing luck.
export async function closeAndRestore(page, opener, close) {
  await opener.evaluate(node => {
    window.__platformGuideFocus = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        node.removeEventListener('focusin', focused);
        reject(new Error(`Focus was not restored; active=${document.activeElement?.tagName}`));
      }, 5_000);
      function focused() {
        clearTimeout(timer);
        resolve(true);
      }
      node.addEventListener('focusin', focused, { once: true });
    });
    window.__platformGuideFocus.catch(() => {});
  });
  await close();
  await page.evaluate(() => window.__platformGuideFocus);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate(node => document.activeElement === node), true);
}

export async function run({ page, context, base, home, check, shot, evidence }) {
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(String(error)));
  await context.addInitScript(() => {
    if (window.top === window) localStorage.setItem('burnguard.locale', 'en');
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.goto(base);
  await page.getByRole('tab', { name: 'Recent work', exact: true }).waitFor();
  const seeded = await promisify(execFile)('bun', [path.join(root, 'scripts/qa/fixtures/full-export/seed.ts'), home], {
    cwd: root, env: { ...process.env, BG_APP_ROOT: path.join(home, '.burnguard') }, timeout: 60_000,
  });
  const projectId = JSON.parse(seeded.stdout.trim().split('\n').at(-1)).web.id;
  await page.goto(`${base}/projects/${projectId}`);
  await page.frameLocator('iframe[title="Canvas"]').locator('h1').first().waitFor();
  const menu = page.locator('[data-export-menu-content]');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  for (const [platform, label] of [['cafe24', 'Cafe24 Smart Design package'], ['imweb', 'Imweb code widget package']]) {
    const settled = terminalExport(page, projectId, `${platform}_package`);
    try {
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      const job = await settled.promise;
      assert.equal(job.status, 'succeeded', JSON.stringify(job));
    } finally { settled.dispose(); }
  }

  for (const width of [1440, 390]) {
    for (const platform of ['cafe24', 'imweb']) {
      await check(`platform-${platform}-guide-${width}`, async () => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        const menuFits = await menu.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          return bounds.top >= 0 && bounds.bottom <= innerHeight + 1 && bounds.left >= 0 && bounds.right <= innerWidth + 1;
        });
        assert.equal(menuFits, true, 'All export actions must be reachable in the actual viewport');
        const opener = page.getByRole('button', { name: `View ${platform === 'cafe24' ? 'Cafe24' : 'Imweb'} package installation guide`, exact: true, includeHidden: true });
        await opener.scrollIntoViewIfNeeded();
        const scrollBefore = await menu.evaluate(node => ({ menu: node.scrollTop, page: window.scrollY }));
        await opener.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.evaluate(() => document.fonts.ready);
        const title = await dialog.getByRole('heading').first().boundingBox();
        const close = await dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox();
        assert.ok(title && close);
        const titleFits = title.x + title.width <= close.x || title.y + title.height <= close.y;
        assert.equal(titleFits, true, 'Guide title must not overlap Close');
        assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
        for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Tab']) {
          await page.keyboard.press(key);
          assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
        }
        await dialog.evaluate(node => { node.scrollTop = 0; });
        const stacking = await dialog.evaluate(node => {
          const overlay = node.previousElementSibling;
          const menu = document.querySelector('[data-export-menu-content]');
          const menuLayers = [];
          for (let ancestor = menu; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
            menuLayers.push({ tag: ancestor.tagName, z: getComputedStyle(ancestor).zIndex });
          }
          return {
            dialog: Number(getComputedStyle(node).zIndex),
            overlay: Number(getComputedStyle(overlay).zIndex),
            overlayBackground: getComputedStyle(overlay).backgroundColor,
            rootPortals: node.parentElement === document.body && overlay.parentElement === document.body,
            menuLayers,
            viewportFits: node.getBoundingClientRect().left >= 0 && node.getBoundingClientRect().right <= innerWidth,
          };
        });
        assert.equal(stacking.rootPortals, true);
        const menuLayer = Math.max(...stacking.menuLayers.map(layer => Number(layer.z) || 0));
        assert.ok(stacking.overlay > menuLayer, JSON.stringify(stacking));
        assert.ok(stacking.dialog >= stacking.overlay, JSON.stringify(stacking));
        assert.notEqual(stacking.overlayBackground, 'rgba(0, 0, 0, 0)');
        assert.equal(stacking.viewportFits, true);
        await shot(`platform-${platform}-guide-${width}-open`);

        // Unlike pointer hit tests, this catches a pointer-inert menu painting
        // over the modal. Hiding that menu must not change opaque dialog pixels.
        let paintEqual = null;
        if (width === 390) {
          const d = await dialog.boundingBox(), m = await menu.boundingBox();
          const x = Math.ceil(Math.max(d.x + 24, m.x + 4));
          const y = Math.ceil(Math.max(d.y + 24, m.y + 4));
          const clip = { x, y, width: Math.floor(Math.min(d.x + d.width - 24, m.x + m.width - 4) - x), height: Math.floor(Math.min(d.y + d.height - 24, m.y + m.height - 4) - y) };
          assert.ok(clip.width > 100 && clip.height > 100, JSON.stringify(clip));
          const visible = await page.screenshot({ clip, animations: 'disabled' });
          const originalVisibility = await menu.evaluate(node => {
            const previous = node.style.visibility;
            node.style.visibility = 'hidden';
            return previous;
          });
          let hidden;
          try { hidden = await page.screenshot({ clip, animations: 'disabled' }); }
          finally { await menu.evaluate((node, previous) => { node.style.visibility = previous; }, originalVisibility); }
          paintEqual = visible.equals(hidden);
          assert.equal(paintEqual, true, 'The originating menu changes pixels inside the opaque guide');
          await dialog.evaluate(node => { node.scrollTop = node.scrollHeight; });
          assert.ok(await dialog.evaluate(node => node.scrollTop > 0));
          await shot(`platform-${platform}-guide-${width}-scrolled`);
        }
        await closeAndRestore(page, opener, () => page.keyboard.press('Escape'));
        assert.deepEqual(await menu.evaluate(node => ({ menu: node.scrollTop, page: window.scrollY })), scrollBefore);
        await shot(`platform-${platform}-guide-${width}-restored`);

        // Keyboard reopening and explicit close must share restoration semantics.
        await page.keyboard.press('Enter');
        await dialog.waitFor();
        await closeAndRestore(page, opener, () => dialog.getByRole('button', { name: 'Close', exact: true }).click());
        assert.deepEqual(await menu.evaluate(node => ({ menu: node.scrollTop, page: window.scrollY })), scrollBefore);
        return { stacking, paintEqual, escapeFocusRestored: true, closeButtonFocusRestored: true, keyboardReopen: true, scrollPreserved: true };
      });
    }
  }
  await closeAndRestore(page, page.getByRole('button', { name: 'Export', exact: true, includeHidden: true }), () => page.keyboard.press('Escape'));
  await menu.waitFor({ state: 'detached' });
  await writeFile(path.join(evidence, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2));
  assert.deepEqual(browserErrors, []);
}
