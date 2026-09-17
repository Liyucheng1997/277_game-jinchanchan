const fs = require('node:fs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  fs.mkdirSync('tmp', {recursive:true});
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1600,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(process.cwd()+'/index.html').href);
    await page.locator('#btnVersion').click();
    await page.screenshot({path:'tmp/version-selector.png'});
    await page.locator('[data-version="fortune"]').click();
    assert.equal(await page.title(),'金铲铲 · 福星');
    await page.locator('.carousel-card:not(.taken)').first().click();
    await page.evaluate(()=>{
      G.paused=true;G.level=6;G.gold=99;G.fortune.losses=6;G.board={};G.bench=Array(9).fill(null);
      GameVersions.fortuneHeroes.forEach((id,i)=>{const u=Game.unit(id);u.star=2;if(!i)u.chosen='fortune';G.board[`${i+1},${i<2?4:6}`]=u;});
      G.shop=['TahmKench','Annie','Katarina','Jinx','Sejuani'];G.chosenOffer=-1;
      UI.render();Game.save();
    });
    assert.match(await page.locator('#fortunePanel').innerText(),/六福临门/);
    assert.match(await page.locator('#fortunePanel').innerText(),/67 金币/);
    await page.screenshot({path:'tmp/fortune-board.png'});
    const images=await page.locator('img[src^="assets/fortune"]').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0));
    assert.ok(images,'local Fortune artwork loads');
    await page.locator('#fortunePanel').click();
    assert.match(await page.locator('#dialogBody').innerText(),/天选从商店招募/);
    await page.locator('#closeDialog').click();
    await page.locator('#btnVersion').click();await page.locator('[data-version="rift"]').click();
    assert.equal(await page.locator('#fortunePanel').isVisible(),false);
    assert.equal(await page.evaluate(()=>Object.keys(HEROES).length),58);
    await page.locator('#btnVersion').click();await page.locator('[data-version="fortune"]').click();
    assert.equal(await page.evaluate(()=>G.gold),99);
    await page.reload();assert.equal(await page.evaluate(()=>G.fortune.losses),6);
    await page.evaluate(()=>{G.board={};G.bench=Array(9).fill(null);G.chosenOffer=0;G.shop=['Annie',null,null,null,null];G.gold=10;UI.render();});
    await page.getByRole('button',{name:'购买 安妮 6金币，福星天选二星',exact:true}).click();
    assert.equal(await page.evaluate(()=>G.bench[0].chosen),'fortune');
    assert.equal(await page.evaluate(()=>G.gold),4);
    await page.locator('#btnFight').click();
    await page.locator('#btnVersion').click();await page.locator('[data-version="rift"]').click();
    await page.locator('#btnVersion').click();await page.locator('[data-version="fortune"]').click();
    assert.equal(await page.evaluate(()=>G.phase),'prep');
    assert.equal(await page.evaluate(()=>Game.engine),null);
    for(const width of [1280,1920]){
      await page.setViewportSize({width,height:width*9/16});
      await page.locator('#btnVersion').click();
      assert.ok(await page.locator('[data-version="fortune"]').isVisible());
      await page.locator('#closeDialog').click();
    }
    assert.deepEqual(errors,[]);
    console.log('Fortune UI passed: selector, independent saves, reload, six Fortune, artwork, chosen purchase, combat switching and scaled views.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
