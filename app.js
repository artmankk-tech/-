'use strict';

// 保存キーを維持し、旧JSON version:1/2を育成付きversion:3へ移行する。
const KEY = 'quest-rpg-v1';
const MODES = ['work', 'life'];
const XP_OPTIONS = [5, 10, 15, 20];
const $ = id => document.getElementById(id);
const defaults = {
  work: [['最重要業務を2分だけ始める', 10], ['15分間、1つの業務に集中', 20], ['役職者の進捗を1件確認', 15], ['指示に担当・期限・確認日を設定', 20], ['書類や机を5分整理', 10], ['翌日の最初の業務を決める', 15]],
  life: [['ITパスポートを5問解く', 20], ['間違えた問題を復習', 15], ['自宅を5分片付ける', 10], ['今日の支出を確認', 15], ['15分間学習に集中', 20], ['明日の目標を1つ決める', 10]]
};

function initial() {
  return Object.fromEntries(MODES.map(m => [m, {
    tasks: defaults[m].map(([name, xp], i) => ({ id: (m === 'work' ? 'w' : 'l') + i, name, xp })),
    days: {}
  }]));
}
function validID(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id) &&
    !['__proto__', 'constructor', 'prototype'].includes(id);
}
function validate(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('データがありません');
  for (const m of MODES) {
    const x = v[m];
    if (!x || !Array.isArray(x.tasks) || !x.days || typeof x.days !== 'object' ||
        Array.isArray(x.days) || x.tasks.length > 1000) throw Error('モード形式');
    const ids = new Set();
    for (const t of x.tasks) {
      if (!t || !validID(t.id) || ids.has(t.id) || typeof t.name !== 'string' ||
          !t.name.trim() || t.name.length > 70 || !XP_OPTIONS.includes(t.xp)) throw Error('ミッション形式');
      ids.add(t.id);
      if (t.priority !== undefined && typeof t.priority !== 'boolean') throw Error('優先形式');
    }
    if (x.tasks.filter(t => t.priority).length > 3) throw Error('重要ミッションは3件まで');
    for (const [k, d] of Object.entries(x.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Number.isFinite(Date.parse(k)) ||
          new Date(k).toISOString().slice(0, 10) !== k || !d || Array.isArray(d) ||
          !Array.isArray(d.done) || d.done.some(id => !validID(id)) ||
          new Set(d.done).size !== d.done.length) throw Error('日別記録形式');
      for (const n of ['bonus', 'restarts', 'timer']) {
        if (d[n] !== undefined && (!Number.isInteger(d[n]) || d[n] < 0 || d[n] > 1000000)) throw Error('数値形式');
      }
      if (d.claimed !== undefined && (!Array.isArray(d.claimed) || d.claimed.some(n => ![30, 60, 100].includes(n)))) throw Error('報酬形式');
      if (d.awards !== undefined && (!d.awards || typeof d.awards !== 'object' ||
          Array.isArray(d.awards) || Object.entries(d.awards).some(([id, n]) =>
            !validID(id) || !d.done.includes(id) || !XP_OPTIONS.includes(n)))) throw Error('XP記録形式');
    }
    QuestGame.validate(x, validID);
  }
  return v;
}
function migrate(v) {
  validate(v);
  for (const m of MODES) {
    const x = v[m];
    if (!x.tasks.some(t => t.priority !== undefined)) x.tasks.forEach((t, i) => { t.priority = i < 3; });
    for (const d of Object.values(x.days)) {
      d.awards ??= {};
      for (const id of d.done) {
        if (d.awards[id] === undefined) {
          const t = x.tasks.find(t => t.id === id);
          if (t) d.awards[id] = t.xp;
        }
      }
    }
    QuestGame.migrate(x);
  }
  return v;
}

