'use strict';
/* ============ 基础常量 ============ */
const COLS = 7, ROWS = 8, CELL = 64;
const PLAYER_ROW_MIN = 4; // 玩家可放置 y=4..7
const BENCH_SIZE = 9;
const MAX_LEVEL = 8;
const TOTAL_ROUNDS = 25;

/* 升级所需经验（当前等级 -> 升到下一级所需） */
const XP_REQ = { 2: 6, 3: 10, 4: 18, 5: 30, 6: 48, 7: 72 };

/* 商店概率：等级 -> [1费,2费,3费,4费] 百分比 */
const ODDS = {
  2: [100, 0, 0, 0],
  3: [70, 30, 0, 0],
  4: [50, 35, 15, 0],
  5: [40, 35, 22, 3],
  6: [30, 35, 27, 8],
  7: [20, 32, 32, 16],
  8: [14, 24, 34, 28],
};

/* 每个英雄在牌池里的份数（按费用） */
const POOL_SIZE = { 1: 24, 2: 18, 3: 15, 4: 10 };

/* ============ 羁绊 ============ */
const ORIGINS = {
  fire:   { name: '烈焰', icon: '🔥', thresholds: [2, 4],
            desc: '烈焰单位的普攻点燃敌人，每秒造成真实伤害，持续3秒。<br>(2) 10/秒　(4) 26/秒' },
  ice:    { name: '寒冰', icon: '❄️', thresholds: [2, 4],
            desc: '寒冰单位的普攻冰缓敌人，降低攻速，持续3秒。<br>(2) -25%　(4) -50%' },
  forest: { name: '森林', icon: '🌿', thresholds: [2, 4],
            desc: '全队每秒回复最大生命值。<br>(2) 0.6%　(4) 1.6%' },
};
const CLASSES = {
  warrior:  { name: '战士', icon: '🛡️', thresholds: [2, 4],
              desc: '战士获得额外护甲。<br>(2) +30　(4) +75' },
  archer:   { name: '射手', icon: '🏹', thresholds: [2, 3],
              desc: '射手获得额外攻速。<br>(2) +35%　(3) +80%' },
  mage:     { name: '法师', icon: '🔮', thresholds: [2, 4],
              desc: '法师获得法术强度。<br>(2) +35%　(4) +90%' },
  assassin: { name: '刺客', icon: '🗡️', thresholds: [2, 3],
              desc: '开战时刺客跃入敌方后排。<br>(2) +40%暴击率　(3) +70%暴击率' },
};

