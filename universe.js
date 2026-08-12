/* ==========================================================================
   TikStock — demo universe
   --------------------------------------------------------------------------
   These figures are ILLUSTRATIVE PLACEHOLDERS, not market data. They exist so
   the deck is playable the moment the page loads, before anyone connects an
   API key. The UI labels this state "demo data" on purpose.

   Add a Finnhub key in Settings and every field below is replaced with live
   values fetched in the browser.

   Fields
     t    ticker            p    last price (USD)      pe   trailing P/E
     n    company name      d    day change %          pb   price / book
     s    sector            mc   market cap ($B)       roe  return on equity %
     nm   net margin %      rg   revenue growth % YoY  eg   EPS growth % YoY
     beta 5y beta           lo   52-week low           hi   52-week high
     dy   dividend yield %  r13  13-week return %      r52  52-week return %
   ========================================================================== */

window.SS_UNIVERSE = {
  note: "Illustrative placeholder figures — connect a Finnhub key for live data.",
  stocks: [
    { t:"AAPL", n:"Apple Inc.",                    s:"Technology",   p:232.10, d:0.62,  mc:3510, pe:35.2, pb:52.1, roe:151.0, nm:26.3, rg:6.1,  eg:9.4,  beta:1.12, lo:169.2, hi:260.1, dy:0.44, r13:5.2,  r52:18.4 },
    { t:"MSFT", n:"Microsoft Corporation",         s:"Technology",   p:441.85, d:-0.31, mc:3285, pe:34.8, pb:11.6, roe:35.2,  nm:36.1, rg:14.8, eg:17.2, beta:0.92, lo:352.4, hi:498.0, dy:0.72, r13:2.8,  r52:11.6 },
    { t:"NVDA", n:"NVIDIA Corporation",            s:"Technology",   p:128.44, d:2.14,  mc:3160, pe:48.6, pb:44.9, roe:106.4, nm:52.4, rg:61.3, eg:74.5, beta:1.68, lo:86.6,  hi:153.1, dy:0.03, r13:12.4, r52:32.9 },
    { t:"GOOGL",n:"Alphabet Inc.",                 s:"Technology",   p:181.22, d:0.44,  mc:2210, pe:23.1, pb:6.9,  roe:31.6,  nm:28.4, rg:13.2, eg:24.1, beta:1.03, lo:130.7, hi:207.0, dy:0.44, r13:6.7,  r52:22.1 },
    { t:"AMZN", n:"Amazon.com, Inc.",              s:"Consumer",     p:186.40, d:1.07,  mc:1950, pe:38.4, pb:7.6,  roe:21.8,  nm:8.0,  rg:11.6, eg:38.2, beta:1.14, lo:143.8, hi:242.5, dy:0.00, r13:-1.9, r52:9.8  },
    { t:"META", n:"Meta Platforms, Inc.",          s:"Technology",   p:562.10, d:-0.88, mc:1420, pe:26.4, pb:8.4,  roe:34.1,  nm:35.6, rg:19.4, eg:31.7, beta:1.21, lo:414.5, hi:740.9, dy:0.37, r13:-4.1, r52:14.2 },
    { t:"BRK.B",n:"Berkshire Hathaway Inc.",       s:"Financials",   p:466.30, d:0.19,  mc:1005, pe:14.2, pb:1.62, roe:12.4,  nm:20.1, rg:3.4,  eg:-6.8, beta:0.85, lo:395.1, hi:542.1, dy:0.00, r13:1.4,  r52:8.6  },
    { t:"TSLA", n:"Tesla, Inc.",                   s:"Consumer",     p:243.75, d:-2.41, mc:785,  pe:78.9, pb:12.4, roe:16.2,  nm:7.1,  rg:1.2,  eg:-21.4,beta:2.31, lo:167.4, hi:488.5, dy:0.00, r13:-9.6, r52:-11.2},
    { t:"LLY",  n:"Eli Lilly and Company",         s:"Healthcare",   p:812.40, d:0.73,  mc:772,  pe:62.1, pb:44.2, roe:74.8,  nm:22.4, rg:29.1, eg:41.6, beta:0.42, lo:678.1, hi:972.5, dy:0.66, r13:3.1,  r52:6.4  },
    { t:"JPM",  n:"JPMorgan Chase & Co.",          s:"Financials",   p:224.60, d:0.51,  mc:632,  pe:12.6, pb:2.15, roe:17.4,  nm:33.2, rg:9.1,  eg:12.3, beta:1.08, lo:179.2, hi:248.0, dy:2.22, r13:4.6,  r52:19.7 },
    { t:"V",    n:"Visa Inc.",                     s:"Financials",   p:296.15, d:0.28,  mc:576,  pe:30.4, pb:14.9, roe:50.2,  nm:54.1, rg:10.4, eg:14.1, beta:0.94, lo:252.7, hi:337.8, dy:0.71, r13:2.2,  r52:10.4 },
    { t:"UNH",  n:"UnitedHealth Group Inc.",       s:"Healthcare",   p:298.40, d:-1.12, mc:271,  pe:14.8, pb:3.24, roe:22.1,  nm:3.9,  rg:7.8,  eg:-14.2,beta:0.61, lo:248.9, hi:630.7, dy:2.92, r13:-18.4,r52:-46.1},
    { t:"XOM",  n:"Exxon Mobil Corporation",       s:"Energy",       p:114.20, d:0.94,  mc:492,  pe:14.1, pb:1.94, roe:13.8,  nm:9.4,  rg:1.1,  eg:-8.4, beta:0.88, lo:97.8,  hi:126.3, dy:3.46, r13:3.8,  r52:2.1  },
    { t:"JNJ",  n:"Johnson & Johnson",             s:"Healthcare",   p:161.80, d:0.36,  mc:390,  pe:16.4, pb:5.62, roe:32.4,  nm:18.1, rg:4.2,  eg:6.1,  beta:0.51, lo:140.7, hi:171.2, dy:3.14, r13:5.9,  r52:9.4  },
    { t:"WMT",  n:"Walmart Inc.",                  s:"Consumer",     p:96.40,  d:0.42,  mc:775,  pe:38.2, pb:8.94, roe:23.4,  nm:2.8,  rg:5.4,  eg:11.2, beta:0.61, lo:66.1,  hi:105.3, dy:0.96, r13:6.1,  r52:36.4 },
    { t:"PG",   n:"Procter & Gamble Company",      s:"Consumer",     p:167.90, d:-0.14, mc:395,  pe:25.6, pb:7.81, roe:31.2,  nm:18.4, rg:2.1,  eg:4.6,  beta:0.42, lo:150.3, hi:180.4, dy:2.42, r13:1.2,  r52:2.8  },
    { t:"MA",   n:"Mastercard Incorporated",       s:"Financials",   p:512.30, d:0.61,  mc:470,  pe:36.1, pb:58.4, roe:187.4, nm:45.2, rg:12.1, eg:16.4, beta:1.05, lo:428.9, hi:583.0, dy:0.55, r13:1.9,  r52:12.7 },
    { t:"HD",   n:"The Home Depot, Inc.",          s:"Consumer",     p:372.10, d:0.24,  mc:370,  pe:25.4, pb:64.2, roe: null,   nm:9.4,  rg:2.4,  eg:-1.8, beta:1.02, lo:323.8, hi:439.4, dy:2.44, r13:-2.4, r52:1.4  },
    { t:"AVGO", n:"Broadcom Inc.",                 s:"Technology",   p:172.40, d:1.84,  mc:806,  pe:74.2, pb:14.1, roe:22.4,  nm:14.2, rg:43.1, eg:-2.4, beta:1.19, lo:119.8, hi:251.9, dy:1.24, r13:7.4,  r52:24.1 },
    { t:"COST", n:"Costco Wholesale Corporation",  s:"Consumer",     p:892.40, d:0.31,  mc:396,  pe:52.4, pb:16.8, roe:31.4,  nm:2.9,  rg:6.8,  eg:9.4,  beta:0.79, lo:748.2, hi:1078.2,dy:0.51, r13:-1.4, r52:8.9  },
    { t:"ABBV", n:"AbbVie Inc.",                   s:"Healthcare",   p:186.20, d:0.58,  mc:329,  pe:61.4, pb:38.2, roe:52.1,  nm:6.4,  rg:4.1,  eg:-18.4,beta:0.61, lo:155.1, hi:218.7, dy:3.42, r13:2.1,  r52:6.1  },
    { t:"KO",   n:"The Coca-Cola Company",         s:"Consumer",     p:69.40,  d:0.11,  mc:299,  pe:26.1, pb:10.4, roe:41.2,  nm:22.4, rg:3.1,  eg:7.4,  beta:0.58, lo:60.6,  hi:74.4,  dy:2.86, r13:1.8,  r52:6.2  },
    { t:"PEP",  n:"PepsiCo, Inc.",                 s:"Consumer",     p:142.10, d:-0.42, mc:195,  pe:21.4, pb:9.61, roe:44.2,  nm:9.8,  rg:0.4,  eg:-2.1, beta:0.52, lo:127.6, hi:180.9, dy:3.84, r13:-1.1, r52:-12.4},
    { t:"MRK",  n:"Merck & Co., Inc.",             s:"Healthcare",   p:82.40,  d:0.24,  mc:207,  pe:12.1, pb:4.42, roe:38.4,  nm:25.1, rg:1.8,  eg:14.2, beta:0.42, lo:73.3,  hi:118.4, dy:3.94, r13:0.4,  r52:-22.1},
    { t:"CRM",  n:"Salesforce, Inc.",              s:"Technology",   p:262.40, d:1.12,  mc:251,  pe:42.1, pb:4.62, roe:11.4,  nm:16.1, rg:8.4,  eg:24.1, beta:1.28, lo:212.0, hi:369.0, dy:0.62, r13:-3.8, r52:-4.2 },
    { t:"AMD",  n:"Advanced Micro Devices, Inc.",  s:"Technology",   p:142.60, d:2.64,  mc:231,  pe:96.4, pb:4.12, roe:4.8,   nm:8.4,  rg:24.1, eg:88.4, beta:1.94, lo:76.5,  hi:187.3, dy:0.00, r13:14.2, r52:8.4  },
    { t:"NFLX", n:"Netflix, Inc.",                 s:"Communication",p:712.40, d:-1.24, mc:304,  pe:44.2, pb:14.8, roe:36.1,  nm:22.4, rg:15.6, eg:52.1, beta:1.24, lo:542.0, hi:1341.2,dy:0.00, r13:-6.4, r52:1.9  },
    { t:"ADBE", n:"Adobe Inc.",                    s:"Technology",   p:412.10, d:-0.64, mc:176,  pe:28.4, pb:12.1, roe:44.2,  nm:26.1, rg:10.2, eg:12.4, beta:1.32, lo:332.0, hi:587.8, dy:0.00, r13:-8.1, r52:-24.6},
    { t:"CSCO", n:"Cisco Systems, Inc.",           s:"Technology",   p:57.20,  d:0.34,  mc:228,  pe:24.1, pb:5.14, roe:21.4,  nm:14.1, rg:5.4,  eg:-8.1, beta:0.84, lo:44.5,  hi:68.4,  dy:2.82, r13:2.4,  r52:16.4 },
    { t:"BAC",  n:"Bank of America Corporation",   s:"Financials",   p:44.10,  d:0.72,  mc:335,  pe:13.4, pb:1.28, roe:9.8,   nm:24.1, rg:6.4,  eg:8.1,  beta:1.32, lo:33.1,  hi:50.1,  dy:2.36, r13:5.1,  r52:14.8 },
    { t:"WFC",  n:"Wells Fargo & Company",         s:"Financials",   p:72.40,  d:0.41,  mc:236,  pe:13.1, pb:1.42, roe:11.2,  nm:22.4, rg:2.1,  eg:4.6,  beta:1.14, lo:53.8,  hi:84.2,  dy:2.21, r13:3.4,  r52:12.1 },
    { t:"ORCL", n:"Oracle Corporation",            s:"Technology",   p:184.20, d:1.42,  mc:518,  pe:48.1, pb:32.4, roe:112.4, nm:19.4, rg:9.1,  eg:11.4, beta:1.14, lo:118.9, hi:260.9, dy:1.08, r13:8.4,  r52:30.4 },
    { t:"ACN",  n:"Accenture plc",                 s:"Technology",   p:312.40, d:-0.24, mc:196,  pe:26.4, pb:7.42, roe:27.1,  nm:11.2, rg:4.1,  eg:6.4,  beta:1.18, lo:275.0, hi:398.3, dy:1.94, r13:-2.1, r52:-8.4 },
    { t:"MCD",  n:"McDonald's Corporation",        s:"Consumer",     p:296.10, d:0.18,  mc:212,  pe:24.8, pb: null,    roe: null,     nm:31.2, rg:1.4,  eg:2.1,  beta:0.72, lo:243.5, hi:326.3, dy:2.42, r13:1.4,  r52:4.6  },
    { t:"CVX",  n:"Chevron Corporation",           s:"Energy",       p:154.20, d:1.14,  mc:311,  pe:16.4, pb:1.72, roe:10.4,  nm:8.1,  rg:-1.2, eg:-14.1,beta:0.94, lo:132.0, hi:169.0, dy:4.42, r13:4.1,  r52:-2.4 },
    { t:"TMO",  n:"Thermo Fisher Scientific Inc.", s:"Healthcare",   p:542.10, d:0.42,  mc:206,  pe:32.4, pb:4.12, roe:13.1,  nm:15.4, rg:1.1,  eg:2.4,  beta:0.86, lo:385.5, hi:627.9, dy:0.31, r13:6.4,  r52:-4.1 },
    { t:"ABT",  n:"Abbott Laboratories",           s:"Healthcare",   p:132.40, d:0.28,  mc:230,  pe:16.4, pb:4.82, roe:30.1,  nm:31.4, rg:6.1,  eg:8.4,  beta:0.72, lo:113.0, hi:141.2, dy:1.82, r13:3.1,  r52:14.1 },
    { t:"LIN",  n:"Linde plc",                     s:"Materials",    p:462.10, d:0.14,  mc:220,  pe:33.1, pb:5.42, roe:16.8,  nm:18.4, rg:1.4,  eg:6.1,  beta:0.94, lo:408.0, hi:487.5, dy:1.31, r13:2.4,  r52:5.8  },
    { t:"DIS",  n:"The Walt Disney Company",       s:"Communication",p:96.20,  d:-0.84, mc:174,  pe:36.1, pb:1.94, roe:5.4,   nm:6.1,  rg:2.8,  eg:82.1, beta:1.42, lo:80.1,  hi:124.7, dy:1.04, r13:-4.1, r52:-6.4 },
    { t:"INTC", n:"Intel Corporation",             s:"Technology",   p:22.40,  d:-1.84, mc:96,   pe: null,    pb:0.94, roe:-14.2, nm:-18.4,rg:-3.1, eg:-142.0,beta:1.14,lo:17.7,  hi:37.2,  dy:0.00, r13:-8.4, r52:-26.1},
    { t:"PFE",  n:"Pfizer Inc.",                   s:"Healthcare",   p:26.10,  d:0.34,  mc:148,  pe:17.4, pb:1.62, roe:9.4,   nm:14.1, rg:6.4,  eg:112.0,beta:0.62, lo:20.9,  hi:31.5,  dy:6.44, r13:1.1,  r52:-8.4 },
    { t:"T",    n:"AT&T Inc.",                     s:"Communication",p:28.40,  d:0.24,  mc:204,  pe:16.1, pb:1.82, roe:11.4,  nm:9.4,  rg:0.4,  eg:6.1,  beta:0.58, lo:21.4,  hi:29.8,  dy:3.92, r13:4.1,  r52:24.6 },
    { t:"VZ",   n:"Verizon Communications Inc.",   s:"Communication",p:42.10,  d:0.14,  mc:177,  pe:10.1, pb:1.72, roe:17.4,  nm:13.1, rg:1.1,  eg:4.2,  beta:0.42, lo:37.6,  hi:47.4,  dy:6.42, r13:1.4,  r52:5.1  },
    { t:"NKE",  n:"NIKE, Inc.",                    s:"Consumer",     p:74.20,  d:-1.14, mc:110,  pe:32.1, pb:8.42, roe:26.4,  nm:6.8,  rg:-9.1, eg:-42.1,beta:1.08, lo:52.3,  hi:90.6,  dy:2.14, r13:6.4,  r52:-14.2},
    { t:"SBUX", n:"Starbucks Corporation",         s:"Consumer",     p:86.40,  d:0.42,  mc:98,   pe:34.1, pb: null,    roe: null,     nm:6.1,  rg:-1.4, eg:-24.1,beta:0.96, lo:75.5,  hi:117.5, dy:2.82, r13:-3.1, r52:-6.4 },
    { t:"BA",   n:"The Boeing Company",            s:"Industrials",  p:182.40, d:1.24,  mc:137,  pe: null,    pb: null,    roe: null,     nm:-11.4,rg:18.4, eg:42.1, beta:1.62, lo:128.9, hi:242.7, dy:0.00, r13:8.1,  r52:12.4 },
    { t:"CAT",  n:"Caterpillar Inc.",              s:"Industrials",  p:392.10, d:0.64,  mc:187,  pe:17.4, pb:9.42, roe:56.1,  nm:16.4, rg:-1.1, eg:2.4,  beta:1.14, lo:267.3, hi:442.0, dy:1.44, r13:6.1,  r52:14.8 },
    { t:"GE",   n:"GE Aerospace",                  s:"Industrials",  p:242.10, d:0.94,  mc:259,  pe:38.4, pb:11.2, roe:32.4,  nm:18.1, rg:9.4,  eg:41.2, beta:1.24, lo:161.0, hi:288.0, dy:0.42, r13:9.4,  r52:34.1 },
    { t:"HON",  n:"Honeywell International Inc.",  s:"Industrials",  p:212.40, d:0.24,  mc:137,  pe:23.1, pb:7.14, roe:32.1,  nm:15.4, rg:4.1,  eg:6.4,  beta:1.02, lo:186.1, hi:242.8, dy:2.14, r13:1.4,  r52:2.1  },
    { t:"UPS",  n:"United Parcel Service, Inc.",   s:"Industrials",  p:88.40,  d:-1.42, mc:75,   pe:16.1, pb:5.82, roe:34.1,  nm:6.1,  rg:0.4,  eg:-14.2,beta:1.06, lo:82.1,  hi:148.0, dy:7.42, r13:-9.1, r52:-32.4},
    { t:"QCOM", n:"QUALCOMM Incorporated",         s:"Technology",   p:158.20, d:1.04,  mc:174,  pe:16.4, pb:6.82, roe:41.2,  nm:26.1, rg:9.1,  eg:22.4, beta:1.28, lo:120.8, hi:182.1, dy:2.24, r13:4.1,  r52:-2.1 },
    { t:"TXN",  n:"Texas Instruments Incorporated",s:"Technology",   p:198.40, d:0.44,  mc:181,  pe:36.4, pb:10.4, roe:28.4,  nm:31.2, rg:2.1,  eg:-4.1, beta:1.02, lo:139.9, hi:221.0, dy:2.76, r13:2.1,  r52:-1.4 },
    { t:"AMAT", n:"Applied Materials, Inc.",       s:"Technology",   p:182.10, d:1.64,  mc:147,  pe:21.4, pb:8.42, roe:41.4,  nm:27.1, rg:6.1,  eg:9.4,  beta:1.62, lo:123.7, hi:255.9, dy:0.98, r13:9.4,  r52:-2.4 },
    { t:"NOW",  n:"ServiceNow, Inc.",              s:"Technology",   p:892.40, d:1.14,  mc:184,  pe:118.4,pb:19.4, roe:17.4,  nm:14.2, rg:21.4, eg:28.1, beta:1.02, lo:678.7, hi:1198.1,dy:0.00, r13:4.1,  r52:6.1  },
    { t:"ISRG", n:"Intuitive Surgical, Inc.",      s:"Healthcare",   p:512.40, d:0.84,  mc:183,  pe:68.4, pb:8.12, roe:13.1,  nm:28.4, rg:17.1, eg:24.2, beta:1.42, lo:425.0, hi:616.0, dy:0.00, r13:3.4,  r52:8.4  },
    { t:"BKNG", n:"Booking Holdings Inc.",         s:"Consumer",     p:5124.0, d:0.62,  mc:169,  pe:32.1, pb: null,    roe: null,     nm:24.1, rg:11.4, eg:18.4, beta:1.32, lo:4185.0,hi:5839.0,dy:0.72, r13:1.1,  r52:12.4 },
    { t:"GS",   n:"The Goldman Sachs Group, Inc.", s:"Financials",   p:612.40, d:0.94,  mc:188,  pe:14.8, pb:1.92, roe:13.4,  nm:26.4, rg:12.1, eg:24.1, beta:1.34, lo:439.0, hi:690.0, dy:2.02, r13:6.4,  r52:22.1 },
    { t:"BLK",  n:"BlackRock, Inc.",               s:"Financials",   p:1042.0, d:0.34,  mc:161,  pe:23.4, pb:3.42, roe:14.8,  nm:31.4, rg:12.4, eg:14.1, beta:1.28, lo:773.0, hi:1156.0,dy:2.02, r13:3.1,  r52:12.8 },
    { t:"SPGI", n:"S&P Global Inc.",               s:"Financials",   p:512.10, d:0.14,  mc:157,  pe:38.4, pb:4.12, roe:11.4,  nm:29.4, rg:9.1,  eg:16.4, beta:1.14, lo:435.0, hi:545.0, dy:0.76, r13:2.1,  r52:2.4  },
    { t:"COIN", n:"Coinbase Global, Inc.",         s:"Financials",   p:242.10, d:3.84,  mc:61,   pe:32.4, pb:5.82, roe:24.1,  nm:38.4, rg:41.2, eg:112.0,beta:3.42, lo:142.6, hi:444.6, dy:0.00, r13:14.1, r52:6.4  },
    { t:"SHOP", n:"Shopify Inc.",                  s:"Technology",   p:112.40, d:2.14,  mc:145,  pe:78.4, pb:11.2, roe:16.4,  nm:18.1, rg:26.4, eg:48.1, beta:2.42, lo:69.0,  hi:129.4, dy:0.00, r13:11.4, r52:24.1 },
    { t:"UBER", n:"Uber Technologies, Inc.",       s:"Technology",   p:82.40,  d:1.24,  mc:172,  pe:16.1, pb:9.42, roe:64.1,  nm:22.4, rg:16.1, eg:141.0,beta:1.42, lo:54.8,  hi:97.7,  dy:0.00, r13:8.1,  r52:18.4 },
    { t:"PLTR", n:"Palantir Technologies Inc.",    s:"Technology",   p:142.10, d:2.94,  mc:336,  pe:462.0,pb:64.1, roe:14.2,  nm:24.1, rg:48.1, eg:96.4, beta:2.64, lo:66.1,  hi:190.0, dy:0.00, r13:18.4, r52:112.4}
  ]
};
