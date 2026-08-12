/* ==========================================================================
   TikStock — daily data refresh
   --------------------------------------------------------------------------
   Runs in GitHub Actions, never in the browser. Builds data/snapshot.json from:

     Finnhub   quotes, ratios, 52-week range, upcoming earnings dates
     SEC XBRL  balance sheet + cash flow, pulled via the `frames` API
               (one request per concept covers every filer at once)
     SEC EDGAR each company's real latest 10-K and 10-Q — filing dates, links,
               the business description and the risk-factor headings

   10-Ks are cached under data/filings/<TICKER>.json and only re-downloaded when
   a new accession number appears, so after the first run this is a couple of
   documents a day rather than five hundred.

   Env:
     FINNHUB_TOKEN    required — repo secret, never shipped to the browser
     SEC_USER_AGENT   optional — SEC asks for "Name contact@example.com"
     LIMIT            optional — only process the first N companies (for testing)
     SKIP_FILINGS     optional — set to 1 to skip 10-K downloads
   ========================================================================== */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT       = path.resolve(import.meta.dirname, "..");
const DATA       = path.join(ROOT, "data");
const FILING_DIR = path.join(DATA, "filings");

const TOKEN = process.env.FINNHUB_TOKEN;
const UA    = process.env.SEC_USER_AGENT || "TikStock open-source project contact@example.com";
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : 0;
const SKIP_FILINGS = process.env.SKIP_FILINGS === "1";

if (!TOKEN) {
  console.error("FINNHUB_TOKEN is not set. Add it under Settings -> Secrets and variables -> Actions.");
  process.exit(1);
}

/* ----------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Simple fixed-rate gate: at most `perSec` starts each second. */
function limiter(perSec) {
  const gap = 1000 / perSec;
  let next = 0;
  return async function gate() {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await sleep(at - now);
  };
}

const finnhubGate = limiter(50 / 60);  /* free tier allows 60/min; stay under */
const secGate     = limiter(8);        /* SEC asks for <= 10 requests/second  */

async function getJSON(url, { headers = {}, gate, tries = 3, label = "" } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    if (gate) await gate();
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429) { await sleep(2000 * attempt); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === tries) {
        console.warn(`  ! ${label || url}: ${err.message}`);
        return null;
      }
      await sleep(700 * attempt);
    }
  }
  return null;
}

async function getText(url, { headers = {}, gate, label = "" } = {}) {
  if (gate) await gate();
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.warn(`  ! ${label || url}: ${err.message}`);
    return null;
  }
}

const finnhub = (p) =>
  getJSON(`https://finnhub.io/api/v1${p}${p.includes("?") ? "&" : "?"}token=${TOKEN}`,
          { gate: finnhubGate, label: `finnhub ${p.split("?")[0]}` });

const sec = (url, label) => getJSON(url, { headers: { "User-Agent": UA }, gate: secGate, label });

const numOrNull = (v) => (typeof v === "number" && isFinite(v) ? v : null);

function pickMetric(m, ...keys) {
  for (const k of keys) {
    const v = m?.[k];
    if (typeof v === "number" && isFinite(v)) return v;
  }
  return null;
}

/* ------------------------------------------------------ SEC XBRL via frames
   One request returns a given concept for every filer that reported it, so a
   handful of calls covers all 500 companies. */

const FRAME_CONCEPTS = [
  { key: "revenue",   tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], kind: "duration" },
  { key: "netIncome", tags: ["NetIncomeLoss"],                                     kind: "duration" },
  { key: "ocf",       tags: ["NetCashProvidedByUsedInOperatingActivities"],        kind: "duration" },
  { key: "capex",     tags: ["PaymentsToAcquirePropertyPlantAndEquipment"],        kind: "duration" },
  { key: "assets",    tags: ["Assets"],                                            kind: "instant"  },
  { key: "liabs",     tags: ["Liabilities"],                                       kind: "instant"  },
  { key: "equity",    tags: ["StockholdersEquity"],                                kind: "instant"  },
  { key: "cash",      tags: ["CashAndCashEquivalentsAtCarryingValue"],             kind: "instant"  },
  { key: "debt",      tags: ["LongTermDebtNoncurrent", "LongTermDebt"],            kind: "instant"  }
];

