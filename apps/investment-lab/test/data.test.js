import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCSV, aggregate } from '../src/data.js';
const header = 'date,open,high,low,close,volume\n';
test('weekly OHLC uses first open, extremes, last close, volume and Monday UTC boundary', () => {
  const { candles } = parseCSV(header + '2024-01-07,10,15,9,12,2\n2024-01-08,12,16,11,14,3\n2024-01-09,14,15,8,9,4');
  const weeks = aggregate(candles, '1W');
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks[1], { time: '2024-01-08', open: 12, high: 16, low: 8, close: 9, volume: 7, start: '2024-01-08', end: '2024-01-09' });
  assert.equal(candles[1].close, 14);
  assert.equal(aggregate(candles, '1M')[0].volume, 9);
});
test('bad OHLC and duplicate dates are rejected instead of drawn', () => {
  assert.throws(() => parseCSV(header + '2024-01-01,10,9,8,10,2'));
  assert.throws(() => parseCSV(header + '2024-01-01,10,12,8,10,2\n2024-01-01,10,12,8,10,2'));
});
test('bundled source validates and retains provenance', async () => {
  const parsed = parseCSV(await readFile(new URL('../../../experiments/btc-regime-validation/sources/btc-usd-bitstamp.csv', import.meta.url), 'utf8'));
  assert.equal(parsed.metadata.instrument, 'BTC/USD');
  assert.equal(parsed.metadata.source_provider, 'Bitstamp');
  assert.ok(parsed.candles.length > 5000);
  for (const interval of ['1W', '1M']) for (const candle of aggregate(parsed.candles, interval)) {
    assert.ok(candle.low <= Math.min(candle.open, candle.close));
    assert.ok(candle.high >= Math.max(candle.open, candle.close));
  }
});
