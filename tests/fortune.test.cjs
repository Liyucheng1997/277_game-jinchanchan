const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

function setup() {
  const storage = new Map();
  const ctx = vm.createContext({ console, performance, structuredClone, setTimeout, clearTimeout,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    window: { addEventListener() {} }, requestAnimationFrame() {}, document: {} });
  for (const name of ['official-data','data','combat']) vm.runInContext(fs.readFileSync(`js/${name}.js`, 'utf8'), ctx);
  vm.runInContext('const UI = new Proxy({}, {get: (o,k) => o[k] || (()=>{})});', ctx);
  vm.runInContext(fs.readFileSync('js/game.js', 'utf8'), ctx);
  const run = src => vm.runInContext(src, ctx);
  run(`GameVersions.configure('fortune'); Game.newGame(); G.muted=true;
    function poolCheck() {
      const count={...G.pool}, add=u=>count[u.heroId]+=3**(u.star-1);
      Game.refs().forEach(r=>add(r.unit)); G.rewards.forEach(add); G.bots.forEach(b=>b.roster.forEach(add));
      G.shop.forEach((id,i)=>{if(id)count[id]+=G.chosenOffer===i?3:1;});
      if(G.phase==='carousel')G.carousel.filter(c=>!c.taken).forEach(c=>count[c.heroId]++);
      for(const h of Object.values(HEROES))if(count[h.id]!==POOL_SIZE[h.cost]||G.pool[h.id]<0)throw Error(h.id+' pool '+count[h.id]);
    }
    function emptyPrep() {
      G.carousel.filter(c=>!c.taken).forEach(c=>G.pool[c.heroId]++);
      G.carousel=[]; G.phase='prep'; G.gold=200;
    }
    function settle(winner,count=3,round=4) {
      G.round=round; G.phase='combat'; G.opponent=0; Game.aiResults=[];
      Game.battleTraitCounts={fortune:count}; Game.engine={result:{winner,survivors:[]},units:[]}; Game.finishBattle();
    }`);
  return { run, storage };
}

test('versions preserve independent saves, legacy rift saves and combat purchases', () => {
  const { run, storage } = setup();
  run(`emptyPrep(); G.gold=47; G.fortune.losses=5; Game.save(); Game.switchVersion('rift'); G.gold=19; Game.save();`);
  assert.equal(JSON.parse(storage.get('jcc-rift-v3')).gold,19);
  run(`Game.switchVersion('fortune'); if(G.gold!==47||G.fortune.losses!==5||!G.paused)throw Error('fortune restore');
    G.phase='combat';G.gold=61;Game.switchVersion('rift');Game.switchVersion('fortune');
    if(G.phase!=='prep'||G.gold!==61||Game.engine)throw Error('combat restore');`);
  const old = JSON.parse(storage.get('jcc-rift-v3')); delete old.mode; delete old.fortune; delete old.chosenOffer;
  storage.set('jcc-rift-v3',JSON.stringify(old));
  run(`Game.switchVersion('rift'); if(G.gold!==19||HEROES.Annie||TRAITS.fortune||HEROES.Jinx.cost!==4)throw Error('legacy restore');`);
});

test('fortune only settles eligible PvP snapshots, persists losses and cashes out once', () => {
  const { run } = setup();
  run(`settle(1);settle(-1);settle(1); if(G.fortune.losses!==3||G.loot)throw Error('losses');
    settle(0,2);settle(0,6,1);if(G.fortune.losses!==3||G.loot)throw Error('ineligible');
    G.loot={gold:7,items:['1001'],pirateChests:1};settle(0,6);
    if(G.fortune.losses!==0||G.fortune.cashouts!==1||G.loot.gold!==38||G.loot.items.length!==3)throw Error('cashout');
    const reward=JSON.stringify(G.loot);Game.finishBattle();if(JSON.stringify(G.loot)!==reward)throw Error('double settlement');
    const gold=G.gold;Game.collectLoot();Game.collectLoot();if(G.gold!==gold+38||G.loot)throw Error('double pickup');`);
});

