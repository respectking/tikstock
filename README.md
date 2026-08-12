# TikStock

Every company in the S&P 500, one card at a time. Each card puts the whole
picture in front of you — price, valuation, growth, margins, the balance sheet
as filed, the next earnings date, and what the company's own 10-K says about its
business and its risks — with the arguments for and against it laid out. Then you
decide: swipe right and it goes in your cart, left and it's gone.

**→ [Open it](https://respectking.github.io/tikstock/)**

> **Not investment advice.** Everything here is public data, presented plainly.
> It can be stale, mis-parsed or wrong. Read the actual filing before you buy.

---

## The idea

Most stock screeners either dump a spreadsheet on you or hand you a rating and
expect you to trust it. This does neither. There is **no score and no verdict** —
just the numbers a company reports, arranged so you can read them in about
fifteen seconds, and a pros/cons list where every line names the figure that
triggered it:

> ✓ Generated $108B of free cash flow in FY2025 — 28% of revenue.
> ✗ Very expensive at 62.4× earnings — years of growth are already in the price.

You can disagree with any threshold. The fact underneath it is still there, and
the raw number is in the table below it.

---

## What's on a card

| Section | What it holds |
|---|---|
| **Header** | Price, day move, market cap, position in the 52-week range |
| **Earnings** | Next reporting date, before/after the bell, consensus EPS |
| **For / against** | Up to six of each, derived from thresholds on the real figures |
| **The numbers** | P/E, P/B, P/S, revenue and EPS growth, three margin lines, ROE, debt/equity, current ratio, yield, beta, 3-month and 1-year returns |
| **Last full year, as filed** | Revenue, net income, operating cash flow, capex, free cash flow, cash, long-term debt, equity — straight from XBRL |
| **Straight from the 10-K** | The company's own description of what it does, the risk factors it lists, and links to the filing itself |

Scroll the card to read it all. Drag it sideways, use <kbd>←</kbd> / <kbd>→</kbd>,
or hit the buttons. <kbd>↑</kbd> / <kbd>↓</kbd> scroll.

## The cart

Swiping right stores the ticker, the price at the moment you added it, and a note
field. The cart shows what each pick has done since — so it doubles as a record
of what you were thinking and when. Export to CSV whenever.

Everything is in `localStorage`. No account, no backend, nothing leaves the browser.

---

## How the data gets here

A static site can't fetch this itself — SEC blocks cross-origin requests for
filings and XBRL, and an API key in client-side JavaScript is a public API key.
So the work happens in a **GitHub Action** that runs every weekday morning:

```
.github/workflows/refresh.yml  →  scripts/refresh.mjs
```

Which does:

1. **Finnhub** — `/quote` and `/stock/metric` per company, plus one bulk
   `/calendar/earnings` call for upcoming report dates. Rate-limited to stay
   inside the free tier's 60 calls/minute.
2. **SEC XBRL `frames`** — one request per concept returns that figure for *every*
   filer at once, so ~20 requests cover the balance sheet and cash flow for all 500.
3. **SEC EDGAR submissions** — the latest 10-K and 10-Q per company: accession
   number, filing date, period, direct link.
4. **The 10-K itself** — downloaded and parsed for Item 1 (Business) and the
   Item 1A risk-factor headings. Cached under `data/filings/<TICKER>.json` and
   keyed by accession number, so a filing is only ever downloaded once. After the
   first run this is a couple of documents a day, not five hundred.

Output lands in `data/snapshot.json` (market data, ~1MB) and
`data/filings/*.json` (10-K prose, lazy-loaded per card). The Action commits
both back to the repo; GitHub Pages serves them as static files.

### Setting it up on your own fork

1. Get a free key at [finnhub.io/register](https://finnhub.io/register).
2. **Settings → Secrets and variables → Actions → New repository secret**,
   named `FINNHUB_TOKEN`.
3. Optionally set a repository *variable* `SEC_USER_AGENT` to
   `Your Name your@email.com` — SEC asks that automated requests identify themselves.
4. **Actions → Refresh market data → Run workflow.** First run takes 30–60
   minutes because it downloads every 10-K; later runs are a few minutes.

The key never reaches the browser. That is the entire reason the pipeline works
this way.

Handy inputs when running it manually: `limit` (only process the first N
companies) and `skip_filings` (set to `1` to skip 10-K downloads).

---

## Running locally

```bash
git clone https://github.com/respectking/tikstock.git
cd tikstock
python3 -m http.server 8080
# open http://localhost:8080
```

The page needs `data/snapshot.json` to show anything; if it's missing you get a
setup screen instead. To build one yourself:

```bash
FINNHUB_TOKEN=xxx LIMIT=20 SKIP_FILINGS=1 node scripts/refresh.mjs
```

---

## The screens

Each one is a single rule, applied to the latest snapshot:

| Screen | Rule |
|---|---|
| Low P/E | trailing P/E below 15 and positive |
| Fast growing | revenue growth ≥ 15% year over year |
| High margin | net margin ≥ 18% |
| Pays 2%+ | indicated dividend yield ≥ 2% |
| Net cash | cash on hand exceeds long-term debt |
| Near 52wk low | price in the bottom quarter of its 52-week range |
| Earnings < 30d | next report within 30 days |
| Mega caps | market cap ≥ $200B |

Plus sector filters and a search box. Companies you have swiped are hidden until
you ask for them back.

---

## Known limits

- **The constituent list is a static file.** `data/sp500.json` is a point-in-time
  snapshot of the index. Companies that join or leave won't be picked up until
  someone edits it; tickers Finnhub can't price are logged as `skipped` in the
  snapshot and dropped from the deck.
- **10-K parsing is heuristic.** Finding "Item 1A" in a document that has no
  consistent markup across 500 filers means some companies parse cleanly and
  others don't. When parsing fails the card says so and links to the filing.
- **Ratios come from Finnhub, financials from SEC.** They cover different periods
  (trailing twelve months vs last fiscal year), so a margin in "The numbers"
  won't always reconcile with "Last full year, as filed". Both are labelled.
- **The pros and cons are thresholds, not analysis.** They have no view on
  management, competition, or anything that happened after the last filing.

---

## Design notes

Dark, one accent hue. Up and down moves carry a ▲/▼ glyph and a signed number as
well as colour, so nothing depends on colour alone. `prefers-reduced-motion` and
`forced-colors` are honoured. The swipe gesture locks to an axis on the first
8px of movement, so dragging sideways swipes and dragging vertically scrolls the
card.

No framework, no build step. Three files and some JSON.

## Licence

MIT — see [LICENSE](LICENSE).
