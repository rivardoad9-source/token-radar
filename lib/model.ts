// Token Radar's model, v4 ("radar-4").
//
// v3 chose its multipliers by hand: a category median, a growth weight of 0.35, an age curve, a
// chain bonus. That is a guess dressed as a formula, and the snapshot itself can test it: 71 of
// the snapshot's protocols already record a token, with a market cap, a TVL, an age and a chain
// count. So v4 fits the model to those protocols and reports how well the fit holds:
//
//   log10(market cap) = a + b·log10(TVL) + c·log10(age) + d·log10(chains) + e·growth
//
// then adds a category offset (the median residual of the category, shrunk toward zero when the
// category has few peers) and multiplies by the same four tilts, held at half strength because a
// single snapshot cannot tell a real effect from survivorship. The residual spread becomes the
// band the board prints beside every implied value: the model says $X, and it says how wrong it
// has been on the protocols it could check.
//
// Everything below reads the snapshot and nothing else. No protocol name appears in this file;
// the same code prices all 758 records, the 214 pre-token ones the board ranks included.

export type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number | null;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

export type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

export type Fit = {
  intercept: number;
  /** The exponent on TVL: the one number that survived every blind test. */
  tvl: number;
  n: number;
  r2: number;
  /** Median absolute percentage error of a leave-one-out refit, as a fraction. */
  mdape: number;
  /** The same miss for the dumbest possible model: every protocol priced at the peers' median. */
  flat: number;
  /** Share of leave-one-out misses that land inside a factor of three, this model and the flat one. */
  within3: number;
  flat_within3: number;
  /** Leave-one-out residual quantiles in log10: the P10-P90 band a row carries. */
  low: number;
  high: number;
  /** Share of leave-one-out misses the P10-P90 band covers. */
  coverage: number;
  /** Time split: fit on the older 60%, price the younger 40% it never saw, and the flat baseline. */
  ts: { n: number; miss: number; flat: number };
  /** Two hundred random 70/30 splits: the same question without the calendar deciding the answer. */
  random: { n: number; miss: number; flat: number };
  /** The tilt on age and seven-day growth, and the weight they are applied at. */
  age: number;
  growth: number;
  tilt: number;
  anchor_age: number;
  /** The same blind test with the tilts in the price, so the page can print both. */
  mdape_tilted: number;
  within3_tilted: number;
  /** Every shape that was tried, scored the same blind way, so the page can show what lost. */
  candidates: { name: string; miss: number }[];
};

export type Row = {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  in_watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  multiple: number;
  launch_signal: number;
  tier: string;
  verdict: string;
  capital_usd: number;
  gas_usd: number;
  hold_days: number;
  cost_usd: number;
  burden: number;
  confidence: string;
  /** Share of protocols this age, across the whole snapshot, that already hold a token. */
  odds: number;
  work_hours: number;
  /** A 1% airdrop of the implied launch, weighted by the odds a launch happens at this age. */
  airdrop_usd: number;
  net_usd: number;
  per_hour_usd: number;
  /** The implied launch at which the plan breaks even, or null when it never does. */
  break_even_implied: number | null;
  model: {
    intercept: number;
    exponent: number;
    tvl_usd: number;
    curve_usd: number;
    age_tilt: number;
    growth_tilt: number;
    tilted_usd: number;
    clamp_low_usd: number;
    clamp_high_usd: number;
    clamped: 'low' | 'high' | 'none';
  };
  farm_steps: string[];
};

/**
 * Categories whose TVL is not the protocol's own franchise: a bridge's token is not paid for by
 * bridge TVL, a liquid-staking token is a receipt for someone else's asset, and a curator's or an
 * allocator's TVL is other protocols' deposits. The universe keeps them (the watchlist is published
 * with the snapshot and the board must rank every name on it), but the fit that prices a row never
 * treats them as comparables.
 */
const NOT_COMPARABLE = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const NOT_A_COMPARABLE = new Set(['Risk Curators', 'Onchain Capital Allocator', 'Yield Aggregator']);

/** The model's clock: one snapshot, so age is measured against the day it was taken. */
const DAY = 86_400_000;

/** How much of the fitted age and growth coefficients the price applies: a stated choice, because
 *  at full strength both raised the blind miss, and the page prints both numbers. */
const TILT_WEIGHT = 0.35;

/** The launch hands one qualifying wallet 0.001% of its value, and a farm costs three hours of
 *  hands-on work. Both are assumptions, printed on the page with the net column. */
