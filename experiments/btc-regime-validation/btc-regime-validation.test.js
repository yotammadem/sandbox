import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { aggregateDailyToWeekly, runFibRegimeStrategy } from "../btc-fib-regime-strategy.js";

function parseYahoo(csv) {
  return csv.trim().split(/\r?\n/).slice(1).map(line => {
    const [date, open, high, low, close] = line.split(",");
    const [m, d, y] = date.split("/").map(Number);
    return {
      date: `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`,
      open: Number(open), high: Number(high), low: Number(low), close: Number(close)
    };
  });
}

function parseBitstamp(csv) {
  return csv.trim().split(/\r?\n/).slice(1).map(line => {
    const [datetime, open, high, low, close] = line.split(",");
    return {
      date: datetime.slice(0,10),
      open: Number(open), high: Number(high), low: Number(low), close: Number(close)
    };
  });
}

function run(daily, start, end) {
  const filtered = daily.filter(x => x.date >= start && x.date <= end);
  return runFibRegimeStrategy(aggregateDailyToWeekly(filtered));
}

test("frozen strategy is reasonably stable across Bitstamp vs Yahoo Finance BTC data", () => {
  const yahoo = parseYahoo(fs.readFileSync(new URL("./data/BTC-USD-yahoo-2014-2023.csv", import.meta.url), "utf8"));
  const bitstamp = parseBitstamp(fs.readFileSync(new URL("./data/BTCUSD-bitstamp-2012-2026.csv", import.meta.url), "utf8"));

  const start = "2014-09-18";
  const end = yahoo.at(-1).date; // 2023-07-20

  const y = run(yahoo, start, end);
  const b = run(bitstamp, start, end);

  // Frozen expected values for the current strategy and frozen datasets.
  assert.ok(Math.abs(y.btcEquivalent - 4.3808331750109675) < 1e-9);
  assert.ok(Math.abs(b.btcEquivalent - 5.045598276852519) < 1e-9);

  // Cross-provider robustness guardrail: same rules should retain most of the edge.
  assert.ok(y.btcEquivalent >= b.btcEquivalent * 0.80);
});
