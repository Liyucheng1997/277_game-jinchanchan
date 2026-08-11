'use strict';
/* ============ 自动战斗引擎 ============ */
const Combat = {
  fighters: [], projs: [], timers: [], time: 0, running: false,
  _raf: null, _last: 0, _acc: 0, onEnd: null, _fid: 0,
  sideFx: { player: {}, enemy: {} },
  TIME_LIMIT: 45,

  /* ---- 敌方站位（纯函数，备战期预览也用它） ---- */
  placeEnemies(specs) {
    const colOrder = [3, 2, 4, 1, 5, 0, 6];
    const used = new Set();
    const defOf = s => s.kind === 'creep' ? CREEPS[s.id] : HEROES[s.id];
    const melee = specs.filter(s => defOf(s).range <= 1);
    const ranged = specs.filter(s => defOf(s).range > 1);
    const out = [];
    const put = (s, rows) => {
      for (const y of rows) for (const x of colOrder) {
        const k = x + ',' + y;
        if (!used.has(k)) { used.add(k); out.push({ spec: s, x, y }); return; }
      }
    };
    melee.forEach(s => put(s, [3, 2, 1, 0]));
    ranged.forEach(s => put(s, [1, 0, 2, 3]));
    return out;
  },

  /* ---- 创建战斗单位 ---- */
  makeFighter(opts) {
    // opts: {side, heroId? creepId?, star, x, y, items, mult}
    const def = opts.creepId ? CREEPS[opts.creepId] : HEROES[opts.heroId];
    const starMult = Math.pow(1.8, (opts.star || 1) - 1) * (opts.mult || 1);
    const s = {
      hp: def.hp * starMult, atk: def.atk * starMult, as: def.as,
      armor: def.armor, sp: 0, asMult: 1, manaStart: def.manaStart || 0,
      critC: 0, critD: 1.6,
    };
    (opts.items || []).forEach(itId => ITEMS[itId] && ITEMS[itId].apply(s));
    const f = {
      fid: ++this._fid, side: opts.side,
      heroId: opts.creepId ? null : opts.heroId,
      def, star: opts.star || 1,
      name: def.name, emoji: def.emoji,
      x: opts.x, y: opts.y,
      maxHp: Math.round(s.hp), hp: Math.round(s.hp),
      atk: s.atk, baseAs: def.as, asMult: s.asMult,
      range: def.range, armor: s.armor, sp: s.sp,
      manaMax: def.manaMax, mana: Math.min(def.manaMax, s.manaStart),
      critC: s.critC, critD: s.critD,
      alive: true, target: null, atkCd: 0.3 + Math.random() * 0.4, moveCd: 0,
      effects: [], items: opts.items || [],
      origin: def.origin, cls: def.cls,
    };
    return f;
  },

  /* ---- 羁绊统计（数同一方不同英雄） ---- */
  traitCounts(side) {
    const seen = new Set();
    const cnt = {};
    this.fighters.filter(f => f.side === side && f.heroId).forEach(f => {
      if (seen.has(f.heroId)) return;
      seen.add(f.heroId);
      [f.origin, f.cls].forEach(t => { if (t) cnt[t] = (cnt[t] || 0) + 1; });
    });
    return cnt;
  },

  tierOf(trait, n) {
    const def = ORIGINS[trait] || CLASSES[trait];
    if (!def) return 0;
    let tier = 0;
    def.thresholds.forEach((th, i) => { if (n >= th) tier = i + 1; });
    return tier;
  },

  applyTraits(side) {
    const cnt = this.traitCounts(side);
    const fx = { burnDps: 0, slowPct: 0, regenPct: 0 };
    const t = tr => this.tierOf(tr, cnt[tr] || 0);
    if (t('fire') === 1) fx.burnDps = 10; else if (t('fire') === 2) fx.burnDps = 26;
    if (t('ice') === 1) fx.slowPct = 0.25; else if (t('ice') === 2) fx.slowPct = 0.5;
    if (t('forest') === 1) fx.regenPct = 0.006; else if (t('forest') === 2) fx.regenPct = 0.016;
    this.sideFx[side] = fx;
    const warT = t('warrior'), arcT = t('archer'), magT = t('mage'), assT = t('assassin');
    this.fighters.filter(f => f.side === side && f.alive).forEach(f => {
      if (f.cls === 'warrior' && warT) f.armor += warT === 1 ? 30 : 75;
      if (f.cls === 'archer' && arcT) f.asMult += arcT === 1 ? 0.35 : 0.8;
      if (f.cls === 'mage' && magT) f.sp += magT === 1 ? 35 : 90;
      if (f.cls === 'assassin' && assT) f.critC += assT === 1 ? 0.4 : 0.7;
    });
    return { counts: cnt, assassinTier: assT };
  },

  occupiedSet(except) {
    const s = new Set();
    this.fighters.forEach(f => { if (f.alive && f !== except) s.add(f.x + ',' + f.y); });
    return s;
  },

  /* 刺客开战跳后排 */
  assassinLeap() {
    this.fighters.filter(f => f.alive && f.cls === 'assassin').forEach(f => {
      const rows = f.side === 'player' ? [0, 1, 2] : [7, 6, 5];
      const colOrder = [0, 6, 1, 5, 2, 4, 3];
      const occ = this.occupiedSet(f);
      for (const y of rows) for (const x of colOrder) {
        if (!occ.has(x + ',' + y)) { f.x = x; f.y = y; return; }
      }
    });
  },

  /* ---- 开战 ---- */
  start(playerUnits, enemySpecs, waveMult, onEnd) {
    this.fighters = []; this.projs = []; this.timers = [];
    this.time = 0; this._acc = 0; this._fid = 0; this.onEnd = onEnd;

    playerUnits.forEach(u => {
      this.fighters.push(this.makeFighter({
        side: 'player', heroId: u.unit.heroId, star: u.unit.star,
        x: u.x, y: u.y, items: u.unit.items,
      }));
    });
    this.placeEnemies(enemySpecs).forEach(p => {
      const sp = p.spec;
      this.fighters.push(this.makeFighter({
        side: 'enemy',
        heroId: sp.kind === 'hero' ? sp.id : null,
        creepId: sp.kind === 'creep' ? sp.id : null,
        star: sp.star || 1, x: p.x, y: p.y,
        mult: (sp.mult || 1) * waveMult,
      }));
    });

    this.applyTraits('player');
    this.applyTraits('enemy');
    this.assassinLeap();

    UIC.beginCombat(this.fighters);
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(ts => this.frame(ts));
  },

  stopLoop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  frame(ts) {
    if (!this.running) return;
    let dt = Math.min(0.1, (ts - this._last) / 1000);
    this._last = ts;
    dt *= (G.speed || 1);
    this._acc += dt;
    const STEP = 1 / 60;
    let guard = 0;
    while (this._acc >= STEP && guard < 12) {
      this.step(STEP); this._acc -= STEP; guard++;
      if (!this.running) return;
    }
    UIC.renderCombatFrame(this.fighters, this.projs, this.time);
    this._raf = requestAnimationFrame(t2 => this.frame(t2));
  },

  hasEffect(f, type) { return f.effects.some(e => e.type === type && e.t > 0); },
  effectSum(f, type, key) {
    let v = 0;
    f.effects.forEach(e => { if (e.type === type && e.t > 0) v = Math.max(v, e[key] || 0); });
    return v;
  },

  addEffect(f, eff) {
    // 同类型效果取最强并刷新时间
    const old = f.effects.find(e => e.type === eff.type);
    if (old) {
      old.t = Math.max(old.t, eff.t);
      ['dps', 'pct', 'amount'].forEach(k => { if (eff[k] !== undefined) old[k] = Math.max(old[k] || 0, eff[k]); });
      if (eff.reflect) old.reflect = true;
      if (eff.frost) old.frost = true;
    } else f.effects.push({ ...eff });
  },

  step(dt) {
    this.time += dt;
    // 定时器（多段技能）
    this.timers = this.timers.filter(tm => {
      tm.t -= dt;
      if (tm.t <= 0) { tm.fn(); return false; }
      return true;
    });
    // 投射物
    this.projs = this.projs.filter(p => {
      const tx = p.tgt.x * CELL + CELL / 2, ty = p.tgt.y * CELL + CELL / 2;
      const dx = tx - p.px, dy = ty - p.py;
      const d = Math.hypot(dx, dy);
      const mv = p.speed * dt;
      if (d <= mv || !p.tgt.alive) {
        if (p.tgt.alive) p.onHit();
        UIC.removeProj(p);
        return false;
      }
      p.px += dx / d * mv; p.py += dy / d * mv;
      return true;
    });

    for (const f of this.fighters) {
      if (!f.alive) continue;
      // 持续效果
      f.effects.forEach(e => {
        e.t -= dt;
        if ((e.type === 'burn' || e.type === 'poison') && e.t > -0.001) {
          this.hurt(f, e.dps * dt, e.type === 'burn' ? 'burn' : 'poison');
        }
      });
      f.effects = f.effects.filter(e => e.t > 0);
      if (!f.alive) continue;
      // 森林回复
      const regen = this.sideFx[f.side].regenPct;
      if (regen && f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + f.maxHp * regen * dt);

      if (this.hasEffect(f, 'freeze')) continue; // 冰冻/眩晕：跳过行动

      // 施法
      if (f.manaMax > 0 && f.mana >= f.manaMax && f.heroId && SKILLS[f.heroId]) {
        f.mana = 0;
        UIC.flashSkill(f, HEROES[f.heroId].skill.name);
        Sfx.cast();
        SKILLS[f.heroId](f, this);
        this.checkEnd();
        if (!this.running) return;
        continue;
      }

      // 目标
      if (!f.target || !f.target.alive) f.target = this.nearestEnemy(f);
      if (!f.target) continue;
      const t = f.target;
      const dist = Math.max(Math.abs(f.x - t.x), Math.abs(f.y - t.y));

      if (dist > f.range) {
        f.moveCd -= dt;
        if (f.moveCd <= 0) { this.moveToward(f, t); f.moveCd = 0.5; }
      } else {
        f.atkCd -= dt;
        if (f.atkCd <= 0) {
          const slow = this.effectSum(f, 'slow', 'pct');
          const asEff = Math.max(0.1, f.baseAs * f.asMult * (1 - slow));
          f.atkCd = 1 / asEff;
          this.attack(f, t);
          if (!this.running) return;
        }
      }
    }
    this.checkEnd();
  },

  nearestEnemy(f) {
    let best = null, bd = 1e9;
    for (const o of this.fighters) {
      if (!o.alive || o.side === f.side) continue;
      const d = (o.x - f.x) ** 2 + (o.y - f.y) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  },

  moveToward(f, t) {
    const occ = this.occupiedSet(f);
    let best = null, bd = (f.x - t.x) ** 2 + (f.y - t.y) ** 2;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = f.x + dx, ny = f.y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (occ.has(nx + ',' + ny)) continue;
      const d = (nx - t.x) ** 2 + (ny - t.y) ** 2;
      if (d < bd) { bd = d; best = { x: nx, y: ny }; }
    }
    if (best) { f.x = best.x; f.y = best.y; }
  },

  attack(f, t) {
    const land = () => {
      if (!t.alive || !f.alive) return;
      this.dealDamage(f, t, f.atk, 'phys', { canCrit: true });
      // 羁绊触发
      const fx = this.sideFx[f.side];
      if (f.origin === 'fire' && fx.burnDps) this.addEffect(t, { type: 'burn', dps: fx.burnDps, t: 3 });
      if (f.origin === 'ice' && fx.slowPct) this.addEffect(t, { type: 'slow', pct: fx.slowPct, t: 3 });
      // 冰霜护甲 / 荆棘反弹
      const sh = t.effects.find(e => e.type === 'shield' && e.t > 0);
      if (sh && sh.frost) this.addEffect(f, { type: 'slow', pct: 0.3, t: 2 });
      if (sh && sh.reflect && t.alive) this.hurt(f, f.atk * 0.3, 'reflect');
    };
    f.mana = Math.min(f.manaMax, f.mana + 10);
    if (f.range > 1) {
      this.spawnProj(f, t, land);
    } else {
      land();
      Sfx.hit();
    }
  },

  spawnProj(src, tgt, onHit) {
    const p = {
      px: src.x * CELL + CELL / 2, py: src.y * CELL + CELL / 2,
      tgt, speed: 560, onHit: () => { onHit(); Sfx.hit(); },
      emoji: src.origin === 'fire' ? '🔥' : src.origin === 'ice' ? '❄️' : src.origin === 'forest' ? '🍀' : '•',
    };
    this.projs.push(p);
    UIC.addProj(p);
  },

  /* 伤害入口（普攻/技能） */
  dealDamage(src, tgt, amount, type, opts = {}) {
    if (!tgt.alive) return 0;
    let dmg = amount;
    if (opts.canCrit && Math.random() < src.critC) {
      dmg *= src.critD;
      opts.crit = true;
    }
    if (type === 'phys') dmg *= 100 / (100 + Math.max(0, tgt.armor));
    else if (type === 'magic') dmg *= 100 / (100 + Math.max(0, tgt.armor) * 0.5);
    // 护盾吸收
    const sh = tgt.effects.find(e => e.type === 'shield' && e.t > 0 && e.amount > 0);
    if (sh) {
      const absorbed = Math.min(sh.amount, dmg);
      sh.amount -= absorbed; dmg -= absorbed;
      if (absorbed > 0) UIC.floatText(tgt, '-' + Math.round(absorbed), 'shield');
    }
    if (dmg > 0) {
      tgt.mana = Math.min(tgt.manaMax, tgt.mana + 8);
      this.hurt(tgt, dmg, type, opts.crit);
    }
    return dmg;
  },

  hurt(f, dmg, type, crit) {
    if (!f.alive) return;
    f.hp -= dmg;
    if (type !== 'burn' && type !== 'poison') {
      UIC.floatText(f, (crit ? '暴击 ' : '') + '-' + Math.round(dmg), crit ? 'crit' : type);
      UIC.hitFlash(f);
    }
    if (f.hp <= 0) {
      f.hp = 0; f.alive = false; f.effects = [];
      UIC.killUnit(f);
      Sfx.death();
      this.fighters.forEach(o => { if (o.target === f) o.target = null; });
    }
  },

  heal(f, amount) {
    if (!f.alive) return;
    const real = Math.min(f.maxHp - f.hp, amount);
    f.hp += real;
    if (real > 1) UIC.floatText(f, '+' + Math.round(real), 'heal');
  },

  spellMult(f) { return 1 + f.sp / 100; },

  enemiesOf(f) { return this.fighters.filter(o => o.alive && o.side !== f.side); },
  alliesOf(f) { return this.fighters.filter(o => o.alive && o.side === f.side); },

  schedule(t, fn) { this.timers.push({ t, fn }); },

  checkEnd() {
    if (!this.running) return;
    const pAlive = this.fighters.some(f => f.alive && f.side === 'player');
    const eAlive = this.fighters.some(f => f.alive && f.side === 'enemy');
    if (pAlive && eAlive && this.time < this.TIME_LIMIT) return;
    this.stopLoop();
    const win = pAlive && !eAlive;
    const survivors = this.fighters.filter(f => f.alive && f.side === 'enemy').length;
    const cb = this.onEnd;
    setTimeout(() => cb && cb({ win, survivors: win ? 0 : Math.max(1, survivors) }), 700);
  },
};

