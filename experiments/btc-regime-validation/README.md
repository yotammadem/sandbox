# BTC regime validation

This experiment now uses a repository-wide canonical market-data CSV format and freezes each provider as an independent source file.

## Canonical format

Each source is a CSV with provenance metadata in leading comment lines:

```csv
# format=market-ohlcv-v1
# source_provider=...
# source_repository=...
# source_path=...
# instrument=BTC/USD
# asset_class=crypto
# venue=...
# interval=1d
# timezone=UTC
# frozen_at=YYYY-MM-DD
date,open,high,low,close,volume
...
```

The strategy parses this format directly, then aggregates daily rows into Monday-based weekly bars.

## Frozen BTC sources

- `sources/btc-usd-bitstamp.csv`
  - Provider/venue: Bitstamp
  - Upstream repository: `alessiostomeo/btc-cycle-data`
- `sources/btc-usd-yahoo.csv`
  - Provider: Yahoo Finance export
  - Upstream repository: `simonavoprea/Bitcoin_data_2014-2023`

Common comparison window: 2014-09-18 through 2023-07-20.

Frozen result:
- Bitstamp: ~5.0456 BTC-equivalent
- Yahoo: ~4.3808 BTC-equivalent
- Yahoo retains ~86.8% of the Bitstamp result on the common window.

These are research regression checks, not evidence of future profitability.
