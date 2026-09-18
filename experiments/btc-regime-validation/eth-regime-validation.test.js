import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseCanonicalMarketCsv,
  runFibRegimeStrategyFromCanonicalCsv,
} from "../btc-fib-regime-strategy.js";

const ethCsv = fs.readFileSync(
  new URL("./sources/eth-usd-yahoo.csv", import.meta.url),
  "utf8"
);

test("ETH source conforms to canonical market format", () => {
  const { metadata, bars } = parseCanonicalMarketCsv(ethCsv);
  assert.equal(metadata.instrument, "ETH/USD");
  assert.equal(metadata.asset_class, "crypto");
  assert.equal(metadata.interval, "1d");
  assert.equal(metadata.timezone, "UTC");
  assert.ok(bars.length > 1900);
});

test("frozen Fib-regime strategy materially increases ETH units on the frozen history", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(ethCsv);

  // Frozen cross-asset research snapshot. No ETH-specific tuning was applied.
  assert.ok(Math.abs(r.btcEquivalent - 5.733809547732596) < 1e-9);
  assert.equal(r.finalState, "asset");
  assert.equal(r.trades.length, 20);
});
