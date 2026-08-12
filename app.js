/* ==========================================================================
   TikStock
   Every S&P 500 company, one card at a time. The card shows the whole picture
   up front — valuation, growth, margins, balance sheet, next earnings date and
   what the company's own 10-K says — and you decide. Swipe right to put it in
   your cart, left to move on.

   No scoring model, no verdict. The pros and cons are plain thresholds applied
   to the real numbers, and each one states the number it is reacting to, so you
   can disagree with the rule and still see the fact underneath it.

   Data comes from data/snapshot.json, rebuilt every weekday morning by a GitHub
   Action (see scripts/refresh.mjs). Nothing is fetched from the browser except
   these static files.
   ========================================================================== */
(function () {
"use strict";

/* ---------------------------------------------------------------- storage */

var LS = { cart: "ts.cart", seen: "ts.seen", filter: "ts.filter" };

function load(k, fb) {
  try { var raw = localStorage.getItem(k); return raw === null ? fb : JSON.parse(raw); }
  catch (e) { return fb; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
}

var state = {
  all:     [],            /* every company from the snapshot          */
  deck:    [],            /* tickers queued for swiping               */
  cursor:  0,
  cart:    load(LS.cart, []),
  seen:    load(LS.seen, []),
  filter:  load(LS.filter, { screen: "all", sector: "all", showSeen: false }),
  byTicker: {},
  details: {},            /* lazy-loaded 10-K contents, keyed by ticker */
  updated: null,
  busy:    false
};

var seenSet = new Set(state.seen);

/* -------------------------------------------------------------- utilities */

var $ = function (s, r) { return (r || document).querySelector(s); };

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
function num(v) { return typeof v === "number" && isFinite(v); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1)), t = a[i];
    a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ------------------------------------------------------------ formatting */

function money(v, currency) {
  if (!num(v)) return "—";
  var sign = v < 0 ? "-" : "";
  var a = Math.abs(v), s;
  if (a >= 1e12)     s = (a / 1e12).toFixed(a >= 1e13 ? 1 : 2) + "T";
  else if (a >= 1e9) s = (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + "B";
  else if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
  else if (a >= 1e3) s = (a / 1e3).toFixed(0) + "K";
  else               s = a.toFixed(0);
  return sign + (currency === false ? "" : "$") + s;
}

/* Finnhub reports market cap in millions. */
function cap(v) { return num(v) ? money(v * 1e6) : "—"; }

function price(v) {
  if (!num(v)) return "—";
  var d = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function pct(v, d) {
  if (!num(v)) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(d === undefined ? 1 : d) + "%";
}
function pctPlain(v, d) { return num(v) ? v.toFixed(d === undefined ? 1 : d) + "%" : "—"; }
function x(v, d) { return num(v) ? v.toFixed(d === undefined ? 1 : d) + "×" : "—"; }

function dateShort(iso) {
  if (!iso) return "—";
  var d = new Date(iso + (iso.length === 10 ? "T12:00:00Z" : ""));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function daysUntil(iso) {
  if (!iso) return null;
  var d = new Date(iso + "T12:00:00Z");
  if (isNaN(d)) return null;
  return Math.round((d - Date.now()) / 864e5);
}

function relTime(iso) {
  if (!iso) return "never";
  var mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 90) return mins + " min ago";
  var hrs = Math.round(mins / 60);
  if (hrs < 36) return hrs + "h ago";
  return Math.round(hrs / 24) + " days ago";
}

/* Where the price sits in its 52-week band, 0–1. */
function rangePos(s) {
  if (!num(s.lo) || !num(s.hi) || s.hi <= s.lo || !num(s.price)) return null;
  return clamp((s.price - s.lo) / (s.hi - s.lo), 0, 1);
}

/* ====================================================== PROS AND CONS =====
   Plain thresholds on the reported numbers. Every line names the figure that
   triggered it, so the rule is arguable but the fact is not. Nothing here is a
   recommendation and nothing is weighted into a score.
   ======================================================================== */

function prosAndCons(s) {
  var pros = [], cons = [];
  var f = s.fin || {};
  var pos = rangePos(s);
  var add = function (arr, w, text) { arr.push({ w: w, text: text }); };

  /* ---- valuation ---- */
  if (num(s.pe) && s.pe > 0) {
    if (s.pe < 13)      add(pros, 8, "Cheap on earnings at " + x(s.pe) + " — well under the market's usual 20×.");
    else if (s.pe < 18) add(pros, 5, "Reasonably priced at " + x(s.pe) + " earnings.");
    else if (s.pe > 60) add(cons, 9, "Very expensive at " + x(s.pe) + " earnings — years of growth are already in the price.");
    else if (s.pe > 35) add(cons, 6, "Pricey at " + x(s.pe) + " earnings.");
  }
  if (num(s.pb) && s.pb > 0 && s.pb < 1.3) add(pros, 6, "Trades at " + x(s.pb, 2) + " book value — below what the balance sheet says it owns.");
  if (num(s.ps) && s.ps > 15)              add(cons, 6, "Priced at " + x(s.ps) + " sales, which leaves no room for a stumble.");

  /* ---- growth ---- */
  if (num(s.rg)) {
    if (s.rg >= 20)      add(pros, 9, "Revenue up " + pct(s.rg) + " on the year.");
    else if (s.rg >= 8)  add(pros, 6, "Revenue growing " + pct(s.rg) + " year over year.");
    else if (s.rg < -5)  add(cons, 8, "Revenue fell " + pct(s.rg) + " year over year.");
    else if (s.rg < 1)   add(cons, 5, "Revenue is flat — " + pct(s.rg) + " on the year.");
  }
  if (num(s.rg5) && s.rg5 >= 10) add(pros, 5, "Has compounded revenue at " + pctPlain(s.rg5) + " a year over five years.");
  if (num(s.eg)) {
    if (s.eg >= 25)      add(pros, 6, "Earnings per share up " + pct(s.eg) + ".");
    else if (s.eg <= -20) add(cons, 7, "Earnings per share down " + pct(s.eg) + ".");
  }

  /* ---- profitability ---- */
  if (num(s.roe)) {
    if (s.roe >= 25)     add(pros, 8, "Turns " + pctPlain(s.roe, 0) + " on shareholder equity.");
    else if (s.roe >= 15) add(pros, 5, "Solid " + pctPlain(s.roe, 0) + " return on equity.");
    else if (s.roe < 0)  add(cons, 9, "Losing money — return on equity is " + pctPlain(s.roe, 0) + ".");
    else if (s.roe < 8)  add(cons, 5, "Thin " + pctPlain(s.roe, 0) + " return on equity.");
  }
  if (num(s.nm)) {
    if (s.nm >= 20)      add(pros, 7, pctPlain(s.nm, 0) + " of revenue drops through to net profit.");
    else if (s.nm < 0)   add(cons, 9, "Unprofitable — net margin of " + pctPlain(s.nm) + ".");
    else if (s.nm < 4)   add(cons, 5, "Wafer-thin net margin of " + pctPlain(s.nm) + ".");
  }
  if (num(s.gm) && s.gm >= 55) add(pros, 4, "Gross margin of " + pctPlain(s.gm, 0) + " absorbs cost shocks.");

  /* ---- cash and balance sheet, straight from the filings ---- */
  if (num(f.fcf) && num(f.revenue) && f.revenue > 0) {
    var conv = (f.fcf / f.revenue) * 100;
    if (f.fcf > 0 && conv >= 15)  add(pros, 8, "Generated " + money(f.fcf) + " of free cash flow in FY" + f.fy + " — " + conv.toFixed(0) + "% of revenue.");
    else if (f.fcf > 0)           add(pros, 4, "Free cash flow was positive in FY" + f.fy + " at " + money(f.fcf) + ".");
    else if (f.fcf < -1e6)        add(cons, 8, "Burned " + money(Math.abs(f.fcf)) + " of free cash in FY" + f.fy + ".");
  }
  if (num(f.cash) && num(f.debt)) {
    if (f.cash > f.debt)          add(pros, 7, "Holds more cash (" + money(f.cash) + ") than long-term debt (" + money(f.debt) + ").");
    else if (f.debt > f.cash * 5) add(cons, 6, "Long-term debt of " + money(f.debt) + " against " + money(f.cash) + " of cash.");
  }
  if (num(s.de)) {
    if (s.de < 0.4)      add(pros, 5, "Barely leveraged — debt is " + x(s.de, 2) + " equity.");
    else if (s.de > 2.5) add(cons, 7, "Heavily leveraged — debt is " + x(s.de, 1) + " equity.");
  }
  if (num(s.cr)) {
    if (s.cr >= 2)   add(pros, 3, "Current assets cover near-term bills " + x(s.cr, 1) + " over.");
    else if (s.cr < 1) add(cons, 6, "Current liabilities exceed current assets (ratio " + s.cr.toFixed(2) + ").");
  }

  /* ---- dividend ---- */
  if (num(s.dy) && s.dy > 0) {
    if (s.dy > 8)                       add(cons, 6, "An " + pctPlain(s.dy) + " yield is usually the market pricing in a cut.");
    else if (s.dy >= 2.5)               add(pros, 6, "Pays a " + pctPlain(s.dy) + " dividend while you wait.");
    else if (s.dy >= 1)                 add(pros, 3, "Pays a modest " + pctPlain(s.dy) + " dividend.");
    if (num(s.payout) && s.payout > 90) add(cons, 5, "Dividend eats " + pctPlain(s.payout, 0) + " of earnings — little cushion.");
  }

  /* ---- price behaviour ---- */
  if (pos !== null) {
    if (pos <= 0.2)      add(pros, 5, "Sits near the bottom of its 52-week range, " + Math.round((1 - s.price / s.hi) * 100) + "% off the high.");
    else if (pos >= 0.95) add(cons, 4, "Within " + Math.max(1, Math.round((1 - s.price / s.hi) * 100)) + "% of its 52-week high.");
  }
  if (num(s.beta)) {
    if (s.beta < 0.8)     add(pros, 4, "Moves less than the market (beta " + s.beta.toFixed(2) + ").");
    else if (s.beta > 1.6) add(cons, 5, "Swings harder than the market (beta " + s.beta.toFixed(2) + ").");
  }
  if (num(s.r52)) {
    if (s.r52 <= -25)     add(cons, 6, "Down " + pct(s.r52) + " over the past year.");
    else if (s.r52 >= 40) add(pros, 3, "Up " + pct(s.r52) + " over the past year.");
  }

  var byWeight = function (a, b) { return b.w - a.w; };
  return {
    pros: pros.sort(byWeight).slice(0, 6).map(function (p) { return p.text; }),
    cons: cons.sort(byWeight).slice(0, 6).map(function (p) { return p.text; })
  };
}

/* ============================================================ SCREENS ==== */

var SCREENS = [
  { id: "all",      label: "Everything",      test: function () { return true; } },
  { id: "cheap",    label: "Low P/E",         test: function (s) { return num(s.pe) && s.pe > 0 && s.pe < 15; } },
  { id: "growth",   label: "Fast growing",    test: function (s) { return num(s.rg) && s.rg >= 15; } },
  { id: "quality",  label: "High margin",     test: function (s) { return num(s.nm) && s.nm >= 18; } },
  { id: "income",   label: "Pays 2%+",        test: function (s) { return num(s.dy) && s.dy >= 2; } },
  { id: "cashrich", label: "Net cash",        test: function (s) { return num(s.fin && s.fin.cash) && num(s.fin.debt) && s.fin.cash > s.fin.debt; } },
  { id: "dip",      label: "Near 52wk low",   test: function (s) { var p = rangePos(s); return p !== null && p <= 0.25; } },
  { id: "soon",     label: "Earnings < 30d",  test: function (s) { var d = s.earnings && daysUntil(s.earnings.date); return d !== null && d >= 0 && d <= 30; } },
  { id: "mega",     label: "Mega caps",       test: function (s) { return num(s.mc) && s.mc >= 200000; } }
];

function screenById(id) {
  for (var i = 0; i < SCREENS.length; i++) if (SCREENS[i].id === id) return SCREENS[i];
  return SCREENS[0];
}

/* ============================================================== DATA ===== */

function loadSnapshot() {
  return fetch("data/snapshot.json", { cache: "no-cache" })
    .then(function (r) {
      if (r.status === 404) throw new Error("missing");
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    })
    .then(function (snap) {
      if (!snap || !Array.isArray(snap.stocks) || !snap.stocks.length) throw new Error("empty");
      state.all = snap.stocks;
      state.updated = snap.updated;
      state.all.forEach(function (s) { state.byTicker[s.t] = s; });
      return snap;
    });
}

/* 10-K prose is one small file per company, fetched only when its card renders. */
function loadDetail(ticker) {
  if (state.details[ticker] !== undefined) return Promise.resolve(state.details[ticker]);
  var safe = ticker.replace(/[^A-Z0-9.]/gi, "_");
  return fetch("data/filings/" + encodeURIComponent(safe) + ".json", { cache: "force-cache" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var d = (j && j.detail) || null;
      state.details[ticker] = d;
      return d;
    })
    .catch(function () { state.details[ticker] = null; return null; });
}

/* ============================================================== DECK ===== */

var deckEl   = $("#deckEl");
var deckMsg  = $("#deckMsg");
var VISIBLE  = 2;
var cards    = [];          /* [{node, ticker, depth}], top first */

function buildDeck() {
  var scr = screenById(state.filter.screen);
  var pool = state.all.filter(function (s) {
    if (state.filter.sector !== "all" && s.s !== state.filter.sector) return false;
    if (!state.filter.showSeen && seenSet.has(s.t)) return false;
    return scr.test(s);
  });
  state.deck = shuffle(pool.map(function (s) { return s.t; }));
  state.cursor = 0;
}

function showMessage(title, body, actions) {
  deckMsg.hidden = false;
  $("#msgTitle").textContent = title;
  $("#msgBody").innerHTML = body;
  var box = $("#msgActions");
  box.innerHTML = "";
  (actions || []).forEach(function (a) {
    var b = el("button", a.kind === "link" ? "link-btn" : "primary-btn", a.label);
    b.type = "button";
    b.addEventListener("click", a.onClick);
    box.appendChild(b);
  });
}

function renderDeck() {
  cards.forEach(function (c) { c.node.remove(); });
  cards = [];

  var remaining = state.deck.length - state.cursor;
  $("#btnSkip").disabled = $("#btnAdd").disabled = remaining === 0;
  $("#deckPos").textContent = remaining
    ? (state.cursor + 1) + " of " + state.deck.length
    : "0 left";

  if (remaining === 0) {
    var seenCount = seenSet.size;
    showMessage(
      "Nothing left in this filter",
      "You have been through every company matching it. There are <b>" + state.all.length +
      "</b> in the deck overall and you have swiped <b>" + seenCount + "</b>.",
      [
        { label: "Change the filter", onClick: function () { openDialog($("#dlgFilter")); } },
        { label: "Show swiped companies again", kind: "link", onClick: function () {
            state.filter.showSeen = true; save(LS.filter, state.filter);
            $("#showSeen").checked = true;
            buildDeck(); renderDeck();
        } }
      ]
    );
    return;
  }

  deckMsg.hidden = true;

  var n = Math.min(VISIBLE, remaining);
  for (var depth = n - 1; depth >= 0; depth--) {
    var ticker = state.deck[state.cursor + depth];
    var node = makeCard(state.byTicker[ticker], depth);
    deckEl.appendChild(node);
    cards.unshift({ node: node, ticker: ticker, depth: depth });
  }
  attachDrag(cards[0]);
}

function stackTransform(depth) {
  return "translateY(" + (depth * -10) + "px) scale(" + (1 - depth * 0.03) + ")";
}

/* --------------------------------------------------------- card contents */

function statRow(label, value, hint) {
  var d = el("div", "stat");
  d.appendChild(el("dt", "", label));
  var dd = el("dd", "", value);
  if (hint) dd.title = hint;
  d.appendChild(dd);
  return d;
}

function makeCard(s, depth) {
  var card = el("article", "card");
  card.style.transform = stackTransform(depth);
  card.style.zIndex = String(50 - depth);
  card.setAttribute("aria-hidden", depth > 0 ? "true" : "false");
  if (depth > 0) card.classList.add("is-behind");

  card.innerHTML =
    '<div class="stamp add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>In cart</div>' +
    '<div class="stamp pass"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Pass</div>' +
    '<div class="card-scroll"></div>';

  var body = $(".card-scroll", card);
  if (!s) { body.appendChild(el("p", "", "Missing data.")); return card; }

  /* ---------- identity ---------- */
  var top = el("header", "c-top");
  var mark = el("div", "c-mark", (s.n || s.t).trim().charAt(0).toUpperCase());
  var idb = el("div", "c-id");
  idb.appendChild(el("h2", "c-ticker", s.t));
  idb.appendChild(el("p", "c-name", s.n));
  idb.appendChild(el("span", "c-sector", s.s));
  top.appendChild(mark);
  top.appendChild(idb);
  body.appendChild(top);

  /* ---------- price ---------- */
  var pr = el("div", "c-price");
  pr.appendChild(el("div", "c-price-v", price(s.price)));
  var dir = !num(s.change) ? "flat" : s.change > 0.005 ? "up" : s.change < -0.005 ? "down" : "flat";
  var delta = el("div", "delta " + dir);
  delta.appendChild(el("span", "arrow", dir === "up" ? "▲" : dir === "down" ? "▼" : "–"));
  delta.appendChild(el("span", "", num(s.change) ? pct(s.change, 2) + " today" : "no change data"));
  pr.appendChild(delta);
  var mcTag = el("span", "c-cap", cap(s.mc) + " market cap");
  pr.appendChild(mcTag);
  body.appendChild(pr);

  /* ---------- 52-week range ---------- */
  var pos = rangePos(s);
  if (pos !== null) {
    var rw = el("div", "c-range");
    var head = el("div", "c-range-head");
    head.appendChild(el("span", "", "52-week range"));
    head.appendChild(el("span", "", Math.round(pos * 100) + "% of the way up"));
    rw.appendChild(head);
    var bar = el("div", "rangebar");
    bar.innerHTML = '<div class="rangebar-track"></div><div class="rangebar-fill"></div>' +
                    '<div class="rangebar-marker"><span class="rangebar-dot"></span></div>';
    $(".rangebar-fill", bar).style.width = (pos * 100) + "%";
    $(".rangebar-marker", bar).style.left = (pos * 100) + "%";
    rw.appendChild(bar);
    var ends = el("div", "c-range-ends");
    ends.appendChild(el("span", "", price(s.lo)));
    ends.appendChild(el("span", "", price(s.hi)));
    rw.appendChild(ends);
    body.appendChild(rw);
  }

  /* ---------- next earnings ---------- */
  var e = s.earnings;
  var eb = el("div", "c-earnings");
  if (e && e.date) {
    var d = daysUntil(e.date);
    var when = d === null ? "" : d < 0 ? "just reported" : d === 0 ? "today" : d === 1 ? "tomorrow" : "in " + d + " days";
    if (d !== null && d >= 0 && d <= 14) eb.classList.add("is-soon");
    eb.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>' +
      '<span><b>Next earnings ' + when + '</b> — ' + dateShort(e.date) +
      (e.hour ? ' (' + (e.hour === "bmo" ? "before the open" : e.hour === "amc" ? "after the close" : e.hour) + ')' : '') +
      (num(e.epsEst) ? ' · street expects ' + (e.epsEst < 0 ? "-" : "") + "$" + Math.abs(e.epsEst).toFixed(2) + ' EPS' : '') +
      '</span>';
  } else {
    eb.classList.add("is-muted");
    eb.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>' +
      '<span>No earnings date scheduled in the next few months.</span>';
  }
  body.appendChild(eb);

  /* ---------- pros and cons ---------- */
  var pc = prosAndCons(s);
  var pcWrap = el("div", "c-pc");

  function column(kind, title, items, glyph) {
    var col = el("section", "pc-col " + kind);
    var h = el("h3", "");
    h.appendChild(el("span", "pc-glyph", glyph));
    h.appendChild(el("span", "", title));
    col.appendChild(h);
    if (!items.length) {
      col.appendChild(el("p", "pc-none", kind === "pro"
        ? "Nothing in the numbers stands out as a strength."
        : "Nothing in the numbers stands out as a concern."));
    } else {
      var ul = el("ul", "");
      items.forEach(function (t) { ul.appendChild(el("li", "", t)); });
      col.appendChild(ul);
    }
    return col;
  }
  pcWrap.appendChild(column("pro", "In its favour", pc.pros, "+"));
  pcWrap.appendChild(column("con", "Against it", pc.cons, "−"));
  body.appendChild(pcWrap);

  /* ---------- the numbers ---------- */
  var sec1 = el("section", "c-block");
  sec1.appendChild(el("h3", "block-h", "The numbers"));
  var grid = el("dl", "c-stats");
  [
    ["P/E",           num(s.pe) && s.pe > 0 ? x(s.pe) : "n/a"],
    ["Price / book",  num(s.pb) && s.pb > 0 ? x(s.pb, 2) : "n/a"],
    ["Price / sales", num(s.ps) && s.ps > 0 ? x(s.ps, 1) : "n/a"],
    ["Rev. growth",   pct(s.rg)],
    ["EPS growth",    pct(s.eg)],
    ["Gross margin",  pctPlain(s.gm, 0)],
    ["Op. margin",    pctPlain(s.om, 0)],
    ["Net margin",    pctPlain(s.nm, 0)],
    ["ROE",           pctPlain(s.roe, 0)],
    ["Debt/equity",   num(s.de) ? x(s.de, 2) : "n/a"],
    ["Current ratio", num(s.cr) ? s.cr.toFixed(2) : "n/a"],
    ["Div. yield",    num(s.dy) && s.dy > 0 ? pctPlain(s.dy, 2) : "none"],
    ["Beta",          num(s.beta) ? s.beta.toFixed(2) : "n/a"],
    ["3mo return",    pct(s.r13)],
    ["1yr return",    pct(s.r52)]
  ].forEach(function (p) { grid.appendChild(statRow(p[0], p[1])); });
  sec1.appendChild(grid);
  body.appendChild(sec1);

  /* ---------- from the annual report ---------- */
  var f = s.fin || {};
  if (num(f.revenue) || num(f.assets)) {
    var sec2 = el("section", "c-block");
    sec2.appendChild(el("h3", "block-h", "Last full year, as filed (FY" + f.fy + ")"));
    var g2 = el("dl", "c-stats");
    var revDelta = num(f.revenue) && num(f.revenuePrev) && f.revenuePrev !== 0
      ? ((f.revenue - f.revenuePrev) / Math.abs(f.revenuePrev)) * 100 : null;
    [
      ["Revenue",        money(f.revenue) + (revDelta !== null ? "  (" + pct(revDelta, 0) + ")" : "")],
      ["Net income",     money(f.netIncome)],
      ["Operating cash", money(f.ocf)],
      ["Capex",          money(f.capex)],
      ["Free cash flow", money(f.fcf)],
      ["Cash on hand",   money(f.cash)],
      ["Long-term debt", money(f.debt)],
      ["Total equity",   money(f.equity)]
    ].forEach(function (p) { g2.appendChild(statRow(p[0], p[1])); });
    sec2.appendChild(g2);
    sec2.appendChild(el("p", "block-note", "Pulled from the company's XBRL filings on SEC EDGAR."));
    body.appendChild(sec2);
  }

  /* ---------- the 10-K itself ---------- */
  var sec3 = el("section", "c-block c-filing");
  sec3.appendChild(el("h3", "block-h", "Straight from the 10-K"));
  var slot = el("div", "filing-slot");
  slot.appendChild(el("p", "block-note", "Loading the filing…"));
  sec3.appendChild(slot);

  var links = el("div", "filing-links");
  if (s.sec && s.sec.tenK && s.sec.tenK.url) {
    var a1 = el("a", "filing-link", "Read the 10-K (filed " + dateShort(s.sec.tenK.date) + ")");
    a1.href = s.sec.tenK.url; a1.target = "_blank"; a1.rel = "noopener";
    links.appendChild(a1);
  }
  if (s.sec && s.sec.tenQ && s.sec.tenQ.url) {
    var a2 = el("a", "filing-link", "Latest 10-Q (" + dateShort(s.sec.tenQ.date) + ")");
    a2.href = s.sec.tenQ.url; a2.target = "_blank"; a2.rel = "noopener";
    links.appendChild(a2);
  }
  var a3 = el("a", "filing-link", "All filings on EDGAR");
  a3.href = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + (s.cik || s.t) + "&type=10-K&dateb=&owner=include&count=40";
  a3.target = "_blank"; a3.rel = "noopener";
  links.appendChild(a3);
  sec3.appendChild(links);
  body.appendChild(sec3);

  if (s.sec && s.sec.detail) {
    loadDetail(s.t).then(function (d) {
      if (!card.isConnected) return;
      slot.innerHTML = "";
      if (!d) { slot.appendChild(el("p", "block-note", "Couldn't parse this filing — use the link below.")); return; }

      if (d.business) {
        var bh = el("h4", "sub-h", "What the company says it does");
        slot.appendChild(bh);
        slot.appendChild(el("p", "filing-text", d.business));
      }
      if (d.risks && d.risks.length) {
        var rh = el("h4", "sub-h", "Risk factors it lists");
        slot.appendChild(rh);
        var ul = el("ul", "risk-list");
        d.risks.slice(0, 5).forEach(function (r) { ul.appendChild(el("li", "", r)); });
        slot.appendChild(ul);
        if (d.risks.length > 5) {
          var more = el("button", "link-btn", "Show " + (d.risks.length - 5) + " more risk factors");
          more.type = "button";
          more.addEventListener("click", function () {
            d.risks.slice(5).forEach(function (r) { ul.appendChild(el("li", "", r)); });
            more.remove();
          });
          slot.appendChild(more);
        }
      }
      if (!d.business && !(d.risks || []).length) {
        slot.appendChild(el("p", "block-note", "Nothing extractable from this filing — open it directly below."));
      }
    });
  } else {
    slot.innerHTML = "";
    slot.appendChild(el("p", "block-note",
      s.sec && s.sec.tenK
        ? "The text of this 10-K hasn't been parsed yet — open it directly below."
        : "No 10-K on file for this ticker."));
  }

  /* ---------- scroll affordance ---------- */
  var fade = el("div", "card-fade");
  card.appendChild(fade);
  body.addEventListener("scroll", function () {
    fade.style.opacity = body.scrollTop + body.clientHeight >= body.scrollHeight - 24 ? "0" : "1";
  }, { passive: true });

  return card;
}

/* --------------------------------------------------------------- swiping */

var drag = null;

function attachDrag(entry) {
  if (!entry) return;
  var card = entry.node;
  var scroller = $(".card-scroll", card);
  var stampAdd = $(".stamp.add", card);
  var stampPass = $(".stamp.pass", card);

  card.addEventListener("pointerdown", function (ev) {
    if (state.busy) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    if (ev.target.closest("a, button")) return;      /* let links and buttons work */
    drag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: 0, axis: null, t0: Date.now() };
  });

  card.addEventListener("pointermove", function (ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;

    /* Decide once whether this gesture is a scroll or a swipe. */
    if (drag.axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
      if (drag.axis === "x") {
        card.setPointerCapture(drag.id);
        card.classList.add("is-drag");
        scroller.style.overflowY = "hidden";
      } else {
        drag = null;                                  /* hand it back to the scroller */
        return;
      }
    }

    drag.dx = dx;
    card.style.transform = "translate(" + dx + "px," + (dy * 0.18) + "px) rotate(" + clamp(dx / 22, -10, 10) + "deg)";
    var t = clamp(Math.abs(dx) / 120, 0, 1);
    stampAdd.style.opacity = dx > 0 ? t : 0;
    stampPass.style.opacity = dx < 0 ? t : 0;
  });

  function release(ev) {
    if (!drag || (ev.pointerId !== undefined && ev.pointerId !== drag.id)) return;
    var dx = drag.dx, axis = drag.axis;
    var speed = Math.abs(dx) / Math.max(1, Date.now() - drag.t0);
    drag = null;
    card.classList.remove("is-drag");
    scroller.style.overflowY = "";
    if (axis !== "x") return;

    if (Math.abs(dx) > 110 || (Math.abs(dx) > 55 && speed > 0.6)) {
      commit(dx > 0 ? "add" : "pass");
    } else {
      card.classList.add("is-settling");
      card.style.transform = stackTransform(0);
      stampAdd.style.opacity = stampPass.style.opacity = 0;
      setTimeout(function () { card.classList.remove("is-settling"); }, 300);
    }
  }
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);
}

function commit(action) {
  if (state.busy) return;
  var entry = cards[0];
  if (!entry) return;
  state.busy = true;

  var s = state.byTicker[entry.ticker];
  if (action === "add") addToCart(s);

  if (!seenSet.has(entry.ticker)) {
    seenSet.add(entry.ticker);
    state.seen.push(entry.ticker);
    save(LS.seen, state.seen);
  }

  var dirSign = action === "add" ? 1 : -1;
  var card = entry.node;
  $(".stamp." + action, card).style.opacity = 1;
  card.classList.add("is-gone");
  card.style.transform = "translate(" + (dirSign * (window.innerWidth * 0.9 + 200)) + "px, 30px) rotate(" +
                         (dirSign * 16) + "deg)";

  for (var i = 1; i < cards.length; i++) {
    var c = cards[i];
    c.depth -= 1;
    c.node.style.transition = "transform .3s cubic-bezier(.22,1,.36,1)";
    c.node.style.transform = stackTransform(c.depth);
    c.node.classList.toggle("is-behind", c.depth > 0);
    c.node.setAttribute("aria-hidden", c.depth > 0 ? "true" : "false");
  }

  setTimeout(function () {
    state.busy = false;
    state.cursor += 1;
    renderDeck();
  }, 300);
}

/* ============================================================== CART ===== */

function addToCart(s) {
  if (!s) return;
  var existing = state.cart.filter(function (c) { return c.t === s.t; })[0];
  if (existing) { flashCart(); return; }
  state.cart.unshift({
    t: s.t, n: s.n, sector: s.s,
    addedAt: new Date().toISOString(),
    priceAtAdd: num(s.price) ? s.price : null,
    note: ""
  });
  save(LS.cart, state.cart);
  renderCartCount();
  flashCart();
}

function flashCart() {
  var b = $("#btnCart");
  b.classList.remove("bump");
  void b.offsetWidth;
  b.classList.add("bump");
}

function renderCartCount() {
  $("#cartCount").textContent = state.cart.length;
  $("#btnCart").classList.toggle("has-items", state.cart.length > 0);
}

function renderCart() {
  var list = $("#cartList");
  list.innerHTML = "";
  $("#cartEmpty").hidden = state.cart.length > 0;
  $("#cartFoot").hidden = state.cart.length === 0;

  var moves = [];

  state.cart.forEach(function (item, idx) {
    var live = state.byTicker[item.t];
    var now = live && num(live.price) ? live.price : null;
    var move = now !== null && num(item.priceAtAdd) && item.priceAtAdd > 0
      ? ((now - item.priceAtAdd) / item.priceAtAdd) * 100 : null;
    if (move !== null) moves.push(move);

    var row = el("div", "cart-item");

    var head = el("div", "ci-head");
    var idb = el("div", "ci-id");
    idb.appendChild(el("span", "ci-ticker", item.t));
    idb.appendChild(el("span", "ci-name", item.n));
    head.appendChild(idb);

    var priceBox = el("div", "ci-prices");
    priceBox.appendChild(el("span", "ci-now", price(now)));
    if (move !== null) {
      var dir = move > 0.05 ? "up" : move < -0.05 ? "down" : "flat";
      var mv = el("span", "delta small " + dir);
      mv.appendChild(el("span", "arrow", dir === "up" ? "▲" : dir === "down" ? "▼" : "–"));
      mv.appendChild(el("span", "", pct(move) + " since you added it"));
      priceBox.appendChild(mv);
    }
    head.appendChild(priceBox);

    var rm = el("button", "icon-btn small", null);
    rm.type = "button";
    rm.setAttribute("aria-label", "Remove " + item.t + " from cart");
    rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    rm.addEventListener("click", function () {
      state.cart.splice(idx, 1);
      save(LS.cart, state.cart);
      renderCart(); renderCartCount();
    });
    head.appendChild(rm);
    row.appendChild(head);

    var meta = el("p", "ci-meta");
    meta.textContent = "Added " + dateShort(item.addedAt.slice(0, 10)) + " at " + price(item.priceAtAdd) +
      (live && live.earnings && live.earnings.date ? " · reports " + dateShort(live.earnings.date) : "");
    row.appendChild(meta);

    var note = el("textarea", "ci-note");
    note.rows = 2;
    note.placeholder = "Why did this one interest you?";
    note.value = item.note || "";
    note.addEventListener("input", function () {
      item.note = note.value.slice(0, 600);
      save(LS.cart, state.cart);
    });
    row.appendChild(note);

    list.appendChild(row);
  });

  var summary = "";
  if (state.cart.length) {
    summary = state.cart.length + (state.cart.length === 1 ? " company" : " companies");
    if (moves.length) {
      var avg = moves.reduce(function (a, b) { return a + b; }, 0) / moves.length;
      summary += " · " + pct(avg) + " average move since added";
    }
  }
  $("#cartSummary").textContent = summary;
}

function exportCsv() {
  var rows = [["ticker", "company", "sector", "added", "price_at_add", "price_now", "change_pct", "note"]];
  state.cart.forEach(function (i) {
    var live = state.byTicker[i.t];
    var now = live && num(live.price) ? live.price : "";
    var chg = now !== "" && num(i.priceAtAdd) && i.priceAtAdd > 0
      ? (((now - i.priceAtAdd) / i.priceAtAdd) * 100).toFixed(2) : "";
    rows.push([i.t, i.n, i.sector || "", i.addedAt.slice(0, 10),
               num(i.priceAtAdd) ? i.priceAtAdd : "", now, chg, i.note || ""]);
  });
  var csv = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
  }).join("\n");

  var url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  var a = document.createElement("a");
  a.href = url;
  a.download = "tikstock-cart-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

/* ============================================================ FILTERS ==== */

function renderFilterUI() {
  var screens = $("#screenChips");
  screens.innerHTML = "";
  SCREENS.forEach(function (sc) {
    var count = state.all.filter(sc.test).length;
    var b = el("button", "chip", sc.label + " (" + count + ")");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(sc.id === state.filter.screen));
    b.addEventListener("click", function () {
      state.filter.screen = sc.id;
      save(LS.filter, state.filter);
      renderFilterUI(); updateFilterLabel(); buildDeck(); renderDeck();
    });
    screens.appendChild(b);
  });

  var sectors = ["all"].concat(
    Object.keys(state.all.reduce(function (acc, s) { acc[s.s] = 1; return acc; }, {})).sort()
  );
  var box = $("#sectorChips");
  box.innerHTML = "";
  sectors.forEach(function (sec) {
    var count = sec === "all" ? state.all.length : state.all.filter(function (s) { return s.s === sec; }).length;
    var b = el("button", "chip", (sec === "all" ? "Every sector" : sec) + " (" + count + ")");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(sec === state.filter.sector));
    b.addEventListener("click", function () {
      state.filter.sector = sec;
      save(LS.filter, state.filter);
      renderFilterUI(); updateFilterLabel(); buildDeck(); renderDeck();
    });
    box.appendChild(b);
  });
}