function storageStatus(message, failed = false) {
  $('storageStatus').textContent = message;
  $('storageStatus').classList.toggle('save-error', failed);
  $('recoveryButton').classList.toggle('hidden', !failed || originalRaw === null);
}
let data, storageBlocked = false, originalRaw = null, lastSavedRaw = null;
try {
  originalRaw = localStorage.getItem(KEY);
  data = originalRaw !== null ? migrate(JSON.parse(originalRaw)) : migrate(initial());
  if (originalRaw && !localStorage.getItem(KEY + '-pre-life-game')) localStorage.setItem(KEY + '-pre-life-game', originalRaw);
  if (originalRaw && !localStorage.getItem(KEY + '-pre-upgrade')) localStorage.setItem(KEY + '-pre-upgrade', originalRaw);
  lastSavedRaw = JSON.stringify(data);
  localStorage.setItem(KEY, lastSavedRaw);
  storageStatus('記録はこの端末に保存されています。');
} catch (e) {
  storageBlocked = true;
  data ??= migrate(initial());
  storageStatus('保存データを読み書きできないため、上書きを停止しました。元の保存データとJSONバックアップを書き出し、ブラウザ設定や復元ファイルを確認してください。', true);
}
function save() {
  if (storageBlocked) {
    storageStatus('保存を停止中です。操作結果は画面内だけにあります。JSONバックアップを保存してから、読み込み直すかバックアップを復元してください。', true);
    return false;
  }
  try {
    // 別のタブ・ウィンドウで更新された記録を古い画面から上書きしない。
    const current = localStorage.getItem(KEY);
    if (current !== lastSavedRaw) {
      originalRaw = current;
      storageBlocked = true;
      storageStatus('別の画面で記録が更新されました。上書きを停止しています。この画面のJSONバックアップを保存し、使う画面を1つにして読み込み直してください。', true);
      return false;
    }
    for (const m of MODES) data[m].game.careerXP = Math.max(data[m].game.careerXP, total(m));
    const raw = JSON.stringify(data);
    localStorage.setItem(KEY, raw);
    lastSavedRaw = raw;
    storageStatus('記録はこの端末に保存されています。');
    return true;
  } catch (e) {
    storageStatus('保存に失敗しました。操作結果は画面内だけにあります。今すぐJSONバックアップを保存し、空き容量やブラウザ設定を確認してください。', true);
    return false;
  }
}

