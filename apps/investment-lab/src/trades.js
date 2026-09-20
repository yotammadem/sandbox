const EPSILON = 1e-8;

export const transactionLabels = {
  deposit_usd: 'USD deposit',
  withdraw_usd: 'USD withdrawal',
  buy_btc: 'Buy BTC',
  sell_btc: 'Sell BTC'
};

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(label + ' must be greater than zero.');
  return number;
}

function compareTransactions(a, b) {
  return String(a.date).localeCompare(String(b.date)) || Number(a.order ?? 0) - Number(b.order ?? 0);
}

export function candlePrice(candle, point = 'mid') {
  if (!candle) throw new Error('A candle is required.');
  if (point === 'low') return Number(candle.low);
  if (point === 'high') return Number(candle.high);
  if (point === 'mid') return (Number(candle.low) + Number(candle.high)) / 2;
  throw new Error('Unknown candle price point: ' + point);
}

export function isPriceInsideCandle(price, candle) {
  const value = Number(price);
  return Number.isFinite(value) && value >= Number(candle.low) - EPSILON && value <= Number(candle.high) + EPSILON;
}

export function calculateLedger(transactions) {
  let usdBalance = 0;
  let btcBalance = 0;
  let totalUsdIn = 0;
  let totalUsdOut = 0;

  const rows = [...transactions].sort(compareTransactions).map(transaction => {
    const type = transaction.type;
    let usdDelta = 0;
    let btcDelta = 0;
    let usdValue = 0;

    if (type === 'deposit_usd') {
      usdValue = positiveNumber(transaction.usdAmount, 'USD amount');
      usdDelta = usdValue;
      totalUsdIn += usdValue;
    } else if (type === 'withdraw_usd') {
      usdValue = positiveNumber(transaction.usdAmount, 'USD amount');
      usdDelta = -usdValue;
      totalUsdOut += usdValue;
    } else if (type === 'buy_btc' || type === 'sell_btc') {
      const btcAmount = positiveNumber(transaction.btcAmount, 'BTC amount');
      const price = positiveNumber(transaction.price, 'BTC price');
      usdValue = btcAmount * price;
      if (type === 'buy_btc') {
        usdDelta = -usdValue;
        btcDelta = btcAmount;
      } else {
        usdDelta = usdValue;
        btcDelta = -btcAmount;
      }
    } else {
      throw new Error('Unknown transaction type: ' + type);
    }

    usdBalance += usdDelta;
    btcBalance += btcDelta;
    if (usdBalance < -EPSILON) throw new Error('Not enough USD for ' + (transactionLabels[type] || type) + ' on ' + transaction.date + '.');
    if (btcBalance < -EPSILON) throw new Error('Not enough BTC for ' + (transactionLabels[type] || type) + ' on ' + transaction.date + '.');
    if (Math.abs(usdBalance) < EPSILON) usdBalance = 0;
    if (Math.abs(btcBalance) < EPSILON) btcBalance = 0;

    return { ...transaction, usdValue, usdDelta, btcDelta, usdBalance, btcBalance };
  });

  return { rows, totals: { totalUsdIn, totalUsdOut, usdBalance, btcBalance } };
}
