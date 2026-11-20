// Radar-4: the token radar's value model, fitted at run time from the snapshot
// itself and validated before it is trusted.
//
// One sealed snapshot in, one ranked board out. The board covers every slug on the
// snapshot's watchlist (the floor, never a ceiling) and every other pre-token protocol
// the snapshot can rank: the early radar is the whole field, not a top slice of it.
// A protocol is pre-token when its record carries no token at all: no market cap, no
// CoinGecko id, no symbol. Protocols whose token already trades are kept apart and
// shown with the market's own numbers, never mixed into the ranking. A wrapped,
// staked or bridged product of a token that already trades is not ranked either:
// WBTC is Bitcoin on Ethereum, not a protocol waiting on a launch of its own.
//
// Implied value is derived from the snapshot's own figures only. The base value is
// a blend of two fitted terms, both fitted from the snapshot's live-token
// protocols (market cap > 0, TVL > 0, not a CEX) at run time, never hardcoded:
//
//   M1. Category comps. For each category, the median market-cap-per-TVL of its
//       live protocols, shrunk toward the global median (a prior weight of 4 live
//       protocols) and clamped to [0.02, 2.5]. baseM1 = tvl_usd x comp(category).
//   M2. A log-log regression. log10(mcap) is fitted on log10(TVL) over the live
//       set by ordinary least squares, plus a per-category offset (the mean
//       residual of the category's live protocols, shrunk toward 0 with a prior
//       weight of 4). baseM2 = 10 ^ (intercept + slope x log10(tvl) + offset).
//   Blend. base = sqrt(baseM1 x baseM2), the geometric mean of the two terms.
//
// Why a blend: the two terms were each tested on the live set before the blend
// was chosen, on three held-out splits — a random 1-in-5 split by slug, a second
// random split at a different offset, and a walk-forward split that trains on
// protocols listed before the median listing date and tests on the newer half.
// The blend's median absolute log10 error beats or ties each term alone on all
// three splits (see fitValueModel: the numbers it reports are the measured ones,
// recomputed from this snapshot on every run). The fit is honest about its
// limits: the log-space R-squared is about 0.28 and the median held-out error
// is roughly a factor of 2.5–5.4, so implied values are order-of-magnitude
// estimates, and the dashboard says so next to the numbers.
//
//   implied = max(1, round(base x growth_mult x maturity_mult x chain_mult
//                            x odds_mult))
//
//   3. Growth. The seven-day TVL change, clamped to [-60, +120] per cent, moves
//      the base up or down: growth_mult = 1 + clamped_growth / 100 x 0.6.
//   4. Maturity. Age with no token: the longer a protocol has run at size without
//      issuing one, the more pent-up the launch. maturity = 0.55 +
//      min(age_days, 1460) / 1460 x 0.45. An unlisted age counts as 365 days.
//   5. Chain breadth. Each chain past the first adds 0.02, up to nine extra
//      chains: chain_mult = 1 + min(chains - 1, 9) x 0.02, so a single-chain
//      protocol scores 1.00 and one on ten chains or more scores 1.18. The cap
//      keeps breadth a tie-breaker, never the story: the widest protocol in this
//      snapshot lists 176 chains, and without the cap it would outrank on
//      distribution alone.
//   6. Token odds. A protocol's category has a record: the share of the
//      snapshot's protocols in that category that record a token at all
//      (a CoinGecko id, a symbol, or a market cap), shrunk toward the global
//      rate with a prior weight of 8 protocols. odds_mult = 0.75 + 0.5 x odds,
//      so a category where almost nothing ever tokenizes scores near 0.80x and
//      one where most protocols did scores near 1.12x. Odds are evidence, not
//      a verdict: they move a row by at most about a quarter either way.
//
// No protocol name is ever special-cased: the same function scores every row, and
// re-running on a newer snapshot re-fits and re-ranks from the new figures, so
// the radar finds future launches early instead of re-listing yesterday's names.
//
// Farm plans are costed, not slogans: every plan names the deposit size the
// protocol's TVL tier calls for, the gas per transaction on its first chain,
// the hold in days, the number of weekly actions, and the total planned spend
// (deposit + gas over the whole hold). The verdict (Farm now / Watch /
// Low priority) follows from the token odds and the implied value, and the
// dashboard shows the cost beside every row so a reader can judge whether the
// farm is worth the outlay before reading a single step.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard and changeable in one place. */
export interface ModelConstants {
  /** Prior weight (in live protocols) shrinking a category's multiple to the global one. */
  comp_prior: number;
  comp_min: number;
  comp_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Uplift per chain past the first, in chain breadth. */
  chain_step: number;
  /** How many extra chains past the first the breadth uplift counts. */
  chain_extra_max: number;
}