/* ============ 英雄技能 ============ */
const SKILLS = {
  yanren(f, C) {
    const t = f.target && f.target.alive ? f.target : C.nearestEnemy(f);
    if (!t) return;
    const v = HEROES.yanren.skill.vals;
    C.dealDamage(f, t, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
    C.addEffect(t, { type: 'burn', dps: 15, t: 3 });
    UIC.cellFx(t.x, t.y, '🔥');
  },
  bingyu(f, C) {
    const t = f.target && f.target.alive ? f.target : C.nearestEnemy(f);
    if (!t) return;
    const v = HEROES.bingyu.skill.vals;
    C.dealDamage(f, t, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
    C.addEffect(t, { type: 'freeze', t: v.t[f.star - 1] });
    UIC.cellFx(t.x, t.y, '❄️');
  },
  tengci(f, C) {
    const t = f.target && f.target.alive ? f.target : C.nearestEnemy(f);
    if (!t) return;
    const v = HEROES.tengci.skill.vals;
    C.dealDamage(f, t, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
    C.addEffect(t, { type: 'poison', dps: v.dps[f.star - 1] * C.spellMult(f), t: 3 });
    UIC.cellFx(t.x, t.y, '☠️');
  },
  huohua(f, C) {
    const t = f.target && f.target.alive ? f.target : C.nearestEnemy(f);
    if (!t) return;
    const v = HEROES.huohua.skill.vals;
    C.enemiesOf(f).forEach(o => {
      if (Math.max(Math.abs(o.x - t.x), Math.abs(o.y - t.y)) <= 1)
        C.dealDamage(f, o, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
    });
    UIC.cellFx(t.x, t.y, '💥');
  },
  bingjia(f, C) {
    const v = HEROES.bingjia.skill.vals;
    C.addEffect(f, { type: 'shield', amount: v.sh[f.star - 1] * C.spellMult(f), t: 4, frost: true });
    UIC.cellFx(f.x, f.y, '🧊');
  },
  yangong(f, C) {
    const v = HEROES.yangong.skill.vals;
    const targets = C.enemiesOf(f)
      .sort((a, b) => ((a.x - f.x) ** 2 + (a.y - f.y) ** 2) - ((b.x - f.x) ** 2 + (b.y - f.y) ** 2))
      .slice(0, 3);
    targets.forEach(t => {
      C.spawnProj(f, t, () => C.dealDamage(f, t, v.dmg[f.star - 1] * C.spellMult(f), 'magic'));
    });
  },
  muling(f, C) {
    const v = HEROES.muling.skill.vals;
    const allies = C.alliesOf(f).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    if (allies.length) {
      C.heal(allies[0], v.heal[f.star - 1] * C.spellMult(f));
      UIC.cellFx(allies[0].x, allies[0].y, '💚');
    }
  },
  shuangren(f, C) {
    const v = HEROES.shuangren.skill.vals;
    const enemies = C.enemiesOf(f).sort((a, b) => a.hp - b.hp);
    if (!enemies.length) return;
    const t = enemies[0];
    // 闪现到目标旁
    const occ = C.occupiedSet(f);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const nx = t.x + dx, ny = t.y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (!occ.has(nx + ',' + ny)) { f.x = nx; f.y = ny; dx = dy = 2; }
    }
    f.target = t;
    C.dealDamage(f, t, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
    C.addEffect(t, { type: 'freeze', t: 1 });
    UIC.cellFx(t.x, t.y, '❄️');
  },
  senzhishou(f, C) {
    const v = HEROES.senzhishou.skill.vals;
    C.addEffect(f, { type: 'shield', amount: v.sh[f.star - 1] * C.spellMult(f), t: 5, reflect: true });
    UIC.cellFx(f.x, f.y, '🌵');
  },
  bingjing(f, C) {
    const v = HEROES.bingjing.skill.vals;
    C.enemiesOf(f).forEach(o => {
      C.dealDamage(f, o, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
      C.addEffect(o, { type: 'slow', pct: 0.4, t: 3 });
      UIC.cellFx(o.x, o.y, '🌨️');
    });
  },
  yanying(f, C) {
    const v = HEROES.yanying.skill.vals;
    const strike = n => {
      if (n <= 0 || !f.alive) return;
      let t = f.target && f.target.alive ? f.target : C.nearestEnemy(f);
      if (!t) return;
      f.target = t;
      C.dealDamage(f, t, v.dmg[f.star - 1] * C.spellMult(f), 'magic', { canCrit: true });
      C.addEffect(t, { type: 'burn', dps: 12, t: 3 });
      UIC.cellFx(t.x, t.y, '⚡');
      C.schedule(0.18, () => strike(n - 1));
    };
    strike(3);
  },
  fenghuang(f, C) {
    const v = HEROES.fenghuang.skill.vals;
    const t = f.target && f.target.alive ? f.target : C.nearestEnemy(f);
    if (!t) return;
    C.enemiesOf(f).forEach(o => {
      if (Math.max(Math.abs(o.x - t.x), Math.abs(o.y - t.y)) <= 2) {
        C.dealDamage(f, o, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
        C.addEffect(o, { type: 'burn', dps: 25, t: 3 });
        UIC.cellFx(o.x, o.y, '🔥');
      }
    });
    C.heal(f, v.heal[f.star - 1]);
  },
  gushu(f, C) {
    const v = HEROES.gushu.skill.vals;
    C.enemiesOf(f).forEach(o => {
      if (Math.max(Math.abs(o.x - f.x), Math.abs(o.y - f.y)) <= 1) {
        C.dealDamage(f, o, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
        C.addEffect(o, { type: 'freeze', t: v.t[f.star - 1] });
        UIC.cellFx(o.x, o.y, '💫');
      }
    });
  },
  binglong(f, C) {
    const v = HEROES.binglong.skill.vals;
    const targets = C.enemiesOf(f)
      .sort((a, b) => ((a.x - f.x) ** 2 + (a.y - f.y) ** 2) - ((b.x - f.x) ** 2 + (b.y - f.y) ** 2))
      .slice(0, 3);
    targets.forEach(t => {
      C.spawnProj(f, t, () => {
        C.dealDamage(f, t, v.dmg[f.star - 1] * C.spellMult(f), 'magic');
        C.addEffect(t, { type: 'slow', pct: 0.5, t: 3 });
      });
    });
  },
};
