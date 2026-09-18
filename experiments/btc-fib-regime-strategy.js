/**
 * BTC Fib Regime Strategy
 *
 * Deterministic state machine extracted from the backtest that reached
 * ~5.6 BTC-equivalent from a 1 BTC start on Bitstamp BTC/USD history
 * (2014-09-18 through 2026-09-17), before fees/tax/slippage/cash yield.
 *
 * IMPORTANT:
 * - This is a research artifact, not investment advice.
 * - The ~5.6x result is in-sample and may be overfit.
 * - No dates or BTC-cycle labels are encoded in the rules.
 *
 * Weekly bars expected:
 * {
 *   week: "YYYY-MM-DD",   // week start
 *   open: number,
 *   high: number,
 *   low: number,
 *   close: number
 * }
 *
 * Strategy parameters used for the ~5.6x run:
 * - sellConfirmationDrop = 0.30
 * - fibRetracement = 0.618
 * - buyZoneWeeks = 6
 * - falseTopInvalidation = 0.98
 *
 * Interpretation:
 * 1. While holding the asset, track the current cycle peak and cycle low.
 * 2. A SELL occurs after the market has moved at least 30% below that peak.
 *    In the original experiment the signal was also required to be at least
 *    3 weeks after the peak, to avoid reacting to the same weekly bar.
 * 3. At SELL time, freeze the prior cycle low and peak and compute:
 *
 *      fibLevel = peak - 0.618 * (peak - cycleLow)
 *
 * 4. While in cash:
 *    - If price returns to >= 98% of the old peak before a durable deep zone
 *      is established, treat the sell as a false top and rebuy.
 *    - Otherwise, count consecutive weekly closes at or below fibLevel.
 *    - After 6 consecutive weeks in that zone, BUY at next week's open.
 *
 * The strategy intentionally does NOT wait for a breakout from the buy zone.
 */

export const DEFAULT_PARAMS = Object.freeze({
  minWeeksAfterPeak: 3,
  sellConfirmationDrop: 0.30,
  fibRetracement: 0.618,
  buyZoneWeeks: 6,
  falseTopInvalidation: 0.98,
});

/**
 * Runs the deterministic strategy.
 *
 * Trades are executed at the next week's open after a signal, which avoids
 * using the same close that generated the signal as the execution price.
 *
 * @param {Array<{week:string,open:number,high:number,low:number,close:number}>} bars
 * @param {Partial<typeof DEFAULT_PARAMS>} overrides
 * @returns {{
 *   btcEquivalent:number,
 *   finalState:"asset"|"cash",
 *   asset:number,
 *   cash:number,
 *   trades:Array<object>
 * }}
 */
export function runFibRegimeStrategy(bars, overrides = {}) {
  if (!Array.isArray(bars) || bars.length < 2) {
    throw new Error("At least two weekly bars are required.");
  }

  const p = { ...DEFAULT_PARAMS, ...overrides };

  let state = "asset";
  let asset = 1;
  let cash = 0;

  let cycleLow = bars[0].low;
  let peak = bars[0].high;
  let peakIndex = 0;

  let frozenCycleLow = null;
  let frozenPeak = null;
  let fibLevel = null;
  let consecutiveWeeksInBuyZone = 0;

  const trades = [];

  for (let i = 1; i < bars.length - 1; i++) {
    const bar = bars[i];
    const next = bars[i + 1];

    if (state === "asset") {
      cycleLow = Math.min(cycleLow, bar.low);

      if (bar.high > peak) {
        peak = bar.high;
        peakIndex = i;
      }

      const weeksSincePeak = i - peakIndex;
      const drawdownFromPeak = 1 - bar.close / peak;

      const sellSignal =
        weeksSincePeak >= p.minWeeksAfterPeak &&
        drawdownFromPeak >= p.sellConfirmationDrop;

      if (!sellSignal) {
        continue;
      }

      const executionPrice = next.open;

      cash = asset * executionPrice;
      asset = 0;
      state = "cash";

      frozenCycleLow = cycleLow;
      frozenPeak = peak;
      fibLevel =
        frozenPeak -
        p.fibRetracement * (frozenPeak - frozenCycleLow);

      consecutiveWeeksInBuyZone = 0;

      trades.push({
        type: "SELL",
        signalWeek: bar.week,
        executionWeek: next.week,
        executionPrice,
        peak: frozenPeak,
        cycleLow: frozenCycleLow,
        drawdownFromPeak,
        fibLevel,
      });

      continue;
    }

    // CASH state

    // False-top protection:
    // if price effectively retakes the previous peak before we establish a
    // durable deep retracement zone, admit that the sell was likely premature.
    if (bar.high >= frozenPeak * p.falseTopInvalidation) {
      const executionPrice = next.open;

      asset = cash / executionPrice;
      cash = 0;
      state = "asset";

      trades.push({
        type: "REBUY_FALSE_TOP",
        signalWeek: bar.week,
        executionWeek: next.week,
        executionPrice,
        oldPeak: frozenPeak,
      });

      // Preserve the prior cycle context because this was not considered
      // a completed bear/buy-zone cycle.
      cycleLow = frozenCycleLow;
      peak = Math.max(frozenPeak, next.high);
      peakIndex = i + 1;

      frozenCycleLow = null;
      frozenPeak = null;
      fibLevel = null;
      consecutiveWeeksInBuyZone = 0;

      continue;
    }

    if (bar.close <= fibLevel) {
      consecutiveWeeksInBuyZone += 1;
    } else {
      consecutiveWeeksInBuyZone = 0;
    }

    if (consecutiveWeeksInBuyZone < p.buyZoneWeeks) {
      continue;
    }

    const executionPrice = next.open;

    asset = cash / executionPrice;
    cash = 0;
    state = "asset";

    trades.push({
      type: "BUY_ZONE",
      signalWeek: bar.week,
      executionWeek: next.week,
      executionPrice,
      fibLevel,
      consecutiveWeeksInBuyZone,
    });

    // A durable deep zone completed the previous cycle.
    // Start measuring the next one from here.
    cycleLow = next.low;
    peak = next.high;
    peakIndex = i + 1;

    frozenCycleLow = null;
    frozenPeak = null;
    fibLevel = null;
    consecutiveWeeksInBuyZone = 0;
  }

  const finalPrice = bars[bars.length - 1].close;
  const btcEquivalent =
    state === "asset" ? asset : cash / finalPrice;

  return {
    btcEquivalent,
    finalState: state,
    asset,
    cash,
    trades,
  };
}

/**
 * Optional helper to aggregate daily OHLC rows into Monday-based weekly bars.
 *
 * Daily rows:
 * { date: "YYYY-MM-DD", open, high, low, close }
 */
export function aggregateDailyToWeekly(dailyBars) {
  const weeks = new Map();

  for (const d of dailyBars) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    const week = date.toISOString().slice(0, 10);

    if (!weeks.has(week)) {
      weeks.set(week, {
        week,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      });
    } else {
      const w = weeks.get(week);
      w.high = Math.max(w.high, d.high);
      w.low = Math.min(w.low, d.low);
      w.close = d.close;
    }
  }

  return [...weeks.values()].sort((a, b) =>
    a.week.localeCompare(b.week)
  );
}