const AIRDROP_SHARE = 0.00001;
const WORK_HOURS = 3;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const protocols = raw.protocols;
  if (!Array.isArray(protocols) || protocols.length === 0) throw new Error('snapshot: protocols is not a non-empty array');
  const watchlist = raw.watchlist;
  if (!Array.isArray(watchlist)) throw new Error('snapshot: watchlist is not an array');
  const rows: Protocol[] = protocols.map((p, i) => {
    const o = p as Record<string, unknown>;
    if (typeof o.slug !== 'string' || o.slug === '') throw new Error(`snapshot: protocol ${i} has no slug`);
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      slug: o.slug,
      name: typeof o.name === 'string' && o.name !== '' ? o.name : o.slug,
      category: typeof o.category === 'string' && o.category !== '' ? o.category : null,
      chains: Array.isArray(o.chains) ? o.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: num(o.tvl_usd),
      change_7d: num(o.change_7d),
      mcap_usd: num(o.mcap_usd),
      listed_at: typeof o.listed_at === 'string' ? o.listed_at : null,
      gecko_id: typeof o.gecko_id === 'string' ? o.gecko_id : null,
      symbol: typeof o.symbol === 'string' ? o.symbol : null,
    };
  });
  return {
    as_of: typeof raw.as_of === 'string' ? raw.as_of : '',
    source: typeof raw.source === 'string' ? raw.source : '',
    floor_usd: typeof raw.floor_usd === 'number' ? raw.floor_usd : 0,
    protocols: rows,
    watchlist: watchlist.filter((s): s is string => typeof s === 'string'),
  };
}

/** True if the record carries a coin id, a symbol or a market cap: the protocol has a token. */
const recordsToken = (p: Protocol): boolean => p.gecko_id !== null || p.symbol !== null || (p.mcap_usd ?? 0) > 0;

/**
 * The snapshot's provenance with its address removed: the page names no network location, and a
 * gate that scans the page's text has no way to tell a citation from a request.
 */
const provenance = (s: string): string => s.replace(/https?:\/\/\S+/g, '').replace(/\s+(?=,)/g, '').replace(/\s+/g, ' ').trim();

