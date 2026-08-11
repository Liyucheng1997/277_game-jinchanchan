'use strict';
/* ============ UI：备战渲染 + 拖拽 + 战斗表现 ============ */
const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html !== undefined) d.innerHTML = html;
  return d;
};

/* 头像/图标：优先用生成的素材图，加载失败自动退回 emoji */
const faceHtml = def =>
  `<div class="face"><span>${def.emoji}</span><img src="assets/heroes/${def.id}.png" draggable="false" onerror="this.remove()"></div>`;
const itemImgHtml = itId =>
  `<img src="assets/items/${itId}.png" draggable="false" onerror="this.outerHTML='${ITEMS[itId].emoji}'">`;

const UI = {
  dragSrc: null, // {type:'bench'|'board'|'item', idx?, key?}

  buildBoard() {
    const board = $('#board');
    board.style.width = COLS * CELL + 'px';
    board.style.height = ROWS * CELL + 'px';
    board.innerHTML = '';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = el('div', 'cell' + (y >= PLAYER_ROW_MIN ? ' mine' : ' theirs'));
      c.style.left = x * CELL + 'px';
      c.style.top = y * CELL + 'px';
      c.dataset.x = x; c.dataset.y = y;
      if (y >= PLAYER_ROW_MIN) {
        c.addEventListener('dragover', e => { e.preventDefault(); c.classList.add('drop'); });
        c.addEventListener('dragleave', () => c.classList.remove('drop'));
        c.addEventListener('drop', e => {
          e.preventDefault(); c.classList.remove('drop');
          Game.handleDrop({ type: 'board', key: x + ',' + y });
        });
      }
      board.appendChild(c);
    }
    const units = el('div', 'unitLayer'); units.id = 'unitLayer';
    const fx = el('div', 'fxLayer'); fx.id = 'fxLayer';
    board.appendChild(units); board.appendChild(fx);
  },

  buildBench() {
    const bench = $('#bench');
    bench.innerHTML = '';
    for (let i = 0; i < BENCH_SIZE; i++) {
      const s = el('div', 'benchSlot');
      s.dataset.idx = i;
      s.addEventListener('dragover', e => { e.preventDefault(); s.classList.add('drop'); });
      s.addEventListener('dragleave', () => s.classList.remove('drop'));
      s.addEventListener('drop', e => {
        e.preventDefault(); s.classList.remove('drop');
        Game.handleDrop({ type: 'bench', idx: i });
      });
      bench.appendChild(s);
    }
  },

  /* ---------- 单位小卡片 ---------- */
  unitEl(unit, draggable) {
    const h = HEROES[unit.heroId];
    const d = el('div', `unit cost${h.cost} star${unit.star}`);
    d.innerHTML = `
      ${faceHtml(h)}
      <div class="uname">${h.name}</div>
      <div class="stars">${'★'.repeat(unit.star)}</div>
      ${unit.items.length ? `<div class="uitems">${unit.items.map(itemImgHtml).join('')}</div>` : ''}
    `;
    if (draggable && G.phase === 'prep') {
      d.draggable = true;
      d.addEventListener('dragstart', e => {
        UI.dragSrc = unit._loc;
        d.classList.add('dragging');
        document.body.classList.add('isDragging');
        e.dataTransfer.setData('text/plain', 'unit');
      });
      d.addEventListener('dragend', () => {
        d.classList.remove('dragging');
        document.body.classList.remove('isDragging');
        UI.dragSrc = null;
      });
    }
    d.addEventListener('mouseenter', e => UI.showUnitTip(e, h, unit.star, unit.items));
    d.addEventListener('mousemove', e => UI.moveTip(e));
    d.addEventListener('mouseleave', () => UI.hideTip());
    return d;
  },

  ghostEl(spec, mult) {
    const def = spec.kind === 'creep' ? CREEPS[spec.id] : HEROES[spec.id];
    const star = spec.star || 1;
    const d = el('div', 'unit ghost');
    d.innerHTML = `
      ${faceHtml(def)}
      <div class="uname">${def.name}</div>
      <div class="stars enemyStars">${'★'.repeat(star)}</div>
    `;
    d.addEventListener('mouseenter', e => UI.showUnitTip(e, def, star, [], mult * (spec.mult || 1)));
    d.addEventListener('mousemove', e => UI.moveTip(e));
    d.addEventListener('mouseleave', () => UI.hideTip());
    return d;
  },

  /* ---------- 备战期渲染 ---------- */
  renderPrep() {
    const layer = $('#unitLayer');
    layer.innerHTML = '';
    $('#fxLayer').innerHTML = '';
    // 玩家棋子
    for (const key in G.board) {
      const unit = G.board[key];
      const [x, y] = key.split(',').map(Number);
      unit._loc = { type: 'board', key };
      const d = this.unitEl(unit, true);
      d.style.left = x * CELL + 3 + 'px';
      d.style.top = y * CELL + 3 + 'px';
      layer.appendChild(d);
    }
    // 敌方预览
    const wave = getWave(G.round);
    Combat.placeEnemies(wave.units).forEach(p => {
      const d = this.ghostEl(p.spec, wave.mult);
      d.style.left = p.x * CELL + 3 + 'px';
      d.style.top = p.y * CELL + 3 + 'px';
      layer.appendChild(d);
    });
    $('#previewTag').style.display = 'block';
  },

  renderBench() {
    document.querySelectorAll('#bench .benchSlot').forEach((s, i) => {
      s.innerHTML = '';
      const unit = G.bench[i];
      if (unit) {
        unit._loc = { type: 'bench', idx: i };
        s.appendChild(this.unitEl(unit, true));
      }
    });
  },

  renderItems() {
    const bar = $('#itemBar');
    bar.innerHTML = G.items.length ? '' : '<span class="hintText">装备栏（拖到棋子身上）</span>';
    G.items.forEach((itId, i) => {
      const it = ITEMS[itId];
      const d = el('div', 'itemChip' + (itId === 'spatula' ? ' legendary' : ''),
        `<span>${it.emoji}</span>${itemImgHtml(itId)}`);
      d.draggable = true;
      d.addEventListener('dragstart', e => {
        UI.dragSrc = { type: 'item', idx: i };
        document.body.classList.add('isDragging');
        e.dataTransfer.setData('text/plain', 'item');
      });
      d.addEventListener('dragend', () => { document.body.classList.remove('isDragging'); UI.dragSrc = null; });
      d.addEventListener('mouseenter', e => UI.showTip(e, `<div class="tipTitle">${it.emoji} ${it.name}</div><div>${it.desc}</div>`));
      d.addEventListener('mousemove', e => UI.moveTip(e));
      d.addEventListener('mouseleave', () => UI.hideTip());
      bar.appendChild(d);
    });
  },

  renderShop() {
    const shop = $('#shop');
    shop.innerHTML = '';
    G.shop.forEach((heroId, i) => {
      if (!heroId) { shop.appendChild(el('div', 'shopCard empty', '已购')); return; }
      const h = HEROES[heroId];
      const card = el('div', `shopCard cost${h.cost}` + (G.gold < h.cost ? ' poor' : ''));
      card.innerHTML = `
        <div class="scFace"><span>${h.emoji}</span><img src="assets/heroes/${h.id}.png" draggable="false" onerror="this.remove()"></div>
        <div class="scName">${h.name}</div>
        <div class="scTraits">${ORIGINS[h.origin].icon}${ORIGINS[h.origin].name} ${CLASSES[h.cls].icon}${CLASSES[h.cls].name}</div>
        <div class="scCost">💰${h.cost}</div>`;
      card.addEventListener('click', () => Game.buyFromShop(i));
      card.addEventListener('mouseenter', e => UI.showUnitTip(e, h, 1, []));
      card.addEventListener('mousemove', e => UI.moveTip(e));
      card.addEventListener('mouseleave', () => UI.hideTip());
      shop.appendChild(card);
    });
    $('#btnLock').classList.toggle('on', G.locked);
    $('#btnLock').textContent = G.locked ? '🔒 已锁定' : '🔓 锁定';
  },

  renderHeader() {
    $('#roundLabel').textContent = `回合 ${roundName(G.round)}`;
    $('#stageDesc').textContent = G.round >= TOTAL_ROUNDS ? '无尽模式' :
      (G.round < 3 ? '野怪回合' : '敌军来袭');
    $('#hpFill').style.width = Math.max(0, G.hp) + '%';
    $('#hpText').textContent = `❤️ ${Math.max(0, G.hp)}`;
    $('#goldText').textContent = G.gold;
    const s = G.streak;
    $('#streakText').textContent = s >= 2 ? `🔥连胜×${s}` : s <= -2 ? `💧连败×${-s}` : '';
    $('#bestText').textContent = G.best ? `最佳: ${G.best}回合` : '';
    // 等级/经验
    $('#levelText').textContent = `Lv.${G.level}`;
    const req = XP_REQ[G.level];
    $('#xpText').textContent = G.level >= MAX_LEVEL ? 'MAX' : `${G.xp}/${req}`;
    $('#xpFill').style.width = G.level >= MAX_LEVEL ? '100%' : (100 * G.xp / req) + '%';
    $('#boardCount').textContent = `场上 ${Object.keys(G.board).length}/${G.level}`;
    // 概率
    const odds = ODDS[G.level] || ODDS[8];
    $('#oddsText').innerHTML = odds.map((p, i) => `<span class="oc${i + 1}">${p}%</span>`).join(' ');
  },

  renderSynergies() {
    const panel = $('#synergyList');
    panel.innerHTML = '';
    const seen = new Set(), cnt = {};
    for (const key in G.board) {
      const u = G.board[key];
      if (seen.has(u.heroId)) continue;
      seen.add(u.heroId);
      const h = HEROES[u.heroId];
      [h.origin, h.cls].forEach(t => cnt[t] = (cnt[t] || 0) + 1);
    }
    const all = { ...ORIGINS, ...CLASSES };
    const entries = Object.keys(all).map(k => ({ k, def: all[k], n: cnt[k] || 0 }))
      .sort((a, b) => b.n - a.n);
    entries.forEach(({ k, def, n }) => {
      const tier = Combat.tierOf(k, n);
      const d = el('div', 'synRow' + (tier > 0 ? ' active' : n > 0 ? ' partial' : ''));
      const thr = def.thresholds.join('/');
      d.innerHTML = `<span class="synIcon">${def.icon}</span>
        <span class="synName">${def.name}</span>
        <span class="synCnt">${n} <small>(${thr})</small></span>`;
      d.addEventListener('mouseenter', e => UI.showTip(e, `<div class="tipTitle">${def.icon} ${def.name}</div><div>${def.desc}</div>`));
      d.addEventListener('mousemove', e => UI.moveTip(e));
      d.addEventListener('mouseleave', () => UI.hideTip());
      panel.appendChild(d);
    });
  },

  renderAll() {
    this.renderHeader();
    this.renderSynergies();
    this.renderBench();
    this.renderItems();
    this.renderShop();
    if (G.phase === 'prep') this.renderPrep();
    const inPrep = G.phase === 'prep';
    $('#btnFight').disabled = !inPrep;
    $('#btnRefresh').disabled = !inPrep;
    $('#btnXp').disabled = !inPrep;
  },

  /* ---------- 悬浮提示 ---------- */
  showUnitTip(e, def, star, items, mult = 1) {
    const starMult = Math.pow(1.8, star - 1) * mult;
    const traits = def.origin ?
      `<div class="tipTraits">${ORIGINS[def.origin].icon}${ORIGINS[def.origin].name}　${CLASSES[def.cls].icon}${CLASSES[def.cls].name}</div>` : '';
    const skill = def.skill ?
      `<div class="tipSkill"><b>⭐ ${def.skill.name}</b><br>${skillDesc(def, star)}</div>` : '';
    const itemsHtml = items && items.length ?
      `<div class="tipItems">${items.map(i => `${ITEMS[i].emoji}${ITEMS[i].name}`).join('　')}</div>` : '';
    this.showTip(e, `
      <div class="tipHead">
        <img src="assets/heroes/${def.id}.png" onerror="this.remove()">
        <div class="tipTitle">${def.emoji} ${def.name} ${'★'.repeat(star)}</div>
      </div>
      ${traits}
      <div class="tipStats">
        ❤️${Math.round(def.hp * starMult)}　⚔️${Math.round(def.atk * starMult)}
        ⚡${def.as}/s　🛡️${def.armor}　📏${def.range}
      </div>
      ${skill}${itemsHtml}`);
  },

  showTip(e, html) {
    const t = $('#tooltip');
    t.innerHTML = html;
    t.style.display = 'block';
    this.moveTip(e);
  },
  moveTip(e) {
    const t = $('#tooltip');
    if (t.style.display === 'none') return;
    const r = t.getBoundingClientRect();
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 12;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 12;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  },
  hideTip() { $('#tooltip').style.display = 'none'; },

  toast(msg) {
    const t = el('div', 'toast', msg);
    $('#toastWrap').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1800);
  },

  modal(title, bodyHtml, buttons) {
    const m = $('#modal');
    m.classList.remove('hidden');
    $('#modalTitle').innerHTML = title;
    $('#modalBody').innerHTML = bodyHtml;
    const bWrap = $('#modalBtns');
    bWrap.innerHTML = '';
    buttons.forEach(b => {
      const btn = el('button', 'btn primary', b.text);
      btn.addEventListener('click', () => { m.classList.add('hidden'); b.fn && b.fn(); });
      bWrap.appendChild(btn);
    });
  },
};