/* ============ 英雄 ============ */
/* star1 基础属性；升星后 生命/攻击 ×1.8 每星 */
const HEROES = {
  yanren:   { id: 'yanren', name: '焰刃', emoji: '⚔️', cost: 1, origin: 'fire', cls: 'warrior',
    hp: 650, atk: 55, as: 0.7, range: 1, armor: 35, manaMax: 70, manaStart: 20,
    skill: { name: '烈焰斩', desc: '重斩当前目标，造成 {dmg} 魔法伤害并点燃3秒。',
      vals: { dmg: [180, 280, 460] } } },
  bingyu:   { id: 'bingyu', name: '冰羽', emoji: '🏹', cost: 1, origin: 'ice', cls: 'archer',
    hp: 480, atk: 52, as: 0.8, range: 3, armor: 20, manaMax: 60, manaStart: 0,
    skill: { name: '穿心冰箭', desc: '射出冰箭，造成 {dmg} 魔法伤害并冰冻 {t} 秒。',
      vals: { dmg: [170, 270, 440], t: [1, 1, 1.5] } } },
  tengci:   { id: 'tengci', name: '藤刺', emoji: '🌿', cost: 1, origin: 'forest', cls: 'assassin',
    hp: 560, atk: 58, as: 0.75, range: 1, armor: 25, manaMax: 70, manaStart: 10,
    skill: { name: '毒之刃', desc: '刺击目标，造成 {dmg} 魔法伤害，并附加3秒剧毒（每秒 {dps}）。',
      vals: { dmg: [150, 240, 390], dps: [30, 45, 75] } } },
  huohua:   { id: 'huohua', name: '火花', emoji: '✨', cost: 1, origin: 'fire', cls: 'mage',
    hp: 480, atk: 42, as: 0.7, range: 3, armor: 20, manaMax: 60, manaStart: 10,
    skill: { name: '火球术', desc: '投掷火球，对目标及周围一格敌人造成 {dmg} 魔法伤害。',
      vals: { dmg: [190, 300, 500] } } },

  bingjia:  { id: 'bingjia', name: '冰甲', emoji: '🧊', cost: 2, origin: 'ice', cls: 'warrior',
    hp: 850, atk: 60, as: 0.65, range: 1, armor: 45, manaMax: 80, manaStart: 30,
    skill: { name: '冰霜护甲', desc: '获得 {sh} 护盾，持续4秒；护盾期间攻击他的敌人被冰缓30%。',
      vals: { sh: [280, 450, 750] } } },
  yangong:  { id: 'yangong', name: '焰弓', emoji: '🎯', cost: 2, origin: 'fire', cls: 'archer',
    hp: 560, atk: 68, as: 0.85, range: 3, armor: 20, manaMax: 70, manaStart: 0,
    skill: { name: '爆裂箭雨', desc: '向最近的3名敌人各射一箭，造成 {dmg} 魔法伤害。',
      vals: { dmg: [150, 240, 400] } } },
  muling:   { id: 'muling', name: '木灵', emoji: '🍃', cost: 2, origin: 'forest', cls: 'mage',
    hp: 560, atk: 45, as: 0.7, range: 3, armor: 20, manaMax: 50, manaStart: 20,
    skill: { name: '治愈之风', desc: '治疗生命值最低的友军 {heal} 点生命。',
      vals: { heal: [260, 420, 700] } } },
  shuangren:{ id: 'shuangren', name: '霜刃', emoji: '🔪', cost: 2, origin: 'ice', cls: 'assassin',
    hp: 640, atk: 68, as: 0.8, range: 1, armor: 30, manaMax: 80, manaStart: 20,
    skill: { name: '霜之突袭', desc: '闪现到生命最低的敌人身边，造成 {dmg} 魔法伤害并冰冻1秒。',
      vals: { dmg: [200, 320, 520] } } },

  senzhishou:{ id: 'senzhishou', name: '森之守', emoji: '🌳', cost: 3, origin: 'forest', cls: 'warrior',
    hp: 1050, atk: 70, as: 0.65, range: 1, armor: 55, manaMax: 90, manaStart: 40,
    skill: { name: '荆棘壁垒', desc: '获得 {sh} 护盾，持续5秒；护盾期间反弹所受普攻伤害的30%。',
      vals: { sh: [350, 560, 950] } } },
  bingjing: { id: 'bingjing', name: '冰晶', emoji: '💎', cost: 3, origin: 'ice', cls: 'mage',
    hp: 620, atk: 50, as: 0.7, range: 3, armor: 25, manaMax: 70, manaStart: 15,
    skill: { name: '暴风雪', desc: '对所有敌人造成 {dmg} 魔法伤害并冰缓40%，持续3秒。',
      vals: { dmg: [140, 220, 380] } } },
  yanying:  { id: 'yanying', name: '炎影', emoji: '👤', cost: 3, origin: 'fire', cls: 'assassin',
    hp: 720, atk: 82, as: 0.85, range: 1, armor: 30, manaMax: 90, manaStart: 30,
    skill: { name: '灼热连斩', desc: '连续斩击3次，每次造成 {dmg} 魔法伤害并点燃敌人。',
      vals: { dmg: [80, 130, 220] } } },

  fenghuang:{ id: 'fenghuang', name: '凤凰', emoji: '🐦‍🔥', cost: 4, origin: 'fire', cls: 'mage',
    hp: 850, atk: 60, as: 0.75, range: 3, armor: 30, manaMax: 100, manaStart: 40,
    skill: { name: '浴火', desc: '烈焰爆发：对目标周围两格内敌人造成 {dmg} 魔法伤害并点燃，自身回复 {heal} 生命。',
      vals: { dmg: [280, 450, 760], heal: [250, 400, 650] } } },
  gushu:    { id: 'gushu', name: '古树', emoji: '🌲', cost: 4, origin: 'forest', cls: 'warrior',
    hp: 1400, atk: 75, as: 0.6, range: 1, armor: 60, manaMax: 110, manaStart: 50,
    skill: { name: '震地横扫', desc: '横扫周围一格敌人，造成 {dmg} 魔法伤害并眩晕 {t} 秒。',
      vals: { dmg: [220, 350, 600], t: [1.2, 1.5, 2] } } },
  binglong: { id: 'binglong', name: '冰龙', emoji: '🐉', cost: 4, origin: 'ice', cls: 'archer',
    hp: 800, atk: 78, as: 0.8, range: 3, armor: 30, manaMax: 90, manaStart: 30,
    skill: { name: '极寒吐息', desc: '向最近的3名敌人吐息，造成 {dmg} 魔法伤害并冰缓50%，持续3秒。',
      vals: { dmg: [220, 350, 570] } } },
};

