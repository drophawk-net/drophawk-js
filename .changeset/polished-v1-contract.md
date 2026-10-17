---
"@drophawk/sdk": minor
"@drophawk/mcp": minor
---

Follow the polished v1 developer API contract (drophawk-net/drophawk#392).
Neither package is published yet, so this lands in the first release rather than as a breaking change for anyone; it is a minor bump because the packages are pre-1.0.

Renames: the path parameter `{model_slug}` is `{identifier}`; `Product.buy_url` is `best_price_url`; `ProductResult.merged` is `is_merged`; `pricing.best_price` plus `pricing.best_price_observed_at` is a nested `pricing.best_price` of `{ price, observed_at }`; schema names lose the `drophawk.developer.v1.` prefix (`Error`, `ErrorInfo`, `ErrorDetail`).
New: daily lows carry `model_slug`, `is_merged` and `window_start`.
The MCP tools follow: `best_price_url` and `is_merged` in their output, a nested `best_price`, and daily lows name the surviving Product.
A Money `amount` may have more or fewer decimal places than its currency's minor units and is never rejected for them, but must still be a plain decimal string, and `currency` must match `^[A-Z]{3}$`.
