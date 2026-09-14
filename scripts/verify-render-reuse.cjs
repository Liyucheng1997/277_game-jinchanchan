// Run with a local HTTP server: node scripts/verify-render-reuse.cjs
// PLAYWRIGHT_MODULE may point to a locally installed Playwright package.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1600,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/?demo=heroes');
    await page.waitForFunction(()=>window.HeroDemo);
    await page.evaluate(async()=>{
      await HeroDemo.start(['Garen','Ashe','Fiora'],'gallery');
      G.board={'2,4':Game.unit('Garen'),'3,4':Game.unit('Ashe')};
      G.bench[0]=Game.unit('Fiora');G.gold=100;
      Game.preview=()=>[{heroId:'Garen',star:1,items:[]}];UI.render();
    });
    await page.waitForFunction(()=>[...Characters3D.actors.values()].filter(a=>a.el.isConnected&&a.mixer).length===4);
    const result=await page.evaluate(()=>{
      cancelAnimationFrame(Game.raf);
      const originals=[...Characters3D.actors.values()].filter(a=>a.el.isConnected);
      const snapshots=originals.map(a=>({a,canvas:a.canvas,mixer:a.mixer,root:a.root}));
      const retained=()=>snapshots.every(s=>s.a.el.isConnected && Characters3D.actors.get(s.a.el)===s.a && s.a.canvas===s.canvas && s.a.mixer===s.mixer && s.a.root===s.root);
      Game.rollShop();Characters3D.frame(.04);const refresh=retained();
      G.shop[0]='Vayne';Game.buy(0);Characters3D.frame(.04);const buy=retained();
      Game.move({type:'bench',idx:0},{type:'board',key:'4,4'});Characters3D.frame(.04);const move=retained();
      const moved=originals.find(a=>a.unit.heroId==='Fiora');
      const location=moved.el.dataset.loc;
      moved.el.click();const clickLocation=JSON.stringify(UI.selected);
      G.items=['1001'];Game.equip(0,{type:'board',key:'4,4'});Characters3D.frame(.04);
      const equip=retained()&&moved.el.querySelectorAll('.unit-equips img').length===1;
      Game.move({type:'board',key:'4,4'},{type:'bench',idx:0});Characters3D.frame(.04);
      const back=retained()&&moved.el.style.left===''&&moved.el.style.top==='';
      const others=snapshots.filter(s=>s.a!==moved);
      const othersRetained=()=>others.every(s=>s.a.el.isConnected&&s.a.mixer===s.mixer&&s.a.canvas===s.canvas);
      G.bench[2]=Game.unit('Fiora');G.bench[3]=Game.unit('Fiora');Game.combine('Fiora');UI.render();Characters3D.frame(.04);
      const upgraded=Game.refs().find(r=>r.unit.heroId==='Fiora');
      const upgrade=upgraded.unit.star===2&&othersRetained()&&!moved.el.isConnected;
      Game.sell(upgraded.loc);Characters3D.frame(.04);
      const sell=othersRetained()&&![...Characters3D.actors.values()].some(a=>a.unit.heroId==='Fiora');
      return {refresh,buy,move,equip,back,upgrade,sell,location,clickLocation};
    });
    assert.equal(result.refresh,true,'shop refresh rebuilt an existing model');
    assert.equal(result.buy,true,'purchase rebuilt an unrelated model');
    assert.equal(result.move,true,'moving a unit rebuilt its model');
    assert.equal(result.equip,true,'equipment rebuilt a model or failed to update');
    assert.equal(result.back,true,'return to bench changed model or kept board positioning');
    assert.equal(result.upgrade,true,'upgrade did not update only the merged hero');
    assert.equal(result.sell,true,'sale failed to release the removed model');
    assert.equal(result.location,JSON.stringify({type:'board',key:'4,4'}));
    assert.equal(result.clickLocation,result.location,'moved unit kept a stale click target');
    assert.deepEqual(errors,[]);console.log('PASS',result);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
