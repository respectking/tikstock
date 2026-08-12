/* ==========================================================================
   StockOrNot — shared analysis
   --------------------------------------------------------------------------
   The scoring rules, the pros-and-cons rules and the number formatting all
   live here so the swipe card and the static company pages can never drift
   apart. Loaded as an ES module by both the browser app and the page builder.

   Nothing in this file predicts anything. The score is a weighted average of
   five factor scores, each a piecewise curve over a reported figure, and the
   pros and cons are thresholds that state the number that triggered them.
   ========================================================================== */

/* ------------------------------------------------------------- primitives */

export function num(v) { return typeof v === "number" && isFinite(v); }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Piecewise-linear mapping through a list of [input, output] knots. */
export function curve(v, knots) {
  if (!num(v)) return null;
  if (v <= knots[0][0]) return knots[0][1];
  const last = knots[knots.length - 1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i];
    if (v <= b[0]) return a[1] + ((v - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return last[1];
}

export function mean(list) {
  const vals = list.filter(num);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/* ------------------------------------------------------------ formatting */

export function money(v, currency) {
  if (!num(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  let s;
  if (a >= 1e12)     s = (a / 1e12).toFixed(a >= 1e13 ? 1 : 2) + "T";
  else if (a >= 1e9) s = (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + "B";
  else if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
  else if (a >= 1e3) s = (a / 1e3).toFixed(0) + "K";
  else               s = a.toFixed(0);
  return sign + (currency === false ? "" : "$") + s;
}

/** Finnhub reports market cap in millions. */
export function cap(v) { return num(v) ? money(v * 1e6) : "—"; }

export function price(v) {
  if (!num(v)) return "—";
  const d = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function pct(v, d = 1) { return num(v) ? (v > 0 ? "+" : "") + v.toFixed(d) + "%" : "—"; }
export function pctPlain(v, d = 1) { return num(v) ? v.toFixed(d) + "%" : "—"; }
export function x(v, d = 1) { return num(v) ? v.toFixed(d) + "×" : "—"; }

export function dateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00Z" : ""));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Where the price sits in its 52-week band, 0–1. */
export function rangePos(s) {
  if (!num(s.lo) || !num(s.hi) || s.hi <= s.lo || !num(s.price)) return null;
  return clamp((s.price - s.lo) / (s.hi - s.lo), 0, 1);
}

/* ============================================================== SCORING ===
   Five factors, each 0–100, blended over whichever have data. A missing input
   drops its factor and the remaining weights are renormalised, so a company is
   never punished for a gap in the filings.
   ======================================================================== */

export const FACTORS = [
  { id: "value",   label: "Value",         weight: 0.22, blurb: "what you pay for the earnings and assets" },
  { id: "growth",  label: "Growth",        weight: 0.22, blurb: "how fast revenue and earnings are moving" },
  { id: "quality", label: "Profitability", weight: 0.24, blurb: "how much of the revenue becomes profit" },
  { id: "moment",  label: "Momentum",      weight: 0.18, blurb: "how the price has behaved lately" },
  { id: "stable",  label: "Stability",     weight: 0.14, blurb: "how violently it moves, and what it pays you" }
];

function scoreValue(s) {
  const pe = num(s.pe) && s.pe > 0
    ? curve(s.pe, [[5, 92], [10, 84], [16, 70], [25, 52], [40, 34], [70, 16], [120, 8]]) : null;
  const pb = num(s.pb) && s.pb > 0
    ? curve(s.pb, [[0.8, 90], [1.5, 78], [3, 64], [6, 48], [12, 32], [30, 14], [60, 8]]) : null;
  const ps = num(s.ps) && s.ps > 0
    ? curve(s.ps, [[0.5, 88], [1.5, 76], [3, 62], [6, 46], [12, 28], [25, 12]]) : null;
  return mean([pe, pe, pb, ps]);          /* earnings weighted double */
}

function scoreGrowth(s) {
  const rg = curve(s.rg, [[-20, 4], [-5, 22], [0, 34], [5, 50], [12, 66], [25, 82], [45, 93], [80, 97]]);
  const eg = curve(s.eg, [[-50, 4], [-15, 22], [0, 36], [10, 54], [25, 70], [50, 85], [100, 94]]);
  const r5 = curve(s.rg5, [[-8, 8], [0, 30], [5, 50], [10, 68], [20, 85], [35, 94]]);
  return mean([rg, rg, eg, r5]);          /* revenue is less noisy than EPS */
}

function scoreQuality(s) {
  const roe = curve(s.roe, [[-20, 3], [0, 16], [6, 36], [12, 54], [20, 70], [35, 84], [60, 93]]);
  const nm  = curve(s.nm,  [[-20, 3], [0, 18], [4, 34], [9, 50], [16, 66], [26, 80], [40, 92]]);
  const gm  = curve(s.gm,  [[10, 25], [25, 42], [40, 58], [55, 72], [70, 84], [85, 92]]);
  return mean([roe, nm, gm]);
}

function scoreMomentum(s) {
  const pos = rangePos(s);
  const inRange = pos === null ? null : pos * 100;
  const r13 = curve(s.r13, [[-30, 6], [-12, 24], [-3, 40], [3, 55], [10, 70], [22, 85], [45, 94]]);
  const r52 = curve(s.r52, [[-45, 6], [-18, 26], [-4, 42], [6, 57], [18, 72], [40, 86], [80, 94]]);
  return mean([inRange, r13, r52]);
}

function scoreStability(s) {
  const beta = curve(s.beta, [[0.4, 92], [0.7, 82], [1.0, 66], [1.3, 50], [1.8, 32], [2.5, 16], [3.5, 8]]);
  let band = null;
  if (num(s.lo) && num(s.hi) && s.hi > 0) {
    band = curve((s.hi - s.lo) / s.hi, [[0.15, 90], [0.28, 74], [0.42, 56], [0.6, 38], [0.8, 20]]);
  }
  const div = num(s.dy) ? curve(s.dy, [[0, 44], [1.5, 58], [3, 70], [5, 74], [9, 58]]) : null;
  const debt = num(s.de) ? curve(s.de, [[0.2, 88], [0.6, 72], [1.2, 56], [2.5, 34], [5, 16]]) : null;
  return mean([beta, band, div, debt]);
}

export function scoreStock(s) {
  const raw = {
    value:   scoreValue(s),
    growth:  scoreGrowth(s),
    quality: scoreQuality(s),
    moment:  scoreMomentum(s),
    stable:  scoreStability(s)
  };
  let total = 0, wsum = 0;
  for (const f of FACTORS) {
    if (num(raw[f.id])) { total += raw[f.id] * f.weight; wsum += f.weight; }
  }
  return { factors: raw, overall: wsum > 0 ? Math.round(total / wsum) : null };
}

/** A word for the number. Deliberately about screening, not about buying. */
export function scoreLabel(score) {
  if (!num(score)) return { word: "No score", tone: "none" };
  if (score >= 70) return { word: "Screens strongly", tone: "high" };
  if (score >= 58) return { word: "Screens well",     tone: "good" };
  if (score >= 45) return { word: "Mixed",            tone: "mid"  };
  if (score >= 33) return { word: "Screens poorly",   tone: "low"  };
  return { word: "Screens badly", tone: "bad" };
}

/* ====================================================== PROS AND CONS ===== */

export function prosAndCons(s) {
  const pros = [], cons = [];
  const f = s.fin || {};
  const pos = rangePos(s);
  const add = (arr, w, text) => arr.push({ w, text });

  /* ---- valuation ---- */
  if (num(s.pe) && s.pe > 0) {
    if (s.pe < 13)      add(pros, 8, `Cheap on earnings at ${x(s.pe)} — well under the market's usual 20×.`);
    else if (s.pe < 18) add(pros, 5, `Reasonably priced at ${x(s.pe)} earnings.`);
    else if (s.pe > 55) add(cons, 9, `Very expensive at ${x(s.pe)} earnings — years of growth are already in the price.`);
    else if (s.pe > 30) add(cons, 6, `Pricey at ${x(s.pe)} earnings, against a long-run market average nearer 20×.`);
  }
  if (num(s.pb) && s.pb > 0 && s.pb < 1.3) add(pros, 6, `Trades at ${x(s.pb, 2)} book value — below what the balance sheet says it owns.`);
  if (num(s.pb) && s.pb > 20)              add(cons, 5, `Priced at ${x(s.pb, 0)} book value — there is very little hard asset backing here.`);
  if (num(s.ps) && s.ps > 12)              add(cons, 6, `Priced at ${x(s.ps)} sales, which leaves no room for a stumble.`);

  /* ---- growth ---- */
  if (num(s.rg)) {
    if (s.rg >= 20)      add(pros, 9, `Revenue up ${pct(s.rg)} on the year.`);
    else if (s.rg >= 8)  add(pros, 6, `Revenue growing ${pct(s.rg)} year over year.`);
    else if (s.rg < -5)  add(cons, 8, `Revenue fell ${pct(s.rg)} year over year.`);
    else if (s.rg < 1)   add(cons, 5, `Revenue is flat — ${pct(s.rg)} on the year.`);
  }
  if (num(s.rg5) && s.rg5 >= 10) add(pros, 5, `Has compounded revenue at ${pctPlain(s.rg5)} a year over five years.`);
  if (num(s.eg)) {
    if (s.eg >= 25)       add(pros, 6, `Earnings per share up ${pct(s.eg)}.`);
    else if (s.eg <= -20) add(cons, 7, `Earnings per share down ${pct(s.eg)}.`);
  }

  /* ---- profitability ---- */
  if (num(s.roe)) {
    if (s.roe >= 25)      add(pros, 8, `Turns ${pctPlain(s.roe, 0)} on shareholder equity.`);
    else if (s.roe >= 15) add(pros, 5, `Solid ${pctPlain(s.roe, 0)} return on equity.`);
    else if (s.roe < 0)   add(cons, 9, `Losing money — return on equity is ${pctPlain(s.roe, 0)}.`);
    else if (s.roe < 8)   add(cons, 5, `Thin ${pctPlain(s.roe, 0)} return on equity.`);
  }
  if (num(s.nm)) {
    if (s.nm >= 20)     add(pros, 7, `${pctPlain(s.nm, 0)} of revenue drops through to net profit.`);
    else if (s.nm < 0)  add(cons, 9, `Unprofitable — net margin of ${pctPlain(s.nm)}.`);
    else if (s.nm < 4)  add(cons, 5, `Wafer-thin net margin of ${pctPlain(s.nm)}.`);
  }
  if (num(s.gm) && s.gm >= 55) add(pros, 4, `Gross margin of ${pctPlain(s.gm, 0)} absorbs cost shocks.`);

  /* ---- cash and balance sheet, straight from the filings ---- */
  if (num(f.fcf) && num(f.revenue) && f.revenue > 0) {
    const conv = (f.fcf / f.revenue) * 100;
    if (f.fcf > 0 && conv >= 15)  add(pros, 8, `Generated ${money(f.fcf)} of free cash flow in FY${f.fy} — ${conv.toFixed(0)}% of revenue.`);
    else if (f.fcf > 0)           add(pros, 4, `Free cash flow was positive in FY${f.fy} at ${money(f.fcf)}.`);
    else if (f.fcf < -1e6)        add(cons, 8, `Burned ${money(Math.abs(f.fcf))} of free cash in FY${f.fy}.`);
  }
  if (num(f.cash) && num(f.debt)) {
    if (f.cash > f.debt)          add(pros, 7, `Holds more cash (${money(f.cash)}) than long-term debt (${money(f.debt)}).`);
    else if (f.debt > f.cash * 5) add(cons, 6, `Long-term debt of ${money(f.debt)} against ${money(f.cash)} of cash.`);
  }
  if (num(s.de)) {
    if (s.de < 0.05)     add(pros, 5, "Carries essentially no debt.");
    else if (s.de < 0.4) add(pros, 5, `Barely leveraged — debt is ${x(s.de, 2)} equity.`);
    else if (s.de > 2.5) add(cons, 7, `Heavily leveraged — debt is ${x(s.de, 1)} equity.`);
  }
  if (num(s.cr)) {
    if (s.cr >= 2)     add(pros, 3, `Current assets cover near-term bills ${x(s.cr, 1)} over.`);
    else if (s.cr < 1) add(cons, 6, `Current liabilities exceed current assets (ratio ${s.cr.toFixed(2)}).`);
  }

  /* ---- dividend ---- */
  if (num(s.dy) && s.dy > 0) {
    if (s.dy > 8)         add(cons, 6, `An ${pctPlain(s.dy)} yield is usually the market pricing in a cut.`);
    else if (s.dy >= 2.5) add(pros, 6, `Pays a ${pctPlain(s.dy)} dividend while you wait.`);
    else if (s.dy >= 1)   add(pros, 3, `Pays a modest ${pctPlain(s.dy)} dividend.`);
    if (num(s.payout) && s.payout > 90) add(cons, 5, `Dividend eats ${pctPlain(s.payout, 0)} of earnings — little cushion.`);
  }

  /* ---- price behaviour ---- */
  if (pos !== null) {
    if (pos <= 0.2)       add(pros, 5, `Sits near the bottom of its 52-week range, ${Math.round((1 - s.price / s.hi) * 100)}% off the high.`);
    else if (pos >= 0.95) add(cons, 4, `Within ${Math.max(1, Math.round((1 - s.price / s.hi) * 100))}% of its 52-week high.`);
  }
  if (num(s.beta)) {
    if (s.beta < 0.8)      add(pros, 4, `Moves less than the market (beta ${s.beta.toFixed(2)}).`);
    else if (s.beta > 1.6) add(cons, 5, `Swings harder than the market (beta ${s.beta.toFixed(2)}).`);
  }
  if (num(s.r52)) {
    if (s.r52 <= -25)     add(cons, 6, `Down ${pct(s.r52)} over the past year.`);
    else if (s.r52 >= 40) add(pros, 3, `Up ${pct(s.r52)} over the past year.`);
  }

  const byWeight = (a, b) => b.w - a.w;
  return {
    pros: pros.sort(byWeight).slice(0, 6).map((p) => p.text),
    cons: cons.sort(byWeight).slice(0, 6).map((p) => p.text)
  };
}
