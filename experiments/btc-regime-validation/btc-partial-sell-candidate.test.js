import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runFibRegimeStrategyFromCanonicalCsv } from "../btc-fib-regime-strategy.js";

const btcCsv = fs.readFileSync(
  new URL("./sources/btc-usd-bitstamp.csv", import.meta.url),
  "utf8"
);
const yahooCsv = fs.readFileSync(
  new URL("./sources/btc-usd-yahoo.csv", import.meta.url),
  "utf8"
);
const ethCsv = fs.readFileSync(
  new URL("./sources/eth-usd-yahoo.csv", import.meta.url),
  "utf8"
);

const candidate = {
  minWeeksAfterPeak: 6,
  sellConfirmationDrop: 0.3128902846388519,
  fibRetracement: 0.7420566088007763,
  buyZoneWeeks: 3,
  falseTopInvalidation: 0.9574644564429763,
  sellFraction: 0.7316690943087452,
};

test("partial-sell candidate preserves strong full-history BTC accumulation", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(
    btcCsv,
    candidate,
    { start: "2014-09-18" }
  );
  assert.ok(Math.abs(r.btcEquivalent - 5.225785549283843) < 1e-9);
});

test("partial-sell candidate remains stable across BTC provider on common window", () => {
  const y = runFibRegimeStrategyFromCanonicalCsv(
    yahooCsv,
    candidate,
    { start: "2014-09-18", end: "2023-07-20" }
  );
  const b = runFibRegimeStrategyFromCanonicalCsv(
    btcCsv,
    candidate,
    { start: "2014-09-18", end: "2023-07-20" }
  );

  assert.ok(Math.abs(b.btcEquivalent - 4.850144784468075) < 1e-9);
  assert.ok(Math.abs(y.btcEquivalent - 4.312071602820422) < 1e-9);
});

test("partial-sell candidate still accumulates ETH units without ETH-specific tuning", () => {
  const r = runFibRegimeStrategyFromCanonicalCsv(ethCsv, candidate);
  assert.ok(Math.abs(r.btcEquivalent - 2.9488548686729605) < 1e-9);
});
