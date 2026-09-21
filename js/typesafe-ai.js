"use strict";

const TypeSafeAI = {
  enabled: false,
  busy: false,
  configured: null,
  localService: null,
  timer: null,
  decisions: 0,
  apiDecisions: 0,
  decisionRound: null,
  holdKey: null,
  formationRound: null,
  swapRound: null,
  last: null,
  plan: null,
  planGame: null,

  init() {
    const button = document.querySelector("#btnAi");
    if (!button) return;
    button.onclick = () => this.toggle();
    document.querySelector("#btnAiConfig").onclick = () => this.openConfig();
    this.status("AI 未开启", "off");
    fetch("/api/typesafe/status")
      .then((r) => r.ok && r.headers.get("content-type")?.includes("application/json") ? r.json() : Promise.reject())
      .then((data) => {
        if (data.skill !== "typesafe-ai") throw new Error("not the local TypeSafe service");
        this.localService = true;
        this.configured = Boolean(data.configured);
        this.render();
      })
      .catch(() => {
        this.localService = false;
        this.configured = false;
        this.status("在线版可手动玩 · AI 需本地服务", "error");
        this.render();
      });
  },

  toggle(force) {
    const next = typeof force === "boolean" ? force : !this.enabled;
    if (next && this.configured === false) {
      return this.openConfig();
    }
    this.enabled = next;
    this.holdKey = null;
    this.decisions = 0;
    this.apiDecisions = 0;
    this.decisionRound = null;
    if (next && this.planGame !== G?.uid) {
      this.plan = null;
      this.planGame = G?.uid;
    }
    if (this.enabled && G?.paused) {
      G.paused = false;
      UI.renderPanels();
    }
    this.status(this.enabled ? "Jev 正在接管" : "AI 未开启", this.enabled ? "on" : "off");
    this.render();
    clearTimeout(this.timer);
    if (this.enabled) this.schedule(0);
  },

  openConfig() {
    if (this.localService === false) {
      UI.dialog(
        "TypeSafe Jev AI 需要本地服务",
        `<div class="ai-config"><p>GitHub Pages 是纯静态网站，不能安全保存 API 密钥或代理 TypeSafe 请求。在线版仍可完整手动游玩。</p><p>要使用 AI 接管，请下载本项目，在项目目录运行：</p><pre><code>npm start</code></pre><p>然后打开 <code>http://127.0.0.1:8765/</code>，即可在这里填写 Jev API 密钥。</p></div>`,
      );
      return;
    }
    UI.dialog(
      "TypeSafe Jev API 配置",
      `<div class="ai-config">
        <p>密钥只保存到这台电脑上的 <code>.typesafe.local.json</code>，不会进入浏览器存档或 Git。AI 决策时，本地服务会用它请求 TypeSafe 官方 API。</p>
        <label for="typesafeApiKey">Jev API 密钥</label>
        <input id="typesafeApiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="粘贴你的 TypeSafe API Key" />
        <small id="typesafeConfigMessage">${this.configured ? "已配置；输入新密钥可替换现有配置。" : "尚未配置。保存后无需重启服务。"}</small>
        <button class="primary" id="saveTypesafeApiKey">保存并启用</button>
      </div>`,
      () => {
        const input = document.querySelector("#typesafeApiKey");
        const save = document.querySelector("#saveTypesafeApiKey");
        const message = document.querySelector("#typesafeConfigMessage");
        input.focus();
        const submit = async () => {
          const apiKey = input.value.trim();
          if (apiKey.length < 10) {
            message.textContent = "请输入有效的 Jev API 密钥。";
            return;
          }
          save.disabled = true;
          message.textContent = "正在保存到本机…";
          try {
            const response = await fetch("/api/typesafe/config", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ apiKey }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            input.value = "";
            this.configured = true;
            UI.closeDialog();
            UI.toast("Jev API 已安全保存到本机");
            this.toggle(true);
          } catch (error) {
            message.textContent = `保存失败：${error.message}`;
            save.disabled = false;
          }
        };
        save.onclick = submit;
        input.onkeydown = (event) => {
          if (event.key === "Enter") { event.preventDefault(); submit(); }
        };
      },
    );
  },

  render() {
    const button = document.querySelector("#btnAi");
    if (!button) return;
    button.classList.toggle("on", this.enabled);
    button.setAttribute("aria-pressed", String(this.enabled));
    button.textContent = this.busy ? "AI…" : this.enabled ? "AI 接管中" : "AI 接管";
    button.title = this.localService === false
      ? "GitHub Pages 在线版仅支持手动游玩；AI 接管需在本地运行 npm start"
      : this.configured === false
        ? "点击后填写 Jev API 密钥"
      : "让 TypeSafe Jev 自动完成选秀、经营、布阵和开战";
  },

  status(text, kind = "") {
    const el = document.querySelector("#aiStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
  },

  schedule(delay = 700) {
    clearTimeout(this.timer);
    if (this.enabled) this.timer = setTimeout(() => this.tick(), delay);
  },

  roundKey() {
    return `${G?.mode}:${G?.round}:${G?.phase}`;
  },

  fingerprint() {
    if (!G) return "none";
    return JSON.stringify([
      G.phase, G.round, G.gold, G.level, G.xp, G.hp, G.shop,
      G.bench.map((u) => u && [u.uid, u.heroId, u.star, u.items]),
      Object.entries(G.board).map(([k, u]) => [k, u.uid, u.heroId, u.star, u.items]),
      G.items, Boolean(G.loot),
    ]);
  },

  hero(unit) {
    const h = HEROES[unit.heroId];
    return {
      uid: unit.uid,
      name: h.name,
      cost: h.cost,
      star: unit.star,
      traits: unitTraits(unit).map((id) => TRAITS[id]?.name || id),
      range: h.range,
      role: h.range > 1 ? "后排输出/施法" : "前排/近战",
      ability: { name: h.skill.name, description: skillDesc(h, unit.star) },
      items: unit.items.map((id) => ITEMS[id]?.name || id),
      strength: Game.strength(unit),
      chosen: unit.chosen || null,
    };
  },

  state() {
    const plan = this.ensurePlan();
    const board = Object.entries(G.board).map(([position, unit]) => ({ position, ...this.hero(unit) }));
    const bench = G.bench.map((unit, slot) => unit ? { slot, ...this.hero(unit) } : null).filter(Boolean);
    const counts = traitCounts(Object.values(G.board));
    const opponent = Game.preview().map((unit) => unit.heroId
      ? { ...this.hero(unit), position: Number.isFinite(unit.x) ? `${unit.x},${unit.y}` : null }
      : { name: CREEPS[unit.creepId]?.name || unit.creepId, star: unit.star || 1, position: [unit.x, unit.y] });
    return {
      objective: "最大化最终获得第一名的概率；不能为了尽快结束备战而牺牲阵容、装备、站位或经济质量",
      rules: {
        traits: "同名英雄只计一次羁绊；达到羁绊阈值才激活效果，天选对应羁绊额外计数",
        stars: "三个同名同星英雄自动升一星，升星通常是最重要的即时战力来源",
        economy: "每保留10金币每回合获得1利息，最多5；刷新2金币，购买4经验消耗4金币",
        levels: "等级决定上阵基础人口，并改变商店各费用英雄的出现概率",
        equipment: "每名英雄最多三件装备；基础装备在英雄身上会自动与已有基础装备合成",
        positioning: "近战/坦克通常在前排承伤，远程核心在后排；集中可保护核心，分散可规避范围伤害",
        combat: "备战结束后的阵容、装备和站位决定本回合战斗；生命归零即淘汰，最后存活者第一名",
      },
      mode: GameVersions.names[GameVersions.current],
      round: roundName(G.round),
      phase: G.phase,
      seconds_left: Math.max(0, Math.ceil(G.prepLeft || 0)),
      player: { hp: G.hp, gold: G.gold, level: G.level, xp: G.xp, xp_needed: XP_REQ[G.level] || 0, streak: G.streak },
      economy: { interest_now: Math.min(5, Math.floor(G.gold / 10)), shop_odds_by_cost: ODDS[G.level] },
      active_traits: Object.entries(counts).map(([id, count]) => ({ name: TRAITS[id]?.name || id, count, active: Boolean(tierOf(id, count)) })),
      board,
      bench,
      shop: G.shop.map((id, slot) => id ? { slot, name: HEROES[id].name, cost: HEROES[id].cost, traits: HEROES[id].traits.map((t) => TRAITS[t].name), upgrade: Game.upgradeHint(id) } : null),
      inventory: G.items.map((id, slot) => ({ slot, name: ITEMS[id]?.name || id, stats: ITEMS[id]?.basic, effect: ITEMS[id]?.desc, completed: Boolean(ITEMS[id]?.recipe.length) })),
      pending_loot: G.loot ? { gold: G.loot.gold, item_count: G.loot.items.length } : null,
      opponent_preview: opponent,
      recent_results: G.history.slice(-5),
      remaining_players: 1 + G.bots.filter((b) => b.hp > 0).length,
      strategy_plan: plan ? {
        primary_trait: TRAITS[plan.primary]?.name || plan.primary,
        secondary_trait: TRAITS[plan.secondary]?.name || plan.secondary,
        carry: plan.carry ? HEROES[plan.carry]?.name : null,
        tank: plan.tank ? HEROES[plan.tank]?.name : null,
        target_heroes: plan.heroes.map((id) => HEROES[id]?.name || id),
        gold_floor: this.goldFloor(),
      } : null,
    };
  },

  ensurePlan() {
    if (!G) return null;
    const refs = Game.refs();
    if (!refs.length) return this.plan;
    const unique = new Map();
    for (const ref of refs) {
      const old = unique.get(ref.unit.heroId);
      if (!old || old.star < ref.unit.star) unique.set(ref.unit.heroId, ref.unit);
    }
    const scores = {};
    for (const unit of unique.values()) {
      const weight = unit.star * 3 + HEROES[unit.heroId].cost * 0.6 + (unit.chosen ? 5 : 0);
      for (const trait of unitTraits(unit)) scores[trait] = (scores[trait] || 0) + weight;
    }
    const ranked = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
    let primary = ranked[0];
    if (this.plan?.primary && scores[this.plan.primary] >= (scores[primary] || 0) * 0.8)
      primary = this.plan.primary;
    const secondary = ranked.filter((id) => id !== primary).sort((a, b) => {
      const linked = (id) => [...unique.values()].filter((u) => unitTraits(u).includes(primary) && unitTraits(u).includes(id)).length;
      return linked(b) - linked(a) || scores[b] - scores[a];
    })[0] || null;
    const candidates = [...unique.values()].filter((u) => unitTraits(u).includes(primary));
    const carry = candidates.slice().sort((a, b) =>
      (HEROES[b.heroId].range > 1) - (HEROES[a.heroId].range > 1) ||
      b.star - a.star || HEROES[b.heroId].cost - HEROES[a.heroId].cost)[0];
    const tank = candidates.slice().sort((a, b) =>
      (HEROES[a.heroId].range > 1) - (HEROES[b.heroId].range > 1) ||
      b.star - a.star || HEROES[b.heroId].cost - HEROES[a.heroId].cost)[0];
    const heroes = Object.values(HEROES)
      .filter((h) => h.traits.includes(primary) || (secondary && h.traits.includes(primary) && h.traits.includes(secondary)))
      .sort((a, b) => Number(b.traits.includes(secondary)) - Number(a.traits.includes(secondary)) || b.cost - a.cost)
      .slice(0, 12).map((h) => h.id);
    this.plan = { primary, secondary, carry: carry?.heroId || null, tank: tank?.heroId || null, heroes };
    return this.plan;
  },

  goldFloor() {
    if (!G) return 0;
    if (G.hp <= 35) return 0;
    if (G.hp <= 60 || G.streak <= -3) return 10;
    if (stageOf(G.round) <= 2) return 20;
    if (stageOf(G.round) >= 5) return 20;
    return 40;
  },

  lineupScore(units) {
    const plan = this.ensurePlan();
    let score = units.reduce((sum, unit) => sum + Game.strength(unit), 0);
    const counts = traitCounts(units);
    for (const [id, count] of Object.entries(counts)) {
      const reached = (TRAITS[id]?.thresholds || []).filter((n) => count >= n);
      score += reached.reduce((sum, n) => sum + n * 5, 0);
      if (id === plan?.primary) score += count * 2;
      if (id === plan?.secondary) score += count;
    }
    return score;
  },

  buyScore(slot) {
    const id = G.shop[slot];
    if (!id) return -Infinity;
    const hint = Game.upgradeHint(id), plan = this.ensurePlan(), h = HEROES[id];
    const owned = Game.refs().some((r) => r.unit.heroId === id);
    return (hint.star ? 100 : 0) + (hint.pair ? 32 : 0) + (G.chosenOffer === slot ? 45 : 0) +
      (plan?.heroes.includes(id) ? 24 : 0) + (h.traits.includes(plan?.primary) ? 18 : 0) +
      (h.traits.includes(plan?.secondary) ? 8 : 0) + (owned ? 10 : 0) + h.cost * 2;
  },

  targetLevel() {
    return Math.min(MAX_LEVEL, stageOf(G.round) + 2 + (stepOf(G.round) >= 5 ? 1 : 0));
  },

  canEquip(unit, id) {
    if (!unit || !ITEMS[id] || unit.items.includes("2044")) return false;
    if (EMBLEMS[id] && unitTraits(unit).includes(EMBLEMS[id])) return false;
    if (ITEMS[id].recipe.length) return unit.items.length < 3 && !(id === "2044" && unit.items.length);
    const combines = unit.items.some((old) => !ITEMS[old].recipe.length && RECIPES[[old, id].sort().join("+")]);
    return combines || unit.items.length < 3;
  },

  bestEquipAction(itemSlot) {
    const id = G.items[itemSlot], plan = this.ensurePlan();
    if (!id) return null;
    const text = `${ITEMS[id].basic} ${ITEMS[id].desc}`;
    const offense = /攻击|法强|暴击|攻速|法力|伤害/.test(text);
    const defense = /生命|护甲|魔抗|减伤|护盾|治疗/.test(text);
    const refs = Game.refs().filter((ref) => this.canEquip(ref.unit, id));
    const target = refs.sort((a, b) => {
      const score = (u) => Game.strength(u) + u.star * 8 + HEROES[u.heroId].cost * 2 +
        (offense && u.heroId === plan?.carry ? 30 : 0) + (defense && u.heroId === plan?.tank ? 30 : 0) +
        (offense && HEROES[u.heroId].range > 1 ? 10 : 0) + (defense && HEROES[u.heroId].range === 1 ? 10 : 0) - u.items.length * 3;
      return score(b.unit) - score(a.unit);
    })[0];
    if (!target) return null;
    return { id: `equip:${itemSlot}:${target.unit.uid}`, utility: 72,
      description: `按战略计划把 ${ITEMS[id].name} 给${target.unit.heroId === plan?.carry ? "主C" : target.unit.heroId === plan?.tank ? "主坦" : "最佳适配英雄"} ${HEROES[target.unit.heroId].name}${target.unit.star}星` };
  },

  bestSwapActions() {
    const board = Game.refs().filter((r) => r.loc.type === "board");
    const bench = Game.refs().filter((r) => r.loc.type === "bench");
    const current = board.map((r) => r.unit), base = this.lineupScore(current), swaps = [];
    for (const incoming of bench) for (const outgoing of board) {
      const after = current.filter((u) => u.uid !== outgoing.unit.uid).concat(incoming.unit);
      const gain = this.lineupScore(after) - base;
      if (gain > 1) swaps.push({ id: `swap:${incoming.loc.idx}:${outgoing.unit.uid}`, utility: 55 + Math.min(30, gain),
        description: `执行计划换阵：${HEROES[incoming.unit.heroId].name}${incoming.unit.star}星替换${HEROES[outgoing.unit.heroId].name}${outgoing.unit.star}星，预计阵容评分 +${gain.toFixed(1)}；羁绊：${this.traitSummary(after)}` });
    }
    return swaps.sort((a, b) => b.utility - a.utility).slice(0, 2);
  },

  shouldReroll() {
    const pairs = Game.refs().some((r) => Game.upgradeHint(r.unit.heroId).pair);
    return G.gold - 2 >= this.goldFloor() && (G.hp < 70 || G.streak <= -2 || pairs || G.level >= this.targetLevel());
  },

  readyAllowed(actions) {
    if (G.loot || Object.keys(G.board).length < Game.capacity()) return false;
    if (actions.some((a) => /^(equip|swap|collect|deploy):?/.test(a.id))) return false;
    const urgentBuy = actions.some((a) => a.id.startsWith("buy:") && a.utility >= 80);
    if (urgentBuy) return false;
    if ((G.hp < 70 || G.streak <= -2) && G.gold > this.goldFloor() + 3) return false;
    return true;
  },

  resolveAction(result, actions) {
    const selected = actions.find((x) => x.id === result.action);
    if (!selected) return null;
    if (Number(result.confidence) >= 0.25) return selected;
    return actions.slice().sort((a, b) => (b.utility || 0) - (a.utility || 0))[0] || selected;
  },

  traitSummary(units) {
    const counts = traitCounts(units);
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([id, count]) => {
        const trait = TRAITS[id];
        const next = trait.thresholds.find((n) => n > count);
        return `${trait.name}${count}${tierOf(id, count) ? "(已激活)" : next ? `(差${next - count}激活)` : ""}`;
      })
      .join("、");
  },

  economyImpact(cost) {
    const after = G.gold - cost;
    const beforeInterest = Math.min(5, Math.floor(G.gold / 10));
    const afterInterest = Math.min(5, Math.floor(Math.max(0, after) / 10));
    return `剩余${after}金币，利息${beforeInterest}→${afterInterest}`;
  },

  canBuy(slot) {
    const id = G.shop[slot];
    if (!id) return false;
    const price = HEROES[id].cost * (G.chosenOffer === slot ? 3 : 1);
    const matches = Game.refs().filter((r) => r.unit.heroId === id && r.unit.star === (G.chosenOffer === slot ? 2 : 1));
    return G.gold >= price && (G.bench.includes(null) || matches.length >= 2);
  },

  actions() {
    if (!G) return [];
    if (G.phase === "carousel") {
      return G.carousel.map((choice, slot) => ({ choice, slot })).filter((x) => !x.choice.taken).map(({ choice, slot }) => {
        const h = HEROES[choice.heroId];
        return { id: `carousel:${slot}`, utility: h.cost * 4 + (ITEMS[choice.item].recipe.length ? 8 : 0), description: `选择 ${h.name}（${h.cost}费，${h.traits.map((t) => TRAITS[t].name).join("/")}），携带 ${ITEMS[choice.item].name}` };
      });
    }
    if (G.phase !== "prep") return [];
    const actions = [];
    const plan = this.ensurePlan();
    if (G.loot) actions.push({ id: "collect", utility: 1000, description: `领取待收集战利品：${G.loot.gold}金币和${G.loot.items.length}件装备` });
    const buys = [];
    G.shop.forEach((id, slot) => {
      if (!id || !this.canBuy(slot)) return;
      const h = HEROES[id], price = h.cost * (G.chosenOffer === slot ? 3 : 1), hint = Game.upgradeHint(id);
      const owned = Game.refs().filter((r) => r.unit.heroId === id).reduce((n, r) => n + 3 ** (r.unit.star - 1), 0);
      const utility = this.buyScore(slot);
      buys.push({ id: `buy:${slot}`, utility, description: `围绕${TRAITS[plan?.primary]?.name || "当前"}阵容购买 ${h.name}（${h.cost}费，${h.traits.map((t) => TRAITS[t].name).join("/")}，当前等价持有${owned}张）；${hint.star ? `立即合成${hint.star}星` : hint.pair ? "补充对子" : plan?.heroes.includes(id) ? "计划内英雄" : "过渡英雄"}；${this.economyImpact(price)}` });
    });
    actions.push(...buys.sort((a, b) => b.utility - a.utility).slice(0, 3));
    if (G.gold >= 4 && G.level < this.targetLevel() && G.gold - 4 >= this.goldFloor())
      actions.push({ id: "xp", utility: 58, description: `按计划提升人口：当前${G.level}级，目标${this.targetLevel()}级；${this.economyImpact(4)}` });
    if (G.gold >= 2 && this.shouldReroll())
      actions.push({ id: "reroll", utility: G.hp <= 35 ? 78 : 48, description: `围绕${TRAITS[plan?.primary]?.name || "核心"}阵容刷新商店；当前经济底线${this.goldFloor()}；${this.economyImpact(2)}` });
    if (G.bench.some(Boolean) && Object.keys(G.board).length < Game.capacity())
      actions.push({ id: "deploy", utility: 200, description: `立即补满上阵人口；当前场上${Object.keys(G.board).length}/${Game.capacity()}` });
    const boardRefs = Game.refs().filter((r) => r.loc.type === "board");
    if (this.swapRound !== this.roundKey()) actions.push(...this.bestSwapActions());
    G.items.slice(0, 2).forEach((id, itemSlot) => { const action = this.bestEquipAction(itemSlot); if (action) actions.push(action); });
    if (!G.bench.includes(null)) {
      const sell = Game.refs().filter((r) => r.loc.type === "bench" && !plan?.heroes.includes(r.unit.heroId))
        .sort((a, b) => Game.strength(a.unit) - Game.strength(b.unit))[0];
      if (sell) actions.push({ id: `sell:${sell.loc.idx}`, utility: 65, description: `出售计划外的 ${HEROES[sell.unit.heroId].name}，腾出备战席并回收${Game.sellPrice(sell.unit)}金币` });
    }
    if (boardRefs.length > 1 && this.formationRound !== this.roundKey()) {
      actions.push({ id: "formation:standard", utility: 20, description: `按计划采用标准前后排：主坦${plan?.tank ? HEROES[plan.tank].name : "近战"}顶前，主C${plan?.carry ? HEROES[plan.carry].name : "远程"}沉底受保护` });
    }
    if (this.readyAllowed(actions)) actions.push({ id: "ready", utility: 1, description: `计划检查完成：阵容已补满、无紧急升级或装备操作，保留${this.goldFloor()}金币底线并准备开战` });
    return actions.sort((a, b) => (b.utility || 0) - (a.utility || 0)).slice(0, 14);
  },

  findByUid(uid) {
    return Game.refs().find((r) => r.unit.uid === Number(uid));
  },

  arrangeFormation(style) {
    if (G.phase !== "prep") return false;
    const units = Object.values(G.board).sort((a, b) =>
      HEROES[a.heroId].range - HEROES[b.heroId].range || Game.strength(b) - Game.strength(a));
    if (!units.length) return false;
    const layouts = {
      standard: ["3,4", "2,4", "4,4", "1,5", "5,5", "3,7", "2,7", "4,7", "1,7"],
      left: ["1,4", "2,4", "0,5", "3,5", "1,6", "0,7", "1,7", "2,7", "3,7"],
      right: ["5,4", "4,4", "6,5", "3,5", "5,6", "6,7", "5,7", "4,7", "3,7"],
      spread: ["0,4", "3,4", "6,4", "1,5", "5,5", "0,7", "2,7", "4,7", "6,7"],
    };
    const positions = layouts[style] || layouts.standard;
    G.board = Object.fromEntries(units.map((unit, index) => [positions[index] || `${index % 7},6`, unit]));
    this.formationRound = this.roundKey();
    UI.render();
    Game.save();
    return true;
  },

  apply(id) {
    const [kind, a, b] = id.split(":");
    if (kind === "carousel") return Game.chooseCarousel(Number(a));
    if (G.phase !== "prep") return false;
    if (kind === "collect") return Game.collectLoot();
    if (kind === "buy" && this.canBuy(Number(a))) return Game.buy(Number(a));
    if (kind === "xp" && G.gold >= 4) return Game.buyXp();
    if (kind === "reroll" && G.gold >= 2) return Game.rollShop();
    if (kind === "deploy") { Game.autoDeploy(); Game.save(); return true; }
    if (kind === "sell") return Game.sell({ type: "bench", idx: Number(a) });
    if (kind === "swap") {
      const target = this.findByUid(b);
      const moved = target?.loc.type === "board" && Game.move({ type: "bench", idx: Number(a) }, target.loc);
      if (moved) this.swapRound = this.roundKey();
      return moved;
    }
    if (kind === "equip") {
      const target = this.findByUid(b);
      return target ? Game.equip(Number(a), target.loc) : false;
    }
    if (kind === "formation") return this.arrangeFormation(a);
    if (kind === "ready" || kind === "wait") {
      Game.autoDeploy();
      return Game.startBattle();
    }
    return false;
  },

  async tick() {
    if (!this.enabled || this.busy || !G) return;
    if (G.phase === "over") {
      this.status(`Jev 完成对局 · 第 ${G.rank} 名`, "done");
      this.enabled = false;
      this.render();
      return;
    }
    if (G.paused) { G.paused = false; UI.renderPanels(); }
    if (G.phase === "combat") {
      this.status("Jev 观战中", "on");
      return this.schedule(1000);
    }
    if (G.phase === "prep" && G.prepLeft <= 6) {
      this.status("Jev 开始战斗", "on");
      Game.startBattle();
      return this.schedule(1000);
    }
    const roundKey = this.roundKey();
    if (this.decisionRound !== roundKey) {
      this.decisionRound = roundKey;
      this.decisions = 0;
      this.apiDecisions = 0;
      this.holdKey = null;
    }
    if (this.holdKey === roundKey) {
      this.status("Jev 保留经济 · 等待开战", "on");
      return this.schedule(1000);
    }
    if (this.decisions >= 12) {
      if (G.phase === "prep") Game.startBattle();
      return this.schedule(1000);
    }
    const actions = this.actions();
    if (actions.length === 1) {
      this.apply(actions[0].id);
      this.decisions++;
      return this.schedule(500);
    }
    if (actions.length < 2) return this.schedule(1000);
    const automatic = actions[0];
    if ((automatic.utility || 0) >= 150 || this.apiDecisions >= 3) {
      this.status(`战略执行：${automatic.description}`, "on");
      this.apply(automatic.id);
      this.decisions++;
      return this.schedule(350);
    }
    const before = this.fingerprint();
    this.busy = true;
    this.render();
    this.status(`Jev 正在判断 · ${actions.length} 个合法动作`, "thinking");
    try {
      const response = await fetch("/api/typesafe/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: this.state(), actions }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      if (!this.enabled || before !== this.fingerprint()) {
        this.status("状态已变化 · 已丢弃过期决策", "on");
      } else {
        const action = this.resolveAction(result, actions);
        if (!action) throw new Error("服务返回了未知动作");
        this.last = result;
        this.decisions++;
        this.apiDecisions++;
        const fallback = action.id !== result.action ? " · 战略兜底" : "";
        this.status(`Jev：${action.description} · ${Math.round(result.confidence * 100)}%${fallback}`, "on");
        this.apply(action.id);
      }
    } catch (error) {
      this.enabled = false;
      this.status(`Jev 已停止：${error.message}`, "error");
      UI.toast(`TypeSafe AI 已停止：${error.message}`);
    } finally {
      this.busy = false;
      this.render();
      this.schedule(650);
    }
  },
};

window.addEventListener("DOMContentLoaded", () => TypeSafeAI.init());