/* ============ 野怪 ============ */
const CREEPS = {
  wolf:  { id: 'wolf', name: '野狼', emoji: '🐺', cost: 0, hp: 420, atk: 42, as: 0.7, range: 1, armor: 15, manaMax: 0, manaStart: 0 },
  boar:  { id: 'boar', name: '野猪', emoji: '🐗', cost: 0, hp: 900, atk: 60, as: 0.6, range: 1, armor: 25, manaMax: 0, manaStart: 0 },
  golem: { id: 'golem', name: '石魔', emoji: '🗿', cost: 0, hp: 1700, atk: 85, as: 0.55, range: 1, armor: 45, manaMax: 0, manaStart: 0 },
};

/* ============ 装备 ============ */
const ITEMS = {
  sword:   { id: 'sword', name: '利剑', emoji: '⚔️', weight: 1, desc: '+25 攻击力',
             apply: s => { s.atk += 25; } },
  staff:   { id: 'staff', name: '法杖', emoji: '🪄', weight: 1, desc: '+30% 法术强度',
             apply: s => { s.sp += 30; } },
  plate:   { id: 'plate', name: '重甲', emoji: '🛡️', weight: 1, desc: '+30 护甲',
             apply: s => { s.armor += 30; } },
  heart:   { id: 'heart', name: '生命宝石', emoji: '❤️', weight: 1, desc: '+250 生命值',
             apply: s => { s.hp += 250; } },
  feather: { id: 'feather', name: '疾风羽', emoji: '🪶', weight: 1, desc: '+25% 攻击速度',
             apply: s => { s.asMult += 0.25; } },
  gem:     { id: 'gem', name: '蓝水晶', emoji: '🔷', weight: 1, desc: '开战时获得 40 法力',
             apply: s => { s.manaStart += 40; } },
  spatula: { id: 'spatula', name: '金铲铲', emoji: '🥄', weight: 0.4, desc: '传说！攻击/生命/护甲 +15%，攻速/法强 +15%',
             apply: s => { s.atk *= 1.15; s.hp *= 1.15; s.armor *= 1.15; s.asMult += 0.15; s.sp += 15; } },
};

/* ============ 敌方波次 ============ */
/* e(id, star)：英雄；c(id, mult)：野怪（mult 为额外属性倍率） */
function _e(id, star) { return { kind: 'hero', id, star }; }
function _c(id, mult = 1) { return { kind: 'creep', id, mult }; }

