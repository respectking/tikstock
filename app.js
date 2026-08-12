/* ==========================================================================
   TikStock
   A swipe-deck for stocks. Swipe right if you're bullish, left if you'd pass,
   then compare your gut against a transparent fundamentals score.

   No build step, no framework, no backend. Data comes either from the bundled
   demo file or, when a key is present, straight from Finnhub in the browser.
   ========================================================================== */
(function () {
"use strict";

/* ---------------------------------------------------------------- storage */

var LS = {
  key:   "ss.finnhubKey",
  uni:   "ss.universe",
  stats: "ss.stats",
  picks: "ss.picks"
};

function load(k, fallback) {
  try {
    var raw = localStorage.getItem(k);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ }
}
function drop(k) {
  try { localStorage.removeItem(k); } catch (e) {}
}

var state = {
  apiKey:   load(LS.key, ""),
  universe: load(LS.uni, "all"),
  stats:    load(LS.stats, { played: 0, matched: 0, streak: 0, best: 0 }),
  picks:    load(LS.picks, []),
  deck:     [],
  cursor:   0,
  live:     false,
  busy:     false,
  cache:    {}
};

/* ------------------------------------------------------------- universes */

var UNIVERSES = [
  { id: "all",    label: "Everything",  test: function () { return true; } },
  { id: "mega",   label: "Mega caps",   test: function (s) { return s.mc >= 300; } },
  { id: "tech",   label: "Tech",        test: function (s) { return s.s === "Technology"; } },
  { id: "income", label: "Dividends",   test: function (s) { return s.dy >= 2; } },
  { id: "spicy",  label: "High beta",   test: function (s) { return s.beta >= 1.3; } }
];

function universeById(id) {
  for (var i = 0; i < UNIVERSES.length; i++) if (UNIVERSES[i].id === id) return UNIVERSES[i];
  return UNIVERSES[0];
}

/* ------------------------------------------------------------- utilities */

var $ = function (sel, root) { return (root || document).querySelector(sel); };

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function num(v) { return typeof v === "number" && isFinite(v); }

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* Piecewise-linear mapping through a list of [input, output] knots. */
function curve(v, knots) {
  if (!num(v)) return null;
  if (v <= knots[0][0]) return knots[0][1];
  var last = knots[knots.length - 1];
  if (v >= last[0]) return last[1];
  for (var i = 1; i < knots.length; i++) {
    var a = knots[i - 1], b = knots[i];
    if (v <= b[0]) {
      var f = (v - a[0]) / (b[0] - a[0]);
      return a[1] + f * (b[1] - a[1]);
    }
  }
  return last[1];
}

function mean(list) {
  var vals = list.filter(num);
  if (!vals.length) return null;
  var sum = 0;
  for (var i = 0; i < vals.length; i++) sum += vals[i];
  return sum / vals.length;
}

/* ------------------------------------------------------------ formatting */

function fmtPrice(v) {
  if (!num(v)) return "—";
  var d = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(v, digits) {
  if (!num(v)) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(digits === undefined ? 2 : digits) + "%";
}

function fmtCap(b) {
  if (!num(b)) return "—";
  if (b >= 1000) return "$" + (b / 1000).toFixed(2) + "T";
  if (b >= 1)    return "$" + b.toFixed(0) + "B";
  return "$" + (b * 1000).toFixed(0) + "M";
}

function fmtNum(v, digits) {
  if (!num(v)) return "—";
  return v.toFixed(digits === undefined ? 1 : digits);
}

/* ============================================================== SCORING ===
   Five factors, each 0–100, then a weighted blend over whichever factors
   have data. Deliberately simple and fully inspectable — see README.
   ======================================================================== */

var FACTORS = [
  { id: "value",   label: "Value",         weight: 0.22 },
  { id: "growth",  label: "Growth",        weight: 0.22 },
  { id: "quality", label: "Profitability", weight: 0.24 },
  { id: "moment",  label: "Momentum",      weight: 0.18 },
  { id: "stable",  label: "Stability",     weight: 0.14 }
];

function scoreValue(s) {
  var pe = num(s.pe) && s.pe > 0
    ? curve(s.pe, [[5, 92], [10, 84], [16, 70], [25, 52], [40, 34], [70, 16], [120, 8]])
    : null;
  var pb = num(s.pb) && s.pb > 0
    ? curve(s.pb, [[0.8, 90], [1.5, 78], [3, 64], [6, 48], [12, 32], [30, 14], [60, 8]])
    : null;
  return mean([pe, pb]);
}

function scoreGrowth(s) {
  var rg = curve(s.rg, [[-20, 4], [-5, 22], [0, 34], [5, 50], [12, 66], [25, 82], [45, 93], [80, 97]]);
  var eg = curve(s.eg, [[-50, 4], [-15, 22], [0, 36], [10, 54], [25, 70], [50, 85], [100, 94]]);
  return mean([rg, rg, eg]); /* revenue growth weighted double — less noisy than EPS */
}

function scoreQuality(s) {
  var roe = curve(s.roe, [[-20, 3], [0, 16], [6, 36], [12, 54], [20, 70], [35, 84], [60, 93]]);
  var nm  = curve(s.nm,  [[-20, 3], [0, 18], [4, 34], [9, 50], [16, 66], [26, 80], [40, 92]]);
  return mean([roe, nm]);
}

function scoreMomentum(s) {
  var pos = null;
  if (num(s.lo) && num(s.hi) && s.hi > s.lo && num(s.price)) {
    pos = clamp((s.price - s.lo) / (s.hi - s.lo), 0, 1) * 100;
  }
  var r13 = curve(s.r13, [[-30, 6], [-12, 24], [-3, 40], [3, 55], [10, 70], [22, 85], [45, 94]]);
  var r52 = curve(s.r52, [[-45, 6], [-18, 26], [-4, 42], [6, 57], [18, 72], [40, 86], [80, 94]]);
  return mean([pos, r13, r52]);
}

function scoreStability(s) {
  var beta = curve(s.beta, [[0.4, 92], [0.7, 82], [1.0, 66], [1.3, 50], [1.8, 32], [2.5, 16], [3.5, 8]]);
  var band = null;
  if (num(s.lo) && num(s.hi) && s.hi > 0) {
    band = curve((s.hi - s.lo) / s.hi, [[0.15, 90], [0.28, 74], [0.42, 56], [0.6, 38], [0.8, 20]]);
  }
  var div = num(s.dy) ? curve(s.dy, [[0, 44], [1.5, 58], [3, 70], [5, 74], [9, 58]]) : null;
  return mean([beta, band, div]);
}

function scoreStock(s) {
  var raw = {
    value:   scoreValue(s),
    growth:  scoreGrowth(s),
    quality: scoreQuality(s),
    moment:  scoreMomentum(s),
    stable:  scoreStability(s)
  };
  var total = 0, wsum = 0;
  FACTORS.forEach(function (f) {
    if (num(raw[f.id])) { total += raw[f.id] * f.weight; wsum += f.weight; }
  });
  var overall = wsum > 0 ? Math.round(total / wsum) : null;
  return { factors: raw, overall: overall };
}

/* Model's stance from the score. The middle band is an honest "no call". */
function stance(score) {
  if (!num(score)) return "push";
  if (score >= 62) return "bull";
  if (score <= 42) return "bear";
  return "push";
}

function explain(s, res) {
  var known = FACTORS.filter(function (f) { return num(res.factors[f.id]); });
  if (!known.length) return "Not enough data on this one to say much.";

  var sorted = known.slice().sort(function (a, b) { return res.factors[b.id] - res.factors[a.id]; });
  var top = sorted[0], bottom = sorted[sorted.length - 1];

  var strong = {
    value:   "it looks cheap against earnings and book value",
    growth:  "the top line is still compounding fast",
    quality: "margins and returns on equity are genuinely strong",
    moment:  "price action has been working",
    stable:  "it moves less than the market and pays you to wait"
  };
  var weak = {
    value:   "you're paying a rich multiple",
    growth:  "growth has stalled",
    quality: "profitability is thin",
    moment:  "the chart has been going the wrong way",
    stable:  "it's a volatile ride"
  };

  var msg = "Strongest on " + top.label.toLowerCase() + " — " + strong[top.id] + ".";
  if (sorted.length > 1 && res.factors[bottom.id] < 50) {
    msg += " Weakest on " + bottom.label.toLowerCase() + " — " + weak[bottom.id] + ".";
  }
  return msg;
}

/* ============================================================ DATA LAYER === */

var FINNHUB = "https://finnhub.io/api/v1";

function baseFor(ticker) {
  var list = window.SS_UNIVERSE.stocks;
  for (var i = 0; i < list.length; i++) if (list[i].t === ticker) return list[i];
  return null;
}

/* Shape the bundled demo row into the normalised stock object. */
function fromDemo(row) {
  return {
    t: row.t, n: row.n, sector: row.s, logo: null,
    price: row.p, change: row.d, mc: row.mc,
    pe: row.pe, pb: row.pb, roe: row.roe, nm: row.nm,
    rg: row.rg, eg: row.eg, beta: row.beta,
    lo: row.lo, hi: row.hi, dy: row.dy,
    r13: row.r13, r52: row.r52,
    live: false
  };
}

function jget(path) {
  var sep = path.indexOf("?") === -1 ? "?" : "&";
  return fetch(FINNHUB + path + sep + "token=" + encodeURIComponent(state.apiKey))
    .then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("auth");
      if (r.status === 429) throw new Error("rate");
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
}

/* Pull quote + profile + metrics for one ticker and normalise. */
function fromFinnhub(ticker) {
  var row = baseFor(ticker);
  return Promise.all([
    jget("/quote?symbol=" + encodeURIComponent(ticker)),
    jget("/stock/profile2?symbol=" + encodeURIComponent(ticker)),
    jget("/stock/metric?metric=all&symbol=" + encodeURIComponent(ticker))
  ]).then(function (parts) {
    var q = parts[0] || {}, p = parts[1] || {}, m = (parts[2] && parts[2].metric) || {};

    if (!num(q.c) || q.c === 0) throw new Error("no quote");

    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        var v = m[arguments[i]];
        if (num(v)) return v;
      }
      return null;
    }

    return {
      t: ticker,
      n: p.name || (row && row.n) || ticker,
      sector: p.finnhubIndustry || (row && row.s) || "—",
      logo: p.logo || null,
      price:  q.c,
      change: num(q.dp) ? q.dp : null,
      mc:     num(p.marketCapitalization) ? p.marketCapitalization / 1000 : (row ? row.mc : null),
      pe:     pick("peTTM", "peBasicExclExtraTTM", "peAnnual"),
      pb:     pick("pbQuarterly", "pbAnnual"),
      roe:    pick("roeTTM", "roeRfy"),
      nm:     pick("netProfitMarginTTM", "netProfitMarginAnnual"),
      rg:     pick("revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"),
      eg:     pick("epsGrowthTTMYoy", "epsGrowthQuarterlyYoy"),
      beta:   pick("beta"),
      lo:     pick("52WeekLow"),
      hi:     pick("52WeekHigh"),
      dy:     pick("dividendYieldIndicatedAnnual", "currentDividendYieldTTM"),
      r13:    pick("13WeekPriceReturnDaily"),
      r52:    pick("52WeekPriceReturnDaily"),
      live: true
    };
  });
}

function getStock(ticker) {
  if (state.cache[ticker]) return Promise.resolve(state.cache[ticker]);

  var fallback = function () {
    var row = baseFor(ticker);
    var s = row ? fromDemo(row) : null;
    if (s) state.cache[ticker] = s;
    return s;
  };

  if (!state.apiKey) return Promise.resolve(fallback());

  return fromFinnhub(ticker)
    .then(function (s) { state.cache[ticker] = s; return s; })
    .catch(function (err) {
      if (err && err.message === "auth") {
        setKeyProblem("That key was rejected by Finnhub. Falling back to demo data.");
        state.live = false;
        renderBanner();
      } else if (err && err.message === "rate") {
        setKeyProblem("Finnhub rate limit hit — showing demo data for a moment.");
      }
      return fallback();
    });
}

/* Warm the next few cards so swiping never waits on the network. */
function prefetch(from, count) {
  for (var i = from; i < Math.min(from + count, state.deck.length); i++) {
    (function (tk) { getStock(tk); })(state.deck[i]);
  }
}

/* ============================================================= THE DECK === */

var deckEl      = $("#deckEl");
var deckEmpty   = $("#deckEmpty");
var deckHint    = $("#deckHint");
var controlsEl  = $("#controls");

var VISIBLE = 3;
var cardNodes = [];   /* [{node, ticker, depth}] top first */

function buildDeck() {
  var uni = universeById(state.universe);
  var pool = window.SS_UNIVERSE.stocks.filter(uni.test).map(function (r) { return r.t; });
  state.deck = shuffle(pool);
  state.cursor = 0;
}

function renderDeck() {
  cardNodes.forEach(function (c) { c.node.remove(); });
  cardNodes = [];

  var remaining = state.deck.length - state.cursor;
  deckEmpty.hidden = remaining > 0;
  $("#btnPass").disabled = $("#btnBull").disabled = $("#btnSkip").disabled = remaining === 0;
  deckHint.innerHTML = remaining > 0
    ? "Drag the card, or use <kbd>&larr;</kbd> <kbd>&rarr;</kbd>"
    : "";

  if (remaining === 0) {
    $("#emptyLine").textContent = state.stats.played > 0
      ? "You played " + state.stats.played + " and agreed with the model on " +
        Math.round(100 * state.stats.matched / state.stats.played) + "% of them."
      : "You went through every stock in this universe.";
    return;
  }

  /* Build back-to-front so the top card is last in the DOM. */
  var n = Math.min(VISIBLE, remaining);
  for (var depth = n - 1; depth >= 0; depth--) {
    var ticker = state.deck[state.cursor + depth];
    var node = makeCard(ticker, depth);
    deckEl.appendChild(node);
    cardNodes.unshift({ node: node, ticker: ticker, depth: depth });
  }
  attachDrag(cardNodes[0]);
  prefetch(state.cursor, VISIBLE + 2);
}

function stackTransform(depth) {
  return "translateY(" + (depth * -9) + "px) scale(" + (1 - depth * 0.035) + ")";
}

function makeCard(ticker, depth) {
  var card = el("div", "card card-skeleton");
  card.style.transform = stackTransform(depth);
  card.style.zIndex = String(50 - depth);
  card.setAttribute("aria-hidden", depth > 0 ? "true" : "false");

  card.innerHTML =
    '<div class="stamp bull"><svg viewBox="0 0 24 24"><path d="M5 16l14-8M19 16v-6h-6"/></svg>Bullish</div>' +
    '<div class="stamp bear"><svg viewBox="0 0 24 24"><path d="M5 8l14 8M19 8v6h-6"/></svg>Pass</div>' +
    '<div class="card-body"></div>';

  var body = $(".card-body", card);
  body.appendChild(skeleton());

  getStock(ticker).then(function (s) {
    if (!card.isConnected) return;
    card.classList.remove("card-skeleton");
    body.innerHTML = "";
    if (!s) { body.appendChild(el("p", "", "Couldn't load " + ticker + ".")); return; }
    fillCard(body, s);
  });

  return card;
}

function skeleton() {
  var wrap = el("div");
  wrap.style.cssText = "display:flex;flex-direction:column;height:100%;gap:14px";
  wrap.innerHTML =
    '<div style="display:flex;gap:12px"><div class="sk" style="width:46px;height:46px;border-radius:12px"></div>' +
    '<div style="flex:1"><div class="sk" style="height:22px;width:52%;margin-bottom:7px"></div>' +
    '<div class="sk" style="height:13px;width:78%"></div></div></div>' +
    '<div class="sk" style="height:42px;width:62%;margin-top:12px"></div>' +
    '<div class="sk" style="height:44px;width:100%"></div>' +
    '<div class="sk" style="height:74px;width:100%;margin-top:auto"></div>';
  return wrap;
}

function fillCard(body, s) {
  /* --- header --- */
  var top = el("div", "card-top");
  var mark = el("div", "card-mark");
  if (s.logo) {
    var img = new Image();
    img.src = s.logo; img.alt = "";
    img.onerror = function () { mark.textContent = s.t.slice(0, 2); };
    mark.appendChild(img);
  } else {
    mark.textContent = (s.n || s.t).trim().charAt(0).toUpperCase();
  }
  var idbox = el("div");
  idbox.appendChild(el("div", "card-ticker", s.t));
  idbox.appendChild(el("div", "card-name", s.n));
  if (s.sector) idbox.appendChild(el("span", "card-sector", s.sector));
  top.appendChild(mark);
  top.appendChild(idbox);
  body.appendChild(top);

  /* --- price + day move (arrow glyph carries the sign, not just colour) --- */
  var price = el("div", "card-price");
  price.appendChild(el("div", "card-price-v", fmtPrice(s.price)));

  var dir = !num(s.change) ? "flat" : s.change > 0.005 ? "up" : s.change < -0.005 ? "down" : "flat";
  var delta = el("div", "delta " + dir);
  delta.appendChild(el("span", "arrow", dir === "up" ? "▲" : dir === "down" ? "▼" : "–"));
  delta.appendChild(el("span", "", num(s.change) ? fmtPct(s.change) + " today" : "no change data"));
  price.appendChild(delta);
  body.appendChild(price);

  /* --- 52-week position strip (a real measure, not a synthetic chart) --- */
  if (num(s.lo) && num(s.hi) && s.hi > s.lo) {
    var pos = clamp((s.price - s.lo) / (s.hi - s.lo), 0, 1);
    var wrap = el("div", "card-rangewrap");
    var head = el("div", "card-rangehead");
    head.appendChild(el("span", "", "52-week range"));
    head.appendChild(el("span", "", Math.round(pos * 100) + "% of the way up"));
    wrap.appendChild(head);

    var bar = el("div", "rangebar");
    bar.innerHTML = '<div class="rangebar-track"></div><div class="rangebar-fill"></div>' +
                    '<div class="rangebar-marker"><span class="rangebar-dot"></span></div>';
    $(".rangebar-fill", bar).style.width = (pos * 100) + "%";
    $(".rangebar-marker", bar).style.left = (pos * 100) + "%";
    wrap.appendChild(bar);

    var ends = el("div", "card-rangeends");
    ends.appendChild(el("span", "", fmtPrice(s.lo)));
    ends.appendChild(el("span", "", fmtPrice(s.hi)));
    wrap.appendChild(ends);
    body.appendChild(wrap);
  }

  /* --- headline stats --- */
  var grid = el("dl", "card-grid");
  [
    ["Mkt cap", fmtCap(s.mc)],
    ["P/E",     num(s.pe) && s.pe > 0 ? fmtNum(s.pe) : "—"],
    ["Yield",   num(s.dy) && s.dy > 0 ? fmtNum(s.dy, 2) + "%" : "—"],
    ["ROE",     num(s.roe) ? fmtNum(s.roe, 0) + "%" : "—"],
    ["Rev gr.", num(s.rg) ? fmtPct(s.rg, 1) : "—"],
    ["Beta",    num(s.beta) ? fmtNum(s.beta, 2) : "—"]
  ].forEach(function (pair) {
    var cell = el("div", "card-cell");
    cell.appendChild(el("dt", "", pair[0]));
    cell.appendChild(el("dd", "", pair[1]));
    grid.appendChild(cell);
  });
  body.appendChild(grid);
}

/* ------------------------------------------------------------- gestures */

var drag = null;

function attachDrag(entry) {
  if (!entry) return;
  var card = entry.node;
  var bull = $(".stamp.bull", card);
  var bear = $(".stamp.bear", card);

  card.addEventListener("pointerdown", function (e) {
    if (state.busy) return;
    if (e.button !== undefined && e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, t0: Date.now() };
    card.setPointerCapture(e.pointerId);
    card.classList.add("is-drag");
  });

  card.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x0;
    drag.dy = e.clientY - drag.y0;
    var rot = clamp(drag.dx / 16, -14, 14);
    card.style.transform = "translate(" + drag.dx + "px," + drag.dy * 0.35 + "px) rotate(" + rot + "deg)";
    var t = clamp(Math.abs(drag.dx) / 110, 0, 1);
    bull.style.opacity = drag.dx > 0 ? t : 0;
    bear.style.opacity = drag.dx < 0 ? t : 0;
  });

  function end(e) {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    var dx = drag.dx;
    var speed = Math.abs(dx) / Math.max(1, Date.now() - drag.t0);
    drag = null;
    card.classList.remove("is-drag");

    var committed = Math.abs(dx) > 100 || (Math.abs(dx) > 45 && speed > 0.55);
    if (committed) {
      commit(dx > 0 ? "bull" : "bear");
    } else {
      card.classList.add("is-settling");
      card.style.transform = stackTransform(0);
      bull.style.opacity = bear.style.opacity = 0;
      setTimeout(function () { card.classList.remove("is-settling"); }, 300);
    }
  }

  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

