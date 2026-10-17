# @drophawk/sdk

## 0.1.1

### Patch Changes

- [#15](https://github.com/drophawk-net/drophawk-js/pull/15) [`c3e51a1`](https://github.com/drophawk-net/drophawk-js/commit/c3e51a1bf6c0b73d722c51dcdf4f92f9e2d6e53d) Thanks [@jared-fraser](https://github.com/jared-fraser)! - Drop the one-off first-publish maintainer notes from the package README.

## 0.1.0

### Minor Changes

- [#4](https://github.com/drophawk-net/drophawk-js/pull/4) [`854eac2`](https://github.com/drophawk-net/drophawk-js/commit/854eac2bc28ce03ba1ecee06339be5856a356cea) Thanks [@jared-fraser](https://github.com/jared-fraser)! - Name the best price Retailer (drophawk-net/drophawk#397).
  `pricing.best_price.retailer` is a required `{ slug, name }` (`RetailerRef`): the Retailer offering the price as of `observed_at`.
  No other Retailer is ever named, and `best_price_url` resolves when followed, so it may since have moved to a different Retailer.
  The MCP tools carry `retailer` in `structuredContent` only when its slug is well formed, name it in the best price line as "at last check", and clean its name like other Retailer text, shown only inside the untrusted block.
  The server instructions no longer say that DropHawk never names a Retailer.

- [#5](https://github.com/drophawk-net/drophawk-js/pull/5) [`c401e70`](https://github.com/drophawk-net/drophawk-js/commit/c401e70a3ecd68b54b61f927a5adf98cb4d1266c) Thanks [@jared-fraser](https://github.com/jared-fraser)! - Follow the 14-day daily lows window (drophawk-net/drophawk#398).
  The window is today (UTC) and the 13 days before, starting at `window_start`, plus the carried-forward point: up to 15 points.
  The MCP tool is titled "Get a PC component's 14-day price lows"; its output and instructions say "recent" and name the window by `window_start`, so a later change of window needs no MCP release.

- [`daa8785`](https://github.com/drophawk-net/drophawk-js/commit/daa8785512de1b1872e6677df6e7ce287bd9817f) Thanks [@jared-fraser](https://github.com/jared-fraser)! - First release of the TypeScript client for the DropHawk developer API.

- [#3](https://github.com/drophawk-net/drophawk-js/pull/3) [`adf3673`](https://github.com/drophawk-net/drophawk-js/commit/adf3673c9bd766862b60c185f8675fb91c44bb69) Thanks [@jared-fraser](https://github.com/jared-fraser)! - Follow the polished v1 developer API contract (drophawk-net/drophawk#392).
  Neither package is published yet, so this lands in the first release rather than as a breaking change for anyone; it is a minor bump because the packages are pre-1.0.
  
  Renames: the path parameter `{model_slug}` is `{identifier}`; `Product.buy_url` is `best_price_url`; `ProductResult.merged` is `is_merged`; `pricing.best_price` plus `pricing.best_price_observed_at` is a nested `pricing.best_price` of `{ price, observed_at }`; schema names lose the `drophawk.developer.v1.` prefix (`Error`, `ErrorInfo`, `ErrorDetail`).
  New: daily lows carry `model_slug`, `is_merged` and `window_start`.
  The MCP tools follow: `best_price_url` and `is_merged` in their output, a nested `best_price`, and daily lows name the surviving Product.
  A Money `amount` may have more or fewer decimal places than its currency's minor units and is never rejected for them, but must still be a plain decimal string, and `currency` must match `^[A-Z]{3}$`.

### Patch Changes

- [#1](https://github.com/drophawk-net/drophawk-js/pull/1) [`a6d60f6`](https://github.com/drophawk-net/drophawk-js/commit/a6d60f6e1bbb1f8fe828221fc68f264630c5cab0) Thanks [@jared-fraser](https://github.com/jared-fraser)! - Harden against hostile API data and endpoints: the SDK caps response bodies, omits credentials, keeps redirects on the configured origin and validates `baseUrl`; the MCP server sanitises API text and defangs web addresses inside it, shows only DropHawk https links in their exact canonical form, drops malformed daily lows, never echoes unvetted API error text, keeps identifiers such as `model_slug` exact instead of truncating them, and fences product data between untrusted-data markers that carry a per-response nonce.
