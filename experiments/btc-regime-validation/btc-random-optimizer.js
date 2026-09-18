import fs from "node:fs";
import {
  parseCanonicalMarketCsv,
  aggregateDailyToWeekly,
  runFibRegimeStrategy,
} from "../btc-fib-regime-strategy.js";

const csv = fs.readFileSync(
  new URL("./sources/btc-usd-bitstamp.csv", import.meta.url),
  "utf8"
);

const { bars: daily } = parseCanonicalMarketCsv(csv);

function addMonths(s, n) {
  const d = new Date(s + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function addYears(s, n) {
  const d = new Date(s + "T00:00:00Z");
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + n);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function makeWindows(years, stepMonths) {
  const out = [];
  let start = "2014-09-18";
  const last = daily.at(-1).date;

  while (true) {
    const end = addYears(start, years);
    if (end > last) break;
    const subset = daily.filter(x => x.date >= start && x.date <= end);
    out.push({ start, end, weekly: aggregateDailyToWeekly(subset) });
    start = addMonths(start, stepMonths);
  }
  return out;
}

function q(values, p) {
  const s = [...values].sort((a, b) => a - b);
  const x = (s.length - 1) * p;
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (x - lo);
}

function metrics(values) {
  return {
    min: Math.min(...values),
    q10: q(values, 0.10),
    median: q(values, 0.50),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    pctAbove1: values.filter(x => x > 1).length / values.length,
  };
}

function robustScore(m) {
  return 2 * m.min + 1.5 * m.q10 + 0.5 * m.median + 0.5 * m.pctAbove1;
}

function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function evaluate(params, windows) {
  const values = windows.map(w => runFibRegimeStrategy(w.weekly, params).btcEquivalent);
  return metrics(values);
}

const monthly = [
  ...makeWindows(4, 1),
  ...makeWindows(6, 1),
  ...makeWindows(8, 1),
];
const trainMonthly = monthly.filter(w => w.end <= "2022-12-31");
const holdoutMonthly = monthly.filter(w => w.end > "2022-12-31");

// Stage 1 uses sparse yearly-start training windows for speed.
// Only finalists are re-ranked on every monthly training window.
const coarseTrain = [
  ...makeWindows(4, 12),
  ...makeWindows(6, 12),
  ...makeWindows(8, 12),
].filter(w => w.end <= "2022-12-31");

const random = mulberry32(0xB17C01);
const candidateCount = Number(process.env.CANDIDATES ?? 50000);
const keepAfterCoarse = Number(process.env.KEEP_AFTER_COARSE ?? 300);
const finalistsCount = Number(process.env.FINALISTS ?? 50);

let candidates = [];

for (let i = 0; i < candidateCount; i++) {
  const params = {
    minWeeksAfterPeak: 2 + Math.floor(random() * 5),
    sellConfirmationDrop: 0.22 + random() * 0.16,
    fibRetracement: 0.50 + random() * 0.25,
    buyZoneWeeks: 3 + Math.floor(random() * 8),
    falseTopInvalidation: 0.95 + random() * 0.06,
  };

  const coarse = evaluate(params, coarseTrain);
  const score = robustScore(coarse);

  if (candidates.length < keepAfterCoarse || score > candidates.at(-1).coarseScore) {
    candidates.push({ params, coarseScore: score });
    candidates.sort((a, b) => b.coarseScore - a.coarseScore);
    if (candidates.length > keepAfterCoarse) candidates.pop();
  }
}

for (const c of candidates) {
  c.train = evaluate(c.params, trainMonthly);
  c.trainScore = robustScore(c.train);
}
candidates.sort((a, b) => b.trainScore - a.trainScore);

const finalists = candidates.slice(0, finalistsCount);
for (const c of finalists) {
  c.holdout = evaluate(c.params, holdoutMonthly);
  c.all = evaluate(c.params, monthly);
}

const baselineParams = {
  minWeeksAfterPeak: 3,
  sellConfirmationDrop: 0.30,
  fibRetracement: 0.618,
  buyZoneWeeks: 6,
  falseTopInvalidation: 0.98,
};

const report = {
  seed: "0xB17C01",
  candidateCount,
  windows: {
    coarseTrain: coarseTrain.length,
    trainMonthly: trainMonthly.length,
    holdoutMonthly: holdoutMonthly.length,
    allMonthly: monthly.length,
  },
  scoreFormula: "2*min + 1.5*q10 + 0.5*median + 0.5*pctAbove1",
  baseline: {
    params: baselineParams,
    train: evaluate(baselineParams, trainMonthly),
    holdout: evaluate(baselineParams, holdoutMonthly),
    all: evaluate(baselineParams, monthly),
  },
  finalists,
};

console.log(JSON.stringify(report, null, 2));
