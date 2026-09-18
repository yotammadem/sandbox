import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseCanonicalMarketCsv,
  aggregateDailyToWeekly,
  runFibRegimeStrategy,
  runFibRegimeStrategyFromCanonicalCsv,
} from "../btc-fib-regime-strategy.js";

const bitstampCsv = fs.readFileSync(
  new URL("./sources/btc-usd-bitstamp.csv", import.meta.url),
  "utf8"
);
const yahooCsv = fs.readFileSync(
  new URL("./sources/btc-usd-yahoo.csv", import.meta.url),
  "utf8"
);

const BASELINE = {
  minWeeksAfterPeak: 3,
  sellConfirmationDrop: 0.30,
  fibRetracement: 0.618,
  buyZoneWeeks: 6,
  falseTopInvalidation: 0.98,
};

test("BTC baseline remains strong across an independent provider on the common window", () => {
  const yahoo = parseCanonicalMarketCsv(yahooCsv);
  const end = yahoo.bars.at(-1).date;
  const range = { start: "2014-09-18", end };

  const bitstamp = runFibRegimeStrategyFromCanonicalCsv(bitstampCsv, BASELINE, range);
  const yahooResult = runFibRegimeStrategyFromCanonicalCsv(yahooCsv, BASELINE, range);

  assert.ok(Math.abs(bitstamp.btcEquivalent - 5.045598276852519) < 1e-9);
  assert.ok(Math.abs(yahooResult.btcEquivalent - 4.3808331750109675) < 1e-9);
});

test("BTC fixed six-year windows expose regime sensitivity without changing horizon length", () => {
  const expected = new Map([
    ["2014-09-18", 4.113941182282281],
    ["2015-09-18", 2.0844906713330333],
    ["2016-09-18", 3.676602957663684],
    ["2017-09-18", 3.5667781098503255],
    ["2018-09-18", 1.598842693326152],
    ["2019-09-18", 0.6388175992445518],
  ]);

  for (const [start, value] of expected) {
    const end = String(Number(start.slice(0,4)) + 6) + start.slice(4);
    const r = runFibRegimeStrategyFromCanonicalCsv(bitstampCsv, BASELINE, { start, end });
    assert.ok(Math.abs(r.btcEquivalent - value) < 1e-9, `${start} -> ${end}`);
  }
});

test("BTC parameter neighborhood snapshots nearby alternatives instead of only the selected point", () => {
  const cases = [
    [{ sellConfirmationDrop: 0.30, fibRetracement: 0.65, buyZoneWeeks: 4 }, 6.666800079083741],
    [{ sellConfirmationDrop: 0.30, fibRetracement: 0.55, buyZoneWeeks: 8 }, 6.28652074185086],
    [{ sellConfirmationDrop: 0.30, fibRetracement: 0.618, buyZoneWeeks: 6 }, 5.595159213136329],
    [{ sellConfirmationDrop: 0.30, fibRetracement: 0.618, buyZoneWeeks: 4 }, 4.8475916469715825],
    [{ sellConfirmationDrop: 0.30, fibRetracement: 0.70, buyZoneWeeks: 6 }, 2.9937357862760927],
  ];

  for (const [overrides, expected] of cases) {
    const r = runFibRegimeStrategyFromCanonicalCsv(
      bitstampCsv,
      { ...BASELINE, ...overrides },
      { start: "2014-09-18" }
    );
    assert.ok(Math.abs(r.btcEquivalent - expected) < 1e-9);
  }
});

function aggregateWithWeekStart(dailyBars, startDayUtc) {
  const weeks = new Map();
  for (const d of dailyBars) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const offset = (date.getUTCDay() - startDayUtc + 7) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    const week = date.toISOString().slice(0, 10);

    if (!weeks.has(week)) {
      weeks.set(week, { week, open: d.open, high: d.high, low: d.low, close: d.close });
    } else {
      const w = weeks.get(week);
      w.high = Math.max(w.high, d.high);
      w.low = Math.min(w.low, d.low);
      w.close = d.close;
    }
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

test("BTC result changes with weekly candle boundary, documenting sampling sensitivity", () => {
  const { bars } = parseCanonicalMarketCsv(bitstampCsv);
  const daily = bars.filter(x => x.date >= "2014-09-18");

  const sunday = runFibRegimeStrategy(aggregateWithWeekStart(daily, 0), BASELINE);
  const monday = runFibRegimeStrategy(aggregateDailyToWeekly(daily), BASELINE);
  const tuesday = runFibRegimeStrategy(aggregateWithWeekStart(daily, 2), BASELINE);

  assert.ok(Math.abs(sunday.btcEquivalent - 6.202915165078291) < 1e-9);
  assert.ok(Math.abs(monday.btcEquivalent - 5.595159213136329) < 1e-9);
  assert.ok(Math.abs(tuesday.btcEquivalent - 3.372254901999918) < 1e-9);
});