/* --------------------------------------------------------------- commit */

function commit(call) {
  if (state.busy) return;
  var entry = cardNodes[0];
  if (!entry) return;
  state.busy = true;

  var card = entry.node;
  var dir = call === "bull" ? 1 : -1;
  $(".stamp." + call, card).style.opacity = 1;
  card.classList.add("is-gone");
  card.style.transform = "translate(" + (dir * (window.innerWidth * 0.9 + 160)) + "px, 40px) rotate(" + (dir * 22) + "deg)";

  /* Promote the cards behind while the top one flies out. */
  for (var i = 1; i < cardNodes.length; i++) {
    var c = cardNodes[i];
    c.depth -= 1;
    c.node.style.transition = "transform .3s cubic-bezier(.22,1,.36,1)";
    c.node.style.transform = stackTransform(c.depth);
    c.node.setAttribute("aria-hidden", c.depth > 0 ? "true" : "false");
  }

  var ticker = entry.ticker;
  getStock(ticker).then(function (s) {
    if (s) showReveal(s, call);
    else advance();
  });
}

function skipCard() {
  if (state.busy) return;
  var entry = cardNodes[0];
  if (!entry) return;
  state.busy = true;
  entry.node.classList.add("is-gone");
  entry.node.style.transform = "translateY(-140%) scale(.9)";
  setTimeout(function () { state.busy = false; advance(); }, 260);
}

