# Market data source library

All market-data fixtures in this directory use `market-ohlcv-v1`.

Required metadata:
- `format`
- `source_provider`
- `source_repository`
- `source_path`
- `instrument`
- `asset_class`
- `interval`
- `timezone`
- `frozen_at`

Required data columns:

```
date,open,high,low,close,volume
```

Rules:
- dates are ISO `YYYY-MM-DD`
- rows are strictly increasing by date
- OHLC values are numeric
- volume may be empty when a provider does not supply it
- source/provider-specific columns must be normalized before committing
- provenance belongs in the same CSV so copied files remain self-describing

Provider-specific raw formats are intentionally not consumed by tests.
