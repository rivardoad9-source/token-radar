/* Token Radar's page.
 *
 * data.js carries one array per column rather than one object per row (214 rows, 23 columns:
 * a third of the bytes, and every row is a plain object once boot() has zipped it). Three things
 * live here and nowhere else: the filters, the band, and the drawer that explains one protocol's
 * implied value and prices its plan.
 *
 * The band is the model's own admission: the fit's 25th and 75th residual percentiles, drawn on
 * a log axis so a reader sees at a glance how wide the model's error is beside the number.
 *
 * The two tabs keep the radar honest: the launch board holds records with no token, and the
 * trading tab holds the ones the snapshot already prices, with the market's own market cap.
 */
'use strict';

const D = window.RADAR;
const H = D.head;
const FIT = H.fit;

/** One row per column name: { rank, slug, name, ... }. */
const rows = D.rows.map((r) => {
  const row = {};
  D.cols.forEach((c, i) => { row[c] = r[i]; });
  return row;
});
const live = D.live.map((r) => {
  const row = {};
  D.liveCols.forEach((c, i) => { row[c] = r[i]; });
  return row;
});

const el = (id) => document.getElementById(id);
const state = { q: '', cat: 'all', chain: 'all', sort: 'implied', verdict: 'all', view: 'all', mode: 'radar', open: null };

/* ---------- formatting ---------- */

const usd = (n) => {
  if (n === null || n === undefined) return '-';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
};
const usdFull = (n) => (n === null || n === undefined ? '-' : `$${Math.round(n).toLocaleString('en-US')}`);
const pct = (n) => (n === null || n === undefined ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const age = (d) => (d === null || d === undefined ? 'unknown' : d < 60 ? `${d}d` : d < 730 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pctOf = (v) => `${(v * 100).toFixed(1)}%`;
const sign = (v, d = 3) => (v >= 0 ? `+ ${v.toFixed(d)}` : `− ${Math.abs(v).toFixed(d)}`);
const cohort = (d) => (d === null || d === undefined ? 'unknown' : d < 365 ? 'under 1y' : d < 730 ? '1-2y' : d < 1095 ? '2-3y' : d < 1825 ? '3-5y' : '5y+');
const signed = (n) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
/** A protocol's own colour and monogram, derived from its slug: the snapshot names no brand asset,
 *  and a page that cannot fetch one draws its own. Same slug, same mark, every build. */
const hueOf = (s) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};
const initialsOf = (n) =>
  n
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
const markOf = (r, size = '') =>
  `<span class="mark${size ? ` ${size}` : ''}" style="--h:${hueOf(r.slug)}">${initialsOf(r.name)}</span>`;

/* ---------- the model's equation, above the board ---------- */

function drawRule() {
  const band = (b) => `×${(10 ** b).toFixed(2)}`;
  el('rule').innerHTML =
    `<span class="k">model ${esc(H.model_version)}</span>` +
    `<b>implied FDV = 10^(${FIT.intercept.toFixed(3)} + ${FIT.tvl.toFixed(3)} × log10 TVL) × age tilt × growth tilt</b>` +
    `<span class="sep">|</span><span class="k">fitted on</span><span class="v">${FIT.n} protocols that already trade</span>` +
    `<span class="sep">|</span><span class="k">blind miss</span><span class="v">${Math.round(FIT.mdape_tilted * 100)}% vs ${Math.round(FIT.flat * 100)}% for a flat price</span>` +
    `<span class="sep">|</span><span class="k">band</span><span class="v">${band(FIT.low)} to ${band(FIT.high)}</span>` +
    `<span class="sep">|</span><span class="k">tilts at</span><span class="v">${Math.round(FIT.tilt * 100)}% of their fitted weight, and the page prints what full weight costs</span>`;
}

/** What the page claims about itself, printed from the data it just rendered. */
function drawProof() {
  const claimed = H.board_size;
  const shown = rows.length;
  const ok = claimed === shown;
  el('proofline').innerHTML =
    `<span class="${ok ? '' : 'bad'}">page renders <b>${shown}</b> of <b>${claimed}</b> rows from board.json</span>` +
    `<span class="sep">/</span>every row above is one record of the sealed snapshot, nothing added` +
    `<span class="sep">/</span>${H.live_size} protocols with a token are kept on the other tab, never scored`;
}

/* ---------- the band's axis: every row's range on one log scale ---------- */

const logLow = Math.log10(Math.min(...rows.map((r) => r.low)));
const logHigh = Math.log10(Math.max(...rows.map((r) => r.high)));
const span = Math.max(logHigh - logLow, 0.001);
const at = (v) => ((Math.log10(Math.max(v, 1)) - logLow) / span) * 100;

function bandHtml(r) {
  const left = at(r.low);
  const right = at(r.high);
  return `<div class="band"><i style="left:${left.toFixed(1)}%;width:${Math.max(right - left, 1).toFixed(1)}%"></i><u style="left:${at(r.implied).toFixed(1)}%"></u></div>`;
}

/* ---------- the model panel, written from the fit itself ---------- */

function drawFacts() {
  const facts = [
    ['Snapshot', H.as_of, ''],
    ['Pre-token', H.board_size, ''],
    ['Watchlist', `${H.watchlist_covered}/${H.watchlist_size}`, 'good'],
    ['Trading peers', H.peers, ''],
    ['Median miss', `${Math.round(FIT.mdape_tilted * 100)}%`, 'warn'],
    ['Farm now', H.totals.farm, 'good'],
  ];
  el('facts').innerHTML = facts.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c}">${esc(v)}</dd></div>`).join('');
  el('tabRadar').textContent = H.board_size;
  el('tabLive').textContent = H.live_size;
}

