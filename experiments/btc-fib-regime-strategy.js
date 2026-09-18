/**
 * Deterministic Fib regime strategy research artifact.
 *
 * Frozen baseline parameters produced ~5.6 BTC-equivalent from a 1 BTC start
 * on the original Bitstamp BTC/USD study window. That result is in-sample and
 * may be overfit. No dates or BTC cycle labels are encoded in the rules.
 */

export const CANONICAL_MARKET_FORMAT = "market-ohlcv-v1";

export const DEFAULT_PARAMS = Object.freeze({
  minWeeksAfterPeak: 3,
  sellConfirmationDrop: 0.30,
  fibRetracement: 0.618,
  buyZoneWeeks: 6,
  falseTopInvalidation: 0.98,
  sellFraction: 1.0,
});

/**
 * Canonical CSV format:
 *
 * # format=market-ohlcv-v1
 * # source_provider=...
 * # instrument=...
 * # asset_class=...
 * # interval=1d
 * # timezone=UTC
 * date,open,high,low,close,volume
 *
 * Metadata lines start with '# key=value'. The data header is fixed.
 */
export function parseCanonicalMarketCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const metadata = {};
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#")) {
      const body = line.slice(1).trim();
      const eq = body.indexOf("=");
      if (eq > 0) {
        metadata[body.slice(0, eq).trim()] = body.slice(eq + 1).trim();
      }
      continue;
    }
    headerIndex = i;
    break;
  }

  if (metadata.format !== CANONICAL_MARKET_FORMAT) {
    throw new Error(`Unsupported market data format: ${metadata.format ?? "missing"}`);
  }
  if (headerIndex < 0) throw new Error("Missing CSV header.");

  const header = lines[headerIndex].trim();
  if (header !== "date,open,high,low,close,volume") {
    throw new Error(`Unexpected CSV header: ${header}`);
  }

  const bars = lines.slice(headerIndex + 1)
    .filter(Boolean)
    .map((line, row) => {
      const [date, open, high, low, close, volume] = line.split(",");
      const bar = {
        date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: volume === "" || volume == null ? null : Number(volume),
      };
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(bar.date) ||
        !Number.isFinite(bar.open) ||
        !Number.isFinite(bar.high) ||
        !Number.isFinite(bar.low) ||
        !Number.isFinite(bar.close)
      ) {
        throw new Error(`Invalid canonical OHLC row ${row + 1}: ${line}`);
      }
      return bar;
    });

  for (let i = 1; i < bars.length; i++) {
    if (bars[i].date <= bars[i - 1].date) {
      throw new Error(`Canonical rows must be strictly increasing by date: ${bars[i].date}`);
    }
  }

  return { metadata, bars };
}

export function runFibRegimeStrategyFromCanonicalCsv(csvText, overrides = {}, range = {}) {
  const { metadata, bars } = parseCanonicalMarketCsv(csvText);
  const start = range.start ?? "0000-00-00";
  const end = range.end ?? "9999-99-99";
  const filtered = bars.filter(x => x.date >= start && x.date <= end);
  return {
    metadata,
    ...runFibRegimeStrategy(aggregateDailyToWeekly(filtered), overrides),
  };
}

/**
 * Runs the deterministic strategy on Monday-based weekly bars.
 * Signals use the current completed weekly bar; execution is at next week's open.
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

      if (!sellSignal) continue;

      const executionPrice = next.open;
      const assetSold = asset * p.sellFraction;
      cash = assetSold * executionPrice;
      asset -= assetSold;
      state = "cash";
      frozenCycleLow = cycleLow;
      frozenPeak = peak;
      fibLevel = frozenPeak - p.fibRetracement * (frozenPeak - frozenCycleLow);
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
        sellFraction: p.sellFraction,
        assetSold,
        assetRetained: asset,
      });
      continue;
    }

    if (bar.high >= frozenPeak * p.falseTopInvalidation) {
      const executionPrice = next.open;
      asset += cash / executionPrice;
      cash = 0;
      state = "asset";

      trades.push({
        type: "REBUY_FALSE_TOP",
        signalWeek: bar.week,
        executionWeek: next.week,
        executionPrice,
        oldPeak: frozenPeak,
      });

      cycleLow = frozenCycleLow;
      peak = Math.max(frozenPeak, next.high);
      peakIndex = i + 1;
      frozenCycleLow = null;
      frozenPeak = null;
      fibLevel = null;
      consecutiveWeeksInBuyZone = 0;
      continue;
    }

    consecutiveWeeksInBuyZone =
      bar.close <= fibLevel ? consecutiveWeeksInBuyZone + 1 : 0;

    if (consecutiveWeeksInBuyZone < p.buyZoneWeeks) continue;

    const executionPrice = next.open;
    asset += cash / executionPrice;
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

    cycleLow = next.low;
    peak = next.high;
    peakIndex = i + 1;
    frozenCycleLow = null;
    frozenPeak = null;
    fibLevel = null;
    consecutiveWeeksInBuyZone = 0;
  }

  const finalPrice = bars[bars.length - 1].close;
  const btcEquivalent = asset + cash / finalPrice;

  return { btcEquivalent, finalState: state, asset, cash, trades };
}

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
        volume: d.volume ?? null,
      });
    } else {
      const w = weeks.get(week);
      w.high = Math.max(w.high, d.high);
      w.low = Math.min(w.low, d.low);
      w.close = d.close;
      if (w.volume != null && d.volume != null) w.volume += d.volume;
      else w.volume = null;
    }
  }

  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}