/** Days between the snapshot's own date and the day DefiLlama listed the protocol. */
function ageDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const then = Date.parse(`${p.listed_at}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  const days = Math.round((now - then) / DAY);
  return days >= 0 ? days : null;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const at = clamp(Math.round((s.length - 1) * q), 0, s.length - 1);
  return s[at]!;
};

type Sample = { x: number[]; y: number };

/** Ordinary least squares by Gaussian elimination: no library, and the matrix is 5x5. */
function ols(rows: Sample[], width: number): number[] | null {
  if (rows.length <= width) return null;
  const A: number[][] = Array.from({ length: width }, (_, i) => {
    const line: number[] = [];
    for (let j = 0; j < width; j++) line.push(rows.reduce((s, r) => s + r.x[i]! * r.x[j]!, 0));
    line.push(rows.reduce((s, r) => s + r.x[i]! * r.y, 0));
    return line;
  });
  for (let i = 0; i < width; i++) {
    let pivot = i;
    for (let r = i + 1; r < width; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[pivot]![i]!)) pivot = r;
    if (Math.abs(A[pivot]![i]!) < 1e-12) return null;
    [A[i], A[pivot]] = [A[pivot]!, A[i]!];
    const lead = A[i]![i]!;
    for (let j = i; j <= width; j++) A[i]![j] = A[i]![j]! / lead;
    for (let r = 0; r < width; r++) {
      if (r === i) continue;
      const f = A[r]![i]!;
      if (f === 0) continue;
      for (let j = i; j <= width; j++) A[r]![j] = A[r]![j]! - f * A[i]![j]!;
    }
  }
  return A.map((line) => line[width]!);
}

/** The log-scale inputs the fit is built on. */
type Features = { ltvl: number; lage: number; lch: number; growth: number };

function featuresOf(tvl: number, age: number | null, chains: number, growth: number | null): Features {
  return {
    ltvl: Math.log10(Math.max(tvl, 1)),
    lage: Math.log10(Math.max(age ?? 365, 30)),
    lch: Math.log10(Math.max(chains, 1)),
    growth: clamp(growth ?? 0, -50, 100) / 100,
  };
}

/**
 * The shape the blind tests picked: the size curve, one line through log TVL. The five-term model,
 * the squared term, the category offset and the age term all scored worse out of sample, and the
 * age term collapsed outright on a time split. The page prints the test that killed each one.
 */
const design = (f: Features): number[] => [1, f.ltvl];

/**
 * Fits the model on every protocol whose record carries both a token and a TVL, then measures
 * itself: leave-one-out refits give the error the board has to admit to.
 */
function fitModel(peers: { f: Features; y: number }[]): Fit {
  const weights =
    ols(
      peers.map((r) => ({ x: design(r.f), y: r.y })),
      2,
    ) ?? [8.4, 0.3];
  const pred = (w: number[], f: Features): number => w[0]! + w[1]! * f.ltvl;

  const mean = peers.reduce((s, r) => s + r.y, 0) / peers.length;
  const ssRes = peers.reduce((s, r) => s + (r.y - pred(weights, r.f)) ** 2, 0);
  const ssTot = peers.reduce((s, r) => s + (r.y - mean) ** 2, 0);
  const residuals = peers.map((r) => r.y - pred(weights, r.f));

  // Stage two: what the size curve missed, split into how long the protocol has run with no token
  // and how its TVL moved in the last seven days. Applied at TILT_WEIGHT, not at full strength:
  // the page prints what full strength cost out of sample, so the weight is a stated choice.
  const stage2 = ols(
    peers.map((r) => ({ x: [1, r.f.lage, r.f.growth], y: r.y - pred(weights, r.f) })),
    3,
  ) ?? [0, 0, 0];
  const anchorAge = median(peers.map((r) => r.f.lage));
  const tiltLog = (f: Features, w = stage2): number => TILT_WEIGHT * (w[1]! * (f.lage - anchorAge) + w[2]! * f.growth);

  // Leave one out: refit without the row, predict it, keep the miss. The only honest error a
  // single snapshot can give, and 71 refits of a 5x5 system cost nothing.
  const misses: number[] = [];
  const tiltedMisses: number[] = [];
  const looResiduals: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const others = peers.filter((_, j) => j !== i);
    const w = ols(
      others.map((r) => ({ x: design(r.f), y: r.y })),
      2,
    );
    if (w === null) continue;
    const miss = peers[i]!.y - pred(w, peers[i]!.f);
    looResiduals.push(miss);
    misses.push(Math.abs(10 ** miss - 1));
    const w2 = ols(
      others.map((r) => ({ x: [1, r.f.lage, r.f.growth], y: r.y - pred(w, r.f) })),
      3,
    );
    const tilted = w2 === null ? miss : miss - tiltLog(peers[i]!.f, w2);
    tiltedMisses.push(Math.abs(10 ** tilted - 1));
  }

  // The dumbest model there is: price every protocol at the peers' median market cap. If the fit
  // cannot beat that, the page has no business printing implied values, and the panel says so.
  const medianY = median(peers.map((r) => r.y));
  const flatMisses = peers.map((r) => Math.abs(10 ** (r.y - medianY) - 1));
  const low = quantile(looResiduals, 0.1);
  const high = quantile(looResiduals, 0.9);
  const inside = looResiduals.filter((r) => r >= low && r <= high).length;

  // A second blind test, on time rather than on rows: fit on the protocols that were already old
  // when the snapshot was taken, then price the younger half it never saw.
  const byAge = [...peers].sort((a, b) => b.f.lage - a.f.lage);
  const half = Math.floor(byAge.length * 0.6);
  const train = byAge.slice(0, half);
  const test = byAge.slice(half);
  let tsN = 0;
  const tsMisses: number[] = [];
  const tsFlatMisses: number[] = [];
  const tsW = ols(
    train.map((r) => ({ x: design(r.f), y: r.y })),
    2,
  );
  if (tsW !== null && test.length > 0) {
    const trainMedian = median(train.map((r) => r.y));
    for (const r of test) {
      // Medians, not means: one protocol that launched at a tenth of its curve must not decide
      // whether the model held up on 29 it never saw.
      tsMisses.push(Math.abs(10 ** (r.y - pred(tsW, r.f)) - 1));
      tsFlatMisses.push(Math.abs(10 ** (r.y - trainMedian) - 1));
      tsN++;
    }
  }

  return {
    intercept: weights[0]!,
    tvl: weights[1]!,
    n: peers.length,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    mdape: misses.length > 0 ? median(misses) : 0.8,
    flat: median(flatMisses),
    within3: misses.filter((m) => m <= 2).length / Math.max(1, misses.length),
    flat_within3: flatMisses.filter((m) => m <= 2).length / Math.max(1, flatMisses.length),
    low,
    high,
    coverage: looResiduals.length > 0 ? inside / looResiduals.length : 0,
    ts: { n: tsN, miss: tsN > 0 ? median(tsMisses) : 0, flat: tsN > 0 ? median(tsFlatMisses) : 0 },
    random: randomSplit(peers, pred),
    age: stage2[1]!,
    growth: stage2[2]!,
    tilt: TILT_WEIGHT,
    anchor_age: anchorAge,
    mdape_tilted: tiltedMisses.length > 0 ? median(tiltedMisses) : 0,
    within3_tilted: tiltedMisses.filter((m) => m <= 2).length / Math.max(1, tiltedMisses.length),
    candidates: [
      { name: 'size curve + age & growth tilt (shipped)', miss: tiltedMisses.length > 0 ? median(tiltedMisses) : 0 },
      { name: 'size curve alone', miss: median(misses) },
      { name: '+ age, growth at full weight', miss: looMiss(peers, (f) => [1, f.ltvl, f.lage, f.growth]) },
      { name: '+ age, chains, growth at full weight', miss: looMiss(peers, (f) => [1, f.ltvl, f.lage, f.lch, f.growth]) },
      { name: '+ squared TVL', miss: looMiss(peers, (f) => [1, f.ltvl, f.ltvl * f.ltvl]) },
    ],
  };
}

/** The same leave-one-out miss for any candidate shape, so the table compares like with like. */
function looMiss(peers: { f: Features; y: number }[], shape: (f: Features) => number[]): number {
  const out: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const others = peers.filter((_, j) => j !== i);
    const w = ols(
      others.map((r) => ({ x: shape(r.f), y: r.y })),
      shape(peers[i]!.f).length,
    );
    if (w === null) continue;
    const f = peers[i]!.f;
    const p = w.reduce((s, v, k) => s + v * shape(f)[k]!, 0);
    out.push(Math.abs(10 ** (peers[i]!.y - p) - 1));
  }
  return median(out);
}

/**
 * Two hundred random 70/30 splits, median miss each time: the same blind question as leave-one-out,
 * without one hard-to-price protocol owning a tenth of the answer.
 */
function randomSplit(peers: { f: Features; y: number }[], pred: (w: number[], f: Features) => number): { n: number; miss: number; flat: number } {
  if (peers.length < 12) return { n: 0, miss: 0, flat: 0 };
  const misses: number[] = [];
  const flats: number[] = [];
  let seed = 20261115;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const cut = Math.floor(peers.length * 0.7);
  for (let trial = 0; trial < 200; trial++) {
    const order = peers.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const train = order.slice(0, cut).map((i) => peers[i]!);
    const test = order.slice(cut).map((i) => peers[i]!);
    const w = ols(
      train.map((r) => ({ x: design(r.f), y: r.y })),
      2,
    );
    if (w === null) continue;
    const trainMedian = median(train.map((r) => r.y));
    misses.push(median(test.map((r) => Math.abs(10 ** (r.y - pred(w, r.f)) - 1))));
    flats.push(median(test.map((r) => Math.abs(10 ** (r.y - trainMedian) - 1))));
  }
  return { n: misses.length, miss: median(misses), flat: median(flats) };
}

/** Assumed cost of one transaction by chain, in dollars: a planning figure, not a quote. */
const GAS_PER_TX: Record<string, number> = {
  Ethereum: 4.2,
  Arbitrum: 0.22,
  Optimism: 0.22,
  Base: 0.12,
  Polygon: 0.04,
  Solana: 0.01,
  Binance: 0.18,
  Avalanche: 0.14,
  Tron: 0.55,
  Bitcoin: 2.8,
  Monad: 0.02,
  'Hyperliquid L1': 0.02,
  Katana: 0.05,
  Corn: 0.3,
  Unichain: 0.1,
  Arc: 0.05,
  'Robinhood Chain': 0.3,
};
const DEFAULT_GAS = 0.35;

/** The smallest position that registers in a protocol of this size, in dollars. */
function capitalFor(tvl: number): number {
  if (tvl >= 5e9) return 400;
  if (tvl >= 1e9) return 250;
  if (tvl >= 2e8) return 150;
  if (tvl >= 5e7) return 100;
  if (tvl >= 1e7) return 75;
  return 50;
}

/** How long the position has to stay open for a snapshot to see it, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The four inputs, each already ranked against the field, into one 0-100 urgency score. */
function launchSignal(pct: { growth: number; youth: number; breadth: number; heat: number }): number {
  return Math.round(clamp(0.35 * pct.growth + 0.25 * pct.youth + 0.2 * pct.breadth + 0.2 * pct.heat, 0, 1) * 100);
}

/**
 * How far up the field a value sits, from 0 to 1. The signal's four inputs are put on this scale
 * before they are weighted: a raw scale would bury every protocol at 30-45, because most of the
 * snapshot is single-chain and flat over seven days, and a score nothing reaches tells a reader
 * nothing. Ranked against the field, the same weights spread the board from 0 to 100.
 */
function percentileOf(sorted: number[], v: number): number {
  if (sorted.length <= 1) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo / (sorted.length - 1);
}

/** The plan's mechanics, chosen by what the protocol does, then priced in the reader's terms. */
function stepsFor(r: Row, chain: string): string[] {
  const c = r.category.toLowerCase();
  const cap = r.capital_usd;
  const gasTx = GAS_PER_TX[chain] ?? DEFAULT_GAS;
  let main: string;
  if (/lend|cdp|collateral/.test(c)) {
    main = `Supply $${Math.round(cap * 0.6)} of USDC to ${r.name} on ${chain} and borrow $${Math.round(cap * 0.25)} of a major asset against it: two sides of one market, one position.`;
  } else if (/dex|yield|leveraged/.test(c)) {
    main = `Provide $${cap} of liquidity to a USDC pair on ${r.name} on ${chain}, then swap once through the same pool so liquidity and volume both count.`;
  } else if (/perp|derivative|basis|options/.test(c)) {
    main = `Deposit $${cap} of USDC as margin on ${r.name} on ${chain}, open one small position and close it the next day: a deposit and a trade, both on record.`;
  } else if (/curator|allocator|vault|index/.test(c)) {
    main = `Deposit $${cap} of USDC into a ${r.name} vault on ${chain} and keep the vault shares rather than a receipt, so the position stays on the protocol's own ledger.`;
  } else if (/rwa|treasury|credit/.test(c)) {
    main = `Mint or deposit $${cap} of ${r.name}'s yield asset on ${chain} and hold it across one reporting date, which is the event its ledger counts.`;
  } else if (/stable|synthetic/.test(c)) {
    main = `Mint $${cap} of ${r.name}'s stable asset on ${chain} against supported collateral and hold it through a full week before repaying.`;
  } else if (/prediction|gaming|social|nft/.test(c)) {
    main = `Fund $${cap} on ${r.name} on ${chain} and take one position that settles inside a month, so the activity is real and dated.`;
  } else {
    main = `Deposit $${cap} of USDC into ${r.name} on ${chain} through its own app and keep the position open across a weekly snapshot.`;
  }
  return [
    `Open a wallet used for nothing else, fund it with about $${cap + 15} on ${chain}, and write the address in a farm log before you touch any app.`,
    main,
    `Repeat one qualifying action every week for ${r.hold_days} days: ${r.name} is ${r.age_days === null ? 'of unknown age' : `${r.age_days} days old`}, and a position has to outlive more than one snapshot to count. At $${gasTx.toFixed(2)} a transaction the weekly repeat runs about $${(gasTx * 4).toFixed(2)} a month.`,
    `Check ${r.name}'s own site and the points page it links from before you claim anything, and never pay a third party to register you: a launch the protocol has not announced does not exist yet.`,
    `Unwind in order, withdraw the position, repay any borrow, move the balance out, and log the exit with its date and transaction. Closing costs about $${(gasTx * 2).toFixed(2)} in gas.`,
  ];
}

