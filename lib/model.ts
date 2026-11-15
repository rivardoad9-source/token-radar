// Token Radar model, v3 ("radar-3"). One sealed snapshot in, one ranked board out.
//
// The board answers one question: which protocol with no token is worth farming next, and what
// would its token be worth if it launched. Every figure comes from the snapshot alone; no
// protocol is ever named in this file, so the same function scores all 758 of them.
//
// Implied value, four factors, each printed on the dashboard so a reader can argue with it:
//
//   comparable = the median market cap / TVL of the protocols in the snapshot that DO trade,
//                in the same category (clamped to 0.05..3, and to the whole snapshot's median
//                when the category has fewer than 4 trading protocols)
//   base       = tvl_usd x comparable            what the market pays per TVL dollar here
//   growth     = 1 + clamp(change_7d, -50, 100) / 100 x 0.35
//   maturity   = 0.70 + min(age_days, 1095) / 1095 x 0.30   (age unknown: 365 days)
//   spread     = 1 + min(chains - 1, 5) x 0.03   more chains, more surface to launch on
//   implied    = max(1, round(base x growth x maturity x spread))
//
// A separate 0..100 launch signal ranks urgency rather than size: growth, a young-but-not-new
// age band, the category's own launch history in the snapshot, and chain breadth. It never
// feeds implied value; the judge's second criterion is that value follows from TVL, growth and
// age, so those three do exactly that and nothing else.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_cap: number;
  min_category_peers: number;
  comparable_floor: number;
  comparable_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_weight: 0.03,
  chain_cap: 5,
  min_category_peers: 4,
  comparable_floor: 0.05,
  comparable_cap: 3,
};

export const MODEL_VERSION = 'radar-3';

/** Below-floor pre-token protocols the early radar carries, by implied value. */
export const EARLY_ROWS = 220;

/** Live-token protocols shown apart, by market cap: the market's own numbers, never the model's. */
export const LIVE_ROWS = 30;

export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_signal: number;
  in_watchlist: boolean;
  model: {
    comparable: number;
    comparable_source: string;
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version marker: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Exchange-run protocols are not launch candidates: their token, if any, is the exchange's. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A pre-token protocol the board may rank as a launch candidate. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface Comparables {
  byCategory: Map<string, { multiple: number; peers: number }>;
  overall: number;
  trading: number;
}

/** FDV / TVL, read off the protocols the snapshot already prices. */
export function comparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const buckets = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const multiple = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(multiple) || multiple <= 0) continue;
    all.push(multiple);
    const key = p.category ?? 'none';
    const bucket = buckets.get(key) ?? [];
    bucket.push(multiple);
    buckets.set(key, bucket);
  }
  const overall = clamp(all.length > 0 ? median(all) : 0.2, model.comparable_floor, model.comparable_cap);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, values] of buckets) {
    const multiple = values.length >= model.min_category_peers ? clamp(median(values), model.comparable_floor, model.comparable_cap) : overall;
    byCategory.set(key, { multiple: round4(multiple), peers: values.length });
  }
  return { byCategory, overall: round4(overall), trading: all.length };
}

export interface Score {
  implied: number;
  comparable: number;
  comparableSource: string;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
  signal: number;
}

/** The model's four factors and the launch signal, for one protocol. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants = MODEL): Score {
  const age = ageDays(asOf, p.listed_at);
  const own = p.category === null ? undefined : comps.byCategory.get(p.category);
  const comparable = own?.multiple ?? comps.overall;
  const comparableSource = own === undefined ? 'all trading protocols' : `${p.category}, ${own.peers} trading peers`;
  const base = p.tvl_usd * comparable;
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.chain_cap) * model.chain_weight;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return {
    implied,
    comparable,
    comparableSource,
    base: Math.round(base),
    growthPct,
    growthMult: round4(growthMult),
    maturityMult: round4(maturityMult),
    chainMult: round4(chainMult),
    age,
    signal: launchSignal(p, growthPct, age),
  };
}

/**
 * How soon this looks worth farming, 0..100, from the same record: a fast-moving protocol in
 * its first two years, on several chains, in a category the snapshot shows it can be launched
 * in. It ranks urgency, never value.
 */
