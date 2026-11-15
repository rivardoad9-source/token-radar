# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rivardoad9-source/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rivardoad9-source/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token yet. It prices each one off the protocols in the
same snapshot that already trade, prints the band that price has earned, and gives every protocol a
farm plan costed in dollars, hours and odds.

## What it does

`main.ts` reads the sealed snapshot at `/input/snapshot.json`, scores every pre-token protocol with
the model in `lib/model.ts`, and writes:

• `board.json` — the ranked board, one row per protocol, each with its implied value, its band and
  its farm steps
• `data.js` — the same rows, as the dashboard's data
• `dashboard/` and `screenshots/` — copied beside the data
• `dossier.json` — built with the vendored `buildDossier`, the file a judge reads

## The value model: one line, then the tests that chose it

The snapshot holds protocols that already trade, with a market cap, a TVL, an age and a seven-day TVL
change. Two stages are fitted to them by least squares on logs:

```
log10(implied FDV) = 4.449 + 0.340 · log10(TVL)              n = 68, R² 0.072
  × 10^(0.35 · (−0.491 · (log10 age − 2.951) − 0.059 · 7d growth))
```

Ten times the TVL raises the implied value 2.2×, not 10×: the market pays less per TVL dollar as a
protocol grows. Age and growth enter as tilts on what the size curve missed, applied at 35% of their
fitted weight — and that version is the one the blind test chose:

• size curve + age & growth tilt (shipped) — **72% median blind miss**
• size curve alone — 76%
• + age, growth at full weight — 76%
• + age, chains, growth at full weight — 78%
• + squared TVL — 77%
• flat, everything at the peer median — 85%

Blind error is measured by refitting without the protocol being priced, and by 200 random 70/30
splits with a fixed seed (77% against 85%). The one test the model fails is the calendar-ordered
split, 93% against 90%; it is printed on the page rather than dropped.

One guard sits between the curve and the board: **the multiple floor and ceiling**. A shallow line
would value a $5M protocol at $400M, so every row is held inside the multiples the trading protocols
actually carry (0.03× to 2.2× TVL, median 0.28×), and the detail drawer shows the raw curve value
beside the clamped one, labelled as clamped. Under every implied value sits the **band**: the 10th
and 90th percentile blind miss, covering 72% of the errors the model made on protocols it had not
seen.

## When, not just how much

A unique column: **the odds a token exists at all**, counted from the snapshot itself. Every
token-able protocol falls into an age bucket, and each bucket reports the share that already holds a
token (`(with token + 0.5) / (all + 1)`). That odds figure then weights every net number on the
board, so a farm on a young protocol is credited with less than the same farm on an older one. It is
cross-sectional, from one day of data, and the page says so.

## The plan, priced

Every protocol carries a five-step plan computed from its own TVL, chain and age:

```
airdrop = 0.001% of implied × odds at that age
cost    = gas (per-chain table) + 4%/yr yield given up over the hold
net     = airdrop − cost          · per hour = net / 3 hours of work
break-even implied launch = cost / (0.001% × odds)
```

The verdict comes from the net, not from the cost: `farm now` (net positive, signal 55+), `watch`
(net positive, signal quiet), `thin` (net negative), `pass` (gas above 10% of the capital the
position needs). The board carries the net, the hourly rate and the break-even value in its own
columns, so the ranking can be read against what it would pay.

## The dashboard

A single static page, no network, no framework, no images:

• a board sorted by implied value, with search, category, chain, sort, plan and watchlist /
  below-floor filters, plus token odds and net-per-hour columns
• a monogram per protocol — initials on a colour derived from its own slug, drawn on the page, since
  the snapshot carries no brand asset and the page may fetch nothing
• the model's equation above the board, and a panel below it with the blind tests, the guard, the
  band and a bar chart of the age-to-token curve
• a detail drawer per protocol: the raw curve value, the clamp, the band, the odds, the airdrop, the
  cost, the net, the break-even, and the five steps
• a second tab for the protocols that already trade, ranked by the market's own market cap and
  never mixed into the launch ranking

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
node tools/verify.ts out    # dossier matches buildDossier, plus every gate limit
```

Node 22.18 or later runs the TypeScript directly; nothing is installed. The screenshots in
`screenshots/` are rendered from the built page with `tools/shoot.mjs` (Playwright, development
only — the entry itself never needs it).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash prizes</sub>
