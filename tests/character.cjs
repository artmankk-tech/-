// node tests/character.cjs : 公開済みv5から画像付きv6への更新を実ブラウザで検証。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = 'b7941705d4f1c05ec782e2ff6c2cfdbe692a37a7';
const files = ['index.html', 'game.js', 'app.js', 'style.css', 'sw.js', 'assets/employee-atlas.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let legacy = true;
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.replace(/^\/-\//, '') || 'index.html';
  if (!files.includes(name)) { res.writeHead(404); res.end(); return; }
  const body = legacy ? execFileSync('git', ['show', baseline + ':' + name], { cwd: root }) : fs.readFileSync(path.join(root, name));
  res.writeHead(200, { 'Content-Type': mime[path.extname(name)], 'Cache-Control': 'no-store' });
  res.end(body);
});
function watch(page, errors) { page.on('dialog', d => d.accept()); page.on('pageerror', e => errors.push(e.message)); }
async function ready(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
}
async function decode(page) {
  return page.evaluate(async () => {
    const image = new Image(); image.src = './assets/employee-atlas.png'; await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/-/`;
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    let page = await context.newPage(); watch(page, errors);
    await page.goto(url); await ready(page);
    await page.evaluate(() => {
      toggleTask('w0'); for (let i = 0; i < 3; i++) addBonus();
      exchangeItem('decor-plant'); switchMode('life'); toggleTask('l0'); save();
    });
    const original = await page.evaluate(() => localStorage.getItem(KEY));
    legacy = false;
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()).waiting);
    await page.reload();
    assert.equal(await page.locator('.employee-art').count(), 0, 'old screen stays on v5');
    await page.close();
    page = await context.newPage(); watch(page, errors);
    await page.goto(url); await ready(page);
    await page.locator('.employee-art').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem(KEY)), original, 'XP, coins and inventory preserved byte-for-byte');
    assert.equal(await page.locator('.employee-art').getAttribute('data-frame'), '0');
    assert.match(await page.locator('#employeeScene').textContent(), /寡黙な実力派/);
    assert.deepEqual(await decode(page), { width: 1254, height: 1254 });
    console.log('PASS: actual v5→v6 update waits, new artwork decodes, saved data unchanged byte-for-byte');

    // 有効なバックアップをテスト用残高で復元し、3衣装の実際の交換操作を確認。
    const fixture = { version: 3, data: JSON.parse(original) };
    fixture.data.work.game.coins = 400;
    await page.locator('#importFile').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await page.waitForFunction(() => data.work.game.coins === 400);
    await page.locator('#shop-outfit').tap();
    for (const [name, frame, balance] of [['ミントのジャケット：30 Cで交換', '6', 370], ['コーラルのセットアップ：60 Cで交換', '7', 310], ['星空のスーツ：120 Cで交換', '8', 190]]) {
      await page.getByRole('button', { name, exact: true }).tap();
      assert.equal(await page.locator('.employee-art').getAttribute('data-frame'), frame);
      assert.equal(await page.evaluate(() => data.work.game.coins), balance);
    }
    await page.locator('#lifeTab').tap(); assert.equal(await page.locator('.employee-art').getAttribute('data-frame'), '0');
    await page.locator('#workTab').tap(); assert.equal(await page.locator('.employee-art').getAttribute('data-frame'), '8');
    const saved = await page.evaluate(() => localStorage.getItem(KEY));
    await page.reload(); assert.equal(await page.locator('.employee-art').getAttribute('data-frame'), '8');
    console.log('PASS: all 3 purchased outfits switch portraits, coins charged correctly, modes independent, equipment persists');

    for (const width of [320, 375, 390, 430, 844]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow ' + width);
      assert(await page.locator('.employee-portrait').evaluate(el => el.getBoundingClientRect().width > 100 && el.getBoundingClientRect().height > 100));
    }
    await context.setOffline(true);
    const offline = await context.newPage(); watch(offline, errors);
    await offline.goto(new URL('index.html?source=homescreen', url).href);
    await ready(offline);
    assert(await offline.evaluate(async () => (await fetch('./assets/employee-atlas.png', { cache: 'reload' })).ok));
    assert.deepEqual(await decode(offline), { width: 1254, height: 1254 });
    assert.equal(await offline.locator('.employee-art').getAttribute('data-frame'), '8');
    assert.equal(await offline.evaluate(() => localStorage.getItem(KEY)), saved);
    assert.deepEqual(errors, []);
    console.log('PASS: 320–844px portrait layout, offline image fetch/decode and restart, no JS errors');
  } finally { await browser.close(); }
})().then(() => server.close()).catch(error => { console.error(error); server.close(); process.exitCode = 1; });
