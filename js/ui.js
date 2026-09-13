"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const make = (tag, cls, html = "") => {
  const d = document.createElement(tag);
  d.className = cls;
  d.innerHTML = html;
  return d;
};
const itemImage = (id) =>
  `<img src="${ITEMS[id].icon}" alt="${esc(ITEMS[id].name)}" draggable="false">`;
const UI = {
  selected: null,
  blocking: false,
  scout: null,
  damageTab: false,
  fx: [],
  combatEls: new Map(),
  scale: 1,
  drag: null,
  suppressClick: false,
  init() {
    const fit = () => {
      const scale = Math.min(innerWidth / 1600, innerHeight / 900);
      this.scale = scale;
      $("#app").style.transform = `scale(${scale})`;
      $("#app").style.left = (innerWidth - 1600 * scale) / 2 + "px";
      $("#app").style.top = (innerHeight - 900 * scale) / 2 + "px";
    };
    fit();
    window.addEventListener("resize", fit);
    this.ctx = $("#effects").getContext("2d");
    $("#arena").addEventListener("click", (e) => {
      if (this.suppressClick || this.selected || this.blocking || e.target.closest(".unit,#lootArea,button:not(.hex)")) return;
      this.walkToPointer(e);
    });
    $("#arena").addEventListener("contextmenu", (e) => {
      if (e.target.closest(".unit,button:not(.hex)")) return;
      e.preventDefault();
      this.walkToPointer(e);
    });
    for (const p of Hex.cells()) {
      const d = make("button", "hex " + (p.y >= 4 ? "player" : "enemy"));
      const pt = Hex.point(p.x, p.y);
      d.style.left = pt.x + "px";
      d.style.top = pt.y + "px";
      d.style.width = 65 + p.y * 2.1 + "px";
      d.setAttribute("aria-label", `棋盘 ${p.x + 1} 列 ${p.y + 1} 行`);
      if (p.y >= 4) {
        d.dataset.drop = JSON.stringify({ type: "board", key: Hex.key(p) });
        d.onclick = () => this.destination({ type: "board", key: Hex.key(p) });
      }
      $("#hexGrid").append(d);
    }
    for (let i = 0; i < 9; i++) {
      const d = make("div", "bench-slot");
      d.dataset.slot = i + 1;
      d.dataset.drop = JSON.stringify({ type: "bench", idx: i });
      d.onclick = (e) => {
        if (!e.target.closest(".unit"))
          this.destination({ type: "bench", idx: i });
      };
      $("#bench").append(d);
    }
    $("#btnXp").onclick = () => Game.buyXp();
    $("#btnRefresh").onclick = () => Game.rollShop();
    $("#btnFight").onclick = () => Game.startBattle();
    $("#btnAuto").onclick = () => {
      if (G.phase === "prep") {
        Game.autoDeploy();
        Game.save();
      }
    };
    $("#btnLock").onclick = () => Game.toggleLock();
    $("#btnMute").onclick = () => Game.toggleMute();
    $("#btnPause").onclick = () => Game.togglePause();
    $("#btnSpeed").onclick = () => {
      G.speed = G.speed === 1 ? 2 : 1;
      this.renderPanels();
    };
    $("#btnGuide").onclick = () => this.guide();
    $("#btnRecipes").onclick = () => this.recipes();
    $("#btnHeroes").onclick = () => this.catalog();
    $("#closeDialog").onclick = () => this.closeDialog();
    $("#dialog").onclick = (e) => {
      if (e.target === $("#dialog")) this.closeDialog();
    };
    $("#btnRestart").onclick = () =>
      this.dialog(
        "重新开局",
        '<p class="recipe-description">开始一场新的八人对局，当前对局进度将被替换。</p><button class="primary" id="confirmRestart">开始新对局</button>',
        () => ($("#confirmRestart").onclick = () => Game.newGame()),
      );
    $("#btnFullscreen").onclick = () => {
      const p = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      p?.catch(() => this.toast("当前窗口不支持全屏"));
    };
    $("#tabTraits").onclick = () => {
      this.damageTab = false;
      this.renderTraits();
    };
    $("#tabDamage").onclick = () => {
      this.damageTab = true;
      this.renderTraits();
    };
    $(".shop-dock").addEventListener("click", (e) => {
      if (this.suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    document.addEventListener("pointermove", (e) => this.pointerMove(e));
    document.addEventListener("pointerup", (e) => this.pointerUp(e));
    document.addEventListener("pointercancel", () => this.cancelDrag());
    window.addEventListener("blur", () => this.cancelDrag());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeDialog();
        this.selected = null;
        this.cancelDrag();
        this.syncSelection();
        return;
      }
      if (this.blocking) {
        if (e.key === "Tab") {
          const nodes = [
            ...$("#dialog").querySelectorAll("button,input,select,[tabindex]"),
          ].filter((n) => !n.disabled);
          const first = nodes[0],
            last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            last.focus();
            e.preventDefault();
          } else if (!e.shiftKey && document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
        return;
      }
      if (e.repeat || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "d") Game.rollShop();
      if (k === "f") Game.buyXp();
      if (k === "e" && this.selected && this.selected.type !== "item")
        Game.sell(this.selected);
      if (k === " ") {
        e.preventDefault();
        Game.startBattle();
      }
    });
  },
  render() {
    if (!G) return;
    this.cancelDrag();
    this.hideTip();
    this.renderPanels();
    this.renderShop();
    this.renderBench();
    this.renderItems();
    if (G.phase !== "combat") this.renderBoard();
    this.renderLoot();
    this.renderMascot();
    this.renderCarousel();
    this.renderEnd();
    this.syncSelection();
  },
  renderPanels() {
    if (!G) return;
    $("#roundLabel").textContent = roundName(G.round);
    $("#phaseLabel").textContent =
      G.phase === "over"
        ? "对局结束"
        : G.phase === "carousel"
          ? "共享选秀"
          : G.phase === "combat"
            ? "战斗环节"
            : "备战环节";
    const count = stageOf(G.round) === 1 ? 4 : 7;
    $("#roundTrack").innerHTML = Array.from(
      { length: count },
      (_, i) =>
        `<span class="round-node ${i + 1 === stepOf(G.round) ? "current" : i + 1 < stepOf(G.round) ? "past" : ""}">${(stageOf(G.round) === 1 && i === 0) || (stageOf(G.round) > 1 && i === 3) ? "◈" : stageOf(G.round) === 1 || i === 6 ? "♟" : "⚔"}</span>`,
    ).join("");
    $("#goldText").textContent = G.gold;
    $("#levelText").textContent = "等级 " + G.level;
    $("#xpText").textContent =
      G.level === 9 ? "MAX" : `${G.xp} / ${XP_REQ[G.level]}`;
    $("#xpFill").style.width =
      G.level === 9 ? "100%" : (G.xp / XP_REQ[G.level]) * 100 + "%";
    $("#interestDots").innerHTML = Array.from(
      { length: 5 },
      (_, i) => `<i class="${G.gold >= (i + 1) * 10 ? "on" : ""}"></i>`,
    ).join("");
    const interest = Math.min(5, Math.floor(G.gold / 10));
    $("#incomeText").textContent =
      `基础 +5   利息 +${interest}   连胜/败 ${G.streak ? Math.abs(G.streak) : "—"}`;
    $("#incomeText").title =
      `上回合收入：基础 ${G.income.base}，利息 ${G.income.interest}，连胜/败 ${G.income.streak}，胜利 ${G.income.win}`;
    $("#oddsText").innerHTML = ODDS[G.level]
      .map(
        (p, i) =>
          `<span style="color:${COST_COLORS[i + 1]}" title="${i + 1}费英雄概率">${p}%</span>`,
      )
      .join("");
    $("#btnLock").textContent = G.locked ? "◆ 已锁定" : "◇ 锁定";
    $("#btnLock").classList.toggle("on", G.locked);
    $("#btnMute").textContent = G.muted ? "♩" : "♪";
    $("#btnMute").style.opacity = G.muted ? ".4" : "1";
    $("#btnPause").textContent = G.paused ? "▶" : "Ⅱ";
    $("#btnPause").title = G.paused ? "继续计时" : "暂停";
    $("#btnSpeed").textContent = G.speed + "×";
    for (const id of ["btnXp", "btnRefresh", "btnLock"])
      $("#" + id).disabled = !Game.canManage();
    for (const id of ["btnFight", "btnAuto"])
      $("#" + id).disabled = G.phase !== "prep";
    if (G.level === 9) $("#btnXp").disabled = true;
    $("#btnFight").innerHTML =
      G.phase === "combat"
        ? "<span>战斗中</span><small>AUTO BATTLE</small>"
        : G.phase === "carousel"
          ? "<span>选择弈子</span><small>CAROUSEL</small>"
          : "<span>准备就绪</span><small>SPACE</small>";
    $("#population").innerHTML =
      `${Object.keys(G.board).length}<span> / ${Game.capacity()}</span>`;
    $("#benchCount").textContent = G.bench.filter(Boolean).length + " / 9";
    $("#opponentTag").innerHTML =
      G.phase === "carousel"
        ? "◈ 共享选秀 · 选择携带装备的英雄"
        : roundType(G.round) === "pve"
          ? `<i></i>野怪回合 · ${creepWave(G.round)[0] ? CREEPS[creepWave(G.round)[0].creepId].name : ""}`
          : `<i></i>${esc(G.bots.find((b) => b.id === G.opponent)?.name || "等待对手")} <span style="color:#749081">· 对手棋盘</span>`;
    $("#saveStatus").textContent = G.paused ? "对局已暂停" : "对局自动保存";
    this.updateTimer();
    this.renderPlayers();
    this.renderTraits();
    $("#history").innerHTML = G.history
      .map(
        (h) =>
          `<i class="history-dot ${h.win ? "" : "loss"}" title="${h.round} ${h.win ? "胜利" : "失利"}"></i>`,
      )
      .join("");
  },
  updateTimer() {
    if (!G) return;
    const text = G.paused
      ? "Ⅱ"
      : G.phase === "prep"
        ? Math.max(0, Math.ceil(G.prepLeft))
        : G.phase === "combat"
          ? Math.max(0, Math.ceil(60 - (Game.engine?.time || 0)))
          : "∞";
    $("#timer").textContent = text;
    $("#timer").classList.toggle(
      "urgent",
      G.phase === "prep" && G.prepLeft < 10,
    );
  },
  renderPlayers() {
    const arr = [
      { name: "你", id: -1, hp: G.hp, level: G.level },
      ...G.bots,
    ].sort((a, b) => b.hp - a.hp);
    $("#aliveCount").textContent = arr.filter((p) => p.hp > 0).length + " / 8";
    $("#players").innerHTML = "";
    arr.forEach((p, i) => {
      const d = make(
        "button",
        "player-row" +
          (p.id === -1 ? " me" : "") +
          (p.id === G.opponent ? " target" : "") +
          (p.hp <= 0 ? " eliminated" : ""),
      );
      d.innerHTML = `<span class="player-position">${i + 1}</span><img class="avatar" src="${OFFICIAL.mascots[(p.id + 1) % OFFICIAL.mascots.length]}" alt=""><div class="player-details"><div class="player-name">${esc(p.name)}</div><div class="player-sub">${p.id === -1 ? "你的棋盘" : p.id === G.opponent ? "本回合对手" : "电脑弈士"} · ${p.level}级</div></div><b class="player-hp">${p.hp}</b><i class="health-line" style="width:${p.hp}%"></i>`;
      d.onclick = () => {
        this.scout = this.scout === p.id ? null : p.id;
        this.renderScout();
      };
      $("#players").append(d);
    });
    this.renderScout();
  },
  renderScout() {
    const panel = $("#scoutPanel");
    if (this.scout === null || this.scout === -1) {
      panel.hidden = true;
      return;
    }
    const bot = G.bots.find((b) => b.id === this.scout);
    if (!bot) return;
    panel.hidden = false;
    panel.innerHTML = `<div class="scout-title">${esc(bot.name)} · 阵容</div><div class="scout-units">${Game.botArmy(
      bot,
    )
      .map(
        (u) =>
          `<img src="${HEROES[u.heroId].portrait}" title="${esc(HEROES[u.heroId].name)} ${"★".repeat(u.star)}" alt="${esc(HEROES[u.heroId].name)}">`,
      )
      .join("")}</div><div class="scout-tip">点击排名中的弈士可查看阵容</div>`;
  },
  renderTraits() {
    const traits = $("#synergyList"),
      damage = $("#damageList");
    traits.hidden = this.damageTab;
    damage.hidden = !this.damageTab;
    $("#tabTraits").classList.toggle("active", !this.damageTab);
    $("#tabDamage").classList.toggle("active", this.damageTab);
    if (this.damageTab) {
      this.renderDamage();
      return;
    }
    traits.innerHTML = "";
    const cnt = traitCounts(Object.values(G.board)),
      entries = Object.entries(cnt).sort(
        (a, b) => !!tierOf(b[0], b[1]) - !!tierOf(a[0], a[1]) || b[1] - a[1],
      );
    if (!entries.length) {
      traits.innerHTML =
        '<div class="empty-traits"><strong>◈</strong>将英雄放入棋盘<br>激活阵容羁绊</div>';
      return;
    }
    for (const [id, n] of entries) {
      const t = TRAITS[id],
        tier = tierOf(id, n),
        next = t.thresholds.find((x) => x > n) || t.thresholds.at(-1);
      const d = make(
        "div",
        "trait-row" + (tier ? " active" : ""),
        `<span class="trait-icon"><img src="${t.icon}" alt=""></span><span class="trait-name">${t.name}</span><span class="trait-count">${n}<span> / ${next}</span></span>`,
      );
      const content = () =>
          `<div class="tip-title"><img src="${t.icon}"><div>${t.name}<small>${n} 名不同英雄 · ${t.thresholds.join(" / ")}</small></div></div><p>${esc(t.desc)}</p>${t.effects.map((text, i) => `<p style="color:${i < tier ? "#e2ce8d" : "#829a8a"}">${esc(text)}</p>`).join("")}${this.traitHeroes(id)}`;
      this.tip(d, content);
      d.tabIndex = 0;
      d.setAttribute("role", "button");
      d.onclick = () => this.dialog(t.name + " · 羁绊英雄", content());
      d.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d.click(); } };
      traits.append(d);
    }
  },
  traitHeroes(id) {
    const board = new Set(Object.values(G.board).map(u => u.heroId));
    const bench = new Set(G.bench.filter(Boolean).map(u => u.heroId));
    return `<div class="trait-heroes"><h4>同羁绊英雄</h4><div class="trait-hero-grid">${Object.values(HEROES)
      .filter(h => h.traits.includes(id)).sort((a, b) => a.cost - b.cost)
      .map(h => `<div class="trait-hero ${board.has(h.id) ? "deployed" : ""}"><img src="${h.portrait}" alt="${h.name}" style="border-color:${COST_COLORS[h.cost]}"><span>${h.name}</span><small>${h.cost}费 · ${board.has(h.id) ? "已上阵" : bench.has(h.id) ? "备战席" : "未拥有"}</small></div>`).join("")}</div></div>`;
  },
  renderDamage(engine = Game.engine) {
    const data =
      G.phase === "combat" && engine
        ? engine.units
            .filter((u) => u.side === 0 && u.heroId)
            .map((u) => ({ heroId: u.heroId, damage: u.damage }))
            .sort((a, b) => b.damage - a.damage)
        : G.lastDamage || [];
    const max = Math.max(1, ...data.map((u) => u.damage));
    $("#damageList").innerHTML = data.length
      ? data
          .map(
            (u) =>
              `<div class="damage-row"><img src="${HEROES[u.heroId].portrait}"><div class="damage-main">${HEROES[u.heroId].name}<span>${Math.round(u.damage)}</span><div class="damage-bar"><i style="width:${(u.damage / max) * 100}%"></i></div></div></div>`,
          )
          .join("")
      : '<div class="empty-traits"><strong>⚔</strong>战斗后显示伤害统计</div>';
  },
  renderShop() {
    const shop = $("#shop");
    shop.innerHTML = "";
    for (const [i, id] of G.shop.entries()) {
      if (!id) {
        shop.append(
          make(
            "div",
            "shop-empty",
            "<b>◈</b><span>" +
              (G.phase === "carousel" ? "选秀后开启" : "已招募") +
              "</span>",
          ),
        );
        continue;
      }
      const h = HEROES[id], hint = Game.upgradeHint(id), owned = hint.owned;
      const d = make("button", "shop-card" + (G.gold < h.cost ? " poor" : "") + (hint.star ? " can-upgrade" : owned ? " is-owned" : ""));
      d.style.setProperty("--cost", COST_COLORS[h.cost]);
      d.setAttribute("aria-label", `购买 ${h.name} ${h.cost}金币`);
      d.disabled = !Game.canManage();
      d.innerHTML = `<img class="shop-art" src="${h.splash}" draggable="false" alt="${h.name}"><div class="shop-traits">${h.traits.map((t) => `<span><img src="${TRAITS[t].icon}">${TRAITS[t].name}</span>`).join("")}</div><div class="shop-name">${h.name}</div><div class="shop-cost">◉ ${h.cost}</div>${owned ? `<span class="shop-owned">已拥有 ${owned}</span>` : ""}`;
      d.onclick = () => Game.buy(i);
      if (hint.star || hint.shopMerge) d.append(make("span", "upgrade-badge", hint.star ? `买入升 ${hint.star} 星` : "同店凑齐可升星"));
      d.setAttribute("aria-label", `购买 ${h.name} ${h.cost}金币${hint.star ? `，买入升${hint.star}星` : owned ? `，已拥有${owned}张` : ""}`);
      this.tip(d, () => this.heroTip(h, 1));
      shop.append(d);
    }
  },
  renderBench() {
    [...$("#bench").children].forEach((s, i) => {
      s.innerHTML = "";
      const u = G.bench[i];
      if (u) s.append(this.unitEl(u, { type: "bench", idx: i }));
    });
  },
  unitEl(u, loc = null, side = 0) {
    const h = u.heroId ? HEROES[u.heroId] : CREEPS[u.creepId],
      d = make(
        "div",
        `unit star${u.star || 1} ${side ? "enemy" : ""} ${u.creepId ? "monster " + u.creepId : ""}`,
      );
    d.style.setProperty("--cost", COST_COLORS[h.cost || 0]);
    d.dataset.uid = u.uid || u.fid || "";
    d.setAttribute("aria-label", h.name);
    d.tabIndex = loc ? 0 : -1;
    d.innerHTML = `<div class="unit-base"></div>${u.heroId ? `<img class="unit-portrait" src="${h.portrait}" draggable="false" alt="${h.name}">` : this.monsterArt(u.creepId)}<div class="unit-stars">${u.heroId ? "★".repeat(u.star || 1) : ""}</div><div class="unit-bars"><div class="unit-health"></div><div class="unit-mana"></div></div><div class="unit-name">${h.name}</div><div class="unit-equips">${(u.items || []).map(itemImage).join("")}</div>`;
    if (loc && u.star < 3 && Game.refs().filter((r) => r.unit.heroId === u.heroId && r.unit.star === u.star).length >= 2) {
      d.classList.add("has-pair");
      d.append(make("span", "unit-pair", "对子"));
    }
    if (loc) {
      d.dataset.drop = JSON.stringify(loc);
      d.dataset.loc = JSON.stringify(loc);
      d.onpointerdown = (e) => this.pointerDown(e, loc, d);
      d.onclick = (e) => {
        e.stopPropagation();
        if (this.suppressClick) return;
        if (!Game.canEdit(loc)) return;
        if (this.selected) {
          if (
            this.selected.type === "item" ||
            JSON.stringify(this.selected) !== JSON.stringify(loc)
          ) {
            this.destination(loc);
            return;
          }
        }
        this.selected =
          JSON.stringify(this.selected) === JSON.stringify(loc) ? null : loc;
        this.syncSelection();
      };
      d.onkeydown = (e) => {
        if (e.key === "Enter") {
          this.selected = loc;
          this.syncSelection();
        }
      };
      d.oncontextmenu = (e) => {
        e.preventDefault();
        this.heroDetail(u.heroId, u.star, u);
      };
      this.tip(d, () => this.equipPreviewTip(this.selected, loc) || this.heroTip(h, u.star, u.items, u));
    } else if (u.heroId) this.tip(d, () => this.heroTip(h, u.star, u.items, u));
    return d;
  },
  monsterArt(id) {
    if (id === "wolf")
      return '<img class="monster-image" src="assets/heroes/wolf.png" alt="暗影狼">';
    if (["krug", "golem", "herald"].includes(id))
      return '<img class="monster-image" src="assets/heroes/golem.png" alt="魔像">';
    if (id === "dragon")
      return '<img class="monster-image" src="assets/heroes/binglong.png" alt="亚龙">';
    return `<span class="monster-symbol" style="--monster:${CREEPS[id].color}">${id === "caster" ? "♝" : id === "raptor" ? "♞" : id === "spider" ? "✣" : "♟"}</span>`;
  },
  renderBoard() {
    const layer = $("#unitLayer");
    layer.innerHTML = "";
    this.fx = [];
    this.ctx.clearRect(0, 0, 1250, 740);
    $("#app").classList.remove("combat-active");
    for (const [key, u] of Object.entries(G.board)) {
      const [x, y] = key.split(",").map(Number),
        p = Hex.point(x, y),
        d = this.unitEl(u, { type: "board", key });
      d.style.left = p.x + "px";
      d.style.top = p.y + "px";
      d.style.zIndex = 5 + y;
      layer.append(d);
    }
    if (G.phase === "prep") {
      const preview = new CombatEngine([], Game.preview(), { visual: false });
      for (const u of preview.units) {
        const p = Hex.point(u.x, u.y),
          d = this.unitEl(u, null, 1);
        d.classList.add("preview");
        d.style.left = p.x + "px";
        d.style.top = p.y + "px";
        d.style.zIndex = 5 + u.y;
        layer.append(d);
      }
    }
    this.renderMascot();
    this.renderLoot();
  },
  walkToPointer(e) {
    const rect = $("#arena").getBoundingClientRect();
    Game.moveMascot((e.clientX - rect.left) / this.scale, (e.clientY - rect.top) / this.scale);
  },
  renderMascot() {
    const node = $("#mascot"), m = G.mascot || { x: 202, y: 497 };
    if (!node.firstChild) node.innerHTML = `<img src="${OFFICIAL.mascots[0]}" alt="小小英雄"><span class="mascot-name"></span>`;
    node.querySelector(".mascot-name").textContent = `你 · ${G.hp}`;
    node.style.left = m.x - 34 + "px";
    node.style.top = m.y - 68 + "px";
    node.classList.toggle("walking", !!m.target);
  },
  renderLoot() {
    $("#lootArea").innerHTML = G.loot
      ? '<button class="loot-orb" id="collectOrb" aria-label="走过去拾取金币和装备">✦</button><span class="loot-label">点击前往 · 靠近拾取金币和装备</span>'
      : "";
    if (G.loot) $("#collectOrb").onclick = () => Game.moveMascot(871, 449);
  },
  renderItems() {
    const bar = $("#itemBar");
    bar.innerHTML = "";
    G.items.forEach((id, i) => {
      const d = make("button", "item-slot", itemImage(id));
      d.setAttribute("aria-label", ITEMS[id].name);
      d.dataset.drop = JSON.stringify({ type: "inventory", idx: i });
      d.dataset.loc = JSON.stringify({ type: "item", idx: i });
      d.onpointerdown = (e) => this.pointerDown(e, { type: "item", idx: i }, d);
      d.onclick = () => {
        if (this.suppressClick || !Game.canManage()) return;
        if (this.selected?.type === "item" && this.selected.idx !== i) {
          Game.craft(this.selected.idx, i);
          return;
        }
        this.selected =
          this.selected?.type === "item" && this.selected.idx === i
            ? null
            : { type: "item", idx: i };
        this.syncSelection();
      };
      this.tip(d, () => this.equipPreviewTip(this.selected, { type: "inventory", idx: i }) || this.itemTip(id));
      bar.append(d);
    });
    for (let i = G.items.length; i < 8; i++)
      bar.append(
        make("div", "item-slot empty", i === G.items.length ? "+" : ""),
      );
    bar.append(make("div", "equipment-hint", "拖动悬停预览 · 松手合成 · Esc 取消"));
    $("#rewardsInfo").textContent = G.rewards.length
      ? `奖励暂存 ${G.rewards.length} 位英雄 · 腾出备战席后领取`
      : "";
  },
  destination(dst) {
    if (this.suppressClick || !this.selected) return;
    if (dst.type === "sell") {
      if (this.selected.type !== "item") Game.sell(this.selected);
    } else if (dst.type === "inventory" && this.selected.type === "item")
      Game.craft(this.selected.idx, dst.idx);
    else Game.move(this.selected, dst);
  },
  syncSelection() {
    const selecting = !!this.selected;
    $("#app").classList.toggle("selecting", selecting);
    document
      .querySelectorAll("[data-loc]")
      .forEach((d) =>
        d.classList.toggle(
          "selected",
          JSON.stringify(this.selected) === d.dataset.loc,
        ),
      );
    $("#interactionHint").textContent =
      this.selected?.type === "item"
        ? "选择英雄装备，或选择另一个小件合成"
        : selecting
          ? "点击目标格移动 · E 或拖到招募栏出售 · Esc 取消"
          : G.phase === "combat" ? "战斗中可买牌、D 刷新、F 升级 · 升星下场生效" : "点击空地移动小精灵 · 靠近法球拾取 · 拖动英雄上阵";
  },
  pointerDown(e, src, node) {
    if (e.button !== 0 || !Game.canEdit(src)) return;
    this.drag = {
      src,
      node,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      pointer: e.pointerId,
    };
  },
  pointerMove(e) {
    if (!this.drag) return;
    const d = this.drag;
    if (
      !d.active &&
      Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6
    ) {
      d.active = true;
      this.hideTip();
      $("#app").classList.add("dragging");
      d.node.classList.add("drag-origin");
      const u = Game.get(d.src),
        img =
          d.src.type === "item"
            ? ITEMS[G.items[d.src.idx]]?.icon
            : u
              ? HEROES[u.heroId].portrait
              : null;
      if (u && d.src.type !== "item") {
        const sell = $("#shopSellZone");
        sell.innerHTML = `<span class="sell-drag-title">松手出售英雄</span><strong>${esc(HEROES[u.heroId].name)} <span>${"★".repeat(u.star)}</span></strong><b>＋${Game.sellPrice(u)} 金币</b><small>${u.items.length ? "装备将返还装备区 · " : ""}移出招募栏或按 Esc 取消</small>`;
        sell.hidden = false;
        $(".shop-dock").classList.add("selling");
        $(".shop-dock").dataset.drop = JSON.stringify({ type: "sell" });
      }
      d.ghost = make("div", "pointer-ghost", img ? `<img src="${img}">` : "");
      document.body.append(d.ghost);
    }
    if (d.active) {
      e.preventDefault();
      d.ghost.style.left = e.clientX + "px";
      d.ghost.style.top = e.clientY + "px";
      document
        .querySelectorAll(".drop")
        .forEach((x) => x.classList.remove("drop"));
      document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-drop]")
        ?.classList.add("drop");
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop]");
      const preview = target && this.equipPreviewTip(d.src, JSON.parse(target.dataset.drop));
      if (preview) this.showTip(e, preview);
      else this.hideTip();
    }
  },
  pointerUp(e) {
    const d = this.drag;
    if (!d) return;
    if (d.active) {
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-drop]");
      if (target) {
        const dst = JSON.parse(target.dataset.drop);
        if (dst.type === "sell" && d.src.type !== "item") Game.sell(d.src);
        else if (dst.type === "inventory" && d.src.type === "item")
          Game.craft(d.src.idx, dst.idx);
        else if (["bench", "board"].includes(dst.type)) Game.move(d.src, dst);
      }
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
    }
    this.cancelDrag();
  },
  cancelDrag() {
    this.hideTip();
    const dock = $(".shop-dock");
    dock.classList.remove("selling");
    delete dock.dataset.drop;
    $("#shopSellZone").hidden = true;
    $("#shopSellZone").innerHTML = "";
    if (this.drag) {
      this.drag.node.classList.remove("drag-origin");
      this.drag.ghost?.remove();
      this.drag = null;
    }
    $("#app")?.classList.remove("dragging");
    document
      .querySelectorAll(".drop")
      .forEach((x) => x.classList.remove("drop"));
  },
  renderCarousel() {
    const panel = $("#carousel");
    panel.hidden = G.phase !== "carousel";
    if (panel.hidden) return;
    panel.innerHTML = `<div class="carousel-heading"><span class="eyebrow">THE CONVERGENCE</span><h1>共享选秀</h1><p>${G.round === 0 ? "从一位英雄开始，组建属于你的阵容" : "血量较低的弈士优先选取 · 灰色英雄已被带走"}</p></div><div class="carousel-ring"></div><div class="carousel-center">选择你的弈子</div><div class="carousel-footer">点击英雄带回棋盘 · 英雄携带的装备会一同获得</div>`;
    G.carousel.forEach((c, i) => {
      const h = HEROES[c.heroId],
        angle = (i / G.carousel.length) * Math.PI * 2 - Math.PI / 2;
      const d = make("button", "carousel-card" + (c.taken ? " taken" : ""));
      d.style.setProperty("--cost", COST_COLORS[h.cost]);
      d.style.left = 570 + Math.cos(angle) * 365 + "px";
      d.style.top = 310 + Math.sin(angle) * 145 + "px";
      d.disabled = c.taken;
      d.innerHTML = `<img class="carousel-portrait" src="${h.portrait}" alt="${h.name}"><img class="carousel-item" src="${ITEMS[c.item].icon}" alt="${ITEMS[c.item].name}"><strong>${h.name}</strong><small>${c.taken ? esc(c.owner) : ITEMS[c.item].name}</small>`;
      d.onclick = () => Game.chooseCarousel(i);
      this.tip(d, () => this.heroTip(h, 1, [c.item]));
      panel.append(d);
    });
  },
  renderEnd() {
    const panel = $("#endScreen");
    panel.hidden = G.phase !== "over";
    if (panel.hidden) return;
    panel.innerHTML = `<div class="end-content"><span class="eyebrow">对局结束</span><div class="rank-number">#${G.rank}</div><h1>${G.rank === 1 ? "大吉大利，今晚吃鸡" : "下一局，再战"}</h1><p>本局抵达 ${roundName(G.round)} · ${G.history.filter((h) => h.win).length} 场近期胜利</p><button class="primary" id="again">再来一局</button></div>`;
    $("#again").onclick = () => Game.newGame();
  },
  heroStats(def, unit = null) {
    if (unit?.fid && unit.maxHp !== undefined) return unit;
    const board = Game.boardSpecs();
    const index = unit ? board.findIndex(s => s.uid === unit.uid) : -1;
    if (index >= 0) {
      const live = G.phase === "combat" && Game.engine?.units.find(s => s.side === 0 && s.uid === unit.uid);
      if (live && def.star === unit.star) return live;
      board[index] = { ...board[index], ...def };
      return new CombatEngine(board, [], { visual: false, rng: () => 0.5 }).units[index];
    }
    return new CombatEngine([], [], { visual: false, rng: () => 0.5 }).make(def, 0, { x: 3, y: 4 });
  },
  heroTip(h, star = 1, items = [], unit = null) {
    const def = { heroId: h.id, star, items },
      stats = this.heroStats(def, unit),
      base = new CombatEngine([], [], { visual: false, rng: () => 0.5 }).make({ ...def, items: [] }, 0, { x: 3, y: 4 });
    const value = (label, current, original, digits = 0) => {
      const delta = current - original;
      return `<span><em>${label}</em>${current.toFixed(digits)}${Math.abs(delta) >= 0.5 * 10 ** -digits ? `<small class="stat-bonus"> (${delta > 0 ? "+" : ""}${delta.toFixed(digits)})</small>` : ""}</span>`;
    };
    const fields = [["生命", stats.maxHp, base.maxHp], ["攻击", stats.atk, base.atk],
      ["攻速", stats.as * (1 + stats.asBonus), base.as, 2], ["护甲", stats.armor, base.armor],
      ["魔抗", stats.mr, base.mr], ["法强", stats.ap * 100, 100],
      ["暴击率 %", stats.crit * 100, base.crit * 100], ["暴击伤害 %", stats.critD * 100, base.critD * 100],
      ["增伤 %", stats.amp * 100, 0], ["格挡", stats.block || 0, 0], ["射程", stats.range, base.range],
      ["吸血 %", stats.vamp * 100, 0], ["减伤 %", stats.reduce * 100, 0],
      ["法力回复", stats.regen, 0], ["护盾", stats.effects.filter(e => e.type === "shield" && e.t > 0).reduce((n, e) => n + e.value, 0), 0]];
    const onBoard = unit && Game.boardSpecs().some(s => s.uid === unit.uid);
    const live = G.phase === "combat" && (unit?.fid || (onBoard && star === unit.star));
    return `<div class="tip-title"><img src="${h.portrait}"><div>${h.name} <span style="font-size:12px;color:${COST_COLORS[h.cost]}">${"★".repeat(star)}</span><small>${unitTraits(def).map((t) => TRAITS[t].name).join(" · ")}　◉ ${h.cost}</small></div></div><div class="tip-stats">${fields.map(f => value(...f)).join("")}</div><div class="tip-skill"><h4>${h.skill.icon ? `<img src="${h.skill.icon}">` : ""}${h.skill.name || "选牌"} <span style="margin-left:auto;color:#73c9d1;font-size:10px">${Math.round(stats.mana)}/${stats.manaMax}</span></h4>${skillDesc(h, star)}</div>${items.length ? `<div class="tip-recipe">${items.map(itemImage).join("")}</div>` : ""}<div class="tip-note">${live ? "战斗属性（查看时）" : onBoard ? "上阵属性：含装备、羁绊及站位加成" : unit ? "备战席属性：含装备，上阵后计算羁绊" : "图鉴基础属性"} · 括号为相对当前星级基础值的加成。触发型效果在战斗中生效；人口升级不直接增加棋子属性。</div>`;
  },
  itemTip(id) {
    const i = ITEMS[id];
    return `<div class="tip-title">${itemImage(id)}<div>${i.name}<small>${i.recipe.length ? "合成装备" : "基础装备"}</small></div></div><p style="color:#e2cc91">${esc(i.basic)}</p><p>${esc(i.desc)}</p>${i.recipe.length ? `<div class="tip-recipe">${itemImage(i.recipe[0])} + ${itemImage(i.recipe[1])}</div>` : '<div class="tip-note">拖给英雄佩戴，或与另一件基础装备合成。</div>'}`;
  },
  equipPreviewTip(src, dst) {
    if (src?.type !== "item" || !Game.canManage()) return null;
    const id = G.items[src.idx];
    if (!id) return null;
    if (dst.type === "inventory") {
      if (src.idx === dst.idx) return null;
      const result = Game.craftPreview(src.idx, dst.idx);
      return result ? `<div class="craft-preview-title">合成预览 · 松手或点击合成</div>${this.itemTip(result)}` : '<div class="craft-preview-title">这两件装备不能合成</div>';
    }
    if (!["board", "bench"].includes(dst.type)) return null;
    if (!Game.canEdit(dst)) return '<div class="craft-preview-title">战斗中请在备战席装备，或等待战斗结束</div>';
    const unit = Game.get(dst);
    if (!unit) return null;
    const copy = { ...unit, items: [...unit.items] };
    if (!Game.equipOn(copy, id, false)) return '<div class="craft-preview-title">无法装备：装备格已满或羁绊重复</div>';
    const changed = copy.items.find((item, i) => unit.items[i] !== item) || id;
    return `<div class="craft-preview-title">${changed !== id ? "合成预览" : "装备预览"} · ${HEROES[unit.heroId].name}</div>${this.itemTip(changed)}`;
  },
  tip(node, html) {
    node.addEventListener("mouseenter", (e) => {
      if (this.drag?.active) return;
      this.showTip(e, html(), node);
    });
    node.addEventListener("mousemove", (e) => this.moveTip(e));
    node.addEventListener("mouseleave", () => this.hideTip());
    node.addEventListener("pointerdown", () => this.hideTip());
  },
  showTip(e, html, anchor = null) {
    const tip = $("#tooltip");
    this.tipAnchor = anchor;
    tip.innerHTML = html;
    tip.style.display = "block";
    this.moveTip(e);
  },
  moveTip(e) {
    const tip = $("#tooltip");
    if (tip.style.display !== "block") return;
    const r = tip.getBoundingClientRect();
    const anchor = this.tipAnchor;
    const panel = anchor?.closest(".left-sidebar, .right-sidebar");
    const gap = 12;
    let x = e.clientX + 18, y = e.clientY + 18;
    if (panel) {
      const p = panel.getBoundingClientRect(), a = anchor.getBoundingClientRect();
      x = panel.classList.contains("left-sidebar") ? p.right + gap : p.left - r.width - gap;
      y = a.top;
    } else if (anchor?.closest(".shop-dock")) {
      const a = anchor.getBoundingClientRect();
      x = a.left;
      y = a.top - r.height - gap;
    } else {
      if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 18;
      if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 18;
    }
    tip.style.left =
      Math.max(6, Math.min(innerWidth - r.width - 8, x)) + "px";
    tip.style.top =
      Math.max(6, Math.min(innerHeight - r.height - 8, y)) + "px";
  },
  hideTip() {
    this.tipAnchor = null;
    $("#tooltip").style.display = "none";
  },
  toast(text) {
    const d = make("div", "toast", esc(text));
    $("#toastWrap").append(d);
    while ($("#toastWrap").children.length > 4)
      $("#toastWrap").firstChild.remove();
    setTimeout(() => {
      d.classList.add("exit");
      setTimeout(() => d.remove(), 300);
    }, 2300);
  },
  dialog(title, body, after) {
    this.hideTip();
    this.blocking = true;
    this.previousFocus = document.activeElement;
    $("#dialog").hidden = false;
    $("#dialogTitle").textContent = title;
    $("#dialogBody").innerHTML = body;
    after?.();
    $("#closeDialog").focus();
  },
  closeDialog() {
    this.blocking = false;
    $("#dialog").hidden = true;
    this.previousFocus?.focus?.();
    this.previousFocus = null;
  },
  guide() {
    this.dialog(
      "玩法指南",
      `<div class="guide-grid"><article><h3>01 · 招募与站位</h3><p>商店招募英雄，拖到棋盘下半区上阵。也可以先点英雄，再点目标格。前排承伤、后排输出；上阵人数由等级决定。三个相同星级英雄自动合成更高星级。</p></article><article><h3>02 · 经营经济</h3><p>刷新商店消耗 2 金币，购买 4 经验消耗 4 金币。每存 10 金币获得 1 利息，上限 5。八名弈士共享有限卡池，出售返还英雄和装备。战斗中也可买牌、刷牌、买经验和整理备战席；升星下场生效。</p></article><article><h3>03 · 装备与羁绊</h3><p>将装备拖给英雄穿戴，每名英雄最多三件。两件小装备自动合成大装备，也可以在装备区点击两个小件合成。拖动悬停可预览成装和效果，松手合成，Esc 取消。相同英雄只计一次羁绊，纹章可增加羁绊。</p></article><article><h3>04 · 对局与选秀</h3><p>35 秒备战结束后自动开战，也可提前准备就绪。选秀中低血量弈士先选。野怪掉落法球，点击让小精灵前往，靠近自动拾取金币和装备；也可点击空地或右键地面移动。生命归零被淘汰，最后的幸存者获胜。</p></article></div><div class="guide-note"><b>快捷键：</b> D 刷新商店 · F 购买经验 · E 出售选中英雄 · 空格开战 · Esc 关闭面板<br>这是本地练习版，对手为电脑。英雄、羁绊、配方及图标来自<a href="https://jcc.qq.com/#/hero" target="_blank" rel="noreferrer">金铲铲官网</a>的时空裂痕数据快照。当前采用平面棋盘和肖像棋子，野怪数值、部分技能时序与装备细节为本地模拟；未包含原作三维模型、骨骼动画和联网服务。</div>`,
    );
  },
  catalog() {
    this.dialog(
      "英雄图鉴",
      `<div class="catalog-controls"><input id="heroSearch" placeholder="搜索英雄或羁绊" aria-label="搜索英雄"><select id="heroCost" aria-label="按费用筛选"><option value="0">全部费用</option>${[1, 2, 3, 4, 5].map((i) => `<option value="${i}">${i} 费英雄</option>`).join("")}</select><span id="heroTotal">58 位英雄</span></div><div class="hero-grid" id="heroGrid"></div>`,
      () => {
        const update = () => {
          const search = $("#heroSearch").value.trim(),
            cost = Number($("#heroCost").value),
            list = Object.values(HEROES).filter(
              (h) =>
                (!cost || cost === h.cost) &&
                (!search ||
                  h.name.includes(search) ||
                  h.id.toLowerCase().includes(search.toLowerCase()) ||
                  h.traits.some((t) => TRAITS[t].name.includes(search))),
            );
          $("#heroTotal").textContent = list.length + " 位英雄";
          $("#heroGrid").innerHTML = "";
          for (const h of list) {
            const d = make(
              "button",
              "hero-tile",
              `<img src="${h.splash}" loading="lazy" alt="${h.name}"><strong>${h.name}<span style="float:right;color:${COST_COLORS[h.cost]}">◉ ${h.cost}</span></strong><small>${h.traits.map((t) => TRAITS[t].name).join(" · ")}</small>`,
            );
            d.style.setProperty("--cost", COST_COLORS[h.cost]);
            d.onclick = () => this.heroDetail(h.id);
            $("#heroGrid").append(d);
          }
        };
        $("#heroSearch").oninput = update;
        $("#heroCost").onchange = update;
        update();
      },
    );
  },
  heroDetail(id, star = 1, unit = null) {
    const h = HEROES[id];
    if (!h) return;
    this.dialog(
      h.name,
      `<div class="hero-detail"><img class="hero-detail-art" src="${h.splash}"><div><div class="star-choice">${[1, 2, 3].map((s) => `<button data-star="${s}" class="${s === star ? "active" : ""}">${"★".repeat(s)}</button>`).join("")}</div><div id="heroDetailStats">${this.heroTip(h, star, unit?.items || [], unit)}</div><p>剩余卡池：${G.pool[id]} 张<br>右键英雄可查看详情，选中英雄后按 E 出售。</p><button class="subtle-button" id="backCatalog">← 返回英雄图鉴</button></div></div>`,
      () => {
        document.querySelectorAll("[data-star]").forEach(
          (b) =>
            (b.onclick = () => {
              document
                .querySelectorAll("[data-star]")
                .forEach((x) => x.classList.toggle("active", x === b));
              $("#heroDetailStats").innerHTML = this.heroTip(
                h,
                Number(b.dataset.star),
                unit?.items || [], unit,
              );
            }),
        );
        $("#backCatalog").onclick = () => this.catalog();
      },
    );
  },
  recipes() {
    const base = BASE_ITEMS.filter((id) => id !== "1010");
    this.dialog(
      "装备合成图鉴",
      `<p class="recipe-description">行与列分别代表两件基础装备。点击交叉处查看合成结果及效果。</p><div class="recipe-details" id="recipeDetails">${this.recipeDetail("2010")}</div><table class="recipe-grid"><thead><tr><th>＋</th>${base.map((id) => `<th>${itemImage(id)}</th>`).join("")}</tr></thead><tbody>${base
        .map(
          (a) =>
            `<tr><th>${itemImage(a)}</th>${base
              .map((b) => {
                const id = RECIPES[[a, b].sort().join("+")];
                return `<td>${id ? `<button data-recipe="${id}" aria-label="${ITEMS[id].name}">${itemImage(id)}</button>` : "—"}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table>`,
      () => {
        document.querySelectorAll("[data-recipe]").forEach((b) => {
          b.onclick = () =>
            ($("#recipeDetails").innerHTML = this.recipeDetail(
              b.dataset.recipe,
            ));
          this.tip(b, () => this.itemTip(b.dataset.recipe));
        });
      },
    );
  },
  recipeDetail(id) {
    const i = ITEMS[id];
    return `${itemImage(id)}<div><h3>${i.name}</h3><p>${esc(i.basic)}<br>${esc(i.desc)}</p></div>`;
  },
  beginCombat(engine) {
    this.cancelDrag();
    $("#app").classList.add("combat-active");
    $("#unitLayer").innerHTML = "";
    this.combatEls.clear();
    this.fx = [];
    this.renderLoot();
    this.renderBench();
    this.renderShop();
    this.renderItems();
    this.syncSelection();
    for (const u of engine.units) this.addCombatUnit(u);
    const banner = $("#battleBanner");
    banner.textContent = "战斗开始";
    banner.classList.remove("show");
    void banner.offsetWidth;
    banner.classList.add("show");
  },
  addCombatUnit(u) {
    const d = this.unitEl(u, null, u.side),
      p = Hex.point(u.x, u.y);
    d.style.left = p.x + "px";
    d.style.top = p.y + "px";
    $("#unitLayer").append(d);
    this.combatEls.set(u.fid, d);
  },
  combatFrame(engine, dt) {
    for (const u of engine.units) {
      const d = this.combatEls.get(u.fid);
      if (!d) continue;
      const p = Hex.point(u.x, u.y);
      d.style.left = p.x + "px";
      d.style.top = p.y + "px";
      d.style.zIndex = 5 + u.y;
      d.querySelector(".unit-health").style.width =
        Math.max(0, (u.hp / u.maxHp) * 100) + "%";
      d.querySelector(".unit-mana").style.width =
        (u.manaMax ? (u.mana / u.manaMax) * 100 : 0) + "%";
      d.classList.toggle("dead", !u.alive);
      d.classList.toggle("stunned", engine.has(u, "stun"));
      d.classList.toggle("shielded", engine.has(u, "shield"));
      d.classList.toggle(
        "immune",
        engine.has(u, "immune") || engine.has(u, "immortal"),
      );
    }
    for (const e of engine.events.splice(0)) this.consumeEvent(e);
    this.drawFx(dt);
    this.updateTimer();
    if (this.damageTab && Math.floor(engine.time * 5) !== this.damageTick) {
      this.damageTick = Math.floor(engine.time * 5);
      this.renderDamage(engine);
    }
  },
  color(u) {
    if (!u) return "#edd397";
    if (u.traits?.includes("r5")) return "#86d8ff";
    if (u.traits?.includes("r1")) return "#ec9774";
    if (u.traits?.includes("r10")) return "#bf98ff";
    if (u.traits?.includes("j10")) return "#a8a2ff";
    if (u.traits?.includes("r6")) return "#f0d982";
    return u.side ? "#eb9d85" : "#a3e0c0";
  },
  consumeEvent(e) {
    const u = e.unit,
      p = u ? Hex.point(u.x, u.y) : { x: 0, y: 0 },
      d = u ? this.combatEls.get(u.fid) : null,
      color = this.color(u);
    if (e.type === "spawn") {
      this.addCombatUnit(u);
      return;
    }
    if (e.type === "cast") {
      d?.classList.add("casting");
      setTimeout(() => d?.classList.remove("casting"), 550);
      this.fx.push({
        kind: "text",
        x: p.x,
        y: p.y - 94,
        text: e.name,
        color: "#f1dfa6",
        life: 1.1,
        max: 1.1,
        size: 12,
      });
      this.fx.push({
        kind: "ring",
        x: p.x,
        y: p.y - 10,
        r: 37,
        color,
        life: 0.65,
        max: 0.65,
      });
      AudioFX.play("cast");
    }
    if (
      (e.type === "damage" && e.amount >= 2) ||
      (e.type === "heal" && e.amount >= 8) ||
      e.type === "text"
    ) {
      this.fx.push({
        kind: "text",
        x: p.x + (Math.random() - 0.5) * 30,
        y: p.y - 70,
        text: e.text || (e.type === "heal" ? "+" : "") + Math.round(e.amount),
        color:
          e.type === "heal"
            ? "#9eeaa7"
            : e.crit
              ? "#ffe696"
              : e.kind === "magic"
                ? "#a8e6ff"
                : "#f3dfbe",
        life: 0.85,
        max: 0.85,
        size: e.crit ? 20 : 14,
      });
    }
    if (e.type === "attack") {
      d?.classList.add("attacking");
      setTimeout(() => d?.classList.remove("attacking"), 220);
      const t = Hex.point(e.target.x, e.target.y);
      if (e.ranged)
        this.fx.push({
          kind: "projectile",
          x: p.x,
          y: p.y - 36,
          tx: t.x,
          ty: t.y - 36,
          color,
          life: 0.28,
          max: 0.28,
        });
      else
        this.fx.push({
          kind: "slash",
          x: t.x,
          y: t.y - 36,
          color,
          life: 0.2,
          max: 0.2,
        });
    }
    if (e.type === "area") {
      const c = Hex.point(e.center.x, e.center.y);
      this.fx.push({
        kind: "ring",
        x: c.x,
        y: c.y,
        r: 55 * (e.radius || 1),
        color,
        life: 0.75,
        max: 0.75,
      });
    }
    if (e.type === "beam" || e.type === "bolt") {
      const t = Hex.point(e.target.x, e.target.y);
      this.fx.push({
        kind: e.type,
        x: p.x,
        y: p.y - 25,
        tx: t.x,
        ty: t.y - 25,
        color,
        life: 0.4,
        max: 0.4,
      });
    }
    if (e.type === "death") {
      this.fx.push({
        kind: "death",
        x: p.x,
        y: p.y - 40,
        color: u.side ? "#f39990" : "#84d8d8",
        life: 0.8,
        max: 0.8,
      });
    }
    if (this.fx.length > 250) this.fx.splice(0, this.fx.length - 250);
  },
  drawFx(dt) {
    const c = this.ctx;
    c.clearRect(0, 0, 1250, 740);
    this.fx = this.fx.filter((f) => {
      f.life -= dt;
      return f.life > 0;
    });
    for (const f of this.fx) {
      const t = 1 - f.life / f.max;
      c.save();
      c.globalAlpha = Math.min(1, (f.life / f.max) * 2);
      c.strokeStyle = f.color;
      c.fillStyle = f.color;
      c.shadowColor = f.color;
      c.shadowBlur = 12;
      c.lineWidth = 2;
      if (f.kind === "text") {
        c.shadowColor = "#000";
        c.shadowBlur = 5;
        c.font = `600 ${f.size}px 'Microsoft YaHei'`;
        c.textAlign = "center";
        c.fillText(f.text, f.x, f.y - t * 32);
      }
      if (f.kind === "ring") {
        c.lineWidth = 3 * (1 - t);
        c.beginPath();
        c.ellipse(
          f.x,
          f.y,
          f.r * (0.5 + t * 0.7),
          f.r * (0.25 + t * 0.35),
          0,
          0,
          Math.PI * 2,
        );
        c.stroke();
        c.globalAlpha *= 0.12;
        c.fill();
      }
      if (f.kind === "projectile") {
        const x = f.x + (f.tx - f.x) * t,
          y = f.y + (f.ty - f.y) * t;
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x - (f.tx - f.x) * 0.1, y - (f.ty - f.y) * 0.1);
        c.stroke();
        c.beginPath();
        c.arc(x, y, 3, 0, 7);
        c.fill();
      }
      if (f.kind === "beam") {
        c.lineWidth = 5 * (1 - t) + 1;
        c.beginPath();
        c.moveTo(f.x, f.y);
        c.lineTo(f.tx, f.ty);
        c.stroke();
        c.strokeStyle = "#fffee8";
        c.lineWidth = 1;
        c.stroke();
      }
      if (f.kind === "bolt") {
        c.beginPath();
        c.moveTo(f.x, f.y);
        for (let i = 1; i <= 7; i++)
          c.lineTo(
            f.x +
              ((f.tx - f.x) * i) / 7 +
              (i === 7 ? 0 : Math.sin(i * 19 + t * 30) * 12),
            f.y + ((f.ty - f.y) * i) / 7,
          );
        c.stroke();
      }
      if (f.kind === "slash") {
        c.lineWidth = 5;
        c.beginPath();
        c.arc(f.x, f.y, 24, -1.5 + t, 1 + t);
        c.stroke();
      }
      if (f.kind === "death") {
        c.lineWidth = 4 * (1 - t);
        c.beginPath();
        c.moveTo(f.x, f.y + 25);
        c.lineTo(f.x, f.y - 100 * t);
        c.stroke();
        for (let i = 0; i < 7; i++) {
          c.beginPath();
          c.arc(
            f.x + Math.cos(i * 2.4) * t * 30,
            f.y - t * (40 + i * 7),
            2,
            0,
            7,
          );
          c.fill();
        }
      }
      c.restore();
    }
  },
};
