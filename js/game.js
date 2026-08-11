'use strict';
/* ============ 音效（WebAudio 合成，无需素材） ============ */
const Sfx = {
  ctx: null, _lastHit: 0,
  ac() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
    return this.ctx;
  },
  beep(freq, dur = 0.08, type = 'square', vol = 0.05, slide = 0) {
    if (G.muted) return;
    const ctx = this.ac(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, ctx.currentTime + dur);
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  },
  buy() { this.beep(700, 0.07, 'square', 0.05); },
  sell() { this.beep(400, 0.1, 'sawtooth', 0.04, -150); },
  refresh() { this.beep(520, 0.05, 'triangle', 0.05); this.beep(660, 0.05, 'triangle', 0.05); },
  combine() { [660, 830, 990].forEach((f, i) => setTimeout(() => this.beep(f, 0.1, 'triangle', 0.06), i * 80)); },
  levelup() { [520, 660, 780, 1040].forEach((f, i) => setTimeout(() => this.beep(f, 0.12, 'triangle', 0.06), i * 90)); },
  hit() {
    const now = performance.now();
    if (now - this._lastHit < 70) return;
    this._lastHit = now;
    this.beep(180 + Math.random() * 60, 0.04, 'square', 0.02);
  },
  cast() { this.beep(880, 0.12, 'sine', 0.05, 220); },
  death() { this.beep(200, 0.18, 'sawtooth', 0.04, -120); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.15, 'triangle', 0.07), i * 120)); },
  lose() { [400, 350, 300, 250].forEach((f, i) => setTimeout(() => this.beep(f, 0.15, 'sawtooth', 0.05), i * 130)); },
  item() { this.beep(1000, 0.08, 'sine', 0.06); this.beep(1400, 0.08, 'sine', 0.05); },
};

/* ============ 全局状态 ============ */
let G = null;
let _uid = 0;

