'use strict';

// 育成とコインは各モード内で完結する。実在の社員情報は扱わない。
globalThis.QuestGame = (() => {
  const stages = [
    { xp: 0, title: '新入社員', event: 'はじめての出社', story: '小さな一歩から、あなたの社員ライフが始まる。', color: '#81b8d2' },
    { xp: 100, title: '一人前', event: '自分の名刺をもらった', story: '積み重ねた行動が、自信に変わってきた。', color: '#5274a1' },
    { xp: 300, title: '頼れる先輩', event: '後輩からの「ありがとう」', story: '自分のペースで続ける姿が、誰かの力になる。', color: '#579e86' },
    { xp: 600, title: 'リーダー', event: '小さなチームを任された', story: '一歩ずつ進むあなたに、新しい景色が見えてきた。', color: '#ba8967' },
    { xp: 1000, title: 'マネージャー', event: '眺めのよい席へお引っ越し', story: 'これまでの一歩が、あなたらしい働き方をつくる。', color: '#8d76b3' },
    { xp: 1500, title: '社長', event: '自分らしい会社ができた', story: '物語はまだ続く。これからも、無理のない一歩を。', color: '#425f73' }
  ];
  const catalog = [
    { id: 'outfit-start', slot: 'outfit', name: 'いつもの制服', cost: 0, icon: '👔', color: null, note: '昇格に合わせて着こなしが変わる' },
    { id: 'outfit-mint', slot: 'outfit', name: 'ミントのジャケット', cost: 30, icon: '🧥', color: '#55aa91', note: '軽やかな気分で、次の一歩' },
    { id: 'outfit-coral', slot: 'outfit', name: 'コーラルのセットアップ', cost: 60, icon: '🎀', color: '#d57d77', note: 'お気に入りを着て出かけよう' },
    { id: 'outfit-night', slot: 'outfit', name: '星空のスーツ', cost: 120, icon: '✨', color: '#7264a9', note: 'きらりと光る、自分らしさ' },
    { id: 'room-start', slot: 'room', name: 'はじまりの部屋', cost: 0, icon: '🏠', color: '#e8e5d9', note: 'ここから物語が始まる' },
    { id: 'room-sun', slot: 'room', name: '陽だまりの部屋', cost: 80, icon: '🌤️', color: '#fae4c3', note: 'あたたかな窓辺でひと休み' },
    { id: 'room-sky', slot: 'room', name: '空の見えるオフィス', cost: 180, icon: '🌇', color: '#cedbef', note: '窓の向こうに、広がる未来' },
    { id: 'decor-plant', slot: 'decor', name: '小さな観葉植物', cost: 20, icon: '🌱', note: '最初のごほうびに、ひと鉢' },
    { id: 'decor-books', slot: 'decor', name: 'お気に入りの本棚', cost: 50, icon: '📚', note: '学んだことが、少しずつ増える' },
    { id: 'decor-cat', slot: 'decor', name: 'お昼寝ねこクッション', cost: 90, icon: '🐈', note: 'お部屋に、小さなくつろぎを' }
  ];
  const find = id => catalog.find(item => item.id === id);
  const baseXP = record => Object.values(record.days).reduce((sum, day) =>
    sum + Object.values(day.awards || {}).reduce((a, b) => a + b, 0) + (day.bonus || 0), 0);
  const stageIndex = xp => stages.reduce((index, stage, i) => xp >= stage.xp ? i : index, 0);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const credit = (record, amount) => { record.game.coins = Math.min(Number.MAX_SAFE_INTEGER, record.game.coins + amount); };

  function validate(record, validID) {
    for (const day of Object.values(record.days)) {
      if (day.coinTasks !== undefined && (!Array.isArray(day.coinTasks) ||
          day.coinTasks.some(id => !validID(id)) || new Set(day.coinTasks).size !== day.coinTasks.length)) throw Error('コイン記録形式');
    }
    const g = record.game;
    if (g === undefined) return; // v1/v2からの移行対象。
    if (!g || g.version !== 1 || !integer(g.coins) || !integer(g.careerXP) ||
        !Array.isArray(g.owned) || new Set(g.owned).size !== g.owned.length ||
        g.owned.some(id => !find(id)) || !g.owned.includes('outfit-start') || !g.owned.includes('room-start') ||
        !g.owned.includes(g.outfit) || find(g.outfit)?.slot !== 'outfit' ||
        !g.owned.includes(g.room) || find(g.room)?.slot !== 'room' ||
        !Array.isArray(g.decor) || new Set(g.decor).size !== g.decor.length ||
        g.decor.some(id => !g.owned.includes(id) || find(id)?.slot !== 'decor')) throw Error('育成データ形式');
  }

  function migrate(record) {
    const xp = baseXP(record);
    record.game ??= { version: 1, coins: xp, careerXP: xp,
      owned: ['outfit-start', 'room-start'], outfit: 'outfit-start', room: 'room-start', decor: [] };
    record.game.careerXP = Math.max(record.game.careerXP, xp);
    // 旧版で達成済みのミッションには、移行時と再チェック時に二重付与しない。
    for (const day of Object.values(record.days)) day.coinTasks ??= [...day.done];
    return record;
  }

  function rewardTask(record, day, task) {
    day.coinTasks ??= [];
    if (day.coinTasks.includes(task.id)) return 0;
    day.coinTasks.push(task.id);
    credit(record, task.xp);
    return task.xp;
  }

  function exchange(record, id) {
    const item = find(id), g = record.game;
    if (!item) return false;
    if (!g.owned.includes(id)) {
      if (g.coins < item.cost) return false;
      g.coins -= item.cost;
      g.owned.push(id);
    }
    if (item.slot === 'decor') {
      g.decor = g.decor.includes(id) ? g.decor.filter(value => value !== id) : [...g.decor, id];
    } else g[item.slot] = id;
    return true;
  }

  function portraitFrame(record) {
    const variants = { 'outfit-mint': 6, 'outfit-coral': 7, 'outfit-night': 8 };
    return variants[record.game.outfit] ?? stageIndex(record.game.careerXP);
  }

  function scene(record, mode) {
    const g = record.game, rank = stageIndex(g.careerXP), outfit = find(g.outfit), room = find(g.room);
    const frame = portraitFrame(record);
    const sun = g.room === 'room-sky' ? '#efb9ae' : '#efd194';
    const plant = g.decor.includes('decor-plant');
    const books = g.decor.includes('decor-books');
    const cat = g.decor.includes('decor-cat');
    return `<div class="employee-art" data-frame="${frame}">
      <svg class="room-scene" viewBox="0 0 360 300" role="img" aria-label="${stages[rank].title}の社員、寡黙な実力派。${room.name}で${outfit.name}を着ています。">
        <rect width="360" height="300" rx="16" fill="${room.color}"/>
        <path d="M0 245H360V300H0Z" fill="#bbaa9b"/>
        <path d="M0 245H360M0 276H360M70 245L35 300M180 245V300M290 245L326 300" stroke="#998a80" opacity=".3"/>
        <rect x="198" y="19" width="142" height="189" rx="3" fill="#f2f0e7"/>
        <rect x="204" y="25" width="130" height="177" fill="${g.room === 'room-sky' ? '#91a4c1' : '#b5c9ce'}"/>
        <circle cx="304" cy="53" r="18" fill="${sun}"/>
        <path d="M204 202V133H221V98H240V140H251V85H278V119H299V145H316V105H334V202" fill="#6b8799" opacity=".45"/>
        <path d="M265 24V204M202 115H336" stroke="#f2f0e7" stroke-width="5"/>
        <rect x="20" y="77" width="77" height="47" rx="3" fill="#fffaf0"/>
        <path d="M34 109L47 98L60 103L82 89" stroke="#6c8b8b" stroke-width="3" stroke-linecap="round" fill="none"/>
        ${books ? '<path d="M14 157H90" stroke="#8e7866" stroke-width="6"/><path d="M22 154V132H31V154M36 154V126H47V154M52 154V135H61V154M69 154L65 131L74 129L79 154" fill="#6d8395" stroke="#e3d1b2" stroke-width="2"/>' : ''}
        <path d="M5 228H113V236H5Z" fill="#a68a70"/><path d="M15 236V279M103 236V279" stroke="#776656" stroke-width="5"/>
        <path d="M44 195H83L87 223H40Z" fill="#4c6375"/><path d="M36 223H92V228H36Z" fill="#839ba5"/><circle cx="64" cy="208" r="3" fill="#c1d1d6"/>
        ${plant ? '<path d="M13 209H36L32 230H17Z" fill="#b47c67"/><path d="M24 211V173M24 197Q4 196 7 183Q23 182 24 197M24 185Q44 187 41 170Q25 170 24 185" fill="#5a8271" stroke="#5a8271" stroke-width="2"/>' : ''}
        ${cat ? '<ellipse cx="50" cy="287" rx="26" ry="7" fill="#7f7063" opacity=".2"/><path d="M28 278Q29 260 47 261Q65 260 71 277Q83 264 84 275Q84 285 67 284H35Z" fill="#d6a26f"/><path d="M32 267L33 258L42 264L50 259L54 269" fill="#d6a26f"/><path d="M34 272L39 273M44 273L49 272" stroke="#775c4b" stroke-width="2"/>' : ''}
        ${rank >= 4 ? '<path d="M24 164H40V173Q40 184 32 184Q24 184 24 173Z" fill="#c1a05a"/><path d="M24 168H20Q17 178 25 178M40 168H44Q46 178 39 178M32 184V189M26 190H38" stroke="#c1a05a" stroke-width="2" fill="none"/>' : ''}
        <text x="16" y="296" font-size="6" letter-spacing="1" fill="#5d6467">${mode === 'work' ? 'MY WORK LIFE' : 'MY PRIVATE LIFE'}</text>
      </svg>
      <div class="employee-portrait" aria-hidden="true" style="background-position:${frame % 3 * 50}% ${Math.floor(frame / 3) * 50}%"></div>
      <div class="portrait-label"><span>MY PARTNER</span><b>寡黙な実力派</b></div>
    </div>`;
  }

  return { stages, catalog, find, baseXP, stageIndex, validate, migrate, rewardTask, exchange, scene, portraitFrame, credit };
})();
