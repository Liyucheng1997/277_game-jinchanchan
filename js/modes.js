"use strict";
// Extra rule sets inspired by landmark TFT sets. Each mode keeps its own save.
// Everything here is a local adaptation: numbers are tuned for this engine.

const MODE_INFO = {
  hextech: {
    name: "海克斯强化", kicker: "HEXTECH · 海克斯", tagline: "三次强化，改写对局",
    desc: "2-1、3-2、4-2 三选一海克斯强化（白银 / 黄金 / 棱彩），每次可免费重随一次。经济、装备、战斗全方位加成，电脑同样会获得强化。",
    features: "22 种强化 · 三档稀有度 · 重随一次",
  },
  hyper: {
    name: "狂暴模式", kicker: "HYPER ROLL · 狂暴", tagline: "20 血 · 20 秒 · 1 块刷新",
    desc: "生命只有 20，备战 20 秒，刷新只要 1 金币，按回合自动升级，不能购买经验，也没有利息与连胜。节奏飞快，一局十来分钟。",
    features: "自动升级 · 刷新 1 金币 · 无利息",
  },
  galaxy: {
    name: "星系漫游", kicker: "GALAXIES · 星系", tagline: "每局一片新星系",
    desc: "开局随机进入一个星系，整局所有弈士共享同一条特殊规则：更厚的血量、翻倍的野怪宝藏、开局军械库、免费刷新……",
    features: "6 种星系 · 全员生效 · 开局揭晓",
  },
  anomaly: {
    name: "异变实验室", kicker: "ANOMALY · 异变", tagline: "给你的主 C 注入异变",
    desc: "3-5 与 4-5 出现异变实验：从三种异变中选一种，永久注入一名英雄——巨人化、双重施法、分身、处决……电脑也会改造它们的核心。",
    features: "10 种异变 · 绑定英雄 · 两次注入",
  },
};

// tier: 1 白银 2 黄金 3 棱彩. `now` runs once when picked; `combat(u, eng)` runs
// on every friendly unit at combat start; `foe(u, eng)` on every enemy unit.
const AUGMENTS = {
  stash: { tier: 1, name: "小金库", desc: "立即获得 10 金币。", now: (g) => (g.gold += 10) },
  components: { tier: 1, name: "组件大礼包", desc: "立即获得 2 件随机基础装备。", now: (g) => Modes.giveComponents(2) },
  tradeSector: { tier: 1, name: "贸易星区", desc: "每个备战环节开始时获得 1 次免费刷新。", now: (g) => (g.freeRollsPerRound = (g.freeRollsPerRound || 0) + 1) },
  study: { tier: 1, name: "天赋异禀", desc: "立即获得 8 点经验。", now: () => Game.giveXp(8) },
  ironwall: { tier: 1, name: "铁壁前线", desc: "前两排英雄 +250 生命、+20 护甲与魔抗。",
    combat: (u) => { if (Modes.frontRow(u)) { u.maxHp += 250; u.hp += 250; u.armor += 20; u.mr += 20; } } },
  sniper: { tier: 1, name: "狙击巢", desc: "后两排英雄造成的伤害 +18%。", combat: (u) => { if (!Modes.frontRow(u)) u.amp += 0.18; } },
  haste: { tier: 1, name: "急速连击", desc: "全队攻击速度 +15%。", combat: (u) => (u.asBonus += 0.15) },
  vamp: { tier: 1, name: "嗜血渴望", desc: "全队 +12% 全能吸血。", combat: (u) => (u.vamp += 0.12) },
  salary: { tier: 2, name: "工资卡", desc: "此后每回合额外获得 2 金币。", now: (g) => (g.bonusIncome = (g.bonusIncome || 0) + 2) },
  banker: { tier: 2, name: "理财专家", desc: "利息上限由 5 提升到 8。", now: (g) => (g.interestCap = Math.max(g.interestCap || 5, 8)) },
  giftbox: { tier: 2, name: "成装礼盒", desc: "立即获得 1 件随机成装。", now: () => Modes.giveCompleted(1) },
  emblem: { tier: 2, name: "纹章铸造", desc: "立即获得 1 个随机纹章。", now: () => G.items.push(rand(Object.keys(EMBLEMS))) },
  manaflow: { tier: 2, name: "法力涌流", desc: "全队开战时 +35 法力。", combat: (u) => (u.mana = Math.min(u.manaMax, u.mana + 35)) },
  titan: { tier: 2, name: "泰坦之躯", desc: "全队 +350 最大生命。", combat: (u) => { u.maxHp += 350; u.hp += 350; } },
  precision: { tier: 2, name: "致命精准", desc: "全队暴击率 +20%，暴击伤害 +25%，技能也可暴击。",
    combat: (u) => { u.crit += 0.2; u.critD += 0.25; u.spellCrit = true; } },
  reinforce: { tier: 2, name: "援军", desc: "立即获得 2 名随机 3 费英雄。", now: () => Modes.giveHeroes(3, 2) },
  jackpot: { tier: 3, name: "黄金天堂", desc: "立即获得 22 金币。", now: (g) => (g.gold += 22) },
  recruit: { tier: 3, name: "新兵报到", desc: "上阵人口永久 +1。", now: (g) => (g.bonusSlots = (g.bonusSlots || 0) + 1) },
  armory: { tier: 3, name: "神器宝库", desc: "立即获得 2 件随机成装。", now: () => Modes.giveCompleted(2) },
  overlord: { tier: 3, name: "以一当十", desc: "全队伤害 +20%，受到的伤害 -12%。", combat: (u) => { u.amp += 0.2; u.reduce += 0.12; } },
  archmage: { tier: 3, name: "奥术之源", desc: "全队 +45 法术强度，开战 +20 法力。",
    combat: (u) => { u.ap += 0.45; u.mana = Math.min(u.manaMax, u.mana + 20); } },
  frost: { tier: 3, name: "永冻领域", desc: "敌方全体攻击速度 -25%，前 6 秒额外减速 30%。",
    foe: (u, eng) => { u.asBonus -= 0.25; eng.effect(u, "slow", 6, 0.3, "frostAug"); } },
};
const AUGMENT_TIERS = { 1: "白银", 2: "黄金", 3: "棱彩" };
const AUGMENT_ROUNDS = [4, 12, 19]; // 2-1, 3-2, 4-2

