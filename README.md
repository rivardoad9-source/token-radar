# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rivardoad9-source/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rivardoad9-source/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token yet. It prices each one off the protocols in the
same snapshot that already trade, prints the band that price has earned, and gives every protocol a
farm plan costed in dollars and days.

## What it does

`main.ts` reads the sealed snapshot at `/input/snapshot.json`, scores every pre-token protocol with
the model in `lib/model.ts`, and writes:

• `board.json` — the ranked board, one row per protocol, each with its implied value, its band and
  its farm steps
• `data.js` — the same rows, as the dashboard's data
• `dashboard/` and `screenshots/` — copied beside the data
• `dossier.json` — built with the vendored `buildDossier`, the file a judge reads

## The value model: fitted, then checked

The snapshot contains 71 protocols that already trade, with a market cap, a TVL, an age and a chain
count. The model is fitted to them by least squares on logs, and then the fit is measured by
refitting without each protocol in turn:

```
log10(market cap) = 6.436 + 0.231·log10(TVL) − 0.367·log10(age) − 0.276·log10(chains) + 0.109·growth
R² 0.108 · leave-one-out median miss 84% · n = 71
```

Then, per protocol:

```
implied = 10^(intercept + 0.231·log10(TVL)) × category offset × growth tilt × age tilt × chain tilt
```

• **category offset** — the category's median residual in log, shrunk by its peer count
  (`median × n/(n+4)`, capped at ±0.45) so a category with two peers cannot move a row as far as
  one with twenty
• **tilts** — the fitted coefficients applied at half strength: one snapshot is one draw, and a
  model that applies its own coefficients at full weight is fitting its training set
• **band** — the 25th and 75th percentile of the residuals, printed under every implied value

The point of fitting rather than choosing is that the coefficients came out against intuition and
the page says so: in this snapshot the market pays *less* per TVL dollar for the protocols that
have run longest and for the ones spread over more chains. Both are in the model, both are in the
panel that explains the model.

A separate 0–100 launch signal ranks *urgency*, not size: growth, a young-but-not-old age band,
chain breadth and the category's own heat, each ranked against the field before it is weighted.
It never feeds implied value.

## The plan, priced

Every protocol carries a five-step plan whose capital, gas, hold time and cost are computed from
its own TVL, its own chain and its own age. Gas is a per-chain table, so the plan says what a
reader needs to know: an $250 position on Ethereum costs more in gas than it can plausibly return,
and the board marks it `pass`; the same protocol on Base is a `farm now`. Cost as a share of the
position decides the verdict, and the board shows that share in the plan column.

## The dashboard

A single static page, no network, no framework, no images:

• a board sorted by implied value, with search, category, chain, sort, plan and watchlist /
  below-floor filters
• the model's own equation above the board, and a panel below it explaining each coefficient, the
  band, and what the model cannot do
• a detail drawer per protocol: the base number, each multiplier applied to it, the band, the
  category's own multiple for scale, the costed plan, and the five steps
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

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
