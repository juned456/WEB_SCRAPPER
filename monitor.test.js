const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildNotificationMessage,
  diffStockLists,
  formatStockPairs,
  formatTradingViewList,
  formatTradingViewSymbol,
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
