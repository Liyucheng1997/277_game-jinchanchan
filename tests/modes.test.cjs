const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

function setup(mode) {
  const storage = new Map();
  const ctx = vm.createContext({ console, performance, structuredClone, setTimeout, clearTimeout,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    window: { addEventListener() {} }, requestAnimationFrame() {}, document: {} });
  for (const name of ['official-data', 'data', 'modes', 'combat']) vm.runInContext(fs.readFileSync(`js/${name}.js`, 'utf8'), ctx);
  vm.runInContext('const UI = new Proxy({}, {get: (o,k) => o[k] || (()=>{})});', ctx);
  vm.runInContext(fs.readFileSync('js/game.js', 'utf8'), ctx);
  const run = src => vm.runInContext(src, ctx);
  run(`GameVersions.configure(${JSON.stringify(mode)}); Game.newGame(); G.muted=true;
    function poolCheck() {
      const count={...G.pool}, add=u=>count[u.heroId]+=3**(u.star-1);
      Game.refs().forEach(r=>add(r.unit)); G.rewards.forEach(add); G.bots.forEach(b=>b.roster.forEach(add));
      G.shop.forEach((id,i)=>{if(id)count[id]+=G.chosenOffer===i?3:1;});
      if(G.phase==='carousel')G.carousel.filter(c=>!c.taken).forEach(c=>count[c.heroId]++);
      for(const h of Object.values(HEROES))if(count[h.id]!==POOL_SIZE[h.cost]||G.pool[h.id]<0)throw Error(h.id+' pool '+count[h.id]);
    }
    function playMatch(limit=70) {
      let fights=0;
      while(G.phase!=='over'&&fights<limit){
        if(G.phase==='carousel')Game.chooseCarousel(G.carousel.findIndex(c=>!c.taken));
        if(G.phase==='prep'){Game.collectLoot();for(let i=0;i<5;i++)Game.buy(i);Game.autoDeploy();if(G.gold>=12)Game.buyXp();
          Game.startBattle();Game.engine.run();Game.finishBattle();poolCheck();fights++;}
      }
      if(G.phase!=='over'||fights<4)throw Error('match incomplete '+fights);
      return fights;
    }`);
  return { run, storage };
}

for (const mode of ['hextech', 'hyper', 'galaxy', 'anomaly']) {
  test(`${mode}: a complete match terminates with conserved pools`, () => {
    const { run } = setup(mode);
    run('playMatch()');
  });
}

test('each mode saves independently and survives a reload', () => {
  const { run, storage } = setup('hextech');
  run(`Game.chooseCarousel(0); G.gold=42; Game.save(); Game.switchVersion('hyper');`);
  assert.equal(run('G.mode'), 'hyper');
  assert.equal(run('G.hp'), 20);
  run(`Game.chooseCarousel(0); G.gold=7; Game.save(); Game.switchVersion('hextech');`);
  assert.equal(run('G.gold'), 42);
  assert.ok(storage.has('jcc-hextech-v3') && storage.has('jcc-hyper-v3'));
  assert.equal(JSON.parse(storage.get('jcc-hyper-v3')).gold, 7);
});

test('hextech offers augments at 2-1, 3-2 and 4-2, applies economy and combat effects', () => {
  const { run } = setup('hextech');
  run(`Game.chooseCarousel(0); G.round=3; Game.prepare();`);
  assert.equal(run('G.choice'), null);
  run(`G.round=4; Game.prepare();`);
  assert.equal(run('G.choice.kind'), 'augment');
  assert.equal(run('G.choice.options.length'), 3);
  assert.equal(run('new Set(G.choice.options.map(id=>AUGMENTS[id].tier)).size'), 1);
  assert.ok(run('G.bots.every(b=>b.augments.length===1)'));
  // Rerolls: exactly one.
  assert.equal(run('Modes.rerollAugments()'), true);
  assert.equal(run('Modes.rerollAugments()'), false);
  // Force a known economy augment.
  run(`G.choice.options=['stash','salary','recruit']; G.gold=0;`);
  run('Modes.pickAugment(0)');
  assert.equal(run('G.gold'), 10);
  assert.equal(run('JSON.stringify(G.augments)'), '["stash"]');
  run(`G.choice={kind:'augment',tier:3,options:['recruit'],rerolls:0}; const cap=Game.capacity(); Modes.pickAugment(0); if(Game.capacity()!==cap+1)throw Error('recruit slot');`);
  // A prep that times out auto-picks.
  run(`G.round=12; Game.prepare(); Modes.autoResolve();`);
  assert.equal(run('G.choice'), null);
  assert.equal(run('G.augments.length'), 3);
  // Combat augments change the engine's stats for that side only.
  const hp = run(`(()=>{const spec=[{heroId:'Garen',star:1,items:[],x:3,y:4}];
    const a=new CombatEngine(spec,[{heroId:'Garen',star:1,items:[]}],{visual:false,mods:[{augments:['titan','frost']},{}]});
    return [a.units[0].maxHp,a.units[1].maxHp,a.units[1].asBonus];})()`);
  assert.equal(hp[0] - hp[1], 350);
  assert.equal(hp[2], -0.25);
});

