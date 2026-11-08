// node tests/game.cjs : v4→社員育成版の更新と、実際の画面操作を検証する。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = 'fc77fb7dcb279e12edf3ff0224396ee85f237c73';
const files = ['index.html', 'game.js', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let legacy = true;
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.replace(/^\/-\//, '') || 'index.html';
  if (!files.includes(name)) { res.writeHead(404); res.end(); return; }
  const data = legacy ? execFileSync('git', ['show', baseline + ':' + name], { cwd: root }) : fs.readFileSync(path.join(root, name));
  res.writeHead(200, { 'Content-Type': mime[path.extname(name)], 'Cache-Control': 'no-store' });
  res.end(data);
});
async function ready(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
}
async function upload(page, value) {
  const dialog = page.waitForEvent('dialog');
  await page.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
  await dialog;
  await page.evaluate(() => {});
}
function watch(page, errors) {
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => errors.push(e.message));
}
async function state(page) { return page.evaluate(() => JSON.parse(JSON.stringify(data))); }

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/-/`;
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Tokyo' });
    const errors = [];
    let page = await context.newPage(); watch(page, errors);
    await page.goto(url); await ready(page);
    await page.evaluate(() => {
      for (const task of data.work.tasks) toggleTask(task.id);
      switchMode('life'); toggleTask('l0');
      for (const m of ['work', 'life']) {
        data[m].days[dateOffset(-1)] = data[m].days[today];
        delete data[m].days[today];
      }
      save(); render();
    });
    const original = await page.evaluate(() => localStorage.getItem(KEY));
    legacy = false;
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()).waiting);
    await page.reload();
    assert.equal(await page.evaluate(() => typeof QuestGame), 'undefined', 'v4 keeps running while v5 waits');
    await page.close();
    page = await context.newPage(); watch(page, errors);
    await page.goto(url); await ready(page);
    await page.waitForFunction(() => typeof QuestGame !== 'undefined');
    let value = await state(page);
    assert.equal(value.work.game.coins, 90);
    assert.equal(value.work.game.careerXP, 90);
    assert.equal(value.life.game.coins, 20);
    assert.equal(await page.evaluate(() => localStorage.getItem(KEY + '-pre-life-game')), original);
    await page.reload();
    assert.equal((await state(page)).work.game.coins, 90, 'migration runs only once');
    console.log('PASS: actual v4→v5 update waits, preserves both modes, converts historical XP once, retains original');

    await page.locator('#nextMission button').tap();
    assert.equal(await page.locator('#employeeTitle').textContent(), '一人前');
    assert.match(await page.locator('#careerNotice').textContent(), /昇格/);
    await page.evaluate(() => { for (let i = 0; i < 12; i++) toggleTask('w0'); });
    value = await state(page);
    assert.equal(value.work.game.coins, 100, 'repeated uncheck/recheck does not mint coins');
    await page.locator('.check').first().tap();
    assert.equal(await page.locator('#employeeTitle').textContent(), '一人前', 'undo does not demote');
    await page.locator('.check').first().tap();
    await page.getByRole('button', { name: '小さな観葉植物：20 Cで交換', exact: true }).tap();
    assert.equal((await state(page)).work.game.coins, 80);
    assert((await state(page)).work.game.decor.includes('decor-plant'));
    await page.getByRole('button', { name: '小さな観葉植物：しまう', exact: true }).tap();
    await page.getByRole('button', { name: '小さな観葉植物：飾る', exact: true }).tap();
    assert.equal((await state(page)).work.game.coins, 80);
    await page.locator('#shop-outfit').tap();
    await page.getByRole('button', { name: 'ミントのジャケット：30 Cで交換', exact: true }).tap();
    assert.match(await page.locator('#employeeScene svg').getAttribute('aria-label'), /ミントのジャケット/);
    await page.getByRole('button', { name: 'いつもの制服：着る', exact: true }).tap();
    await page.getByRole('button', { name: 'ミントのジャケット：着る', exact: true }).tap();
    assert.equal((await state(page)).work.game.coins, 50, 'owned outfits are free to switch');
    await page.locator('#shop-room').tap();
    assert(await page.getByRole('button', { name: '陽だまりの部屋：80 Cで交換', exact: true }).isDisabled());
    console.log('PASS: promotion, quick mission, no repeat coin farming/demotion, furniture and outfit use, insufficient funds');

    await page.locator('#shop-decor').tap();
    const before = (await state(page)).work.game;
    const raw = await page.evaluate(() => localStorage.getItem(KEY));
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === KEY) throw new DOMException('Test quota', 'QuotaExceededError');
        return window.originalSetItem.call(this, key, value);
      };
    });
    await page.getByRole('button', { name: 'お気に入りの本棚：50 Cで交換', exact: true }).tap();
    assert.deepEqual((await state(page)).work.game, before);
    assert.equal(await page.evaluate(() => localStorage.getItem(KEY)), raw);
    assert.match(await page.locator('#storageStatus').textContent(), /保存に失敗/);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await page.getByRole('button', { name: 'お気に入りの本棚：50 Cで交換', exact: true }).tap();
    await page.evaluate(() => {
      for (const task of data.work.tasks.slice(1)) toggleTask(task.id);
      for (let i = 0; i < 4; i++) addBonus();
      toggleTimer(); timers.work.end = Date.now() - 1; tickTimers();
      toggleTimer(); timers.work.end = Date.now() - 1; tickTimers();
    });
    assert.equal((await state(page)).work.game.coins, 105, 'timer and restart coin caps');
    await page.locator('#shop-room').tap();
    await page.getByRole('button', { name: '陽だまりの部屋：80 Cで交換', exact: true }).tap();
    assert.equal((await state(page)).work.game.coins, 25);
    assert.match(await page.locator('#employeeScene svg').getAttribute('aria-label'), /陽だまりの部屋/);
    await page.locator('#lifeTab').tap();
    assert.equal((await state(page)).life.game.coins, 20);
    assert.equal((await state(page)).life.game.outfit, 'outfit-start');
    await page.evaluate(() => {
      toggleTask('l0'); for (let i = 0; i < 4; i++) addBonus();
      toggleTimer(); timers.life.end = Date.now() - 1; tickTimers();
    });
    assert.equal((await state(page)).life.game.coins, 65);
    await page.locator('#workTab').tap();
    await page.locator('.check').first().tap();
    assert.equal((await state(page)).work.game.careerXP, 205);
    console.log('PASS: failed purchases roll back, timer/restart coins capped, rooms change, inventories and money stay separate');

    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSONバックアップ', exact: true }).tap();
    const chunks = [];
    for await (const chunk of await (await downloadEvent).createReadStream()) chunks.push(chunk);
    const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(backup.version, 3);
    assert.equal(backup.data.work.game.coins, 25);
    await page.getByRole('button', { name: 'このモードを初期化', exact: true }).tap();
    assert.equal((await state(page)).work.game.coins, 0);
    assert.equal((await state(page)).life.game.coins, 65);
    await upload(page, backup);
    await page.reload();
    assert.deepEqual((await state(page)).work.game, backup.data.work.game);
    assert.deepEqual((await state(page)).life.game, backup.data.life.game);
    for (const [key, invalid] of [['coins', -1], ['room', 'outfit-start'], ['owned', ['not-a-real-item']]]) {
      const bad = structuredClone(backup); bad.data.work.game[key] = invalid;
      const saved = await page.evaluate(() => localStorage.getItem(KEY));
      await upload(page, bad);
      assert.equal(await page.evaluate(() => localStorage.getItem(KEY)), saved);
    }
    const v2 = { version: 2, data: JSON.parse(original) };
    await upload(page, v2);
    assert.equal((await state(page)).work.game.coins, 90);
    await upload(page, backup);
    console.log('PASS: v3 backup contains career/coins/inventory, reset is mode-specific, restore/reload and v2 migration, invalid game data rejected');

    for (const [xp, title] of [[0, '新入社員'], [100, '一人前'], [300, '頼れる先輩'], [600, 'リーダー'], [1000, 'マネージャー'], [1500, '社長']]) {
      const rank = structuredClone(backup);
      rank.data.work.days = {}; rank.data.work.game.careerXP = xp;
      await upload(page, rank);
      assert.equal(await page.locator('#employeeTitle').textContent(), title);
      assert.match(await page.locator('#employeeScene svg').getAttribute('aria-label'), new RegExp(title));
    }
    const large = structuredClone(backup); large.data.work.game.coins = Number.MAX_SAFE_INTEGER;
    await upload(page, large);
    for (const width of [320, 375, 390, 430, 844]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator('.career-details').evaluate(element => { element.open = true; });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'layout width ' + width);
    }
    await upload(page, backup);
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.QUEST_SCREENSHOT) await page.screenshot({ path: process.env.QUEST_SCREENSHOT, fullPage: true });
    await context.setOffline(true); await page.reload();
    assert.deepEqual((await state(page)).work.game, backup.data.work.game);
    await page.locator('#shop-outfit').tap();
    await page.getByRole('button', { name: 'いつもの制服：着る', exact: true }).tap();
    await page.reload();
    assert.equal((await state(page)).work.game.outfit, 'outfit-start');
    assert.deepEqual(errors, []);
    console.log('PASS: all 6 career scenes, large balances and 320–844px layout, game.js cached, offline equipment/persistence, no JS errors');
  } finally { await browser.close(); }
})().then(() => server.close()).catch(error => { console.error(error); server.close(); process.exitCode = 1; });