const GALAXIES = {
  littleLegends: { name: "小小巨人", desc: "所有弈士的生命值提升到 150。", hp: 150 },
  treasure: { name: "宝藏星云", desc: "野怪回合的金币与装备翻倍，并有 35% 概率额外掉落一件成装。" },
  armoryStart: { name: "银河军械库", desc: "所有弈士开局获得 3 件随机基础装备。" },
  trade: { name: "贸易星区", desc: "每个备战环节开始时都有 1 次免费刷新。" },
  binary: { name: "双星星云", desc: "携带 1–2 件装备的英雄攻击速度 +20%，伤害 +15%。",
    combat: (u) => { const n = u.items.length; if (n >= 1 && n <= 2) { u.asBonus += 0.2; u.amp += 0.15; } } },
  supernova: { name: "超新星", desc: "所有英雄开战时获得 30 法力，技能伤害 +10%。",
    combat: (u) => { u.mana = Math.min(u.manaMax, u.mana + 30); u.spellAmp = (u.spellAmp || 0) + 0.1; } },
};

// Unit-bound mutations for the Anomaly mode.
const ANOMALIES = {
  titanic: { name: "巨人化", desc: "最大生命 +55%，体型变大。", apply: (u) => { u.maxHp *= 1.55; u.hp = u.maxHp; } },
  echo: { name: "双重施法", desc: "施放技能后 0.6 秒再次施放一次（不消耗法力）。" },
  clone: { name: "镜像分身", desc: "开战时在身旁召唤一个 60% 生命与攻击的分身（不带装备）。" },
  executioner: { name: "处决者", desc: "对生命低于 40% 的敌人伤害 +50%。" },
  vampire: { name: "血族", desc: "+35% 全能吸血，生命低于一半时攻速 +30%。", apply: (u) => (u.vamp += 0.35) },
  berserk: { name: "狂战", desc: "每次攻击叠加 5% 攻击速度，无上限。" },
  guardian: { name: "星之守护", desc: "开战获得 45% 最大生命的护盾，持续 10 秒。", start: (u, eng) => eng.shield(u, u.maxHp * 0.45, 10) },
  overflow: { name: "法力溢流", desc: "施法后立即返还 40 法力。" },
  unstoppable: { name: "无畏", desc: "免疫控制，+25 护甲与魔抗。", apply: (u) => { u.armor += 25; u.mr += 25; }, start: (u, eng) => eng.effect(u, "ccImmune", 99) },
  blink: { name: "暗影突袭", desc: "开战跳到敌方后排，并获得 2 秒不可选取。", start: (u, eng) => { const t = eng.farthest(u); if (t) eng.teleport(u, t); eng.effect(u, "untargetable", 2); } },
};
const ANOMALY_ROUNDS = [15, 22]; // 3-5, 4-5

