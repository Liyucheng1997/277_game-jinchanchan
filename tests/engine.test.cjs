const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const ctx = vm.createContext({
  console,
  Math,
  performance,
  structuredClone,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {},
  },
  window: { addEventListener() {} },
  requestAnimationFrame() {},
  document: {},
});
for (const name of ["official-data", "data", "combat"])
  vm.runInContext(fs.readFileSync(`js/${name}.js`, "utf8"), ctx);
vm.runInContext(
  "const UI=new Proxy({selected:null,blocking:false},{get(o,k){return k in o?o[k]:()=>{};}});",
  ctx,
);
vm.runInContext(fs.readFileSync("js/game.js", "utf8"), ctx);
const run = (src) => vm.runInContext(src, ctx);
test('pirate chests settle wins, losses and draws, preserve loot and collect only once', () => {
  run(`{
    const random = Math.random;
    try {
      for (const winner of [0, 1, -1]) {
        Game.newGame(); G.muted=true; G.round=4; G.phase='combat'; G.opponent=0;
        Game.aiResults=[]; Game.battleTraitCounts={r8:3};
        Game.engine={result:{winner,survivors:[]},units:[]};
        Math.random=()=>0;
        Game.finishBattle();
        if(G.loot?.pirateChests!==1 || G.loot.gold!==0)throw Error('missing empty chest');
        const chest=JSON.stringify(G.loot); Game.finishBattle();
        if(JSON.stringify(G.loot)!==chest)throw Error('duplicate settlement');
        const gold=G.gold; Game.collectLoot(); Game.collectLoot();
        if(G.loot || G.gold!==gold)throw Error('empty chest collection');
      }
      for (const roll of [0, 0.99]) {
        Game.newGame(); G.muted=true; G.round=4; G.phase='combat'; G.opponent=0;
        G.loot={gold:2,items:['1002'],pirateChests:1};
        Game.aiResults=[]; Game.battleTraitCounts={r8:5};
        Game.engine={result:{winner:0,survivors:[]},units:[]}; Math.random=()=>roll;
        Game.finishBattle();
        if(G.loot.pirateChests!==2 || G.loot.gold!==(roll===0?5:9) || G.loot.items.length!==(roll===0?2:1))throw Error('five pirate reward');
        const gold=G.gold, reward=G.loot.gold, count=G.items.length, items=G.loot.items.length;
        Game.collectLoot(); Game.collectLoot();
        if(G.gold!==gold+reward || G.items.length!==count+items)throw Error('duplicate or missing reward');
      }
      for (const [round,count] of [[1,5],[4,2]]) {
        Game.newGame(); G.muted=true; G.round=round; G.phase='combat'; G.opponent=0;
        Game.aiResults=[]; Game.battleTraitCounts={r8:count};
        Game.engine={result:{winner:0,survivors:[]},units:[]};
        Game.finishBattle(); if(G.loot)throw Error('ineligible chest');
      }
    } finally { Math.random=random; }
  }`);
});
test("official snapshot contains 58 unique heroes, 25 traits and valid recipes", () => {
  run(`
 if(Object.keys(HEROES).length!==58||Object.keys(TRAITS).length!==25)throw Error('snapshot count');
 for(const h of Object.values(HEROES)){for(const t of h.traits)if(!TRAITS[t])throw Error('unknown trait');if(h.hp.some(n=>!Number.isFinite(n)))throw Error('invalid hp');}
 for(const it of Object.values(ITEMS))for(const part of it.recipe)if(!ITEMS[part])throw Error('missing component');`);
});
test("all hex neighbors are reciprocal and distance-one", () => {
  run(
    `for(const a of Hex.cells())for(const b of Hex.neighbors(a)){if(Hex.distance(a,b)!==1||!Hex.neighbors(b).some(c=>c.x===a.x&&c.y===a.y))throw Error('bad hex neighbor');}`,
  );
});
test("every hero can complete a seeded combat at all stars without NaN", () => {
  run(`
 for(const heroId of Object.keys(HEROES))for(const star of [1,2,3]){
 let seed=812;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const e=new CombatEngine([{heroId,star,items:['2010','2004','2034']}],[{heroId:'Garen',star:2,items:[]},{heroId:'Ashe',star:2,items:[]}],{rng,visual:false});
 e.units[0].mana=e.units[0].manaMax;const result=e.run();if(!result)throw Error(heroId+' stalled');
 for(const u of e.units)for(const key of ['hp','maxHp','atk','as','ap','armor','mr','mana','damage'])if(!Number.isFinite(u[key]))throw Error(heroId+' invalid '+key);
 }`);
});
test("all equipment can run in combat and implements valid numeric base stats", () => {
  run(`
 for(const id of Object.keys(ITEMS)){const e=new CombatEngine([{heroId:'Garen',star:2,items:[id]}],[{heroId:'Morgana',star:2,items:[]}],{visual:false});e.run();if(e.units.some(u=>!Number.isFinite(u.hp)||!Number.isFinite(u.damage)))throw Error('item '+id);}`);
});
test("shared pool remains conserved across carousel, shops, rerolls and battles", () => {
  run(`
 function assertPool(){const count={...G.pool};const add=u=>count[u.heroId]+=3**(u.star-1);Game.refs().forEach(r=>add(r.unit));G.rewards.forEach(add);G.bots.forEach(b=>b.roster.forEach(add));G.shop.filter(Boolean).forEach(id=>count[id]++);if(G.phase==='carousel')G.carousel.filter(c=>!c.taken).forEach(c=>count[c.heroId]++);for(const h of Object.values(HEROES)){if(count[h.id]!==POOL_SIZE[h.cost]||G.pool[h.id]<0)throw Error(h.id+' pool '+count[h.id]+' expected '+POOL_SIZE[h.cost]);}}
 Game.newGame();G.muted=true;assertPool();Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));assertPool();
 G.gold=100;for(let r=0;r<12;r++){Game.rollShop();assertPool();for(let i=0;i<5;i++){Game.buy(i);assertPool();}Game.autoDeploy();for(const ref of Game.refs().filter(r=>r.loc.type==='bench').slice(0,4))Game.sell(ref.loc);assertPool();}
 `);
});
test("star merging preserves all excess items and pool copies", () => {
  run(`
 Game.newGame();G.muted=true;G.carousel.filter(c=>!c.taken).forEach(c=>G.pool[c.heroId]++);G.carousel=[];G.phase='prep';G.gold=100;G.bench=Array(9).fill(null);G.board={};G.items=[];
 for(let i=0;i<3;i++){G.pool.Garen--;G.bench[i]=Game.unit('Garen',['2001','2034']);}Game.combine('Garen');
 if(Game.refs().length!==1||Game.refs()[0].unit.star!==2)throw Error('merge failed');
 if(Game.refs()[0].unit.items.length+G.items.length!==6)throw Error('items lost');assertPool();
 `);
});
test("full bench purchases can merge without deleting another unit", () => {
  run(`
 Game.newGame();G.muted=true;Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));for(const r of Game.refs())Game.sell(r.loc);G.gold=100;
 G.shop.filter(Boolean).forEach(id=>G.pool[id]++);G.shop=Array(5).fill(null);
 for(let i=0;i<9;i++){const id=i<2?'Garen':'Fiora';G.pool[id]--;G.bench[i]=Game.unit(id);}G.pool.Garen--;G.shop[0]='Garen';Game.buy(0);
 if(G.bench.length!==9||Game.refs().length!==8||!Game.refs().some(r=>r.unit.heroId==='Garen'&&r.unit.star===2))throw Error('full bench merge failed');assertPool();
 `);
});
test("equipment combines in a full third slot; invalid destination and combat board changes rejected", () => {
  run(`
 Game.newGame();G.muted=true;Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));const ref=Game.refs()[0],u=ref.unit;u.items=['2001','2034','1002'];G.items=['1003'];
 if(!Game.equip(0,ref.loc)||!u.items.includes('2010')||u.items.length!==3)throw Error('full slot crafting failed');
 const before=JSON.stringify(G.board);if(Game.move(ref.loc,{type:'board',key:'3,1'})||JSON.stringify(G.board)!==before)throw Error('enemy deployment allowed');
 G.phase='combat';if(Game.move(ref.loc,{type:'bench',idx:0}))throw Error('combat board moved');
 `);
});
test("extended match progression resolves AI fights, carousel and player elimination", () => {
  run(`
 Game.newGame();G.muted=true;let fights=0,carousels=0;
 while(G.phase!=='over'&&fights<60){if(G.phase==='carousel'){carousels++;Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));assertPool();}
 if(G.phase==='prep'){Game.collectLoot();for(let i=0;i<5;i++)Game.buy(i);Game.autoDeploy();if(G.gold>=12)Game.buyXp();if(Game.refs().length===0)throw Error('no units');Game.startBattle();if(!Game.engine)throw Error('battle did not start');Game.engine.run();Game.finishBattle();assertPool();fights++;}}
 if(fights<4||carousels<1||G.phase!=='over')throw Error('match did not finish '+fights);console.log('Simulation completed:',fights,'battles, rank',G.rank);
 `);
});

