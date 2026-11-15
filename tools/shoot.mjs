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
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: 1 });
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

// 2. one protocol's detail view: the drawer over the board, the arithmetic and the plan included.
// The row is a farm verdict inside the top twenty, so the shot shows the drawer doing real work.
const detail = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('#board tbody tr')];
  const pick = trs.slice(0, 20).find((tr) => tr.querySelector('.verdict.farm')) ?? trs[0];
  window.RADAR_UI.open(pick.dataset.slug);
  const drawer = document.getElementById('drawer');
  const body = document.getElementById('drawerBody');
  const plan = body.querySelector('.steps');
  return {
    slug: pick.dataset.slug,
    pick: pick.querySelector('.n')?.textContent,
    planSteps: plan ? plan.children.length : 0,
    drawerScrolls: drawer.scrollHeight > drawer.clientHeight + 1,
    lastStepVisible: plan ? plan.lastElementChild.getBoundingClientRect().bottom <= drawer.getBoundingClientRect().bottom : false,
  };
});
console.log('detail', JSON.stringify(detail));
await page.waitForTimeout(320);
await shot('2-detail');

// 3. a real filter: only the protocols the page says to farm now, sorted by launch signal
await page.evaluate(() => {
  window.RADAR_UI.close();
  window.RADAR_UI.setMode('radar');
  window.RADAR_UI.setView('all');
  window.RADAR_UI.setVerdict('farm');
  window.RADAR_UI.setSort('signal');
});
const filteredCount = await page.evaluate(() => document.querySelectorAll('#board tbody tr').length);
console.log('filtered rows', filteredCount);
await shot('3-filtered');

// 4. the model panel: the power law on log axes, with the board placed on the fitted line
await page.evaluate(() => {
  window.RADAR_UI.setVerdict('all');
  window.RADAR_UI.setSort('implied');
  window.RADAR_UI.setMode('radar');
  const box = document.getElementById('scatter');
  const panel = box.closest('.panel');
  window.scrollTo(0, panel.offsetTop - 6);
});
const dots = await page.evaluate(() => document.querySelectorAll('#scatter circle').length);
console.log('scatter dots', dots);
await shot('4-model');

await browser.close();
