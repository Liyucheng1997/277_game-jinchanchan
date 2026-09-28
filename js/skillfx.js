"use strict";
// Per-hero skill visuals drawn on the arena canvas.
// Performance rules: glow comes from cached radial-gradient sprites drawn with
// additive blending (never shadowBlur), every list is capped, and particle
// counts scale down automatically when frames get slow.
const SkillFX = {
  effects: [],
  parts: [],
  texts: [],
  sprites: new Map(),
  icons: new Map(),
  quality: 1,
  frameAvg: 16,
  shakeT: 0,
  shakeMag: 0,
  MAX_PARTS: 700,
  MAX_EFFECTS: 160,
  MAX_TEXTS: 42,

  // ---------- geometry ----------
  // Anchor: a unit / hex coordinate object → live pixel position.
  P(o, lift = 0) {
    const p = Hex.point(o.x, o.y);
    return { x: p.x, y: p.y - lift };
  },
  live(o, lift = 40) {
    return () => this.P(o, lift);
  },
  dir(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l, l };
  },

  // ---------- resources ----------
  sprite(color) {
    let s = this.sprites.get(color);
    if (s) return s;
    s = document.createElement("canvas");
    s.width = s.height = 64;
    const c = s.getContext("2d"), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.18, color);
    g.addColorStop(0.5, color + "66");
    g.addColorStop(1, color + "00");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    this.sprites.set(color, s);
    return s;
  },
  icon(heroId) {
    if (this.icons.has(heroId)) return this.icons.get(heroId);
    const src = HEROES[heroId]?.skill?.icon;
    let img = null;
    if (src) {
      img = new Image();
      img.src = src;
    }
    this.icons.set(heroId, img);
    return img;
  },

  // ---------- lifecycle ----------
  reset() {
    this.effects.length = 0;
    this.parts.length = 0;
    this.texts.length = 0;
    this.shakeT = 0;
    this.drewLast = true; // force one clearing pass on the next update
    this.groundCtx?.clearRect(0, 0, 1250, 740);
    const arena = document.getElementById("arena");
    if (arena) arena.style.translate = "";
  },
  add(life, draw, delay = 0) {
    const e = { life, max: life, delay, draw };
    // Over budget: drop the new effect (never shift; update() may be iterating).
    if (this.effects.length < this.MAX_EFFECTS) this.effects.push(e);
    return e;
  },
  part(p) {
    if (this.parts.length >= this.MAX_PARTS * this.quality) return;
    p.max = p.life;
    p.spr = this.sprite(p.color);
    this.parts.push(p);
  },
  n(count) {
    return Math.max(1, Math.round(count * this.quality));
  },
  shake(mag, dur = 0.25) {
    if (mag > this.shakeMag || this.shakeT <= 0) this.shakeMag = mag;
    this.shakeT = Math.max(this.shakeT, dur);
  },

  // Frame: dt is real time, speed scales simulation-bound effects.
  update(c, dt, speed = 1) {
    const t = dt * speed;
    this.frameAvg = this.frameAvg * 0.94 + Math.min(100, dt * 1000) * 0.06;
    this.quality = this.frameAvg > 34 ? 0.35 : this.frameAvg > 24 ? 0.6 : 1;
    // Ground decals (discs, shockwave rings) render beneath the pieces.
    const g = (this.groundCtx ??= document.getElementById("groundFx")?.getContext("2d")) || c;
    // Untouched canvases cost the compositor nothing: skip idle frames.
    const busy = this.effects.length || this.parts.length || this.texts.length;
    if (!busy && !this.drewLast && this.shakeT <= 0) return;
    this.drewLast = busy;
    if (g !== c) g.clearRect(0, 0, 1250, 740);
    g.globalCompositeOperation = "lighter";
    c.clearRect(0, 0, 1250, 740);
    // Ground/overlay effects.
    c.globalCompositeOperation = "lighter";
    let w = 0;
    for (const e of this.effects) {
      if (e.delay > 0) {
        e.delay -= t;
        this.effects[w++] = e;
        continue;
      }
      e.life -= t;
      if (e.life <= 0) {
        e.onEnd?.();
        continue;
      }
      this.effects[w++] = e;
      const ctx = e.ground ? g : c;
      ctx.globalAlpha = 1;
      e.draw(ctx, 1 - e.life / e.max, e);
    }
    this.effects.length = w;
    // Particles.
    w = 0;
    for (const p of this.parts) {
      p.life -= t;
      if (p.life <= 0) continue;
      this.parts[w++] = p;
      p.vy += (p.g || 0) * t;
      if (p.drag) {
        p.vx *= 1 - p.drag * t;
        p.vy *= 1 - p.drag * t;
      }
      p.x += p.vx * t;
      p.y += p.vy * t;
      const k = p.life / p.max, s = p.size * (p.grow ? 1 + (1 - k) * p.grow : k * 0.6 + 0.4);
      c.globalAlpha = Math.min(1, k * 1.6);
      if (p.streak) {
        c.strokeStyle = p.color;
        c.lineWidth = s * 0.18;
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        c.stroke();
      } else c.drawImage(p.spr, p.x - s / 2, p.y - s / 2, s, s);
    }
    this.parts.length = w;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    // Numbers and labels (normal blending, outlined instead of shadowed).
    c.globalCompositeOperation = "source-over";
    w = 0;
    c.textAlign = "center";
    c.lineJoin = "round";
    for (const x of this.texts) {
      x.life -= dt;
      if (x.life <= 0) continue;
      this.texts[w++] = x;
      const k = 1 - x.life / x.max;
      c.globalAlpha = Math.min(1, (x.life / x.max) * 2.2);
      const pop = x.pop ? 1 + Math.max(0, 0.35 - k) * 1.6 : 1;
      c.font = `${x.weight || 700} ${Math.round(x.size * pop)}px 'Microsoft YaHei',sans-serif`;
      const y = x.y - k * (x.rise ?? 32);
      if (x.icon?.complete && x.icon.naturalWidth) {
        const width = c.measureText(x.text).width;
        c.drawImage(x.icon, x.x - width / 2 - 22, y - 16, 19, 19);
      }
      c.lineWidth = 3;
      c.strokeStyle = "#0b0f12";
      c.strokeText(x.text, x.x, y);
      c.fillStyle = x.color;
      c.fillText(x.text, x.x, y);
    }
    this.texts.length = w;
    c.globalAlpha = 1;
    // Screen shake on the arena (a compositor-only translate).
    const arena = document.getElementById("arena");
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeT > 0 ? this.shakeMag * Math.min(1, this.shakeT * 6) : 0;
      arena.style.translate = m ? `${(Math.random() - 0.5) * m}px ${(Math.random() - 0.5) * m}px` : "";
    }
  },

  // ---------- primitives ----------
  text(x, y, text, color, size = 14, opts = {}) {
    if (this.texts.length >= this.MAX_TEXTS) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life: opts.life || 0.85, max: opts.life || 0.85, ...opts });
  },
  glowAt(c, x, y, r, color, alpha = 1) {
    c.globalAlpha = alpha;
    c.drawImage(this.sprite(color), x - r, y - r, r * 2, r * 2);
  },
  burst(x, y, color, count = 12, speed = 120, life = 0.5, size = 12, o = {}) {
    for (let i = 0, n = this.n(count); i < n; i++) {
      const a = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread ?? 1) : Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      this.part({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * (o.flat ?? 0.6) - (o.up || 0),
        g: o.g || 0, drag: o.drag ?? 2, life: life * (0.6 + Math.random() * 0.5), size: size * (0.6 + Math.random() * 0.6),
        color, streak: o.streak, grow: o.grow });
    }
  },
  flash(x, y, r, color, life = 0.3) {
    this.add(life, (c, k) => this.glowAt(c, x, y, r * (0.6 + k * 0.6), color, 1 - k));
  },
  ring(x, y, r, color, life = 0.5, width = 4, o = {}) {
    this.add(life, (c, k) => {
      const rr = o.shrink ? r * (1 - k * 0.8) : r * (0.25 + k * 0.85);
      c.globalAlpha = 1 - k;
      c.strokeStyle = color;
      c.lineWidth = width * (1 - k * 0.6);
      c.beginPath();
      c.ellipse(x, y, rr, rr * 0.48, 0, 0, Math.PI * 2);
      c.stroke();
    }, o.delay).ground = !o.air;
  },
  // Pulsing ground decal; `at` may follow a unit.
  disc(at, r, color, life, o = {}) {
    this.add(life, (c, k, e) => {
      const p = typeof at === "function" ? at() : at;
      const fade = Math.min(1, e.life * 3, (1 - k) * 6 + 0.2);
      const pulse = 0.85 + Math.sin((e.max - e.life) * (o.pulse || 7)) * 0.15;
      c.globalAlpha = 0.28 * fade;
      c.fillStyle = color;
      c.beginPath();
      c.ellipse(p.x, p.y, r * pulse, r * 0.48 * pulse, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 0.8 * fade;
      c.strokeStyle = color;
      c.lineWidth = 2.5;
      c.stroke();
      if (o.spokes) {
        const rot = (e.max - e.life) * (o.spin || 1.5);
        for (let i = 0; i < o.spokes; i++) {
          const a = rot + (i / o.spokes) * Math.PI * 2;
          c.beginPath();
          c.moveTo(p.x + Math.cos(a) * r * 0.3, p.y + Math.sin(a) * r * 0.14);
          c.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.48);
          c.stroke();
        }
      }
      if (o.snow && Math.random() < this.quality * 0.9)
        this.part({ x: p.x + (Math.random() - 0.5) * r * 2, y: p.y - 90 - Math.random() * 30, vx: -20, vy: 150,
          life: 0.55, size: 7, color: o.snow, drag: 0 });
      if (o.sparks && Math.random() < this.quality * 0.7) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * r;
        this.part({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d * 0.48, vx: 0, vy: -60, life: 0.6, size: 9, color: o.sparks, drag: 1 });
      }
    }, o.delay).ground = true;
  },
  beam(a, b, color, width = 10, life = 0.4, o = {}) {
    this.add(life, (c, k) => {
      const p = typeof a === "function" ? a() : a, q = typeof b === "function" ? b() : b;
      const w = width * (o.grow ? Math.min(1, k * 5) : 1) * (1 - k * 0.7);
      c.globalAlpha = 1 - k * 0.6;
      c.lineCap = "round";
      c.strokeStyle = color;
      c.lineWidth = w * 1.8;
      c.globalAlpha *= 0.35;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
      c.stroke();
      c.globalAlpha = 1 - k * 0.6;
      c.lineWidth = w * 0.8;
      c.stroke();
      c.strokeStyle = "#ffffff";
      c.lineWidth = Math.max(1, w * 0.25);
      c.stroke();
      if (o.sparks && Math.random() < this.quality) {
        const r = Math.random();
        this.part({ x: p.x + (q.x - p.x) * r, y: p.y + (q.y - p.y) * r, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 40,
          life: 0.4, size: 10, color: o.sparks });
      }
    }, o.delay);
  },
  lightning(a, b, color, life = 0.3, o = {}) {
    const jag = Array.from({ length: 8 }, () => (Math.random() - 0.5) * 2);
    this.add(life, (c, k) => {
      const p = typeof a === "function" ? a() : a, q = typeof b === "function" ? b() : b;
      const d = this.dir(p, q);
      c.globalAlpha = 1 - k;
      c.strokeStyle = color;
      c.lineJoin = "round";
      for (const [w, col] of [[6, color], [2, "#ffffff"]]) {
        c.strokeStyle = col;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(p.x, p.y);
        for (let i = 1; i < 8; i++) {
          const f = i / 8, off = jag[i] * Math.min(18, d.l * 0.12) * (1 + Math.sin(k * 40 + i));
          c.lineTo(p.x + (q.x - p.x) * f - d.y * off, p.y + (q.y - p.y) * f + d.x * off);
        }
        c.lineTo(q.x, q.y);
        c.stroke();
      }
    }, o.delay);
  },
  // Projectile from a → b; `kind` changes the head shape.
  shot(a, b, color, life = 0.35, o = {}) {
    const kind = o.kind || "orb", size = o.size || 10;
    const fx = this.add(life, (c, k, e) => {
      const p = typeof a === "function" ? a() : a, q = typeof b === "function" ? b() : b;
      const kk = o.back ? (k < 0.5 ? k * 2 : 2 - k * 2) : k;
      const arc = (o.arc || 0) * Math.sin(kk * Math.PI);
      const x = p.x + (q.x - p.x) * kk, y = p.y + (q.y - p.y) * kk - arc;
      const d = this.dir(p, q);
      const ang = Math.atan2(q.y - p.y - (o.arc ? Math.cos(kk * Math.PI) * -o.arc * 3 : 0), q.x - p.x) * (o.back && k > 0.5 ? -1 : 1);
      c.globalAlpha = 1;
      if (kind === "arrow" || kind === "bullet" || kind === "bolt") {
        const len = kind === "arrow" ? 26 : kind === "bolt" ? 34 : 14;
        c.strokeStyle = color;
        c.lineCap = "round";
        c.lineWidth = kind === "bullet" ? 3 : 4;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x - d.x * len, y - d.y * len);
        c.stroke();
        c.strokeStyle = "#ffffff";
        c.lineWidth = 1.5;
        c.stroke();
        this.glowAt(c, x, y, size, color, 0.9);
      } else if (kind === "spin" || kind === "card" || kind === "shuriken" || kind === "axe") {
        c.save();
        c.translate(x, y);
        c.rotate((e.max - e.life) * (kind === "card" ? 16 : 22));
        this.glowAt(c, 0, 0, size * 1.6, color, 0.8);
        c.globalAlpha = 1;
        c.fillStyle = kind === "card" ? color : "#f4f7f8";
        c.strokeStyle = color;
        c.lineWidth = 2;
        if (kind === "card") c.fillRect(-6, -9, 12, 18);
        else {
          c.beginPath();
          const blades = kind === "axe" ? 2 : 4;
          for (let i = 0; i < blades * 2; i++) {
            const r = i % 2 ? size * 0.35 : size * 1.05, a2 = (i / (blades * 2)) * Math.PI * 2;
            c.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
          }
          c.closePath();
          c.fill();
          c.stroke();
        }
        c.restore();
      } else if (kind === "rocket") {
        c.save();
        c.translate(x, y);
        c.rotate(ang);
        c.fillStyle = color;
        c.fillRect(-10, -3.5, 20, 7);
        c.fillStyle = "#fff4d0";
        c.fillRect(6, -2.5, 6, 5);
        c.restore();
        this.glowAt(c, x - d.x * 10, y - d.y * 10, size * 1.2, "#ffb347", 0.9);
      } else {
        this.glowAt(c, x, y, size * 1.8, color, 1);
        this.glowAt(c, x, y, size * 0.8, "#ffffff", 0.8);
      }
      if (o.trail !== false && Math.random() < this.quality)
        this.part({ x, y, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: o.trailLife || 0.3,
          size: size * (o.trailSize || 1.2), color: o.trailColor || color, drag: 3 });
    }, o.delay);
    if (o.hit) fx.onEnd = () => o.hit(typeof b === "function" ? b() : b);
  },
  pillar(x, y, color, life = 0.8, h = 220, w = 34, o = {}) {
    this.add(life, (c, k) => {
      const grow = Math.min(1, k * 6), fade = 1 - Math.max(0, k - 0.4) / 0.6;
      c.globalAlpha = 0.9 * fade;
      const g = c.createLinearGradient(x, y - h, x, y);
      g.addColorStop(0, color + "00");
      g.addColorStop(0.6, color + "aa");
      g.addColorStop(1, "#ffffff");
      c.fillStyle = g;
      const ww = w * grow * (1 - k * 0.3);
      c.fillRect(x - ww / 2, y - h * grow, ww, h * grow);
      this.glowAt(c, x, y, w * 1.4, color, fade);
      c.globalAlpha = fade * 0.8;
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(x, y, w * 1.2, w * 0.55, 0, 0, Math.PI * 2);
      c.stroke();
    }, o.delay);
  },
  // Object falls from the sky and detonates.
  meteor(x, y, color, life = 0.55, o = {}) {
    const sx = x + (o.dx ?? -70), sy = y - (o.h || 320);
    const fx = this.add(life, (c, k) => {
      const kk = k * k;
      const px = sx + (x - sx) * kk, py = sy + (y - sy) * kk;
      c.globalAlpha = 0.5;
      c.strokeStyle = color;
      c.lineWidth = (o.size || 14) * 0.9;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px - (x - sx) * 0.18, py - (y - sy) * 0.18);
      c.stroke();
      this.glowAt(c, px, py, (o.size || 14) * 2.2, color, 1);
      this.glowAt(c, px, py, (o.size || 14), "#ffffff", 0.9);
      c.globalAlpha = 0.3 * k;
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(x, y, (o.r || 50) * (1.2 - k * 0.4), (o.r || 50) * 0.5 * (1.2 - k * 0.4), 0, 0, Math.PI * 2);
      c.stroke();
    }, o.delay);
    fx.onEnd = () => {
      this.explode(x, y, color, o.r || 50, o.shake ?? 5);
      o.hit?.();
    };
  },
  explode(x, y, color, r = 50, shake = 4) {
    this.flash(x, y - 10, r * 1.3, color, 0.35);
    this.ring(x, y, r * 1.3, color, 0.5, 5);
    this.burst(x, y - 10, color, 18, r * 4, 0.55, 14, { up: 80, g: 260 });
    this.burst(x, y - 10, "#ffffff", 6, r * 3, 0.3, 8, { streak: true });
    if (shake) this.shake(shake, 0.25);
  },
  // Blades / objects circling a unit for a duration.
  orbit(u, color, life, o = {}) {
    const count = o.count || 3, r = o.r || 46;
    this.add(life, (c, k, e) => {
      if (!u.alive) return;
      const p = this.P(u, o.lift ?? 18), t = (e.max - e.life) * (o.speed || 9);
      const fade = Math.min(1, e.life * 4);
      if (o.floor !== false) {
        c.globalAlpha = 0.45 * fade;
        c.strokeStyle = color;
        c.lineWidth = 3;
        c.beginPath();
        c.ellipse(p.x, p.y + 12, r, r * 0.45, 0, 0, Math.PI * 2);
        c.stroke();
      }
      for (let i = 0; i < count; i++) {
        const a = t + (i / count) * Math.PI * 2, x = p.x + Math.cos(a) * r, y = p.y + 12 + Math.sin(a) * r * 0.45;
        if (o.kind === "blade") {
          c.globalAlpha = fade;
          c.strokeStyle = color;
          c.lineWidth = 4;
          c.beginPath();
          c.arc(p.x, p.y + 12, r, a - 0.5, a, false);
          c.stroke();
        }
        this.glowAt(c, x, y - (o.height || 0), o.size || 12, color, fade);
      }
    });
  },
  tether(a, b, color, life, o = {}) {
    this.add(life, (c, k, e) => {
      if (a.alive === false || b.alive === false) return;
      const p = this.P(a, 40), q = this.P(b, 40), fade = Math.min(1, e.life * 4);
      c.globalAlpha = 0.8 * fade;
      c.strokeStyle = color;
      c.lineWidth = o.width || 3;
      c.setLineDash(o.dash || [10, 6]);
      c.lineDashOffset = -(e.max - e.life) * 60;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.quadraticCurveTo((p.x + q.x) / 2, (p.y + q.y) / 2 + 20 * Math.sin((e.max - e.life) * 6), q.x, q.y);
      c.stroke();
      c.setLineDash([]);
      this.glowAt(c, q.x, q.y, 16, color, fade * 0.8);
    });
  },
  bubble(u, color, life, o = {}) {
    this.add(life, (c, k, e) => {
      if (!u.alive) return;
      const p = this.P(u, o.lift ?? 38), r = o.r || 36, fade = Math.min(1, e.life * 3, k * 8);
      c.globalAlpha = 0.18 * fade;
      c.fillStyle = color;
      c.beginPath();
      c.ellipse(p.x, p.y, r, r * 1.15, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 0.75 * fade;
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.stroke();
      c.globalAlpha = 0.5 * fade;
      c.beginPath();
      c.ellipse(p.x - r * 0.3, p.y - r * 0.45, r * 0.3, r * 0.18, -0.5, 0, Math.PI * 2);
      c.strokeStyle = "#ffffff";
      c.stroke();
    });
  },
  slashes(x, y, color, count = 3, life = 0.35, size = 34, o = {}) {
    const lines = Array.from({ length: count }, (_, i) => ({ a: (o.angle ?? -0.6) + (i - (count - 1) / 2) * (o.gap ?? 0.35), off: (i - (count - 1) / 2) * 9 }));
    this.add(life, (c, k) => {
      const grow = Math.min(1, k * 4);
      c.globalAlpha = 1 - k;
      c.lineCap = "round";
      for (const l of lines)
        for (const [w, col] of [[7, color], [2, "#ffffff"]]) {
          c.strokeStyle = col;
          c.lineWidth = w * (1 - k * 0.5);
          c.beginPath();
          const dx = Math.cos(l.a) * size, dy = Math.sin(l.a) * size;
          c.moveTo(x - dx + l.off, y - dy);
          c.lineTo(x - dx + l.off + dx * 2 * grow, y - dy + dy * 2 * grow);
          c.stroke();
        }
    }, o.delay);
  },
  arcSlash(x, y, r, color, life = 0.28, o = {}) {
    const start = o.start ?? -2.3;
    this.add(life, (c, k) => {
      c.globalAlpha = 1 - k;
      c.lineCap = "round";
      for (const [w, col] of [[o.width || 8, color], [2, "#ffffff"]]) {
        c.strokeStyle = col;
        c.lineWidth = w * (1 - k * 0.5);
        c.beginPath();
        c.ellipse(x, y, r, r * (o.flat ?? 0.6), 0, start + k * 1.5, start + (o.sweep ?? 2.2) + k * 1.5);
        c.stroke();
      }
    }, o.delay);
  },
  cone(a, b, color, life, o = {}) {
    const spread = o.spread || 0.5;
    this.add(life, (c, k, e) => {
      const p = typeof a === "function" ? a() : a, q = typeof b === "function" ? b() : b;
      const ang = Math.atan2(q.y - p.y, q.x - p.x), len = o.len || Math.hypot(q.x - p.x, q.y - p.y) + 40;
      const fade = Math.min(1, e.life * 4, k * 10);
      c.globalAlpha = 0.22 * fade;
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.arc(p.x, p.y, len, ang - spread / 2, ang + spread / 2);
      c.closePath();
      c.fill();
      if (o.bullets && Math.random() < this.quality) {
        const a2 = ang + (Math.random() - 0.5) * spread, v = 600;
        this.part({ x: p.x, y: p.y, vx: Math.cos(a2) * v, vy: Math.sin(a2) * v, life: len / v, size: 10, color, streak: true, drag: 0 });
      }
    });
  },
  dash(from, to, color, o = {}) {
    const a = this.P(from, 40), b = this.P(to, 40);
    this.beam(a, b, color, o.width || 14, o.life || 0.35);
    for (let i = 0; i < this.n(6); i++) {
      const f = i / 6;
      this.part({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, vx: 0, vy: -20, life: 0.4, size: 22, color, drag: 2 });
    }
  },
  banner(u, name, color) {
    const p = this.P(u, 104);
    this.text(p.x + 10, p.y, name, color, 13, { life: 1.2, rise: 16, icon: this.icon(u.heroId), weight: 800 });
  },
};