async function loadFrames(years) {
  /* cik -> { revenue: {2024: n, 2023: n}, ... } */
  const byCik = new Map();
  for (const concept of FRAME_CONCEPTS) {
    for (const year of years) {
      let filled = 0;
      for (const tag of concept.tags) {
        const period = concept.kind === "instant" ? `CY${year}Q4I` : `CY${year}`;
        const url = `https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${period}.json`;
        const json = await sec(url, `frames ${tag} ${period}`);
        if (!json?.data) continue;
        for (const row of json.data) {
          const cik = String(row.cik).padStart(10, "0");
          let rec = byCik.get(cik);
          if (!rec) { rec = {}; byCik.set(cik, rec); }
          rec[concept.key] ||= {};
          if (rec[concept.key][year] === undefined && numOrNull(row.val) !== null) {
            rec[concept.key][year] = row.val;
            filled++;
          }
        }
        if (filled > 300) break;  /* primary tag covered most filers */
      }
      console.log(`  frames ${concept.key} ${year}: ${filled} filers`);
    }
  }
  return byCik;
}

/* ------------------------------------------------------------ EDGAR filings */

function filingFromSubmissions(sub, cik, form) {
  const rec = sub?.filings?.recent;
  if (!rec?.form) return null;
  const i = rec.form.indexOf(form);
  if (i === -1) return null;
  const accRaw = rec.accessionNumber[i];
  const acc = accRaw.replace(/-/g, "");
  const doc = rec.primaryDocument[i];
  const bare = String(Number(cik));
  return {
    accession: accRaw,
    date: rec.filingDate[i],
    period: rec.reportDate[i] || null,
    url: doc ? `https://www.sec.gov/Archives/edgar/data/${bare}/${acc}/${doc}` : null,
    index: `https://www.sec.gov/Archives/edgar/data/${bare}/${acc}/`
  };
}

const stripTags = (html) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&#8217;|&rsquo;/gi, "’")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8212;|&mdash;/gi, "—").replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Slice the raw HTML between two Item headings, skipping the table of contents. */
function sliceItem(html, startRe, endRe) {
  const starts = [...html.matchAll(startRe)].map((m) => m.index);
  if (!starts.length) return null;
  /* the ToC mention comes first and is followed almost immediately by the next
     item, so prefer the last start that has a decent run of text after it */
  let best = null;
  for (const s of starts) {
    const rest = html.slice(s);
    const e = rest.search(endRe);
    const len = e === -1 ? rest.length : e;
    if (len > 3000 && (!best || len > best.len)) best = { s, len };
  }
  if (!best) return null;
  return html.slice(best.s, best.s + Math.min(best.len, 900000));
}

/** Bold / italic runs read as the risk-factor headings in nearly every 10-K. */
function headingsFrom(htmlChunk) {
  const out = [];
  const seen = new Set();
  const re = /<(b|strong|em|i)[^>]*>([\s\S]{0,600}?)<\/\1>/gi;
  let m;
  while ((m = re.exec(htmlChunk)) !== null) {
    const text = stripTags(m[2]);
    if (text.length < 35 || text.length > 220) continue;
    if (!/[a-z]/.test(text)) continue;                 /* skip ALL-CAPS headers */
    if (/^item\s+\d/i.test(text)) continue;
    if (/^(table of contents|part\s+[ivx]+)$/i.test(text)) continue;
    const key = text.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text.replace(/\s*[.;]\s*$/, ""));
    if (out.length >= 12) break;
  }
  return out;
}

