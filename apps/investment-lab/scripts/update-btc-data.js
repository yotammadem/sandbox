import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const csvPath = fileURLToPath(
  new URL('../../../experiments/btc-regime-validation/sources/btc-usd-bitstamp.csv', import.meta.url)
);
const endpoint =
  'https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&exclude_current_candle=true';

const text = await readFile(csvPath, 'utf8');
const lines = text.trimEnd().split(/\r?\n/);
const headerIndex = lines.findIndex(line => line === 'date,open,high,low,close,volume');
if (headerIndex < 0) throw new Error('BTC CSV header not found');

const dataLines = lines.slice(headerIndex + 1).filter(Boolean);
if (!dataLines.length) throw new Error('BTC CSV contains no candles');

const latestDate = dataLines.at(-1).split(',', 1)[0];
if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) {
  throw new Error(`Invalid latest BTC date: ${latestDate}`);
}

const response = await fetch(endpoint, {
  headers: { 'user-agent': 'yotammadem/sandbox investment-lab data refresh' }
});
if (!response.ok) {
  throw new Error(`Bitstamp OHLC request failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const candles = payload?.data?.ohlc;
if (!Array.isArray(candles) || !candles.length) {
  throw new Error('Bitstamp OHLC response did not contain candles');
}

const normalized = candles
  .map(candle => {
    const timestamp = Number(candle.timestamp);
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
    const numeric = values.map(Number);
    if (!Number.isFinite(timestamp) || !numeric.every(Number.isFinite)) {
      throw new Error('Bitstamp returned a non-numeric candle');
    }

    const [open, high, low, close, volume] = numeric;
    if (
      low <= 0 ||
      volume < 0 ||
      low > Math.min(open, close) ||
      high < Math.max(open, close)
    ) {
      throw new Error(`Bitstamp returned an invalid OHLC candle at ${candle.timestamp}`);
    }

    return {
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      row: [
        new Date(timestamp * 1000).toISOString().slice(0, 10),
        ...values.map(value => String(value).trim())
      ].join(',')
    };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

const byDate = new Map(normalized.map(candle => [candle.date, candle]));
const additions = [...byDate.values()].filter(candle => candle.date > latestDate);

if (!additions.length) {
  console.log(`BTC data is already current through ${latestDate}`);
  process.exit(0);
}

const nextDate = date => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

let expected = nextDate(latestDate);
for (const candle of additions) {
  if (candle.date !== expected) {
    throw new Error(`Gap in Bitstamp daily candles: expected ${expected}, got ${candle.date}`);
  }
  expected = nextDate(expected);
}

const frozenAt = additions.at(-1).date;
const frozenIndex = lines.findIndex(line => line.startsWith('# frozen_at='));
if (frozenIndex < 0) throw new Error('BTC CSV frozen_at metadata not found');
lines[frozenIndex] = `# frozen_at=${frozenAt}`;

const sourceLine =
  '# incremental_update_source=Bitstamp Public API v2 OHLC /api/v2/ohlc/btcusd/';
const sourceIndex = lines.findIndex(line => line.startsWith('# incremental_update_source='));
if (sourceIndex >= 0) lines[sourceIndex] = sourceLine;
else lines.splice(headerIndex, 0, sourceLine);

await writeFile(
  csvPath,
  `${lines.join('\n')}\n${additions.map(candle => candle.row).join('\n')}\n`
);

console.log(
  `Added ${additions.length} BTC/USD daily candle(s): ${additions[0].date} through ${frozenAt}`
);