test("ready resumes paused combat and an empty board resolves instead of stalling", () => {
  run(`{
 Game.newGame();G.muted=true;Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));
 G.paused=true;Game.startBattle();if(G.paused||G.phase!=='combat')throw Error('paused ready');
 Game.engine.run();Game.finishBattle();for(const ref of Game.refs())Game.sell(ref.loc);
 const hp=G.hp,round=G.round;Game.startBattle();if(!Game.engine)throw Error('empty board stalled');
 Game.engine.run();Game.finishBattle();if(G.hp>=hp||G.round<=round)throw Error('empty board did not lose');assertPool();
 }`);
});

test("uncollected PvE loot accumulates and can only be claimed once including combat", () => {
  run(`{
 Game.newGame();G.muted=true;Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));
 const resolveWave=()=>{Game.startBattle();for(const u of Game.engine.units.filter(u=>u.side===1)){u.hp=0;u.alive=false;}Game.engine.step();Game.finishBattle();};
 resolveWave();const old=structuredClone(G.loot);resolveWave();
 if(G.loot.gold<=old.gold||G.loot.items.length<=old.items.length)throw Error('old loot overwritten');
 const loot=structuredClone(G.loot),gold=G.gold,items=G.items.length;
 G.phase='combat';
 Game.collectLoot();Game.collectLoot();if(G.gold!==gold+loot.gold||G.items.length!==items+loot.items.length||G.loot)throw Error('loot duplication or loss');
 }`);
});