async function fetchFilingDetail(ticker, tenK) {
  if (!tenK?.url) return null;
  const html = await getText(tenK.url, { headers: { "User-Agent": UA }, gate: secGate, label: `10-K ${ticker}` });
  if (!html || html.length < 5000) return null;

  const bizChunk = sliceItem(
    html,
    /item[\s ]*1[\s ]*[.:\-—]?[\s ]*(<[^>]*>[\s ]*)*business/gi,
    /item[\s ]*1a[\s ]*[.:\-—]?[\s ]*(<[^>]*>[\s ]*)*risk/i
  );
  const riskChunk = sliceItem(
    html,
    /item[\s ]*1a[\s ]*[.:\-—]?[\s ]*(<[^>]*>[\s ]*)*risk/gi,
    /item[\s ]*(1b|2)[\s ]*[.:\-—]/i
  );

  let business = null;
  if (bizChunk) {
    const text = stripTags(bizChunk).replace(/^item[\s ]*1[.:\-—\s]*business[\s.:-]*/i, "");
    /* skip boilerplate incorporation sentences, keep the first real paragraphs */
    business = text.slice(0, 900).replace(/\s+\S*$/, "") + (text.length > 900 ? "…" : "");
    if (business.length < 120) business = null;
  }

  const risks = riskChunk ? headingsFrom(riskChunk) : [];

  if (!business && !risks.length) return null;
  return { business, risks, source: tenK.url };
}

/* ------------------------------------------------------------------ pipeline */

