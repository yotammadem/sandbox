# BTC random robustness optimizer

This is a reproducible random search over the deterministic Fib-regime strategy.

The search is deliberately two-stage:

1. Generate 50,000 seeded random parameter sets.
2. Score them on sparse yearly-start training windows only.
3. Re-rank the best 300 on every monthly 4/6/8-year training window ending by 2022-12-31.
4. Evaluate only the finalists on later-ending monthly windows as holdout.

The holdout is never used to choose the candidates.

Robust score:

```
2 * worstWindow
+ 1.5 * 10thPercentile
+ 0.5 * median
+ 0.5 * pctWindowsAbove1BTC
```

This intentionally favors robustness over maximum historical BTC-equivalent.

Run:

```bash
node experiments/btc-regime-validation/btc-random-optimizer.js
```

Optional:

```bash
CANDIDATES=100000 node experiments/btc-regime-validation/btc-random-optimizer.js
```

See `btc-random-optimizer.snapshot.json` for the frozen 50k run.
