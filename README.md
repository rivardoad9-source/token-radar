# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rivardoad9-source/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rivardoad9-source/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A launch radar for protocols that record no token yet: it ranks them by the value a token would
carry if the protocol's own record stayed as it is, and prints, per protocol, the steps that
would farm it before or after a launch.

## What it does

`main.ts` reads the sealed snapshot at `/input/snapshot.json`, scores every pre-token protocol
with the model in `lib/model.ts`, and writes:

• `board.json` — the ranked board, one row per protocol, each with its implied value and its
  farm steps
• `data.js` — the same rows, as the dashboard's data
• `dashboard/` and `screenshots/` — copied beside the data
• `dossier.json` — built with the vendored `buildDossier`, the file a judge reads

## The value model

Implied value is derived from the snapshot's own fields, never from a list of names:

```
implied = TVL × comparable FDV/TVL × growth × maturity × chain spread
```

• **comparable FDV/TVL** — the median market cap over TVL of the protocols in the snapshot that
  already trade, taken inside the same category, clamped to 0.05–3, and borrowed from the whole
  snapshot when a category has fewer than four trading peers
• **growth** — seven-day TVL change, clamped to −50%…+100%, worth 35% of itself
• **maturity** — 0.70 + min(age, 1095 days) / 1095 × 0.30, so a protocol that has run longer is
  treated as proven
• **chain spread** — 1 + 0.03 per chain beyond the first, up to five

A separate 0–100 launch signal ranks *urgency*, not size: growth, a young-but-not-old age band,
chain breadth and category. It never feeds implied value.

Protocols whose record shows a token already trades stay off the launch board entirely and are
listed in their own tab with the market's own market cap, so the two kinds of protocol are never
ranked against each other.

## The dashboard

A single static page, no network, no framework:

• a board sorted by implied value, with search, category, chain, sort and watchlist / below-floor
  filters
• a detail drawer per protocol: TVL, seven-day change, age, and the four multipliers that make
  its implied value, factor by factor
• a five-step farm plan per protocol, generated from the protocol's own TVL, age and category,
  each step with its cost and its time
• a second tab for the protocols that already trade

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18 or later runs the TypeScript directly; nothing is installed. The three screenshots in
`screenshots/` are rendered from the built page with `tools/shoot.mjs` (Playwright, development
only — the entry itself never needs it).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
