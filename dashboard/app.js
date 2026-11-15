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

/* ---------- the model's equation, above the board ---------- */

function drawRule() {
  const band = (b) => `×${(10 ** (b * 0.6)).toFixed(2)}`;
  el('rule').innerHTML =
    `<span class="k">model ${esc(H.model_version)}</span>` +
    `<b>log10(FDV) = ${FIT.intercept.toFixed(3)} ${sign(FIT.tvl)}·log10(TVL) ${sign(FIT.age)}·log10(age) ${sign(FIT.chains)}·log10(chains) ${sign(FIT.growth)}·growth</b>` +
    `<span class="sep">|</span><span class="k">fitted on</span><span class="v">${FIT.n} protocols that already trade</span>` +
    `<span class="sep">|</span><span class="k">R²</span><span class="v">${FIT.r2.toFixed(3)}</span>` +
    `<span class="sep">|</span><span class="k">median miss</span><span class="v">${Math.round(FIT.mdape * 100)}%</span>` +
    `<span class="sep">|</span><span class="k">band</span><span class="v">${band(FIT.low)} to ${band(FIT.high)}</span>` +
    `<span class="sep">|</span><span class="k">applied</span><span class="v">+ category offset, tilts at half strength</span>`;
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
    ['Median miss', `${Math.round(FIT.mdape * 100)}%`, 'warn'],
    ['Farm now', H.totals.farm, 'good'],
  ];
  el('facts').innerHTML = facts.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c}">${esc(v)}</dd></div>`).join('');
  el('tabRadar').textContent = H.board_size;
  el('tabLive').textContent = H.live_size;
}

function drawModel() {
  const s = sign;
  el('eq').innerHTML =
    `log10(FDV) = <b>${FIT.intercept.toFixed(3)}</b> ${s(FIT.tvl)}·log10(TVL) ${s(FIT.age)}·log10(age) ${s(FIT.chains)}·log10(chains) ${s(FIT.growth)}·growth<br />` +
    `<span style="color:var(--dim)">+ category offset · × growth, age and chain tilts at half strength</span>`;

  const mult = (b) => `×${(10 ** b).toFixed(2)}`;
  const factors = [
    ['TVL', `A tenfold TVL multiplies the value by <b>${(10 ** FIT.tvl).toFixed(2)}</b>: value grows with TVL but slower than it, so the biggest protocols by TVL carry the smallest multiples.`],
    ['Age', `A tenfold older protocol is priced <b>${(10 ** FIT.age).toFixed(2)}</b> of the younger one: in the snapshot's own trading set, the market pays less per TVL dollar for the protocols that have run longest.`],
    ['Chains', `A tenfold wider footprint is worth <b>${(10 ** FIT.chains).toFixed(2)}</b>: multi-chain protocols trade at thinner multiples than single-chain ones of the same TVL.`],
    ['7d growth', `Every <b>+100%</b> of weekly TVL growth adds <b>${(FIT.growth * 100).toFixed(1)}%</b> to the value. Measured, small, and held at half weight because one snapshot is one draw.`],
    ['Category', `Each category's median miss is added back as an offset, shrunk by its peer count and capped at ±0.45 in log. Lending, Dexs and RWA are not valued like a bridge.`],
    ['Band', `The 25th and 75th percentile miss are <b>${mult(FIT.low * 0.6)}</b> and <b>${mult(FIT.high * 0.6)}</b>: that is the whisker under every implied value, and it is why the page prints a band, not a promise.`],
  ];
  el('factors').innerHTML = factors.map(([k, v]) => `<li><span class="k">${k}</span><span class="v">${v}</span></li>`).join('');
  el('caveat').textContent =
    `Fitted on the ${FIT.n} protocols in this snapshot whose record already carries a token, a TVL and a listing date, and scored by refitting without each one: median ${Math.round(FIT.mdape * 100)}% error, R² ${FIT.r2.toFixed(3)}. ` +
    `The level is therefore a band, not a quote; what carries is the ordering and the band's width. No time series exists in one snapshot, so nothing here forecasts a launch date. Source: ${H.source}.`;
}