const Game = {
  newGame() {
    G = {
      round: 0, hp: 100, gold: 8, level: 2, xp: 0, streak: 0,
      bench: Array(BENCH_SIZE).fill(null),
      board: {},
      shop: Array(5).fill(null), locked: false,
      items: [],
      pool: {},
      phase: 'prep', speed: 1,
      muted: localStorage.getItem('jcc_muted') === '1',
      endless: false, over: false,
      best: Number(localStorage.getItem('jcc_best') || 0),
    };
    for (const id in HEROES) G.pool[id] = POOL_SIZE[HEROES[id].cost];
    this.rollShop(true);
    UI.renderAll();
    this.updateSpeedBtn(); this.updateMuteBtn();
  },

  /* ---------- 商店 ---------- */
  randHeroByCost(cost) {
    const ids = Object.keys(HEROES).filter(id => HEROES[id].cost === cost && G.pool[id] > 0);
    if (!ids.length) return null;
    let total = 0;
    ids.forEach(id => total += G.pool[id]);
    let r = Math.random() * total;
    for (const id of ids) { r -= G.pool[id]; if (r <= 0) return id; }
    return ids[ids.length - 1];
  },

  rollShop(free) {
    if (!free) {
      if (G.gold < 2) { UI.toast('金币不够（刷新需要 2💰）'); return; }
      G.gold -= 2;
      Sfx.refresh();
    }
    const odds = ODDS[G.level] || ODDS[8];
    for (let i = 0; i < 5; i++) {
      let r = Math.random() * 100, cost = 1;
      for (let c = 0; c < 4; c++) { r -= odds[c]; if (r <= 0) { cost = c + 1; break; } }
      let id = this.randHeroByCost(cost);
      if (!id) id = this.randHeroByCost(1) || this.randHeroByCost(2) || this.randHeroByCost(3) || this.randHeroByCost(4);
      G.shop[i] = id;
    }
    G.locked = false;
    UI.renderAll();
  },

  buyFromShop(i) {
    if (G.phase !== 'prep') return;
    const heroId = G.shop[i];
    if (!heroId) return;
    const h = HEROES[heroId];
    if (G.gold < h.cost) { UI.toast('金币不足！'); return; }
    const benchIdx = G.bench.findIndex(u => !u);
    const wouldCombine = this.countUnits(heroId, 1) >= 2;
    if (benchIdx < 0 && !wouldCombine) { UI.toast('备战席已满！'); return; }
    G.gold -= h.cost;
    G.pool[heroId]--;
    G.shop[i] = null;
    const unit = { uid: ++_uid, heroId, star: 1, items: [] };
    if (benchIdx >= 0) G.bench[benchIdx] = unit;
    else G.bench.push(unit); // 临时超员，合成后移除
    Sfx.buy();
    this.tryCombine(heroId);
    G.bench = G.bench.slice(0, BENCH_SIZE).concat(Array(Math.max(0, BENCH_SIZE - G.bench.length)).fill(null)).slice(0, BENCH_SIZE);
    UI.renderAll();
  },

  allUnitRefs() {
    const refs = [];
    G.bench.forEach((u, idx) => { if (u) refs.push({ loc: { type: 'bench', idx }, unit: u }); });
    for (const key in G.board) refs.push({ loc: { type: 'board', key }, unit: G.board[key] });
    return refs;
  },

  countUnits(heroId, star) {
    return this.allUnitRefs().filter(r => r.unit.heroId === heroId && r.unit.star === star).length;
  },

  tryCombine(heroId) {
    for (let star = 1; star <= 2; star++) {
      const refs = this.allUnitRefs().filter(r => r.unit.heroId === heroId && r.unit.star === star);
      if (refs.length < 3) continue;
      const three = refs.slice(0, 3);
      // 保留者：优先场上的那只
      const keeper = three.find(r => r.loc.type === 'board') || three[0];
      const items = [];
      three.forEach(r => r.unit.items.forEach(it => { if (items.length < 3) items.push(it); }));
      three.forEach(r => {
        if (r === keeper) return;
        if (r.loc.type === 'bench') G.bench[r.loc.idx] = null;
        else delete G.board[r.loc.key];
      });
      keeper.unit.star = star + 1;
      keeper.unit.items = items;
      Sfx.combine();
      UI.toast(`✨ ${HEROES[heroId].name} 升到 ${star + 1} 星！`);
      this.tryCombine(heroId); // 级联
      return;
    }
  },

  sellPrice(unit) {
    return HEROES[unit.heroId].cost * Math.pow(3, unit.star - 1);
  },

  sellUnit(loc) {
    let unit;
    if (loc.type === 'bench') { unit = G.bench[loc.idx]; G.bench[loc.idx] = null; }
    else { unit = G.board[loc.key]; delete G.board[loc.key]; }
    if (!unit) return;
    G.gold += this.sellPrice(unit);
    G.pool[unit.heroId] += Math.pow(3, unit.star - 1);
    unit.items.forEach(it => G.items.push(it)); // 装备退回
    Sfx.sell();
    UI.renderAll();
  },

  /* ---------- 拖拽落点 ---------- */
  handleDrop(dst) {
    const src = UI.dragSrc;
    if (!src || G.phase !== 'prep') return;
    if (src.type === 'item') {
      // 装备到目标棋子
      let unit = null;
      if (dst.type === 'bench') unit = G.bench[dst.idx];
      else if (dst.type === 'board') unit = G.board[dst.key];
      if (!unit) { UI.toast('要拖到棋子身上'); return; }
      if (unit.items.length >= 3) { UI.toast('该棋子装备已满（最多3件）'); return; }
      const itId = G.items.splice(src.idx, 1)[0];
      unit.items.push(itId);
      Sfx.item();
      UI.renderAll();
      return;
    }
    // 移动棋子
    const getU = l => l.type === 'bench' ? G.bench[l.idx] : G.board[l.key];
    const setU = (l, u) => {
      if (l.type === 'bench') G.bench[l.idx] = u;
      else { if (u) G.board[l.key] = u; else delete G.board[l.key]; }
    };
    const mover = getU(src);
    if (!mover) return;
    if (src.type === dst.type && (src.idx === dst.idx && src.key === dst.key)) return;
    const target = getU(dst);
    // 人口限制：从备战席上场且落点为空
    if (dst.type === 'board' && src.type === 'bench' && !target &&
      Object.keys(G.board).length >= G.level) {
      UI.toast(`人口已满（等级 ${G.level} = 最多 ${G.level} 个）`);
      return;
    }
    setU(src, target || null);
    setU(dst, mover);
    UI.renderAll();
  },

  handleSellDrop() {
    const src = UI.dragSrc;
    if (!src || src.type === 'item' || G.phase !== 'prep') return;
    this.sellUnit(src);
  },

  /* ---------- 经验 ---------- */
  buyXp() {
    if (G.phase !== 'prep') return;
    if (G.level >= MAX_LEVEL) { UI.toast('已经满级！'); return; }
    if (G.gold < 4) { UI.toast('金币不够（购买经验需要 4💰）'); return; }
    G.gold -= 4;
    this.giveXp(4);
    UI.renderAll();
  },

  giveXp(n) {
    if (G.level >= MAX_LEVEL) return;
    G.xp += n;
    while (G.level < MAX_LEVEL && G.xp >= XP_REQ[G.level]) {
      G.xp -= XP_REQ[G.level];
      G.level++;
      Sfx.levelup();
      UI.toast(`🎉 升到 ${G.level} 级！人口 +1`);
    }
    if (G.level >= MAX_LEVEL) G.xp = 0;
  },

  /* ---------- 战斗 ---------- */
  startBattle() {
    if (G.phase !== 'prep' || G.over) return;
    const boardUnits = Object.entries(G.board).map(([key, unit]) => {
      const [x, y] = key.split(',').map(Number);
      return { unit, x, y };
    });
    if (!boardUnits.length) { UI.toast('先把棋子拖上棋盘！'); return; }
    G.phase = 'combat';
    UI.hideTip();
    UI.renderAll();
    const wave = getWave(G.round);
    Combat.start(boardUnits, wave.units, wave.mult, res => this.onCombatEnd(res));
  },

  onCombatEnd({ win, survivors }) {
    G.phase = 'prep';
    const stage = stageOf(G.round);
    if (win) {
      G.streak = G.streak >= 0 ? G.streak + 1 : 1;
      Sfx.win();
      UI.toast('🏆 胜利！');
    } else {
      G.streak = G.streak <= 0 ? G.streak - 1 : -1;
      const dmg = 2 + stage + 2 * survivors;
      G.hp -= dmg;
      Sfx.lose();
      UI.toast(`💔 战败，损失 ${dmg} 点生命`);
    }
    // 收入
    const interest = Math.min(5, Math.floor(G.gold / 10));
    const streakN = Math.abs(G.streak);
    const streakGold = streakN >= 6 ? 3 : streakN >= 4 ? 2 : streakN >= 2 ? 1 : 0;
    G.gold += 5 + interest + streakGold + (win ? 1 : 0);
    this.giveXp(2);
    // 装备掉落
    let drops = 0;
    if (G.round % 3 === 2) drops++;
    if (G.round % 5 === 4) drops++;
    for (let i = 0; i < drops; i++) this.grantItem();

    if (G.hp <= 0) { this.gameOver(); return; }

    const finished = G.round === TOTAL_ROUNDS - 1 && !G.endless;
    G.round++;
    this.saveBest();

    if (finished) { this.victory(win); return; }

    if (!G.locked) this.rollShop(true);
    else { G.locked = false; UI.renderAll(); }
    UI.renderAll();
  },

  grantItem() {
    const ids = Object.keys(ITEMS);
    let total = 0;
    ids.forEach(id => total += ITEMS[id].weight);
    let r = Math.random() * total, pick = ids[0];
    for (const id of ids) { r -= ITEMS[id].weight; if (r <= 0) { pick = id; break; } }
    G.items.push(pick);
    Sfx.item();
    UI.toast(`🎁 获得装备：${ITEMS[pick].emoji} ${ITEMS[pick].name}`);
  },

  saveBest() {
    if (G.round > G.best) {
      G.best = G.round;
      localStorage.setItem('jcc_best', String(G.best));
    }
  },

  gameOver() {
    G.over = true;
    this.saveBest();
    UI.renderAll();
    UI.modal('💀 游戏结束',
      `<p>你坚持到了 <b>回合 ${roundName(G.round)}</b>（第 ${G.round + 1} 回合）。</p>
       <p>历史最佳：第 ${G.best + 1} 回合。</p>
       <p>小提示：凑齐羁绊、攒利息、三合一升星，会走得更远！</p>`,
      [{ text: '再来一局', fn: () => this.newGame() }]);
  },

  victory(finalWin) {
    Sfx.win();
    UI.modal(finalWin ? '👑 完美通关！' : '🏅 幸存通关！',
      `<p>${finalWin
        ? `你击败了 5-5 的最终 BOSS，通关全部 ${TOTAL_ROUNDS} 个回合！`
        : `虽然没打过最终 BOSS，但你撑过了全部 ${TOTAL_ROUNDS} 个回合活了下来！`}</p>
       <p>剩余生命：❤️ ${G.hp}</p>
       <p>要继续挑战无尽模式吗？敌人会越来越强……</p>`,
      [
        { text: '♾️ 无尽模式', fn: () => { G.endless = true; if (!G.locked) this.rollShop(true); UI.renderAll(); } },
        { text: '🔄 重新开始', fn: () => this.newGame() },
      ]);
  },

  toggleSpeed() {
    G.speed = G.speed === 1 ? 2 : 1;
    this.updateSpeedBtn();
  },
  updateSpeedBtn() { $('#btnSpeed').textContent = G.speed === 1 ? '⏩ 1x' : '⏩ 2x'; },

  toggleMute() {
    G.muted = !G.muted;
    localStorage.setItem('jcc_muted', G.muted ? '1' : '0');
    this.updateMuteBtn();
  },
  updateMuteBtn() { $('#btnMute').textContent = G.muted ? '🔇' : '🔊'; },
};