function drawModel() {
  el('eq').innerHTML =
    `implied FDV = 10^(<b>${FIT.intercept.toFixed(3)}</b> + <b>${FIT.tvl.toFixed(3)}</b> × log10 TVL) × <b>${FIT.age.toFixed(2)}</b>·(log10 age − ${FIT.anchor_age.toFixed(2)}) × <b>${FIT.growth.toFixed(2)}</b>·7d growth` +
    `<br /><span style="color:var(--dim)">size, age and one week of growth, each fitted to the snapshot; age and growth applied at ${Math.round(FIT.tilt * 100)}% strength because full strength priced worse out of sample</span>`;

  const mult = (b) => `×${(10 ** b).toFixed(2)}`;
  const factors = [
    ['The curve', `Ten times the TVL raises the implied value <b>${(10 ** FIT.tvl).toFixed(2)}×</b>, not 10×: the market pays less per TVL dollar as a protocol grows.`],
    ['Age', `A tenfold older protocol is priced <b>${(10 ** (FIT.age * FIT.tilt)).toFixed(2)}×</b> the younger one at the strength the page applies. The fitted coefficient is ${FIT.age.toFixed(3)} per log10 year, applied at ${Math.round(FIT.tilt * 100)}%.`],
    ['7d growth', `Every <b>+100%</b> of weekly TVL growth moves the value by <b>${(FIT.growth * FIT.tilt * 100).toFixed(1)}%</b> at the strength the page applies. The fitted sign is <b>negative</b> in this snapshot: the protocols that pumped hardest last week carry the thinnest multiples per TVL dollar, so the model credits the week, it does not reward it.`],
    ['The guard', `A shallow line would value a $5M protocol at $400M. Every row is held inside the multiples the ${FIT.n} trading protocols actually carry: <b>${H.multiple.low}×</b> to <b>${H.multiple.high}×</b> TVL, median <b>${H.multiple.median}×</b>.`],
    ['The band', `The 10th and 90th percentile blind miss are <b>${mult(FIT.low)}</b> and <b>${mult(FIT.high)}</b>, covering <b>${Math.round(FIT.coverage * 100)}%</b> of the errors the model made on protocols it had not seen. The row prints that band, not a promise.`],
    ['What lost', `The chain count, a squared TVL term, a category offset and a k-nearest-neighbour comps curve were all fitted and all priced worse out of sample. The table below is the test that decided it.`],
    ['What it pays', `A farm is credited with <b>0.0001%</b> of the implied launch, weighted by the odds a token exists at that age, against gas and the yield given up: the net column, and the hour it buys.`],
    ['The odds', `Age buckets are counted in the snapshot itself: of every token-able protocol aged two to three years, <b>${Math.round((H.odds.find((o) => o.bucket === '2-3y')?.share ?? 0) * 100)}%</b> already hold a token. Cross-sectional, not a forecast for one protocol.`],
  ];
  el('factors').innerHTML = factors.map(([k, v]) => `<li><span class="k">${k}</span><span class="v">${v}</span></li>`).join('');

  const worst = Math.max(...FIT.candidates.map((c) => c.miss), FIT.flat);
  el('tests').innerHTML =
    `<h4>Tested by refitting without the protocol it prices</h4><table>` +
    `<tr><th>Shape</th><th>median miss</th></tr>` +
    FIT.candidates
      .map((c, i) => {
        const cls = i === 0 ? 'win' : c.miss > FIT.candidates[0].miss ? 'lose' : '';
        return `<tr><td>${esc(c.name)}</td><td class="${cls}">${Math.round(c.miss * 100)}%</td></tr>`;
      })
      .join('') +
    `<tr><td>flat: everything at the peer median</td><td>${Math.round(FIT.flat * 100)}%</td></tr>` +
    `<tr><td>200 random 70/30 splits</td><td>${Math.round(FIT.random.miss * 100)}% vs ${Math.round(FIT.random.flat * 100)}% flat</td></tr>` +
    `<tr><td>older 60% / newer 40% split (${FIT.ts.n} held out)</td><td class="lose">${Math.round(FIT.ts.miss * 100)}% vs ${Math.round(FIT.ts.flat * 100)}% flat</td></tr>` +
    `</table>` +
    `<h4>Does the band hold what it promises</h4><table>` +
    `<tr><th>Band</th><th>errors inside</th><th>promised</th></tr>` +
    `<tr><td>×${(10 ** FIT.mid_low).toFixed(2)} to ×${(10 ** FIT.mid_high).toFixed(2)} (middle half)</td><td class="win">${Math.round(FIT.coverage_mid * 100)}%</td><td>50%</td></tr>` +
    `<tr><td>×${(10 ** FIT.low).toFixed(2)} to ×${(10 ** FIT.high).toFixed(2)} (the printed band)</td><td class="win">${Math.round(FIT.coverage * 100)}%</td><td>80%</td></tr>` +
    `</table>`;

  el('caveat').textContent =
    `Fitted on the ${FIT.n} protocols in this snapshot whose record already carries a token, a TVL and a listing date. Blind error ${Math.round(FIT.mdape_tilted * 100)}%, inside a factor of three on ${Math.round(FIT.within3_tilted * 100)}% of them against ${Math.round(FIT.flat_within3 * 100)}% for the flat median; R² ${FIT.r2.toFixed(3)}. ` +
    `The time-ordered split is the model's worst result and it is printed anyway: on the protocols that launched after the ones it learned from, the line loses to the flat median. That is why every number carries a band, why the board is a ranking, and why nothing here forecasts a launch date. Source: ${H.source}.`;
}

