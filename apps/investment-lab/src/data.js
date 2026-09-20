export function parseCSV(text) {
  const metadata = {};
  const rows = text.trim().split(/\r?\n/).filter(line => {
    if (!line.startsWith('#')) return Boolean(line.trim());
    const i = line.indexOf('=');
    if (i > 0) metadata[line.slice(1, i).trim()] = line.slice(i + 1).trim();
    return false;
  });
  if (rows.shift() !== 'date,open,high,low,close,volume') throw new Error('Unexpected data columns');
  let previous = '';
  const candles = rows.map(row => {
    const [time, ...values] = row.split(',');
    const [open, high, low, close, volume] = values.map(Number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time) || time <= previous ||
      ![open, high, low, close, volume].every(Number.isFinite) || low <= 0 || volume < 0 ||
      low > Math.min(open, close) || high < Math.max(open, close)) throw new Error(`Invalid candle: ${time}`);
    previous = time;
    return { time, open, high, low, close, volume };
  });
  if (!candles.length) throw new Error('No market data');
  return { metadata, candles };
}

export function aggregate(candles, interval) {
  if (interval === '1D') return candles;
  if (!['1W', '1M'].includes(interval)) throw new Error('Unknown interval');
  const result = [];
  for (const candle of candles) {
    const date = new Date(`${candle.time}T00:00:00Z`);
    if (interval === '1W') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    else date.setUTCDate(1);
    const time = date.toISOString().slice(0, 10);
    const last = result.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += candle.volume;
      last.end = candle.time;
    } else result.push({ ...candle, time, start: candle.time, end: candle.time });
  }
  return result;
}
