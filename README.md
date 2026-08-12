# TikStock

A Tinder-style deck for the stock market. Swipe **right** if you're bullish,
**left** if you'd pass — then the card flips over and shows a fundamentals score
out of 100, a breakdown of how it got there, and whether your gut agreed with the
numbers. Keep a streak going.

**→ [Play it](https://respectking.github.io/tikstock/)**

> **Not investment advice.** The score is a toy model built from public
> fundamentals. It does not predict returns and nobody should trade on it.

---

## What it does

- **Swipe deck** — drag the card, tap the buttons, or use <kbd>←</kbd> /
  <kbd>→</kbd>. <kbd>↑</kbd> skips a stock without scoring it.
- **Fundamentals score** — a 0–100 blend of five factors, shown as a gauge plus
  per-factor meters, so you can see *why* a stock scored the way it did.
- **Agreement tracking** — every swipe is compared against the model's stance.
  Your hit rate and current streak live in the header; the full history is under
  **My list**.
- **Universes** — filter the deck to mega caps, tech, dividend payers, or
  high-beta names.
- **Live data, optional** — paste a free Finnhub key and every figure comes from
  the live API instead of the bundled demo file.

Everything is stored in your own browser (`localStorage`). There is no backend
and no account.

---

## The score

Five factors, each mapped to 0–100 through a piecewise curve, then blended by
weight. If an input is missing the factor is dropped and the remaining weights
are renormalised — a stock is never penalised for a gap in the data.

| Factor | Weight | Built from |
|---|---|---|
| Profitability | 24% | return on equity, net margin |
| Value | 22% | trailing P/E, price / book |
| Growth | 22% | revenue growth YoY (double-weighted), EPS growth YoY |
| Momentum | 18% | position in the 52-week range, 13-week and 52-week returns |
| Stability | 14% | beta, width of the 52-week band, dividend yield |

The model takes a stance only at the edges — **≥ 62 is bullish, ≤ 42 is
bearish**, and anything between is an honest "no call" that counts as a push
rather than a miss.

The curves live in `app.js` under `SCORING` and are deliberately readable. If you
disagree with the shape of one, change the knots — the whole thing is about
thirty lines.

### What it is not

It is a static snapshot scorer. It has no view on the business, the management,
the competitive position, or anything that happened after the last reported
quarter. Two stocks with identical ratios score identically. That's the joke.

---

## Live data

The bundled figures in `universe.js` are **illustrative placeholders**, not
market data — the app says so on screen while it's in demo mode. To get real
numbers:

1. Grab a free key at [finnhub.io/register](https://finnhub.io/register).
2. Open **Settings → Live market data**, paste it, hit **Save**.

The key is stored in your browser's `localStorage` and sent only to `finnhub.io`.
It never touches a server of mine, because there isn't one.

Three endpoints are used per stock — `/quote`, `/stock/profile2` and
`/stock/metric` — all available on the free tier, which allows 60 calls/minute.
The app pre-fetches a few cards ahead, so swiping stays instant, and falls back
to the demo row for any ticker the API can't serve.

Because this is a purely client-side app, **a key pasted here is visible to
anyone with access to that browser profile.** Use a free key, and revoke it from
the Finnhub dashboard when you're done.

---

## Running it locally

No build step, no dependencies. It's three files and a data file.

```bash
git clone https://github.com/respectking/tikstock.git
cd tikstock
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` straight off the filesystem mostly works, but a local server
avoids `file://` quirks.

---

## Publishing

The repo is already a valid GitHub Pages site — static files at the root, plus a
`.nojekyll` so nothing gets swallowed by the Jekyll build.

**Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.**

Live at [respectking.github.io/tikstock](https://respectking.github.io/tikstock/).

---

## Adding stocks

`universe.js` is one array of plain objects. Add a row and it shows up in
the deck:

```js
{ t:"TICK", n:"Company Name", s:"Sector", p:100.00, d:0.5, mc:120,
  pe:22.4, pb:4.1, roe:18.2, nm:12.4, rg:8.1, eg:11.2,
  beta:1.05, lo:78.0, hi:131.0, dy:1.2, r13:4.1, r52:9.8 }
```

Use `null` for anything you don't have. In live mode only the `t`, `n` and `s`
fields matter — everything else is replaced by the API — so a new ticker just
needs those three plus enough placeholder numbers to keep the demo mode honest.

---

## Design notes

Dark-first, one accent hue. The score gauge, the factor meters and the 52-week
range all use a **single blue ramp** because they encode magnitude, not identity
— a rainbow across five meters would imply the factors are different *kinds* of
thing rather than different amounts of the same 0–100 scale.

Up and down moves use green and red, but **never colour alone**: every delta
carries a ▲/▼ glyph and a signed number, and the swipe stamps pair their colour
with an arrow icon and the words "Bullish" / "Pass". The full stat table under
the gauge is the accessible view of everything the meters show.

`prefers-reduced-motion` and `forced-colors` are both honoured.

---

## Browser support

Any current browser. It uses pointer events, `<dialog>`, and CSS custom
properties — no polyfills, no transpiling, no IE.

## Licence

MIT — see [LICENSE](LICENSE).
