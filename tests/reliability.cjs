// 単独実行: node tests/reliability.cjs（HTTPサーバーを自動起動）
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const baseline = '8c3fd318894ede56a64dd678177f8d77362e2789';
const assets = ['index.html', 'game.js', 'app.js', 'style.css', 'sw.js', 'assets/employee-atlas.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let legacy = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const match = /^\/(?:-|other)\/(.*)$/.exec(url.pathname);
  const filename = match && (match[1] || 'index.html');
  if (!assets.includes(filename)) { res.writeHead(404); res.end(); return; }
  const body = legacy && url.pathname.startsWith('/-/')
    ? execFileSync('git', ['show', `${baseline}:${filename}`], { cwd: root })
    : fs.readFileSync(path.join(root, filename));
  res.writeHead(200, { 'Content-Type': mime[path.extname(filename)], 'Cache-Control': 'no-store' });
  res.end(body);
});

async function downloadText(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
async function upload(page, data) {
  const dialog = page.waitForEvent('dialog');
  await page.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(data) });
  await dialog;
}
async function ready(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
}
function watch(page, errors) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Tokyo' });
    let page = await context.newPage();
    watch(page, errors);
    await page.goto(base + '/-/');
    await ready(page);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), base + '/-/sw.js');
    const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
    assert.equal(new URL(manifest.start_url, base + '/-/').pathname, '/-/index.html');
    await page.locator('.check').first().tap();
    assert.equal(await page.locator('#xp').textContent(), '10 XP');
    await page.locator('#lifeTab').tap();
    assert.equal(await page.locator('#xp').textContent(), '0 XP');
    await page.locator('.check').first().tap();
    assert.equal(await page.locator('#xp').textContent(), '20 XP');
    await page.locator('#taskName').fill('小さな行動 <テスト>');
    await page.getByRole('button', { name: '＋ ミッション追加', exact: true }).tap();
    assert.equal(await page.locator('.mission').count(), 7);
    await page.reload();
    await page.locator('#lifeTab').tap();
    assert.equal(await page.locator('.mission').count(), 7);

    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSONバックアップ', exact: true }).tap();
    const backup = await downloadText(await downloadEvent);
    assert.equal(JSON.parse(backup).data.life.tasks.length, 7);
    await page.evaluate(() => toggleTask('l1'));
    await upload(page, backup);
    await page.waitForFunction(() => total('life') === 20);
    await page.reload();
    assert.equal(await page.evaluate(() => total('life')), 20);
    const raw = await page.evaluate(() => localStorage.getItem(KEY));
    await upload(page, '{"version":2,"data":{}}');
    assert.equal(await page.evaluate(() => localStorage.getItem(KEY)), raw);
    const unsafe = JSON.parse(backup);
    unsafe.data.work.tasks[0].id = '__proto__';
    await upload(page, JSON.stringify(unsafe));
    assert.equal(await page.evaluate(() => localStorage.getItem(KEY)), raw);

    // 容量不足を模擬。操作結果はバックアップでき、復元・初期化失敗は原本を保つ。
    await page.evaluate(() => {
      window.setItemOriginal = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === KEY) throw new DOMException('Test quota', 'QuotaExceededError');
        return window.setItemOriginal.call(this, key, value);
      };
      toggleTask('w1');
    });
    assert.match(await page.locator('#storageStatus').textContent(), /保存に失敗/);
    assert.equal(await page.evaluate(() => localStorage.getItem(KEY)), raw);
    const unsaved = await page.evaluate(() => JSON.stringify(data));
    await page.getByRole('button', { name: 'このモードを初期化', exact: true }).tap();
    assert.equal(await page.evaluate(() => JSON.stringify(data)), unsaved);
    await upload(page, backup);
    // 最後のalertが処理されるまで待ち、メモリと保存原本の両方を確認。
    await page.evaluate(() => {});
    assert.equal(await page.evaluate(() => JSON.stringify(data)), unsaved);
    assert.equal(await page.evaluate(() => localStorage.getItem(KEY)), raw);
    await page.evaluate(() => { Storage.prototype.setItem = window.setItemOriginal; });
    await page.reload();

    // 同じ記録を開いた古いタブによる上書きを防ぐ。
    const second = await context.newPage();
    watch(second, errors);
    await second.goto(base + '/-/');
    await page.evaluate(() => toggleTask('w1'));
    const latest = await page.evaluate(() => localStorage.getItem(KEY));
    await second.evaluate(() => toggleTask('w2'));
    assert.match(await second.locator('#storageStatus').textContent(), /別の画面/);
    assert.equal(await second.evaluate(() => localStorage.getItem(KEY)), latest);
    await second.close();

    for (const width of [320, 375, 390, 430, 844]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width}`);
    }
    const targets = await page.locator('button:visible').evaluateAll(buttons => buttons.map(b => ({ w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })));
    assert(targets.every(t => t.w >= 44 && t.h >= 44), '44px touch targets');
    await context.setOffline(true);
    await page.goto(base + '/-/index.html?source=homescreen');
    assert.equal(await page.evaluate(() => total('work')), 30);
    await page.locator('.check').first().tap();
    await page.reload();
    assert.equal(await page.evaluate(() => total('work')), 20);
    await context.close();
    console.log('PASS: /-/ subpath, touch UI, JSON contents/restore/rejection, failed writes, multi-tab protection, 320–844px, offline query/restart');

    // 日本時間の23:59:55から日をまたぐ。片方のタイマーは一時停止する。
    const midnight = await browser.newContext({ timezoneId: 'Asia/Tokyo' });
    page = await midnight.newPage(); watch(page, errors);
    await page.clock.install({ time: new Date('2026-11-08T14:59:55Z') });
    await page.goto(base + '/-/');
    await page.evaluate(() => {
      toggleTask('w0'); toggleTimer(); switchMode('life'); toggleTimer(); toggleTimer(); switchMode('work');
    });
    await page.clock.fastForward(10000);
    assert.deepEqual(await page.evaluate(() => ({
      date: today, done: $('doneCount').textContent, xp: total('work'),
      timersReset: Object.values(timers).every(t => t.end === null && t.date === null && t.remaining === t.duration)
    })), { date: '2026-11-09', done: '0/6', xp: 10, timersReset: true });
    await page.evaluate(() => toggleTask('w0'));
    assert.equal(await page.evaluate(() => total('work')), 20);
    await page.reload();
    assert.equal(await page.evaluate(() => total('work')), 20);
    await midnight.close();
    console.log('PASS: Japan midnight refresh, both timers reset, historical XP and next-day completion retained');

    const corrupt = await browser.newContext();
    await corrupt.addInitScript(() => localStorage.setItem('quest-rpg-v1', '{broken-original'));
    page = await corrupt.newPage(); watch(page, errors);
    await page.goto(base + '/-/');
    assert.match(await page.locator('#storageStatus').textContent(), /上書きを停止/);
    await page.locator('.check').first().click();
    assert.equal(await page.evaluate(() => localStorage.getItem(KEY)), '{broken-original');
    const recoveryEvent = page.waitForEvent('download');
    await page.locator('#recoveryButton').click();
    assert.equal(await downloadText(await recoveryEvent), '{broken-original');
    await corrupt.close();
    console.log('PASS: corrupt local data preserved and exported byte-for-byte');

    // 実際のv3コミットを配信し、同じURLでv4へ更新する。
    legacy = true;
    const upgrade = await browser.newContext();
    page = await upgrade.newPage(); watch(page, errors);
    await page.goto(base + '/-/'); await ready(page);
    await page.evaluate(() => toggleTask('w0'));
    const oldRecord = await page.evaluate(() => localStorage.getItem(KEY));
    const other = await upgrade.newPage(); watch(other, errors);
    await other.goto(base + '/other/'); await ready(other);
    await other.evaluate(() => caches.open('quest-pwa-unrelated').then(c => c.put('/unrelated', new Response('preserve'))));
    legacy = false;
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()).waiting);
    await page.reload();
    assert.equal(await page.evaluate(() => typeof storageStatus), 'undefined', 'old screen keeps v3 app.js');
    await page.close();
    page = await upgrade.newPage(); watch(page, errors);
    await page.goto(base + '/-/');
    await page.waitForFunction(() => typeof storageStatus === 'function');
    await ready(page);
    assert.deepEqual(await page.evaluate(() => ({ tasks: data.work.tasks, days: Object.fromEntries(Object.entries(data.work.days).map(([date, day]) => { const { coinTasks, ...rest } = day; return [date, rest]; })) })), (() => { const record = JSON.parse(oldRecord).work; return { tasks: record.tasks, days: record.days }; })());
    assert.equal(await page.evaluate(() => data.work.game.coins), 10);
    assert.equal(await page.locator('#xp').textContent(), '10 XP');
    assert(await page.evaluate(async () => (await caches.keys()).includes('quest-pwa-unrelated')));
    await upgrade.setOffline(true);
    await page.reload(); assert.equal(await page.locator('#xp').textContent(), '10 XP');
    await other.reload(); assert.equal(await other.title(), 'QUEST｜習慣と仕事のRPG');
    await upgrade.close();
    console.log('PASS: real v3→v6 update waits for old tab, retains XP/tasks, migrates game, preserves other scope/offline caches');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().then(() => server.close()).catch(error => { console.error(error); server.close(); process.exitCode = 1; });
