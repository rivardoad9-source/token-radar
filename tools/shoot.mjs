// Renders the four screenshots the entry hands in, from the built page: the board, one
// protocol's detail drawer with its farm plan, a filtered board, and the trading tab.
//
//   node main.ts --input ../input/snapshot.json          (writes out/dashboard + out/data.js)
//   node tools/shoot.mjs <out-dir> <screenshot-dir>
//
// It also reports whether the drawer's plan fits the viewport, so a cut-off step is caught here
// rather than by the judge.
import { chromium } from '/home/ubuntu/apps/youtube-automation-agent/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? '/tmp/proto-out');
const shotDir = resolve(process.argv[3] ?? 'screenshots');
const pageUrl = pathToFileURL(join(outDir, 'dashboard', 'index.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(pageUrl, { waitUntil: 'load' });
await page.waitForSelector('#board tbody tr');

const shot = async (name) => {
  await page.waitForTimeout(220);
  const path = join(shotDir, `${name}.png`);
  await page.screenshot({ path });
  console.log(`wrote ${path}`);
};

// 1. the board as it opens
await page.evaluate(() => { window.RADAR_UI.close(); window.RADAR_UI.setMode('radar'); });
await shot('1-board');

// 2. one protocol's detail view: the drawer over the board, plan included
const detail = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('#board tbody tr')];
  const pick = trs[2] ?? trs[0];
  window.RADAR_UI.open(pick.dataset.slug);
  const drawer = document.getElementById('drawer');
  const body = document.getElementById('drawerBody');
  const plan = body.querySelector('.steps');
  return {
    slug: pick.dataset.slug,
    planSteps: plan ? plan.children.length : 0,
    drawerScrolls: drawer.scrollHeight > drawer.clientHeight + 1,
    lastStepVisible: plan ? plan.lastElementChild.getBoundingClientRect().bottom <= drawer.getBoundingClientRect().bottom : false,
  };
});
console.log('detail', JSON.stringify(detail));
await page.waitForTimeout(320);
await shot('2-detail');

// 3. a real filter: one category, sorted by launch signal
await page.evaluate(() => {
  window.RADAR_UI.close();
  window.RADAR_UI.setMode('radar');
  window.RADAR_UI.setView('all');
  window.RADAR_UI.setCategory('Lending');
  window.RADAR_UI.setSort('signal');
});
const filteredCount = await page.evaluate(() => document.querySelectorAll('#board tbody tr').length);
console.log('filtered rows', filteredCount);
await shot('3-filtered');

// 4. the other board: protocols whose token already trades
await page.evaluate(() => {
  window.RADAR_UI.setCategory('all');
  window.RADAR_UI.setSort('implied');
  window.RADAR_UI.setMode('trading');
});
const liveCount = await page.evaluate(() => document.querySelectorAll('#live tbody tr').length);
console.log('live rows', liveCount);
await shot('4-trading');

await browser.close();
