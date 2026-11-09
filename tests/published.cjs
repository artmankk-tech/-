// 公開URLを、新しいブラウザ保存領域だけで検証する。サーバーへの書き込みは行わない。
// 実行: node tests/published.cjs
// 任意: QUEST_BASE_URL, CHROMIUM_PATH, QUEST_SCREENSHOT
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const base = new URL(process.env.QUEST_BASE_URL || 'https://artmankk-tech.github.io/-/');
assert(base.pathname.endsWith('/'), 'QUEST_BASE_URL must end with /');
const root = path.resolve(__dirname, '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

(async () => {
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const proxyURL = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ? null : process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const browser = await chromium.launch({
    executablePath, args: ['--no-sandbox'],
    ...(proxyURL ? { proxy: { server: proxyURL } } : {})
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      timezoneId: 'Asia/Tokyo'
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const response = await page.goto(base.href, { waitUntil: 'networkidle', timeout: 45000 });
    assert.equal(response.status(), 200);
    assert.equal(await page.title(), 'QUEST｜習慣と仕事のRPG');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope), base.href);

    // 配信された実ファイルと、テスト対象のローカルファイルが一致することを確認。
    for (const filename of ['index.html', 'game.js', 'app.js', 'style.css', 'sw.js', 'assets/employee-atlas.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) {
      const bytes = await page.evaluate(async name => {
        const result = await fetch('./' + name);
        if (!result.ok) throw Error(name + ': HTTP ' + result.status);
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await result.arrayBuffer())));
      }, filename);
      assert.equal(Buffer.from(bytes).toString('hex'), digest(fs.readFileSync(path.join(root, filename))), 'published file: ' + filename);
    }
    console.log('PASS: public HTTPS, exact release assets, PWA scope and control');
    await page.evaluate(async () => {
      const image = new Image(); image.src = './assets/employee-atlas.png'; await image.decode();
      if (!image.naturalWidth || image.naturalWidth !== image.naturalHeight || image.naturalWidth % 3) throw Error('Invalid character atlas');
    });
    assert.match(await page.locator('#employeeScene').textContent(), /寡黙な実力派/);
    if (process.env.QUEST_SCREENSHOT) await page.screenshot({ path: process.env.QUEST_SCREENSHOT, fullPage: true });

    await page.locator('.check').first().tap();
    assert.equal(await page.locator('#xp').textContent(), '10 XP');
    await page.locator('#lifeTab').tap();
    assert.equal(await page.locator('#xp').textContent(), '0 XP');
    await page.locator('.check').first().tap();
    await page.locator('#taskName').fill('公開動作確認');
    await page.locator('#taskXP').selectOption('5');
    await page.getByRole('button', { name: '＋ ミッション追加', exact: true }).tap();
    await page.getByRole('button', { name: '公開動作確認の達成を切り替え', exact: true }).tap();
    assert.equal(await page.locator('#xp').textContent(), '25 XP');
    assert.match(await page.locator('#storageStatus').textContent(), /保存されています/);
    assert.equal(await page.locator('#employeeTitle').textContent(), '新入社員');
    await page.getByRole('button', { name: '小さな観葉植物：20 Cで交換', exact: true }).tap();
    assert.equal(await page.locator('#coinBalance').textContent(), '5');

    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSONバックアップ', exact: true }).tap();
    const download = await downloadEvent, chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const backup = Buffer.concat(chunks), parsed = JSON.parse(backup);
    assert.equal(parsed.version, 3);
    assert.equal(parsed.data.life.tasks.length, 7);
    assert.equal(Object.values(parsed.data.work.days)[0].awards.w0, 10);
    assert.equal(Object.values(parsed.data.life.days)[0].awards.l0, 20);
    assert.equal(parsed.data.life.game.coins, 5);
    assert(parsed.data.life.game.decor.includes('decor-plant'));
    await page.getByRole('button', { name: 'このモードを初期化', exact: true }).tap();
    assert.equal(await page.locator('#xp').textContent(), '0 XP');
    await page.locator('#importFile').setInputFiles({ name: 'quest-backup.json', mimeType: 'application/json', buffer: backup });
    await page.waitForFunction(() => document.getElementById('xp').textContent === '25 XP');
    const original = await page.evaluate(() => localStorage.getItem('quest-rpg-v1'));
    const rejected = page.waitForEvent('dialog');
    await page.locator('#importFile').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2,"data":{}}') });
    await rejected;
    assert.equal(await page.evaluate(() => localStorage.getItem('quest-rpg-v1')), original);
    await page.reload();
    assert.equal(await page.locator('#xp').textContent(), '10 XP');
    await page.locator('#lifeTab').tap();
    assert.equal(await page.locator('#xp').textContent(), '25 XP');
    assert.equal(await page.locator('#coinBalance').textContent(), '5');
    console.log('PASS: public touch UI, separate modes, game coins/shop, v3 JSON with inventory, restore/reload, invalid JSON rejection');

    for (const width of [320, 375, 390, 430, 844]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow: ' + width);
    }
    await context.setOffline(true);
    await page.goto(new URL('index.html?source=homescreen', base).href);
    assert(await page.evaluate(async () => (await fetch('./assets/employee-atlas.png', { cache: 'reload' })).ok), 'offline character image');
    assert.equal(await page.locator('#xp').textContent(), '10 XP');
    await page.locator('#lifeTab').tap();
    assert.equal(await page.locator('#xp').textContent(), '25 XP');
    await page.getByRole('button', { name: '公開動作確認の達成を切り替え', exact: true }).tap();
    assert.equal(await page.locator('#xp').textContent(), '20 XP');
    await page.reload();
    await page.locator('#lifeTab').tap();
    assert.equal(await page.locator('#xp').textContent(), '20 XP');
    assert.equal(await page.locator('#coinBalance').textContent(), '5');
    assert.deepEqual(errors, []);
    console.log('PASS: public 320–844px layout, offline query URL, edit and restart, no JavaScript errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
