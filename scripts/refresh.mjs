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
  { key: "revenue",   tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"], kind: "duration" },
  { key: "netIncome", tags: ["NetIncomeLoss"],                                     kind: "duration" },
  { key: "ocf",       tags: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], kind: "duration" },
  { key: "capex",     tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], kind: "duration" },
  { key: "assets",    tags: ["Assets"],                                            kind: "instant"  },
  { key: "liabs",     tags: ["Liabilities"],                                       kind: "instant"  },
  { key: "equity",    tags: ["StockholdersEquity"],                                kind: "instant"  },
  { key: "cash",      tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], kind: "instant" },
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

/* Frames are organised by calendar year, so a filer whose fiscal year ends in
   August or November shows up in none of them. For those, ask for the concept
   directly and take the most recent annual figure they actually reported. */
async function conceptFallback(cik, concept) {
  for (const tag of concept.tags) {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`;
    const json = await sec(url, `concept ${tag}`);
    const units = json?.units?.USD;
    if (!units?.length) continue;

    const annual = units.filter((u) => {
      if (u.form !== "10-K" || !u.end) return false;
      if (concept.kind === "instant") return !u.start;
      if (!u.start) return false;
      const days = (new Date(u.end) - new Date(u.start)) / 864e5;
      return days > 300 && days < 400;          /* a full year, not a quarter */
    });
    if (!annual.length) continue;

    annual.sort((a, b) => (a.end < b.end ? 1 : -1));
    const latest = annual[0];
    const prior = annual.find((u) => u.end.slice(0, 4) === String(Number(latest.end.slice(0, 4)) - 1));
    return {
      value: numOrNull(latest.val),
      prior: prior ? numOrNull(prior.val) : null,
      fy: Number(latest.end.slice(0, 4))
    };
  }
  return null;
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

/* 10-K markup is wildly inconsistent between filers. Normalising the invisible
   whitespace entities first is what makes "Item&#160;1A." findable at all. */
function normalizeHtml(html) {
  return html.replace(/&nbsp;|&#160;|&#xa0;|&#xA0;/g, " ");
}

/* Build a regex for an Item heading that tolerates tags and entities appearing
   between every single token — "Item", "1A", the punctuation and the word. */
function itemRe(number, word, flags) {
  const gap = "(?:\\s|<[^>]*>)*";
  return new RegExp(`item${gap}${number}${gap}[.:\\-—]?${gap}${word}`, flags);
}

/** Slice the HTML between two Item headings, skipping the table of contents. */
function sliceItem(html, startRe, endRe, minLen = 1500) {
  const starts = [...html.matchAll(startRe)].map((m) => m.index);
  if (!starts.length) return null;
  /* the ToC mention comes first and is followed almost immediately by the next
     item, so prefer the start with the longest run of content after it */
  let best = null;
  for (const s of starts) {
    const rest = html.slice(s);
    const e = rest.search(endRe);
    const len = e === -1 ? rest.length : e;
    if (len > minLen && (!best || len > best.len)) best = { s, len };
  }
  if (!best) return null;
  return html.slice(best.s, best.s + Math.min(best.len, 1200000));
}

const BOILERPLATE = /^(table of contents|part\s+[ivx]+|item\s+\d|risk factors?|forward-looking|see also|index)/i;

function usableHeading(text) {
  if (text.length < 35 || text.length > 230) return false;
  if (!/[a-z]/.test(text)) return false;              /* skip ALL-CAPS chrome */
  if (BOILERPLATE.test(text)) return false;
  if (!/\s/.test(text)) return false;
  return true;
}

/** Risk-factor headings: bold/italic tags, or spans styled bold. */
function headingsFrom(chunk) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const text = stripTags(raw);
    if (!usableHeading(text)) return;
    const key = text.toLowerCase().slice(0, 60);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text.replace(/\s*[.;:]\s*$/, ""));
  };

  let m;
  const tagRe = /<(b|strong|em|i)[^>]*>([\s\S]{0,800}?)<\/\1>/gi;
  while ((m = tagRe.exec(chunk)) !== null && out.length < 14) push(m[2]);

  if (out.length < 3) {
    /* many filers style headings inline instead of using <b> */
    const styleRe = /<(span|p|div)[^>]*style="[^"]*font-(?:weight|style)\s*:\s*(?:bold|700|800|italic)[^"]*"[^>]*>([\s\S]{0,800}?)<\/\1>/gi;
    while ((m = styleRe.exec(chunk)) !== null && out.length < 14) push(m[2]);
  }

  if (out.length < 3) {
    /* last resort: pull sentences that actually state a risk */
    const text = stripTags(chunk);
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const t = s.trim().replace(/\s*[.;:]\s*$/, "");
      if (t.length < 60 || t.length > 230) continue;
      if (!/\b(could|may|might|risk|adversely|failure|unable|depend)\b/i.test(t)) continue;
      if (BOILERPLATE.test(t)) continue;
      const key = t.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= 10) break;
    }
  }

  return out;
}

async function fetchFilingDetail(ticker, tenK) {
  if (!tenK?.url) return null;
  const raw = await getText(tenK.url, { headers: { 'User-Agent': UA }, gate: secGate, label: `10-K ${ticker}` });
  if (!raw || raw.length < 5000) return null;
  const html = normalizeHtml(raw);

  const bizChunk = sliceItem(html, itemRe('1', 'business', 'gi'), itemRe('1a', 'risk', 'i'));

  let riskChunk = sliceItem(html, itemRe('1a', 'risk', 'gi'), itemRe('(?:1b|2)', '[a-z]', 'i'));
  if (!riskChunk) {
    /* some filers never write "Item 1A" in the body — find the section heading */
    riskChunk = sliceItem(html, /risk\s*factors/gi, itemRe('(?:1b|2)', '[a-z]', 'i'));
  }

  let business = null;
  if (bizChunk) {
    const text = stripTags(bizChunk)
      .replace(/^item\s*1\s*[.:\-—]?\s*business[\s.:-]*/i, '')
      .replace(/^general[\s.:-]*/i, '');
    business = text.slice(0, 950).replace(/\s+\S*$/, '') + (text.length > 950 ? '…' : '');
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
  const horizon = new Date(today.getTime() + 200 * 864e5);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const cal = await finnhub(`/calendar/earnings?from=${fmt(today)}&to=${fmt(horizon)}`);
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
  let filingsFetched = 0, filingsCached = 0, fellBack = 0;

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

    /* The bulk calendar only carries dates that are already announced, which is
       a minority of the index at any moment. Ask per symbol for the rest. */
    if (!earnings.has(c.t)) {
      const one = await finnhub(`/calendar/earnings?symbol=${encodeURIComponent(c.t)}&from=${fmt(today)}&to=${fmt(horizon)}`);
      const row = one?.earningsCalendar?.[0];
      if (row?.date) {
        earnings.set(c.t, { date: row.date, epsEst: numOrNull(row.epsEstimate), hour: row.hour || null });
      }
    }

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
    let yr = (k) => f[k]?.[year - 1] ?? null;
    let prev = (k) => f[k]?.[year - 2] ?? null;
    let finFy = year - 1;

    /* A filer with a non-calendar fiscal year appears in no CY frame. Ask for
       its concepts directly rather than showing a card with no financials. */
    if (yr("revenue") === null && yr("netIncome") === null) {
      const direct = {};
      for (const concept of FRAME_CONCEPTS) {
        const hit = await conceptFallback(c.cik, concept);
        if (hit) { direct[concept.key] = hit; finFy = hit.fy || finFy; }
      }
      if (Object.keys(direct).length) {
        yr = (k) => direct[k]?.value ?? f[k]?.[year - 1] ?? null;
        prev = (k) => direct[k]?.prior ?? f[k]?.[year - 2] ?? null;
        fellBack++;
      }
    }

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
        fy: finFy
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
    `  10-Ks: ${filingsFetched} downloaded, ${filingsCached} from cache
` +
    `  ${fellBack} companies needed a direct XBRL lookup (non-calendar fiscal year)`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