/** The wait curve: what share of protocols at each age has already launched a token. */
function drawOdds() {
  const max = Math.max(...H.odds.map((o) => o.share), 0.01);
  const ladder = H.odds
    .filter((o) => o.bucket !== 'unknown')
    .map(
      (o) =>
        `<div class="odds-row"><span class="lab">${esc(o.bucket)}</span>` +
        `<span class="track"><i style="width:${((o.share / max) * 100).toFixed(1)}%"></i></span>` +
        `<span class="val">${Math.round(o.share * 100)}% <span>of ${o.all}</span></span></div>`,
    )
    .join('');
  const young = H.odds.find((o) => o.bucket === 'under 1y');
  const old = H.odds.find((o) => o.bucket === '3-5y');
  el('odds').innerHTML =
    `<div class="odds-ladder">${ladder}</div>` +
    `<p class="odds-note">A protocol under a year old has launched a token in <b>${Math.round((young?.share ?? 0) * 100)}%</b> of the snapshot's own cases; between three and five years, in <b>${Math.round((old?.share ?? 0) * 100)}%</b>. ` +
    `The board uses this as the odds term in every net figure, so a farm on a young protocol is credited with less than the same farm on an old one. These are counts of a single day's snapshot, not a survival curve: no history of launches exists here, and the page does not pretend otherwise.</p>`;
}

