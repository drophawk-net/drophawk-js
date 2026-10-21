# @drophawk/sdk

TypeScript client for the [DropHawk developer API](https://developers.drophawk.net): current and historical prices for PC components sold by Australian retailers, with a link that sends a buyer to the best price.
No API key, no runtime dependencies, typed ESM for Node >=22, Bun, Deno and browsers.

## Quick start

```sh
npm install @drophawk/sdk   # or: bun add @drophawk/sdk
```

```ts
import { DropHawk } from "@drophawk/sdk";

const dh = new DropHawk();

const { products } = await dh.searchProducts({ query: "rtx 4090", page_size: 5 });
const product = products[0];
if (!product) throw new Error("no matches");

const best = product.pricing.best_price;
console.log(best ? `${best.price.amount} ${best.price.currency} at ${best.retailer.name}` : "no price right now");
console.log(product.best_price_url); // send the buyer here, unchanged
```

## Prices and links

| Field | Meaning |
| --- | --- |
| `pricing.best_price` | `{ price, observed_at, retailer }`: the lowest in-stock price, when it was last confirmed, and the Retailer (`{ slug, name }`) offering it as of then, the only one ever named. |
| `pricing.in_stock_count` | How many Retailers have it in stock. |
| `pricing.all_time_low` | The lowest daily low ever recorded, in stock or not, dated to its first day. |
| `best_price_url` | A DropHawk link that resolves to the best price when followed, so it may reach a different Retailer than `best_price` names. With no `best_price`, it opens the Product page. Never modify it: its parameters attribute the click. |
| `url` | The Product's page on drophawk.net, with the full comparison and history. |

Money is `{ amount: "1299.00", currency: "AUD" }`.
`amount` is an exact decimal string, never rounded, that may have more or fewer decimal places than the currency's minor units: parse it with a decimal type, and never reject it for its decimals.
Amounts in different currencies are never compared.

A price DropHawk cannot state is absent, and `best_price_withheld_reason`, `all_time_low_withheld_reason` or `withheld_reason` (daily lows) says why: `OUT_OF_STOCK` (listed, but in stock nowhere; best price only), `NO_DATA` (no price yet) or `MIXED_CURRENCY` (prices span currencies).
Treat any other reason as the price being unknown.

## Methods

Each method returns a promise, takes an optional last argument `{ signal?: AbortSignal }`, and rejects with `DropHawkError` on an API error.
Fields keep the API's snake_case names, matching the [API reference](https://developers.drophawk.net).

| Method | Returns |
| --- | --- |
| `getProduct(identifier)` | `Product` |
| `getProducts(identifiers)` | `ProductResult[]`, in request order |
| `searchProducts({ query, page_size?, page_token? })` | `{ products, next_page_token }`, best match first |
| `iterateSearchProducts({ query, page_size? })` | `AsyncIterableIterator<Product>` over every page |
| `getDailyLows(identifier)` | `{ model_slug, is_merged, window_start, points, withheld_reason? }` |
| `listComponentTypes()` | `{ component_types }`, each with its Spec schema |
| `listBrands()` | `{ brands }` |

### Identifiers and merges

An identifier is a `model_slug` (`"deco-x1500-1-pack"`) or a raw model number (`"Deco X1500(1-pack)"`).
Store the `model_slug` the API returns; never derive one.
Single-Product methods reject `.`, `..` and model numbers containing `/` with `INVALID_IDENTIFIER` before sending; use the `model_slug` instead.

When a duplicate Product is merged into another, `getProduct` and `getDailyLows` return the survivor, so store the `model_slug` they return.
In a batch, the result has `is_merged: true` and `product` is the survivor.

### Batches

```ts
const results = await dh.getProducts(["rtx-4090", "Deco X1500(1-pack)", "no-such-part"]);

for (const r of results) {
  if (r.error) console.log(r.identifier, r.error.reason); // PRODUCT_NOT_FOUND or INVALID_IDENTIFIER
  else console.log(r.product.model_slug, r.is_merged ? "(merged: store this slug)" : "");
}
```

Up to 50 identifiers, counted as one request.
An identifier that does not resolve comes back in its own `result.error` and never fails the others.
A failure of the request as a whole rejects the call like any other method: an invalid batch (`EMPTY_BATCH`, `BATCH_TOO_LARGE`, ...), `RATE_LIMITED`, `UNAVAILABLE`, `INVALID_RESPONSE`, a network error or an abort.

### Pagination

```ts
for await (const product of dh.iterateSearchProducts({ query: "asus tuf" })) {
  console.log(product.model_slug);
  if (done) break; // no further page is fetched
}
```

`page_size` defaults to 20, at most 50.
To page by hand, pass `next_page_token` as `page_token`; it is empty on the last page and valid only for its query.

### Daily lows

`window_start` is the first of the last 14 UTC days.
Each point is the lowest price on one day, across all Retailers, in stock or not, oldest first.
The series is sparse: a day with no observation has no point, so read each point's `date` rather than its array index.
One point with `is_carried_forward: true` may precede the window: the latest earlier price, in force when the window opened.
Because stock is ignored, a daily low can be below anything buyable today.

## Options

`new DropHawk(options?)` takes:

| Option | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `https://api.drophawk.net` | The API origin. |
| `fetch` | the global `fetch` | For tests, proxies, or reading headers such as `RateLimit-Remaining`. |
| `userAgent` | none | Appended to `drophawk-sdk/<version>`, such as `"my-app/1.2"`. Ignored in browsers. |

## Errors

```ts
import { DropHawkError } from "@drophawk/sdk";

try {
  await dh.getProduct("nope");
} catch (err) {
  if (!(err instanceof DropHawkError) || err.reason !== "PRODUCT_NOT_FOUND") throw err;
}
```

| Field | Meaning |
| --- | --- |
| `status` | HTTP status; 400 for an identifier rejected before sending. |
| `reason` | Machine-readable reason. Branch on it, not on `message`. |
| `domain` | `"drophawk.net"` for errors the API raised. |
| `metadata` | Context, such as `max_identifiers` on `BATCH_TOO_LARGE`. |
| `retryAfterSeconds` | Seconds to wait, on `RATE_LIMITED`. |
| `retryable` | True for `RATE_LIMITED`, `UNAVAILABLE` and `INTERNAL`. |

API reasons: `PRODUCT_NOT_FOUND`, `INVALID_IDENTIFIER`, `INVALID_QUERY`, `INVALID_PAGE_TOKEN`, `INVALID_PAGE_SIZE`, `EMPTY_BATCH`, `BATCH_TOO_LARGE`, `INVALID_REQUEST`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `REQUEST_TOO_LARGE`, `RATE_LIMITED`, `UNAVAILABLE`, `INTERNAL`.
Without a machine-readable reason (a proxy error page, say), `reason` comes from the status (502 to 504 are `UNAVAILABLE`) or is `"UNKNOWN"`.
The SDK raises `INVALID_RESPONSE` for answers it will not use: a 2xx body that is not JSON, any body over 8 MiB, a redirect off the `baseUrl` origin, a redirected batch, or a repeated page token.
New reasons can appear within v1, so keep a fallback on `status`.
Network failures and aborts surface unwrapped, as the runtime's `TypeError` or `AbortError`.

## Rate limits and retries

Each IP may make 60 requests a minute on average, in bursts of up to 30, and successful GETs are cacheable for 5 minutes.
Prefer one batch over many `getProduct` calls.
The SDK never retries; a minimal retry on `retryable`:

```ts
async function withRetry<T>(call: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof DropHawkError) || !err.retryable || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, (err.retryAfterSeconds ?? 2 ** i) * 1000));
    }
  }
}

const product = await withRetry(() => dh.getProduct("rtx-4090"));
```

## Compatibility

API v1 only adds fields, endpoints and reasons, so ignore what you do not recognise; a breaking change would be a v2, served alongside v1 for at least 3 months.
The SDK follows semver.

Full documentation is at [developers.drophawk.net](https://developers.drophawk.net).
For AI assistants, see [`@drophawk/mcp`](https://www.npmjs.com/package/@drophawk/mcp).
