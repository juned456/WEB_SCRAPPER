const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildNotificationMessage,
  deriveCircuitBand,
  diffStockLists,
  formatStockPairs,
  formatTradingViewList,
  formatTradingViewSymbol,
  getThreeYearIpoWindow,
  isExcludedCircuitBand,
  isWithinIpoWindow,
  parseIpoCompanyClassification,
  parseIpoListingDate,
  parsePriceBandCsv,
  parseRecentIpoHtml,
  parseSecuritySeries,
  parseSecurityPriceRanges,
  splitMessage,
} = require("./monitor");

const previous = [
  { symbol: "OLD", name: "Old Limited" },
  { symbol: "KEEP", name: "Keep Industries" },
];
const current = [
  { symbol: "KEEP", name: "Keep Industries" },
  { symbol: "NEW", name: "New Limited" },
  { symbol: "514448", name: "BSE Company" },
];

test("detects added and deleted compliant stocks", () => {
  const difference = diffStockLists(previous, current);
  assert.deepEqual(difference.added, [
    { symbol: "514448", name: "BSE Company" },
    { symbol: "NEW", name: "New Limited" },
  ]);
  assert.deepEqual(difference.removed, [
    { symbol: "OLD", name: "Old Limited" },
  ]);
});

test("does not report a change when the symbol set is unchanged", () => {
  const difference = diffStockLists(previous, [...previous].reverse());
  assert.deepEqual(difference, { added: [], removed: [] });
});

test("formats readable and TradingView lists", () => {
  assert.equal(
    formatStockPairs(current),
    "514448 BSE Company, KEEP Keep Industries, NEW New Limited"
  );
  assert.equal(
    formatTradingViewList(current),
    "BSE:514448,NSE:KEEP,NSE:NEW"
  );
});

test("uses Musaffa exchange metadata for an alphanumeric BSE symbol", () => {
  assert.equal(
    formatTradingViewSymbol({
      symbol: "BSEONLY",
      musaffaSymbol: "BSEONLY.BO",
    }),
    "BSE:BSEONLY"
  );
});

test("notification includes additions, deletions, and complete updated list", () => {
  const difference = diffStockLists(previous, current);
  const message = buildNotificationMessage({
    ...difference,
    current,
  });
  assert.match(message, /Added \(2\): 514448 BSE Company, NEW New Limited/);
  assert.match(message, /Deleted \(1\): OLD Old Limited/);
  assert.match(message, /Updated list: 514448 BSE Company/);
  assert.match(message, /TradingView: BSE:514448,NSE:KEEP,NSE:NEW/);
});

test("splits long push messages without losing content", () => {
  const message = Array.from({ length: 50 }, (_, index) => `STOCK${index}`)
    .join(", ");
  const chunks = splitMessage(message, 80);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
  assert.equal(chunks.join(", "), message);
});

test("parses the official NSE price-band list and prefers EQ series", () => {
  const bands = parsePriceBandCsv(
    [
      "Symbol,Series,Security Name,Band,Remarks",
      "LOW2,BE,Low Band Limited,5,-",
      "LOW2,EQ,Low Band Limited,2,-",
      "KEEP,EQ,Keep Limited,20,-",
      "NOBAND,EQ,No Band Limited,No Band,-",
    ].join("\n")
  );

  assert.deepEqual(bands.get("LOW2"), {
    band: 2,
    series: "EQ",
    source: "NSE_PRICE_BAND_LIST",
  });
  assert.equal(bands.get("KEEP").band, 20);
  assert.equal(bands.has("NOBAND"), false);
});

test("derives standard circuit bands from MII price ranges", () => {
  assert.equal(deriveCircuitBand("98.00-102.00"), 2);
  assert.equal(deriveCircuitBand("95.00-105.00"), 5);
  assert.equal(deriveCircuitBand("80.00-120.00"), 20);
  assert.equal(deriveCircuitBand("invalid"), null);

  const bands = parseSecurityPriceRanges(
    [
      "FinInstrmId,TckrSymb,SctySrs,FinInstrmNm,PricRg",
      "1,BSELOW,EQ,BSE Low Band,95.00-105.00",
      "2,BSEKEEP,EQ,BSE Keep,80.00-120.00",
    ].join("\n")
  );
  assert.equal(bands.get("BSELOW").band, 5);
  assert.equal(bands.get("BSEKEEP").band, 20);
});

test("excludes only 2 and 5 percent circuit bands", () => {
  assert.equal(isExcludedCircuitBand(2), true);
  assert.equal(isExcludedCircuitBand({ band: 5 }), true);
  assert.equal(isExcludedCircuitBand(10), false);
  assert.equal(isExcludedCircuitBand(20), false);
  assert.equal(isExcludedCircuitBand(null), false);
});