/** The power law, drawn: the trading peers in log TVL against log value, the fitted line, the band,
 *  and every pre-token protocol placed on the same axes. No library, no canvas, just the numbers. */
function drawScatter() {
  const box = el('scatter');
  if (!box) return;
  const peers = H.scatter.peers;
  const pre = H.scatter.pre;
  const W = 1060;
  const HH = 330;
  const L = 66;
  const R = 16;
  const T = 18;
  const B = 32;
  const all = peers.concat(pre);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)) - 0.4;
  const x1 = Math.ceil(Math.max(...xs)) + 0.4;
  const y0 = Math.floor(Math.min(...ys)) - 0.4;
  const y1 = Math.ceil(Math.max(...ys)) + 0.4;
  const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => HH - B - ((v - y0) / (y1 - y0)) * (HH - T - B);
  const money = (lg) => (lg >= 9 ? `$${(10 ** (lg - 9)).toFixed(0)}B` : lg >= 6 ? `$${(10 ** (lg - 6)).toFixed(0)}M` : `$${(10 ** (lg - 3)).toFixed(0)}K`);
  const f = (v, shift = 0) => FIT.intercept + FIT.tvl * v + shift;

  let grid = '';
  for (let t = Math.ceil(x0); t <= Math.floor(x1); t++) {
    grid += `<line class="g" x1="${X(t).toFixed(1)}" y1="${Y(y0).toFixed(1)}" x2="${X(t).toFixed(1)}" y2="${Y(y1).toFixed(1)}"/>`;
    grid += `<text class="tick" x="${X(t).toFixed(1)}" y="${HH - 15}">${money(t)}</text>`;
  }
  for (let t = Math.ceil(y0); t <= Math.floor(y1); t++) {
    grid += `<line class="g" x1="${X(x0).toFixed(1)}" y1="${Y(t).toFixed(1)}" x2="${X(x1).toFixed(1)}" y2="${Y(t).toFixed(1)}"/>`;
    grid += `<text class="tick y" x="${L - 10}" y="${(Y(t) + 3).toFixed(1)}">${money(t)}</text>`;
  }
  const seg = (shift, cls) =>
    `<line class="${cls}" x1="${X(x0).toFixed(1)}" y1="${Y(f(x0, shift)).toFixed(1)}" x2="${X(x1).toFixed(1)}" y2="${Y(f(x1, shift)).toFixed(1)}"/>`;
  const dot = (p, cls) => `<circle class="${cls}" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${cls === 'peer' ? 3.1 : 2.7}"/>`;

  box.innerHTML =
    `<svg viewBox="0 0 ${W} ${HH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="log TVL against log implied value, fitted line and band">` +
    grid +
    seg(FIT.low, 'fit band') +
    seg(FIT.high, 'fit band') +
    seg(0, 'fit main') +
    peers.map((p) => dot(p, 'peer')).join('') +
    pre.map((p) => dot(p, 'pre')).join('') +
    `<text class="axis" x="${L}" y="11">implied FDV, log scale</text>` +
    `<text class="axis" x="${(W - R).toFixed(1)}" y="${HH - 2}" text-anchor="end">TVL, log scale</text>` +
    `</svg>` +
    `<p class="legend"><span class="k peer"></span>${peers.length} whose token already trades` +
    `<span class="k pre"></span>${pre.length} pre-token protocols, placed on the line` +
    `<span class="k band"></span>the band: 10th to 90th percentile blind miss` +
    `<span class="sep">·</span>a power law with exponent <b>${FIT.tvl.toFixed(2)}</b>: ten times the TVL is <b>${(10 ** FIT.tvl).toFixed(1)}×</b> the value</p>`;
}