function advance() {
  state.cursor += 1;
  renderDeck();
}

/* ============================================================== REVEAL === */

var revealEl = $("#reveal");
var lastFocus = null;

function showReveal(s, call) {
  var res = scoreStock(s);
  var model = stance(res.overall);
  var outcome = model === "push" ? "push" : (model === call ? "match" : "miss");

  /* --- scoring bookkeeping --- */
  state.stats.played += 1;
  if (outcome === "match" || outcome === "push") {
    state.stats.matched += 1;
    state.stats.streak += 1;
    if (state.stats.streak > state.stats.best) state.stats.best = state.stats.streak;
  } else {
    state.stats.streak = 0;
  }
  save(LS.stats, state.stats);

  state.picks = state.picks.filter(function (p) { return p.t !== s.t; });
  state.picks.unshift({ t: s.t, n: s.n, call: call, score: res.overall, outcome: outcome });
  if (state.picks.length > 300) state.picks.length = 300;
  save(LS.picks, state.picks);
  renderStats();

  /* --- identity --- */
  $("#rvTicker").textContent = s.t;
  $("#rvName").textContent = s.n;

  var v = $("#rvVerdict");
  v.className = "verdict " + outcome;
  $("#rvVerdictIcon").textContent = outcome === "match" ? "✓" : outcome === "miss" ? "✗" : "≈";
  $("#rvVerdictText").textContent =
    outcome === "match" ? "You matched the model"
    : outcome === "miss" ? "The model disagrees"
    : "Model has no strong call";

  /* --- gauge (sequential single hue; the number carries the value) --- */
  var C = 2 * Math.PI * 50;
  var arc = $("#gaugeArc");
  arc.style.strokeDasharray = C.toFixed(2);
  arc.style.strokeDashoffset = C.toFixed(2);
  $("#rvScore").textContent = num(res.overall) ? res.overall : "—";
  $("#gaugeSvg").setAttribute("aria-label",
    "Fundamentals score " + (num(res.overall) ? res.overall : "unavailable") + " out of 100");
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      arc.style.strokeDashoffset = (C * (1 - clamp((res.overall || 0) / 100, 0, 1))).toFixed(2);
    });
  });

  /* --- factor meters, each direct-labelled --- */
  var fx = $("#rvFactors");
  fx.innerHTML = "";
  FACTORS.forEach(function (f) {
    var val = res.factors[f.id];
    var row = el("div", "meter-row" + (num(val) ? "" : " is-na"));
    row.appendChild(el("span", "meter-label", f.label));
    var m = el("div", "meter");
    var fill = el("div", "meter-fill");
    m.appendChild(fill);
    row.appendChild(m);
    row.appendChild(el("span", "meter-val", num(val) ? String(Math.round(val)) : "n/a"));
    fx.appendChild(row);
    if (num(val)) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fill.style.width = clamp(val, 0, 100) + "%"; });
      });
    }
  });

  /* --- 52-week range --- */
  var rw = $("#rvRangeWrap");
  if (num(s.lo) && num(s.hi) && s.hi > s.lo) {
    rw.hidden = false;
    var pos = clamp((s.price - s.lo) / (s.hi - s.lo), 0, 1);
    $("#rangeLow").textContent = fmtPrice(s.lo);
    $("#rangeHigh").textContent = fmtPrice(s.hi);
    $("#rvRangePos").textContent = fmtPrice(s.price) + " · " + Math.round(pos * 100) + "% of range";
    $("#rangeFill").style.width = "0%";
    $("#rangeMarker").style.left = "0%";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        $("#rangeFill").style.width = (pos * 100) + "%";
        $("#rangeMarker").style.left = (pos * 100) + "%";
      });
    });
  } else {
    rw.hidden = true;
  }

  /* --- stat table (the accessible view of everything above) --- */
  var tb = $("#rvStats");
  tb.innerHTML = "";
  [
    ["Market cap",      fmtCap(s.mc)],
    ["Price / earnings",num(s.pe) && s.pe > 0 ? fmtNum(s.pe) : "n/a"],
    ["Price / book",    num(s.pb) && s.pb > 0 ? fmtNum(s.pb, 2) : "n/a"],
    ["Return on equity",num(s.roe) ? fmtNum(s.roe) + "%" : "n/a"],
    ["Net margin",      num(s.nm) ? fmtNum(s.nm) + "%" : "n/a"],
    ["Revenue growth",  num(s.rg) ? fmtPct(s.rg, 1) : "n/a"],
    ["EPS growth",      num(s.eg) ? fmtPct(s.eg, 1) : "n/a"],
    ["Beta",            num(s.beta) ? fmtNum(s.beta, 2) : "n/a"],
    ["Dividend yield",  num(s.dy) && s.dy > 0 ? fmtNum(s.dy, 2) + "%" : "none"],
    ["52-week return",  num(s.r52) ? fmtPct(s.r52, 1) : "n/a"]
  ].forEach(function (pair) {
    var tr = el("tr");
    var th = el("th", "", pair[0]); th.scope = "row";
    tr.appendChild(th);
    tr.appendChild(el("td", "", pair[1]));
    tb.appendChild(tr);
  });

  $("#rvWhy").textContent = explain(s, res);

  lastFocus = document.activeElement;
  revealEl.hidden = false;
  $("#btnNext").focus();
}

