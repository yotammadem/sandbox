import { createChart, CandlestickSeries, PriceScaleMode, CrosshairMode } from '../vendor/charts.mjs';
import { parseCSV, aggregate } from './data.js';
import { initTradeSimulation } from './trade-ui.js';
const $ = id => document.getElementById(id);
const format = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = time => typeof time === 'string' ? time : `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
const pretty = time => new Date(`${iso(time)}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
let chart, series, all, candles, interval = '1D', range = '180', selected, changing = false, pinned = false;
const buttons = [...document.querySelectorAll('button')];
buttons.forEach(button => button.disabled = true);
$('candle-index').disabled = true;
initTradeSimulation({ getSelectedCandle: () => selected, getInterval: () => interval });
function inspect(candle, index) {
  if (!candle) return;
  selected = candle;
  $('candle-date').textContent = candle.start && candle.start !== candle.end ? `${pretty(candle.start)} – ${pretty(candle.end)}` : pretty(candle.time);
  const cadence = interval === '1D' ? 'Daily' : interval === '1W' ? 'Weekly' : 'Monthly';
  $('candle-note').textContent = `${cadence} · UTC${pinned ? ' · pinned' : ''}`;
  $('unpin-candle').hidden = !pinned;
  for (const key of ['open', 'high', 'low', 'close']) $(key).textContent = '$' + format(candle[key]);
  $('close').className = candle.close >= candle.open ? 'up' : 'down';
  $('candle-index').value = index ?? candles.indexOf(candle);
  $('candle-index').setAttribute('aria-valuetext', `${$('candle-date').textContent}, close ${format(candle.close)} dollars`);
}
function findCandle(time) {
  const key = iso(time);
  const index = candles.findIndex(candle => candle.time === key);
  return index >= 0 ? { candle: candles[index], index } : null;
}
function unpin() {
  pinned = false;
  const index = candles?.indexOf(selected);
  if (index >= 0) inspect(selected, index);
  else $('unpin-candle').hidden = true;
}
function updatePressed() {
  document.querySelectorAll('[data-interval]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.interval === interval)));
  document.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === range)));
}
function setRange() {
  changing = true;
  if (range === 'all') chart.timeScale().fitContent();
  else {
    const end = candles.at(-1).time;
    const start = new Date(`${all.at(-1).time}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - Number(range));
    chart.timeScale().setVisibleRange({ from: start.toISOString().slice(0, 10), to: end });
  }
  changing = false;
  updatePressed();
}
function zoom(factor) {
  const visible = chart.timeScale().getVisibleLogicalRange();
  if (!visible) return;
  const width = Math.max(8, Math.min(candles.length + 10, (visible.to - visible.from) * factor));
  const center = (visible.from + visible.to) / 2;
  chart.timeScale().setVisibleLogicalRange({ from: center - width / 2, to: center + width / 2 });
  range = ''; updatePressed();
}
async function init() {
  const response = await fetch('./btc-usd.csv');
  if (!response.ok) throw new Error(`Data request failed (${response.status})`);
  const parsed = parseCSV(await response.text());
  all = parsed.candles; candles = all;
  chart = createChart($('chart'), {
    autoSize: true,
    layout: { background: { color: '#111925' }, textColor: '#8b9ab1', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', fontSize: 11, attributionLogo: true },
    grid: { vertLines: { color: '#1c2737' }, horzLines: { color: '#1c2737' } },
    rightPriceScale: { borderColor: '#253044', minimumWidth: 75, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: '#253044', fixLeftEdge: true, fixRightEdge: true, minBarSpacing: 0.1 },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#7189ac', labelBackgroundColor: '#354764' }, horzLine: { color: '#7189ac', labelBackgroundColor: '#354764' } },
    handleScroll: { vertTouchDrag: false, horzTouchDrag: true },
    handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: true },
    localization: { locale: 'en-GB', priceFormatter: value => '$' + format(value) }
  });
  series = chart.addSeries(CandlestickSeries, { upColor: '#47d5ad', downColor: '#f17b8b', wickUpColor: '#47d5ad', wickDownColor: '#f17b8b', borderVisible: false, priceLineColor: '#7899c5', priceLineStyle: 2 });
  series.setData(candles);
  setRange(); inspect(candles.at(-1));
  chart.subscribeCrosshairMove(param => {
    if (pinned || !param.time) return;
    const match = findCandle(param.time);
    if (match) inspect(match.candle, match.index);
  });
  chart.subscribeClick(param => {
    if (!param.time) return;
    const match = findCandle(param.time);
    if (!match) return;
    pinned = true;
    inspect(match.candle, match.index);
    chart.setCrosshairPosition(match.candle.close, match.candle.time, series);
  });
  chart.timeScale().subscribeVisibleTimeRangeChange(visible => {
    if (visible) $('visible-range').textContent = `${pretty(visible.from)} — ${pretty(visible.to)} · UTC`;
  });
  // User gestures clear preset highlighting; a preset remains active during programmatic changes.
  for (const name of ['wheel', 'pointerdown', 'touchstart']) $('chart').addEventListener(name, () => { if (!changing) { range = ''; updatePressed(); } }, { passive: true });
  const visible = chart.timeScale().getVisibleRange();
  if (visible) $('visible-range').textContent = `${pretty(visible.from)} — ${pretty(visible.to)} · UTC`;
  const last = all.at(-1), previous = all.at(-2);
  const delta = last.close - previous.close;
  $('price').textContent = '$' + format(last.close);
  $('change').textContent = `${delta >= 0 ? '+' : '−'}${format(Math.abs(delta))} (${delta >= 0 ? '+' : ''}${(delta / previous.close * 100).toFixed(2)}%) · last day`;
  $('change').className = delta >= 0 ? 'up' : 'down';
  $('data-summary').textContent = `${parsed.metadata.source_provider} BTC/USD · ${all.length.toLocaleString()} daily candles · ${pretty(all[0].time)} – ${pretty(last.time)}. Historical snapshot, not a live price feed.`;
  $('candle-index').max = candles.length - 1;
  $('candle-index').value = candles.length - 1;
  $('loading').hidden = true;
  buttons.forEach(button => button.disabled = false);
  $('candle-index').disabled = false;
  document.body.dataset.ready = 'true';
}
$('intervals').addEventListener('click', event => {
  const next = event.target.dataset.interval;
  if (!next) return;
  const visible = chart.timeScale().getVisibleRange();
  interval = next; candles = aggregate(all, interval);
  series.setData(candles);
  unpin();
  if (range) setRange();
  else if (visible) chart.timeScale().setVisibleRange(visible);
  $('candle-index').max = candles.length - 1;
  inspect(candles.at(-1)); updatePressed();
});
$('ranges').addEventListener('click', event => { if (event.target.dataset.range) { range = event.target.dataset.range; setRange(); } });
$('zoom-in').onclick = () => zoom(0.65);
$('zoom-out').onclick = () => zoom(1.5);
$('reset').onclick = () => { range = '180'; unpin(); setRange(); inspect(candles.at(-1)); chart.clearCrosshairPosition(); };
$('log').onclick = () => {
  const active = $('log').getAttribute('aria-pressed') !== 'true';
  chart.priceScale('right').applyOptions({ mode: active ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  $('log').setAttribute('aria-pressed', String(active));
};
$('candle-index').oninput = event => {
  const index = Number(event.target.value); pinned = true; inspect(candles[index], index);
  const visible = chart.timeScale().getVisibleLogicalRange();
  if (visible && (index < visible.from || index > visible.to)) {
    const width = visible.to - visible.from;
    chart.timeScale().setVisibleLogicalRange({ from: index - width / 2, to: index + width / 2 });
    range = ''; updatePressed();
  }
  chart.setCrosshairPosition(selected.close, selected.time, series);
};
$('latest').onclick = () => { range = '180'; unpin(); setRange(); inspect(candles.at(-1)); chart.clearCrosshairPosition(); };
$('unpin-candle').onclick = () => { unpin(); chart.clearCrosshairPosition(); };
init().catch(error => {
  console.error(error);
  $('loading').textContent = 'Market history could not be loaded. Please reload the page to try again.';
  $('change').textContent = 'Data unavailable';
  $('data-summary').textContent = 'The historical data file could not be loaded.';
});