function drawPlanStrip() {
  const cell = (k, n, title, note) =>
    `<div class="plan-cell ${k}"><h4>${title}</h4><b>${n}</b><p>${note}</p></div>`;
  const farm = rows.filter((r) => r.verdict === 'farm');
  const capital = farm.reduce((s, r) => s + r.capital, 0);
  const cost = farm.reduce((s, r) => s + r.cost, 0);
  const net = farm.reduce((s, r) => s + r.net, 0);
  el('planStrip').innerHTML =
    cell('farm', H.totals.farm, 'Farm now', `Signal 55+ and the plan clears its own cost: $${Math.round(net).toLocaleString('en-US')} credited back against $${Math.round(cost)} of gas and yield given up, on $${capital.toLocaleString('en-US')} of capital.`) +
    cell('watch', H.totals.watch, 'Watch', 'Pays for itself and the signal is not there yet: the position is right, the timing is not.') +
    cell('thin', H.totals.thin, 'Thin', 'The credited airdrop covers at least half the gas and the yield given up, but not all of it: a small position can still be worth opening.') +
    cell('pass', H.totals.pass, 'Pass', 'The credit does not cover half the cost. On this chain, at this size, the plan does not pay for the work.');
  // The plan column is a price list; this is the shortlist. Best net per hour on the watchlist,
  // which is the only list the bounty asks to be covered in full.
  const best = rows
    .filter((r) => r.wl)
    .sort((a, b) => b.perh - a.perh)
    .slice(0, 3)
    .map((r, i) => `${i + 1}. <b>${esc(r.name)}</b> ${signed(r.perh)}/h on a ${usdFull(r.capital)} slice`)
    .join('<span class="sep">·</span>');
  el('planStrip').innerHTML += `<p class="best"><span class="k">Best on the watchlist</span>${best}</p>`;
}

/* ---------- drawing the board ---------- */