test("crafting cannot grant a duplicate innate trait or mutate invalid destinations", () => {
  run(`{
 Game.newGame();G.muted=true;Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));
 const emblem=Object.values(ITEMS).find(i=>EMBLEMS[i.id]),hero=Object.values(HEROES).find(h=>h.traits.includes(EMBLEMS[emblem.id]));
 const u=Game.unit(hero.id,[emblem.recipe[0]]),before=JSON.stringify(u.items);
 if(Game.equipOn(u,emblem.recipe[1])||JSON.stringify(u.items)!==before)throw Error('duplicate trait crafted');
 const ref=Game.refs()[0],state=JSON.stringify([G.board,G.bench]);
 for(const dst of [{type:'inventory',idx:0},{type:'bench',idx:0.5},null])if(Game.move(ref.loc,dst))throw Error('invalid move accepted');
 if(JSON.stringify([G.board,G.bench])!==state)throw Error('invalid move changed roster');
 }`);
});

test("pre-combat save restores exact deployed board, shop and loot while paused", () => {
  run(`{
 const originalGet=localStorage.getItem,originalSet=localStorage.setItem,storage=new Map();
 localStorage.getItem=k=>storage.get(k)||null;localStorage.setItem=(k,v)=>storage.set(k,v);
 try {
 Game.newGame();G.muted=true;Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));
 G.loot={gold:3,items:['1002']};G.gold=10;Game.buy(0);Game.startBattle();
 const saved=JSON.parse(storage.get(SAVE_KEY));Game.engine=null;Game.load();
 if(!G.paused||G.phase!=='prep'||JSON.stringify(G.board)!==JSON.stringify(saved.board)||JSON.stringify(G.shop)!==JSON.stringify(saved.shop)||!G.loot)throw Error('save failed');assertPool();
 }finally{localStorage.getItem=originalGet;localStorage.setItem=originalSet;}
 }`);
});

test("storage denial does not prevent starting a game or toggling audio", () => {
  run(`{
 const originalGet=localStorage.getItem,originalSet=localStorage.setItem;
 localStorage.getItem=()=>{throw Error('storage denied');};localStorage.setItem=()=>{throw Error('storage denied');};
 try{Game.load();Game.toggleMute();Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));if(G.phase!=='prep')throw Error('game unavailable');}
 finally{localStorage.getItem=originalGet;localStorage.setItem=originalSet;}
 }`);
});