// Per-hero look: color and basic-attack style ("slash" for melee).
const HERO_STYLE = {
  Vayne: ["#dfe6ff", "arrow"], Garen: ["#ffd766", "slash"], Mordekaiser: ["#6fe07a", "slash"], Fiora: ["#8fd6ff", "slash"],
  Nidalee: ["#7de08a", "spin"], Kassadin: ["#b58cff", "slash"], Tristana: ["#ffae4a", "bullet"], Darius: ["#ff5a4a", "slash"],
  Khazix: ["#c070ff", "slash"], Graves: ["#ffcf6a", "bullet"], Elise: ["#c85aa8", "orb"], Camile: ["#63e6f0", "slash"],
  Nami: ["#58c8ff", "orb"], Varus: ["#d06cff", "arrow"], Ahri: ["#ff7fcf", "orb"], Lulu: ["#c39bff", "orb"],
  Zed: ["#ff4d55", "slash"], Lissandra: ["#9fe4ff", "orb"], Braum: ["#79c7ff", "slash"], Shen: ["#6fb8ff", "slash"],
  Pyke: ["#4fe3c2", "slash"], Blitzcrank: ["#ffe45a", "slash"], TwistedFate: ["#ffd24a", "card"], Jayce: ["#6fd0ff", "slash"],
  Lux: ["#fff39a", "orb"], Kogmaw: ["#a8ff5a", "orb"], Poppy: ["#ffe08a", "slash"], Aatrox: ["#ff4040", "slash"],
  Katarina: ["#ff4a6a", "slash"], Ashe: ["#a9ecff", "arrow"], Kennen: ["#b9a6ff", "shuriken"], Rengar: ["#ffc04a", "slash"],
  Morgana: ["#a85cff", "orb"], Volibear: ["#8fd8ff", "slash"], Evelynn: ["#ff6fb5", "slash"], Veigar: ["#b070ff", "orb"],
  Gangplank: ["#ff9a3a", "bullet"], Shyvana: ["#ff7a2a", "slash"], Vi: ["#ff6fa0", "slash"], Sejuani: ["#9fdcff", "slash"],
  Leona: ["#ffd44a", "slash"], Akali: ["#6affc8", "slash"], Chogath: ["#c65cff", "slash"], AurelionSol: ["#7fa8ff", "orb"],
  Brand: ["#ff7a2a", "orb"], Draven: ["#ff5a3a", "axe"], Kindred: ["#b8e2ff", "arrow"], Gnar: ["#ffb35a", "spin"],
  Jinx: ["#ff6fd6", "bullet"], Wukong: ["#ffc94a", "slash"], Kayle: ["#ffe68a", "orb"], Karthus: ["#88ff7a", "orb"],
  Anivia: ["#8ae2ff", "orb"], Yasuo: ["#bff4ff", "slash"], Swain: ["#e04a5a", "orb"], MissFortune: ["#ff6a6a", "bullet"],
  Pantheon: ["#ffcf5a", "slash"], Kaisa: ["#d884ff", "orb"], TahmKench: ["#7fd6a0", "slash"], Annie: ["#ff8a3a", "orb"],
};
const heroColor = (id) => HERO_STYLE[id]?.[0] || "#edd397";