function drawPlanStrip() {
  const cell = (k, n, title, note) =>
    `<div class="plan-cell ${k}"><h4>${title}</h4><b>${n}</b><p>${note}</p></div>`;
  const farm = rows.filter((r) => r.verdict === 'farm');
  const capital = farm.reduce((s, r) => s + r.capital, 0);
  const cost = farm.reduce((s, r) => s + r.cost, 0);
  el('planStrip').innerHTML =
    cell('farm', H.totals.farm, 'Farm now', `Signal 55+ and gas under 5% of the position: $${capital.toLocaleString('en-US')} of capital across all of them, $${Math.round(cost)} of cost.`) +
    cell('watch', H.totals.watch, 'Watch', 'Worth a position once the protocol moves: right size, signal not there yet.') +
    cell('thin', H.totals.thin, 'Thin', 'The position is fine, the gas is not: these are chains to farm with more capital or not at all.') +
    cell('pass', H.totals.pass, 'Pass', 'Cost above 10% of the capital it needs: the plan cannot pay for itself on this chain.');
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
        <span class="n">${esc(r.name)}</span>
        <span class="s">${esc(r.slug)}${r.wl ? ' · <span class="wl">watchlist</span>' : ''}</span></span></td>
      <td><span class="chip">${esc(r.category)}</span></td>
      <td class="num">${usd(r.tvl)}</td>
      <td class="num ${r.ch7 >= 0 ? 'up' : 'down'}">${r.ch7 === null ? '-' : pct(r.ch7)}</td>
      <td class="num">${age(r.age)}</td>
      <td>${signalCell(r.signal)}</td>
      <td class="num"><span class="imp">${usd(r.implied)}</span><span class="mult">${r.multiple.toFixed(2)}× TVL</span>${bandHtml(r)}</td>
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
    <h2>${esc(r.name)}</h2>
    <p class="sub">${esc(r.category)} · ${esc(chainLine)} · rank ${r.rank} of ${rows.length} · tier ${r.tier}${r.wl ? ' · <span style="color:var(--value)">on the watchlist</span>' : ''}</p>
    <p class="big"><strong>${usd(r.implied)}</strong><em>implied FDV if it issued a token · ${r.multiple.toFixed(2)}× its ${usd(r.tvl)} of TVL</em></p>
    <div class="band2"><i style="left:${at(r.low).toFixed(1)}%;width:${Math.max(at(r.high) - at(r.low), 1).toFixed(1)}%"></i><u style="left:${at(r.implied).toFixed(1)}%"></u></div>
    <div class="bandlabels"><span>${usd(r.low)} low</span><span>${usd(r.high)} high</span></div>
    <p class="scale">Its implied value is ${r.multiple.toFixed(2)}× its own TVL, and the band the model has earned on the protocols it could check runs ${(r.low / r.tvl).toFixed(2)}× to ${(r.high / r.tvl).toFixed(2)}×: read the ranking, and read the multiple inside that band.</p>

    <h3 class="sec">Where the number comes from</h3>
    <dl class="kv">
      <dt>TVL, the record</dt><dd>${usdFull(r.tvl)}</dd>
      <dt>Fitted at that TVL</dt><dd class="hl">${usdFull(r.model.base_usd)}</dd>
      <dt>Category offset</dt><dd>×${(10 ** r.model.category_offset).toFixed(3)}</dd>
      <dt>7d growth (${r.ch7 === null ? 'not reported' : pct(r.ch7)})</dt><dd>×${r.model.growth_tilt.toFixed(3)}</dd>
      <dt>Age (${r.age === null ? 'unknown' : `${r.age} days`})</dt><dd>×${r.model.age_tilt.toFixed(3)}</dd>
      <dt>Chains (${(r.chains || []).length})</dt><dd>×${r.model.chain_tilt.toFixed(3)}</dd>
      <dt>Implied FDV</dt><dd class="v">${usdFull(r.implied)}</dd>
    </dl>

    <h3 class="sec">What the plan costs <span class="chain">on ${esc(chain)}</span></h3>
    <dl class="kv">
      <dt>Capital the position needs</dt><dd>${usdFull(r.capital)}</dd>
      <dt>Gas, ${4 + Math.round(r.hold / 7)} transactions</dt><dd>${`$${r.gas.toFixed(2)}`}</dd>
      <dt>Yield given up over ${r.hold} days</dt><dd>$${(r.cost - r.gas).toFixed(2)}</dd>
      <dt>Total cost</dt><dd>${`$${r.cost.toFixed(2)}`}</dd>
      <dt>As a share of the position</dt><dd>${pctOf(r.burden)}</dd>
      <dt>Verdict</dt><dd class="${r.verdict === 'farm' ? 'v' : 'hl'}">${r.verdict === 'farm' ? 'farm now' : r.verdict}</dd>
    </dl>

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
drawModel();
drawPlanStrip();
drawControls();
drawBoard();
drawLive();
setMode('radar');
