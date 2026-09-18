import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseCanonicalMarketCsv,
  runFibRegimeStrategyFromCanonicalCsv,
} from "../btc-fib-regime-strategy.js";

const solCsv = fs.readFileSync(
  new URL("./sources/sol-usdt-binance.csv", import.meta.url),
  "utf8"
);

test("SOL source conforms to canonical market format", () => {
  const { metadata, bars } = parseCanonicalMarketCsv(solCsv);
  assert.equal(metadata.instrument, "SOL/USDT");
  assert.equal(metadata.asset_class, "crypto");
  assert.equal(metadata.source_provider, "Binance");
  assert.equal(metadata.interval, "1d");
  assert.equal(metadata.timezone, "UTC");
  assert.ok(bars.length > 1900);
});

test("frozen Fib-regime strategy loses SOL units on frozen Binance history", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(solCsv);

  // Frozen cross-asset research snapshot. No SOL-specific tuning was applied.
  assert.ok(Math.abs(r.btcEquivalent - 0.3376868349323999) < 1e-9);
  assert.equal(r.finalState, "cash");
  assert.equal(r.trades.length, 25);
});
