import { calculateLedger, candlePrice, isPriceInsideCandle, transactionLabels } from './trades.js';

const STORAGE_KEY = 'investment-lab.transactions.v1';
const $ = id => document.getElementById(id);
const format = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatBtc = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
const pretty = time => new Date(String(time).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function initTradeSimulation({ getSelectedCandle, getInterval }) {
  let transactions = loadTransactions();
  let transactionContext = null;

  function loadTransactions() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function persistTransactions() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }

  function candleSnapshot(candle) {
    return candle ? {
      time: candle.time,
      start: candle.start,
      end: candle.end,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      interval: getInterval()
    } : null;
  }

  function candleDateText(candle) {
    if (!candle) return '—';
    return candle.start && candle.start !== candle.end ? pretty(candle.start) + ' – ' + pretty(candle.end) : pretty(candle.time);
  }

  function typeClass(type) {
    return type.includes('buy') || type.includes('deposit') ? 'positive' : 'negative';
  }

  function transactionAmount(row) {
    if (row.type === 'deposit_usd') return '+$' + format(row.usdAmount);
    if (row.type === 'withdraw_usd') return '−$' + format(row.usdAmount);
    if (row.type === 'buy_btc') return '+' + formatBtc(row.btcAmount) + ' BTC';
    return '−' + formatBtc(row.btcAmount) + ' BTC';
  }

  function transactionCash(row) {
    if (row.type === 'buy_btc') return '−$' + format(row.usdValue);
    if (row.type === 'sell_btc') return '+$' + format(row.usdValue);
    return '';
  }

  function compactRow(row) {
    const cash = transactionCash(row);
    const price = row.price ? ' · @ $' + format(row.price) : '';
    return '<article class="transaction-row">' +
      '<div class="transaction-row-head"><span>' + pretty(row.date) + '</span><button class="row-action" data-edit="' + row.id + '">Edit</button></div>' +
      '<div class="transaction-row-main"><strong>' + transactionLabels[row.type] + '</strong><span class="' + typeClass(row.type) + '">' + transactionAmount(row) + '</span></div>' +
      '<div class="transaction-row-sub"><span>' + cash + price + '</span><span>$' + format(row.usdBalance) + ' · ' + formatBtc(row.btcBalance) + ' BTC</span></div>' +
      '</article>';
  }

  function tableRow(row) {
    const cash = transactionCash(row);
    return '<tr>' +
      '<td>' + pretty(row.date) + '</td>' +
      '<td>' + transactionLabels[row.type] + '</td>' +
      '<td class="' + typeClass(row.type) + '">' + transactionAmount(row) + (cash ? '<small>' + cash + '</small>' : '') + '</td>' +
      '<td>' + (row.price ? '$' + format(row.price) : '—') + '</td>' +
      '<td>$' + format(row.usdBalance) + '</td>' +
      '<td>' + formatBtc(row.btcBalance) + '</td>' +
      '<td class="ledger-actions"><button data-edit="' + row.id + '">Edit</button><button data-delete="' + row.id + '">Delete</button></td>' +
      '</tr>';
  }

  function renderTrades() {
    let ledger;
    try {
      ledger = calculateLedger(transactions);
    } catch (error) {
      console.warn('Ignoring invalid saved simulation ledger', error);
      transactions = [];
      persistTransactions();
      ledger = calculateLedger(transactions);
    }

    const rows = ledger.rows;
    const totals = ledger.totals;
    $('total-usd-in').textContent = '$' + format(totals.totalUsdIn);
    $('total-usd-out').textContent = '$' + format(totals.totalUsdOut);
    $('usd-balance').textContent = '$' + format(totals.usdBalance);
    $('btc-balance').textContent = formatBtc(totals.btcBalance) + ' BTC';
    $('transaction-count').textContent = String(rows.length);
    $('dialog-transaction-count').textContent = String(rows.length);

    if (!rows.length) {
      $('transaction-list').innerHTML = '<p class="empty-state">No transactions yet. Select a candle and add one.</p>';
      $('transaction-table').innerHTML = '';
      $('dialog-empty').hidden = false;
      return;
    }

    $('dialog-empty').hidden = true;
    $('transaction-list').innerHTML = rows.slice().reverse().map(compactRow).join('');
    $('transaction-table').innerHTML = rows.map(tableRow).join('');
  }

  function nextOrder() {
    return transactions.reduce((max, transaction) => Math.max(max, Number(transaction.order) || 0), 0) + 1;
  }

  function updateTransactionFields() {
    const trade = ['buy_btc', 'sell_btc'].includes($('transaction-type').value);
    $('usd-fields').hidden = trade;
    $('trade-fields').hidden = !trade;
    updateTradeValue();
  }

  function updateTradeValue() {
    const amount = Number($('btc-amount').value);
    const price = Number($('btc-price').value);
    $('trade-value').textContent = Number.isFinite(amount) && Number.isFinite(price) && amount > 0 && price > 0 ? '$' + format(amount * price) : '$0.00';
  }

  function setPricePoint(point) {
    if (!transactionContext) return;
    $('btc-price').value = candlePrice(transactionContext, point).toFixed(2);
    updateTradeValue();
  }

  function setFormError(message) {
    $('transaction-error').textContent = message || '';
    $('transaction-error').hidden = !message;
  }

  function openTransactionDialog(transaction) {
    const selected = getSelectedCandle();
    if (!selected && !transaction) return;
    setFormError('');
    const editing = Boolean(transaction);
    $('dialog-title').textContent = editing ? 'Edit transaction' : 'Add transaction';
    $('transaction-id').value = transaction ? transaction.id : '';
    transactionContext = transaction && transaction.candle ? transaction.candle : candleSnapshot(selected);
    $('transaction-candle-date').textContent = candleDateText(transactionContext);
    $('transaction-candle-range').textContent = transactionContext ? 'Low $' + format(transactionContext.low) + ' · Mid $' + format(candlePrice(transactionContext)) + ' · High $' + format(transactionContext.high) : 'No candle selected';
    $('transaction-type').value = transaction ? transaction.type : 'buy_btc';
    $('usd-amount').value = transaction && transaction.usdAmount != null ? transaction.usdAmount : '';
    $('btc-amount').value = transaction && transaction.btcAmount != null ? transaction.btcAmount : '';
    $('btc-price').value = transaction && transaction.price != null ? transaction.price : (transactionContext ? candlePrice(transactionContext).toFixed(2) : '');
    updateTransactionFields();
    renderTrades();
    $('transaction-dialog').showModal();
  }

  function closeTransactionDialog() {
    $('transaction-dialog').close();
    transactionContext = null;
    setFormError('');
  }

  function buildTransaction() {
    const selected = getSelectedCandle();
    const generatedId = crypto.randomUUID ? crypto.randomUUID() : 'tx-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    const id = $('transaction-id').value || generatedId;
    const previous = transactions.find(transaction => transaction.id === id);
    const type = $('transaction-type').value;
    const date = previous ? previous.date : ((transactionContext && (transactionContext.end || transactionContext.time)) || (selected && selected.time));
    const base = { id, order: previous ? previous.order : nextOrder(), date, type, candle: transactionContext };

    if (type === 'deposit_usd' || type === 'withdraw_usd') {
      const usdAmount = Number($('usd-amount').value);
      if (!Number.isFinite(usdAmount) || usdAmount <= 0) throw new Error('Enter a USD amount greater than zero.');
      return { ...base, usdAmount };
    }

    const btcAmount = Number($('btc-amount').value);
    const price = Number($('btc-price').value);
    if (!Number.isFinite(btcAmount) || btcAmount <= 0) throw new Error('Enter a BTC amount greater than zero.');
    if (!Number.isFinite(price) || price <= 0) throw new Error('Enter a BTC price greater than zero.');
    if (transactionContext && !isPriceInsideCandle(price, transactionContext)) throw new Error('Price must stay inside this candle: $' + format(transactionContext.low) + ' – $' + format(transactionContext.high) + '.');
    return { ...base, btcAmount, price };
  }

  function saveTransaction(event) {
    event.preventDefault();
    try {
      const transaction = buildTransaction();
      const existing = transactions.findIndex(item => item.id === transaction.id);
      const candidate = existing >= 0 ? transactions.map((item, index) => index === existing ? transaction : item) : transactions.concat(transaction);
      calculateLedger(candidate);
      transactions = candidate;
      persistTransactions();
      renderTrades();
      closeTransactionDialog();
    } catch (error) {
      setFormError(error.message || 'The transaction could not be saved.');
    }
  }

  function editTransaction(id) {
    const transaction = transactions.find(item => item.id === id);
    if (transaction) openTransactionDialog(transaction);
  }

  function deleteTransaction(id) {
    const transaction = transactions.find(item => item.id === id);
    if (!transaction || !confirm('Delete ' + transactionLabels[transaction.type] + ' on ' + pretty(transaction.date) + '?')) return;
    const candidate = transactions.filter(item => item.id !== id);
    try {
      calculateLedger(candidate);
      transactions = candidate;
      persistTransactions();
      renderTrades();
    } catch (error) {
      alert(error.message || 'The transaction could not be deleted because later balances depend on it.');
    }
  }

  $('add-transaction').addEventListener('click', () => openTransactionDialog(null));
  $('manage-transactions').addEventListener('click', () => openTransactionDialog(null));
  $('close-dialog').addEventListener('click', closeTransactionDialog);
  $('cancel-transaction').addEventListener('click', closeTransactionDialog);
  $('transaction-form').addEventListener('submit', saveTransaction);
  $('transaction-type').addEventListener('change', updateTransactionFields);
  $('btc-amount').addEventListener('input', updateTradeValue);
  $('btc-price').addEventListener('input', updateTradeValue);
  document.querySelector('.price-presets').addEventListener('click', event => {
    if (event.target.dataset.pricePoint) setPricePoint(event.target.dataset.pricePoint);
  });

  for (const id of ['transaction-list', 'transaction-table']) $(id).addEventListener('click', event => {
    const edit = event.target.closest('[data-edit]');
    const remove = event.target.closest('[data-delete]');
    if (edit) editTransaction(edit.dataset.edit);
    if (remove) deleteTransaction(remove.dataset.delete);
  });

  $('transaction-dialog').addEventListener('click', event => {
    if (event.target === $('transaction-dialog')) closeTransactionDialog();
  });

  renderTrades();
}