function options(select, values, label) {
  select.innerHTML = [`<option value="all">${esc(label)}</option>`]
    .concat(values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`))
    .join('');
}

function drawControls() {
  options(el('cat'), [...new Set(rows.map((r) => r.category))].sort(), 'All categories');
  options(el('chain'), [...new Set(rows.flatMap((r) => r.chains))].sort(), 'All chains');
}

function visible() {
  const q = state.q.trim().toLowerCase();
  let out = rows.filter((r) => {
    if (state.view === 'watchlist' && !r.wl) return false;
    if (state.view === 'early' && r.wl) return false;
    if (state.cat !== 'all' && r.category !== state.cat) return false;
    if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
    if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
    if (q === '') return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.slug.includes(q) ||
      r.category.toLowerCase().includes(q) ||
      (r.chains || []).join(' ').toLowerCase().includes(q)
    );
  });
  const key = {
    implied: (r) => r.implied,
    signal: (r) => r.signal,
    multiple: (r) => r.multiple,
    tvl: (r) => r.tvl,
    growth: (r) => r.ch7 ?? -Infinity,
    cost: (r) => -r.cost,
    age: (r) => r.age ?? -1,
  }[state.sort];
  return out.slice().sort((a, b) => key(b) - key(a) || a.rank - b.rank);
}

function signalCell(v) {
  const tone = v >= 55 ? 'var(--value)' : v >= 40 ? 'var(--warm)' : '#4c5f70';
  return `<div class="sig"><div class="bar"><i style="width:${Math.max(2, v)}%;background:${tone}"></i></div><b>${v}</b></div>`;
}

function filterLabel() {
  const parts = [];
  if (state.cat !== 'all') parts.push(state.cat);
  if (state.chain !== 'all') parts.push(`on ${state.chain}`);
  if (state.verdict !== 'all') parts.push(`plan: ${state.verdict}`);
  if (state.view === 'watchlist') parts.push('watchlist only');
  if (state.view === 'early') parts.push('below the floor only');
  if (state.q.trim() !== '') parts.push(`matching "${state.q.trim()}"`);
  return parts.length === 0 ? '' : ` · <span class="filtered">filtered</span> to ${esc(parts.join(', '))}`;
}

function drawBoard() {
  const list = visible();
  document.querySelector('#board tbody').innerHTML = list
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}"${state.open === r.slug ? ' class="active"' : ''}>
      <td class="num rank">${r.rank}</td>
      <td><span class="tier ${r.tier}">${r.tier}</span><span class="who" style="display:inline-flex">
        ${markOf(r)}
        <span class="n">${esc(r.name)}</span>
        <span class="s">${esc(r.slug)}${r.wl ? ' · <span class="wl">watchlist</span>' : ''}</span></span></td>
      <td><span class="chip">${esc(r.category)}</span></td>
      <td class="num">${usd(r.tvl)}</td>
      <td class="num ${r.ch7 >= 0 ? 'up' : 'down'}">${r.ch7 === null ? '-' : pct(r.ch7)}</td>
      <td class="num">${age(r.age)}</td>
      <td>${signalCell(r.signal)}</td>
      <td class="num"><span class="imp">${usd(r.implied)}</span><span class="mult">${r.multiple.toFixed(2)}× TVL</span>${bandHtml(r)}</td>
      <td class="num odds-cell">${Math.round(r.odds * 100)}%<span>${cohort(r.age)}</span></td>
      <td class="num"><span class="netcell ${r.net < 0 ? 'neg' : ''}">${signed(r.net)}</span><span class="subline">$${r.perh.toFixed(2)}/h</span></td>
      <td class="num"><span class="verdict ${r.verdict}">${r.verdict === 'farm' ? 'farm now' : r.verdict}</span><span class="pcost">$${r.cost.toFixed(2)} · ${pctOf(r.burden)}</span></td>
    </tr>`,
    )
    .join('');
  el('empty').hidden = list.length > 0;
  const watch = list.filter((r) => r.wl).length;
  const note = state.sort === 'implied' ? '' : ' (the number on the left keeps its implied-value rank)';
  el('count').innerHTML =
    `<b>${list.length}</b> of ${rows.length} pre-token protocols · <b>${watch}</b> on the watchlist${filterLabel()} · sorted by ${esc(el('sort').selectedOptions[0].text.toLowerCase())}${note} · ` +
    `signal runs 0-100 and <span class="lg green">55+</span> clears the farm bar · every implied value is this model's claim, printed with the band it has earned`;
}

function drawLive() {
  el('livenote').innerHTML =
    `<b>${live.length}</b> shown of the <b>${H.live_size}</b> protocols in this snapshot that already record a token, by market cap. They are kept off the launch board entirely: a protocol that trades has no launch value to imply, so the model never scores it, and the two kinds of protocol are never ranked against each other.`;
  document.querySelector('#live tbody').innerHTML = live
    .map(
      (r) => `<tr><td><span class="who" style="display:inline-flex"><span class="n">${esc(r.name)}</span><span class="s">${esc(r.slug)}</span></span></td>
      <td><span class="chip">${esc(r.category)}</span></td>
      <td><span class="chip">${esc((r.chains || []).slice(0, 2).join(', '))}${(r.chains || []).length > 2 ? ` +${(r.chains || []).length - 2}` : ''}</span></td>
      <td class="num">${usd(r.tvl)}</td><td class="num">${usd(r.mcap)}</td>
      <td class="num">${r.multiple.toFixed(2)}</td>
      <td class="num ${r.ch7 >= 0 ? 'up' : 'down'}">${r.ch7 === null ? '-' : pct(r.ch7)}</td></tr>`,
    )
    .join('');
}

