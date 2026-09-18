import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseCanonicalMarketCsv,
  runFibRegimeStrategyFromCanonicalCsv,
} from "../btc-fib-regime-strategy.js";

const tslaCsv = fs.readFileSync(
  new URL("./sources/tsla-yahoo.csv", import.meta.url),
  "utf8"
);

test("TSLA source conforms to canonical market format", () => {
  const { metadata, bars } = parseCanonicalMarketCsv(tslaCsv);
  assert.equal(metadata.instrument, "TSLA");
  assert.equal(metadata.asset_class, "equity");
  assert.equal(metadata.interval, "1d");
  assert.ok(bars.length > 3600);
});

test("frozen Fib-regime strategy fails to preserve TSLA units on full history", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(tslaCsv);

  assert.ok(Math.abs(r.btcEquivalent - 0.0821751706832207) < 1e-9);
  assert.equal(r.finalState, "asset");
  assert.equal(r.trades.length, 28);
});

test("on BTC-era TSLA window the same strategy still loses TSLA units", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(
    tslaCsv,
    {},
    { start: "2014-09-18", end: "2024-11-29" }
  );

  assert.ok(Math.abs(r.btcEquivalent - 0.57937007047246) < 1e-9);
  assert.equal(r.trades.length, 18);
});
