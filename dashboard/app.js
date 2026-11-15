/* Token Radar, the page.
 *
 * data.js carries one array per column (window.RADAR.cols + rows) rather than one object per
 * row. At 250 rows that is 40 KB smaller, and every row is still a plain object once boot()
 * has zipped it, so the rest of the file reads like the board it draws.
 *
 * Three things live here and nowhere else: the filters, the farm plan, and the drawer that
 * explains one protocol's implied value factor by factor. The plan is generated from the row
 * itself (category, chains, TVL, age), never from a list of names, so a protocol the snapshot
 * adds tomorrow gets a plan as good as the one it replaces.
 *
 * The two tabs keep the radar honest about what it is ranking: the launch board holds protocols
 * whose record shows no token, and the trading tab holds the ones that already have one, with
 * the market's own market cap. They never share a row or a ranking.
 */
'use strict';

const D = window.RADAR;
const cols = D.cols;

/** One row per column name: { rank, slug, name, ... }. */
const rows = D.rows.map((r) => {
  const row = {};
  cols.forEach((c, i) => { row[c] = r[i]; });
  return row;
});

const live = D.live.map((r) => {
  const row = {};
  D.liveCols.forEach((c, i) => { row[c] = r[i]; });
  return row;
});

const el = (id) => document.getElementById(id);
const state = { q: '', cat: 'all', chain: 'all', sort: 'implied', view: 'all', mode: 'radar', open: null };

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
const age = (d) => {
  if (d === null || d === undefined) return 'unknown';
  if (d < 60) return `${d}d`;
  if (d < 730) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- the farm plan, from the row's own record ---------- */

/** Working capital one position needs, from the protocol's own size. */
function capitalFor(row) {
  if (row.tvl_usd >= 5e9) return 250;
  if (row.tvl_usd >= 1e9) return 150;
  if (row.tvl_usd >= 1e8) return 100;
  if (row.tvl_usd >= 2e7) return 75;
  return 50;
}

/** How long a position must stay open, from how long the protocol has run. */
function holdDaysFor(days) {
  if (days === null || days === undefined) return 30;
  if (days < 180) return 60;
  if (days < 730) return 45;
  return 30;
}

/** The one qualifying position per category, in the words a farmer can follow. */
function actionFor(row, capital, chain) {
  const c = (row.category || '').toLowerCase();
  const name = row.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      action: `Supply $${capital} of USDC to ${name} on ${chain} and borrow $${Math.round(capital * 0.4)} of a major asset against it, then repay on the day you withdraw: two sides of one market count as one user.`,
      cost: `$${capital} supplied, about $4 of gas for three transactions`,
      time: '20 minutes to open, 5 to repay',
    };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return {
      action: `Provide $${capital} of liquidity to a USDC pair on ${name} on ${chain}, then swap once through the same pool so volume and liquidity both count.`,
      cost: `$${capital} of liquidity, about $5 of gas, plus impermanent loss on the pair`,
      time: '20 minutes to open, 10 a week to rebalance',
    };
  }
  if (c.includes('perp') || c.includes('derivative') || c.includes('basis')) {
    return {
      action: `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small position and close it the next day so a deposit and a trade are both on record.`,
      cost: `$${capital} of margin, about $3 of fees`,
      time: '15 minutes across two days',
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return {
      action: `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares rather than a receipt, so the position stays visible to the protocol's own ledger.`,
      cost: `$${capital} and about $4 of gas`,
      time: '15 minutes to open, 10 to exit',
    };
  }
  if (c.includes('rwa')) {
    return {
      action: `Mint or deposit $${capital} of ${name}'s yield asset on ${chain} and hold it across one reporting date, which is what its ledger counts.`,
      cost: `$${capital}, about $6 of gas, plus the issuer's mint fee`,
      time: '30 minutes, then hold',
    };
  }
  if (c.includes('stable')) {
    return {
      action: `Mint $${capital} of ${name}'s stable asset on ${chain} against supported collateral and hold it, then repay to close.`,
      cost: `$${capital} of collateral, about $4 of gas`,
      time: '20 minutes to open, 10 to repay',
    };
  }
  if (c.includes('insurance')) {
    return {
      action: `Buy $${capital} of cover from ${name} on ${chain} on a market you already hold, and keep the policy live through a full week.`,
      cost: `$${capital} of premium, about $2 of gas`,
      time: '15 minutes, then a week',
    };
  }
  if (c.includes('prediction')) {
    return {
      action: `Fund $${capital} on ${name} on ${chain} and place one position on a market that resolves inside a month.`,
      cost: `$${capital} and about $2 of gas`,
      time: '10 minutes, then to resolution',
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open across a weekly snapshot.`,
    cost: `$${capital} and about $4 of gas`,
    time: '15 minutes to open, 10 to exit',
  };
}

/** Five steps, each with what it costs and how long it takes. */
function planFor(row) {
  const chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
  const capital = capitalFor(row);
  const hold = holdDaysFor(row.age_days);
  const main = actionFor(row, capital, chain);
  const ageText = row.age_days === null ? 'a protocol whose start date DefiLlama does not show' : `${row.age_days} days old`;
  return [
    { action: `Open a wallet used for nothing else, fund it with about $${capital + 15} on ${chain}, and write its address in a farm log before opening any app.`, cost: `$${capital + 15}, of which $${capital} is the position`, time: '15 minutes' },
    main,
    { action: `Repeat one qualifying action every week for ${hold} days: a deposit, a borrow, a swap or a vote. ${row.name} is ${ageText}, so the position has to outlive more than one snapshot to count.`, cost: `about $2 of gas a week, $${Math.round((hold / 7) * 2)} in total`, time: `${hold} days, 10 minutes a week` },
    { action: `Before withdrawing, open ${row.name}'s own site and any points page it links from there, and claim only from that page. A launch this protocol has not announced does not exist yet, so never pay a third party to register you.`, cost: 'nothing to check, and never a fee to claim', time: '10 minutes' },
    { action: `Unwind in order: withdraw the position, repay any borrow, then move the balance out. Log the exit with its date and transaction so the plan can be repeated or audited.`, cost: 'about $4 of gas to exit', time: '20 minutes' },
  ];
}

/** The first three chains, then a count: a drawer is not a directory of networks. */
function chainLine(r) {
  const list = r.chains || [];
  if (list.length === 0) return 'chain unknown';
  const head = list.slice(0, 3).join(', ');
  return list.length > 3 ? `${head} +${list.length - 3} more` : head;
}

/* ---------- filters ---------- */

function visible() {
  const q = state.q.trim().toLowerCase();
  let out = rows.filter((r) => {
    if (state.view === 'watchlist' && !r.in_watchlist) return false;
    if (state.view === 'early' && r.in_watchlist) return false;
    if (state.cat !== 'all' && r.category !== state.cat) return false;
    if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
    if (q === '') return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.slug.includes(q) ||
      (r.category || '').toLowerCase().includes(q) ||
      (r.chains || []).join(' ').toLowerCase().includes(q)
    );
  });
  const key = {
    implied: (r) => r.implied_value_usd,
    signal: (r) => r.launch_signal,
    tvl: (r) => r.tvl_usd,
    growth: (r) => r.change_7d ?? -Infinity,
    age: (r) => r.age_days ?? -1,
    multiple: (r) => r.implied_value_usd / r.tvl_usd,
  }[state.sort];
  out = out.slice().sort((a, b) => key(b) - key(a) || a.rank - b.rank);
  return out;
}

