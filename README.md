# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DataNinjaqe/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DataNinjaqe/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's `token-radar-01` bounty. It reads a sealed
DefiLlama snapshot of the protocol universe and writes a web dashboard that ranks
the protocols that record no token yet by what their launch would be worth, each
with the steps to farm it.

## What it does

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, scores
every rankable pre-token protocol, and writes to `/output`:

- `board.json` — the ranked board (all 40 watchlist protocols plus every other
  rankable pre-token protocol the snapshot holds: 198 rows)
- `data.js` — the dashboard's dataset, beside the page
- `dashboard/` — the static page (no network, no framework)
- `screenshots/` — the board, a detail view, and a filtered view
- `dossier.json` — the judge's dossier, via `vendor/makefun-board.ts`

## The model (radar-4)

Implied value follows from the snapshot's own figures. The base is the
geometric mean of two fitted terms, both fitted at run time from the
snapshot's 119 live-token protocols (market cap above zero, TVL above zero,
not a CEX) — nothing about the fit is hardcoded:

1. **Category comps.** Each category's multiple is the median
   market-cap-per-TVL of its live-token protocols, shrunk toward the global
   median (prior weight 4) and clamped to 0.02–2.5×. `baseM1 = TVL × comp(category)`.
2. **Log-log regression.** `log10(market cap) = 3.3823 + 0.4721 × log10(TVL)`,
   plus a per-category offset (mean residual, shrunk toward 0 with prior
   weight 4). `baseM2 = 10 ^ (intercept + slope × log10(TVL) + offset)`.
3. **Blend.** `base = √(baseM1 × baseM2)`.
4. **Growth.** Seven-day TVL change, clamped to −60…+120%, moves the base:
   `1 + growth/100 × 0.6`.
5. **Maturity.** Age with no token: `0.55 + min(age, 1460)/1460 × 0.45`
   (unknown age counts as 365 days).
6. **Chain breadth.** Each chain past the first adds 0.02, up to nine extra
   chains, so a single-chain protocol scores 1.00× and one on ten chains or
   more scores 1.18×.
7. **Token odds.** The share of the category's protocols that record a token
   at all, shrunk toward the global rate of 0.549 with prior weight 8:
   `0.75 + 0.5 × odds`, moving a row by at most about a quarter either way.

### Validation (measured from this snapshot on every run)

The blend was tested on three held-out splits before it was trusted, and it
beats or ties each term alone on all three:

| Split | Train | Test | Median log error | Median miss |
|---|---|---|---|---|
| Random 1-in-5 by slug | 96 | 23 | 0.3897 | ×2.45 |
| Random 1-in-5, offset 2 | 95 | 24 | 0.7299 | ×5.37 |
| Walk-forward by listing date | 43 | 44 | 0.5380 | ×3.45 |

Blend R² in log space is 0.2771 (comps alone 0.1662). The errors are large,
so implied values are order-of-magnitude estimates — the dashboard says so
next to the numbers instead of hiding it.

### Farm plans

Every plan names the deposit size its TVL tier calls for ($50–$250), the gas
per transaction on its first chain, the hold in days, the weekly actions, and
the total planned spend (deposit + gas over the hold). The verdict follows a
stated rule: Farm now when implied value is at least $50M and token odds at
least 0.35 (5 rows); Watch when implied value is at least $10M or odds at
least 0.60 (85 rows); Low priority otherwise (108 rows).

### All 758 protocols, accounted for

The dashboard accounts for every protocol in the snapshot in exactly one
bucket: 198 ranked, 144 excluded pre-token (wrapped / staked / bridged
products of tokens that already trade, named by reason), 144 live-token, and
272 that record a token but carry no market cap.

No protocol name is special-cased. Re-run on a newer snapshot and the board
re-fits and re-ranks from the new figures, so the radar finds a launch early.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. The run is deterministic:
the same snapshot bytes always write the same output bytes.

## Layout

- `main.ts` — entrypoint: snapshot in, board and dossier out
- `lib/model.ts` — the radar-4 model, farm plans, and board validation
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as the kit ships it
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the three screenshots the gate reads

---

<sub>Entered on [make.fun](https://make.fun/?ref=zczcxv34&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