const Modes = {
  is(id) {
    return GameVersions.current === id;
  },
  frontRow(u) {
    return u.side === 0 ? u.y <= 5 : u.y >= 2;
  },
  prepTime() {
    return this.is("hyper") ? 20 : 35;
  },
  rollCost() {
    return this.is("hyper") ? 1 : 2;
  },
  canBuyXp() {
    return !this.is("hyper");
  },
  startHp() {
    if (this.is("hyper")) return 20;
    if (this.is("galaxy") && GALAXIES[G?.galaxy]?.hp) return GALAXIES[G.galaxy].hp;
    return 100;
  },
  interestCap() {
    return this.is("hyper") ? 0 : G?.interestCap || 5;
  },
  interest(gold) {
    return Math.min(this.interestCap(), Math.floor(Math.max(0, gold) / 10));
  },
  hyperLevel(round) {
    return Math.min(9, 3 + Math.floor(round / 3));
  },
  // Loss damage. Hyper Roll uses small fixed numbers for its 20 HP pool.
  damage(stage, survivors, base) {
    if (!this.is("hyper")) return base;
    return [0, 1, 1, 2, 2, 3, 3, 4][Math.min(7, stage)] + (survivors > 3 ? 1 : 0);
  },

  // ---------- lifecycle hooks called by Game ----------
  onNewGame(g) {
    g.maxHp = this.startHp();
    g.augments = [];
    g.anomalies = 0;
    g.choice = null;
    if (this.is("galaxy")) {
      g.galaxy = rand(Object.keys(GALAXIES));
      g.maxHp = GALAXIES[g.galaxy].hp || 100;
      if (g.galaxy === "armoryStart") g.items.push(...this.randomComponents(3));
    }
    if (this.is("hyper")) g.level = 1;
    g.hp = g.maxHp;
    for (const b of g.bots) {
      b.hp = g.maxHp;
      b.augments = [];
    }
  },
  onPrepare() {
    if (!G) return;
    const free = (G.freeRollsPerRound || 0) + (this.is("galaxy") && G.galaxy === "trade" ? 1 : 0);
    G.freeRolls = free;
    if (this.is("hyper")) {
      const level = this.hyperLevel(G.round);
      if (level > G.level) {
        G.level = level;
        G.xp = 0;
        UI.toast(`狂暴模式 · 自动升到 ${level} 级`);
      }
      for (const b of G.bots) if (b.hp > 0) b.level = Math.max(b.level, level);
    }
    if (this.is("hextech") && AUGMENT_ROUNDS.includes(G.round) && !G.augmentRounds?.includes(G.round)) {
      G.augmentRounds = [...(G.augmentRounds || []), G.round];
      this.offerAugments();
      for (const b of G.bots) if (b.hp > 0) this.botAugment(b, G.choice.tier);
    }
    if (this.is("anomaly") && ANOMALY_ROUNDS.includes(G.round) && !G.anomalyRounds?.includes(G.round)) {
      G.anomalyRounds = [...(G.anomalyRounds || []), G.round];
      G.choice = { kind: "anomaly", options: this.sample(Object.keys(ANOMALIES), 3), pick: null };
      for (const b of G.bots) if (b.hp > 0) this.botAnomaly(b);
    }
  },
  // Called when the prep timer runs out, or before readying up.
  autoResolve() {
    if (!G?.choice) return;
    if (G.choice.kind === "augment") this.pickAugment(0);
    else if (G.choice.kind === "anomaly") {
      const target = this.anomalyTargets()[0];
      if (target) this.applyAnomaly(G.choice.pick ?? 0, target.unit.uid);
      else G.choice = null;
    }
  },

  // ---------- Hextech ----------
  offerAugments(tier) {
    tier ??= this.rollTier();
    const owned = new Set(G.augments);
    const pool = Object.keys(AUGMENTS).filter((id) => AUGMENTS[id].tier === tier && !owned.has(id));
    G.choice = { kind: "augment", tier, options: this.sample(pool, 3), rerolls: G.choice?.kind === "augment" ? G.choice.rerolls : 1 };
  },
  rollTier() {
    const r = Math.random();
    const late = G.round >= 19;
    return r < (late ? 0.25 : 0.12) ? 3 : r < 0.6 ? 2 : 1;
  },
  rerollAugments() {
    const c = G.choice;
    if (c?.kind !== "augment" || c.rerolls <= 0) return false;
    c.rerolls--;
    const owned = new Set([...G.augments, ...c.options]);
    const pool = Object.keys(AUGMENTS).filter((id) => AUGMENTS[id].tier === c.tier && !owned.has(id));
    c.options = this.sample(pool.length >= 3 ? pool : Object.keys(AUGMENTS).filter((id) => AUGMENTS[id].tier === c.tier), 3);
    UI.render();
    Game.save();
    return true;
  },
  pickAugment(i) {
    const c = G.choice;
    if (c?.kind !== "augment" || !["prep", "combat"].includes(G.phase)) return false;
    const id = c.options[i];
    if (!AUGMENTS[id]) return false;
    G.choice = null;
    G.augments.push(id);
    AUGMENTS[id].now?.(G);
    AudioFX.play("combine");
    UI.toast(`获得海克斯强化 · ${AUGMENTS[id].name}`);
    Game.claimRewards();
    UI.render();
    Game.save();
    return true;
  },
  botAugment(bot, tier) {
    const combat = Object.keys(AUGMENTS).filter((id) => AUGMENTS[id].tier === tier && (AUGMENTS[id].combat || AUGMENTS[id].foe));
    const pick = rand(combat.filter((id) => !bot.augments?.includes(id))) || rand(combat);
    bot.augments = [...(bot.augments || []), pick];
  },

  // ---------- Anomaly ----------
  anomalyTargets() {
    return Game.refs().filter((r) => !r.unit.anomaly)
      .sort((a, b) => (a.loc.type === "board" ? 0 : 1) - (b.loc.type === "board" ? 0 : 1) || Game.strength(b.unit) - Game.strength(a.unit));
  },
  chooseAnomaly(i) {
    if (G.choice?.kind !== "anomaly") return;
    G.choice.pick = i;
    UI.renderModeChoice();
  },
  applyAnomaly(i, uid) {
    const c = G.choice;
    if (c?.kind !== "anomaly") return false;
    const id = c.options[i], ref = Game.refs().find((r) => r.unit.uid === uid);
    if (!ANOMALIES[id] || !ref || ref.unit.anomaly) return false;
    ref.unit.anomaly = id;
    G.anomalies = (G.anomalies || 0) + 1;
    G.choice = null;
    AudioFX.play("combine");
    UI.toast(`${HEROES[ref.unit.heroId].name} 注入异变 · ${ANOMALIES[id].name}`);
    UI.render();
    Game.save();
    return true;
  },
  botAnomaly(bot) {
    const army = Game.botArmy(bot).filter((u) => !u.anomaly);
    if (army[0]) army[0].anomaly = rand(Object.keys(ANOMALIES));
  },

  // ---------- rewards ----------
  randomComponents(n) {
    return Array.from({ length: n }, () => rand(BASE_ITEMS.filter((i) => !["1008", "1010"].includes(i))));
  },
  giveComponents(n) {
    G.items.push(...this.randomComponents(n));
  },
  randomCompleted() {
    return rand(Object.keys(ITEMS).filter((id) => ITEMS[id].recipe.length && !EMBLEMS[id] && !["2044", "2036", "2047", "2048"].includes(id)));
  },
  giveCompleted(n) {
    for (let i = 0; i < n; i++) G.items.push(this.randomCompleted());
  },
  giveHeroes(cost, n) {
    for (let i = 0; i < n; i++) {
      const id = Game.reserve(cost);
      if (id) Game.putUnit(Game.unit(id));
    }
  },
  sample(list, n) {
    const copy = list.slice(), out = [];
    while (copy.length && out.length < n) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  },

  // Combat modifiers for one side: player (-1) or a bot object.
  combatMods(owner) {
    return { augments: owner === -1 ? G.augments || [] : owner?.augments || [], galaxy: this.is("galaxy") ? G.galaxy : null };
  },

  // ---------- presentation ----------
  panelHtml() {
    if (!G) return "";
    const mode = GameVersions.current, info = MODE_INFO[mode];
    if (!info) return "";
    let body = "";
    if (mode === "hextech") {
      const next = AUGMENT_ROUNDS.find((r) => r > G.round || (r === G.round && G.choice));
      body = (G.augments || []).map((id) => `<span class="aug-chip t${AUGMENTS[id].tier}" title="${esc(AUGMENTS[id].desc)}">${AUGMENTS[id].name}</span>`).join("") ||
        '<span class="mode-muted">尚未获得强化</span>';
      body += `<span class="mode-foot">${next !== undefined ? `下次强化：${roundName(next)}` : "强化已全部获得"} · 点击查看</span>`;
    } else if (mode === "hyper") {
      body = `<span>自动等级 ${G.level} · 刷新 ◉ 1</span><span class="mode-foot">无利息 · 无连胜 · 备战 20 秒</span>`;
    } else if (mode === "galaxy") {
      const g = GALAXIES[G.galaxy];
      body = g ? `<strong class="galaxy-name">${g.name}</strong><span>${esc(g.desc)}</span>` : "";
    } else if (mode === "anomaly") {
      const list = Game.refs().filter((r) => r.unit.anomaly).map((r) => `<span class="aug-chip t3">${HEROES[r.unit.heroId].name} · ${ANOMALIES[r.unit.anomaly].name}</span>`).join("");
      const next = ANOMALY_ROUNDS.find((r) => r > G.round);
      body = (list || '<span class="mode-muted">暂无异变英雄</span>') + `<span class="mode-foot">${next !== undefined ? `下次异变：${roundName(next)}` : "异变实验已结束"}</span>`;
    }
    return `<span class="mode-heading">${info.name}</span>${body}`;
  },
  guideHtml() {
    const mode = GameVersions.current;
    if (mode === "hextech")
      return `<div class="mode-guide"><p>${MODE_INFO.hextech.desc}</p>${[1, 2, 3].map((t) => `<h3>${AUGMENT_TIERS[t]}强化</h3><div class="aug-list">${Object.values(AUGMENTS).filter((a) => a.tier === t).map((a) => `<div class="aug-card t${t} ${G.augments?.includes(Object.keys(AUGMENTS).find((k) => AUGMENTS[k] === a)) ? "owned" : ""}"><b>${a.name}</b><span>${a.desc}</span></div>`).join("")}</div>`).join("")}</div>`;
    if (mode === "galaxy")
      return `<div class="mode-guide"><p>${MODE_INFO.galaxy.desc}</p><div class="aug-list">${Object.entries(GALAXIES).map(([id, g]) => `<div class="aug-card t2 ${G.galaxy === id ? "owned" : ""}"><b>${g.name}${G.galaxy === id ? " · 本局" : ""}</b><span>${g.desc}</span></div>`).join("")}</div></div>`;
    if (mode === "anomaly")
      return `<div class="mode-guide"><p>${MODE_INFO.anomaly.desc}</p><div class="aug-list">${Object.values(ANOMALIES).map((a) => `<div class="aug-card t3"><b>${a.name}</b><span>${a.desc}</span></div>`).join("")}</div></div>`;
    return `<div class="mode-guide"><p>${MODE_INFO[mode]?.desc || ""}</p><p>自动等级：每 3 回合升一级（最高 9 级）。失利伤害按阶段 1–4 点，敌方存活超过 3 名额外 +1。</p></div>`;
  },
};
