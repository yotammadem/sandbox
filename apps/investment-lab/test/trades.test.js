import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLedger, candlePrice, isPriceInsideCandle } from '../src/trades.js';

const candle = { low: 80, high: 120 };

test('candle price helpers use low, midpoint and high and enforce the candle range', () => {
  assert.equal(candlePrice(candle, 'low'), 80);
  assert.equal(candlePrice(candle), 100);
  assert.equal(candlePrice(candle, 'high'), 120);
  assert.equal(isPriceInsideCandle(81, candle), true);
  assert.equal(isPriceInsideCandle(121, candle), false);
});

test('ledger computes external flows and running USD/BTC balances', () => {
  const result = calculateLedger([
    { id: 'a', order: 1, date: '2025-01-01', type: 'deposit_usd', usdAmount: 10000 },
    { id: 'b', order: 2, date: '2025-01-02', type: 'buy_btc', btcAmount: 0.1, price: 50000 },
    { id: 'c', order: 3, date: '2025-01-03', type: 'sell_btc', btcAmount: 0.04, price: 60000 },
    { id: 'd', order: 4, date: '2025-01-04', type: 'withdraw_usd', usdAmount: 1000 }
  ]);
  assert.equal(result.totals.totalUsdIn, 10000);
  assert.equal(result.totals.totalUsdOut, 1000);
  assert.equal(result.totals.usdBalance, 6400);
  assert.ok(Math.abs(result.totals.btcBalance - 0.06) < 1e-12);
  assert.equal(result.rows[1].usdBalance, 5000);
  assert.equal(result.rows[1].btcBalance, 0.1);
  assert.equal(result.rows[2].usdValue, 2400);
});

test('ledger recalculates in chronological order even when transactions were inserted later', () => {
  const result = calculateLedger([
    { id: 'buy', order: 2, date: '2025-01-02', type: 'buy_btc', btcAmount: 1, price: 100 },
    { id: 'deposit', order: 1, date: '2025-01-01', type: 'deposit_usd', usdAmount: 100 }
  ]);
  assert.equal(result.rows[0].id, 'deposit');
  assert.equal(result.rows[1].id, 'buy');
  assert.equal(result.totals.btcBalance, 1);
  assert.equal(result.totals.usdBalance, 0);
});

test('ledger rejects spending assets that are not available', () => {
  assert.throws(() => calculateLedger([{ id: 'x', date: '2025-01-01', type: 'buy_btc', btcAmount: 1, price: 100 }]), /Not enough USD/);
  assert.throws(() => calculateLedger([
    { id: 'a', date: '2025-01-01', type: 'deposit_usd', usdAmount: 100 },
    { id: 'b', date: '2025-01-02', type: 'sell_btc', btcAmount: 1, price: 100 }
  ]), /Not enough BTC/);
});
