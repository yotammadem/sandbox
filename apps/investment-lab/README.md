# Investment Lab

Phase one: responsive BTC/USD candlestick explorer. Public URL:
https://yotammadem.github.io/sandbox/investment-lab/

Run from the monorepo root:

```sh
npm ci
npm test --workspace=@sandbox/investment-lab
npm run build --workspace=@sandbox/investment-lab
python3 -m http.server 8000 --directory apps/investment-lab/dist
```

Uses pinned TradingView Lightweight Charts 5.2.0, bundled locally with license and notice. No CDN, credentials, backend or live API required. Daily market data is copied from the repository's existing self-describing Bitstamp CSV, with original provenance preserved. The UI displays actual first/last candle dates (not the fixture freeze date). The snapshot ends September 9, 2026. No synthetic candles or interpolated missing days. Weekly candles start Monday UTC; monthly candles start on day one. First/last aggregate periods may be partial. Crosshair, pan, wheel/pinch zoom, explicit zoom buttons, keyboard-accessible candle navigator, preset ranges and logarithmic price scale are supported.

Architecture: `src/data.js` parses/validates daily OHLCV and aggregates periods; `src/app.js` handles view state; `scripts/build.js` bundles the static app. Future paper trading, hidden-asset training and portfolio buckets can use these normalized candles without depending on chart internals. None of those future features is enabled in this phase.

GitHub Pages builds this alongside SafeArtifact and publishes it under `/investment-lab/`, preserving SafeArtifact at the root.