/* ============ 战斗表现层 ============ */
const UIC = {
  els: new Map(),

  beginCombat(fighters) {
    $('#previewTag').style.display = 'none';
    const layer = $('#unitLayer');
    layer.innerHTML = '';
    $('#fxLayer').innerHTML = '';
    this.els.clear();
    fighters.forEach(f => {
      const d = el('div', `unit fighter ${f.side} cost${f.def.cost || 0}`);
      d.innerHTML = `
        ${faceHtml(f.def)}
        <div class="stars ${f.side === 'enemy' ? 'enemyStars' : ''}">${'★'.repeat(f.star)}</div>
        <div class="bars">
          <div class="hpBar"><div class="hpFillU"></div></div>
          <div class="mpBar"><div class="mpFillU"></div></div>
        </div>
        ${f.items && f.items.length ? `<div class="uitems">${f.items.map(itemImgHtml).join('')}</div>` : ''}
      `;
      d.style.left = f.x * CELL + 3 + 'px';
      d.style.top = f.y * CELL + 3 + 'px';
      layer.appendChild(d);
      this.els.set(f.fid, d);
    });
  },

  renderCombatFrame(fighters, projs, time) {
    fighters.forEach(f => {
      const d = this.els.get(f.fid);
      if (!d || !f.alive) return;
      d.style.left = f.x * CELL + 3 + 'px';
      d.style.top = f.y * CELL + 3 + 'px';
      d.querySelector('.hpFillU').style.width = (100 * f.hp / f.maxHp) + '%';
      if (f.manaMax > 0) d.querySelector('.mpFillU').style.width = (100 * f.mana / f.manaMax) + '%';
      d.classList.toggle('frozen', Combat.hasEffect(f, 'freeze'));
      d.classList.toggle('burning', Combat.hasEffect(f, 'burn') || Combat.hasEffect(f, 'poison'));
      d.classList.toggle('shielded', f.effects.some(e => e.type === 'shield' && e.t > 0 && e.amount > 0));
    });
    projs.forEach(p => {
      if (p._el) { p._el.style.left = p.px - 10 + 'px'; p._el.style.top = p.py - 10 + 'px'; }
    });
    $('#combatTimer').textContent = `⏱ ${Math.max(0, Combat.TIME_LIMIT - time).toFixed(0)}s`;
  },

  hitFlash(f) {
    const d = this.els.get(f.fid);
    if (!d) return;
    d.classList.add('hitflash');
    clearTimeout(d._hfT);
    d._hfT = setTimeout(() => d.classList.remove('hitflash'), 110);
  },

  killUnit(f) {
    const d = this.els.get(f.fid);
    if (!d) return;
    d.classList.add('dead');
    setTimeout(() => d.remove(), 500);
    this.els.delete(f.fid);
  },

  addProj(p) {
    const d = el('div', 'proj', p.emoji);
    d.style.left = p.px - 10 + 'px';
    d.style.top = p.py - 10 + 'px';
    $('#fxLayer').appendChild(d);
    p._el = d;
  },
  removeProj(p) { if (p._el) p._el.remove(); },

  floatText(f, text, cls) {
    const d = el('div', 'dmgFloat ' + (cls || ''), text);
    d.style.left = f.x * CELL + CELL / 2 + (Math.random() * 24 - 12) + 'px';
    d.style.top = f.y * CELL + 6 + 'px';
    $('#fxLayer').appendChild(d);
    setTimeout(() => d.remove(), 900);
  },

  cellFx(x, y, emoji) {
    const d = el('div', 'cellFx', emoji);
    d.style.left = x * CELL + CELL / 2 - 16 + 'px';
    d.style.top = y * CELL + CELL / 2 - 16 + 'px';
    $('#fxLayer').appendChild(d);
    setTimeout(() => d.remove(), 600);
  },

  flashSkill(f, name) {
    const d = this.els.get(f.fid);
    if (d) {
      d.classList.remove('casting');
      void d.offsetWidth;
      d.classList.add('casting');
    }
    this.floatText(f, name, 'skillName');
  },
};
