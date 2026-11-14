// Optional real-browser check. No production or repository dependency is added.
// node cast-distance/tests/browser-smoke.cjs <path-to-playwright-or-playwright-core>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const prefix = '/utility_html/cast-distance/';
const historyKey = 'fishing-distance-log-v1';
const oldEntry = {id: 'legacy', at: '2025-10-01T12:34:56Z', gear: '旧リール', lure: '旧ルアー',
  turns: 45, rate: 89, correction: 100, distance: 40.1, place: '旧釣り場', memo: '以前の記録'};
const legacyHistory = JSON.stringify([oldEntry]);
// Exercise an actual update from the version before the master-data feature.
const legacy = Object.fromEntries(['index.html', 'sw.js'].map(file => [file,
  execFileSync('git', ['show', '50fe63b:cast-distance/' + file], {cwd: root, encoding: 'utf8'})]));
let serveLegacy = true, offline = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const file = url.pathname.slice(prefix.length) || 'index.html';
  if (!['index.html', 'sw.js', 'master-config.js', 'master.js', 'tackle.js',
    'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].includes(file)) { res.writeHead(404).end(); return; }
  const mime = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' :
    file.endsWith('.png') ? 'image/png' : 'application/manifest+json';
  res.writeHead(200, {'Content-Type': mime + (file.endsWith('.png') ? '' : '; charset=utf-8'), 'Cache-Control': 'no-store'});
  res.end(serveLegacy && legacy[file] ? legacy[file] : fs.readFileSync(path.join(root, file)));
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({key, value}) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    }, {key: historyKey, value: legacyHistory});
    await context.route('https://script.google.com/macros/s/browser-test/exec?*', async route => {
      if (offline) { await route.abort('internetdisconnected'); return; }
      const callback = new URL(route.request().url()).searchParams.get('callback');
      // Deliberately omit Access-Control-Allow-Origin: transport must work without CORS.
      await route.fulfill({contentType: 'text/javascript', body: callback + '(' + JSON.stringify({version: 1,
        lures: [{id: '1', name: 'テストミノー 11g / 青', weight: 11, color: '青', state: '良好', maker: 'メーカー'}],
        reels: [{id: 'REEL-01', name: 'エクスセンス BB C3000MHG', rate: 89, basis: 'メーカー公称'},
          {id: 'REEL-02', name: 'P Prospec C3000SDH', rate: 75, basis: '暫定推定（未実測）'}]
      }) + ');'});
    });
    await page.goto(base);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.equal(await page.locator('#count').textContent(), '1');
    serveLegacy = false;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
      const worker = registration.installing || registration.waiting || registration.active;
      if (worker.state !== 'activated') await new Promise((resolve, reject) => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve();
          if (worker.state === 'redundant') reject(Error('SW update failed'));
        });
      });
    });
    await page.reload();
    await page.locator('#master-status').waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), historyKey), legacyHistory);
    assert.equal(await page.locator('#count').textContent(), '1');
    await page.locator('summary').click();
    await page.locator('#master-url').fill('https://script.google.com/macros/s/browser-test/exec');
    await page.locator('#master-connect').click();
    await page.waitForFunction(() => document.getElementById('master-status').textContent.startsWith('更新済み'));
    await page.locator('summary').click();
    await page.locator('#lure').selectOption('master:1');
    await page.locator('#gear').selectOption('master:REEL-02');
    assert.equal(await page.locator('#rate').inputValue(), '75');
    await page.locator('#turns').fill('45');
    assert.equal(await page.locator('#estimate').textContent(), '33.8 m');
    await page.locator('#save').click();
    await page.locator('#lure').selectOption('custom');
    await page.locator('#custom-lure').fill('自作ジグ 20g / 銀');
    await page.locator('#gear').selectOption('custom');
    await page.locator('#custom-gear').fill('自分のリール');
    await page.locator('#rate').fill('80');
    await page.locator('#turns').fill('45');
    await page.locator('#save').click();
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), historyKey);
    assert.equal(saved.length, 3);assert.deepEqual(saved[2], oldEntry);
    assert.ok(saved[0].lureId);assert.ok(saved[0].reelId);
    const download = page.waitForEvent('download');
    await page.locator('#export').click();
    assert.match((await download).suggestedFilename(), /^cast_distance_.*\.csv$/);
    const output = path.join(os.tmpdir(), 'cast-distance-browser-check');
    fs.mkdirSync(output, {recursive: true});
    await page.screenshot({path: path.join(output, 'mobile-online.png'), fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    offline = true;
    await context.setOffline(true);
    for (const suffix of ['index.html', '?installed=1']) {
      await page.goto(base + suffix);
      await page.waitForFunction(() => document.getElementById('master-status').textContent.includes('更新に失敗'));
      assert.match(await page.locator('#master-status').textContent(), /キャッシュ使用中/);
      assert.equal(await page.locator('#count').textContent(), '3');
      assert.equal(await page.locator('#rate').inputValue(), '80');
      await page.locator('#lure').selectOption('master:1');
    }
    await page.locator('#gear').selectOption('master:REEL-01');
    await page.locator('#turns').fill('45');
    assert.equal(await page.locator('#estimate').textContent(), '40.1 m');
    await page.screenshot({path: path.join(output, 'mobile-offline.png'), fullPage: true});
    assert.deepEqual(errors, []);
    console.log('PASS: v2→v3 SW update, history preservation, mobile JSONP without CORS, custom registration, CSV, offline reload/calculation.');
    console.log('Screenshots: ' + output);
    await context.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