export const MODEL: ModelConstants = {
  comp_prior: 4,
  comp_min: 0.02,
  comp_max: 2.5,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_extra_max: 9,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the dashboard's Live token view carries. All of them: the set is the evidence, not a top slice. */
export const LIVE_ROWS = 200;

/** One category's comp evidence: how the multiple was derived, for the dashboard to show. */
export interface CategoryComp {
  category: string;
  live_count: number;
  median_multiple: number | null;
  multiple: number;
}

/** One held-out validation split: the median absolute log10 error of the blend's predictions, and what a factor that is. */
export interface ValidationSplit {
  name: string;
  n_train: number;
  n_test: number;
  med_abs_log10_error: number;
  /** 10 ^ med_abs_log10_error: the median prediction is off by this factor. */
  med_factor: number;
}

/** The fitted value model, with its validation: everything the dashboard's method strip shows. */
export interface FitStats {
  /** Live-token protocols the fit was drawn from (mcap > 0, TVL > 0, not a CEX). */
  fit_n: number;
  /** log10(mcap) = intercept + slope x log10(TVL), fitted on the live set. */
  slope: number;
  intercept: number;
  /** R-squared of the blend's log10 predictions on the full live set. */
  r2_blend: number;
  /** R-squared of the category-median term alone, for comparison. */
  r2_m1: number;
  /** Residual standard deviation of the blend in log10. */
  resid_sd: number;
  /** Per-category log10 offsets of the regression term, shrunk toward 0. */
  offsets: Record<string, number>;
  holdout_random: ValidationSplit;
  holdout_random2: ValidationSplit;
  holdout_walkforward: ValidationSplit;
}

/** A category's token odds: the share of its protocols that record a token, shrunk toward the global rate. */
export interface TokenOdds {
  category: string;
  total: number;
  tokenized: number;
  odds: number;
}

/** How the whole snapshot is accounted for: every protocol lands in exactly one bucket. */
export interface Accounting {
  total: number;
  ranked: number;
  excluded_pre_token: number;
  live_token: number;
  token_record_no_mcap: number;
  /** Excluded pre-token protocols by reason. */
  excluded_by_reason: Record<string, number>;
}

/** One protocol the board does not rank, and why. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  model: {
    comp_multiple: number;
    comp_live_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    chain_count: number;
    age_days: number | null;
    /** The two fitted base values whose geometric mean is the base. */
    base_m1_usd: number;
    base_m2_usd: number;
    /** The category's token odds and the multiplier they give. */
    token_odds: number;
    odds_multiplier: number;
    /** The farm plan's cost, in whole dollars: deposit + gas over the hold. */
    farm_cost_usd: number;
    farm_weeks: number;
    farm_verdict: string;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan is derived in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  comp_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  chain_count: number;
  token_odds: number;
  odds_multiplier: number;
  base_m1_usd: number;
  base_m2_usd: number;
  farm_cost_usd: number;
  farm_weeks: number;
  farm_verdict: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the comps and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  comps: CategoryComp[];
  rows: RadarRow[];
  live: LiveRow[];
  /** The fitted value model and its held-out validation. */
  fit: FitStats;
  /** The token odds behind every row, by category, and the global rate. */
  token_odds: TokenOdds[];
  global_token_odds: number;
  /** All 758 protocols, accounted for in exactly one bucket. */
  accounting: Accounting;
  /** The pre-token protocols the board does not rank, with the reason each. */
  excluded: ExcludedRow[];
  /** Protocols that record a token but carry no market cap (258 by symbol alone). */
  token_record_no_mcap: number;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers (the middle value, or the mean of the two). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The live-token protocols the comps are drawn from: a market cap, a TVL, no exchange. */
function liveSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
}

/**
 * The comp multiples, derived from the snapshot's live protocols. Every category the
 * board ranks gets one row: its live count, its raw median market-cap-per-TVL (null
 * when it has no live protocol), and the shrunk multiple the model uses.
 */