// Cast / impact recipes. `e` carries unit, target, far, center, targets, card, from.
const SKILL_RECIPES = {
  Garen(F, e, u, col) { F.orbit(u, col, 4, { count: 2, kind: "blade", r: 50, speed: 14 }); F.disc(F.live(u, -6), 60, col, 4, { spokes: 6, spin: 12 }); },
  Mordekaiser(F, e, u, col) { const a = F.P(u, 30), b = F.P(e.target, 30); F.cone(a, b, col, 0.45, { spread: 0.55, len: 160 }); F.explode(b.x, b.y + 30, col, 40, 3); },
  Fiora(F, e, u, col) {
    if (e.stage === "impact") { const p = F.P(e.target, 40); F.slashes(p.x, p.y, col, 2, 0.4, 36, { angle: 0.8, gap: 1.6 }); F.burst(p.x, p.y, "#ffffff", 14, 220, 0.4, 10, { streak: true }); F.shake(3); }
    else { F.bubble(u, col, 1.5, { r: 30 }); F.ring(F.P(u).x, F.P(u).y, 50, col, 0.5); }
  },
  Nidalee(F, e, u, col) { const p = F.P(u, 30); F.burst(p.x, p.y, col, 20, 160, 0.8, 16, { up: 40 }); F.disc(F.live(u, -6), 40, col, 6, { sparks: "#bfffbf", pulse: 3 }); },
  Tristana(F, e, u, col) {
    if (e.stage === "impact") { if (e.target) { const p = F.P(e.target, 0); F.explode(p.x, p.y, col, 58, 5); } }
    else { F.shot(F.P(u, 50), F.live(e.target, 40), col, 0.4, { kind: "orb", arc: 50, size: 11 }); F.orbit(e.target, "#ff5a2a", 4, { count: 1, r: 10, speed: 2, lift: 70, floor: false, size: 14 }); }
  },
  Darius(F, e, u, col) { const p = F.P(u, 0); F.arcSlash(p.x, p.y - 10, 62, col, 0.4, { sweep: 6.2, start: 0, width: 12 }); F.burst(p.x, p.y - 20, "#b01a1a", 16, 200, 0.5, 12, { g: 200 }); F.shake(3); },
  Khazix(F, e, u, col) { const p = F.P(e.target, 40); F.slashes(p.x, p.y, col, 3, 0.35, 32); F.burst(p.x, p.y, col, 10, 180, 0.4, 10, { streak: true }); },
  Elise(F, e, u, col) { const p = F.P(u, 30); F.ring(p.x, p.y + 30, 70, col, 0.6, 3); F.burst(p.x, p.y, "#5a2a6a", 22, 140, 0.9, 20, { grow: 1 }); },
  Camile(F, e, u, col) { F.dash(e.from, u, col); const p = F.P(e.target, 0); F.disc(p, 58, col, 1.5, { spokes: 6, pulse: 10 }); F.slashes(p.x, p.y - 40, col, 1, 0.3, 40, { angle: 0.3 }); },
  Nami(F, e, u, col) { const a = F.P(u, 40); const b = F.P(e.target, 40); F.shot(a, b, col, 0.5, { kind: "orb", size: 16, arc: 40, hit: (q) => F.burst(q.x, q.y, col, 14, 150, 0.5, 14, { up: 60 }) }); },
  Varus(F, e, u, col) { const a = F.P(u, 40); F.flash(a.x, a.y, 40, col, 1.2); F.beam(a, F.P(e.far || e.target, 40), col, 16, 0.55, { delay: 1.1, grow: true, sparks: col }); F.shake(3, 0.2); },
  Ahri(F, e, u, col) {
    if (e.stage === "impact") return;
    const a = F.live(u, 40), b = F.P(e.far || e.target, 40);
    F.shot(a, b, col, 1.0, { kind: "orb", size: 14, back: true, trailColor: "#ffd1f0" });
  },
  Lulu(F, e, u, col) { const p = F.P(u, 40); F.burst(p.x, p.y, col, 18, 140, 0.7, 12, { up: 50 }); F.ring(p.x, p.y + 40, 90, "#9fffbf", 0.6, 3); },
  Zed(F, e, u, col) { const a = F.P(u, 40), b = F.P(e.target, 40), d = F.dir(a, b);
    for (const s of [-0.28, 0, 0.28]) { const ang = Math.atan2(d.y, d.x) + s; F.shot(a, { x: a.x + Math.cos(ang) * 260, y: a.y + Math.sin(ang) * 260 }, col, 0.45, { kind: "shuriken", size: 11 }); } },
  Lissandra(F, e, u, col) {
    const self = u.hp / u.maxHp < 0.5;
    const p = F.P(self ? u : e.target, 0);
    F.disc(p, 55, col, 1.4, { spokes: 8, snow: "#e8fbff" }); F.burst(p.x, p.y - 20, "#ffffff", 16, 200, 0.5, 10, { streak: true, up: 100 });
  },
  Braum(F, e, u, col) {
    const d = F.dir(F.P(u), F.P(e.target));
    F.add(4, (c, k, x) => { if (!u.alive) return; const p = F.P(u, 34), ang = Math.atan2(d.y, d.x), fade = Math.min(1, x.life * 3);
      c.globalAlpha = 0.35 * fade; c.fillStyle = col; c.beginPath(); c.ellipse(p.x + d.x * 30, p.y + d.y * 20, 16, 40, ang, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.9 * fade; c.strokeStyle = "#e8f8ff"; c.lineWidth = 3; c.stroke(); });
  },
  Shen(F, e, u, col) { F.disc(F.live(u, -6), 80, col, 3, { spokes: 4, sparks: col, pulse: 4 }); },
  Pyke(F, e, u, col) { F.dash(e.from, u, col, { width: 18 }); const p = F.P(u, 0); F.ring(p.x, p.y, 70, col, 0.6, 5); F.burst(p.x, p.y - 20, "#bffff0", 16, 200, 0.5, 10, { up: 80, g: 300 }); F.shake(4); },
  Vi(F, e, u, col) { F.dash(e.from, u, col, { width: 20 }); const p = F.P(u, 30); F.explode(p.x, p.y + 30, col, 55, 6); },
  Blitzcrank(F, e, u, col) { const t = e.far || e.target; F.tether(u, t, col, 0.6, { width: 4, dash: [14, 4] }); const p = F.P(t, 40); F.lightning(F.P(u, 40), p, "#fff6a0", 0.3); F.burst(p.x, p.y, col, 14, 180, 0.45, 12, { streak: true }); },
  TwistedFate(F, e, u, col) {
    const color = ["#ffd24a", "#ff4a4a", "#4aa8ff"][e.card ?? 0];
    F.shot(F.P(u, 40), F.live(e.target, 40), color, 0.35, { kind: "card", size: 12, hit: (q) => {
      if (e.card === 1) F.explode(q.x, q.y + 40, color, 50, 3);
      else if (e.card === 2) F.ring(F.P(u).x, F.P(u).y, 110, color, 0.6, 4);
      else { F.burst(q.x, q.y, color, 12, 160, 0.5, 12); F.text(q.x, q.y - 30, "眩晕", color, 13, { life: 0.7 }); }
    } });
  },
  Jayce(F, e, u, col) { const p = F.P(e.target, 0); F.meteor(p.x, p.y, col, 0.3, { h: 140, dx: 0, r: 40, shake: 4 }); F.lightning(F.P(u, 60), F.P(e.target, 30), "#bff0ff", 0.3); },
  Lux(F, e, u, col) { for (const a of Game.engine?.allies(u) || []) F.bubble(a, col, 3, { r: 32 }); const p = F.P(u, 50); F.burst(p.x, p.y, "#ffffff", 20, 220, 0.6, 10, { streak: true }); },
  Kogmaw(F, e, u, col) { F.disc(F.live(u, -6), 45, col, 3, { sparks: col, pulse: 12 }); },
  Poppy(F, e, u, col) { const a = F.P(u, 10), b = F.P(e.target, 10); F.beam(a, b, col, 22, 0.35); F.explode(b.x, b.y, col, 45, 4); },
  Aatrox(F, e, u, col) { const p = F.P(e.target, 0); F.arcSlash(p.x, p.y - 40, 60, col, 0.35, { flat: 1.1, start: -2.6, sweep: 2.4, width: 12 }); F.explode(p.x, p.y, "#aa1020", 55, 6); },
  Katarina(F, e, u, col) { F.orbit(u, col, 2.5, { count: 6, kind: "blade", r: 90, speed: 12, size: 10 }); F.disc(F.live(u, -6), 100, col, 2.5, { pulse: 12 }); },
  Ashe(F, e, u, col) { F.bubble(u, col, 5, { r: 28 }); const a = F.P(u, 40), b = F.P(e.target, 40), d = F.dir(a, b);
    for (let i = -3; i <= 3; i++) { const ang = Math.atan2(d.y, d.x) + i * 0.12; F.shot(a, { x: a.x + Math.cos(ang) * 240, y: a.y + Math.sin(ang) * 240 }, col, 0.4, { kind: "arrow" }); } },
  Kennen(F, e, u, col) {
    F.disc(F.live(u, -6), 115, col, 3, { spokes: 6, spin: 5, pulse: 9 });
    for (let i = 0; i < 6; i++) F.add(0.5, (c, k, x) => { if (x.fired || !u.alive) return; x.fired = true;
      const foes = Game.engine?.enemies(u).filter((o) => Hex.distance(o, u) <= 2) || [];
      const o = foes[Math.floor(Math.random() * foes.length)]; if (o) { const q = F.P(o, 40); F.lightning({ x: q.x, y: q.y - 140 }, q, "#d8ccff", 0.25); F.burst(q.x, q.y, col, 6, 120, 0.3, 10); } }, i * 0.5);
  },
  Rengar(F, e, u, col) { F.dash(e.from, u, col); const p = F.P(e.target, 40); F.slashes(p.x, p.y, col, 3, 0.35, 36, { angle: 0.7 }); F.shake(3); },
  Morgana(F, e, u, col) {
    if (e.stage === "impact") { const p = F.P(e.target, 40); F.burst(p.x, p.y, col, 14, 160, 0.5, 14); F.ring(p.x, p.y + 40, 40, col, 0.5); return; }
    for (const t of e.targets || []) F.tether(u, t, col, 3, { width: 3 });
    F.disc(F.live(u, -6), 110, "#5a2a8a", 3, { pulse: 3 });
  },
  Volibear(F, e, u, col) { const p = F.P(u, 70); F.lightning({ x: p.x, y: p.y - 150 }, F.P(u, 10), "#e0f6ff", 0.35); F.orbit(u, col, 6, { count: 3, r: 34, speed: 6, height: 50, floor: false, size: 10 }); F.shake(3); },
  Evelynn(F, e, u, col) { const a = F.P(e.from, 40), b = F.P(e.target, 40); F.cone(a, b, col, 0.4, { spread: 0.9, len: 170 }); F.burst(a.x, a.y, "#3a1a3a", 18, 100, 0.8, 22, { grow: 1 }); },
  Veigar(F, e, u, col) { const p = F.P(e.target, 0); F.meteor(p.x, p.y, col, 0.45, { r: 40, size: 16, shake: 4 }); },
  Gangplank(F, e, u, col) { const c0 = e.center || e.target; const p = F.P(c0, 0);
    for (let i = 0; i < 5; i++) F.meteor(p.x + (Math.random() - 0.5) * 120, p.y + (Math.random() - 0.5) * 50, col, 0.5, { delay: i * 0.12, r: 45, size: 10, shake: 3 }); },
  Shyvana(F, e, u, col) { const p = F.P(u, 40); F.explode(p.x, p.y + 40, col, 70, 6); F.burst(p.x, p.y, "#ffdd66", 26, 260, 0.8, 16, { up: 120, g: 200 }); },
  Sejuani(F, e, u, col) {
    const p = F.P(e.center || e.target, 0);
    if (e.stage === "impact") { F.explode(p.x, p.y, col, 90, 6); F.burst(p.x, p.y - 20, "#ffffff", 20, 260, 0.6, 12, { streak: true, up: 120 }); }
    else { F.disc(p, 100, col, 1, { snow: "#ffffff", pulse: 10 }); F.shot(F.P(u, 30), { x: p.x, y: p.y - 10 }, col, 0.8, { kind: "orb", size: 16, arc: 30 }); }
  },
  Leona(F, e, u, col) { const p = F.P(e.center || e.target, 0); F.pillar(p.x, p.y, col, 0.9, 260, 60); F.meteor(p.x, p.y, "#fff2a0", 0.35, { dx: 0, h: 260, r: 55, size: 20, shake: 5 }); },
  Akali(F, e, u, col) { const a = F.P(u, 40), b = F.P(e.target, 40); F.cone(a, b, col, 0.3, { spread: 0.6, len: 170, bullets: true }); F.burst(a.x, a.y + 30, "#a0b8b0", 14, 60, 1, 24, { grow: 1.2 }); },
  Chogath(F, e, u, col) { const p = F.P(e.center || e.target, 0); F.disc(p, 95, col, 0.9, { spokes: 10, pulse: 14 });
    F.add(0.4, (c, k) => { c.globalAlpha = 1 - k; c.fillStyle = "#e0b0ff"; for (let i = 0; i < 9; i++) { const a = i * 0.7, r = 25 + (i % 3) * 25, x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r * 0.45; c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x, y - 40 * Math.min(1, k * 5)); c.lineTo(x + 6, y); c.fill(); } }, 0.7);
    F.shake(5, 0.3); },
  AurelionSol(F, e, u, col) { const a = F.P(u, 40), b = F.P(e.far || e.target, 40); F.beam(a, b, col, 30, 0.7, { grow: true, sparks: "#ffffff" });
    for (let i = 0; i < F.n(12); i++) F.part({ x: a.x, y: a.y, vx: (b.x - a.x) * (1 + Math.random()), vy: (b.y - a.y) * (1 + Math.random()) - 40, life: 0.6, size: 10, color: "#ffe9a0", drag: 1 }); F.shake(4, 0.35); },
  Brand(F, e, u, col) { const p = F.P(u, 40); F.flash(p.x, p.y, 40, col, 0.4); },
  Draven(F, e, u, col) { F.orbit(u, col, 8, { count: Math.min(2, u.stacks?.axes || 1), r: 22, speed: 10, height: 55, floor: false, size: 12 }); },
  Kindred(F, e, u, col) { F.disc(F.live(u, -6), 125, col, 2.5, { spokes: 8, spin: 0.6, pulse: 2, sparks: "#ffffff" }); },
  Gnar(F, e, u, col) { const p = F.P(u, 0); F.dash(e.from, u, col, { width: 24 }); F.explode(p.x, p.y, col, 95, 8); },
  Wukong(F, e, u, col) { F.orbit(u, col, 3, { count: 2, kind: "blade", r: 58, speed: 16 }); F.disc(F.live(u, -6), 64, col, 3, { spokes: 3, spin: 16 }); },
  Kayle(F, e, u, col) { const allies = (Game.engine?.allies(u) || []).filter((a) => Game.engine.has(a, "immune"));
    for (const a of allies) { const p = F.P(a, 0); F.pillar(p.x, p.y, col, 1, 240, 44); F.bubble(a, col, 2.5, { r: 34 }); } },
  Karthus(F, e, u, col) {
    if (e.stage === "impact") { for (const t of e.targets || []) { const p = F.P(t, 0); F.pillar(p.x, p.y, col, 0.9, 200, 40); F.burst(p.x, p.y - 30, col, 8, 120, 0.6, 14, { up: 60 }); } F.shake(4); return; }
    F.disc(F.live(u, -6), 50, col, 3, { spokes: 5, spin: 3, sparks: col });
  },
  Anivia(F, e, u, col) { const p = F.P(e.center || e.target, 0); F.disc(p, 115, col, 6, { snow: "#ffffff", pulse: 2, spokes: 6, spin: 0.8 }); },
  Yasuo(F, e, u, col) {
    const big = (u.casts || 0) % 3 === 0, a = F.P(u, 10), b = F.P(e.far || e.target, 10);
    F.add(0.6, (c, k) => { const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k; c.globalAlpha = 1 - k * 0.5; c.strokeStyle = col; c.lineWidth = big ? 4 : 2;
      for (let i = 0; i < 5; i++) { const r = (big ? 14 : 9) + i * (big ? 6 : 4); c.beginPath(); c.ellipse(x + Math.sin(k * 30 + i) * 4, y - i * (big ? 14 : 9), r, r * 0.35, 0, 0, Math.PI * 2); c.stroke(); } });
    if (big) F.shake(3);
  },
  Swain(F, e, u, col) {
    if (e.stage === "impact") { const p = F.P(u, 0); F.explode(p.x, p.y, col, 110, 8); return; }
    F.orbit(u, "#551a22", 6, { count: 5, r: 70, speed: 3, height: 35, size: 16 }); F.disc(F.live(u, -6), 115, col, 6, { pulse: 4, sparks: col });
  },
  MissFortune(F, e, u, col) { F.cone(F.live(u, 40), F.live(e.far || e.target, 40), col, 3, { spread: 0.7, bullets: true }); },
  Pantheon(F, e, u, col) {
    if (e.stage === "impact") { const p = F.P(e.center, 0); F.meteor(p.x, p.y, col, 0.25, { dx: -120, h: 360, r: 70, size: 24, shake: 9 }); F.pillar(p.x, p.y, "#ff9a3a", 0.8, 160, 70, { delay: 0.22 }); return; }
    const p = F.P(u, 40); F.pillar(p.x, p.y + 40, col, 0.7, 300, 30); F.burst(p.x, p.y, col, 16, 160, 0.6, 12, { up: 220 });
  },
  Kaisa(F, e, u, col) { F.dash(e.from, u, col); const a = F.P(u, 50), foes = Game.engine?.enemies(u) || [];
    for (let i = 0; i < 6; i++) { const t = foes[i % Math.max(1, foes.length)]; if (t) F.shot(a, F.live(t, 40), col, 0.5, { kind: "orb", arc: 60 + i * 12, size: 7, delay: i * 0.05 }); }
    F.bubble(u, col, 3, { r: 30 }); },
  Annie(F, e, u, col) { const p = F.P(e.target, 0); F.explode(p.x, p.y, col, 60, 5); F.bubble(u, "#ffb04a", 3, { r: 32 }); },
  Jinx(F, e, u, col) { F.shot(F.P(u, 50), F.live(e.target, 40), col, 0.5, { kind: "rocket", arc: 70, size: 12, hit: (q) => F.explode(q.x, q.y + 40, "#ff8a3a", 60, 6) }); },
  Vayne(F, e, u, col) { if (e.stage !== "proc") return; const p = F.P(e.target, 40);
    F.add(0.45, (c, k) => { c.globalAlpha = 1 - k; c.strokeStyle = "#e8f0ff"; c.lineWidth = 3; c.beginPath(); for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 3 + k; c.lineTo(p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 26); } c.closePath(); c.stroke(); });
    F.burst(p.x, p.y, "#ffffff", 10, 180, 0.35, 8, { streak: true }); },
};
