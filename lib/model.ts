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
  tvl: number;
  age: number;
  chains: number;
  growth: number;
  n: number;
  r2: number;
  /** Median absolute percentage error of a leave-one-out refit, as a fraction. */
  mdape: number;
  /** Residual quantiles in log10, the band a row carries. */
  low: number;
  high: number;
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
  model: {
    base_usd: number;
    category_offset: number;
    growth_tilt: number;
    age_tilt: number;
    chain_tilt: number;
  };
  farm_steps: string[];
};

/**
 * Categories whose token, when it exists, is a claim on something other than the protocol's own
 * franchise: a bridge's token is not paid for by bridge TVL, and a liquid-staking token is a
 * receipt for someone else's asset. DefiLlama's own watchlist rule sets them aside, and so does
 * this: including them in the comparable set would price a lending market off a wrapped Bitcoin.
 */
const NOT_COMPARABLE = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** The model's clock: one snapshot, so age is measured against the day it was taken. */
const DAY = 86_400_000;

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

const design = (f: Features): number[] => [1, f.ltvl, f.lage, f.lch, f.growth];

/**
 * Fits the model on every protocol whose record carries both a token and a TVL, then measures
 * itself: leave-one-out refits give the error the board has to admit to.
 */
function fitModel(peers: { f: Features; y: number }[]): Fit {
  const weights =
    ols(
      peers.map((r) => ({ x: design(r.f), y: r.y })),
      5,
    ) ?? [6.4, 0.24, -0.35, -0.26, 0.1];
  const pred = (w: number[], f: Features): number => w[0]! + w[1]! * f.ltvl + w[2]! * f.lage + w[3]! * f.lch + w[4]! * f.growth;

  const mean = peers.reduce((s, r) => s + r.y, 0) / peers.length;
  const ssRes = peers.reduce((s, r) => s + (r.y - pred(weights, r.f)) ** 2, 0);
  const ssTot = peers.reduce((s, r) => s + (r.y - mean) ** 2, 0);
  const residuals = peers.map((r) => r.y - pred(weights, r.f));

  // Leave one out: refit without the row, predict it, keep the miss. The only honest error a
  // single snapshot can give, and 71 refits of a 5x5 system cost nothing.
  const misses: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const others = peers.filter((_, j) => j !== i);
    const w = ols(
      others.map((r) => ({ x: design(r.f), y: r.y })),
      5,
    );
    if (w === null) continue;
    misses.push(Math.abs(10 ** (peers[i]!.y - pred(w, peers[i]!.f)) - 1));
  }

  return {
    intercept: weights[0]!,
    tvl: weights[1]!,
    age: weights[2]!,
    chains: weights[3]!,
    growth: weights[4]!,
    n: peers.length,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    mdape: misses.length > 0 ? median(misses) : 0.8,
    low: quantile(residuals, 0.25),
    high: quantile(residuals, 0.75),
  };
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
  offset: number;
  base: number;
  tilts: { growth: number; age: number; chain: number };
  signal: number;
};

