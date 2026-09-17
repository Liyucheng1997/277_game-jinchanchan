"use strict";
const HEROES = OFFICIAL.heroes,
  ITEMS = OFFICIAL.items,
  TRAITS = OFFICIAL.traits;
// Keep the original snapshot intact when moving between independently saved modes.
const GameVersions = {
  current: "rift",
  originalHeroes: structuredClone(HEROES),
  originalTraits: structuredClone(TRAITS),
  names: { rift: "时空裂痕", fortune: "福星" },
  fortuneHeroes: ["TahmKench", "Annie", "Katarina", "Jinx", "Sejuani"],
  configure(mode) {
    this.current = mode === "fortune" ? "fortune" : "rift";
    for (const key of Object.keys(HEROES)) delete HEROES[key];
    for (const key of Object.keys(TRAITS)) delete TRAITS[key];
    Object.assign(HEROES, structuredClone(this.originalHeroes));
    Object.assign(TRAITS, structuredClone(this.originalTraits));
    if (this.current !== "fortune") return;
    TRAITS.fortune = { id: "fortune", name: "福星", icon: "assets/fortune/fortune.svg",
      thresholds: [3, 6], desc: "弈士战斗获胜掉落福袋，连败越多，收菜越丰厚。仅开战时激活福星才计入；暂时撤下保留积累。野怪不影响。本地改编规则。",
      effects: ["3 福星：胜利掉落 3 + 3×连败数 + 连败数² 金币（连败奖励最多按 12 场计算）；每 3 败额外一件基础装备，最多 4 件。", "6 福星：每次胜利额外获得 10 金币和一件随机非纹章成装。福星天选额外计为一名福星。"] };
    const add = (id, name, template, cost, traits, stats, skill) => {
      HEROES[id] = { ...structuredClone(HEROES[template]), id, name, cost, traits, ...stats,
        portrait: `assets/fortune/${id}.png`, splash: `assets/fortune/${id}.jpg`,
        skill: { ...skill, icon: `assets/fortune/${id}.png` } };
    };
    add("TahmKench", "塔姆", "Braum", 1, ["fortune", "j4"],
      { hp: [700,1260,2268], atk: [60,108,194], armor: 40, mr: 40, mana: 0, startMana: 0 },
      { name: "厚实表皮", desc: "被动：每次受到伤害减少 [2#0] 点。", values: ["15/25/50"] });
    add("Annie", "安妮", "Brand", 2, ["fortune", "j10"],
      { hp: [750,1350,2430], atk: [45,81,146], armor: 40, mr: 40, range: 2, mana: 65, startMana: 0 },
      { name: "爆裂护盾", desc: "对目标及邻格敌人造成 [2#0] 魔法伤害，并获得持续 6 秒的 [2#1] 护盾。", values: ["250/400/650", "400/600/900"] });
    for (const id of ["Katarina", "Jinx", "Sejuani"]) HEROES[id].traits = ["fortune", ...HEROES[id].traits.filter(t => t.startsWith("j"))];
    HEROES.Katarina.name = "卡特琳娜";
    HEROES.Sejuani.name = "瑟庄妮";
    Object.assign(HEROES.Jinx, { name: "金克丝", cost: 3, mana: 60, startMana: 0,
      skill: { name: "震荡火箭", desc: "对目标及邻格敌人造成 [2#0] 魔法伤害并眩晕 [2#1] 秒。", values: ["200/350/600", "1.5/2/3"], icon: "assets/official/skills/Jinx.png" } });
  },
  reward(losses, six = false) {
    const n = Math.min(12, Math.max(0, losses));
    return { gold: 3 + 3 * n + n * n + (six ? 10 : 0), components: Math.min(4, Math.floor(n / 3)), completed: six ? 1 : 0 };
  },
};
const COLS = 7,
  ROWS = 8,
  BENCH_SIZE = 9,
  MAX_LEVEL = 9;