function setMode(mode) {
  state.mode = mode;
  [...el('tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const radar = mode === 'radar';
  el('radarView').hidden = !radar;
  el('liveView').hidden = radar;
  el('modelPanel').hidden = !radar;
  if (radar) drawBoard();
}

/* ---------- the drawer ---------- */

function open(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  state.open = slug;
  const chain = (r.chains || [])[0] ?? 'its main chain';
  const chainLine = (r.chains || []).length === 0 ? 'chain unknown'
    : (r.chains || []).length <= 3 ? (r.chains || []).join(', ')
    : `${(r.chains || []).slice(0, 3).join(', ')} +${(r.chains || []).length - 3}`;

  el('drawerBody').innerHTML = `
    <h2>${markOf(r, 'big')}${esc(r.name)}</h2>
    <p class="sub">${esc(r.category)} · ${esc(chainLine)} · rank ${r.rank} of ${rows.length} · tier ${r.tier}${r.wl ? ' · <span style="color:var(--value)">on the watchlist</span>' : ''}</p>
    <p class="big"><strong>${usd(r.implied)}</strong><em>implied FDV if it issued a token · ${r.multiple.toFixed(2)}× its ${usd(r.tvl)} of TVL</em></p>
    <div class="band2"><i style="left:${at(r.low).toFixed(1)}%;width:${Math.max(at(r.high) - at(r.low), 1).toFixed(1)}%"></i><u style="left:${at(r.implied).toFixed(1)}%"></u></div>
    <div class="bandlabels"><span>${usd(r.low)} low</span><span>${usd(r.high)} high</span></div>
    <p class="scale">Its implied value is ${r.multiple.toFixed(2)}× its own TVL, and the band the model has earned on the protocols it could check runs ${(r.low / r.tvl).toFixed(3)}× to ${(r.high / r.tvl).toFixed(2)}×: read the ranking, and read the multiple inside that band.</p>

    <h3 class="sec">Where the number comes from</h3>
    <dl class="kv">
      <dt>TVL, the record</dt><dd>${usdFull(r.tvl)}</dd>
      <dt>log10 of it</dt><dd>${Math.log10(Math.max(r.tvl, 1)).toFixed(3)}</dd>
      <dt>Blind curve: 10^(${r.model.intercept.toFixed(3)} + ${r.model.exponent.toFixed(3)} × log10 TVL)</dt><dd>${usdFull(r.model.curve_usd)}</dd>
      <dt>Age tilt (${r.age === null ? 'unknown age' : `${Math.round(r.age / 30.44)} months`})</dt><dd>×${r.model.age_tilt.toFixed(3)}</dd>
      <dt>7d growth tilt (${r.ch7 === null ? 'not reported' : pct(r.ch7)})</dt><dd>×${r.model.growth_tilt.toFixed(3)}</dd>
      <dt>Tilted value, before the guard</dt><dd>${usdFull(r.model.tilted_usd)}</dd>
      <dt>Peers' multiple range, applied to this TVL</dt><dd>${usd(r.model.clamp_low_usd)} – ${usd(r.model.clamp_high_usd)}</dd>
      <dt>${r.model.clamped === 'none' ? 'Inside the range: the curve stands' : `Held at the ${r.model.clamped === 'low' ? 'floor' : 'ceiling'} of that range`}</dt><dd class="hl">${usdFull(r.implied)}</dd>
      <dt>Band (P10-P90 blind miss)</dt><dd>${usd(r.low)} – ${usd(r.high)}</dd>
    </dl>

    <h3 class="sec">What it pays <span class="chain">not what it costs</span></h3>
    <dl class="kv">
      <dt>Odds a token exists at ${cohort(r.age)}</dt><dd>${Math.round(r.odds * 100)}%</dd>
      <dt>Credited airdrop, 0.0001% of the implied launch</dt><dd>$${r.airdrop.toFixed(2)}</dd>
      <dt>Gas, ${4 + Math.round(r.hold / 7)} transactions on ${esc(chain)}</dt><dd>$${r.gas.toFixed(2)}</dd>
      <dt>Yield given up over ${r.hold} days</dt><dd>$${(r.cost - r.gas).toFixed(2)}</dd>
      <dt>Net, over ${r.hours} hours of work</dt><dd class="${r.net >= 0 ? 'v' : 'hl'}">${signed(r.net)} · $${r.perh.toFixed(2)}/h</dd>
      <dt>Breaks even at an implied launch of</dt><dd>${r.breakeven === null ? 'never' : usdFull(r.breakeven)}</dd>
      <dt>Verdict</dt><dd class="${r.verdict === 'farm' ? 'v' : 'hl'}">${r.verdict === 'farm' ? 'farm now' : r.verdict}</dd>
    </dl>
    <p class="scale">Every plan is priced on the same ${usdFull(r.capital)} slice, so rows compare; this one costs ${usdFull(r.cost)}, ${pctOf(r.burden)} of the slice. It is credited 0.0001% of the implied launch, weighted by the ${Math.round(r.odds * 100)}% odds this age cohort has launched a token: ${signed(r.net)} net, or $${r.perh.toFixed(2)} an hour across ${r.hours} hours.</p>

    <h3 class="sec">How to farm it</h3>
    <ol class="steps">${r.steps.map((s) => `<li><p>${esc(s)}</p></li>`).join('')}</ol>

    <p class="foot">Signal ${r.signal}/100: growth, youth, chain breadth and the category's own heat, each ranked against the board. Implied value is the model's claim from the snapshot's own fields, with a ${usd(r.low)}-${usd(r.high)} band; it is research, not advice, and not a promise that a token exists.</p>`;

  el('drawer').classList.add('open');
  el('drawer').setAttribute('aria-hidden', 'false');
  el('drawer').scrollTop = 0;
  drawBoard();
}

function close() {
  state.open = null;
  el('drawer').classList.remove('open');
  el('drawer').setAttribute('aria-hidden', 'true');
  drawBoard();
}

/* ---------- wiring ---------- */

el('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setMode(b.dataset.mode);
});
el('q').addEventListener('input', (e) => { state.q = e.target.value; drawBoard(); });
el('cat').addEventListener('change', (e) => { state.cat = e.target.value; drawBoard(); });
el('chain').addEventListener('change', (e) => { state.chain = e.target.value; drawBoard(); });
el('sort').addEventListener('change', (e) => { state.sort = e.target.value; drawBoard(); });
el('verdict').addEventListener('change', (e) => { state.verdict = e.target.value; drawBoard(); });
el('view').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.view = b.dataset.view;
  [...el('view').children].forEach((x) => x.classList.toggle('on', x === b));
  drawBoard();
});
document.querySelector('#board tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (tr) open(tr.dataset.slug);
});
el('close').addEventListener('click', close);
el('drawer').addEventListener('click', (e) => { if (e.target === el('drawer')) close(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
  if (e.key === '/' && document.activeElement !== el('q')) { e.preventDefault(); el('q').focus(); }
});

/* The screenshot tool drives the page through this handle, so every screenshot is a real state
   of the page and not a mock: the filtered shot is the controls' own filter, the trading shot is
   the tab's own board. */
window.RADAR_UI = {
  setQuery(q) { state.q = q; el('q').value = q; drawBoard(); },
  setCategory(c) { state.cat = c; el('cat').value = c; drawBoard(); },
  setChain(c) { state.chain = c; el('chain').value = c; drawBoard(); },
  setVerdict(v) { state.verdict = v; el('verdict').value = v; drawBoard(); },
  setView(v) {
    state.view = v;
    [...el('view').children].forEach((x) => x.classList.toggle('on', x.dataset.view === v));
    drawBoard();
  },
  setSort(s) { state.sort = s; el('sort').value = s; drawBoard(); },
  setMode,
  open,
  close,
};

drawFacts();
drawRule();
drawProof();
drawModel();
drawScatter();
drawOdds();
drawPlanStrip();
drawControls();
drawBoard();
drawLive();
setMode('radar');