/* ============ 初始化 ============ */
window.addEventListener('DOMContentLoaded', () => {
  UI.buildBoard();
  UI.buildBench();

  // 自适应缩放：小窗口整体缩小，保证界面完整可见
  const fitScale = () => {
    const z = Math.min(1, innerHeight / 880, innerWidth / 1170);
    const app = $('#app');
    app.style.zoom = z;
    app.style.height = Math.round(innerHeight / z) + 'px';
  };
  fitScale();
  window.addEventListener('resize', fitScale);

  $('#btnRefresh').addEventListener('click', () => Game.rollShop(false));
  $('#btnXp').addEventListener('click', () => Game.buyXp());
  $('#btnFight').addEventListener('click', () => Game.startBattle());
  $('#btnSpeed').addEventListener('click', () => Game.toggleSpeed());
  $('#btnMute').addEventListener('click', () => Game.toggleMute());
  $('#btnLock').addEventListener('click', () => {
    if (G.phase !== 'prep') return;
    G.locked = !G.locked;
    UI.renderShop();
  });
  $('#btnRestart').addEventListener('click', () => {
    UI.modal('重新开始？', '<p>当前进度将会丢失。</p>', [
      { text: '确认重开', fn: () => Game.newGame() },
      { text: '取消' },
    ]);
  });

  const sellZone = $('#sellZone');
  sellZone.addEventListener('dragover', e => {
    e.preventDefault();
    sellZone.classList.add('drop');
    if (UI.dragSrc && UI.dragSrc.type !== 'item') {
      const u = UI.dragSrc.type === 'bench' ? G.bench[UI.dragSrc.idx] : G.board[UI.dragSrc.key];
      if (u) sellZone.textContent = `出售 +${Game.sellPrice(u)}💰`;
    }
  });
  sellZone.addEventListener('dragleave', () => { sellZone.classList.remove('drop'); sellZone.textContent = '🗑️ 出售'; });
  sellZone.addEventListener('drop', e => {
    e.preventDefault();
    sellZone.classList.remove('drop');
    sellZone.textContent = '🗑️ 出售';
    Game.handleSellDrop();
  });

  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.key === 'd' || e.key === 'D') Game.rollShop(false);
    if (e.key === 'f' || e.key === 'F') Game.buyXp();
    if (e.key === ' ') { e.preventDefault(); Game.startBattle(); }
  });

  Game.newGame();
});