test('combat economy, merges and saves preserve pool and active combat snapshots', () => {
 run(`{
 const get=localStorage.getItem,set=localStorage.setItem,storage=new Map();
 localStorage.getItem=k=>storage.get(k)||null;localStorage.setItem=(k,v)=>storage.set(k,v);
 try {
 Game.newGame();Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));
 for(const r of Game.refs())Game.sell(r.loc);G.gold=100;
 G.shop.filter(Boolean).forEach(id=>G.pool[id]++);G.shop=['Garen',null,null,null,null];G.pool.Garen--;
 G.board={'3,4':Game.unit('Garen')};G.bench[0]=Game.unit('Garen');G.pool.Garen-=2;
 Game.startBattle();const battle=JSON.stringify(Game.engine.units),gold=G.gold;
 if(Game.upgradeHint('Garen').star!==2)throw Error('missing two-star hint');
 Game.buy(0);if(G.gold!==gold-1||!Game.refs().some(r=>r.unit.star===2))throw Error('combat buy/merge');
 if(JSON.stringify(Game.engine.units)!==battle)throw Error('active fight mutated');assertPool();
 Game.buyXp();if(G.gold!==gold-5)throw Error('combat xp');
 Game.rollShop();if(G.gold!==gold-7)throw Error('combat refresh');assertPool();
 Game.toggleLock();if(!G.locked)throw Error('combat lock');
 const savedGold=G.gold,savedRoster=JSON.stringify(Game.refs().map(r=>r.unit));Game.engine=null;Game.load();
 if(G.phase!=='prep'||!G.paused||G.gold!==savedGold||JSON.stringify(Game.refs().map(r=>r.unit))!==savedRoster)throw Error('combat purchases lost on reload');assertPool();
 }finally{localStorage.getItem=get;localStorage.setItem=set;}
 }`);
});

test('upgrade hints distinguish owned stars, pairs, chain upgrades and shared shop offers', () => {
 run(`{
 Game.newGame();G.phase='prep';G.board={};G.bench=Array(9).fill(null);G.shop=['Garen',null,null,null,null];
 G.bench[0]={...Game.unit('Garen'),star:2};
 if(Game.upgradeHint('Garen').star)throw Error('a two-star is not two one-stars');
 G.bench[1]={...Game.unit('Garen'),star:2};G.bench[2]=Game.unit('Garen');G.bench[3]=Game.unit('Garen');
 if(Game.upgradeHint('Garen').star!==3)throw Error('chain upgrade missing');
 G.bench=Array(9).fill(null);G.shop=['Garen','Garen','Garen',null,null];
 if(!Game.upgradeHint('Garen').shopMerge||Game.upgradeHint('Garen').star)throw Error('shop hint wrong');
 }`);
});

test('craft preview does not consume items and works in combat; bench remains editable', () => {
 run(`{
 Game.newGame();G.phase='combat';G.board={};G.bench=Array(9).fill(null);G.items=['1002','1003'];
 const before=JSON.stringify(G.items);if(Game.craftPreview(0,1)!=='2010'||JSON.stringify(G.items)!==before||Game.craftPreview(0,0))throw Error('preview mutation');
 Game.craft(0,1);if(G.items.length!==1||G.items[0]!=='2010')throw Error('combat craft');
 G.bench[0]=Game.unit('Garen');if(!Game.move({type:'bench',idx:0},{type:'bench',idx:1}))throw Error('bench locked');
 if(!Game.equip(0,{type:'bench',idx:1}))throw Error('bench equip');
 const gold=G.gold;Game.sell({type:'bench',idx:1});if(G.gold!==gold+1||G.items[0]!=='2010')throw Error('bench sell');
 }`);
});

test('little legend moves gradually, picks up nearby loot once and clamps to arena', () => {
 run(`{
 Game.newGame();G.phase='prep';G.mascot={x:202,y:497};G.loot={gold:4,items:['1002']};const gold=G.gold;
 Game.moveMascot(871,449);Game.stepMascot(.1);if(G.mascot.x<=202||G.gold!==gold)throw Error('movement or premature pickup');
 for(let i=0;i<40;i++)Game.stepMascot(.1);
 if(G.loot||G.gold!==gold+4||!G.items.includes('1002'))throw Error('pickup failed');
 Game.stepMascot(1);if(G.gold!==gold+4)throw Error('duplicate loot');
 Game.moveMascot(-999,9999);for(let i=0;i<40;i++)Game.stepMascot(.1);
 if(G.mascot.x!==145||G.mascot.y!==590)throw Error('arena boundary');
 }`);
});
