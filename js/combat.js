"use strict";
// Fixed-step simulation. Both the human board and AI matches use this engine.
class CombatEngine {
  constructor(a, b, options = {}) {
    this.rng = options.rng || Math.random;
    this.events = [];
    this.time = 0;
    this.done = false;
    this.units = [];
    this.pending = [];
    this.serial = 0;
    this.result = null;
    this.damage = {};
    this.visual = options.visual !== false;
    this.addTeam(a, 0);
    this.addTeam(b, 1);
    this.applyTraits(0);
    this.applyTraits(1);
    this.units
      .filter((u) => u.traits.includes("j1") || u.creepId === "wolf")
      .forEach((u) => {
        const t = this.farthest(u);
        if (t) this.teleport(u, t);
      });
  }
  emit(type, data) {
    if (this.visual) this.events.push({ type, ...data });
  }
  addTeam(specs, side) {
    const used = new Set();
    for (const [i, s] of specs.entries()) {
      const h = s.creepId ? CREEPS[s.creepId] : HEROES[s.heroId];
      let p =
        s.x === undefined
          ? this.autoPosition(h.range, used, side)
          : { x: s.x, y: s.y };
      used.add(Hex.key(p));
      this.units.push(this.make(s, side, p));
    }
  }
  autoPosition(range, used, side) {
    const rows =
      side === 0
        ? range > 1
          ? [7, 6, 5, 4]
          : [4, 5, 6, 7]
        : range > 1
          ? [0, 1, 2, 3]
          : [3, 2, 1, 0];
    for (const y of rows)
      for (const x of [3, 2, 4, 1, 5, 0, 6])
        if (!used.has(x + "," + y)) return { x, y };
    return { x: 0, y: side ? 0 : 7 };
  }
  make(s, side, p) {
    const h = s.creepId ? CREEPS[s.creepId] : HEROES[s.heroId],
      star = s.star || 1,
      m = s.mult || 1;
    const hp = (s.creepId ? h.hp : h.hp[star - 1]) * m;
    const atk = (s.creepId ? h.atk : h.atk[star - 1]) * m;
    const u = {
      ...s,
      ...p,
      side,
      fid: ++this.serial,
      def: h,
      star,
      traits: s.heroId ? unitTraits(s) : [],
      maxHp: hp,
      hp,
      baseAtk: atk,
      atk,
      armor: h.armor,
      mr: h.mr,
      as: h.aspeed,
      asBonus: 0,
      ap: 1,
      crit: 0.25,
      critD: 1.4,
      amp: 0,
      reduce: 0,
      vamp: 0,
      regen: 0,
      mana: h.startMana || 0,
      manaMax: h.mana || 0,
      range: h.range,
      alive: true,
      cd: 0.2 + this.rng() * 0.3,
      moveCd: 0,
      effects: [],
      items: [...(s.items || [])],
      attacks: 0,
      casts: 0,
      stacks: {},
      damage: 0,
      healing: 0,
      target: null,
    };
    if (u.items.includes("2044"))
      u.items.push(
        ...[1, 2].map(() =>
          rand(
            Object.keys(ITEMS).filter(
              (k) =>
                ITEMS[k].recipe.length &&
                !EMBLEMS[k] &&
                k !== "2044" &&
                !["2036", "2047", "2048"].includes(k),
            ),
            this.rng,
          ),
        ),
      );
    for (const id of u.items) {
      const st = itemStats(id);
      for (const [k, v] of Object.entries(st)) {
        if (k === "ad") u.atk += u.baseAtk * v;
        else if (k === "ap") u.ap += v;
        else if (k === "as") u.asBonus += v;
        else if (k === "hp") {
          u.maxHp += v;
          u.hp += v;
        } else u[k] = (u[k] || 0) + v;
      }
    }
    if (u.items.includes("2022")) {
      u.atk *= 1.1;
      u.ap *= 1.1;
    }
    if (u.items.includes("2034")) u.maxHp *= 1.18;
    if (u.items.includes("2027") || u.items.includes("2031")) u.maxHp *= 1.09;
    if (u.items.includes("2029")) u.maxHp *= 1.08;
    if (u.items.includes("2041")) this.effect(u, "ccImmune", 18);
    if (u.items.includes("2018")) this.shield(u, u.maxHp * 0.25, 8);
    if (u.items.includes("2023")) u.mana += 20;
    if (u.items.includes("2024")) {
      if (u.range === 1) {
        u.armor += 45;
        u.mr += 45;
      } else {
        u.atk *= 1.1;
        u.ap *= 1.1;
      }
    }
    u.hp = u.maxHp;
    return u;
  }
  alive(side) {
    return this.units.filter(
      (u) => u.alive && (side === undefined || u.side === side),
    );
  }
  enemies(u) {
    return this.alive(1 - u.side).filter((t) => !this.has(t, "untargetable"));
  }
  allies(u) {
    return this.alive(u.side);
  }
  nearest(u) {
    return this.enemies(u).sort(
      (a, b) => Hex.distance(u, a) - Hex.distance(u, b) || a.hp - b.hp,
    )[0];
  }
  farthest(u) {
    return this.enemies(u).sort(
      (a, b) => Hex.distance(u, b) - Hex.distance(u, a),
    )[0];
  }
  near(center, arr, r = 1) {
    return arr.filter((t) => Hex.distance(t, center) <= r);
  }
  effect(u, type, t, value = 0, source = null) {
    if (["stun", "root", "slow"].includes(type) && this.has(u, "ccImmune"))
      return;
    const e = u.effects.find((e) => e.type === type && e.source === source);
    if (e) {
      e.t = Math.max(e.t, t);
      e.value = Math.max(e.value, value);
    } else u.effects.push({ type, t, value, source });
  }
  has(u, type) {
    return u.effects.some((e) => e.type === type && e.t > 0);
  }
  value(u, type) {
    return Math.max(
      0,
      ...u.effects
        .filter((e) => e.type === type && e.t > 0)
        .map((e) => e.value),
    );
  }
  shield(u, n, t = 5) {
    u.effects.push({ type: "shield", t, value: n });
    this.emit("shield", { unit: u, amount: n });
  }
  heal(u, n) {
    if (!u.alive) return;
    const heal = Math.max(
      0,
      Math.min(u.maxHp - u.hp, n * (1 - this.value(u, "wound"))),
    );
    u.hp += heal;
    u.healing += heal;
    if (heal > 10) this.emit("heal", { unit: u, amount: heal });
  }
  schedule(delay, fn) {
    this.pending.push({ at: this.time + delay, fn });
  }
  applyTraits(side) {
    const team = this.alive(side),
      cnt = traitCounts(team);
    const tier = (t) => tierOf(t, cnt[t] || 0);
    for (const u of team) {
      u.tiers = {};
      for (const t in cnt) u.tiers[t] = tier(t);
      const own = (t) => u.traits.includes(t) && tier(t);
      u.block = [0, 15, 35, 60][tier("j7")];
      u.ap += [0, 0.3, 0.9, 1.8][tier("j10")];
      u.mr += [0, 40, 80, 150][tier("j24")];
      if (own("j4")) {
        u.maxHp += [0, 250, 500][tier("j4")];
        u.hp = u.maxHp;
      }
      if (own("r6")) {
        u.armor += [0, 10, 40, 65][tier("r6")];
        u.mr += [0, 10, 40, 65][tier("r6")];
      }
      if (own("r11")) {
        u.atk += tier("r11") === 1 ? 45 : 100;
        u.ap += tier("r11") === 1 ? 0.45 : 1;
      }
      if (own("r2")) u.amp += tier("r2") === 1 ? 0.6 : 1;
      if (own("r3")) u.mr += tier("r3") === 1 ? 100 : 150;
      if (own("r12")) u.dodges = tier("r12") === 1 ? 3 : 10;
      if (own("r4") && !team.some((t) => t !== u && Hex.distance(t, u) <= 1))
        this.shield(u, u.maxHp, 99);
      if (own("r9")) u.mana = u.manaMax;
      if (own("j1")) {
        u.crit += [0, 0.1, 0.2, 0.3][tier("j1")];
        u.critD += [0, 0.75, 1.5, 2.25][tier("j1")];
      }
      if (own("j9")) {
        u.atk += tier("j9") === 1 ? 15 : 30;
        u.ap += tier("j9") === 1 ? 0.15 : 0.3;
      }
      if (own("j6"))
        for (const t of team.filter((t) => Hex.distance(t, u) <= 1)) {
          t.armor += 40;
          if (tier("j6") === 2) this.shield(t, 200, 99);
        }
    }
    if (tier("r7")) {
      const enemy = this.alive(1 - side).sort((a, b) => b.hp - a.hp)[0];
      if (enemy) enemy.hp *= 0.6;
    }
    if (tier("r14")) {
      const enemy = this.densest({ side }, tier("r14"));
      if (enemy)
        this.near(enemy, this.alive(1 - side), tier("r14")).forEach((t) =>
          this.effect(
            t,
            "slow",
            tier("r14") === 1 ? 3 : 5,
            tier("r14") === 1 ? 0.3 : 0.5,
          ),
        );
    }
    if (tier("j5")) {
      const origin = team[0];
      const p = this.freeNear({ x: 3, y: side ? 2 : 5 });
      if (p) {
        const golem = this.make({ creepId: "golem" }, side, p);
        golem.tiers = {};
        this.units.push(golem);
      }
    }
  }
  freeNear(p) {
    const occupied = new Set(this.alive().map(Hex.key));
    return Hex.cells()
      .filter((c) => !occupied.has(Hex.key(c)))
      .sort((a, b) => Hex.distance(a, p) - Hex.distance(b, p))[0];
  }
  teleport(u, t) {
    const p = this.freeNear(t);
    if (p) {
      const from = { x: u.x, y: u.y };
      u.x = p.x;
      u.y = p.y;
      this.emit("dash", { unit: u, from, to: p });
    }
  }
  // BFS through the actual six neighbors, avoiding occupied cells and dead ends.
  move(u, t) {
    if (this.has(u, "root")) return;
    const occupied = new Set(
      this.alive()
        .filter((x) => x !== u)
        .map(Hex.key),
    );
    const queue = [{ p: { x: u.x, y: u.y }, first: null }],
      seen = new Set([Hex.key(u)]);
    for (let i = 0; i < queue.length; i++) {
      const { p, first } = queue[i];
      if (first && Hex.distance(p, t) <= u.range) {
        u.x = first.x;
        u.y = first.y;
        return;
      }
      for (const n of Hex.neighbors(p)) {
        const k = Hex.key(n);
        if (occupied.has(k) || seen.has(k)) continue;
        seen.add(k);
        queue.push({ p: n, first: first || n });
      }
    }
  }
  densest(u, r = 1) {
    return this.enemies(u).sort(
      (a, b) =>
        this.near(b, this.enemies(u), r).length -
        this.near(a, this.enemies(u), r).length,
    )[0];
  }
  line(u, t, width = 0.65) {
    // Delayed casts may resolve after their selected target has died.
    if (!t) return [];
    const a = Hex.point(u.x, u.y),
      b = Hex.point(t.x, t.y),
      dx = b.x - a.x,
      dy = (b.y - a.y) * 1.8,
      len = Math.hypot(dx, dy) || 1;
    return this.enemies(u).filter((o) => {
      const c = Hex.point(o.x, o.y),
        x = c.x - a.x,
        y = (c.y - a.y) * 1.8;
      return (
        (x * dx + y * dy) / len >= 0 &&
        Math.abs(x * dy - y * dx) / len < width * 70
      );
    });
  }
  damageTo(src, t, amount, type = "magic", options = {}) {
    if (!t?.alive || this.has(t, "immune") || this.has(t, "untargetable"))
      return 0;
    if (options.attack && !src.wild) {
      if (t.dodges > 0) {
        t.dodges--;
        this.emit("text", { unit: t, text: "闪避" });
        return 0;
      }
      if (this.has(t, "dodge")) return 0;
    }
    let n = amount,
      crit = false;
    if (
      (options.attack ||
        options.crit ||
        src.items.includes("2001") ||
        src.items.includes("2038")) &&
      this.rng() < src.crit
    ) {
      n *= src.critD;
      crit = true;
    }
    if (type !== "true") {
      const resist =
        type === "phys"
          ? t.armor *
            (src.heroId === "Draven" ? 0.5 : 1) *
            (this.has(t, "shredArmor") ? 0.7 : 1)
          : t.mr * (this.has(t, "shredMr") ? 0.7 : 1);
      n *= resist >= 0 ? 100 / (100 + resist) : 2 - 100 / (100 - resist);
    }
    n *= 1 + src.amp;
    if (src.items.includes("2046") && t.range === 1) n *= 1.15;
    n *=
      1 -
      Math.min(
        0.9,
        t.reduce +
          this.value(t, "reduction") +
          (t.items.includes("2040") ? (t.hp / t.maxHp > 0.5 ? 0.18 : 0.1) : 0),
      );
    if (type === "magic" && this.has(t, "garen")) n *= 0.25;
    if (options.attack && t.items.includes("2027")) n *= 0.95;
    n = Math.max(0, n - (t.block || 0));
    if (t.heroId === "TahmKench") n = Math.max(0, n - this.val(t));
    const before = n;
    for (const sh of t.effects.filter((e) => e.type === "shield" && e.t > 0)) {
      const absorbed = Math.min(sh.value, n);
      sh.value -= absorbed;
      n -= absorbed;
    }
    if (this.has(t, "immortal"))
      n = Math.min(n, Math.max(0, t.hp - this.value(t, "immortal")));
    const dealt = Math.min(t.hp, n);
    t.hp -= n;
    src.damage += dealt;
    this.emit("damage", {
      unit: t,
      source: src,
      amount: dealt,
      crit,
      kind: type,
    });
    t.mana = Math.min(t.manaMax, t.mana + Math.min(30, 6 + before * 0.06));
    if (src.vamp) this.heal(src, dealt * src.vamp);
    if (src.items.includes("2003")) {
      const friend = this.allies(src).sort(
        (a, b) => a.hp / a.maxHp - b.hp / b.maxHp,
      )[0];
      if (friend) this.heal(friend, dealt * 0.2);
    }
    if (!options.secondary) {
      if (src.items.includes("2011")) this.effect(t, "shredMr", 5);
      if (src.items.includes("2037")) this.effect(t, "shredArmor", 3);
      if (src.items.includes("2009") || src.items.includes("2020")) {
        this.effect(
          t,
          "burn",
          src.items.includes("2020") ? 10 : 5,
          t.maxHp * 0.01,
          src,
        );
        this.effect(t, "wound", 10, 0.33);
      }
      if (src.traits.includes("r10") && src.tiers?.r10 && type !== "true") {
        this.damageTo(
          src,
          t,
          amount *
            Math.min(5, Math.floor(this.time / 4)) *
            (src.tiers.r10 === 1 ? 0.1 : 0.2),
          "true",
          { secondary: true },
        );
      }
    }
    if (
      type === "magic" &&
      t.traits.includes("r3") &&
      t.tiers?.r3 &&
      this.time >= (t.dragonCd || 0)
    ) {
      this.heal(t, t.maxHp * (t.tiers.r3 === 1 ? 0.05 : 0.08));
      t.dragonCd = this.time + 2;
    }
    if (t.items.includes("2012")) this.titan(t);
    if (
      t.hp > 0 &&
      t.hp < t.maxHp * 0.6 &&
      !t.stacks.lifeline &&
      (t.items.includes("2005") || t.items.includes("2007"))
    ) {
      t.stacks.lifeline = 1;
      if (t.items.includes("2005")) {
        t.effects = t.effects.filter(
          (e) => !["stun", "slow", "burn", "root", "wound"].includes(e.type),
        );
        this.effect(t, "untargetable", 0.5);
        this.heal(t, (t.maxHp - t.hp) * 0.3);
      } else this.shield(t, t.maxHp * 0.5, 4);
    }
    if (
      t.hp > 0 &&
      t.hp < t.maxHp * 0.4 &&
      !t.stacks.blood &&
      (t.items.includes("2006") || t.items.includes("2023"))
    ) {
      t.stacks.blood = 1;
      this.shield(t, t.maxHp * (t.items.includes("2006") ? 0.25 : 0.2));
      if (t.items.includes("2023")) t.mana += 15;
    }
    if (t.hp <= 0) this.kill(t, src);
    if (crit && src.items.includes("2042"))
      this.effect(
        src,
        "flail",
        5,
        Math.min(4, (src.stacks.flail = (src.stacks.flail || 0) + 1)) * 0.05,
      );
    return dealt;
  }
  kill(t, src) {
    if (!t.alive) return;
    t.hp = 0;
    t.alive = false;
    this.emit("death", { unit: t });
    if (t.creepId === "krug")
      this.allies(t)
        .filter((u) => u.creepId === "krug")
        .forEach((u) => this.heal(u, u.maxHp));
    if (t.creepId === "raptor")
      this.allies(t).forEach((u) => (u.asBonus += 0.3));
    for (const u of this.allies(src)) {
      if (u.heroId === "Jinx" && !u.traits.includes("fortune")) {
        u.stacks.jinx = (u.stacks.jinx || 0) + 1;
        if (u.stacks.jinx === 1) u.asBonus += this.val(u, 1);
      }
    }
  }
  titan(u) {
    if ((u.stacks.titan || 0) >= 25) return;
    u.stacks.titan = (u.stacks.titan || 0) + 1;
    u.atk += u.baseAtk * 0.02;
    u.ap += 0.02;
    if (u.stacks.titan === 25) {
      u.amp += 0.1;
      this.effect(u, "ccImmune", 99);
    }
  }
  attack(u, t, extra = false) {
    if (!t?.alive) return;
    u.attacks++;
    const dt = Hex.distance(u, t);
    this.emit("attack", { unit: u, target: t, ranged: u.range > 1 });
    const land = () => {
      if (!u.alive || !t.alive) return;
      let attack = u.atk * (u.heroId === "Graves" ? this.val(u) : 1);
      if (u.heroId === "Ashe" && this.has(u, "ashe"))
        attack *= 5 * this.val(u, 1);
      if (u.heroId === "Draven")
        attack *= 1 + Math.min(2, u.stacks.axes || 0) * this.val(u);
      this.damageTo(u, t, attack, "phys", { attack: true });
      if (u.heroId === "Vayne") {
        u.stacks.vayneTarget === t.fid
          ? u.stacks.vayne++
          : ((u.stacks.vayneTarget = t.fid), (u.stacks.vayne = 1));
        if (u.stacks.vayne % 3 === 0)
          this.damageTo(u, t, t.maxHp * this.val(u), "true");
      }
      if (u.heroId === "Kassadin") {
        t.mana = Math.max(0, t.mana - this.val(u));
        this.shield(u, this.val(u, 1) * u.ap, 4);
      }
      if (u.heroId === "Kogmaw" && this.has(u, "kog"))
        this.damageTo(u, t, t.maxHp * this.val(u) * u.ap);
      if (u.heroId === "Shyvana" && u.transformed)
        this.effect(t, "burn", 3, (this.val(u) * u.ap) / 3, u);
      if (u.heroId === "Jinx" && (u.stacks.jinx || 0) >= 2)
        this.near(t, this.enemies(u), 1).forEach((o) =>
          this.damageTo(u, o, this.val(u) * u.ap),
        );
      if (u.heroId === "Graves")
        this.line(u, t, 0.6)
          .filter((o) => o !== t && Hex.distance(o, u) <= 2)
          .forEach((o) =>
            this.damageTo(u, o, attack, "phys", {
              attack: true,
              secondary: true,
            }),
          );
      if (u.heroId === "Volibear" && this.has(u, "volibear"))
        this.enemies(u)
          .filter((o) => o !== t)
          .sort((a, b) => Hex.distance(a, t) - Hex.distance(b, t))
          .slice(0, this.val(u))
          .forEach((o) => {
            this.emit("bolt", { unit: t, target: o });
            this.damageTo(u, o, u.atk * this.val(u, 1), "phys", {
              secondary: true,
            });
          });
      if (this.has(u, "luxAttack")) {
        this.damageTo(u, t, this.val(u, 1) * u.ap);
        u.effects = u.effects.filter((e) => e.type !== "luxAttack");
      }
      if (u.traits.includes("r1") && u.tiers.r1 && this.rng() < 0.3) {
        t.mana = Math.max(0, t.mana - 20);
        u.mana += u.tiers.r1 * 15;
      }
      if (
        u.traits.includes("r5") &&
        u.tiers.r5 &&
        this.rng() < [0, 0.2, 0.3, 0.5][u.tiers.r5]
      )
        this.effect(t, "stun", 1.2);
      if (u.traits.includes("r6") && u.tiers.r6) {
        const n = u.tiers.r6 === 3 ? 20 : 10;
        (u.tiers.r6 === 1 ? [u] : this.allies(u)).forEach((a) =>
          this.heal(a, n),
        );
      }
      if (
        u.wild &&
        ((u.tiers.r13 === 3 && u.traits.includes("r13")) ||
          (u.stacks.wild || 0) < 5)
      ) {
        u.stacks.wild = (u.stacks.wild || 0) + 1;
        u.asBonus += 0.1;
      }
      if (u.items.includes("2012")) this.titan(u);
      if (u.items.includes("2013") && (u.stacks.kraken || 0) < 15) {
        u.stacks.kraken = (u.stacks.kraken || 0) + 1;
        u.atk += u.baseAtk * 0.035;
        if (u.stacks.kraken === 15) u.asBonus += 0.15;
      }
      if (t.items.includes("2027") && this.time >= (t.thornsCd || 0)) {
        t.thornsCd = this.time + 2;
        this.near(t, this.enemies(t), 1).forEach((o) =>
          this.damageTo(t, o, 100, "magic", { secondary: true }),
        );
      }
      if (u.bomb?.target === t) {
        u.bomb.stacks++;
        if (u.bomb.stacks >= 3) this.explodeBomb(u);
      }
      if (!extra && u.traits.includes("j2") && u.tiers.j2 && this.rng() < 0.4) {
        for (let i = 0; i < [0, 1, 2, 4][u.tiers.j2]; i++)
          this.schedule(0.12 * (i + 1), () => {
            if (u.alive) this.attack(u, t, true);
          });
      }
      if (
        !extra &&
        u.traits.includes("j3") &&
        u.tiers.j3 &&
        u.attacks % 4 === 0
      )
        this.enemies(u)
          .filter((o) => o !== t)
          .slice(0, [0, 2, 3, 5][u.tiers.j3])
          .forEach((o) =>
            this.damageTo(u, o, u.atk * (1 + u.tiers.j3 * 0.25), "phys", {
              attack: true,
              secondary: true,
            }),
          );
    };
    let mana = u.traits.includes("j10") || u.traits.includes("j5") ? 20 : 10;
    if (u.items.includes("2004")) mana += 5;
    if (u.items.includes("2014")) mana += 2;
    u.mana = Math.min(
      u.manaMax,
      u.mana + mana * (u.items.includes("2024") ? 1.15 : 1),
    );
    if (dt > 1) this.schedule(Math.min(0.45, dt * 0.065), land);
    else land();
  }
  val(u, i = 0, fallback = 0) {
    return skillValue(u.def, u.star, i, fallback);
  }
  aoe(u, center, damage, r = 1, stun = 0, type = "magic") {
    // A densest/random target can disappear between targeting and resolution.
    if (!center) return;
    this.emit("area", {
      unit: u,
      center: { x: center.x, y: center.y },
      radius: r,
    });
    this.near(center, this.enemies(u), r).forEach((t) => {
      this.damageTo(u, t, damage, type);
      if (stun) this.effect(t, "stun", stun);
    });
  }
  transform(u) {
    if (u.transformed) return false;
    u.transformed = true;
    if (u.tiers.j9) {
      const hp = u.maxHp * (u.tiers.j9 === 1 ? 0.4 : 0.8);
      u.maxHp += hp;
      u.hp += hp;
    }
    return true;
  }
  explodeBomb(u) {
    if (!u.bomb) return;
    const b = u.bomb;
    u.bomb = null;
    this.aoe(u, b.target, this.val(u) * u.ap * (1 + b.stacks * 0.5));
  }
  cast(u) {
    let t = u.target?.alive ? u.target : this.nearest(u);
    if (!t) return;
    u.mana = 0;
    u.casts++;
    const v = (i = 0, fallback = 0) => this.val(u, i, fallback),
      d = v() * u.ap,
      enemy = this.enemies(u),
      allies = this.allies(u),
      far = this.farthest(u),
      low = allies.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    u.cd = Math.max(u.cd, 0.5);
    this.emit("cast", {
      unit: u,
      name: u.def.skill?.name || "选牌",
      target: t,
    });
    for (const o of enemy)
      if (o.items.includes("2019") && Hex.distance(o, u) <= 2)
        this.damageTo(o, u, u.manaMax * 1.5);
    const hit = (o, n = d, type = "magic") => this.damageTo(u, o, n, type);
    const channel = (duration, ticks, fn) => {
      this.effect(u, "channel", duration);
      for (let i = 0; i < ticks; i++)
        this.schedule((duration * i) / ticks, () => {
          if (u.alive && !this.has(u, "stun")) fn(i);
        });
    };
    switch (u.heroId) {
      case "Annie":
        this.aoe(u, t, d);
        this.shield(u, v(1) * u.ap, 6);
        break;
      case "Jinx":
        if (u.traits.includes("fortune")) this.aoe(u, t, d, 1, v(1));
        break;
      case "Garen":
        this.effect(u, "garen", 4);
        channel(4, 9, () => this.aoe(u, u, d));
        break;
      case "Mordekaiser":
        this.line(u, t)
          .slice(0, 2)
          .forEach((o) => hit(o));
        break;
      case "Fiora":
        this.effect(u, "immune", 1.5);
        this.schedule(1.5, () => {
          if (u.alive) {
            hit(t);
            this.effect(t, "stun", v(1, 1.5));
          }
        });
        break;
      case "Nidalee":
        if (this.transform(u)) {
          u.range = 1;
          u.atk += v();
        }
        channel(6, 12, () => {
          this.heal(u, (v(1) * u.ap) / 12);
          if (low !== u) this.heal(low, (v(1) * u.ap) / 12);
        });
        break;
      case "Tristana":
        this.explodeBomb(u);
        u.bomb = { target: t, stacks: 0 };
        this.schedule(4, () => {
          if (u.alive) this.explodeBomb(u);
        });
        break;
      case "Darius": {
        const count = this.near(u, enemy, 1).length;
        this.aoe(u, u, d);
        this.heal(u, v(1) * count * u.ap);
        break;
      }
      case "Khazix":
        hit(
          t,
          enemy.some((o) => o !== t && Hex.distance(o, t) <= 1)
            ? d
            : v(1) * u.ap,
        );
        break;
      case "Elise":
        if (this.transform(u)) {
          u.vamp += v();
          u.range = 1;
          for (let i = 0; i < v(1); i++) {
            const p = this.freeNear(u);
            if (p) {
              const spider = this.make(
                { creepId: "spider", mult: u.star },
                u.side,
                p,
              );
              spider.tiers = {};
              this.units.push(spider);
              this.emit("spawn", { unit: spider });
            }
          }
        }
        break;
      case "Camile":
        hit(t);
        this.effect(t, "root", v(1));
        allies.forEach((a) => (a.target = t));
        break;
      case "Nami":
        this.heal(low, d);
        {
          const near = this.enemies(low).sort(
            (a, b) => Hex.distance(a, low) - Hex.distance(b, low),
          )[0];
          if (near) hit(near, v(1) * u.ap);
        }
        break;
      case "Varus":
        channel(1.2, 1, () => {
          this.line(u, t).forEach((o) => hit(o));
          this.emit("beam", { unit: u, target: far });
        });
        break;
      case "Ahri": {
        const targets = this.line(u, t);
        targets.forEach((o) => hit(o));
        this.emit("beam", { unit: u, target: t });
        this.schedule(0.5, () => {
          if (u.alive) targets.forEach((o) => hit(o, d, "true"));
        });
        break;
      }
      case "Lulu":
        allies
          .slice()
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
          .slice(0, v(1, 1))
          .forEach((a) => {
            a.maxHp += d;
            a.hp += d;
            this.aoe(u, a, 0, 1, 1.25);
            this.schedule(6, () => {
              a.maxHp -= d;
              a.hp = Math.min(a.hp, a.maxHp);
            });
          });
        break;
      case "Zed":
        this.line(u, t)
          .filter((o) => Hex.distance(o, u) <= 4)
          .forEach((o) => hit(o));
        this.emit("beam", { unit: u, target: far });
        break;
      case "Lissandra":
        if (u.hp / u.maxHp < 0.5) {
          this.effect(u, "untargetable", 2);
          this.aoe(u, u, d);
        } else {
          t = rand(enemy, this.rng);
          this.effect(t, "stun", 1.5);
          this.aoe(u, t, d);
        }
        break;
      case "Braum":
        this.effect(u, "reduction", v(1, 4), v());
        break;
      case "Shen":
        this.near(u, allies, 1).forEach((a) => this.effect(a, "dodge", v()));
        u.mr += v(1);
        this.schedule(v(), () => (u.mr -= v(1)));
        break;
      case "Pyke":
      case "Vi": {
        const targets = this.line(u, far);
        this.teleport(u, far);
        targets.forEach((o) => {
          hit(o);
          this.effect(o, "stun", v(1, 1.5));
        });
        break;
      }
      case "Blitzcrank": {
        const p = this.freeNear(u);
        if (p) {
          far.x = p.x;
          far.y = p.y;
        }
        u.target = far;
        hit(far);
        this.effect(far, "stun", 2.5);
        this.emit("beam", { unit: u, target: far });
        break;
      }
      case "TwistedFate": {
        hit(t, [150, 250, 400][u.star - 1] * u.ap);
        const card = Math.floor(this.rng() * 3);
        if (card === 0) this.effect(t, "stun", 2);
        else if (card === 1) this.aoe(u, t, [150, 250, 400][u.star - 1] * u.ap);
        else
          this.near(u, allies, 2).forEach(
            (a) => (a.mana = Math.min(a.manaMax, a.mana + 30)),
          );
        break;
      }
      case "Jayce":
        hit(t);
        this.effect(t, "stun", v(1));
        if (this.transform(u)) u.range += 3;
        this.effect(u, "haste", v(2) / 5, 5);
        break;
      case "Lux":
        allies.forEach((a) => this.shield(a, d, 3));
        this.effect(u, "luxAttack", 99);
        break;
      case "Kogmaw":
        this.effect(u, "kog", 3);
        this.effect(u, "haste", 3, 0.8);
        u.range = 99;
        this.schedule(3, () => (u.range = u.def.range));
        break;
      case "Poppy":
        this.line(u, t)
          .slice(0, v(2, 1))
          .forEach((o) => {
            hit(o);
            this.effect(o, "stun", v(1));
          });
        break;
      case "Aatrox":
        this.aoe(u, t, d);
        break;
      case "Katarina":
        channel(2.5, 15, () => {
          this.near(u, this.enemies(u), 2)
            .slice(0, v(1))
            .forEach((o) => {
              hit(o, d);
              this.effect(o, "wound", 3, 0.8);
            });
          this.emit("area", { unit: u, center: u, radius: 2 });
        });
        break;
      case "Ashe":
        this.effect(u, "ashe", 5);
        this.effect(u, "haste", 5, v());
        break;
      case "Kennen": {
        const hits = {};
        channel(3, 6, () => {
          this.near(u, this.enemies(u), 2).forEach((o) => {
            hit(o, d / 6);
            hits[o.fid] = (hits[o.fid] || 0) + 1;
            if (hits[o.fid] === 3) this.effect(o, "stun", 1.5);
          });
          this.emit("area", { unit: u, center: u, radius: 2 });
        });
        break;
      }
      case "Rengar":
        t = enemy.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        this.teleport(u, t);
        hit(t, u.atk * v(), "phys");
        this.effect(u, "haste", 6, v(1));
        this.effect(u, "critBuff", 6, 0.25);
        break;
      case "Morgana": {
        const tether = this.near(u, enemy, 2);
        tether.forEach((o) => hit(o));
        this.schedule(3, () => {
          if (u.alive)
            tether
              .filter((o) => o.alive && Hex.distance(o, u) <= 2)
              .forEach((o) => {
                hit(o);
                this.effect(o, "stun", v(1));
              });
        });
        break;
      }
      case "Volibear":
        this.effect(u, "volibear", 20);
        break;
      case "Evelynn":
        this.near(t, enemy, 1).forEach((o) =>
          hit(o, d * (o.hp / o.maxHp < 0.5 ? v(1) : 1)),
        );
        this.teleport(u, { x: 3, y: u.side ? 0 : 7 });
        break;
      case "Veigar":
        t = rand(enemy, this.rng);
        if (u.star > t.star) {
          this.kill(t, u);
          this.emit("damage", { unit: t, amount: 9999, kind: "true" });
        } else hit(t);
        break;
      case "Gangplank":
        this.aoe(u, this.densest(u), d, 2);
        break;
      case "Shyvana":
        if (this.transform(u)) {
          u.atk += v(1);
          u.range = 4;
          this.teleport(u, { x: u.x, y: u.side ? 0 : 7 });
        }
        break;
      case "Sejuani": {
        const center = { x: t.x, y: t.y };
        this.schedule(1, () => {
          if (u.alive) this.aoe(u, center, d, 2, v(1));
        });
        break;
      }
      case "Leona": {
        const center = this.densest(u);
        this.aoe(u, center, d);
        this.effect(center, "stun", v(1));
        break;
      }
      case "Akali":
        this.damageTo(u, t, d, "magic", { crit: true });
        break;
      case "Chogath":
        this.aoe(u, this.densest(u, 2), d, 2, v(1));
        break;
      case "AurelionSol":
        this.line(u, far, 1).forEach((o) => hit(o));
        this.emit("beam", { unit: u, target: far });
        break;
      case "Brand": {
        let last = rand(enemy, this.rng);
        for (let i = 0; i < v(1, 4); i++)
          this.schedule(i * 0.2, () => {
            if (!u.alive) return;
            const list = this.enemies(u);
            const next =
              list
                .filter((o) => o !== last)
                .sort(
                  (a, b) => Hex.distance(a, last) - Hex.distance(b, last),
                )[0] || list[0];
            if (next) {
              this.emit("bolt", { unit: last, target: next });
              hit(next);
              last = next;
            }
          });
        break;
      }
      case "Draven":
        if ((u.stacks.axes || 0) < 2) {
          u.stacks.axes = (u.stacks.axes || 0) + 1;
          u.asBonus += v(1);
        }
        break;
      case "Kindred":
        this.near(u, allies, 2).forEach((a) =>
          this.effect(a, "immortal", v(), v(1)),
        );
        this.emit("area", { unit: u, center: u, radius: 2 });
        break;
      case "Gnar":
        if (this.transform(u)) {
          u.maxHp += v(1);
          u.hp += v(1);
          u.atk += v(2);
          u.range = 1;
          this.teleport(u, far);
          this.aoe(u, u, d, 2, 2);
        }
        break;
      case "Wukong":
        channel(3, 6, (i) => this.aoe(u, u, d / 6, 1, i === 0 ? v(1) : 0));
        break;
      case "Kayle":
        allies
          .slice()
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
          .slice(0, 1 + v(1))
          .forEach((a) => this.effect(a, "immune", v()));
        break;
      case "Karthus":
        this.effect(u, "channel", 3);
        this.schedule(3, () => {
          if (u.alive && !this.has(u, "stun"))
            enemy.slice(0, v()).forEach((o) => hit(o, v(1) * u.ap));
        });
        break;
      case "Anivia": {
        const center = enemy.sort(
          (a, b) => b.as * (1 + b.asBonus) - a.as * (1 + a.asBonus),
        )[0];
        channel(6, 12, () => {
          this.aoe(u, center, d / 12, 2);
          this.near(center, this.enemies(u), 2).forEach((o) =>
            this.effect(o, "slow", 0.6, v(1)),
          );
        });
        break;
      }
      case "Yasuo":
        this.line(u, t)
          .slice(0, u.casts % 3 === 0 ? 99 : 2)
          .forEach((o) => {
            hit(o);
            if (u.casts % 3 === 0) this.effect(o, "stun", 1.5);
          });
        this.emit("beam", { unit: u, target: far });
        break;
      case "Swain":
        this.transform(u);
        channel(6, 12, () => {
          const targets = this.near(u, this.enemies(u), 2);
          targets.forEach((o) => hit(o, d));
          this.heal(u, targets.length * v(1) * u.ap);
        });
        this.schedule(6, () => {
          if (u.alive) this.aoe(u, u, v(2) * u.ap, 2);
        });
        break;
      case "MissFortune":
        channel(3, 12, () => {
          this.line(u, far, 2).forEach((o) => hit(o, d / 12));
          this.emit("beam", { unit: u, target: far });
        });
        break;
      case "Pantheon":
        this.effect(u, "untargetable", 1);
        this.schedule(1, () => {
          if (!u.alive) return;
          this.line(u, far, 1).forEach((o) => {
            hit(o, o.maxHp * v(1) * u.ap);
            this.effect(o, "burn", 10, (o.maxHp * v(2)) / 10, u);
            this.effect(o, "wound", 10, 0.33);
          });
          this.teleport(u, far);
          this.effect(far, "stun", v());
        });
        break;
      case "Kaisa":
        this.teleport(u, far);
        this.shield(u, d, 3);
        this.effect(u, "haste", 3, v(1));
        break;
    }
  }
  step(dt = 1 / 30) {
    if (this.done) return;
    this.time += dt;
    const due = this.pending.filter((t) => t.at <= this.time);
    this.pending = this.pending.filter((t) => t.at > this.time);
    due.forEach((t) => t.fn());
    for (const u of this.alive()) {
      for (const e of [...u.effects]) {
        e.t -= dt;
        if (e.t > 0 && e.type === "burn" && e.source)
          this.damageTo(e.source, u, e.value * dt, "true", { secondary: true });
      }
      u.effects = u.effects.filter(
        (e) => e.t > 0 && (e.type !== "shield" || e.value > 0),
      );
      if (!u.alive) continue;
      u.wild = !!(
        u.tiers?.r13 &&
        (u.traits.includes("r13") || u.tiers.r13 >= 2)
      );
      u.mana = Math.min(u.manaMax, u.mana + u.regen * dt);
      if (u.items.includes("2010")) u.asBonus += 0.07 * dt;
      if (u.items.includes("2041")) u.asBonus += 0.03 * dt;
      if (u.items.includes("2025")) this.heal(u, (u.maxHp - u.hp) * 0.025 * dt);
      if (u.items.includes("2031")) this.heal(u, u.maxHp * 0.0125 * dt);
      if (
        u.items.includes("2017") &&
        Math.floor(this.time / 5) > (u.stacks.arch || 0)
      ) {
        u.stacks.arch = Math.floor(this.time / 5);
        u.ap += 0.2;
      }
      if (u.items.includes("2018") && this.time >= 8 && !u.stacks.crown) {
        u.stacks.crown = 1;
        u.ap += 0.25;
      }
      if (u.items.includes("2029") && this.time >= (u.sunfireCd || 0)) {
        u.sunfireCd = this.time + 2;
        const t = this.near(u, this.enemies(u), 2).sort(
          (a, b) =>
            (this.has(a, "burn") ? 1 : 0) - (this.has(b, "burn") ? 1 : 0),
        )[0];
        if (t) {
          this.effect(t, "burn", 10, t.maxHp * 0.01, u);
          this.effect(t, "wound", 10, 0.33);
        }
      }
      if (u.items.includes("2019"))
        this.near(u, this.enemies(u), 2).forEach((t) =>
          this.effect(t, "shredMr", 0.2),
        );
      if (u.items.includes("2032"))
        this.near(u, this.enemies(u), 2).forEach((t) =>
          this.effect(t, "shredArmor", 0.2),
        );
      if (this.has(u, "stun") || this.has(u, "channel")) continue;
      if (
        u.manaMax &&
        u.mana >= u.manaMax &&
        u.heroId &&
        !["Vayne", "Kassadin", "Graves"].includes(u.heroId) &&
        (u.heroId !== "Jinx" || u.traits.includes("fortune")) &&
        !(
          ["Nidalee", "Elise", "Shyvana", "Gnar", "Jayce"].includes(u.heroId) &&
          u.transformed
        )
      ) {
        this.cast(u);
        continue;
      }
      if (!u.target?.alive || this.has(u.target, "untargetable"))
        u.target = this.nearest(u);
      const t = u.target;
      if (!t) continue;
      if (Hex.distance(u, t) > u.range) {
        u.moveCd -= dt;
        if (u.moveCd <= 0) {
          this.move(u, t);
          u.moveCd = 0.34;
        }
      } else {
        u.cd -= dt;
        if (u.cd <= 0) {
          const ranger =
            u.traits.includes("j8") &&
            u.tiers?.j8 &&
            (u.tiers.j8 === 3 ? this.time % 6 >= 3 : this.time % 6 >= 3)
              ? [0, 1.1, 2, 2][u.tiers.j8]
              : 0;
          const overtime = this.time > 40 ? 2 : 1;
          u.cd =
            1 /
            Math.min(
              5,
              Math.max(
                0.1,
                u.as *
                  (1 + u.asBonus + this.value(u, "haste") + ranger) *
                  (1 - this.value(u, "slow")) *
                  overtime,
              ),
            );
          this.attack(u, t);
        }
      }
    }
    const a = this.alive(0),
      b = this.alive(1);
    if (!a.length || !b.length || this.time >= 60) {
      this.done = true;
      this.result = {
        winner: a.length && !b.length ? 0 : b.length && !a.length ? 1 : -1,
        survivors: a.length && !b.length ? a : b,
        time: this.time,
      };
    }
  }
  run() {
    let n = 0;
    while (!this.done && n++ < 1900) this.step(1 / 30);
    return this.result;
  }
}
