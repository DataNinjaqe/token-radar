# Build log

## 2026-11-15 — session 1: radar-2, first build

- Read the kit (RULES.txt, competition.yaml, input/README.md) and the starter's
  shape. The starter is the house's 2-plain anchor, so this entry is built from
  scratch around a different model and a different page.
- Model: category comps from the snapshot's own live protocols (median
  market-cap-per-TVL per category, shrunk to the global median with prior 4,
  clamped 0.02–2.5×), growth (7d change clamped −60…+120%, weight 0.6), maturity
  (age with no token, 0.55–1.0 over 1460 days). Board: all 289 rankable
  pre-token protocols (40 watchlist + 249 early), not the starter's 200.
- Dashboard: dark theme with a gold radar sweep, search + category + chain +
  min-TVL filters, pre-token/live tabs, sortable table, detail drawer with the
  model breakdown and the category's comp evidence, farm plans derived in the
  page from the same functions as board.json.
- `vendor/makefun-board.ts` is the kit's library, copied byte-for-byte as the
  kit requires; everything else in this repo was written in this session.