test("parses IPO dates and enforces the rolling three-year window", () => {
  const now = new Date("2026-08-02T12:00:00Z");
  assert.deepEqual(getThreeYearIpoWindow(now), {
    start: "2023-08-02",
    end: "2026-08-02",
  });
  assert.equal(parseIpoListingDate("01 Aug 2026", now), "2026-08-01");
  assert.equal(parseIpoListingDate("today", now), "2026-08-02");
  assert.equal(parseIpoListingDate("tomorrow", now), null);
  assert.equal(isWithinIpoWindow("2023-08-02", now), true);
  assert.equal(isWithinIpoWindow("2023-08-01", now), false);
});

test("parses listed IPO rows and skips future, old, and symbol-less entries", () => {
  const now = new Date("2026-08-02T12:00:00Z");
  const html = `
    <table class="data-table"><tbody>
      <tr><td><a href="/company/NEWIPO/">New IPO</a></td><td>01 Aug 2026</td><td>1,500</td><td>100</td><td>125</td><td>25%</td></tr>
      <tr><td><a href="/company/FUTURE/">Future IPO</a></td><td>tomorrow</td><td>500</td><td></td><td></td><td></td></tr>
      <tr><td><a href="/company/OLDIPO/">Old IPO</a></td><td>01 Aug 2023</td><td>400</td><td>50</td><td>80</td><td>60%</td></tr>
      <tr><td><a href="/company/id/123/">No Symbol</a></td><td>01 Aug 2026</td><td>800</td><td></td><td></td><td></td></tr>
    </tbody></table>`;
  assert.deepEqual(parseRecentIpoHtml(html, now), [
    {
      symbol: "NEWIPO",
      name: "New IPO",
      listingDate: "2026-08-01",
      ipoMarketCap: "1,500",
      ipoPrice: "100",
      currentPrice: "125",
      changePercent: "25%",
      screenerUrl: "https://www.screener.in/company/NEWIPO/",
    },
  ]);
});

test("detects SME company pages and extracts BSE symbols", () => {
  const sme = parseIpoCompanyClassification(`
    <a href="https://www.bseindia.com/stock-share-price/example/EXAMPLE/544001/">
      BSE - SME:
    </a>`);
  assert.deepEqual(sme, {
    isMainboard: false,
    exchange: "BSE",
    alternateSymbol: "EXAMPLE",
    source: "SCREENER_COMPANY_PAGE",
  });

  const mainboard = parseIpoCompanyClassification(`
    <a href="https://www.bseindia.com/stock-share-price/example/EXAMPLE/544001/">
      BSE:
    </a>`);
  assert.equal(mainboard.isMainboard, true);
});

test("prefers the EQ series when parsing the security master", () => {
  const series = parseSecuritySeries(
    [
      "FinInstrmId,TckrSymb,SctySrs,FinInstrmNm",
      "1,MAIN,BE,Mainboard Limited",
      "2,MAIN,EQ,Mainboard Limited",
      "3,SMEIPO,SM,SME Limited",
    ].join("\n")
  );
  assert.equal(series.get("MAIN"), "EQ");
  assert.equal(series.get("SMEIPO"), "SM");
});

test("accepts mainboard trade-to-trade equity series but excludes SME series", async () => {
  const { ShariaMonitor } = require("./monitor");
  const temporaryDirectory = require("node:fs").mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "ipo-series-")
  );
  const monitor = new ShariaMonitor({
    dbPath: require("node:path").join(temporaryDirectory, "test.sqlite"),
  });

  try {
    const be = await monitor.classifyIpo(
      { symbol: "MAINBE" },
      new Map([["MAINBE", "BE"]])
    );
    const sme = await monitor.classifyIpo(
      { symbol: "SMEIPO" },
      new Map([["SMEIPO", "SM"]])
    );
    assert.equal(be.isMainboard, true);
    assert.equal(sme.isMainboard, false);
  } finally {
    monitor.stop();
  }
});

test("first IPO scan keeps a new stock as unknown when Musaffa has no status", async () => {
  const { ShariaMonitor } = require("./monitor");
  const temporaryDirectory = require("node:fs").mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "ipo-first-run-")
  );
  const monitor = new ShariaMonitor({
    dbPath: require("node:path").join(temporaryDirectory, "test.sqlite"),
  });

  monitor.fetchAllRecentIpos = async () => [
    {
      symbol: "NEWIPO",
      name: "New IPO",
      listingDate: "2026-08-01",
      screenerUrl: "https://www.screener.in/company/NEWIPO/",
    },
  ];
  monitor.getCachedSecuritySeries = () => new Map([["NEWIPO", "EQ"]]);
  monitor.fetchMusaffaDoc = async () => ({
    doc: null,
    symbol: "NEWIPO.NS",
    errors: ["not found"],
  });

  try {
    const stocks = await monitor.buildIpoStocks([]);
    assert.equal(stocks.length, 1);
    assert.equal(stocks[0].compliance, "UNKNOWN");
    assert.equal(stocks[0].verification, "LOOKUP_FAILED");
  } finally {
    monitor.stop();
  }
});
