/* ==========================================================================
   StockOrNot
   Every S&P 500 company, one card at a time. The card shows the whole picture
   up front — valuation, growth, margins, balance sheet, next earnings date and
   what the company's own 10-K says — and you decide. Swipe right to put it in
   your cart, left to move on.

   The score is a weighted blend of five factor curves over reported figures,
   and the pros and cons are thresholds that name the number that set them off.
   Neither predicts anything; both are shown with the raw figures beside them.

   Data comes from data/snapshot.json, rebuilt every weekday morning by a GitHub
   Action (see scripts/refresh.mjs). Nothing is fetched from the browser except
   these static files.
   ========================================================================== */
import {
  num, clamp, money, cap, price, pct, pctPlain, x, dateShort, rangePos,
  FACTORS, scoreStock, scoreLabel, prosAndCons,
  splitAdjustShares, shareCountNote
} from "./lib/analysis.mjs";
import * as auth from "./lib/auth.mjs";

/* ---------------------------------------------------------------- storage */

var LS = { cart: "ts.cart", seen: "ts.seen" };

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
  showSeen: false,        /* set only by the end-of-deck prompt, never saved */
  byTicker: {},
  details: {},            /* lazy-loaded 10-K contents, keyed by ticker */
  updated: null,
  user:    null,          /* set once auth resolves; null means signed out */
  authPending: false,     /* true while we are still finding out */
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
function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1)), t = a[i];
    a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* -------------------------------------------- local formatting helpers ---
   Everything shared with the static page builder lives in lib/analysis.mjs;
   these two are only meaningful in a live page. */

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
  /* The only rule left: a company you have already swiped does not come back
     until you ask for it. Everything else is in the deck, in random order. */
  var pool = state.all.filter(function (s) {
    return state.showSeen || !seenSet.has(s.t);
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

  if (remaining === 0) {
    showMessage(
      "That is all " + state.all.length + " of them",
      "You have been through the whole index. Your cart is still there.",
      [
        { label: "Go through them again", onClick: function () {
            state.seen = []; seenSet = new Set();
            save(LS.seen, state.seen);
            state.showSeen = false;
            buildDeck(); renderDeck();
        } },
        { label: "Show the ones I passed on", kind: "link", onClick: function () {
            state.showSeen = true;
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

/* The score as a ring. Deliberately small on the card — it sits beside the
   numbers rather than on top of them, and the factor bars behind it are one
   tap away in the detail sheet. */
function scoreRing(res, big) {
  var v = res.overall;
  var lab = scoreLabel(v);
  var wrap = el("div", "score-ring" + (big ? " is-big" : "") + " tone-" + lab.tone);
  var C = 2 * Math.PI * 19;

  wrap.innerHTML =
    '<svg viewBox="0 0 44 44" aria-hidden="true">' +
      '<circle class="sr-track" cx="22" cy="22" r="19"></circle>' +
      '<circle class="sr-arc" cx="22" cy="22" r="19"></circle>' +
    '</svg>' +
    '<span class="sr-num"></span>';

  $(".sr-num", wrap).textContent = num(v) ? v : "—";
  var arc = $(".sr-arc", wrap);
  arc.style.strokeDasharray = C.toFixed(1);
  arc.style.strokeDashoffset = (C * (1 - clamp((v || 0) / 100, 0, 1))).toFixed(1);

  var cap2 = el("span", "sr-label", lab.word);
  var box = el("div", "score-box");
  box.appendChild(wrap);
  box.appendChild(cap2);
  box.title = num(v)
    ? "Fundamentals score " + v + " out of 100, " + lab.word.toLowerCase()
    : "Not enough reported data to score this one";
  return box;
}

function factorBars(res) {
  var box = el("div", "factor-list");
  FACTORS.forEach(function (f) {
    var val = res.factors[f.id];
    var row = el("div", "factor-row" + (num(val) ? "" : " is-na"));
    var lab = el("div", "factor-label");
    lab.appendChild(el("span", "fl-name", f.label));
    lab.appendChild(el("span", "fl-blurb", f.blurb));
    row.appendChild(lab);
    var meter = el("div", "factor-meter");
    var fill = el("div", "factor-fill");
    if (num(val)) fill.style.width = clamp(val, 0, 100) + "%";
    meter.appendChild(fill);
    row.appendChild(meter);
    row.appendChild(el("span", "factor-val", num(val) ? String(Math.round(val)) : "n/a"));
    box.appendChild(row);
  });
  return box;
}

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
  var res = scoreStock(s);
  top.appendChild(scoreRing(res, false));
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
      '<span><b>Next earnings ' + when + '</b> on ' + dateShort(e.date) +
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

  /* The card shows at most four of each. A company with six strengths and one
     worry used to bury the worry below the fold, which is the one line a
     person most needs to see. The count in the heading says what is being
     held back, and the detail sheet lists all of it. */
  var CARD_MAX = 4;

  function column(kind, title, items, glyph) {
    var col = el("section", "pc-col " + kind);
    var shown = items.slice(0, CARD_MAX);

    var h = el("h3", "");
    h.appendChild(el("span", "pc-glyph", glyph));
    h.appendChild(el("span", "", title));
    if (items.length) h.appendChild(el("span", "pc-count", String(items.length)));
    col.appendChild(h);

    if (!items.length) {
      col.appendChild(el("p", "pc-none", kind === "pro"
        ? "Nothing in the numbers stands out as a strength."
        : "Nothing in the numbers stands out as a concern."));
    } else {
      var ul = el("ul", "");
      shown.forEach(function (t) { ul.appendChild(el("li", "", t)); });
      col.appendChild(ul);
      if (items.length > shown.length) {
        col.appendChild(el("p", "pc-more",
          "and " + (items.length - shown.length) + " more, tap for the rest"));
      }
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
    sec2.appendChild(el("p", "block-note", "Taken from the company's own filings at SEC EDGAR."));
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
      if (!d) { slot.appendChild(el("p", "block-note", "This filing could not be read automatically. The original is linked below.")); return; }

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
        slot.appendChild(el("p", "block-note", "Nothing could be read out of this filing. The original is linked below."));
      }
    });
  } else {
    slot.innerHTML = "";
    slot.appendChild(el("p", "block-note",
      s.sec && s.sec.tenK
        ? "This 10-K has not been read yet. The original is linked below."
        : "No annual report on file for this company."));
  }

  /* ---------- into the full record ---------- */
  var more = el("button", "more-btn");
  more.type = "button";
  more.innerHTML = '<span>Open the full record</span>' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  more.addEventListener("click", function (ev) { ev.stopPropagation(); openDetail(s); });
  body.appendChild(more);

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
    var held = Date.now() - drag.t0;
    var speed = Math.abs(dx) / Math.max(1, held);
    var moved = Math.abs((ev.clientX || drag.x0) - drag.x0) + Math.abs((ev.clientY || drag.y0) - drag.y0);
    drag = null;
    card.classList.remove("is-drag");
    scroller.style.overflowY = "";

    /* a still, short press is a tap — open the full record */
    if (axis === null && moved < 8 && held < 500) {
      openDetail(state.byTicker[entry.ticker]);
      return;
    }
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

/* Local first, always. The browser copy is written synchronously so the cart
   survives a refresh whether or not anyone is signed in; the server copy is
   debounced behind it, because the notes field fires on every keystroke and a
   round trip per character would be absurd. A failed push is not an error the
   user needs to see — the local copy is still correct and the next write
   retries. */
var pushTimer = null;

function persistCart() {
  save(LS.cart, state.cart);
  if (!state.user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(function () {
    auth.pushCart(state.cart).then(function (ok) { setSyncNote(ok ? "saved" : "offline"); });
  }, 800);
}

function setSyncNote(status) {
  var n = $("#cartSync");
  if (!n) return;
  n.hidden = !state.user;
  n.textContent = status === "offline"
    ? "Not saved, will retry"
    : status === "saving" ? "Saving…" : "Saved to your account";
  n.classList.toggle("is-warn", status === "offline");
}

/* Signing in pulls what the account already has and folds the browser's cart
   into it, so arriving from a second device adds to the list rather than
   replacing it. */
function adoptAccountCart() {
  return auth.fetchCart().then(function (remote) {
    if (remote === null) return;
    var merged = auth.mergeCarts(state.cart, remote);
    var changed = merged.length !== state.cart.length ||
      merged.some(function (m, i) { return !state.cart[i] || state.cart[i].t !== m.t; });
    state.cart = merged;
    save(LS.cart, state.cart);
    renderCartCount();
    if ($("#dlgCart").open) renderCart();
    if (changed || remote.length !== merged.length) return auth.pushCart(merged);
  }).then(function () { setSyncNote("saved"); });
}

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
  persistCart();
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
      persistCart();
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
    note.placeholder = "What made you keep this one? Only you will see it.";
    note.value = item.note || "";
    note.addEventListener("input", function () {
      item.note = note.value.slice(0, 600);
      persistCart();
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



/* ====================================================== DETAIL SHEET =====
   Everything that doesn't fit on the card: a five-year price chart, the
   financial statements as filed, what analysts think, and the whole risk
   section rather than the first five lines of it.
   ======================================================================== */

var deepCache = {};

function loadDeep(ticker) {
  if (deepCache[ticker] !== undefined) return Promise.resolve(deepCache[ticker]);
  var safe = ticker.replace(/[^A-Z0-9.]/gi, "_");
  return fetch("data/detail/" + encodeURIComponent(safe) + ".json", { cache: "no-cache" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { deepCache[ticker] = j; return j; })
    .catch(function () { deepCache[ticker] = null; return null; });
}

/* ---------------------------------------------------------- price chart */

var CHART_W = 720, CHART_H = 240, PAD_L = 4, PAD_R = 4, PAD_T = 12, PAD_B = 22;

function niceTicks(lo, hi, count) {
  var span = hi - lo;
  if (span <= 0) return [lo];
  var raw = span / count;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; })
    .filter(function (s) { return s >= raw; })[0] || 10 * mag;
  var out = [], v = Math.ceil(lo / step) * step;
  while (v <= hi + 1e-9) { out.push(v); v += step; }
  return out;
}

function buildChart(points, months) {
  var wrap = el("div", "chart-wrap");
  if (!points || points.length < 5) {
    wrap.appendChild(el("p", "block-note", "No price history for this company yet."));
    return wrap;
  }

  var cut = months
    ? new Date(Date.now() - months * 30.5 * 864e5).toISOString().slice(0, 10)
    : "0000";
  var pts = points.filter(function (p) { return p[0] >= cut; });
  if (pts.length < 5) pts = points.slice(-Math.max(5, Math.round(points.length / 4)));

  var vals = pts.map(function (p) { return p[1]; });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  var pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
  lo -= pad; hi += pad;

  var innerW = CHART_W - PAD_L - PAD_R, innerH = CHART_H - PAD_T - PAD_B;
  var xOf = function (i) { return PAD_L + (i / (pts.length - 1)) * innerW; };
  var yOf = function (v) { return PAD_T + (1 - (v - lo) / (hi - lo)) * innerH; };

  var line = "", area = "";
  pts.forEach(function (p, i) {
    var cmd = (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + " " + yOf(p[1]).toFixed(1);
    line += cmd; area += cmd;
  });
  area += "L" + xOf(pts.length - 1).toFixed(1) + " " + (PAD_T + innerH) + "L" + PAD_L + " " + (PAD_T + innerH) + "Z";

  var first = pts[0][1], last = pts[pts.length - 1][1];
  var move = ((last - first) / first) * 100;

  var svgNS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 " + CHART_W + " " + CHART_H);
  svg.setAttribute("class", "pricechart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label",
    "Price from " + pts[0][0] + " to " + pts[pts.length - 1][0] +
    ", " + price(first) + " to " + price(last) + ", " + pct(move, 1));

  function add(tag, attrs, cls) {
    var n = document.createElementNS(svgNS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (cls) n.setAttribute("class", cls);
    svg.appendChild(n);
    return n;
  }

  niceTicks(lo, hi, 3).forEach(function (v) {
    add("line", { x1: PAD_L, x2: CHART_W - PAD_R, y1: yOf(v).toFixed(1), y2: yOf(v).toFixed(1) }, "grid");
    var t = add("text", { x: PAD_L + 2, y: (yOf(v) - 4).toFixed(1) }, "axis");
    t.textContent = price(v);
  });

  /* year boundaries as sparse x labels */
  var seenYear = null;
  pts.forEach(function (p, i) {
    var y = p[0].slice(0, 4);
    if (y !== seenYear) {
      seenYear = y;
      if (i > 2 && i < pts.length - 2) {
        var t = add("text", { x: xOf(i).toFixed(1), y: CHART_H - 6, "text-anchor": "middle" }, "axis");
        t.textContent = y;
      }
    }
  });

  add("path", { d: area }, "area");
  add("path", { d: line, "vector-effect": "non-scaling-stroke" }, "line");

  var cross = add("line", { x1: 0, x2: 0, y1: PAD_T, y2: PAD_T + innerH }, "crosshair");
  var dot = add("circle", { cx: 0, cy: 0, r: 4.5 }, "cursor-dot");
  cross.style.opacity = dot.style.opacity = 0;

  wrap.appendChild(svg);

  var tip = el("div", "chart-tip");
  tip.hidden = true;
  wrap.appendChild(tip);

  var caption = el("p", "chart-caption");
  caption.innerHTML = "";
  var moveSpan = el("span", "delta small " + (move > 0.05 ? "up" : move < -0.05 ? "down" : "flat"));
  moveSpan.appendChild(el("span", "arrow", move > 0.05 ? "▲" : move < -0.05 ? "▼" : "–"));
  moveSpan.appendChild(el("span", "", pct(move, 1) + " over this window"));
  caption.appendChild(el("span", "", pts[0][0] + " → " + pts[pts.length - 1][0]));
  caption.appendChild(moveSpan);
  wrap.appendChild(caption);

  function place(ev) {
    var box = svg.getBoundingClientRect();
    var rel = (ev.clientX - box.left) / box.width;
    var i = clamp(Math.round(rel * (pts.length - 1)), 0, pts.length - 1);
    var px = xOf(i), py = yOf(pts[i][1]);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px);
    dot.setAttribute("cx", px); dot.setAttribute("cy", py);
    cross.style.opacity = dot.style.opacity = 1;
    tip.hidden = false;
    tip.innerHTML = "<b>" + price(pts[i][1]) + "</b><span>" + dateShort(pts[i][0]) + "</span>";
    var leftPct = (px / CHART_W) * 100;
    tip.style.left = clamp(leftPct, 8, 92) + "%";
  }
  svg.addEventListener("pointermove", place);
  svg.addEventListener("pointerdown", place);
  svg.addEventListener("pointerleave", function () {
    cross.style.opacity = dot.style.opacity = 0;
    tip.hidden = true;
  });

  return wrap;
}

/* ------------------------------------------------ financials, as filed */

var HISTORY_ROWS = [
  { key: "revenue",     label: "Revenue" },
  { key: "grossProfit", label: "Gross profit" },
  { key: "opIncome",    label: "Operating income" },
  { key: "netIncome",   label: "Net income" },
  { key: "ocf",         label: "Operating cash flow" },
  { key: "capex",       label: "Capital expenditure" },
  { key: "assets",      label: "Total assets" },
  { key: "liabs",       label: "Total liabilities" },
  { key: "equity",      label: "Shareholder equity" },
  { key: "cash",        label: "Cash" },
  { key: "debt",        label: "Long-term debt" }
];

function buildHistory(deep) {
  var box = el("div", "");
  var h = deep && deep.history;
  if (!h || !h.revenue) {
    box.appendChild(el("p", "block-note", "This company files its numbers in a shape this reader could not follow, so there is no year-by-year history."));
    return box;
  }

  var years = Object.keys(h.revenue).map(Number).sort(function (a, b) { return b - a; }).slice(0, 5);

  var table = el("table", "fin-table");
  var thead = el("thead");
  var hr = el("tr");
  hr.appendChild(el("th", "", ""));
  years.forEach(function (y) { hr.appendChild(el("th", "", "FY" + y)); });
  thead.appendChild(hr);
  table.appendChild(thead);

  var tb = el("tbody");
  HISTORY_ROWS.forEach(function (row) {
    if (!h[row.key]) return;
    var tr = el("tr");
    var th = el("th", "", row.label); th.scope = "row";
    tr.appendChild(th);
    years.forEach(function (y) { tr.appendChild(el("td", "", money(h[row.key][y]))); });
    tb.appendChild(tr);
  });

  /* free cash flow and the margins are derived, so mark them as such */
  if (h.ocf && h.capex) {
    var tr = el("tr", "is-derived");
    var th = el("th", "", "Free cash flow"); th.scope = "row";
    tr.appendChild(th);
    years.forEach(function (y) {
      var o = h.ocf[y], c = h.capex[y];
      tr.appendChild(el("td", "", num(o) && num(c) ? money(o - c) : "—"));
    });
    tb.appendChild(tr);
  }
  [["grossProfit", "Gross margin"], ["opIncome", "Operating margin"], ["netIncome", "Net margin"]]
    .forEach(function (pair) {
      if (!h[pair[0]]) return;
      var tr2 = el("tr", "is-derived");
      var th2 = el("th", "", pair[1]); th2.scope = "row";
      tr2.appendChild(th2);
      years.forEach(function (y) {
        var v = h[pair[0]][y], r = h.revenue[y];
        tr2.appendChild(el("td", "", num(v) && num(r) && r !== 0 ? ((v / r) * 100).toFixed(1) + "%" : "—"));
      });
      tb.appendChild(tr2);
    });
  var adjShares = splitAdjustShares(h.shares).shares;
  if (adjShares) {
    var trS = el("tr");
    var thS = el("th", "", "Diluted shares"); thS.scope = "row";
    trS.appendChild(thS);
    years.forEach(function (y) { trS.appendChild(el("td", "", num(adjShares[y]) ? money(adjShares[y], false) : "—")); });
    tb.appendChild(trS);
  }

  table.appendChild(tb);
  box.appendChild(el("p", "block-note", "Taken from the company's own filings. Italic rows are worked out from the rows above them."));
  var scroll = el("div", "table-scroll");
  scroll.appendChild(table);
  box.appendChild(scroll);

  var note = shareCountNote(h.shares);
  if (note) box.appendChild(el("p", "fin-note", note));
  return box;
}

/* ------------------------------------------------------- analyst view */

var REC_BANDS = [
  { key: "strongBuy",  label: "Strong buy",  cls: "rec-sb" },
  { key: "buy",        label: "Buy",         cls: "rec-b"  },
  { key: "hold",       label: "Hold",        cls: "rec-h"  },
  { key: "sell",       label: "Sell",        cls: "rec-s"  },
  { key: "strongSell", label: "Strong sell", cls: "rec-ss" }
];

/* Two decimals unless the number genuinely has more, then up to four. */
function trimNum(v) {
  var s = v.toFixed(4).replace(/0+$/, "");
  var dp = (s.split(".")[1] || "").length;
  return v.toFixed(Math.max(2, Math.min(4, dp)));
}

function buildAnalyst(deep) {
  var box = el("div", "");
  var a = deep && deep.analyst;
  var trend = (a && a.trend) || [];
  var surprises = (a && a.earnings) || [];

  /* Three different silences, and they are not the same thing: the deep file
     has not been generated yet, it exists but the fetch has not run, or the
     street genuinely publishes nothing on this ticker. Say which. */
  if (!trend.length && !surprises.length) {
    box.appendChild(el("p", "block-note", !deep
      ? "The chart and analyst view for this company have not been built yet. They arrive with tomorrow's refresh."
      : "Nobody publishes ratings or earnings estimates for this company."));
    return box;
  }

  if (trend.length) {
    box.appendChild(el("h4", "sub-h", "Where the ratings sit"));

    var legend = el("div", "rec-legend");
    REC_BANDS.forEach(function (b) {
      var item = el("span", "rec-key");
      item.appendChild(el("span", "rec-chip " + b.cls));
      item.appendChild(el("span", "", b.label));
      legend.appendChild(item);
    });
    box.appendChild(legend);

    var list = el("div", "rec-rows");
    trend.slice(0, 4).forEach(function (row) {
      var total = REC_BANDS.reduce(function (s, b) { return s + (row[b.key] || 0); }, 0);
      var r = el("div", "rec-row");
      r.appendChild(el("span", "rec-period", (row.period || "").slice(0, 7)));
      var bar = el("div", "rec-bar");
      REC_BANDS.forEach(function (b) {
        var v = row[b.key] || 0;
        if (!v) return;
        var seg = el("span", "rec-seg " + b.cls);
        seg.style.width = ((v / total) * 100) + "%";
        seg.title = b.label + ": " + v;
        if (v / total > 0.13) seg.textContent = v;
        bar.appendChild(seg);
      });
      r.appendChild(bar);
      r.appendChild(el("span", "rec-total", total + " analysts"));
      list.appendChild(r);
    });
    box.appendChild(list);
  }

  if (surprises.length) {
    box.appendChild(el("h4", "sub-h", "Has it been beating estimates?"));
    var t = el("table", "rv-table");
    var tb = el("tbody");
    surprises.slice(0, 6).forEach(function (e) {
      var tr = el("tr");
      var th = el("th", "", e.period); th.scope = "row";
      tr.appendChild(th);
      var beat = num(e.actual) && num(e.estimate) && e.actual >= e.estimate;
      var td = el("td", "");
      var mark = el("span", "delta small " + (beat ? "up" : "down"));
      mark.appendChild(el("span", "arrow", beat ? "▲" : "▼"));
      /* Consensus estimates carry more decimals than a share price does — APH's
         Q2 was $1.1942, not $1.19. Rounding it to two made the printed beat
         percentage look like it did not follow from the two numbers beside it,
         so keep whatever precision the estimate actually has, up to four. */
      mark.appendChild(el("span", "",
        "$" + (num(e.actual) ? e.actual.toFixed(2) : "—") +
        " vs $" + (num(e.estimate) ? trimNum(e.estimate) : "—") + " expected" +
        (num(e.surprisePct) ? " (" + pct(e.surprisePct, 1) + ")" : "")));
      td.appendChild(mark);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    box.appendChild(t);
  }
  return box;
}

/* ------------------------------------------------------- the sheet itself */

var detailTicker = null;

function section(title, node) {
  var s = el("section", "c-block");
  s.appendChild(el("h3", "block-h", title));
  s.appendChild(node);
  return s;
}

function openDetail(s) {
  if (!s) return;
  detailTicker = s.t;

  $("#detailTitle").textContent = s.t;
  $("#detailName").textContent = s.n + " · " + s.s;
  $("#detailPrice").textContent = price(s.price);
  var dir = !num(s.change) ? "flat" : s.change > 0.005 ? "up" : s.change < -0.005 ? "down" : "flat";
  var ch = $("#detailChange");
  ch.className = "delta small " + dir;
  ch.innerHTML = "";
  ch.appendChild(el("span", "arrow", dir === "up" ? "▲" : dir === "down" ? "▼" : "–"));
  ch.appendChild(el("span", "", num(s.change) ? pct(s.change, 2) : "—"));

  var body = $("#detailBody");
  body.innerHTML = "";
  body.appendChild(el("p", "block-note", "Loading the full record…"));

  openDialog($("#dlgDetail"));

  Promise.all([loadDeep(s.t), loadDetail(s.t)]).then(function (both) {
    if (detailTicker !== s.t) return;
    var deep = both[0], filing = both[1];
    body.innerHTML = "";

    /* --- the score, and what drove it --- */
    var scoreRes = scoreStock(s);
    var scoreBox = el("div", "score-detail");
    var scoreHead = el("div", "score-head");
    scoreHead.appendChild(scoreRing(scoreRes, true));
    var blurb = el("div", "score-blurb");
    blurb.appendChild(el("p", "", num(scoreRes.overall)
      ? "A weighted blend of the five factors below. It describes what the last filing and the current price look like. It is not a forecast, and it knows nothing about the business beyond these numbers."
      : "Not enough reported data to score this one."));
    scoreHead.appendChild(blurb);
    scoreBox.appendChild(scoreHead);
    scoreBox.appendChild(factorBars(scoreRes));
    body.appendChild(section("Fundamentals score", scoreBox));

    /* --- price chart with a range toggle --- */
    var chartBox = el("div", "");
    var ranges = el("div", "range-toggle");
    var chartSlot = el("div", "");
    [{ label: "1Y", months: 12 }, { label: "5Y", months: 0 }].forEach(function (r, i) {
      var b = el("button", "chip" + (i === 1 ? " is-on" : ""), r.label);
      b.type = "button";
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(ranges.children, function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        chartSlot.innerHTML = "";
        chartSlot.appendChild(buildChart(deep && deep.chart, r.months));
      });
      ranges.appendChild(b);
    });
    chartSlot.appendChild(buildChart(deep && deep.chart, 0));
    chartBox.appendChild(ranges);
    chartBox.appendChild(chartSlot);
    body.appendChild(section("Price", chartBox));

    body.appendChild(section("The books, five years deep", buildHistory(deep)));
    body.appendChild(section("What analysts say", buildAnalyst(deep)));

    /* --- the filing in full --- */
    var fbox = el("div", "");
    if (filing && filing.business) {
      fbox.appendChild(el("h4", "sub-h", "What the company says it does"));
      fbox.appendChild(el("p", "filing-text", filing.business));
    }
    if (filing && filing.risks && filing.risks.length) {
      fbox.appendChild(el("h4", "sub-h", "Every risk factor it lists (" + filing.risks.length + ")"));
      var ul = el("ul", "risk-list");
      filing.risks.forEach(function (r) { ul.appendChild(el("li", "", r)); });
      fbox.appendChild(ul);
    }
    if (!filing || (!filing.business && !(filing.risks || []).length)) {
      fbox.appendChild(el("p", "block-note", "This filing could not be read automatically. The original is linked below."));
    }
    var links = el("div", "filing-links");
    [
      s.sec && s.sec.tenK && { href: s.sec.tenK.url, text: "Read the 10-K (" + dateShort(s.sec.tenK.date) + ")" },
      s.sec && s.sec.tenQ && { href: s.sec.tenQ.url, text: "Latest 10-Q (" + dateShort(s.sec.tenQ.date) + ")" },
      { href: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + (s.cik || s.t) + "&type=10-K&dateb=&owner=include&count=40",
        text: "All filings on EDGAR" }
    ].filter(Boolean).forEach(function (l) {
      if (!l.href) return;
      var a = el("a", "filing-link", l.text);
      a.href = l.href; a.target = "_blank"; a.rel = "noopener";
      links.appendChild(a);
    });
    fbox.appendChild(links);
    body.appendChild(section("The filing", fbox));

    if (deep && deep.updated) {
      body.appendChild(el("p", "block-note", "Deep data refreshed " + relTime(deep.updated) + "."));
    }
    body.scrollTop = 0;
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
      : "The snapshot exists but is empty. Check the workflow logs in the Actions tab.",
    [
      { label: "Open the Actions tab", onClick: function () { window.open(repo + "/actions", "_blank", "noopener"); } },
      { label: "Set up the key", kind: "link", onClick: function () {
          window.open(repo + "/settings/secrets/actions/new", "_blank", "noopener");
      } }
    ]
  );
}

function repoUrl() {
  var m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return "https://github.com";
  var seg = location.pathname.split("/").filter(Boolean)[0];
  return "https://github.com/" + m[1] + (seg ? "/" + seg : "/" + m[1] + ".github.io");
}

/* ================================================================ INIT === */

function wire() {

  $("#btnCart").addEventListener("click", function () { renderCart(); openDialog($("#dlgCart")); });

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
    persistCart();
    renderCart(); renderCartCount();
  });


  $("#detailAdd").addEventListener("click", function () {
    closeDialog($("#dlgDetail"));
    commit("add");
  });
  $("#detailSkip").addEventListener("click", function () {
    closeDialog($("#dlgDetail"));
    commit("pass");
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.target.matches("input, textarea")) return;
    if (document.querySelector("dialog[open]")) return;
    if (ev.key === "Enter" || ev.key === "d") {
      var top = cards[0];
      if (top) { ev.preventDefault(); openDetail(state.byTicker[top.ticker]); }
      return;
    }
    if (ev.key === "ArrowRight") { ev.preventDefault(); commit("add"); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); commit("pass"); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      var sc = cards[0] && $(".card-scroll", cards[0].node);
      if (sc) { ev.preventDefault(); sc.scrollBy({ top: ev.key === "ArrowDown" ? 220 : -220, behavior: "smooth" }); }
    }
  });

  $("#repoLink").href = repoUrl();
}

/* ============================================================== AUTH ===== */

function authError(msg) {
  var box = $("#authError");
  box.hidden = !msg;
  box.textContent = msg || "";
}

function showAuthStep(which) {
  ["authEmailStep", "authCodeStep", "authSignedIn"].forEach(function (id) {
    $("#" + id).hidden = id !== which;
  });
  authError("");
}

function renderAuthButton() {
  var btn = $("#btnAuth");
  if (!auth.isConfigured()) { btn.hidden = true; return; }
  btn.hidden = false;

  /* Three states, not two. The library loads from a CDN, so for the first
     moment of every page load we do not yet know who you are. Saying "Sign in"
     during that gap tells an already-signed-in person they have been thrown
     out, which is how this looked broken even when the session was fine. */
  var label = state.user
    ? (state.user.email || "Account").split("@")[0]
    : state.authPending ? "Signing in…" : "Sign in";
  $("#authLabel").textContent = label;
  btn.classList.toggle("accent", !state.user && !state.authPending);
  btn.classList.toggle("is-pending", !state.user && !!state.authPending);
}

function openAuth() {
  if (state.user) {
    $("#authWho").textContent = state.user.email || "your account";
    showAuthStep("authSignedIn");
  } else {
    showAuthStep("authEmailStep");
  }
  openDialog($("#dlgAuth"));
}

function wireAuth() {
  if (!auth.isConfigured()) return;

  $("#btnAuth").addEventListener("click", openAuth);

  var pending = "";

  $("#authEmailStep").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("#authEmail").value.trim();
    if (!email) return;
    var btn = $("#authSend");
    btn.disabled = true; btn.textContent = "Sending…";
    auth.sendCode(email).then(function (r) {
      btn.disabled = false; btn.textContent = "Email me a sign-in link";
      if (!r.ok) return authError(r.error);
      pending = email;
      $("#authSentTo").textContent = email;
      showAuthStep("authCodeStep");
      $("#authCode").focus();
    });
  });

  $("#authCodeStep").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#authCode").value.replace(/\D/g, "");
    if (code.length !== 6) return authError("Paste the six-digit code, or just click the link in the email instead.");
    var btn = $("#authVerify");
    btn.disabled = true; btn.textContent = "Signing in…";
    auth.verifyCode(pending, code).then(function (r) {
      btn.disabled = false; btn.textContent = "Sign in with the code";
      if (!r.ok) return authError(r.error);
      $("#authCode").value = "";
    });
  });

  $("#authBack").addEventListener("click", function () {
    $("#authCode").value = "";
    showAuthStep("authEmailStep");
  });

  $("#authSignOut").addEventListener("click", function () {
    auth.signOut().then(function () { closeDialog($("#dlgAuth")); });
  });

  /* One place decides what being signed in means, so a session restored on
     page load and a fresh sign-in take exactly the same path. */
  auth.onAuthChange(function (user) {
    state.user = user;
    renderAuthButton();
    setSyncNote("saved");
    state.authPending = false;
    if (user) {
      auth.tidyUrl();
      adoptAccountCart();
      if ($("#dlgAuth").open) {
        $("#authWho").textContent = user.email || "your account";
        showAuthStep("authSignedIn");
      }
    } else if ($("#dlgAuth").open) {
      showAuthStep("authEmailStep");
    }
  });

  auth.currentUser().then(function (user) {
    state.authPending = false;
    state.user = user;
    renderAuthButton();
    auth.tidyUrl();
    if (user) adoptAccountCart();
  });
}

function init() {
  wire();
  /* Decided synchronously, before any network call: either a session is already
     in storage or this page load is the return leg of a sign-in link. Either
     way somebody is signed in, and the header should not claim otherwise. */
  state.authPending = auth.isConfigured() && (auth.hasStoredSession() || auth.isAuthCallback());
  wireAuth();
  renderAuthButton();
  renderCartCount();
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
      buildDeck();

      /* a company page links in with ?t=TICKER — start the deck on that one */
      var want = new URLSearchParams(location.search).get("t");
      if (want && state.byTicker[want.toUpperCase()]) {
        var wt = want.toUpperCase();
        state.deck = [wt].concat(state.deck.filter(function (t) { return t !== wt; }));
        state.cursor = 0;
      }

      renderDeck();
    });
}

init();