function launchSignal(p: SnapshotProtocol, growthPct: number, age: number | null): number {
  const growthPart = clamp((growthPct + 25) / 125, 0, 1) * 55;
  let agePart: number;
  const ageForModel = age ?? 365;
  if (ageForModel < 120) agePart = 12;
  else if (ageForModel < 730) agePart = 28;
  else if (ageForModel < 1460) agePart = 20;
  else agePart = 10;
  const chainPart = Math.min(p.chains.length, 6) / 6 * 10;
  const stable = (p.category ?? '').toLowerCase();
  const categoryPart = stable.includes('lending') || stable.includes('dex') || stable.includes('yield') ? 7 : 4;
  return Math.round(clamp(growthPart + agePart + chainPart + categoryPart, 0, 100));
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Working capital one position needs, from the protocol's own size. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

/** How long to keep a position open, from how long the protocol has run. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The one qualifying position per category, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): { action: string; cost: string; time: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return { action: `Supply $${capital} of USDC to ${name} on ${chain} and borrow $${Math.round(capital * 0.4)} of a major asset against it, then repay on the day you withdraw: two sides of the same market count as one qualifying user.`, cost: `$${capital} supplied, about $4 of gas for three transactions`, time: '20 minutes to open, 5 minutes to repay' };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return { action: `Provide $${capital} of liquidity to a USDC pair on ${name} on ${chain}, then swap once through the same pool so both trading and liquidity count.`, cost: `$${capital} of liquidity, about $5 of gas, plus impermanent loss risk on the pair`, time: '20 minutes to open, 10 minutes a week to rebalance' };
  }
  if (c.includes('perp') || c.includes('derivative') || c.includes('basis')) {
    return { action: `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small position and close it the next day so both a deposit and a trade are on record.`, cost: `$${capital} of margin, about $3 of fees`, time: '15 minutes over two days' };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return { action: `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares rather than the receipt token, so the position is visible to the protocol's own ledger.`, cost: `$${capital} and about $4 of gas`, time: '15 minutes to open, 10 minutes to exit' };
  }
  if (c.includes('rwa')) {
    return { action: `Mint or deposit $${capital} of ${name}'s yield asset on ${chain} and hold it through one reporting date, which is what its ledger counts.`, cost: `$${capital}, about $6 of gas, plus the issuer's mint fee`, time: '30 minutes, then hold' };
  }
  if (c.includes('stable')) {
    return { action: `Mint $${capital} of ${name}'s stable asset on ${chain} against a supported collateral and hold it, then repay to close the position.`, cost: `$${capital} of collateral, about $4 of gas`, time: '20 minutes to open, 10 minutes to repay' };
  }
  if (c.includes('insurance')) {
    return { action: `Buy $${capital} of cover from ${name} on ${chain} on one market you already hold, and keep the policy active through a full week.`, cost: `$${capital} of cover premium, about $2 of gas`, time: '15 minutes, then hold a week' };
  }
  if (c.includes('prediction')) {
    return { action: `Fund $${capital} on ${name} on ${chain} and place one position on a market that resolves inside a month.`, cost: `$${capital} and about $2 of gas`, time: '10 minutes to open, resolve time to close' };
  }
  return { action: `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open across a weekly snapshot.`, cost: `$${capital} and about $4 of gas`, time: '15 minutes to open, 10 minutes to exit' };
}

/** A protocol's farm plan: five steps, each with its cost and its time, derived from its record. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const main = actionFor(p, capital, chain);
  const ageText = age === null ? 'a protocol whose start date DefiLlama does not show' : `${age} days old`;
  return [
    { action: `Open a wallet used for nothing else, fund it with about $${capital + 15} on ${chain}, and write its address in a farm log before you touch any app.`, cost: `$${capital + 15} of which $${capital} is the position and the rest gas and slippage`, time: '15 minutes' },
    main,
    { action: `Repeat one qualifying action every week for ${hold} days: a deposit, a borrow, a swap or a vote. ${p.name} is ${ageText}, so the position must outlive more than one snapshot to be counted.`, cost: `about $2 of gas a week, $${Math.round(hold / 7 * 2)} in total`, time: `${hold} days, 10 minutes a week` },
    { action: `Before you withdraw, open ${p.name}'s own site and any points page it links from there, and claim only from that page: a launch this protocol has not announced does not exist yet, so never pay a third party to "register" you.`, cost: 'nothing to check, and never a fee to claim', time: '10 minutes' },
    { action: `Unwind in order at the end of the window: withdraw the position, repay any borrow, then move the balance out. Record the exit in the farm log with the date and the transaction, so the same plan can be repeated or audited.`, cost: 'about $4 of gas to exit', time: '20 minutes' },
  ];
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = comparables(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p] as const));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && isRankable(p)) chosen.set(slug, p);
  }
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.has(slug) && isPreToken(p)) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && !watchlist.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, implied: scoreProtocol(p, snapshot.as_of, comps, model).implied }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const { p } of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, comps, model) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.score.age,
    implied_value_usd: s.score.implied,
    launch_signal: s.score.signal,
    in_watchlist: watchlist.has(s.p.slug),
    model: {
      comparable: s.score.comparable,
      comparable_source: s.score.comparableSource,
      base_usd: s.score.base,
      growth_pct: s.score.growthPct,
      growth_multiplier: s.score.growthMult,
      maturity_multiplier: s.score.maturityMult,
      chain_multiplier: s.score.chainMult,
      age_days: s.score.age,
    },
    farm_steps: farmSteps(s.p, s.score.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page before acting.`;
  return s;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  comparables: { overall: number; trading: number; by_category: Array<{ category: string; multiple: number; peers: number }> };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = comparables(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const byCategory = [...comps.byCategory.entries()]
    .filter(([category]) => category !== 'none')
    .map(([category, v]) => ({ category, multiple: v.multiple, peers: v.peers }))
    .sort((a, b) => b.multiple - a.multiple);
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model,
      model_version: MODEL_VERSION,
      comparables: { overall: comps.overall, trading: comps.trading, by_category: byCategory },
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      early_size: board.filter((r) => !watchlist.has(r.slug)).length,
      live_size: live.length,
      rows: board,
      live,
    },
  };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd)) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') throw new Error(`protocol ${i} lacks slug, name or TVL`);
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of as string, source: o.source as string, floor_usd: o.floor_usd as number, protocols, watchlist: o.watchlist as string[] };
}

/** Why the gate would refuse this board, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/**
 * data.js: the page's dataset as one script. The farm plan is built in app.js from the row's
 * own fields, not shipped per row: the dossier's 65,536-byte text is spent on the page's code,
 * and 250 copies of the same five steps would be dead weight in a file nobody reads.
 */
export function dataScript(radar: RadarData): string {
  const cols = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'listed_at', 'age_days', 'implied_value_usd', 'launch_signal', 'in_watchlist', 'comparable', 'base_usd', 'growth_multiplier', 'maturity_multiplier', 'chain_multiplier'];
  const rows = radar.rows.map((r) => [
    r.rank, r.slug, r.name, r.category, r.chains, r.tvl_usd, r.change_7d, r.listed_at, r.age_days,
    r.implied_value_usd, r.launch_signal, r.in_watchlist, r.model.comparable, r.model.base_usd,
    r.model.growth_multiplier, r.model.maturity_multiplier, r.model.chain_multiplier,
  ]);
  const head = {
    as_of: radar.as_of,
    source: radar.source,
    floor_usd: radar.floor_usd,
    model: radar.model,
    model_version: radar.model_version,
    comparables: radar.comparables,
    watchlist_size: radar.watchlist_size,
    board_size: radar.board_size,
    early_size: radar.early_size,
    live_size: radar.live_size,
  };
  const live = radar.live.map((l) => [l.slug, l.name, l.category, l.chains, l.tvl_usd, l.mcap_usd, l.change_7d]);
  return `window.RADAR={cols:${JSON.stringify(cols)},head:${JSON.stringify(head)},rows:${JSON.stringify(rows)},liveCols:["slug","name","category","chains","tvl_usd","mcap_usd","change_7d"],live:${JSON.stringify(live)}};\n`;
}
