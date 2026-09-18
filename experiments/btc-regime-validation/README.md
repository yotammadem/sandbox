# BTC regime validation

This experiment freezes two independent BTC/USD daily datasets and runs the same deterministic Fib-regime strategy on both.

- Bitstamp source: `alessiostomeo/btc-cycle-data`
- Yahoo Finance source: `simonavoprea/Bitcoin_data_2014-2023` (repository states the CSV was pulled from Yahoo Finance)

Common comparison window: 2014-09-18 through 2023-07-20.

Current frozen result:
- Bitstamp: ~5.0456 BTC-equivalent
- Yahoo Finance: ~4.3808 BTC-equivalent
- Yahoo retains ~86.8% of the Bitstamp result on the common window.

The purpose is not to prove profitability; it is a regression/robustness check against provider-specific OHLC differences.