function closeReveal() {
  revealEl.hidden = true;
  state.busy = false;
  advance();
  if (lastFocus && lastFocus.isConnected) { try { lastFocus.focus(); } catch (e) {} }
}

/* ================================================================ CHROME === */

function renderStats() {
  $("#statPlayed").textContent = state.stats.played;
  $("#statAgree").textContent = state.stats.played
    ? Math.round(100 * state.stats.matched / state.stats.played) + "%"
    : "—";
  $("#statStreak").textContent = state.stats.streak;
  $("#statStreak").title = "Best streak: " + state.stats.best;
}

function renderBanner() {
  var b = $("#dataBanner");
  var t = $("#dataBannerText");
  var a = $("#bannerAction");
  b.hidden = false;
  if (state.live) {
    b.classList.add("is-live");
    t.textContent = "Live data from Finnhub.";
    a.textContent = "Manage key";
  } else {
    b.classList.remove("is-live");
    t.textContent = "Demo mode — these figures are placeholders, not market data.";
    a.textContent = "Connect live data";
  }
}

function setKeyProblem(msg) {
  var el2 = $("#keyStatus");
  el2.textContent = msg;
  el2.className = "key-status bad";
}

function renderKeyUI() {
  $("#apiKey").value = state.apiKey ? "•".repeat(Math.min(state.apiKey.length, 24)) : "";
  $("#btnClearKey").hidden = !state.apiKey;
  var st = $("#keyStatus");
  if (state.apiKey) {
    st.textContent = state.live ? "Connected — live quotes and fundamentals." : "Key saved. Checking…";
    st.className = "key-status " + (state.live ? "ok" : "");
  } else {
    st.textContent = "";
    st.className = "key-status";
  }
}