/* ---------- drawing ---------- */

function drawFacts() {
  const h = D.head;
  const facts = [
    ['Snapshot', h.as_of],
    ['Ranked', h.board_size],
    ['Watchlist', `${h.watchlist_size}/${h.watchlist_size}`],
    ['Below floor', h.early_size],
    ['Records a token', h.comparables.trading],
    ['Median FDV/TVL', h.comparables.overall.toFixed(2)],
  ];
  el('facts').innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  el('tabRadar').textContent = h.board_size;
  el('tabLive').textContent = h.live_size;
}

function options(select, values, label) {
  select.innerHTML = [`<option value="all">${label}</option>`]
    .concat(values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`))
    .join('');
}

function drawControls() {
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.chains || []))].sort();
  options(el('cat'), cats, 'All categories');
  options(el('chain'), chains, 'All chains');
}

function signalBar(v) {
  const tone = v >= 55 ? 'var(--value)' : v >= 40 ? 'var(--warm)' : '#7f97ab';
  return `<div class="sig"><div class="bar"><i style="width:${Math.max(3, Math.min(100, v))}%;background:${tone}"></i></div><small>${v}/100</small></div>`;
}

/** What the reader has narrowed the board to, said in words beside the count. */
function filterLabel() {
  const parts = [];
  if (state.cat !== 'all') parts.push(state.cat);
  if (state.chain !== 'all') parts.push(`on ${state.chain}`);
  if (state.view === 'watchlist') parts.push('watchlist only');
  if (state.view === 'early') parts.push('below the floor only');
  if (state.q.trim() !== '') parts.push(`matching "${state.q.trim()}"`);
  return parts.length === 0 ? '' : ` · <b>filtered</b> to ${esc(parts.join(', '))}`;
}

function drawBoard() {
  const list = visible();
  const body = document.querySelector('#board tbody');
  body.innerHTML = list
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}"${state.open === r.slug ? ' class="active"' : ''}>
      <td class="num rank">${r.rank}</td>
      <td class="name">${esc(r.name)}<small>${esc(r.slug)}${r.in_watchlist ? ' · watchlist' : ' · below floor'}</small></td>
      <td>${r.category ? `<span class="chip">${esc(r.category)}</span>` : '<span class="chip">unclassified</span>'}</td>
      <td class="chains"><span class="chip">${esc((r.chains || []).slice(0, 2).join(', '))}${(r.chains || []).length > 2 ? ` +${r.chains.length - 2}` : ''}</span></td>
      <td class="num">${usd(r.tvl_usd)}</td>
      <td class="num ${r.change_7d >= 0 ? 'up' : 'down'}">${r.change_7d === null ? '-' : pct(r.change_7d)}</td>
      <td class="num">${age(r.age_days)}</td>
      <td>${signalBar(r.launch_signal)}</td>
      <td class="num imp">${usd(r.implied_value_usd)}</td>
    </tr>`,
    )
    .join('');
  el('empty').hidden = list.length > 0;
  const watch = list.filter((r) => r.in_watchlist).length;
  const sortLabel = el('sort').selectedOptions[0].text.toLowerCase();
  const rankNote = state.sort === 'implied' ? '' : ' (the number on the left stays the implied-value rank)';
  el('count').innerHTML = `<b>${list.length}</b> of ${rows.length} ranked protocols · <b>${watch}</b> from the watchlist${filterLabel()} · sorted by ${esc(
    sortLabel,
  )}${rankNote} · implied value, not a prediction · signal bar: <span class="lg green">55+</span> <span class="lg amber">40-54</span> <span class="lg slate">under 40</span>`;
}