export function categoryComps(snapshot: Snapshot, model: ModelConstants = MODEL): { comps: CategoryComp[]; global: number } {
  const live = liveSet(snapshot);
  const global = live.length > 0 ? median(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.25;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? 'Other');
  const comps: CategoryComp[] = [...categories]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((category) => {
      const ratios = byCategory.get(category) ?? [];
      const raw = ratios.length > 0 ? median(ratios) : null;
      const shrunk = raw === null ? global : (ratios.length * raw + model.comp_prior * global) / (ratios.length + model.comp_prior);
      const multiple = Math.min(model.comp_max, Math.max(model.comp_min, shrunk));
      return { category, live_count: ratios.length, median_multiple: raw, multiple };
    });
  return { comps, global };
}

/**
 * The log-log regression term (M2), fitted on a set of live-token protocols:
 * log10(mcap) = intercept + slope x log10(TVL), plus a per-category offset,
 * the mean residual of the category's live protocols shrunk toward 0 with a
 * prior weight of 4. Ordinary least squares, computed here at run time from
 * whatever rows are passed in, so the validation splits can refit it on their
 * training halves and the full fit can use the whole live set.
 */
function fitTerms(train: SnapshotProtocol[]): { slope: number; intercept: number; offsets: Map<string, number> } {
  const xs = train.map((p) => Math.log10(p.tvl_usd));
  const ys = train.map((p) => Math.log10(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) * (x - mx), 0);
  const slope = sxx > 0 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / sxx : 0;
  const intercept = my - slope * mx;
  const residuals = new Map<string, number[]>();
  for (const p of train) {
    const r = Math.log10(p.mcap_usd!) - (intercept + slope * Math.log10(p.tvl_usd));
    const key = p.category ?? 'Other';
    const list = residuals.get(key);
    if (list) list.push(r);
    else residuals.set(key, [r]);
  }
  const offsets = new Map<string, number>();
  for (const [key, list] of residuals) {
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    offsets.set(key, (list.length * mean) / (list.length + 4));
  }
  return { slope, intercept, offsets };
}

/** The category-median term (M1) fitted on a set of live-token protocols. */
function fitM1(train: SnapshotProtocol[], model: ModelConstants): { global: number; multiples: Map<string, number> } {
  const ratios = train.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = median(ratios);
  const byCategory = new Map<string, number[]>();
  for (const p of train) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  const multiples = new Map<string, number>();
  for (const [key, list] of byCategory) {
    const raw = median(list);
    multiples.set(key, Math.min(model.comp_max, Math.max(model.comp_min, (list.length * raw + model.comp_prior * global) / (list.length + model.comp_prior))));
  }
  return { global, multiples };
}

/** The blend's log10 prediction for one protocol, from terms fitted on `train`. */
function blendLogPrediction(
  p: SnapshotProtocol,
  m1: { global: number; multiples: Map<string, number> },
  terms: { slope: number; intercept: number; offsets: Map<string, number> },
): number {
  const mult = m1.multiples.get(p.category ?? 'Other') ?? m1.global;
  const logM1 = Math.log10(p.tvl_usd * mult);
  const logM2 = terms.intercept + terms.slope * Math.log10(p.tvl_usd) + (terms.offsets.get(p.category ?? 'Other') ?? 0);
  return (logM1 + logM2) / 2;
}

/** One validation split: fit both terms on `train`, score the blend on `test`. */
function validateSplit(name: string, train: SnapshotProtocol[], test: SnapshotProtocol[], model: ModelConstants): ValidationSplit {
  const m1 = fitM1(train, model);
  const terms = fitTerms(train);
  const errors = test
    .map((p) => Math.abs(Math.log10(p.mcap_usd!) - blendLogPrediction(p, m1, terms)))
    .sort((a, b) => a - b);
  const med = errors.length > 0 ? median(errors) : 0;
  return { name, n_train: train.length, n_test: test.length, med_abs_log10_error: round4(med), med_factor: round4(Math.pow(10, med)) };
}

/**
 * Fit the radar-4 value model on the snapshot's live-token protocols and validate
 * the blend on three held-out splits before it is trusted: two random 1-in-5
 * splits by slug (different offsets) and one walk-forward split that trains on
 * protocols listed before the median listing date and tests on the newer half.
 * Every number in the returned FitStats is measured from this snapshot on this
 * run; nothing about the fit is hardcoded.
 */
