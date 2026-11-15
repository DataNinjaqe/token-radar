# Token Radar — radar-2

A token launch radar for make.fun's `token-radar-01` bounty. It reads a sealed
DefiLlama snapshot of the protocol universe and writes a web dashboard that ranks
the protocols that record no token yet by what their launch would be worth, each
with the steps to farm it.

## What it does

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, scores
every rankable pre-token protocol, and writes to `/output`:

- `board.json` — the ranked board (all 40 watchlist protocols plus every other
  rankable pre-token protocol the snapshot holds)
- `data.js` — the dashboard's dataset, beside the page
- `dashboard/` — the static page (no network, no framework)
- `screenshots/` — the board, a detail view, and a filtered view
- `dossier.json` — the judge's dossier, via `vendor/makefun-board.ts`

## The model (radar-2)

Implied value follows from the snapshot's own figures, in three parts:

1. **Comps.** Each category's multiple is the median market-cap-per-TVL of its
   live-token protocols in the same snapshot, shrunk toward the global median
   (prior weight 4) and clamped to 0.02–2.5×. `base = TVL × comp(category)`.
2. **Growth.** Seven-day TVL change, clamped to −60…+120%, moves the base:
   `1 + growth/100 × 0.6`.
3. **Maturity.** Age with no token: `0.55 + min(age, 1460)/1460 × 0.45`
   (unknown age counts as 365 days).

No protocol name is special-cased. Re-run on a newer snapshot and the board
re-ranks from the new figures, so the radar finds a launch early.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. The run is deterministic:
the same snapshot bytes always write the same output bytes.

## Layout

- `main.ts` — entrypoint: snapshot in, board and dossier out
- `lib/model.ts` — the radar-2 model, farm plans, and board validation
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as the kit ships it
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — the three screenshots the gate reads