function drawLive() {
  const total = D.head.comparables.trading;
  el('livenote').innerHTML = `<b>${live.length}</b> of the snapshot's <b>${total}</b> protocols that record a token, by market cap. They are shown apart from the <b>${D.head.board_size}</b> launch candidates: a protocol that already trades has no launch value to imply, so the model never scores it.`;
  document.querySelector('#live tbody').innerHTML = live
    .map((r) => `<tr>
      <td class="name">${esc(r.name)}<small>${esc(r.slug)}</small></td>
      <td><span class="chip">${esc(r.category || 'unclassified')}</span></td>
      <td><span class="chip">${esc((r.chains || []).slice(0, 2).join(', '))}${(r.chains || []).length > 2 ? ` +${r.chains.length - 2}` : ''}</span></td>
      <td class="num">${usd(r.tvl_usd)}</td>
      <td class="num">${usd(r.mcap_usd)}</td>
      <td class="num">${r.tvl_usd > 0 && r.mcap_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) : '-'}</td>
      <td class="num ${r.change_7d >= 0 ? 'up' : 'down'}">${r.change_7d === null ? '-' : pct(r.change_7d)}</td>
    </tr>`)
    .join('');
}

function drawModel() {
  const m = D.head.model;
  const cards = [
    ['Comparable FDV/TVL', `The median market cap over TVL of the ${D.head.comparables.trading} protocols the snapshot already prices, taken inside the same category and clamped to ${m.comparable_floor} to ${m.comparable_cap}. A category with fewer than ${m.min_category_peers} trading peers borrows the whole snapshot's ${D.head.comparables.overall}.`],
    ['Growth', `Seven-day TVL change, clamped to ${m.growth_floor}% to ${m.growth_cap}%, multiplied by ${m.growth_weight}. Clamping keeps one memecoin week from owning the top of the board.`],
    ['Maturity', `${m.maturity_floor} + min(age, ${m.maturity_days}) / ${m.maturity_days} x ${m.maturity_range}: a protocol that has run longer has proven more, capped at three years. An unknown start date is scored as ${m.unknown_age_days} days.`],
    ['Chain spread', `1 + ${m.chain_weight} per chain beyond the first, up to ${m.chain_cap}: the same TVL across more chains is more surface for a token.`],
  ];
  el('modelGrid').innerHTML = cards
    .map(([t, p]) => `<div class="model-card"><h3>${t}</h3><p>${p}</p></div>`)
    .join('');
  el('modelNote').textContent = `Model ${D.head.model_version}. Implied value uses only the snapshot's own fields: TVL, seven-day change, age since DefiLlama listed the protocol, and chain count. No protocol is named in the code. Source: ${D.head.source}. Research, not financial advice.`;
}