const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let today = dateKey(), mode = 'work';
const timers = Object.fromEntries(MODES.map(m => [m, { remaining: 120, duration: 120, end: null, date: null }]));
function refreshDate() {
  const now = dateKey();
  if (now === today) return false;
  today = now;
  // 一時停止中も含め、両モードの前日のタイマーを破棄する。
  for (const t of Object.values(timers)) Object.assign(t, { end: null, remaining: t.duration, date: null });
  updateTimer();
  return true;
}
function day(m, d = today) {
  return data[m].days[d] || { done: [], awards: {}, bonus: 0, restarts: 0, timer: 0, claimed: [] };
}
function mutableDay() {
  return data[mode].days[today] ??= { done: [], awards: {}, bonus: 0, restarts: 0, timer: 0, claimed: [] };
}
function earned(m, d) {
  const v = day(m, d);
  return Object.values(v.awards || {}).reduce((s, n) => s + n, 0) + (v.bonus || 0);
}
function total(m) {
  return Object.keys(data[m].days).reduce((s, d) => s + earned(m, d), 0);
}
function dateOffset(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
function streak(m) {
  let s = 0;
  for (let i = 0; i < 366; i++) {
    const d = day(m, dateOffset(-i));
    if (d.done.length || d.timer || d.restarts) s++;
    else if (i !== 0) break;
  }
  return s;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let shopCategory = 'decor';
const shownStages = {};
function renderGame() {
  const record = data[mode], g = record.game, rank = QuestGame.stageIndex(g.careerXP);
  const current = QuestGame.stages[rank], next = QuestGame.stages[rank + 1];
  $('employeeTitle').textContent = current.title;
  $('employeeWorld').textContent = mode === 'work' ? 'WORK LIFE / 仕事の社員' : 'PRIVATE LIFE / 暮らしの社員';
  $('employeeScene').innerHTML = QuestGame.scene(record, mode);
  $('coinBalance').textContent = g.coins.toLocaleString('ja-JP');
  $('careerXP').textContent = g.careerXP.toLocaleString('ja-JP') + ' 成長XP';
  const nextTask = [...record.tasks].sort((a, b) => Number(!!b.priority) - Number(!!a.priority)).find(task => !day(mode).done.includes(task.id));
  $('nextMission').innerHTML = nextTask ? `<div><span class="eyebrow">今日の小さな一歩</span><b>${esc(nextTask.name)}</b></div><button class="btn" onclick="toggleTask('${nextTask.id}')" aria-label="今日の一歩：${esc(nextTask.name)}を達成">達成 ✓</button>` : '<div><span class="eyebrow">今日の一歩、おつかれさま！</span><b>また自分のペースで続けよう。</b></div>';
  $('careerEvent').textContent = current.event;
  $('careerStory').textContent = current.story;
  $('careerNext').textContent = next ? `次は「${next.title}」まで ${next.xp - g.careerXP} XP` : '社長になっても、あなたの物語は続きます';
  $('careerFill').style.width = (next ? (g.careerXP - current.xp) / (next.xp - current.xp) * 100 : 100) + '%';
  $('careerRoad').innerHTML = QuestGame.stages.map((stage, i) => `<li class="${i <= rank ? 'reached' : ''} ${i === rank ? 'current' : ''}" ${i === rank ? 'aria-current="step"' : ''}><span>${i < rank ? '✓' : i + 1}</span><b>${stage.title}</b><small>${stage.xp} XP</small></li>`).join('');
  $('careerNotice').textContent = shownStages[mode] !== undefined && rank > shownStages[mode] ? '昇格しました！「' + current.title + '」の人生が始まります。' : '';
  if (shownStages[mode] !== undefined && rank > shownStages[mode]) {
    $('employeePanel').classList.remove('promoted');
    void $('employeePanel').offsetWidth;
    $('employeePanel').classList.add('promoted');
  }
  shownStages[mode] = rank;
  $('shopBalance').textContent = g.coins + ' C';
  for (const slot of ['decor', 'outfit', 'room']) $('shop-' + slot).setAttribute('aria-pressed', String(shopCategory === slot));
  $('rewardList').innerHTML = QuestGame.catalog.filter(item => item.slot === shopCategory).map(item => {
    const owned = g.owned.includes(item.id), equipped = item.slot === 'decor' ? g.decor.includes(item.id) : g[item.slot] === item.id;
    const disabled = (!owned && g.coins < item.cost) || (equipped && item.slot !== 'decor');
    const action = !owned ? `${item.cost} Cで交換` : equipped ? item.slot === 'decor' ? 'しまう' : '使用中' : item.slot === 'decor' ? '飾る' : item.slot === 'outfit' ? '着る' : '使う';
    return `<article class="shop-item ${equipped ? 'equipped' : ''}" data-item="${item.id}"><div class="item-icon" aria-hidden="true">${item.icon}</div><div class="item-copy"><h3>${item.name}</h3><p>${item.note}</p><small>${owned ? 'コレクションに追加済み' : `あと ${Math.max(0, item.cost - g.coins)} Cで手に入る`}</small></div><button class="btn ${owned ? 'secondary' : 'shop-buy'}" onclick="exchangeItem('${item.id}')" ${disabled ? 'disabled' : ''} aria-label="${item.name}：${action}">${action}</button></article>`;
  }).join('');
}
function selectShop(slot) {
  if (!['decor', 'outfit', 'room'].includes(slot)) return;
  shopCategory = slot;
  renderGame();
}
function exchangeItem(id) {
  const record = data[mode], before = JSON.parse(JSON.stringify(record.game));
  const wasOwned = before.owned.includes(id), item = QuestGame.find(id);
  if (!QuestGame.exchange(record, id)) return;
  if (!save()) {
    record.game = before;
    renderGame();
    return;
  }
  renderGame();
  toast(wasOwned ? 'お部屋と服装を更新しました' : item.name + 'が仲間入り！');
}
function render() {
  refreshDate();
  const m = data[mode], d = day(mode), xp = total(mode), week = Array.from({ length: 7 }, (_, i) => dateOffset(i - 6));
  $('today').textContent = new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
  for (const name of MODES) {
    const tab = $(name === 'work' ? 'workTab' : 'lifeTab');
    tab.classList.toggle('active', mode === name);
    tab.setAttribute('aria-pressed', String(mode === name));
  }
  $('modeLabel').textContent = mode === 'work' ? 'WORK / 管理と実行' : 'LIFE / 学習と生活';
  $('level').textContent = 'LEVEL ' + (Math.floor(xp / 100) + 1);
  $('xp').textContent = xp + ' XP';
  $('next').textContent = '次のレベルまで ' + (100 - xp % 100) + ' XP';
  $('xpbar').style.width = xp % 100 + '%';
  $('doneCount').textContent = m.tasks.filter(t => d.done.includes(t.id)).length + '/' + m.tasks.length;
  $('streak').textContent = streak(mode) + '日';
  $('weekly').textContent = week.reduce((s, k) => s + earned(mode, k), 0);
  $('missionList').innerHTML = [...m.tasks].sort((a, b) => Number(!!b.priority) - Number(!!a.priority)).map(t => {
    const done = d.done.includes(t.id);
    return `<div class="mission ${done ? 'done' : ''}">
      <button class="check ${done ? 'done' : ''}" onclick="toggleTask('${t.id}')" aria-label="${esc(t.name)}の達成を切り替え" aria-pressed="${done}">${done ? '✓' : ''}</button>
      <div class="body"><b>${esc(t.name)}</b><small>${t.priority ? '★ 今日の重要ミッション' : '毎日のミッション'}</small></div>
      <span class="points">+${t.xp} XP <small>${(d.coinTasks || []).includes(t.id) ? 'C受取済' : '+' + t.xp + ' C'}</small></span>
      <button class="iconbtn" onclick="prioritize('${t.id}')" aria-label="${esc(t.name)}の重要ミッション切替" aria-pressed="${!!t.priority}">${t.priority ? '★' : '☆'}</button>
      <button class="iconbtn" onclick="editTask('${t.id}')" aria-label="${esc(t.name)}を編集">✎</button>
      <button class="iconbtn" onclick="deleteTask('${t.id}')" aria-label="${esc(t.name)}を削除">×</button>
    </div>`;
  }).join('') || '<p class="muted">ミッションを追加してください。</p>';
  renderGame();
  const max = Math.max(20, ...week.map(k => earned(mode, k)));
  $('report').innerHTML = week.map(k => `<div class="barrow"><span class="name">${k.slice(5).replace('-', '/')}</span><div class="track"><div class="fill" style="width:${earned(mode, k) / max * 100}%"></div></div><span class="value">${earned(mode, k)}</span></div>`).join('') + '<p class="foot">過去の記録は保持されます。未達成の日に減点はありません。</p>';
}
function switchMode(v) {
  if (!MODES.includes(v)) return;
  tickTimers();
  mode = v;
  updateTimer();
  render();
}
function toggleTask(id) {
  refreshDate();
  const t = data[mode].tasks.find(t => t.id === id);
  if (!t) return;
  const d = mutableDay();
  let coins = 0;
  d.awards ??= {};
  if (d.done.includes(id)) {
    d.done = d.done.filter(x => x !== id);
    delete d.awards[id];
  } else {
    d.done.push(id);
    d.awards[id] = t.xp;
    coins = QuestGame.rewardTask(data[mode], d, t);
  }
  const saved = save();
  render();
  if (saved && coins) toast('小さな一歩！ +' + t.xp + ' XP / +' + coins + ' C');
}
function prioritize(id) {
  const t = data[mode].tasks.find(t => t.id === id);
  if (!t) return;
  if (!t.priority && data[mode].tasks.filter(t => t.priority).length >= 3) return toast('重要ミッションは3件まで。★を外して選び直せます');
  t.priority = !t.priority;
  save();
  render();
}
function addMission() {
  const name = $('taskName').value.trim(), xp = Number($('taskXP').value);
  if (!name || name.length > 70) return alert('ミッション名は1〜70文字で入力してください');
  if (!XP_OPTIONS.includes(xp)) return alert('XPは5、10、15、20から選択');
  if (data[mode].tasks.length >= 1000) return alert('ミッションは1000件までです');
  data[mode].tasks.push({ priority: false, id: 't' + Date.now() + Math.random().toString(36).slice(2, 8), name, xp });
  $('taskName').value = '';
  const saved = save();
  render();
  if (saved) toast('ミッション追加');
}
function editTask(id) {
  const t = data[mode].tasks.find(t => t.id === id);
  if (!t) return;
  const name = prompt('ミッション名を編集', t.name);
  if (name === null) return;
  if (!name.trim()) return alert('空欄にはできません');
  const xp = prompt('XP（5・10・15・20）', t.xp);
  if (xp === null) return;
  if (!XP_OPTIONS.includes(Number(xp))) return alert('XPは5、10、15、20から選択');
  t.name = name.trim().slice(0, 70);
  t.xp = Number(xp);
  save();
  render();
}
function deleteTask(id) {
  if (!confirm('このミッションを削除しますか？獲得済みのXPは保持されます。')) return;
  data[mode].tasks = data[mode].tasks.filter(t => t.id !== id);
  save();
  render();
}
function addBonus() {
  refreshDate();
  const d = mutableDay();
  if ((d.restarts || 0) >= 3) return toast('再開ボーナスは1日3回まで');
  d.restarts = (d.restarts || 0) + 1;
  d.bonus = (d.bonus || 0) + 5;
  QuestGame.credit(data[mode], 5);
  const saved = save();
  render();
  if (saved) toast('おかえりなさい！ +5 XP / +5 C');
}

function updateTimer() {
  const t = timers[mode];
  $('timer').textContent = `${String(Math.floor(t.remaining / 60)).padStart(2, '0')}:${String(t.remaining % 60).padStart(2, '0')}`;
  $('timerButton').textContent = t.end ? 'Ⅱ 一時停止' : '▶ スタート';
  $('timerDuration').value = String(t.duration);
}
function tickTimers() {
  const dateChanged = refreshDate(), now = Date.now();
  for (const m of MODES) {
    const t = timers[m];
    if (!t.end) continue;
    t.remaining = Math.max(0, Math.ceil((t.end - now) / 1000));
    if (t.remaining) continue;
    t.end = null;
    t.remaining = t.duration;
    if (t.date !== today) continue;
    const d = data[m].days[t.date] ??= { done: [], awards: {}, bonus: 0, restarts: 0, timer: 0, claimed: [] };
    if (!d.timer) {
      d.timer = 1;
      d.bonus = (d.bonus || 0) + 10;
      QuestGame.credit(data[m], 10);
      if (save()) toast((m === 'work' ? '仕事' : 'プライベート') + '：着手成功 +10 XP / +10 C');
    } else toast('集中できました！');
    render();
  }
  if (dateChanged) render();
  updateTimer();
}
function toggleTimer() {
  tickTimers();
  const t = timers[mode];
  if (t.end) t.end = null;
  else { t.date = today; t.end = Date.now() + t.remaining * 1000; }
  updateTimer();
}
function resetTimer() {
  const t = timers[mode];
  Object.assign(t, { end: null, remaining: t.duration, date: null });
  updateTimer();
}
function setDuration(value) {
  timers[mode].duration = Number(value) === 900 ? 900 : 120;
  resetTimer();
}

function downloadJSON(raw, filename) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })), a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportData() {
  downloadJSON(JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), data }, null, 2), 'quest-backup-' + dateKey() + '.json');
}
function exportOriginal() {
  if (originalRaw !== null) downloadJSON(originalRaw, 'quest-recovery-' + dateKey() + '.json');
}
function importData(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) return alert('5MB以下のJSONを選択してください');
  const r = new FileReader();
  r.onerror = () => alert('ファイルを読み込めませんでした');
  r.onload = () => {
    try {
      const obj = JSON.parse(r.result);
      if (![1, 2, 3].includes(obj.version)) throw Error('バージョン不正');
      if (obj.version === 3 && MODES.some(m => !obj.data?.[m]?.game)) throw Error('育成データなし');
      const v = migrate(obj.data);
      if (!confirm('仕事・プライベート両方の記録・社員の成長・コイン・持ち物を置き換えます。現在のJSONバックアップは保存済みですか？')) return;
      const old = localStorage.getItem(KEY), raw = JSON.stringify(v);
      if (old) localStorage.setItem(KEY + '-before-restore', old);
      // 保存が成功するまで、画面の記録とタイマーを変更しない。
      localStorage.setItem(KEY, raw);
      lastSavedRaw = raw;
      originalRaw = old;
      data = v;
      storageBlocked = false;
      for (const m of MODES) Object.assign(timers[m], { end: null, remaining: timers[m].duration, date: null });
      storageStatus('記録はこの端末に保存されています。');
      render();
      updateTimer();
      toast('復元しました');
    } catch (err) {
      alert('復元できませんでした。形式・空き容量・ブラウザ設定を確認してください。現在の記録は維持しています。');
    }
  };
  r.readAsText(f);
}
function clearMode() {
  if (!confirm((mode === 'work' ? '仕事' : 'プライベート') + 'の記録・追加ミッション・社員の成長・コイン・持ち物を初期化します。元に戻せません。バックアップを推奨します。')) return;
  const previous = data[mode];
  data[mode] = migrate(initial())[mode];
  if (!save()) { data[mode] = previous; return; }
  resetTimer();
  render();
}

let toastTimer;
function toast(s) {
  $('toast').textContent = s;
  $('toast').style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').style.display = 'none'; }, 2300);
}
render();
updateTimer();
setInterval(tickTimers, 250);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { tickTimers(); render(); }
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('./sw.js').then(registration => {
    const showUpdate = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        $('offlineStatus').textContent = '更新版の準備ができました。記録をバックアップし、このアプリのタブとホーム画面アプリをすべて閉じてから開き直してください。';
      }
    };
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (worker) worker.addEventListener('statechange', showUpdate);
    });
    return navigator.serviceWorker.ready.then(() => {
      $('offlineStatus').textContent = 'オフライン用ファイルを準備しました。通信がなくても記録できます。';
      showUpdate();
    });
  }).catch(() => {
    $('offlineStatus').textContent = 'オフライン準備に失敗しました。通信を確認して再読み込みしてください。';
  });
}