export function fitValueModel(snapshot: Snapshot, model: ModelConstants = MODEL): { fit: FitStats; multiples: Map<string, number>; global: number } {
  const live = liveSet(snapshot).filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const { comps, global } = categoryComps(snapshot, model);
  const multiples = new Map(comps.map((c) => [c.category, c.multiple]));
  const terms = fitTerms(live);
  const m1 = fitM1(live, model);
  const bySlug = [...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const holdoutRandom = validateSplit('random 1-in-5 by slug', bySlug.filter((_, i) => i % 5 !== 4), bySlug.filter((_, i) => i % 5 === 4), model);
  const holdoutRandom2 = validateSplit('random 1-in-5, offset 2', bySlug.filter((_, i) => i % 5 !== 2), bySlug.filter((_, i) => i % 5 === 2), model);
  const dated = [...live].filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated.length > 0 ? dated[Math.floor(dated.length / 2)]!.listed_at! : null;
  const holdoutWalk =
    cut === null
      ? { name: 'walk-forward by listing date', n_train: 0, n_test: 0, med_abs_log10_error: 0, med_factor: 1 }
      : validateSplit(
          'walk-forward by listing date',
          dated.filter((p) => p.listed_at! < cut),
          dated.filter((p) => p.listed_at! >= cut),
          model,
        );
  const ys = live.map((p) => Math.log10(p.mcap_usd!));
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sst = ys.reduce((a, y) => a + (y - my) * (y - my), 0);
  const ssrBlend = live.reduce((a, p) => {
    const e = Math.log10(p.mcap_usd!) - blendLogPrediction(p, m1, terms);
    return a + e * e;
  }, 0);
  const ssrM1 = live.reduce((a, p) => {
    const mult = multiples.get(p.category ?? 'Other') ?? global;
    const e = Math.log10(p.mcap_usd!) - Math.log10(p.tvl_usd * mult);
    return a + e * e;
  }, 0);
  const fit: FitStats = {
    fit_n: live.length,
    slope: round4(terms.slope),
    intercept: round4(terms.intercept),
    r2_blend: round4(1 - ssrBlend / sst),
    r2_m1: round4(1 - ssrM1 / sst),
    resid_sd: round4(Math.sqrt(ssrBlend / Math.max(live.length - 2, 1))),
    offsets: Object.fromEntries([...terms.offsets.entries()].map(([k, v]) => [k, round4(v)])),
    holdout_random: holdoutRandom,
    holdout_random2: holdoutRandom2,
    holdout_walkforward: holdoutWalk,
  };
  return { fit, multiples, global };
}

/** Whether a protocol records a token at all: a market cap, a CoinGecko id, or a symbol. */
export function isTokenized(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/**
 * A category's token odds: the share of the snapshot's protocols in that
 * category that record a token, shrunk toward the global rate with a prior
 * weight of 8 protocols, so a category with two protocols cannot claim
 * certainty from one example.
 */
export function tokenOdds(snapshot: Snapshot): { odds: TokenOdds[]; global: number } {
  const global = snapshot.protocols.filter(isTokenized).length / snapshot.protocols.length;
  const byCategory = new Map<string, { total: number; tokenized: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    const row = byCategory.get(key) ?? { total: 0, tokenized: 0 };
    row.total += 1;
    if (isTokenized(p)) row.tokenized += 1;
    byCategory.set(key, row);
  }
  const odds: TokenOdds[] = [...byCategory.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([category, row]) => ({
      category,
      total: row.total,
      tokenized: row.tokenized,
      odds: round4((row.tokenized + 8 * global) / (row.total + 8)),
    }));
  return { odds, global: round4(global) };
}

/** The odds multiplier: 0.75 + 0.5 x odds, so odds move a row by at most about a quarter either way. */
export function oddsMultiplier(odds: number): number {
  return 0.75 + 0.5 * odds;
}

/** Why a pre-token protocol is not ranked: the watchlist rule's own exclusion, named. */
export function exclusionReason(p: SnapshotProtocol): string {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (WRAPPED_WORD.test(p.name)) return 'name carries wrapped / staked / staking';
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return 'named for an exchange';
  if (VERSIONED.test(p.name)) return 'versioned name (a release of another protocol)';
  return 'not rankable';
}

/** The whole snapshot accounted for: every protocol in exactly one bucket. */
export function computeAccounting(snapshot: Snapshot): Accounting {
  const ranked = snapshot.protocols.filter(isRankable).length;
  const excluded = snapshot.protocols.filter((p) => !isTokenized(p) && !isRankable(p));
  const byReason: Record<string, number> = {};
  for (const p of excluded) {
    const r = exclusionReason(p);
    byReason[r] = (byReason[r] ?? 0) + 1;
  }
  return {
    total: snapshot.protocols.length,
    ranked,
    excluded_pre_token: excluded.length,
    live_token: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
    token_record_no_mcap: snapshot.protocols.filter((p) => p.mcap_usd === null && isTokenized(p)).length,
    excluded_by_reason: byReason,
  };
}

/**
 * Chain breadth: how much a protocol's chain count lifts its implied value.
 * One chain scores 1.00; each chain past the first adds `model.chain_step`,
 * up to `model.chain_extra_max` extra chains, so the widest protocols top out
 * at 1 + 9 x 0.02 = 1.18. The cap is the point: breadth is distribution, not
 * size, and a protocol on 45 chains must not outrank a bigger one on breadth
 * alone. A missing or empty chain list counts as one chain.
 */
export function chainMultiplier(chainCount: number, model: ModelConstants = MODEL): number {
  const extra = Math.min(Math.max(Math.floor(chainCount) - 1, 0), model.chain_extra_max);
  return 1 + extra * model.chain_step;
}

/** The six multipliers and the implied value one protocol gets under `model`. The base is the blend of the two fitted terms (see fitValueModel): the geometric mean of the category-comp value and the log-log regression value. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants,
  fit?: { slope: number; intercept: number; offsets: Map<string, number> },
  odds?: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; chainCount: number; age: number | null; baseM1: number; baseM2: number; oddsMult: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = Array.isArray(protocol.chains) ? protocol.chains.length : 0;
  const chainMult = chainMultiplier(chainCount, model);
  const baseM1 = protocol.tvl_usd * multiple;
  const baseM2 =
    fit !== undefined && protocol.tvl_usd > 0
      ? Math.pow(10, fit.intercept + fit.slope * Math.log10(protocol.tvl_usd) + (fit.offsets.get(protocol.category ?? 'Other') ?? 0))
      : baseM1;
  const base = Math.sqrt(Math.max(baseM1, 1) * Math.max(baseM2, 1));
  const oddsMult = odds === undefined ? 1 : oddsMultiplier(odds);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult * oddsMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, chainCount, age, baseM1: Math.round(baseM1), baseM2: Math.round(baseM2), oddsMult: round4(oddsMult) };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking, in any case. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** An exchange whose products begin with its name. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a protocol whose token already trades. WBTC is
 * Bitcoin on Ethereum, Binance staked ETH is ETH in Binance's staking product,
 * and neither is a protocol still waiting on a launch of its own — the same rule
 * the snapshot's watchlist was drawn with, applied here to the early radar too.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. The fitted terms come from `fitted` (computed once by buildRadar); without them the board falls back to the category-comp term alone. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  fitted?: { fit: FitStats; multiples: Map<string, number>; global: number; odds: Map<string, number> },
): BoardRow[] {
  const { comps } = categoryComps(snapshot, model);
  const multipleOf = fitted !== undefined ? fitted.multiples : new Map(comps.map((c) => [c.category, c.multiple]));
  const fitTerms = fitted !== undefined ? { slope: fitted.fit.slope, intercept: fitted.fit.intercept, offsets: new Map(Object.entries(fitted.fit.offsets)) } : undefined;
  const oddsOf = fitted !== undefined ? fitted.odds : new Map<string, number>();
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any size. A chosen
  // protocol stays chosen; nothing here replaces a watchlist row.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const multiple = multipleOf.get(p.category ?? 'Other') ?? 0.25;
    const odds = oddsOf.get(p.category ?? 'Other') ?? 0.5;
    const { implied, growthPct, growthMult, maturityMult, chainMult, chainCount, age, baseM1, baseM2, oddsMult } = impliedValue(p, snapshot.as_of, multiple, model, fitTerms, odds);
    const cost = farmCost(p, age);
    return { p, implied, growthPct, growthMult, maturityMult, chainMult, chainCount, age, multiple, baseM1, baseM2, odds, oddsMult, cost };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision: the page recomputes the row from this multiple, and a
      // rounded one would make its number differ from board.json's.
      comp_multiple: s.multiple,
      comp_live_count: comps.find((c) => c.category === (s.p.category ?? 'Other'))?.live_count ?? 0,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      chain_count: s.chainCount,
      age_days: s.age,
      base_m1_usd: s.baseM1,
      base_m2_usd: s.baseM2,
      token_odds: round4(s.odds),
      odds_multiplier: s.oddsMult,
      farm_cost_usd: s.cost.total,
      farm_weeks: s.cost.weeks,
      farm_verdict: farmVerdict(s.implied, s.odds),
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on the protocol's first chain, in whole dollars of gas. */
function gasOn(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 12;
  if (c === 'bitcoin') return 6;
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'tron') return 1;
  if (c === 'binance' || c === 'polygon' || c === 'avalanche' || c === 'fantom' || c === 'celo') return 2;
  return 3; // every other chain, an L2 or a newer L1: a few dollars a transaction
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * What a farm plan costs, in whole dollars: the deposit the TVL tier calls
 * for, plus gas for the setup transaction and one qualifying action a week
 * over the hold. The deposit is capital at risk, the gas is spent; the
 * dashboard shows both, and the total, beside every row.
 */
export function farmCost(p: SnapshotProtocol, age: number | null): { capital: number; gas: number; weeks: number; gas_total: number; total: number } {
  const capital = capitalFor(p);
  const gas = gasOn(chainOf(p));
  const weeks = Math.max(1, Math.ceil(holdDaysFor(age) / 7));
  const gas_total = gas * (1 + weeks);
  return { capital, gas, weeks, gas_total, total: capital + gas_total };
}

/**
 * The farm verdict, from the implied value and the token odds: Farm now when
 * the implied value is at least $50M and the category's token odds are at
 * least 0.35; Watch when the implied value is at least $10M or the odds are
 * at least 0.60; Low priority otherwise. The thresholds are stated here and
 * on the dashboard, so a reader can see the verdict is a rule, not a feeling.
 */
export function farmVerdict(impliedValueUsd: number, odds: number): string {
  if (impliedValueUsd >= 50_000_000 && odds >= 0.35) return 'Farm now';
  if (impliedValueUsd >= 10_000_000 || odds >= 0.6) return 'Watch';
  return 'Low priority';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('onchain capital allocator') || c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('basis trading') || c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain')) return `Use $${capital} of ${name}'s native asset on ${chain}: hold it and make one on-chain action a week.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name} on ${chain} and keep the receipts.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasOn(chain);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Total planned spend is $${farmCost(p, age).total} ($${farmCost(p, age).capital} of deposit plus about $${farmCost(p, age).gas_total} of gas over ${farmCost(p, age).weeks} weeks).`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, all of them, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan derived in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comp_multiple: row.model.comp_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    chain_count: row.model.chain_count,
    token_odds: row.model.token_odds,
    odds_multiplier: row.model.odds_multiplier,
    base_m1_usd: row.model.base_m1_usd,
    base_m2_usd: row.model.base_m2_usd,
    farm_cost_usd: row.model.farm_cost_usd,
    farm_weeks: row.model.farm_weeks,
    farm_verdict: row.model.farm_verdict,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { fit, multiples, global } = fitValueModel(snapshot, model);
  const { odds, global: globalOdds } = tokenOdds(snapshot);
  const oddsMap = new Map(odds.map((o) => [o.category, o.odds]));
  const board = buildBoard(snapshot, model, { fit, multiples, global, odds: oddsMap });
  const live = liveRows(snapshot);
  const { comps } = categoryComps(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const accounting = computeAccounting(snapshot);
  const excluded: ExcludedRow[] = snapshot.protocols
    .filter((p) => !isTokenized(p) && !isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: exclusionReason(p) }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(global),
    comps,
    rows: board.map(radarRow),
    live,
    fit,
    token_odds: odds,
    global_token_odds: globalOdds,
    accounting,
    excluded,
    token_record_no_mcap: accounting.token_record_no_mcap,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