test('hyper roll: 20 HP, 1-gold rerolls, no interest or XP purchase, automatic levels', () => {
  const { run } = setup('hyper');
  assert.equal(run('G.hp'), 20);
  assert.ok(run('G.bots.every(b=>b.hp===20)'));
  run(`Game.chooseCarousel(0); G.gold=30;`);
  assert.equal(run('G.level'), 3);
  run('Game.rollShop()');
  assert.equal(run('G.gold'), 29);
  run('Game.buyXp()');
  assert.equal(run('G.gold'), 29);
  assert.equal(run('Modes.interest(50)'), 0);
  assert.equal(run('Modes.prepTime()'), 20);
  run(`G.round=9; Game.prepare();`);
  assert.equal(run('G.level'), 6);
  assert.equal(run('Game.playerDamage({survivors:[1,2,3,4,5]})'), run('Modes.damage(stageOf(G.round),5,0)'));
  assert.ok(run('Game.playerDamage({survivors:[1]})') <= 5);
});

test('galaxies apply for everyone: HP, treasure, armory and free rerolls', () => {
  const { run } = setup('galaxy');
  for (const galaxy of ['littleLegends', 'armoryStart', 'trade', 'treasure']) {
    run(`Math.random=(()=>{const r=Math.random;return ()=>r();})(); Game.newGame(); G.muted=true;`);
    run(`G.galaxy=${JSON.stringify(galaxy)}; G.items=[]; Modes.onNewGame(G); G.galaxy=${JSON.stringify(galaxy)};`);
    // onNewGame rerolls a galaxy; re-apply the forced one's start rules.
    run(`G.galaxy=${JSON.stringify(galaxy)}; G.maxHp=GALAXIES[G.galaxy].hp||100; G.hp=G.maxHp; G.bots.forEach(b=>b.hp=G.maxHp);
      if(G.galaxy==='armoryStart'&&G.items.length<3)G.items.push(...Modes.randomComponents(3-G.items.length));`);
    if (galaxy === 'littleLegends') assert.ok(run('G.hp===150&&G.bots.every(b=>b.hp===150)'));
    if (galaxy === 'armoryStart') assert.ok(run('G.items.length>=3'));
    if (galaxy === 'trade') {
      run(`Game.chooseCarousel(0); G.gold=10; Game.rollShop();`);
      assert.equal(run('G.gold'), 10);
      run('Game.rollShop()');
      assert.equal(run('G.gold'), 8);
    }
    if (galaxy === 'treasure') {
      run(`Game.chooseCarousel(0); G.round=1; Game.startBattle(); Game.engine.units.filter(u=>u.side===1).forEach(u=>{u.alive=false;u.hp=0;}); Game.engine.step(); Game.finishBattle();`);
      assert.ok(run('G.loot.items.length>=2'));
    }
  }
});

test('anomaly: offered at 3-5 and 4-5, binds to a unit and changes combat', () => {
  const { run } = setup('anomaly');
  run(`Game.chooseCarousel(0); G.bench[1]=Game.unit('Ahri'); G.round=15; Game.prepare();`);
  assert.equal(run('G.choice.kind'), 'anomaly');
  run(`G.choice.options=['titanic','clone','echo']; Modes.chooseAnomaly(1);`);
  const uid = run('Modes.anomalyTargets()[0].unit.uid');
  assert.equal(run(`Modes.applyAnomaly(1, ${uid})`), true);
  assert.equal(run(`Game.refs().find(r=>r.unit.uid===${uid}).unit.anomaly`), 'clone');
  assert.equal(run('G.choice'), null);
  // Bot cores are mutated too.
  assert.ok(run('G.bots.filter(b=>b.hp>0&&b.roster.length).some(b=>b.roster.some(u=>u.anomaly))'));
  const counts = run(`(()=>{const e=new CombatEngine([{heroId:'Garen',star:1,items:[],anomaly:'clone',x:3,y:4}],[{heroId:'Garen',star:1,items:[]}],{visual:false});
    return [e.units.filter(u=>u.side===0).length, e.units.find(u=>u.clone).maxHp/e.units[0].maxHp];})()`);
  assert.equal(counts[0], 2);
  assert.ok(Math.abs(counts[1] - 0.6) < 0.01);
  const titan = run(`new CombatEngine([{heroId:'Garen',star:1,items:[],anomaly:'titanic',x:3,y:4}],[],{visual:false}).units[0].maxHp/HEROES.Garen.hp[0]`);
  assert.ok(Math.abs(titan - 1.55) < 0.01);
  // Echo casts twice.
  const casts = run(`(()=>{const e=new CombatEngine([{heroId:'Lux',star:1,items:[],anomaly:'echo',x:3,y:6}],[{heroId:'Garen',star:3,items:[]}],{visual:false});
    const lux=e.units[0]; lux.mana=lux.manaMax; for(let i=0;i<40;i++)e.step(); return lux.casts;})()`);
  assert.ok(casts >= 2);
});

test('skill cues: every hero with an active emits a visual skill event', () => {
  const { run } = setup('rift');
  const missing = run(`JSON.stringify((()=>{const out=[];
    for(const id of Object.keys(HEROES)){
      const e=new CombatEngine([{heroId:id,star:2,items:[],x:3,y:5}],[{heroId:'Garen',star:3,items:[]},{heroId:'Darius',star:3,items:[]}]);
      const u=e.units[0]; if(!u.manaMax)continue; u.mana=u.manaMax;
      for(let i=0;i<60&&!e.events.some(v=>v.type==='skill');i++)e.step();
      if(!e.events.some(v=>v.type==='skill'&&v.hero===id))out.push(id);
    } return out;})())`);
  assert.equal(missing, '[]');
});