async function main() {
  const started = Date.now();
  const universe = JSON.parse(await fs.readFile(path.join(DATA, "sp500.json"), "utf8"));
  let companies = universe.companies;
  if (LIMIT) companies = companies.slice(0, LIMIT);
  console.log(`Refreshing ${companies.length} companies\n`);

  /* --- upcoming earnings, one bulk call ---------------------------------- */
  const today = new Date();
  const in120 = new Date(today.getTime() + 120 * 864e5);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const cal = await finnhub(`/calendar/earnings?from=${fmt(today)}&to=${fmt(in120)}`);
  const earnings = new Map();
  for (const e of cal?.earningsCalendar || []) {
    if (!earnings.has(e.symbol)) {
      earnings.set(e.symbol, { date: e.date, epsEst: numOrNull(e.epsEstimate), hour: e.hour || null });
    }
  }
  console.log(`Earnings calendar: ${earnings.size} symbols\n`);

  /* --- SEC XBRL frames ---------------------------------------------------- */
  const year = today.getUTCFullYear();
  console.log("Loading SEC XBRL frames...");
  const frames = await loadFrames([year - 1, year - 2]);
  console.log(`Frames cover ${frames.size} filers\n`);

  await fs.mkdir(FILING_DIR, { recursive: true });

  const stocks = [];
  const skipped = [];
  let filingsFetched = 0, filingsCached = 0;

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    const tag = `[${String(i + 1).padStart(3)}/${companies.length}] ${c.t}`;

    /* -- market data -- */
    const [quote, metricRes] = await Promise.all([
      finnhub(`/quote?symbol=${encodeURIComponent(c.t)}`),
      finnhub(`/stock/metric?metric=all&symbol=${encodeURIComponent(c.t)}`)
    ]);

    if (!quote || !numOrNull(quote.c) || quote.c === 0) {
      console.log(`${tag}  skipped (no quote)`);
      skipped.push(c.t);
      continue;
    }
    const m = metricRes?.metric || {};

    /* -- SEC filing history -- */
    const sub = await sec(`https://data.sec.gov/submissions/CIK${c.cik}.json`, `submissions ${c.t}`);
    const tenK = sub ? filingFromSubmissions(sub, c.cik, "10-K") : null;
    const tenQ = sub ? filingFromSubmissions(sub, c.cik, "10-Q") : null;

    /* -- 10-K contents, cached by accession -- */
    let detail = null;
    const cachePath = path.join(FILING_DIR, `${c.t.replace(/[^A-Z0-9.]/gi, "_")}.json`);
    if (tenK) {
      let cached = null;
      try { cached = JSON.parse(await fs.readFile(cachePath, "utf8")); } catch { /* first run */ }
      if (cached?.accession === tenK.accession) {
        detail = cached.detail;
        filingsCached++;
      } else if (!SKIP_FILINGS) {
        detail = await fetchFilingDetail(c.t, tenK);
        if (detail) {
          await fs.writeFile(cachePath, JSON.stringify({ accession: tenK.accession, detail }));
          filingsFetched++;
        }
      }
    }

    const f = frames.get(c.cik) || {};
    const yr = (k) => f[k]?.[year - 1] ?? null;
    const prev = (k) => f[k]?.[year - 2] ?? null;
    const ocf = yr("ocf"), capex = yr("capex");

    stocks.push({
      t: c.t, n: c.n, s: c.s, cik: c.cik,

      price:  numOrNull(quote.c),
      change: numOrNull(quote.dp),
      open:   numOrNull(quote.o),
      prev:   numOrNull(quote.pc),

      mc:   pickMetric(m, "marketCapitalization"),
      pe:   pickMetric(m, "peTTM", "peBasicExclExtraTTM", "peAnnual"),
      peF:  pickMetric(m, "peNormalizedAnnual"),
      pb:   pickMetric(m, "pbQuarterly", "pbAnnual"),
      ps:   pickMetric(m, "psTTM", "psAnnual"),
      roe:  pickMetric(m, "roeTTM", "roeRfy"),
      roa:  pickMetric(m, "roaTTM", "roaRfy"),
      nm:   pickMetric(m, "netProfitMarginTTM", "netProfitMarginAnnual"),
      gm:   pickMetric(m, "grossMarginTTM", "grossMarginAnnual"),
      om:   pickMetric(m, "operatingMarginTTM", "operatingMarginAnnual"),
      rg:   pickMetric(m, "revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"),
      rg5:  pickMetric(m, "revenueGrowth5Y"),
      eg:   pickMetric(m, "epsGrowthTTMYoy", "epsGrowthQuarterlyYoy"),
      beta: pickMetric(m, "beta"),
      lo:   pickMetric(m, "52WeekLow"),
      hi:   pickMetric(m, "52WeekHigh"),
      dy:   pickMetric(m, "dividendYieldIndicatedAnnual", "currentDividendYieldTTM"),
      payout: pickMetric(m, "payoutRatioTTM", "payoutRatioAnnual"),
      de:   pickMetric(m, "totalDebt/totalEquityQuarterly", "totalDebt/totalEquityAnnual"),
      cr:   pickMetric(m, "currentRatioQuarterly", "currentRatioAnnual"),
      r4:   pickMetric(m, "4WeekPriceReturnDaily"),
      r13:  pickMetric(m, "13WeekPriceReturnDaily"),
      r26:  pickMetric(m, "26WeekPriceReturnDaily"),
      r52:  pickMetric(m, "52WeekPriceReturnDaily"),

      earnings: earnings.get(c.t) || null,

      fin: {
        revenue:  yr("revenue"),  revenuePrev:  prev("revenue"),
        netIncome: yr("netIncome"), netIncomePrev: prev("netIncome"),
        assets: yr("assets"), liabs: yr("liabs"), equity: yr("equity"),
        cash: yr("cash"), debt: yr("debt"),
        ocf, capex,
        fcf: ocf !== null && capex !== null ? ocf - capex : null,
        fy: year - 1
      },

      /* the 10-K prose lives in data/filings/<TICKER>.json and is lazy-loaded by
         the page — keeping it out of the snapshot keeps first paint fast */
      sec: {
        tenK: tenK && { date: tenK.date, period: tenK.period, url: tenK.url, index: tenK.index },
        tenQ: tenQ && { date: tenQ.date, period: tenQ.period, url: tenQ.url, index: tenQ.index },
        detail: !!(detail?.business || detail?.risks?.length)
      }
    });

    if ((i + 1) % 25 === 0 || i === companies.length - 1) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`${tag}  ok  (${stocks.length} built, ${mins} min elapsed)`);
    }
  }

  const withFilings = stocks.filter((s) => s.sec.detail).length;
  const snapshot = {
    updated: new Date().toISOString(),
    universe: "S&P 500",
    counts: {
      companies: stocks.length,
      skipped: skipped.length,
      withEarningsDate: stocks.filter((s) => s.earnings).length,
      withFilings,
      withFinancials: stocks.filter((s) => s.fin.revenue !== null).length
    },
    skipped,
    stocks
  };

  await fs.writeFile(path.join(DATA, "snapshot.json"), JSON.stringify(snapshot));
  console.log(
    `\nDone in ${((Date.now() - started) / 60000).toFixed(1)} min\n` +
    `  ${stocks.length} companies, ${skipped.length} skipped${skipped.length ? ` (${skipped.join(", ")})` : ""}\n` +
    `  ${snapshot.counts.withFinancials} with SEC financials, ${withFilings} with 10-K contents\n` +
    `  10-Ks: ${filingsFetched} downloaded, ${filingsCached} from cache`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
