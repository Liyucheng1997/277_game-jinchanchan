// Run with PLAYWRIGHT_MODULE pointing to Playwright when not installed locally.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(process.cwd() + '/index.html').href);
    await page.locator('.carousel-card:not(.taken)').first().click();
    const center = async selector => {
      const r = await page.locator(selector).first().boundingBox();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const drag = async (selector, target, expected) => {
      const from = await center(selector);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 8 });
      assert.deepEqual(await page.evaluate(() => {
        const el = document.querySelector('.drop');
        return el && JSON.parse(el.dataset.drop);
      }), expected, 'highlight must identify the intended destination');
      await page.mouse.up();
    };
    for (const viewport of [{width:1600,height:900},{width:1280,height:720},{width:1400,height:1000}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => {
        G.paused = true; G.phase = 'prep'; G.level = 9;
        G.board = {'3,5': Game.unit('Ashe')};
        G.bench = [Game.unit('Garen'), ...Array(8).fill(null)];
        G.items = ['1001']; UI.selected = null; UI.render();
      });
      await page.waitForTimeout(300);
      const hex = key => `.hex[data-drop='${JSON.stringify({type:'board',key})}']`;
      const target = await center(hex('3,4'));
      target.x += 15 * Math.min(viewport.width / 1600, viewport.height / 900);
      // The unit in row 5 physically covers part of the empty row 4 hex.
      assert.equal(await page.evaluate(p => document.elementFromPoint(p.x,p.y)?.closest('.unit')?.dataset.loc, target), JSON.stringify({type:'board',key:'3,5'}));
      await drag('#bench .unit', target, {type:'board',key:'3,4'});
      assert.deepEqual(await page.evaluate(() => [G.board['3,4']?.heroId,G.board['3,5']?.heroId,G.bench[0]]), ['Garen','Ashe',null]);
      await page.waitForTimeout(300);
      await drag('#itemBar .item-slot', await center('#unitLayer .unit[data-loc=\'{"type":"board","key":"3,5"}\']'), {type:'board',key:'3,5'});
      assert.equal(await page.evaluate(() => G.board['3,5'].items.includes('1001')), true);
      await drag('#unitLayer .unit[data-loc=\'{"type":"board","key":"3,4"}\']', await center(hex('3,5')), {type:'board',key:'3,5'});
      assert.deepEqual(await page.evaluate(() => [G.board['3,4']?.heroId,G.board['3,5']?.heroId]), ['Ashe','Garen']);
    }
    console.log('PASS: overlapping units, preview/drop agreement, occupied-cell swaps and equipment targeting at three viewport sizes.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