const WAVES = [
  /* 阶段 1 */
  { units: [_c('wolf'), _c('wolf')] },
  { units: [_c('wolf'), _c('wolf'), _c('wolf')] },
  { units: [_c('wolf'), _c('wolf'), _c('boar')] },
  { units: [_e('yanren', 1), _e('huohua', 1), _e('bingyu', 1)] },
  { units: [_e('yanren', 1), _e('yangong', 1), _e('huohua', 1), _e('bingyu', 1)] },
  /* 阶段 2 */
  { units: [_e('bingjia', 1), _e('shuangren', 1), _e('bingyu', 1), _e('huohua', 1)] },
  { units: [_e('yanren', 2), _e('huohua', 1), _e('yangong', 1), _e('tengci', 1), _e('bingyu', 1)] },
  { units: [_e('bingjia', 2), _e('bingyu', 2), _e('shuangren', 1), _e('muling', 1), _e('huohua', 1)] },
  { units: [_e('tengci', 2), _e('muling', 1), _e('yanren', 2), _e('yangong', 1), _e('bingyu', 1)] },
  { units: [_c('golem'), _c('boar'), _c('boar')] },
  /* 阶段 3 */
  { units: [_e('yanren', 2), _e('yangong', 2), _e('huohua', 2), _e('yanying', 1), _e('bingyu', 1)] },
  { units: [_e('bingjia', 2), _e('bingjing', 1), _e('shuangren', 2), _e('bingyu', 2), _e('muling', 1)] },
  { units: [_e('tengci', 2), _e('muling', 2), _e('senzhishou', 1), _e('bingyu', 2), _e('yangong', 1)] },
  { units: [_e('bingjia', 2), _e('senzhishou', 1), _e('yangong', 2), _e('huohua', 2), _e('bingjing', 1), _e('tengci', 1)] },
  { units: [_c('golem', 1.3), _c('golem', 1.3), _c('boar', 1.3), _c('boar', 1.3)] },
  /* 阶段 4 */
  { units: [_e('yanren', 2), _e('yangong', 2), _e('huohua', 2), _e('yanying', 2), _e('fenghuang', 1), _e('bingjia', 2)] },
  { units: [_e('bingjia', 2), _e('bingjing', 2), _e('shuangren', 2), _e('bingyu', 2), _e('binglong', 1), _e('muling', 2)] },
  { units: [_e('senzhishou', 2), _e('gushu', 1), _e('tengci', 2), _e('muling', 2), _e('yangong', 2), _e('bingyu', 2)] },
  { units: [_e('bingjia', 2), _e('senzhishou', 2), _e('yanying', 2), _e('bingjing', 2), _e('yangong', 2), _e('muling', 2), _e('shuangren', 2)] },
  { units: [_c('golem', 1.6), _c('golem', 1.6), _c('golem', 1.6), _c('boar', 1.6), _c('boar', 1.6)] },
  /* 阶段 5 */
  { units: [_e('yanren', 3), _e('yangong', 3), _e('huohua', 2), _e('yanying', 2), _e('fenghuang', 1), _e('bingjia', 2), _e('muling', 2)] },
  { units: [_e('binglong', 2), _e('bingjing', 2), _e('bingjia', 3), _e('shuangren', 3), _e('bingyu', 3), _e('muling', 2), _e('senzhishou', 2)] },
  { units: [_e('gushu', 2), _e('senzhishou', 3), _e('tengci', 3), _e('muling', 3), _e('binglong', 1), _e('yangong', 2), _e('huohua', 2)] },
  { units: [_e('fenghuang', 2), _e('gushu', 2), _e('binglong', 2), _e('yanying', 3), _e('bingjia', 3), _e('bingjing', 2), _e('muling', 2), _e('yangong', 2)] },
  /* 5-5 最终 BOSS */
  { units: [_e('fenghuang', 3), _e('gushu', 3), _e('binglong', 3), _e('senzhishou', 3), _e('bingjia', 3), _e('bingjing', 3), _e('shuangren', 3), _e('yangong', 3)] },
];

/* 取第 i 回合（0-based）的波次；25 回合之后进入无尽模式，循环后期波次并加成 */
function getWave(i) {
  if (i < WAVES.length) return { units: WAVES[i].units, mult: 1 };
  const base = WAVES[20 + ((i - WAVES.length) % 5)];
  const mult = Math.pow(1.18, i - WAVES.length + 1);
  return { units: base.units, mult };
}

function stageOf(i) { return Math.floor(i / 5) + 1; }
function roundName(i) { return `${stageOf(i)}-${(i % 5) + 1}`; }

/* 技能描述插值：{key} -> 三星数值 a/b/c，或当前星级数值 */
function skillDesc(hero, star = 0) {
  if (!hero.skill) return '（无技能）';
  return hero.skill.desc.replace(/\{(\w+)\}/g, (_, k) => {
    const arr = hero.skill.vals[k];
    if (!arr) return '?';
    if (star >= 1) return `<b>${arr[star - 1]}</b>`;
    return `<b>${arr.join('/')}</b>`;
  });
}
