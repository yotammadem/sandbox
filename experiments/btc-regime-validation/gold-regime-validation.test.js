import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseCanonicalMarketCsv,
  runFibRegimeStrategyFromCanonicalCsv,
} from "../btc-fib-regime-strategy.js";

const goldCsv = fs.readFileSync(
  new URL("./sources/gold-gc-f-yahoo.csv", import.meta.url),
  "utf8"
);

test("gold source conforms to canonical market format", () => {
  const { metadata, bars } = parseCanonicalMarketCsv(goldCsv);
  assert.equal(metadata.instrument, "GC=F");
  assert.equal(metadata.asset_class, "commodity_future");
  assert.equal(metadata.interval, "1d");
  assert.equal(metadata.timezone, "UTC");
  assert.ok(bars.length > 6000);
});

test("frozen BTC Fib-regime strategy does not generalize to gold on the full history", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(goldCsv);

  // Research snapshot, not a success criterion:
  // one gold unit starts as one unit, so < 1 means the switching logic lost units.
  assert.ok(Math.abs(r.btcEquivalent - 0.682179146251658) < 1e-9);
  assert.equal(r.trades.length, 2);
  assert.equal(r.trades[0].type, "SELL");
  assert.equal(r.trades[1].type, "REBUY_FALSE_TOP");
});

test("on the BTC-era gold window the frozen strategy makes no trades", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(
    goldCsv,
    {},
    { start: "2014-09-18", end: "2025-12-31" }
  );

  assert.ok(Math.abs(r.btcEquivalent - 1) < 1e-12);
  assert.equal(r.trades.length, 0);
});