const XP_REQ = { 1: 2, 2: 2, 3: 6, 4: 10, 5: 20, 6: 36, 7: 56, 8: 80 };
const ODDS = {
  1: [100, 0, 0, 0, 0],
  2: [100, 0, 0, 0, 0],
  3: [75, 25, 0, 0, 0],
  4: [55, 30, 15, 0, 0],
  5: [45, 33, 20, 2, 0],
  6: [25, 40, 30, 5, 0],
  7: [19, 30, 35, 15, 1],
  8: [15, 20, 35, 25, 5],
  9: [10, 15, 30, 30, 15],
};
const POOL_SIZE = { 1: 29, 2: 22, 3: 18, 4: 12, 5: 10 };
const BASE_ITEMS = Object.keys(ITEMS).filter((k) => !ITEMS[k].recipe.length);
const RECIPES = Object.fromEntries(
  Object.values(ITEMS)
    .filter((i) => i.recipe.length)
    .map((i) => [i.recipe.slice().sort().join("+"), i.id]),
);
const EMBLEMS = {
  4108: "j1",
  4115: "j2",
  4121: "j10",
  4126: "r1",
  4130: "j7",
  4133: "j8",
  4135: "r5",
  4147: "r12",
};
const COST_COLORS = [
  "#82958e",
  "#a5b5b4",
  "#56caa1",
  "#53b8ed",
  "#c086ec",
  "#e5bc63",
];
const Hex = {
  cube(x, y) {
    const q = x - (y - (y & 1)) / 2;
    return [q, -q - y, y];
  },
  distance(a, b) {
    const ac = this.cube(a.x, a.y),
      bc = this.cube(b.x, b.y);
    return Math.max(...ac.map((v, i) => Math.abs(v - bc[i])));
  },
  neighbors(p) {
    const dirs =
      p.y & 1
        ? [
            [1, 0],
            [-1, 0],
            [0, -1],
            [1, -1],
            [0, 1],
            [1, 1],
          ]
        : [
            [1, 0],
            [-1, 0],
            [-1, -1],
            [0, -1],
            [-1, 1],
            [0, 1],
          ];
    return dirs
      .map(([x, y]) => ({ x: p.x + x, y: p.y + y }))
      .filter((p) => p.x >= 0 && p.x < 7 && p.y >= 0 && p.y < 8);
  },
  point(x, y) {
    const width = 470 + y * 15;
    return {
      x: 625 + ((x - 3 + (y & 1 ? 0.25 : -0.25)) * width) / 7,
      y: 178 + y * 40,
    };
  },
  key(p) {
    return p.x + "," + p.y;
  },
  cells() {
    return Array.from({ length: 56 }, (_, i) => ({
      x: i % 7,
      y: Math.floor(i / 7),
    }));
  },
};
const rand = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
function stageOf(r) {
  return r < 4 ? 1 : 2 + Math.floor((r - 4) / 7);
}
function stepOf(r) {
  return r < 4 ? r + 1 : 1 + ((r - 4) % 7);
}
function roundName(r) {
  return stageOf(r) + "-" + stepOf(r);
}
function roundType(r) {
  if (r === 0 || (r >= 4 && stepOf(r) === 4)) return "carousel";
  if (r < 4 || stepOf(r) === 7) return "pve";
  return "pvp";
}
function unitTraits(u) {
  return [
    ...new Set([
      ...HEROES[u.heroId].traits,
      ...(u.items || []).map((i) => EMBLEMS[i]).filter(Boolean),
    ]),
  ];
}
function traitCounts(units) {
  const cnt = {},
    seen = new Set();
  for (const u of units) {
    if (!HEROES[u.heroId] || seen.has(u.heroId)) continue;
    seen.add(u.heroId);
    for (const t of unitTraits(u)) cnt[t] = (cnt[t] || 0) + 1;
  }
  // Count a Chosen bonus even if a duplicate normal copy appeared first.
  if (units.some(u => u.chosen === "fortune" && HEROES[u.heroId]?.traits.includes("fortune"))) cnt.fortune = (cnt.fortune || 0) + 1;
  return cnt;
}
function tierOf(t, n) {
  if (t === "r11" && n !== 1 && n !== 4) return 0;
  return TRAITS[t]?.thresholds.filter((x) => n >= x).length || 0;
}
function skillValue(h, star, i = 0, fallback = 0) {
  const v =
    h.skill.values[i]?.split("/")[star - 1] ?? h.skill.values[i]?.split("/")[0];
  return v === undefined
    ? fallback
    : parseFloat(v) / (v.includes("%") ? 100 : 1);
}
function skillDesc(h, star = 1) {
  return (
    h.skill.desc ||
    "选牌：强化下一次攻击，造成魔法伤害，并随机附加眩晕、范围伤害或法力回复。"
  ).replace(/\[(\d+)#(\d+)\]/g, (_, type, i) => {
    const v =
      h.skill.values[i]?.split("/")[star - 1] ??
      h.skill.values[i]?.split("/")[0] ??
      "—";
    return `<b>${v}</b>`;
  });
}
function itemStats(id) {
  const i = ITEMS[id],
    s = {};
  if (!i) return s;
  const map = {
    物理加成: "ad",
    攻击力: "ad",
    攻击速度: "as",
    法术加成: "ap",
    法术强度: "ap",
    护甲: "armor",
    魔法抗性: "mr",
    生命上限: "hp",
    暴击率: "crit",
    法力回复: "regen",
    法力值: "mana",
    全能吸血: "vamp",
    伤害增幅: "amp",
    伤害减免: "reduce",
  };
  for (const m of i.basic.matchAll(
    /\+(\d+(?:\.\d+)?)(%?)(物理加成|攻击力|攻击速度|法术加成|法术强度|护甲|魔法抗性|生命上限|暴击率|法力回复|法力值|全能吸血|伤害增幅|伤害减免)/g,
  )) {
    const k = map[m[3]];
    s[k] =
      (s[k] || 0) + Number(m[1]) / (m[2] || ["ad", "ap"].includes(k) ? 100 : 1);
  }
  return s;
}
const CREEPS = {
  minion: {
    id: "minion",
    name: "近战小兵",
    hp: 240,
    atk: 20,
    armor: 10,
    mr: 0,
    range: 1,
    aspeed: 0.65,
    color: "#ce8b70",
  },
  caster: {
    id: "caster",
    name: "远程小兵",
    hp: 180,
    atk: 24,
    armor: 5,
    mr: 0,
    range: 3,
    aspeed: 0.6,
    color: "#978dda",
  },
  krug: {
    id: "krug",
    name: "远古魔像",
    hp: 1250,
    atk: 90,
    armor: 35,
    mr: 20,
    range: 1,
    aspeed: 0.55,
    color: "#b3a17b",
  },
  wolf: {
    id: "wolf",
    name: "暗影狼",
    hp: 700,
    atk: 90,
    armor: 20,
    mr: 20,
    range: 1,
    aspeed: 0.95,
    color: "#8cbac0",
  },
  raptor: {
    id: "raptor",
    name: "锋喙鸟",
    hp: 1050,
    atk: 105,
    armor: 25,
    mr: 25,
    range: 1,
    aspeed: 0.85,
    color: "#c6737f",
  },
  dragon: {
    id: "dragon",
    name: "炼狱亚龙",
    hp: 6500,
    atk: 250,
    armor: 50,
    mr: 100,
    range: 3,
    aspeed: 0.7,
    color: "#ef9561",
  },
  herald: {
    id: "herald",
    name: "峡谷先锋",
    hp: 12000,
    atk: 320,
    armor: 70,
    mr: 50,
    range: 1,
    aspeed: 0.6,
    color: "#b986e9",
  },
  golem: {
    id: "golem",
    name: "元素魔像",
    hp: 1800,
    atk: 100,
    armor: 40,
    mr: 40,
    range: 1,
    aspeed: 0.6,
    color: "#76c3ae",
  },
  spider: {
    id: "spider",
    name: "幼蛛",
    hp: 250,
    atk: 40,
    armor: 10,
    mr: 10,
    range: 1,
    aspeed: 0.8,
    color: "#986c9b",
  },
};
function creepWave(r) {
  const s = stageOf(r);
  let ids =
    r === 1
      ? ["minion", "caster"]
      : r === 2
        ? ["minion", "minion", "caster"]
        : r === 3
          ? ["minion", "minion", "caster", "caster"]
          : s === 2
            ? ["krug", "krug", "krug"]
            : s === 3
              ? ["wolf", "wolf", "wolf", "wolf", "wolf"]
              : s === 4
                ? ["raptor", "raptor", "raptor", "raptor", "raptor"]
                : s === 5
                  ? ["dragon"]
                  : ["herald"];
  return ids.map((id) => ({
    creepId: id,
    star: 1,
    mult: s > 6 ? 1 + (s - 6) * 0.4 : 1,
    items: [],
  }));
}
const BOT_NAMES = [
  "月下听风",
  "只差一张",
  "好运常在",
  "银河小企鹅",
  "一只小河灵",
  "今天也要吃鸡",
  "晚风与星河",
];
const BOT_PLANS = [
  ["Garen", "Vayne", "Fiora", "Lux", "Leona", "Wukong", "Kayle"],
  ["Darius", "Mordekaiser", "Poppy", "Draven", "Sejuani", "Swain", "Kayle"],
  ["Nidalee", "Ahri", "Lulu", "Shyvana", "Gnar", "AurelionSol", "Swain"],
  ["Khazix", "Zed", "Pyke", "Rengar", "Katarina", "Akali", "Kaisa"],
  ["Graves", "Tristana", "TwistedFate", "Gangplank", "Jinx", "MissFortune"],
  ["Varus", "Elise", "Morgana", "Aatrox", "Brand", "Swain"],
  ["Braum", "Lissandra", "Ashe", "Volibear", "Sejuani", "Anivia"],
];