/** Builds the board the gate reads and the data the page draws, from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: Radar } {
  const watch = new Set(snapshot.watchlist);

  // The comparable set: a token, a market cap, a TVL, and a category where the token is the
  // protocol's own claim. This is what the fit learns from, and the page shows it separately.
  const peers = snapshot.protocols
    .filter((p) => recordsToken(p) && (p.mcap_usd ?? 0) > 0 && (p.tvl_usd ?? 0) > 0 && !NOT_COMPARABLE.has(p.category ?? ''))
    .map((p) => ({ p, age: ageDays(p, snapshot.as_of) }))
    .filter((r) => r.age !== null);

  const fit = fitModel(
    peers.map((r) => ({ f: featuresOf(r.p.tvl_usd ?? 1, r.age, r.p.chains.length, r.p.change_7d), y: Math.log10(r.p.mcap_usd ?? 1) })),
  );

  // Category offsets: the median residual of a category, shrunk by its peer count so a category
  // with two peers cannot move a row as far as one with twenty.
  const byCat = new Map<string, number[]>();
  for (const r of peers) {
    const f = featuresOf(r.p.tvl_usd ?? 1, r.age, r.p.chains.length, r.p.change_7d);
    const res =
      Math.log10(r.p.mcap_usd ?? 1) - (fit.intercept + fit.tvl * f.ltvl + fit.age * f.lage + fit.chains * f.lch + fit.growth * f.growth);
    const key = r.p.category ?? 'unclassified';
    byCat.set(key, [...(byCat.get(key) ?? []), res]);
  }
  const offsetOf = (cat: string): number => {
    const residuals = byCat.get(cat);
    if (residuals === undefined || residuals.length === 0) return 0;
    return clamp(median(residuals) * (residuals.length / (residuals.length + 4)), -0.45, 0.45);
  };

  // The universe the board ranks: a record with no token, in a category where a token would be
  // the protocol's own. The watchlist is a subset of it, which the gate checks.
  const universe = snapshot.protocols.filter((p) => !recordsToken(p) && !NOT_COMPARABLE.has(p.category ?? ''));
  const excluded = snapshot.protocols.length - universe.length;

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
    const offset = offsetOf(p.category ?? 'unclassified');
    // Half strength on every tilt: the fit is real, but one snapshot is one draw, and a model
    // that applies its coefficients at full weight overfits the protocols it learned from.
    const growthTilt = 10 ** (0.5 * fit.growth * f.growth);
    const ageTilt = 10 ** (0.5 * fit.age * (f.lage - Math.log10(859)));
    const chainTilt = 10 ** (0.5 * fit.chains * (f.lch - Math.log10(2)));
    const base = 10 ** (fit.intercept + fit.tvl * f.ltvl);
    const implied = Math.max(1, Math.round(base * 10 ** offset * growthTilt * ageTilt * chainTilt));
    return {
      p,
      age,
      implied,
      low: Math.max(1, Math.round(implied * 10 ** (fit.low * 0.6))),
      high: Math.max(1, Math.round(implied * 10 ** (fit.high * 0.6))),
      offset,
      base,
      tilts: { growth: growthTilt, age: ageTilt, chain: chainTilt },
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
    // The verdict is about whether to spend, not about what the protocol is worth: gas that eats
    // the position closes the plan whatever the implied value says.
    const verdict = burden > 0.1 ? 'pass' : burden > 0.05 && r.signal < 60 ? 'thin' : r.signal >= 55 ? 'farm' : 'watch';
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
      model: {
        base_usd: Math.round(r.base),
        category_offset: Math.round(r.offset * 1000) / 1000,
        growth_tilt: Math.round(r.tilts.growth * 1000) / 1000,
        age_tilt: Math.round(r.tilts.age * 1000) / 1000,
        chain_tilt: Math.round(r.tilts.chain * 1000) / 1000,
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
    'multiple', 'tier', 'verdict', 'capital', 'gas', 'hold', 'cost', 'burden', 'wl', 'steps', 'model',
  ];
  const liveCols = ['slug', 'name', 'category', 'chains', 'tvl', 'mcap', 'ch7', 'multiple'];

  const radar: Radar = {
    head: {
      as_of: snapshot.as_of,
      source: provenance(snapshot.source),
      floor_usd: snapshot.floor_usd,
      model_version: 'radar-4',
      universe_size: universe.length,
      board_size: board.length,
      watchlist_size: snapshot.watchlist.length,
      watchlist_covered: board.filter((r) => r.in_watchlist).length,
      peers: fit.n,
      live_size: peers.length,
      excluded,
      fit,
      totals,
    },
    cols,
    rows: board.map((r) => [
      r.rank, r.slug, r.name, r.category, r.chains, r.tvl_usd, r.change_7d, r.age_days, r.launch_signal,
      r.implied_value_usd, r.implied_low_usd, r.implied_high_usd, r.multiple, r.tier, r.verdict,
      r.capital_usd, r.gas_usd, r.hold_days, r.cost_usd, r.burden, r.in_watchlist, r.farm_steps, r.model,
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
