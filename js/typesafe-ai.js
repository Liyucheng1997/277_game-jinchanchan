"use strict";

const TypeSafeAI = {
  enabled: false,
  busy: false,
  configured: null,
  localService: null,
  timer: null,
  decisions: 0,
  decisionRound: null,
  holdKey: null,
  formationRound: null,
  last: null,

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
    this.decisionRound = null;
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
    };
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
        return { id: `carousel:${slot}`, description: `选择 ${h.name}（${h.cost}费，${h.traits.map((t) => TRAITS[t].name).join("/")}），携带 ${ITEMS[choice.item].name}` };
      });
    }
    if (G.phase !== "prep") return [];
    const actions = [];
    if (G.loot) actions.push({ id: "collect", description: `领取待收集战利品：${G.loot.gold}金币和${G.loot.items.length}件装备` });
    G.shop.forEach((id, slot) => {
      if (!id || !this.canBuy(slot)) return;
      const h = HEROES[id], price = h.cost * (G.chosenOffer === slot ? 3 : 1), hint = Game.upgradeHint(id);
      const owned = Game.refs().filter((r) => r.unit.heroId === id).reduce((n, r) => n + 3 ** (r.unit.star - 1), 0);
      actions.push({ id: `buy:${slot}`, description: `购买 ${h.name}（${h.cost}费，${h.traits.map((t) => TRAITS[t].name).join("/")}，当前等价持有${owned}张）；${hint.star ? `立即合成${hint.star}星，强升级` : hint.pair ? "补充对子/追三星进度" : "新增阵容候选"}；${this.economyImpact(price)}` });
    });
    if (G.gold >= 4 && G.level < MAX_LEVEL)
      actions.push({ id: "xp", description: `购买4经验；当前${G.level}级 ${G.xp}/${XP_REQ[G.level]}，升级后可增加上阵人口并提高高费牌概率；${this.economyImpact(4)}` });
    if (G.gold >= 2)
      actions.push({ id: "reroll", description: `刷新五张商店牌，适合寻找对子升星、核心卡或紧急止血；${this.economyImpact(2)}` });
    if (G.bench.some(Boolean) && Object.keys(G.board).length < Game.capacity())
      actions.push({ id: "deploy", description: `补满上阵人口；当前场上${Object.keys(G.board).length}/${Game.capacity()}，会优先让近战站前、远程站后` });
    const boardRefs = Game.refs().filter((r) => r.loc.type === "board");
    G.bench.forEach((unit, slot) => {
      if (!unit) return;
      for (const ref of boardRefs) {
        const afterUnits = boardRefs.filter((x) => x.unit.uid !== ref.unit.uid).map((x) => x.unit).concat(unit);
        actions.push({ id: `swap:${slot}:${ref.unit.uid}`, description: `用备战席 ${HEROES[unit.heroId].name}${unit.star}星（强度${Game.strength(unit)}）替换场上 ${HEROES[ref.unit.heroId].name}${ref.unit.star}星（强度${Game.strength(ref.unit)}）；替换后羁绊：${this.traitSummary(afterUnits)}` });
      }
      if (!G.bench.includes(null) || G.gold < 2)
        actions.push({ id: `sell:${slot}`, description: `出售备战席 ${HEROES[unit.heroId].name}${unit.star}星，获得${Game.sellPrice(unit)}金币并腾出格子` });
    });
    const equipTargets = Game.refs().slice(0, 12);
    G.items.slice(0, 3).forEach((id, itemSlot) => {
      equipTargets.forEach((ref) => {
        if (ref.unit.items.length >= 3 || ref.unit.items.includes("2044")) return;
        actions.push({ id: `equip:${itemSlot}:${ref.unit.uid}`, description: `把 ${ITEMS[id].name}（${ITEMS[id].basic}；${ITEMS[id].desc}）给 ${HEROES[ref.unit.heroId].name}${ref.unit.star}星；职责${HEROES[ref.unit.heroId].range > 1 ? "后排输出/施法" : "前排/近战"}，技能${HEROES[ref.unit.heroId].skill.name}，现有装备：${ref.unit.items.map((x) => ITEMS[x].name).join("、") || "无"}` });
      });
    });
    if (boardRefs.length > 1 && this.formationRound !== this.roundKey()) {
      actions.push(
        { id: "formation:standard", description: "采用标准前后排：近战和坦克居中顶前，远程核心居中沉底；适合多数均衡对局" },
        { id: "formation:left", description: "采用左侧抱团：核心缩在左后角，前排在左前方保护；适合把伤害集中到单侧或保护脆弱核心" },
        { id: "formation:right", description: "采用右侧抱团：核心缩在右后角，前排在右前方保护；适合针对对手另一侧薄弱点" },
        { id: "formation:spread", description: "采用分散站位：弈子横向拉开，降低范围技能同时命中多人的风险" },
      );
    }
    actions.push({ id: "ready", description: "经营操作已经完成：先自动补满上阵人口，然后点击准备就绪并立即开战" });
    return actions.slice(0, 200);
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
      return target?.loc.type === "board" && Game.move({ type: "bench", idx: Number(a) }, target.loc);
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
      return this.schedule(500);
    }
    if (actions.length < 2) return this.schedule(1000);
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
        const action = actions.find((x) => x.id === result.action);
        if (!action) throw new Error("服务返回了未知动作");
        this.last = result;
        this.decisions++;
        this.status(`Jev：${action.description} · ${Math.round(result.confidence * 100)}%`, "on");
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