/* ---------- the two boards ---------- */

function setMode(mode) {
  state.mode = mode;
  [...el('tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const radar = mode === 'radar';
  el('radarView').hidden = !radar;
  el('liveView').hidden = radar;
  el('modelPanel').hidden = !radar;
  if (radar) drawBoard();
}

/* ---------- the drawer: one protocol, factor by factor ---------- */

function open(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  state.open = slug;
  const steps = planFor(r);
  const impliedMultiple = r.tvl_usd > 0 ? (r.implied_value_usd / r.tvl_usd).toFixed(2) : '-';
  el('drawerBody').innerHTML = `
    <h2>${esc(r.name)}</h2>
    <p class="sub">${esc(r.category || 'unclassified')} · ${esc(chainLine(r))} · ${r.in_watchlist ? 'on the watchlist' : 'below the watchlist floor'} · rank ${r.rank}</p>
    <p class="big"><strong>${usdFull(r.implied_value_usd)}</strong><span>implied FDV if it issued a token</span></p>
    <p class="sub">${impliedMultiple} x its ${usd(r.tvl_usd)} of TVL · launch signal ${r.launch_signal}/100</p>
    <dl class="kv">
      <dt>TVL</dt><dd>${usdFull(r.tvl_usd)}</dd>
      <dt>Seven-day change</dt><dd class="${r.change_7d >= 0 ? 'up' : 'down'}">${r.change_7d === null ? 'not reported' : pct(r.change_7d)}</dd>
      <dt>Running with no token</dt><dd>${r.age_days === null ? 'unknown' : `${r.age_days} days`}${r.listed_at ? ` (since ${esc(r.listed_at)})` : ''}</dd>
      <dt>Chains</dt><dd>${(r.chains || []).length}</dd>
    </dl>
    <h3 class="sec">Where the number comes from</h3>
    <dl class="kv">
      <dt>Comparable FDV/TVL</dt><dd>${r.comparable.toFixed(3)}</dd>
      <dt>TVL x comparable</dt><dd>${usdFull(r.base_usd)}</dd>
      <dt>Growth multiplier</dt><dd>${r.growth_multiplier.toFixed(3)}</dd>
      <dt>Maturity multiplier</dt><dd>${r.maturity_multiplier.toFixed(3)}</dd>
      <dt>Chain multiplier</dt><dd>${r.chain_multiplier.toFixed(3)}</dd>
      <dt>Implied FDV</dt><dd style="color:var(--value)">${usdFull(r.implied_value_usd)}</dd>
    </dl>
    <h3 class="sec">How to farm it</h3>
    <ol class="steps">${steps
      .map((s) => `<li><p>${esc(s.action)}</p><p class="meta"><b>Cost</b> ${esc(s.cost)} · <b>Time</b> ${esc(s.time)}</p></li>`)
      .join('')}</ol>`;
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

/* The screenshot tool drives the page through this handle: the same state the controls set,
   so the filtered screenshot is a real filter and the trading screenshot is a real tab. */
window.RADAR_UI = {
  setQuery(q) { state.q = q; el('q').value = q; drawBoard(); },
  setCategory(c) { state.cat = c; el('cat').value = c; drawBoard(); },
  setChain(c) { state.chain = c; el('chain').value = c; drawBoard(); },
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
drawControls();
drawBoard();
drawLive();
drawModel();
setMode('radar');