function updateFilterLabel() {
  var parts = [];
  if (state.filter.screen !== "all") parts.push(screenById(state.filter.screen).label);
  if (state.filter.sector !== "all") parts.push(state.filter.sector);
  $("#filterLabel").textContent = parts.length ? parts.join(" · ") : "All " + state.all.length;
}

function renderSearch(q) {
  var box = $("#searchResults");
  box.innerHTML = "";
  q = (q || "").trim().toLowerCase();
  if (q.length < 1) return;
  var hits = state.all.filter(function (s) {
    return s.t.toLowerCase().indexOf(q) === 0 || s.n.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 8);
  if (!hits.length) { box.appendChild(el("p", "empty-note", "No match in the S&P 500.")); return; }
  hits.forEach(function (s) {
    var b = el("button", "search-hit");
    b.type = "button";
    b.innerHTML = '<b>' + s.t + '</b><span>' + s.n + '</span>';
    b.addEventListener("click", function () {
      /* put this company at the front of the current deck */
      state.deck = [s.t].concat(state.deck.filter(function (t) { return t !== s.t; }));
      state.cursor = 0;
      renderDeck();
      closeDialog($("#dlgFilter"));
    });
    box.appendChild(b);
  });
}

/* ============================================================== CHROME === */

function openDialog(dlg) { if (!dlg.open) dlg.showModal(); }
function closeDialog(dlg) { if (dlg.open) dlg.close(); }

function renderDataAge() {
  var el2 = $("#dataAge");
  if (!state.updated) { el2.textContent = "no data yet"; return; }
  el2.textContent = "data " + relTime(state.updated);
  el2.title = "Snapshot built " + new Date(state.updated).toLocaleString();
}

function setupScreen(reason) {
  var repo = repoUrl();
  showMessage(
    "No data yet",
    reason === "missing"
      ? "The daily refresh hasn't run, so there is nothing to show. It needs a free " +
        "<a href='https://finnhub.io/register' target='_blank' rel='noopener'>Finnhub</a> API key " +
        "stored as the repository secret <code>FINNHUB_TOKEN</code>. Once that's set, run the " +
        "<b>Refresh market data</b> workflow and this page fills in."
      : "The snapshot exists but is empty — check the workflow logs in the Actions tab.",
    [
      { label: "Open the Actions tab", onClick: function () { window.open(repo + "/actions", "_blank", "noopener"); } },
      { label: "Set up the key", kind: "link", onClick: function () {
          window.open(repo + "/settings/secrets/actions/new", "_blank", "noopener");
      } }
    ]
  );
  $("#btnSkip").disabled = $("#btnAdd").disabled = true;
  $("#deckPos").textContent = "—";
}

function repoUrl() {
  var m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return "https://github.com";
  var seg = location.pathname.split("/").filter(Boolean)[0];
  return "https://github.com/" + m[1] + (seg ? "/" + seg : "/" + m[1] + ".github.io");
}

/* ================================================================ INIT === */

function wire() {
  $("#btnAdd").addEventListener("click", function () { commit("add"); });
  $("#btnSkip").addEventListener("click", function () { commit("pass"); });

  $("#btnCart").addEventListener("click", function () { renderCart(); openDialog($("#dlgCart")); });
  $("#btnFilter").addEventListener("click", function () { openDialog($("#dlgFilter")); });

  Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (b) {
    b.addEventListener("click", function () { closeDialog(b.closest("dialog")); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("dialog"), function (d) {
    d.addEventListener("click", function (ev) { if (ev.target === d) closeDialog(d); });
  });

  $("#btnExport").addEventListener("click", exportCsv);
  $("#btnClearCart").addEventListener("click", function () {
    if (!state.cart.length) return;
    state.cart = [];
    save(LS.cart, state.cart);
    renderCart(); renderCartCount();
  });

  $("#showSeen").addEventListener("change", function () {
    state.filter.showSeen = this.checked;
    save(LS.filter, state.filter);
    buildDeck(); renderDeck();
  });
  $("#btnResetSeen").addEventListener("click", function () {
    state.seen = []; seenSet = new Set();
    save(LS.seen, state.seen);
    buildDeck(); renderDeck();
  });

  var search = $("#searchBox");
  search.addEventListener("input", function () { renderSearch(search.value); });

  document.addEventListener("keydown", function (ev) {
    if (ev.target.matches("input, textarea")) return;
    if (document.querySelector("dialog[open]")) return;
    if (ev.key === "ArrowRight") { ev.preventDefault(); commit("add"); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); commit("pass"); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      var sc = cards[0] && $(".card-scroll", cards[0].node);
      if (sc) { ev.preventDefault(); sc.scrollBy({ top: ev.key === "ArrowDown" ? 220 : -220, behavior: "smooth" }); }
    }
  });

  $("#repoLink").href = repoUrl();
}

function init() {
  wire();
  renderCartCount();
  $("#showSeen").checked = !!state.filter.showSeen;
  showMessage("Loading the S&P 500…", "Pulling the latest snapshot.", []);

  loadSnapshot()
    .catch(function (err) {
      /* only data problems land on the setup screen — a render bug should throw */
      console.warn("snapshot:", err);
      renderDataAge();
      setupScreen(err && err.message === "missing" ? "missing" : "empty");
      return null;
    })
    .then(function (snap) {
      if (!snap) return;
      renderDataAge();
      setInterval(renderDataAge, 60000);
      renderFilterUI();
      updateFilterLabel();
      buildDeck();
      renderDeck();
    });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