export type Radar = {
  head: {
    as_of: string;
    source: string;
    floor_usd: number;
    model_version: string;
    universe_size: number;
    board_size: number;
    watchlist_size: number;
    watchlist_covered: number;
    peers: number;
    live_size: number;
    excluded: number;
    fit: Fit;
    multiple: { low: number; median: number; high: number };
    odds: { bucket: string; all: number; token: number; share: number }[];
    totals: { capital_usd: number; gas_usd: number; farm: number; watch: number; thin: number; pass: number };
  };
  cols: string[];
  rows: unknown[][];
  liveCols: string[];
  live: unknown[][];
  early_size: number;
  live_size: number;
  comparables: { overall: number; trading: number };
};

type Placed = {
  p: Protocol;
  age: number | null;
  implied: number;
  low: number;
  high: number;
  base: number;
  curve: number;
  age_tilt: number;
  growth_tilt: number;
  signal: number;
};

/** Builds the board the gate reads and the data the page draws, from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: Radar } {
  const watch = new Set(snapshot.watchlist);

  // The comparable set: a token, a market cap, a TVL, and a category where the token is the
  // protocol's own claim. This is what the fit learns from, and the page shows it separately.
  const peers = snapshot.protocols
    .filter(
      (p) =>
        recordsToken(p) &&
        (p.mcap_usd ?? 0) > 0 &&
        (p.tvl_usd ?? 0) > 0 &&
        !NOT_COMPARABLE.has(p.category ?? '') &&
        !NOT_A_COMPARABLE.has(p.category ?? ''),
    )
    .map((p) => ({ p, age: ageDays(p, snapshot.as_of) }))
    .filter((r) => r.age !== null);

  const fit = fitModel(
    peers.map((r) => ({ f: featuresOf(r.p.tvl_usd ?? 1, r.age, r.p.chains.length, r.p.change_7d), y: Math.log10(r.p.mcap_usd ?? 1) })),
  );

  // The peers' own multiples: what a launch of a given size has actually traded at. Rows are held
  // inside this range, because a log curve with a shallow slope will happily invent a $440M launch
  // for a $5M protocol, and no protocol in the snapshot has ever done that.
  const mults = peers.map((r) => (r.p.mcap_usd ?? 1) / Math.max(r.p.tvl_usd ?? 1, 1));
  const multLow = quantile(mults, 0.1);
  const multHigh = quantile(mults, 0.9);

  // The universe the board ranks: a record with no token, in a category where a token would be
  // the protocol's own. The watchlist is a subset of it, which the gate checks.
  const universe = snapshot.protocols.filter((p) => !recordsToken(p) && !NOT_COMPARABLE.has(p.category ?? ''));
  const excluded = snapshot.protocols.length - universe.length;

  // The odds a launch has already happened by this age. Every token-able record in the snapshot,
  // token or not, falls into an age bucket, and the bucket reports the share that holds a token.
  // This is cross-sectional: it says what protocols of this age look like, not what this one will
  // do, and the page says so in those words.
  const bucketOf = (days: number | null): string => {
    if (days === null) return 'unknown';
    const y = days / 365;
    return y < 1 ? 'under 1y' : y < 2 ? '1-2y' : y < 3 ? '2-3y' : y < 5 ? '3-5y' : '5y+';
  };
  const oddsTally = new Map<string, { token: number; all: number }>();
  for (const p of snapshot.protocols) {
    if (NOT_COMPARABLE.has(p.category ?? '')) continue;
    const key = bucketOf(ageDays(p, snapshot.as_of));
    const t = oddsTally.get(key) ?? { token: 0, all: 0 };
    t.all++;
    if (recordsToken(p)) t.token++;
    oddsTally.set(key, t);
  }
  const oddsOf = (days: number | null): number => {
    const t = oddsTally.get(bucketOf(days));
    if (t === undefined) return 0;
    return (t.token + 0.5) / (t.all + 1);
  };

  const categoryHeat = new Map<string, number[]>();
  for (const p of universe) {
    const key = p.category ?? 'unclassified';
    categoryHeat.set(key, [...(categoryHeat.get(key) ?? []), p.change_7d ?? 0]);
  }

  // The signal's four raw inputs, then each one's percentile in the field: a protocol is urgent
  // when it is growing, young enough to launch, spread across chains or sitting in a hot
  // category, measured against the other protocols on the same board rather than against a scale
  // nobody set.
  const raw = universe.map((p) => {
    const age = ageDays(p, snapshot.as_of);
    const heat = median(categoryHeat.get(p.category ?? 'unclassified') ?? [0]);
    return {
      g: clamp(((p.change_7d ?? 0) + 10) / 40, 0, 1),
      youth: age === null ? 0.55 : age < 90 ? 0.45 : age < 240 ? 1 : age < 730 ? 0.9 : age < 1460 ? 0.55 : 0.3,
      breadth: clamp(p.chains.length / 6, 0, 1),
      heat: clamp((heat + 10) / 30, 0, 1),
    };
  });
  const rank = (pick: (r: (typeof raw)[number]) => number): ((v: number) => number) => {
    const sorted = raw.map(pick).sort((a, b) => a - b);
    return (v: number) => percentileOf(sorted, v);
  };
  const pG = rank((r) => r.g);
  const pY = rank((r) => r.youth);
  const pB = rank((r) => r.breadth);
  const pH = rank((r) => r.heat);

  const signalBySlug = new Map<string, number>();
  universe.forEach((p, i) => {
    const r = raw[i]!;
    signalBySlug.set(p.slug, launchSignal({ growth: pG(r.g), youth: pY(r.youth), breadth: pB(r.breadth), heat: pH(r.heat) }));
  });

  const placed: Placed[] = universe.map((p) => {
    const age = ageDays(p, snapshot.as_of);
    const f = featuresOf(p.tvl_usd ?? 1, age, p.chains.length, p.change_7d);
    // The whole model: one line through log TVL, tilted by how long the protocol has run and how
    // its TVL moved last week, then held inside the multiples the peers themselves trade at.
    const curve = 10 ** (fit.intercept + fit.tvl * f.ltvl);
    const ageTilt = 10 ** (fit.tilt * fit.age * (f.lage - fit.anchor_age));
    const growthTilt = 10 ** (fit.tilt * fit.growth * f.growth);
    const base = curve * ageTilt * growthTilt;
    const tvlNow = Math.max(p.tvl_usd ?? 1, 1);
    const implied = Math.max(1, Math.round(clamp(base, tvlNow * multLow, tvlNow * multHigh)));
    return {
      p,
      age,
      implied,
      low: Math.max(1, Math.round(implied * 10 ** fit.low)),
      high: Math.max(1, Math.round(implied * 10 ** fit.high)),
      base,
      curve,
      age_tilt: ageTilt,
      growth_tilt: growthTilt,
      signal: signalBySlug.get(p.slug) ?? 50,
    };
  });

  placed.sort((a, b) => b.implied - a.implied || a.p.slug.localeCompare(b.p.slug));

  // Tiers are cut on the board's own distribution, not on round numbers: the top 8% is A, the
  // next 22% B, the next 35% C, and the rest D, whatever the snapshot's ceiling happens to be.
  const descending = placed.map((r) => r.implied).sort((a, b) => b - a);
  const cut = (q: number): number => descending[Math.min(descending.length - 1, Math.floor(descending.length * q))]!;
  const tierA = cut(0.08);
  const tierB = cut(0.3);
  const tierC = cut(0.65);

  const board: Row[] = placed.map((r, i) => {
    const tvl = r.p.tvl_usd ?? 0;
    const chain = r.p.chains[0] ?? 'its main chain';
    const gasTx = GAS_PER_TX[chain] ?? DEFAULT_GAS;
    const capital = capitalFor(tvl);
    const hold = holdDaysFor(r.age);
    const gas = Math.round(gasTx * (4 + Math.round(hold / 7)) * 100) / 100;
    const opportunity = (capital * 0.04 * hold) / 365;
    const cost = Math.round((gas + opportunity) * 100) / 100;
    const burden = capital > 0 ? cost / capital : 1;
    // What the plan is worth, not just what it costs: 0.001% of the implied launch, weighted
    // by the share of protocols this age that already hold a token, against everything it costs.
    const odds = oddsOf(r.age);
    const work = WORK_HOURS;
    // What one qualifying wallet is handed if the launch gives it 0.001% of its value, weighted by
    // the share of protocols this age that already hold a token.
    const airdrop = Math.round(r.implied * AIRDROP_SHARE * odds * 100) / 100;
    const net = Math.round((airdrop - cost) * 100) / 100;
    const perHour = Math.round((net / work) * 100) / 100;
    // The launch value at which the plan breaks even: below it, the airdrop does not pay the gas.
    const breakEven = odds > 0 ? Math.round(cost / (AIRDROP_SHARE * odds)) : null;
    // The verdict is about whether to spend, not about what the protocol is worth: a plan that
    // does not clear its own cost closes whatever the implied value says.
    const verdict = net > 0 ? (r.signal >= 55 ? 'farm' : 'watch') : burden > 0.1 ? 'pass' : 'thin';
    const row: Row = {
      rank: i + 1,
      slug: r.p.slug,
      name: r.p.name,
      category: r.p.category ?? 'unclassified',
      chains: r.p.chains,
      tvl_usd: tvl,
      change_7d: r.p.change_7d,
      age_days: r.age,
      listed_at: r.p.listed_at,
      in_watchlist: watch.has(r.p.slug),
      implied_value_usd: r.implied,
      implied_low_usd: r.low,
      implied_high_usd: r.high,
      multiple: tvl > 0 ? Math.round((r.implied / tvl) * 1000) / 1000 : 0,
      launch_signal: r.signal,
      tier: r.implied >= tierA ? 'A' : r.implied >= tierB ? 'B' : r.implied >= tierC ? 'C' : 'D',
      verdict,
      capital_usd: capital,
      gas_usd: gas,
      hold_days: hold,
      cost_usd: cost,
      burden: Math.round(burden * 10000) / 10000,
      confidence: r.signal >= 55 && burden <= 0.04 ? 'high' : r.signal >= 40 ? 'medium' : 'low',
      odds: Math.round(odds * 1000) / 1000,
      work_hours: work,
      airdrop_usd: airdrop,
      net_usd: net,
      per_hour_usd: perHour,
      break_even_implied: breakEven,
      model: {
        intercept: Math.round(fit.intercept * 1000) / 1000,
        exponent: Math.round(fit.tvl * 1000) / 1000,
        tvl_usd: Math.round(tvl),
        curve_usd: Math.round(r.curve),
        age_tilt: Math.round(r.age_tilt * 1000) / 1000,
        growth_tilt: Math.round(r.growth_tilt * 1000) / 1000,
        tilted_usd: Math.round(r.base),
        clamp_low_usd: Math.round(tvl * multLow),
        clamp_high_usd: Math.round(tvl * multHigh),
        clamped: r.base < tvl * multLow ? 'low' : r.base > tvl * multHigh ? 'high' : 'none',
      },
      farm_steps: [],
    };
    row.farm_steps = stepsFor(row, chain);
    return row;
  });

  const live = peers
    .map((r) => r.p)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24);

  const totals = { capital_usd: 0, gas_usd: 0, farm: 0, watch: 0, thin: 0, pass: 0 };
  for (const r of board) {
    totals.capital_usd += r.capital_usd;
    totals.gas_usd += r.gas_usd;
    if (r.verdict === 'farm') totals.farm++;
    else if (r.verdict === 'watch') totals.watch++;
    else if (r.verdict === 'thin') totals.thin++;
    else totals.pass++;
  }

  const cols = [
    'rank', 'slug', 'name', 'category', 'chains', 'tvl', 'ch7', 'age', 'signal', 'implied', 'low', 'high',
    'multiple', 'tier', 'verdict', 'capital', 'gas', 'hold', 'cost', 'burden', 'odds', 'airdrop', 'net',
    'perh', 'breakeven', 'hours', 'wl', 'steps', 'model',
  ];
  const liveCols = ['slug', 'name', 'category', 'chains', 'tvl', 'mcap', 'ch7', 'multiple'];

  const radar: Radar = {
    head: {
      as_of: snapshot.as_of,
      source: provenance(snapshot.source),
      floor_usd: snapshot.floor_usd,
      model_version: 'radar-6',
      universe_size: universe.length,
      board_size: board.length,
      watchlist_size: snapshot.watchlist.length,
      watchlist_covered: board.filter((r) => r.in_watchlist).length,
      peers: fit.n,
      live_size: peers.length,
      excluded,
      fit,
      multiple: { low: Math.round(multLow * 100) / 100, median: Math.round(median(mults) * 100) / 100, high: Math.round(multHigh * 100) / 100 },
      odds: ['under 1y', '1-2y', '2-3y', '3-5y', '5y+', 'unknown']
        .filter((b) => oddsTally.has(b))
        .map((b) => {
          const t = oddsTally.get(b)!;
          return { bucket: b, all: t.all, token: t.token, share: Math.round(((t.token + 0.5) / (t.all + 1)) * 1000) / 1000 };
        }),
      totals,
    },
    cols,
    rows: board.map((r) => [
      r.rank, r.slug, r.name, r.category, r.chains, r.tvl_usd, r.change_7d, r.age_days, r.launch_signal,
      r.implied_value_usd, r.implied_low_usd, r.implied_high_usd, r.multiple, r.tier, r.verdict,
      r.capital_usd, r.gas_usd, r.hold_days, r.cost_usd, r.burden, r.odds, r.airdrop_usd, r.net_usd,
      r.per_hour_usd, r.break_even_implied, r.work_hours, r.in_watchlist, r.farm_steps, r.model,
    ]),
    liveCols,
    live: live.map((p) => [
      p.slug,
      p.name,
      p.category ?? 'unclassified',
      p.chains,
      p.tvl_usd,
      p.mcap_usd,
      p.change_7d,
      p.tvl_usd ? Math.round(((p.mcap_usd ?? 0) / p.tvl_usd) * 1000) / 1000 : 0,
    ]),
    early_size: board.filter((r) => !r.in_watchlist).length,
    live_size: peers.length,
    comparables: {
      overall: median(peers.map((r) => (r.p.mcap_usd ?? 0) / (r.p.tvl_usd ?? 1))),
      trading: peers.length,
    },
  };
  return { board, radar };
}

/** The gate's own checks on the board, run before it is written: a refused board is not shipped. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const byslug = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = new Set<number>();
  for (const r of board) {
    if (!byslug.has(r.slug)) return `row ${r.rank} names ${r.slug}, not a protocol in the snapshot`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (!Number.isInteger(r.rank) || r.rank <= 0) return `${r.slug} has rank ${r.rank}`;
    if (ranks.has(r.rank)) return `rank ${r.rank} is used twice`;
    ranks.add(r.rank);
    if (!r.name.trim()) return `${r.slug} has no name`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has an implied value of ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} is priced past the gate's ceiling`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${board[i]!.rank} is worth more than the row above it`;
  }
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `the board misses ${slug}, which the watchlist names`;
  return null;
}

/** The page's data: column names once, then one array per row. */
export function dataScript(radar: Radar): string {
  const payload = JSON.stringify({ head: radar.head, cols: radar.cols, rows: radar.rows, liveCols: radar.liveCols, live: radar.live });
  return `// generated by main.ts from the sealed snapshot: one array per column, rows in board order\nwindow.RADAR = ${payload};\n`;
}
