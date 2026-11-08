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
    { id: 'outfit-start', slot: 'outfit', name: 'いつもの制服', cost: 0, icon: '👔', color: null, note: '昇格に合わせて色が変わる' },
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

  function scene(record, mode) {
    const g = record.game, rank = stageIndex(g.careerXP), outfit = find(g.outfit), room = find(g.room);
    const jacket = outfit.color || stages[rank].color;
    const sun = g.room === 'room-sky' ? '#f4ac9c' : '#f6cd76';
    const plant = g.decor.includes('decor-plant');
    const books = g.decor.includes('decor-books');
    const cat = g.decor.includes('decor-cat');
    return `<svg viewBox="0 0 360 232" role="img" aria-label="${stages[rank].title}の社員。${room.name}で${outfit.name}を着ています。">
      <rect width="360" height="232" rx="16" fill="${room.color}"/>
      <path d="M0 170H360V232H0Z" fill="#d4c3ad"/><path d="M0 170H360M0 201H360M72 170L32 232M178 170V232M281 170L323 232" stroke="#b5a58f" stroke-width="1.5" opacity=".45"/>
      <rect x="218" y="23" width="118" height="109" rx="7" fill="#f9f7ed"/>
      <rect x="225" y="30" width="104" height="95" rx="3" fill="${g.room === 'room-sky' ? '#96afce' : '#bbdce0'}"/>
      <circle cx="301" cy="52" r="13" fill="${sun}"/>
      <path d="M226 125V90H243V76H260V101H274V66H295V91H313V83H328V125" fill="#7da6b0" opacity=".6"/>
      <path d="M276 29V126M224 79H330" stroke="#f9f7ed" stroke-width="5"/>
      <rect x="25" y="31" width="69" height="49" rx="5" fill="#fff9e9"/>
      <path d="M41 64L53 52L64 59L81 43" stroke="${jacket}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      ${books ? '<rect x="23" y="109" width="62" height="7" rx="3" fill="#a27d64"/><path d="M29 108V85H38V108M42 108V80H52V108M58 108V89H67V108M70 108L65 84L74 82L79 108" fill="#8b9c9f" stroke="#f6e3bb" stroke-width="2"/>' : ''}
      <ellipse cx="148" cy="211" rx="44" ry="8" fill="#927c66" opacity=".19"/>
      <path d="M126 173L124 205H140L147 179L154 205H170L166 173" fill="#435367"/>
      <rect x="119" y="201" width="23" height="9" rx="4" fill="#34404c"/><rect x="152" y="201" width="23" height="9" rx="4" fill="#34404c"/>
      <path d="M122 118Q145 108 169 119L181 166L166 171L163 138L167 179H123L127 138L121 166L107 163Z" fill="${jacket}"/>
      <path d="M136 116L146 141L156 116" fill="#fff8e8"/><path d="M142 122L147 119L151 123L149 143L145 149L141 143Z" fill="${rank >= 3 ? '#efbf62' : '#486880'}"/>
      <circle cx="114" cy="165" r="7" fill="#f1c3a0"/><circle cx="175" cy="168" r="7" fill="#f1c3a0"/>
      <rect x="158" y="138" width="10" height="13" rx="2" fill="#fff7df"/><path d="M162 135V141" stroke="#536b77" stroke-width="2"/>
      <circle cx="147" cy="80" r="35" fill="#f4caab"/>
      <path d="M112 81Q104 37 144 38Q185 36 183 80L172 65Q149 71 133 56L119 83Z" fill="#4a4142"/>
      <circle cx="134" cy="83" r="2.5" fill="#413a3d"/><circle cx="159" cy="83" r="2.5" fill="#413a3d"/>
      <path d="M140 98Q147 104 154 98" fill="none" stroke="#a05f5d" stroke-width="2.5" stroke-linecap="round"/>
      <ellipse cx="125" cy="94" rx="6" ry="3" fill="#e9a59a" opacity=".65"/><ellipse cx="168" cy="94" rx="6" ry="3" fill="#e9a59a" opacity=".65"/>
      ${rank >= 2 ? '<g fill="none" stroke="#4c5666" stroke-width="2"><rect x="124" y="76" width="20" height="14" rx="5"/><rect x="150" y="76" width="20" height="14" rx="5"/><path d="M144 81H150"/></g>' : ''}
      <path d="M195 159H307V170H195Z" fill="#bd936e"/><path d="M202 170V209M299 170V209" stroke="#8e7058" stroke-width="7"/>
      <path d="M223 120H274L279 155H219Z" fill="#526a7e"/><path d="M216 155H283V159H216Z" fill="#7e98a7"/><circle cx="249" cy="139" r="4" fill="#aac9cc"/>
      <path d="M291 145H301V155H291Z" fill="#fff5db"/><path d="M301 147Q310 146 306 153H301" fill="none" stroke="#fff5db" stroke-width="2"/>
      ${plant ? '<path d="M34 176H63L59 207H38Z" fill="#c88c74"/><path d="M49 180V136M49 162Q22 162 29 145Q48 144 49 162M49 150Q73 151 70 132Q49 131 49 150" fill="#638e75" stroke="#638e75" stroke-width="3"/>' : ''}
      ${cat ? '<ellipse cx="290" cy="211" rx="27" ry="9" fill="#b59889" opacity=".3"/><path d="M266 204Q267 184 288 185Q308 185 313 202Q322 190 327 198Q329 211 310 209H274Z" fill="#e5af76"/><path d="M270 192L272 181L281 188L290 183L294 194" fill="#e5af76"/><path d="M274 196L278 197M284 197L288 196" stroke="#795e4d" stroke-width="2" stroke-linecap="round"/>' : ''}
      ${rank >= 4 ? '<path d="M30 21H48V31Q48 44 39 44Q30 44 30 31Z" fill="#d9ae56"/><path d="M30 25H25Q23 37 32 37M48 25H53Q55 37 46 37M39 44V49M32 50H46" stroke="#d9ae56" stroke-width="3" fill="none"/>' : ''}
      <rect x="12" y="216" width="84" height="9" rx="4" fill="#fff9eb" opacity=".5"/>
      <text x="17" y="223" font-size="6" letter-spacing="1" fill="#6a706a">${mode === 'work' ? 'MY WORK LIFE' : 'MY PRIVATE LIFE'}</text>
    </svg>`;
  }
  return { stages, catalog, find, baseXP, stageIndex, validate, migrate, rewardTask, exchange, scene, credit };
})();
