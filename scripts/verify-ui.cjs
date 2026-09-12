// Run from the repository root with Playwright and Microsoft Edge installed.
require('node:fs').mkdirSync('tmp', { recursive: true });
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {pathToFileURL}=require('node:url');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1600,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(process.cwd()+'/index.html').href);await page.locator('.carousel-card:not(.taken)').first().click();
const setup=async(phase='prep')=>page.evaluate(phase=>{G.paused=true;G.phase=phase;G.board={};G.bench=[{...Game.unit('Garen',['2010']),star:2},Game.unit('Ashe'),...Array(7).fill(null)];G.gold=20;G.items=['1002'];UI.render();},phase);
const begin=async(selector)=>{const r=await page.locator(selector).first().boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+15,r.y+r.height/2,{steps:3});};
const overShop=async()=>{const r=await page.locator('.shop-dock').boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2,{steps:8});};
await setup();
// Ground-shadow centers must match all nine bench cells at multiple scales.
await page.evaluate(()=>{G.bench=Array.from({length:9},()=>Game.unit('Garen'));UI.render();});
for(const width of [1280,1600,1920]){
 await page.setViewportSize({width,height:width*9/16});await page.waitForTimeout(150);
 const offsets=await page.evaluate(()=>[...document.querySelectorAll('.bench-slot')].map(slot=>{const a=slot.getBoundingClientRect(),b=slot.querySelector('.unit-base').getBoundingClientRect();return {x:(b.x+b.width/2-a.x-a.width/2)/UI.scale,y:(b.y+b.height/2-a.y-a.height/2)/UI.scale};}));
 assert.ok(offsets.every(p=>Math.abs(p.x)<1.1&&Math.abs(p.y)<1.1),JSON.stringify(offsets));
 const tops=await page.evaluate(()=>['.left-sidebar','.arena-stage','.right-sidebar'].map(s=>document.querySelector(s).getBoundingClientRect().top));assert.ok(Math.max(...tops)-Math.min(...tops)<.1);
}
await page.setViewportSize({width:1600,height:900});await page.waitForTimeout(100);
await setup();assert.equal(await page.locator('#sellZone').count(),0);
await begin('#bench .unit');assert.equal(await page.locator('#shopSellZone').isVisible(),true);assert.match(await page.locator('#shopSellZone').innerText(),/＋3 金币/);await overShop();await page.screenshot({path:'tmp/recruitment-sale.png'});await page.mouse.up();
assert.deepEqual(await page.evaluate(()=>({gold:G.gold,count:G.bench.filter(Boolean).length,item:G.items.includes('2010')})),{gold:23,count:1,item:true});assert.equal(await page.locator('#shopSellZone').isVisible(),false);assert.equal(await page.locator('.shop-card').first().isVisible(),true);
await setup();await begin('#bench .unit');await overShop();await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await page.evaluate(()=>G.gold),20);assert.equal(await page.evaluate(()=>G.bench.filter(Boolean).length),2);assert.equal(await page.locator('#shopSellZone').isVisible(),false);
await begin('#bench .unit');await page.mouse.move(1100,660);await page.mouse.up();assert.equal(await page.evaluate(()=>G.gold),20);
await begin('#itemBar .item-slot');assert.equal(await page.locator('#shopSellZone').isVisible(),false);await overShop();await page.mouse.up();assert.equal(await page.evaluate(()=>G.items.length),1);
await page.locator('#bench .unit').first().click();await page.keyboard.press('e');assert.equal(await page.evaluate(()=>G.gold),23);
await setup('combat');await begin('#bench .unit');await overShop();await page.mouse.up();assert.equal(await page.evaluate(()=>G.gold),23);
await setup();await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(100);await begin('#bench .unit');await overShop();await page.mouse.up();assert.equal(await page.evaluate(()=>G.gold),23);
assert.deepEqual(errors,[]);console.log('Bench and panel alignment passed at 1280/1600/1920. Sale UI passed: temporary dock target, exact price and equipment return, Escape/outside cancellation, item drag, E sale, combat bench sale and scaled viewport.');await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
