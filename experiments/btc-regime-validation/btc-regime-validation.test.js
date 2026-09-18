import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CANONICAL_MARKET_FORMAT,
  parseCanonicalMarketCsv,
  runFibRegimeStrategyFromCanonicalCsv,
} from "../btc-fib-regime-strategy.js";

const yahooCsv = fs.readFileSync(
  new URL("./sources/btc-usd-yahoo.csv", import.meta.url),
  "utf8"
);
const bitstampCsv = fs.readFileSync(
  new URL("./sources/btc-usd-bitstamp.csv", import.meta.url),
  "utf8"
);

test("canonical source files carry provenance metadata and a stable schema", () => {
  for (const csv of [yahooCsv, bitstampCsv]) {
    const { metadata, bars } = parseCanonicalMarketCsv(csv);
    assert.equal(metadata.format, CANONICAL_MARKET_FORMAT);
    assert.equal(metadata.instrument, "BTC/USD");
    assert.equal(metadata.interval, "1d");
    assert.equal(metadata.timezone, "UTC");
    assert.ok(metadata.source_provider);
    assert.ok(metadata.source_repository);
    assert.ok(bars.length > 1000);
    assert.ok(bars.every(x => Number.isFinite(x.open) && Number.isFinite(x.close)));
  }
});

test("frozen strategy remains reasonably stable across independent BTC providers", () => {
  const start = "2014-09-18";
  const yahoo = parseCanonicalMarketCsv(yahooCsv);
  const end = yahoo.bars.at(-1).date; // 2023-07-20

  const y = runFibRegimeStrategyFromCanonicalCsv(yahooCsv, {}, { start, end });
  const b = runFibRegimeStrategyFromCanonicalCsv(bitstampCsv, {}, { start, end });

  // Frozen expected values for current strategy + frozen source files.
  assert.ok(Math.abs(y.btcEquivalent - 4.3808331750109675) < 1e-9);
  assert.ok(Math.abs(b.btcEquivalent - 5.045598276852519) < 1e-9);

  // Provider perturbation guardrail: retain at least 80% of baseline edge.
  assert.ok(y.btcEquivalent >= b.btcEquivalent * 0.80);
});

test("canonical strategy execution is next-week-open, never same-bar close", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(bitstampCsv, {}, {
    start: "2014-09-18",
    end: "2023-07-20",
  });
  assert.ok(r.trades.length > 0);
  for (const trade of r.trades) {
    assert.notEqual(trade.signalWeek, trade.executionWeek);
  }
});