function renderUniverseChips() {
  var box = $("#universeChips");
  box.innerHTML = "";
  UNIVERSES.forEach(function (u) {
    var count = window.SS_UNIVERSE.stocks.filter(u.test).length;
    var b = el("button", "chip", u.label + " (" + count + ")");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(u.id === state.universe));
    b.addEventListener("click", function () {
      state.universe = u.id;
      save(LS.uni, u.id);
      renderUniverseChips();
      buildDeck();
      renderDeck();
    });
    box.appendChild(b);
  });
}

function renderList(tab) {
  var body = $("#listBody");
  body.innerHTML = "";
  var rows = state.picks.filter(function (p) { return p.call === tab; });
  $("#listEmpty").hidden = rows.length > 0;

  rows.forEach(function (p) {
    var tr = el("tr");
    var th = el("th"); th.scope = "row";
    th.appendChild(el("span", "list-tick", p.t));
    th.appendChild(el("span", "list-name", p.n));
    tr.appendChild(th);
    tr.appendChild(el("td", "", num(p.score) ? String(p.score) : "—"));
    var mark = p.outcome === "match" ? "✓ match" : p.outcome === "miss" ? "✗ miss" : "≈ push";
    tr.appendChild(el("td", "", mark));
    body.appendChild(tr);
  });
}

