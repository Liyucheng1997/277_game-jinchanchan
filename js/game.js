"use strict";
let G = null;
const SAVE_KEY = "jcc-rift-v3";
const AudioFX = {
  ctx: null,
  muted: false,
  voices: new Set(),
  lastCast: -Infinity,
  tone(f = 600, d = 0.08, type = "sine", vol = 0.025) {
    if (this.muted) return;
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      const o = this.ctx.createOscillator(),
        g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(vol, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + d);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + d);
    } catch {}
  },
  play(k) {
    if (this.muted) return;
    if (k === "cast") {
      if (performance.now() - this.lastCast < 180) return;
      this.lastCast = performance.now();
    }
    const source = window.JCC_AUDIO?.[k];
    if (source && typeof Audio !== "undefined") {
      const voice = new Audio(source);
      voice.volume = k === "cast" ? 0.15 : 0.45;
      while (this.voices.size >= 8) {
        const old = this.voices.values().next().value;
        old.pause(); this.voices.delete(old);
      }
      this.voices.add(voice);
      voice.onended = () => this.voices.delete(voice);
      voice.play().catch(() => { this.voices.delete(voice); this.synth(k); });
      return;
    }
    this.synth(k);
  },
  synth(k) {
    // Distinct, quiet cues; these are synthesized, not original game assets.
    const notes = {
      buy: [880, 1320], sell: [660, 440], refresh: [330, 495, 660],
      combine: [523, 659, 784, 1047], cast: [420, 630],
      win: [523, 659, 784, 1047, 1319], lose: [392, 330, 262],
      item: [1047, 1319, 1568],
    }[k] || [600];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, k === "cast" ? 0.07 : 0.18,
      k === "sell" || k === "lose" ? "triangle" : "sine", k === "cast" ? 0.007 : 0.018), i * 65));
  },
  stop() {
    for (const voice of this.voices) voice.pause();
    this.voices.clear();
    if (this.ctx?.state === "running") this.ctx.suspend().catch(() => {});
  },
};
const Game = {
  engine: null,
  acc: 0,
  last: 0,
  raf: null,
  finishing: 0,
  uid: 0,
  canManage() {
    return ["prep", "combat"].includes(G?.phase);
  },
  canEdit(loc) {
    return this.canManage() && (G.phase === "prep" || loc?.type === "bench" || loc?.type === "item");
  },
  upgradeHint(id) {
    const units = this.refs().filter((r) => r.unit.heroId === id).map((r) => r.unit);
    const ones = units.filter((u) => u.star === 1).length;
    const twos = units.filter((u) => u.star === 2).length;
    const offers = G.shop.filter((h) => h === id).length;
    return { owned: units.reduce((n, u) => n + 3 ** (u.star - 1), 0),
      star: ones >= 2 ? (twos >= 2 ? 3 : 2) : 0,
      shopMerge: ones + offers >= 3, pair: ones >= 2 || twos >= 2 };
  },
  craftPreview(a, b) {
    if (!this.canManage() || a === b || !G.items[a] || !G.items[b]) return null;
    return RECIPES[[G.items[a], G.items[b]].sort().join("+")] || null;
  },
  moveMascot(x, y) {
    if (!this.canManage() || !Number.isFinite(x) || !Number.isFinite(y)) return;
    G.mascot ??= { x: 202, y: 497 };
    G.mascot.target = { x: Math.max(145, Math.min(1080, x)), y: Math.max(170, Math.min(590, y)) };
  },
  stepMascot(dt) {
    if (!this.canManage()) return;
    const m = G.mascot ??= { x: 202, y: 497 };
    if (m.target) {
      const dx = m.target.x - m.x, dy = m.target.y - m.y, distance = Math.hypot(dx, dy);
      const step = Math.min(distance, dt * 300);
      if (distance) { m.x += dx / distance * step; m.y += dy / distance * step; }
      if (distance <= step) { delete m.target; this.save(); }
    }
    UI.renderMascot();
    if (G.loot && Math.hypot(m.x - 871, m.y - 449) < 45) this.collectLoot();
  },
  readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  init() {
    UI.init();
    this.load();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  },
  newGame() {
    this.engine = null;
    this.finishing = 0;
    UI.selected = null;
    UI.closeDialog();
    G = {
      version: 3,
      round: 0,
      hp: 100,
      gold: 0,
      level: 1,
      xp: 0,
      streak: 0,
      board: {},
      bench: Array(9).fill(null),
      shop: Array(5).fill(null),
      pool: {},
      items: [],
      rewards: [],
      locked: false,
      phase: "carousel",
      prepLeft: 35,
      paused: false,
      speed: 1,
      muted: this.readStorage("jcc-muted") === "1",
      bots: BOT_NAMES.map((name, i) => ({
        id: i,
        name,
        hp: 100,
        gold: 5,
        level: 1,
        roster: [],
        plan: BOT_PLANS[i],
        streak: 0,
        eliminated: false,
      })),
      history: [],
      income: { base: 0, interest: 0, streak: 0, win: 0 },
      opponent: null,
      lastOpponent: -1,
      carousel: [],
      rank: null,
      uid: 0,
    };
    for (const h of Object.values(HEROES)) G.pool[h.id] = POOL_SIZE[h.cost];
    AudioFX.muted = G.muted;
    this.openCarousel();
    UI.render();
  },
  load() {
    try {
      const data = JSON.parse(this.readStorage(SAVE_KEY));
      if (
        data?.version === 3 &&
        ["prep", "carousel", "over"].includes(data.phase)
      ) {
        G = data;
        this.uid = G.uid || 0;
        G.paused = true;
        AudioFX.muted = G.muted;
        UI.render();
        UI.toast("已恢复上次对局 · 点击继续计时");
        return;
      }
    } catch {}
    this.newGame();
  },
  save() {
    if (!G || !["prep", "combat", "carousel", "over"].includes(G.phase)) return;
    G.uid = this.uid;
    try {
      // Resume combat as preparation with the latest purchases and inventory.
      const snapshot = G.phase === "combat" ? { ...G, phase: "prep", prepLeft: 35 } : G;
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
    } catch {}
  },
  frame(t) {
    const dt = Math.min((t - this.last) / 1000, 0.1);
    this.last = t;
    if (G && !G.paused && !UI.blocking) {
      this.stepMascot(dt);
      if (G.phase === "prep") {
        G.prepLeft -= dt;
        if (G.prepLeft <= 0) {
          this.autoDeploy();
          this.startBattle();
        }
        UI.updateTimer();
      } else if (G.phase === "combat" && this.engine) {
        this.acc += dt * G.speed;
        let guard = 0;
        while (this.acc >= 1 / 30 && guard++ < 12 && !this.engine.done) {
          this.engine.step();
          this.acc -= 1 / 30;
        }
        UI.combatFrame(this.engine, dt);
        if (this.engine.done) {
          this.finishing += dt;
          if (this.finishing > 1.6) {
            this.finishing = 0;
            this.finishBattle();
          }
        }
      }
    }
    window.Characters3D?.frame(dt);
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  },
  unit(heroId, items = []) {
    return { uid: ++this.uid, heroId, star: 1, items: [...items] };
  },
  capacity() {
    return (
      G.level +
      this.refs().reduce(
        (n, r) =>
          n +
          r.unit.items.filter((i) => ["2036", "2047", "2048"].includes(i))
            .length,
        0,
      )
    );
  },
  refs() {
    return [
      ...G.bench.map((unit, idx) => ({ unit, loc: { type: "bench", idx } })),
      ...Object.entries(G.board).map(([key, unit]) => ({
        unit,
        loc: { type: "board", key },
      })),
    ].filter((r) => r.unit);
  },
  get(loc) {
    return loc?.type === "board"
      ? G.board[loc.key]
      : loc?.type === "bench"
        ? G.bench[loc.idx]
        : null;
  },
  set(loc, u) {
    if (loc.type === "board") {
      if (u) G.board[loc.key] = u;
      else delete G.board[loc.key];
    } else G.bench[loc.idx] = u;
  },
  putUnit(u) {
    const i = G.bench.indexOf(null);
    if (i < 0) G.rewards.push(u);
    else G.bench[i] = u;
    this.combine(u.heroId);
  },
  claimRewards() {
    while (G.rewards.length && G.bench.includes(null)) {
      const u = G.rewards.shift();
      G.bench[G.bench.indexOf(null)] = u;
      this.combine(u.heroId);
    }
  },
  returnUnit(u) {
    G.pool[u.heroId] += 3 ** (u.star - 1);
  },
  reserve(cost) {
    const list = Object.values(HEROES).filter(
      (h) => h.cost === cost && G.pool[h.id] > 0,
    );
    let total = list.reduce((n, h) => n + G.pool[h.id], 0),
      r = Math.random() * total;
    for (const h of list) {
      r -= G.pool[h.id];
      if (r < 0) {
        G.pool[h.id]--;
        return h.id;
      }
    }
    return null;
  },
  draw(level) {
    let r = Math.random() * 100,
      cost = 1;
    for (const [i, p] of ODDS[level].entries()) {
      r -= p;
      if (r < 0) {
        cost = i + 1;
        break;
      }
    }
    return (
      this.reserve(cost) ||
      [1, 2, 3, 4, 5]
        .map((c) => c)
        .reduce((id, c) => id || this.reserve(c), null)
    );
  },
  rollShop(free = false) {
    if (!free && (!this.canManage() || G.gold < 2)) {
      if (this.canManage()) UI.toast("刷新需要 2 金币");
      return false;
    }
    if (!free) {
      G.gold -= 2;
      AudioFX.play("refresh");
    }
    G.shop.filter(Boolean).forEach((id) => G.pool[id]++);
    G.shop = Array.from({ length: 5 }, () => this.draw(G.level));
    UI.render();
    this.save();
    return true;
  },
  buy(i) {
    if (!this.canManage()) return;
    const id = G.shop[i];
    if (!id) return;
    const h = HEROES[id],
      matches = this.refs().filter(
        (r) => r.unit.heroId === id && r.unit.star === 1,
      );
    if (G.gold < h.cost) {
      UI.toast("金币不足");
      return;
    }
    if (!G.bench.includes(null) && matches.length < 2) {
      UI.toast("备战席已满，可先出售或上阵");
      return;
    }
    G.gold -= h.cost;
    G.shop[i] = null;
    const u = this.unit(id);
    if (G.bench.includes(null)) G.bench[G.bench.indexOf(null)] = u;
    else G.bench.push(u);
    this.combine(id);
    G.bench.length = 9;
    AudioFX.play("buy");
    UI.render();
    this.save();
  },
  combine(id) {
    for (let star = 1; star <= 2; star++) {
      const refs = this.refs()
        .filter((r) => r.unit.heroId === id && r.unit.star === star)
        .sort(
          (a, b) =>
            (a.loc.type === "board" ? -1 : 1) -
            (b.loc.type === "board" ? -1 : 1),
        );
      if (refs.length < 3) continue;
      const three = refs.slice(0, 3),
        keep = three[0];
      const equipment = three.flatMap((r) => r.unit.items);
      three.slice(1).forEach((r) => this.set(r.loc, null));
      keep.unit.star++;
      keep.unit.items = [];
      for (const item of equipment) {
        if (!this.equipOn(keep.unit, item, false)) G.items.push(item);
      }
      AudioFX.play("combine");
      UI.toast(`${HEROES[id].name} 升至 ${keep.unit.star} 星`);
      this.combine(id);
      return;
    }
  },
  sellPrice(u) {
    const base = HEROES[u.heroId].cost;
    return base === 1
      ? 3 ** (u.star - 1)
      : base * 3 ** (u.star - 1) - (u.star - 1);
  },
  sell(loc) {
    if (!this.canEdit(loc)) return;
    const u = this.get(loc);
    if (!u) return;
    G.gold += this.sellPrice(u);
    this.returnUnit(u);
    G.items.push(...u.items);
    this.set(loc, null);
    UI.selected = null;
    this.claimRewards();
    AudioFX.play("sell");
    UI.render();
    this.save();
  },
  move(src, dst) {
    if (!this.canEdit(src) || !this.canEdit(dst)) return false;
    if (!dst || !["board", "bench"].includes(dst.type)) return false;
    if (src?.type === "item") return this.equip(src.idx, dst);
    const u = this.get(src);
    if (!u) return false;
    if (dst.type === "board" && !/^([0-6]),([4-7])$/.test(dst.key))
      return false;
    if (
      dst.type === "bench" &&
      (!Number.isInteger(dst.idx) || dst.idx < 0 || dst.idx >= 9)
    )
      return false;
    const target = this.get(dst);
    if (
      src.type === "bench" &&
      dst.type === "board" &&
      !target &&
      Object.keys(G.board).length >= this.capacity()
    ) {
      UI.toast("上阵人数已满，购买经验提升等级");
      return false;
    }
    this.set(src, target || null);
    this.set(dst, u);
    UI.selected = null;
    this.claimRewards();
    UI.render();
    this.save();
    return true;
  },
  equipOn(u, id, notify = true) {
    if (!ITEMS[id]) return false;
    const component = !ITEMS[id].recipe.length;
    const match = component
      ? u.items.findIndex(
          (old) =>
            !ITEMS[old].recipe.length && RECIPES[[old, id].sort().join("+")],
        )
      : -1;
    if (match >= 0) {
      const result = RECIPES[[u.items[match], id].sort().join("+")];
      if (result === "2044" && u.items.length > 1) return false;
      if (EMBLEMS[result] && unitTraits(u).includes(EMBLEMS[result]))
        return false;
      u.items[match] = result;
      if (notify) UI.toast(`合成 ${ITEMS[result].name}`);
      return true;
    }
    if (
      u.items.includes("2044") ||
      u.items.length >= 3 ||
      (id === "2044" && u.items.length)
    )
      return false;
    if (EMBLEMS[id] && unitTraits(u).includes(EMBLEMS[id])) return false;
    u.items.push(id);
    return true;
  },
  equip(idx, loc) {
    if (!this.canEdit(loc)) return false;
    const u = this.get(loc),
      id = G.items[idx];
    if (!u || !id) return false;
    if (!this.equipOn(u, id)) {
      UI.toast("无法装备：装备格已满或羁绊重复");
      return false;
    }
    G.items.splice(idx, 1);
    UI.selected = null;
    AudioFX.play("item");
    UI.render();
    this.save();
    return true;
  },
  craft(a, b) {
    if (!this.canManage() || a === b) return;
    const first = G.items[a],
      second = G.items[b];
    const recipe = RECIPES[[first, second].sort().join("+")];
    if (!recipe) {
      UI.toast("这两件装备不能合成");
      return;
    }
    for (const i of [a, b].sort((x, y) => y - x)) G.items.splice(i, 1);
    G.items.push(recipe);
    UI.selected = null;
    AudioFX.play("item");
    UI.toast(`合成 ${ITEMS[recipe].name}`);
    UI.render();
    this.save();
  },
  buyXp() {
    if (!this.canManage() || G.level >= MAX_LEVEL) return;
    if (G.gold < 4) {
      UI.toast("购买经验需要 4 金币");
      return;
    }
    G.gold -= 4;
    this.giveXp(4);
    UI.render();
    this.save();
  },
  giveXp(n) {
    if (G.level >= MAX_LEVEL) return;
    G.xp += n;
    while (G.level < MAX_LEVEL && G.xp >= XP_REQ[G.level]) {
      G.xp -= XP_REQ[G.level];
      G.level++;
      AudioFX.play("combine");
    }
    if (G.level === MAX_LEVEL) G.xp = 0;
  },
  autoDeploy() {
    this.claimRewards();
    const used = new Set(Object.keys(G.board));
    for (
      let i = 0;
      i < 9 && Object.keys(G.board).length < this.capacity();
      i++
    ) {
      const u = G.bench[i];
      if (!u) continue;
      const rows = HEROES[u.heroId].range > 1 ? [7, 6, 5, 4] : [4, 5, 6, 7];
      let key;
      for (const y of rows) {
        key = [3, 2, 4, 1, 5, 0, 6]
          .map((x) => x + "," + y)
          .find((k) => !used.has(k));
        if (key) break;
      }
      G.board[key] = u;
      G.bench[i] = null;
      used.add(key);
    }
    UI.render();
  },
  boardSpecs() {
    return Object.entries(G.board).map(([key, u]) => {
      const [x, y] = key.split(",").map(Number);
      return { ...u, x, y };
    });
  },
  botArmy(bot) {
    return bot.roster
      .slice()
      .sort((a, b) => this.strength(b) - this.strength(a))
      .slice(0, bot.level);
  },
  strength(u) {
    return (
      (HEROES[u.heroId].hp[u.star - 1] / 100 +
        HEROES[u.heroId].atk[u.star - 1] / 10 +
        HEROES[u.heroId].cost * 2) *
      (1 + u.items.length * 0.2)
    );
  },
  manageBot(bot) {
    if (bot.hp <= 0) return;
    bot.level = Math.min(
      9,
      Math.max(
        bot.level,
        stageOf(G.round) + 2 + (stepOf(G.round) >= 5 ? 1 : 0),
      ),
    );
    const budget = Math.min(bot.gold, stageOf(G.round) < 3 ? 12 : 22);
    let spent = 0;
    for (let roll = 0; roll < 5 && spent < budget; roll++) {
      if (roll > 0) {
        if (bot.gold < 2) break;
        bot.gold -= 2;
        spent += 2;
      }
      const offers = Array.from({ length: 5 }, () => this.draw(bot.level));
      for (const id of offers) {
        if (!id) continue;
        const h = HEROES[id],
          preferred = bot.plan.includes(id),
          needed =
            bot.roster.filter((u) => u.heroId === id && u.star === 1).length >
            0;
        if (
          bot.gold >= h.cost &&
          bot.roster.length < bot.level + 9 &&
          (preferred || needed || bot.roster.length < bot.level)
        ) {
          bot.gold -= h.cost;
          spent += h.cost;
          bot.roster.push(this.unit(id));
          this.combineBot(bot, id);
        } else G.pool[id]++;
      }
    }
    const army = this.botArmy(bot);
    while (bot.roster.length > bot.level + 6) {
      const sell = bot.roster
        .filter((u) => !army.includes(u))
        .sort((a, b) => this.strength(a) - this.strength(b))[0];
      if (!sell) break;
      bot.roster.splice(bot.roster.indexOf(sell), 1);
      bot.gold += this.sellPrice(sell);
      this.returnUnit(sell);
    }
  },
  combineBot(bot, id) {
    for (let s = 1; s < 3; s++) {
      const matches = bot.roster.filter((u) => u.heroId === id && u.star === s);
      if (matches.length >= 3) {
        const keep = matches[0];
        keep.star++;
        keep.items = matches
          .slice(0, 3)
          .flatMap((u) => u.items)
          .slice(0, 3);
        bot.roster = bot.roster.filter((u) => !matches.slice(1, 3).includes(u));
        this.combineBot(bot, id);
        return;
      }
    }
  },
  openCarousel() {
    G.phase = "carousel";
    G.carousel = Array.from({ length: 9 }, () => {
      const id =
        this.reserve(Math.min(5, stageOf(G.round))) ||
        this.draw(Math.min(9, stageOf(G.round) + 1));
      return id
        ? {
            heroId: id,
            item: rand(BASE_ITEMS.filter((i) => i !== "1010")),
            taken: false,
          }
        : null;
    }).filter(Boolean);
    G.carouselAhead = [];
    const ahead = G.bots
      .filter((b) => b.hp > 0 && b.hp < G.hp)
      .sort((a, b) => a.hp - b.hp);
    for (const bot of ahead) {
      const c = rand(G.carousel.filter((c) => !c.taken));
      if (c) {
        c.taken = true;
        c.owner = bot.name;
        bot.roster.push(this.unit(c.heroId, [c.item]));
        this.combineBot(bot, c.heroId);
        G.carouselAhead.push(bot.id);
      }
    }
    UI.render();
    this.save();
  },
  chooseCarousel(i) {
    if (G.phase !== "carousel") return;
    const c = G.carousel[i];
    if (!c || c.taken) return;
    c.taken = true;
    c.owner = "你";
    this.putUnit(this.unit(c.heroId, [c.item]));
    for (const bot of G.bots.filter(
      (b) => b.hp > 0 && !G.carouselAhead.includes(b.id),
    )) {
      const pick = rand(G.carousel.filter((x) => !x.taken));
      if (pick) {
        pick.taken = true;
        pick.owner = bot.name;
        bot.roster.push(this.unit(pick.heroId, [pick.item]));
        this.combineBot(bot, pick.heroId);
      }
    }
    for (const extra of G.carousel.filter((c) => !c.taken))
      G.pool[extra.heroId]++;
    G.carousel = [];
    G.round++;
    if (G.round === 1) {
      G.gold = 3;
      this.giveXp(2);
      this.autoDeploy();
    } else this.giveXp(2);
    this.prepare();
  },
  prepare() {
    G.phase = "prep";
    G.prepLeft = 35;
    this.engine = null;
    UI.selected = null;
    G.bots.forEach((b) => this.manageBot(b));
    const alive = G.bots.filter((b) => b.hp > 0);
    G.opponent =
      roundType(G.round) === "pvp"
        ? (rand(alive.filter((b) => b.id !== G.lastOpponent)) || alive[0])?.id
        : null;
    if (!G.locked) this.rollShop(true);
    this.claimRewards();
    UI.render();
    this.save();
  },
  preview() {
    if (roundType(G.round) === "pve") return creepWave(G.round);
    const bot = G.bots.find((b) => b.id === G.opponent);
    return bot ? this.botArmy(bot) : [];
  },
  startBattle() {
    if (G.phase !== "prep") return;
    this.autoDeploy();
    // Explicit readiness resumes a paused game. Empty boards still resolve a loss.
    G.paused = false;
    this.save();
    G.phase = "combat";
    UI.selected = null;
    UI.hideTip();
    this.engine = new CombatEngine(this.boardSpecs(), this.preview());
    this.battleTraitCounts = traitCounts(Object.values(G.board));
    this.acc = 0;
    this.finishing = 0;
    G.lastOpponent = G.opponent;
    this.aiResults = [];
    if (roundType(G.round) === "pvp") {
      const bots = G.bots
        .filter((b) => b.hp > 0 && b.id !== G.opponent)
        .sort(() => Math.random() - 0.5);
      while (bots.length >= 2) {
        const a = bots.pop(),
          b = bots.pop();
        const result = new CombatEngine(this.botArmy(a), this.botArmy(b), {
          visual: false,
        }).run();
        this.aiResults.push({ a: a.id, b: b.id, result });
      }
      if (bots.length) {
        const a = bots[0],
          b = G.bots.find((b) => b.id === G.opponent);
        if (b) {
          const result = new CombatEngine(this.botArmy(a), this.botArmy(b), {
            visual: false,
          }).run();
          this.aiResults.push({ a: a.id, b: null, result });
        }
      }
    }
    UI.beginCombat(this.engine);
    UI.renderPanels();
  },
  playerDamage(result) {
    return (
      [0, 0, 2, 3, 5, 8, 10][Math.min(6, stageOf(G.round))] +
      Math.max(1, result.survivors.length * 2)
    );
  },
  finishBattle() {
    const engine = this.engine;
    if (!engine || G.phase !== "combat") return;
    const res = engine.result,
      win = res.winner === 0,
      pvp = roundType(G.round) === "pvp";
    const enemy = G.bots.find((b) => b.id === G.opponent);
    const damage = this.playerDamage(res);
    G.lastDamage = engine.units
      .filter((u) => u.side === 0 && u.heroId)
      .map((u) => ({
        heroId: u.heroId,
        damage: Math.round(u.damage),
        healing: Math.round(u.healing),
      }))
      .sort((a, b) => b.damage - a.damage);
    if (pvp) {
      if (win && enemy) enemy.hp = Math.max(0, enemy.hp - damage);
      if (res.winner === -1 && enemy) enemy.hp = Math.max(0, enemy.hp - damage);
      if (!win) G.hp = Math.max(0, G.hp - damage);
      G.streak = win ? Math.max(0, G.streak) + 1 : Math.min(0, G.streak) - 1;
      for (const pair of this.aiResults) {
        const a = G.bots.find((b) => b.id === pair.a),
          b = G.bots.find((b) => b.id === pair.b),
          d = this.playerDamage(pair.result);
        if (pair.result.winner !== 0) a.hp = Math.max(0, a.hp - d);
        if (b && pair.result.winner !== 1) b.hp = Math.max(0, b.hp - d);
      }
      const cnt = this.battleTraitCounts;
      if (tierOf("r8", cnt.r8 || 0)) {
        const previous = G.loot || { gold: 0, items: [] };
        // Local five-pirate reward: +3 gold and a 30% chance of equipment.
        const item = cnt.r8 >= 5 && Math.random() < 0.3
          ? rand(Object.keys(ITEMS).filter((id) => !EMBLEMS[id])) : null;
        G.loot = {
          ...previous,
          pirateChests: (previous.pirateChests || 0) + 1,
          gold: previous.gold + Math.floor(Math.random() * 5) + (cnt.r8 >= 5 ? 3 : 0),
          items: [...previous.items, ...(item ? [item] : [])],
        };
      }
    } else {
      if (!win) G.hp = Math.max(0, G.hp - damage);
      const killed = engine.units.filter(
        (u) => u.side === 1 && !u.alive,
      ).length;
      if (killed) {
        const previous = G.loot || { gold: 0, items: [] };
        G.loot = {
          ...previous,
          gold: previous.gold + 2 + Math.floor(Math.random() * 3),
          items: [
            ...previous.items,
            ...Array.from({ length: stageOf(G.round) >= 2 ? 2 : 1 }, () =>
              rand(BASE_ITEMS.filter((i) => i !== "1010")),
            ),
          ],
        };
      }
    }
    G.history.push({
      round: roundName(G.round),
      win,
      pvp,
      damage: win ? 0 : damage,
    });
    G.history = G.history.slice(-12);
    const interest = Math.min(5, Math.floor(G.gold / 10)),
      streak = Math.abs(G.streak),
      streakGold = pvp
        ? streak >= 5
          ? 3
          : streak >= 4
            ? 2
            : streak >= 2
              ? 1
              : 0
        : 0,
      base = G.round < 3 ? G.round + 2 : 5;
    G.income = { base, interest, streak: streakGold, win: pvp && win ? 1 : 0 };
    G.gold += base + interest + streakGold + G.income.win;
    for (const b of G.bots) {
      if (b.hp <= 0 && !b.eliminated) {
        b.eliminated = true;
        b.roster.forEach((u) => this.returnUnit(u));
        b.roster = [];
      } else if (b.hp > 0) {
        b.gold += 5 + Math.min(5, Math.floor(b.gold / 10));
        if (!pvp) {
          const carry = this.botArmy(b).sort(
            (a, b) => HEROES[b.heroId].range - HEROES[a.heroId].range,
          )[0];
          if (carry && carry.items.length < 3)
            carry.items.push(
              rand(
                Object.keys(ITEMS).filter(
                  (i) =>
                    ITEMS[i].recipe.length &&
                    !EMBLEMS[i] &&
                    !["2044", "2036", "2047", "2048"].includes(i),
                ),
              ),
            );
        }
      }
    }
    AudioFX.play(win ? "win" : "lose");
    const pirateReward = pvp && tierOf("r8", this.battleTraitCounts.r8 || 0)
      ? " · 获得豪侠宝箱" : "";
    UI.toast((win ? "战斗胜利" : `战斗失利 · 生命 -${damage}`) + pirateReward);
    if (G.hp <= 0 || G.bots.every((b) => b.hp <= 0)) {
      // Settle pending loot before the final screen disables movement.
      if (G.loot) this.collectLoot();
      G.phase = "over";
      G.rank = G.hp > 0 ? 1 : 1 + G.bots.filter((b) => b.hp > 0).length;
      UI.render();
      this.save();
      return;
    }
    G.round++;
    this.giveXp(2);
    if (roundType(G.round) === "carousel") this.openCarousel();
    else this.prepare();
  },
  collectLoot() {
    if (!G.loot || !this.canManage()) return;
    const loot = G.loot;
    G.gold += loot.gold;
    G.items.push(...loot.items);
    G.loot = null;
    AudioFX.play("item");
    const contents = [`${loot.gold} 金币`, ...loot.items.map((i) => ITEMS[i].name)].join(" · ");
    UI.toast(loot.pirateChests
      ? `开启豪侠宝箱 ×${loot.pirateChests} · ${contents}${!loot.gold && !loot.items.length ? "（空箱）" : ""}`
      : `获得 ${contents}`);
    UI.render();
    this.save();
  },
  togglePause() {
    G.paused = !G.paused;
    UI.renderPanels();
    this.save();
  },
  toggleMute() {
    G.muted = !G.muted;
    AudioFX.muted = G.muted;
    if (G.muted) AudioFX.stop();
    try {
      localStorage.setItem("jcc-muted", G.muted ? "1" : "0");
    } catch {}
    UI.renderPanels();
  },
  toggleLock() {
    if (!this.canManage()) return;
    G.locked = !G.locked;
    UI.renderPanels();
    this.save();
  },
};
window.addEventListener("DOMContentLoaded", () => Game.init());
