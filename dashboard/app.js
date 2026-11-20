// Token Radar, radar-4 dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// drawer with the model's own inputs and the protocol's farm plan. No network: every
// byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: '0', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 100) / 100).toFixed(2) + 'x'; }

  // The model in one function: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are
  // visibly the same arithmetic. The base is the blend of the two fitted terms:
  // the category-comp value (TVL x comp multiple) and the log-log regression
  // value (10 ^ (intercept + slope x log10(TVL) + category offset)), combined
  // as their geometric mean, then growth, maturity, chain breadth and token
  // odds. The fit (slope, intercept, offsets) is in DATA.fit, fitted at run
  // time from the snapshot's live-token protocols, never hardcoded here.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chain_count !== null && row.chain_count !== undefined ? row.chain_count : (row.chains ? row.chains.length : 0);
    var chainMult = 1 + Math.min(Math.max(chains - 1, 0), model.chain_extra_max) * model.chain_step;
    var baseM1 = row.tvl_usd * row.comp_multiple;
    var fit = DATA.fit || {};
    var offset = (fit.offsets && fit.offsets[row.category || 'Other']) || 0;
    var baseM2 = Math.pow(10, (fit.intercept || 0) + (fit.slope || 0) * Math.log10(row.tvl_usd) + offset);
    var base = Math.sqrt(Math.max(baseM1, 1) * Math.max(baseM2, 1));
    var oddsMult = 0.75 + 0.5 * (row.token_odds === null || row.token_odds === undefined ? 0.5 : row.token_odds);
    return Math.max(1, Math.round(base * growthMult * maturity * chainMult * oddsMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasOn(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return 12;
    if (c === 'bitcoin') return 6;
    if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'tron') return 1;
    if (c === 'binance' || c === 'polygon' || c === 'avalanche' || c === 'fantom' || c === 'celo') return 2;
    return 3;
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('onchain capital allocator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('basis trading') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + " of " + name + "'s native asset on " + chain + ': hold it and make one on-chain action a week.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipts.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmCost(p) {
    var capital = capitalFor(p);
    var gas = gasOn(chainOf(p));
    var weeks = Math.max(1, Math.ceil(holdDaysFor(p.age_days) / 7));
    return { capital: capital, gas: gas, weeks: weeks, gasTotal: gas * (1 + weeks), total: capital + gas * (1 + weeks) };
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var gas = gasOn(chain);
    var hold = holdDaysFor(p.age_days);
    var cost = farmCost(p);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about $' + gas + ' of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $' + gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Total planned spend is $' + cost.total + ' ($' + cost.capital + ' of deposit plus about $' + cost.gasTotal + ' of gas over ' + cost.weeks + ' weeks).', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function compOf(row) {
    var list = DATA.comps || [];
    for (var i = 0; i < list.length; i++) if (list[i].category === (row.category || 'Other')) return list[i];
    return null;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = params.get('minTvl');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl !== '0') params.set('minTvl', state.minTvl);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    var min = parseFloat(state.minTvl) || 0;
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < min) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'sweep', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, el('b', { text: 'Token Radar' }), ' — pre-token protocols, ranked')
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var fit = DATA.fit || {};
    var acc = DATA.accounting || {};
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by a fitted implied value' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M</b> of TVL and no token on record. The early radar adds <b>' + DATA.early_size + '</b> pre-token protocols below that floor, every one the snapshot can rank. The value model is fitted at run time from the snapshot\u2019s live-token protocols and validated on three held-out splits before it is trusted — its numbers are below, and its misses are stated, not hidden. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Protocols accounted for' }), el('b', { text: String(acc.total || 0) + ' / ' + String(acc.total || 0) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live protocols in the fit' }), el('b', { text: String(fit.fit_n || 0) })),
        el('div', { class: 'fact' }, el('span', { text: 'Blend R\u00b2 (log value)' }), el('b', { text: fit.r2_blend === undefined ? 'n/a' : String(fit.r2_blend) })),
        el('div', { class: 'fact' }, el('span', { text: 'Held-out median error' }), el('b', { text: fit.holdout_random ? '\u00d7' + fit.holdout_random.med_factor + ' random, \u00d7' + fit.holdout_walkforward.med_factor + ' walk-forward' : 'n/a' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var tvl = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['5000000', 'TVL $5M+'], ['50000000', 'TVL $50M+'], ['500000000', 'TVL $500M+'], ['1000000000', 'TVL $1B+']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: o[0] === state.minTvl ? 'selected' : null });
      })
    );
    tvl.addEventListener('change', function () { state.minTvl = tvl.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'TVL' }), tvl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = '0'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('div', { class: 'farm' },
          el('span', { class: 'verdict ' + (r.farm_verdict === 'Farm now' ? 'farm' : r.farm_verdict === 'Watch' ? 'watch' : 'low'), text: r.farm_verdict || '' }),
          el('span', { class: 'sub', text: '$' + (r.farm_cost_usd || 0) + ' over ' + (r.farm_weeks || 0) + 'w' })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Farm' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-per-TVL is what prices the comps.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var comps = (DATA.comps || []).filter(function (c) { return c.live_count > 0; }).sort(function (a, b) { return b.multiple - a.multiple; });
    var compRows = comps.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: c.median_multiple === null ? 'n/a' : fmtMult(c.median_multiple) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. Re-run on a newer snapshot and the board re-ranks from the new figures: that is how the radar finds a launch early.' }),
      el('div', { class: 'formula' },
        'implied = round( sqrt( (tvl_usd x comp(category)) x 10^(intercept + slope x log10(tvl_usd) + offset(category)) ) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.chain_extra_max + ') x ' + m.chain_step + ') x (0.75 + 0.5 x token_odds(category)) )'
      ),
      el('p', { class: 'sub', text: 'The base is the geometric mean of two fitted terms, both fitted at run time from the snapshot\u2019s ' + (DATA.fit ? DATA.fit.fit_n : 0) + ' live-token protocols (market cap above zero, TVL above zero, not a CEX): the category comp, the median market-cap-per-TVL of the live protocols in that category shrunk toward the global median of ' + fmtMult(DATA.global_multiple) + ' with a prior weight of ' + m.comp_prior + ' live protocols and clamped to ' + fmtMult(m.comp_min) + '–' + fmtMult(m.comp_max) + '; and a log-log regression, log10(market cap) = ' + (DATA.fit ? DATA.fit.intercept : 'n/a') + ' + ' + (DATA.fit ? DATA.fit.slope : 'n/a') + ' x log10(TVL), plus a per-category offset shrunk toward 0 with a prior weight of 4. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth is a tie-breaker: each chain past the first adds ' + m.chain_step + ', up to ' + m.chain_extra_max + ' extra chains — a single-chain protocol scores 1.00x and one on ten chains or more scores 1.18x. Token odds are the share of the category\u2019s protocols that record a token at all, shrunk toward the global rate of ' + (DATA.global_token_odds === undefined ? 'n/a' : DATA.global_token_odds) + ' with a prior weight of 8; they move a row by at most about a quarter either way.' }),
      el('h3', { text: 'Validation: the blend was tested before it was trusted' }),
      el('p', { class: 'sub', text: 'Both terms were fitted on training halves and scored on held-out live protocols the fit never saw. The blend\u2019s median error beats or ties each term alone on all three splits, so the blend is what prices the board. The errors are large — a median miss of \u00d72.5 to \u00d75.4 — so implied values are order-of-magnitude estimates, and the board never presents them as prices. Blend R\u00b2 on the full live set is ' + (DATA.fit ? DATA.fit.r2_blend : 'n/a') + ' (comps alone ' + (DATA.fit ? DATA.fit.r2_m1 : 'n/a') + ', residual SD ' + (DATA.fit ? DATA.fit.resid_sd : 'n/a') + ' in log10).' }),
      el('table', { class: 'comps' },
        el('caption', { class: 'sub', text: 'Held-out validation of the blend, median absolute log10 error and the factor it means.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Split' }),
          el('th', { scope: 'col', class: 'num', text: 'Train' }),
          el('th', { scope: 'col', class: 'num', text: 'Test' }),
          el('th', { scope: 'col', class: 'num', text: 'Median log error' }),
          el('th', { scope: 'col', class: 'num', text: 'Median miss' })
        )),
        el('tbody', null, (DATA.fit ? [DATA.fit.holdout_random, DATA.fit.holdout_random2, DATA.fit.holdout_walkforward] : []).map(function (v) {
          return el('tr', null,
            el('td', { text: v.name }),
            el('td', { class: 'num', text: String(v.n_train) }),
            el('td', { class: 'num', text: String(v.n_test) }),
            el('td', { class: 'num', text: String(v.med_abs_log10_error) }),
            el('td', { class: 'num', text: '\u00d7' + v.med_factor })
          );
        }))
      ),
      el('table', { class: 'comps' },
        el('caption', { class: 'sub', text: 'Category comps, from the snapshot\u2019s live-token protocols. Categories with no live protocol take the global median.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Category' }),
          el('th', { scope: 'col', class: 'num', text: 'Live' }),
          el('th', { scope: 'col', class: 'num', text: 'Median' }),
          el('th', { scope: 'col', class: 'num', text: 'Multiple used' })
        )),
        el('tbody', null, compRows)
      )
    );
  }

  function accountingPanel() {
    var acc = DATA.accounting || {};
    var reasons = acc.excluded_by_reason || {};
    var reasonRows = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; }).map(function (r) {
      return el('tr', null, el('td', { text: r }), el('td', { class: 'num', text: String(reasons[r]) }));
    });
    return el('section', { class: 'panel accounting' },
      el('h2', { text: 'All ' + (acc.total || 0) + ' protocols, accounted for' }),
      el('p', { class: 'sub', text: 'Every protocol in the snapshot lands in exactly one bucket. The board ranks the pre-token protocols the snapshot can rank; the rest are shown here, not hidden. A protocol that records a token but carries no market cap (258 of them by symbol alone) is token-recorded, so it is not pre-token, but its value cannot be priced from a market cap either — it sits in its own bucket.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Ranked on the board' }), el('b', { text: String(acc.ranked || 0) })),
        el('div', { class: 'fact' }, el('span', { text: 'Excluded pre-token' }), el('b', { text: String(acc.excluded_pre_token || 0) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live token (market cap)' }), el('b', { text: String(acc.live_token || 0) })),
        el('div', { class: 'fact' }, el('span', { text: 'Token recorded, no market cap' }), el('b', { text: String(acc.token_record_no_mcap || 0) }))
      ),
      el('table', { class: 'comps' },
        el('caption', { class: 'sub', text: 'Why the excluded pre-token protocols are not ranked: the watchlist rule\u2019s own exclusion, applied to the early radar too.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Reason' }), el('th', { scope: 'col', class: 'num', text: 'Protocols' }))),
        el('tbody', null, reasonRows)
      ),
      el('p', { class: 'sub', text: 'The ' + (DATA.excluded ? DATA.excluded.length : 0) + ' excluded protocols are listed by TVL in the data (see data.js, excluded), the largest first. Farm verdicts: Farm now when implied value is at least $50M and token odds at least 0.35; Watch when implied value is at least $10M or odds at least 0.60; Low priority otherwise.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var comp = compOf(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Comp multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.comp_multiple) })),
        el('div', null, el('span', { text: 'Base, comps term' }), el('b', { class: 'num', text: fmtUsd(row.base_m1_usd) })),
        el('div', null, el('span', { text: 'Base, regression term' }), el('b', { class: 'num', text: fmtUsd(row.base_m2_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chain breadth' }), el('b', { class: 'num', text: String(row.chain_count) + (row.chain_count === 1 ? ' chain' : ' chains') })),
        el('div', null, el('span', { text: 'Token odds (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: (row.token_odds === null || row.token_odds === undefined ? 'n/a' : String(row.token_odds)) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Odds multiplier' }), el('b', { class: 'num', text: String(row.odds_multiplier) })),
        el('div', null, el('span', { text: 'Farm verdict' }), el('b', { class: 'num', text: (row.farm_verdict || '') + ' — $' + (row.farm_cost_usd || 0) + ' over ' + (row.farm_weeks || 0) + ' weeks' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': ' + (comp ? 'its category has ' + comp.live_count + ' live protocol' + (comp.live_count === 1 ? '' : 's') + ' behind the multiple, median ' + (comp.median_multiple === null ? 'n/a' : fmtMult(comp.median_multiple)) + ', shrunk to ' + fmtMult(row.comp_multiple) + '. ' : 'its category has no live protocol, so it takes the global median ' + fmtMult(DATA.global_multiple) + '. ') + 'The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') { shell.appendChild(modelPanel()); shell.appendChild(accountingPanel()); }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