test('chosen shops reserve three copies, reroll returns them, purchase and selling conserve pool', () => {
  const { run } = setup();
  run(`emptyPrep(); const draw=Game.draw, random=Math.random;
    Game.draw=()=>{if(G.pool.TahmKench>0){G.pool.TahmKench--;return 'TahmKench';}return null;};Math.random=()=>0;
    Game.rollShop(true);poolCheck();if(G.chosenOffer!==0)throw Error('no chosen');
    Game.rollShop(true);poolCheck();Game.buy(0);poolCheck();
    if(G.gold!==197||Game.refs()[0].unit.star!==2||Game.refs()[0].unit.chosen!=='fortune')throw Error('purchase');
    Game.rollShop(true);if(G.chosenOffer!==-1)throw Error('second chosen');poolCheck();
    Game.sell(Game.refs()[0].loc);poolCheck();Game.rollShop(true);if(G.chosenOffer!==0)throw Error('chosen after sale');
    Game.draw=draw;Math.random=random;`);
});

test('chosen survives a full bench three-star merge and adds exactly one trait count', () => {
  const { run } = setup();
  run(`emptyPrep();
    for(let i=0;i<9;i++){const u=Game.unit(i<2?'TahmKench':'Garen');u.star=i<2?2:1;G.bench[i]=u;G.pool[u.heroId]-=3**(u.star-1);}
    G.shop[0]='TahmKench';G.pool.TahmKench-=3;G.chosenOffer=0;Game.buy(0);poolCheck();
    const u=Game.refs().find(r=>r.unit.heroId==='TahmKench').unit;
    if(u.star!==3||u.chosen!=='fortune'||G.bench.length!==9)throw Error('merge');
    const army=GameVersions.fortuneHeroes.map(id=>({heroId:id,items:[]}));army[0].chosen='fortune';
    if(traitCounts([{heroId:'TahmKench'},...army]).fortune!==6)throw Error('chosen count');
    if(new CombatEngine(army,[],{visual:false}).units[0].tiers.fortune!==2)throw Error('combat chosen');`);
});

test('fortune combat: Annie casts shield, Tahm reduces damage, Jinx casts rockets without old passive', () => {
  const { run } = setup();
  run(`for(const heroId of GameVersions.fortuneHeroes)for(const star of [1,2,3]){
    const e=new CombatEngine([{heroId,star,items:[]}],[{heroId:'Garen',star:2,items:[]}],{visual:false,rng:()=>0.5});
    const u=e.units[0];if(heroId==='Annie'){e.cast(u);if(!u.effects.some(x=>x.type==='shield'))throw Error('shield');}
    e.run();for(const unit of e.units)for(const key of ['hp','maxHp','damage','mana'])if(!Number.isFinite(unit[key]))throw Error(heroId+' '+key);
    if(heroId==='Jinx'&&(!u.casts||u.stacks.jinx))throw Error('jinx');
  }
  const e=new CombatEngine([{heroId:'Garen'}],[{heroId:'TahmKench'}],{visual:false});
  const target=e.units[1],hp=target.hp;e.damageTo(e.units[0],target,10,'true');if(target.hp!==hp)throw Error('thick skin');`);
});

test('a complete fortune match terminates with conserved pools including chosen offers', () => {
  const { run } = setup();
  run(`let fights=0;while(G.phase!=='over'&&fights<60){
    if(G.phase==='carousel')Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));
    if(G.phase==='prep'){Game.collectLoot();for(let i=0;i<5;i++)Game.buy(i);Game.autoDeploy();if(G.gold>=12)Game.buyXp();
      Game.startBattle();Game.engine.run();Game.finishBattle();poolCheck();fights++;}
  }if(G.phase!=='over'||fights<4)throw Error('match incomplete');`);
});