/* ================================================================= WIRING === */

function verifyKey() {
  if (!state.apiKey) { state.live = false; renderBanner(); renderKeyUI(); return; }
  jget("/quote?symbol=AAPL")
    .then(function (q) {
      if (!q || !num(q.c) || q.c === 0) throw new Error("bad");
      state.live = true;
      state.cache = {};
      renderBanner(); renderKeyUI();
      renderDeck();
    })
    .catch(function (err) {
      state.live = false;
      renderBanner();
      setKeyProblem(err && err.message === "auth"
        ? "Finnhub rejected that key."
        : "Couldn't reach Finnhub — staying on demo data.");
    });
}

function init() {
  buildDeck();
  renderDeck();
  renderStats();
  renderBanner();
  renderKeyUI();
  renderUniverseChips();
  renderList("bull");

  if (state.apiKey) verifyKey();

  $("#btnBull").addEventListener("click", function () { commit("bull"); });
  $("#btnPass").addEventListener("click", function () { commit("bear"); });
  $("#btnSkip").addEventListener("click", skipCard);
  $("#btnNext").addEventListener("click", closeReveal);
  $("#btnReshuffle").addEventListener("click", function () { buildDeck(); renderDeck(); });

  document.addEventListener("keydown", function (e) {
    if (e.target.matches("input, textarea")) return;
    if (!revealEl.hidden) {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape" || e.key === "ArrowRight") {
        e.preventDefault(); closeReveal();
      }
      return;
    }
    if ($("#dlgSettings").open || $("#dlgList").open) return;
    if (e.key === "ArrowRight") { e.preventDefault(); commit("bull"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); commit("bear"); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); skipCard(); }
  });

  $("#btnSettings").addEventListener("click", function () { renderKeyUI(); $("#dlgSettings").showModal(); });
  $("#bannerAction").addEventListener("click", function () { renderKeyUI(); $("#dlgSettings").showModal(); });
  $("#btnList").addEventListener("click", function () { renderList(currentTab()); $("#dlgList").showModal(); });

  $("#btnSaveKey").addEventListener("click", function () {
    var v = $("#apiKey").value.trim();
    if (!v || /^•+$/.test(v)) return;
    state.apiKey = v;
    save(LS.key, v);
    state.cache = {};
    $("#keyStatus").textContent = "Checking…";
    $("#keyStatus").className = "key-status";
    verifyKey();
  });

  $("#btnClearKey").addEventListener("click", function () {
    state.apiKey = ""; state.live = false; state.cache = {};
    drop(LS.key);
    renderKeyUI(); renderBanner(); renderDeck();
  });

  $("#btnReset").addEventListener("click", function () {
    state.stats = { played: 0, matched: 0, streak: 0, best: 0 };
    state.picks = [];
    save(LS.stats, state.stats);
    save(LS.picks, state.picks);
    renderStats(); renderList(currentTab());
    buildDeck(); renderDeck();
  });

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (x) {
        x.classList.toggle("is-on", x === t);
        x.setAttribute("aria-selected", String(x === t));
      });
      renderList(t.dataset.tab);
    });
  });

  /* Point the footer link at whichever repo this is served from. */
  var m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (m) {
    var seg = location.pathname.split("/").filter(Boolean)[0];
    $("#repoLink").href = "https://github.com/" + m[1] + (seg ? "/" + seg : "/" + m[1] + ".github.io");
  }
}

function currentTab() {
  var on = document.querySelector(".tab.is-on");
  return on ? on.dataset.tab : "bull";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();
