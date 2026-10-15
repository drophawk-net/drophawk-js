# @drophawk/sdk

TypeScript client for the [DropHawk developer API](https://developers.drophawk.net): current and historical prices for PC components, aggregated across stores, with a link to send a buyer to the best price.

- Zero runtime dependencies, ESM only, ships its own types.
- Works on Node 22+, Bun, Deno and browsers (anything with a global `fetch`).
- No API key. The API is anonymous and rate limited per IP address.

## Install

```sh
npm install @drophawk/sdk
# or: bun add @drophawk/sdk
```

## Quick start

Search for a part, read its price, and hand the person a link to buy it.

```ts
import { DropHawk } from "@drophawk/sdk";

const dh = new DropHawk();

const { products } = await dh.searchProducts({ query: "rtx 4090", page_size: 5 });
const first = products[0];
if (!first) throw new Error("no matches");

const product = await dh.getProduct(first.model_slug);

const best = product.pricing.best_price;
console.log(best ? `${product.name}: ${best.amount} ${best.currency}` : `${product.name}: no price right now`);

// Send the person here. Use it exactly as given.
console.log(product.buy_url);
```

`buy_url` is a DropHawk link that resolves to the cheapest in-stock store when it is followed, not when you fetched it, so it stays correct however long you keep it.
It never names a store.
**Pass it through unchanged**: do not rewrite, shorten, strip or add query parameters, because its parameters attribute the click.
When the Product has no `best_price` at that moment (nothing in stock, or in-stock prices in more than one currency), following `buy_url` sends the buyer to the Product's page on drophawk.net instead of to a store, and no click toward a store is recorded.
`product.url` is the Product's page on drophawk.net if you want to show the full price comparison instead.

Money is `{ amount: "1299.00", currency: "AUD" }`.
`amount` is a decimal string so it is exact; parse it with a decimal type, not a float.

## Methods

All methods return promises, take an optional last argument `{ signal?: AbortSignal }`, and reject with a `DropHawkError` when the API answers with an error.

| Method | Returns |
| --- | --- |
| `getProduct(identifier)` | `Product` |
| `getProducts(identifiers)` | `ProductResult[]`, in request order |
| `searchProducts({ query, page_size?, page_token? })` | `{ products, next_page_token }` |
| `iterateSearchProducts({ query, page_size? })` | `AsyncIterableIterator<Product>` over every page |
| `getDailyLows(identifier)` | `{ points, withheld_reason? }` |
| `listComponentTypes()` | `{ component_types }`, each with its Spec schema |
| `listBrands()` | `{ brands }` |

Request parameters and response fields keep the API's snake_case names, so the types match the [API reference](https://developers.drophawk.net) one to one.
Only the SDK's own configuration and error fields (`baseUrl`, `userAgent`, `retryAfterSeconds`) are camelCase.
The types describe the fields the API documents today and a typo is a compile error; fields added later still arrive at runtime and are ignored by the types.

### Identifiers and merged Products

An identifier is a Product's `model_slug` (`"deco-x1500-1-pack"`) or its raw model number (`"Deco X1500(1-pack)"`).
Always store the `model_slug` the API returns, never one you derived yourself.
A model number containing `/`, and the identifiers `.` and `..`, cannot travel in a URL path; the single-Product methods reject them locally with an `INVALID_IDENTIFIER` error, so use the `model_slug` instead.
(In a batch they are sent in the body and answered per item.)

When a Product was found to duplicate another, the API redirects to the survivor.
The SDK follows that redirect for you, so `getProduct` returns the surviving Product: store its `model_slug`.
To find out whether an identifier you stored is stale, compare it with `(await dh.getProduct(identifier)).model_slug`.
`getDailyLows` follows the redirect too but its response does not name the Product, so call `getProduct` when you need the canonical slug.
In a batch there is no redirect: the result has `merged: true` and `product` is the survivor, which is the signal to rely on.
The batch request is sent with `redirect: "manual"`, so its body is never resent elsewhere, and a redirect in answer to it is `INVALID_RESPONSE`.
Any request whose final URL is on another origin than `baseUrl` is `INVALID_RESPONSE` too.

### Batches

```ts
const results = await dh.getProducts(["rtx-4090", "Deco X1500(1-pack)", "no-such-part"]);

for (const r of results) {
  if (r.error) console.log(r.identifier, r.error.reason); // "PRODUCT_NOT_FOUND" or "INVALID_IDENTIFIER"
  else console.log(r.product.model_slug, r.merged ? "(merged, update your stored slug)" : "");
}
```

`results[i]` answers `identifiers[i]`.
A bad identifier never throws; it comes back as `result.error`.
Only a problem with the whole batch throws: `EMPTY_BATCH`, or `BATCH_TOO_LARGE` for more than 50 identifiers.

### Pagination

```ts
for await (const product of dh.iterateSearchProducts({ query: "asus tuf" })) {
  console.log(product.model_slug);
  if (done) break; // stops fetching further pages
}
```

Pages are fetched lazily.
To page by hand, pass the previous `next_page_token` as `page_token`; the last page has an empty token.
A page token is only valid for the query it was issued for.
If the API ever repeated a token, iteration stops with an `INVALID_RESPONSE` error instead of looping.

### Withheld prices

A price DropHawk cannot state is absent, with a reason beside it, for example `pricing.best_price_withheld_reason`, `pricing.all_time_low_withheld_reason` and `withheld_reason` on daily lows.
Reasons today are `NO_DATA`, `OUT_OF_STOCK` and `MIXED_CURRENCY`.
Treat an unrecognised reason as the price being unknown.

## Options

```ts
const dh = new DropHawk({
  baseUrl: "https://api.drophawk.net", // default
  fetch: myFetch,                       // default: the global fetch
  userAgent: "my-app/1.2",              // appended to "drophawk-sdk/<version>"
});
```

`userAgent` applies on Node, Bun and Deno only.
Browsers do not let a script set `User-Agent` (Firefox logs a warning for it), so the SDK sends none there and ignores the option.

## Errors

```ts
import { DropHawk, DropHawkError } from "@drophawk/sdk";

try {
  await dh.getProduct("nope");
} catch (err) {
  if (err instanceof DropHawkError && err.reason === "PRODUCT_NOT_FOUND") {
    // ...
  } else {
    throw err;
  }
}
```

`DropHawkError` carries:

- `status`: the HTTP status (400 for an identifier rejected before anything was sent).
- `reason`: a string such as `PRODUCT_NOT_FOUND`, `INVALID_IDENTIFIER`, `INVALID_QUERY`, `INVALID_PAGE_TOKEN`, `INVALID_PAGE_SIZE`, `EMPTY_BATCH`, `BATCH_TOO_LARGE`, `REQUEST_TOO_LARGE`, `RATE_LIMITED`, `UNAVAILABLE` or `INTERNAL`, plus `INVALID_RESPONSE`, which the SDK raises when a 2xx body is not JSON or a page token repeats.
  The vocabulary is open: new reasons can appear within v1, so keep a fallback that looks at `status`.
  If a response has no machine-readable reason (for example a proxy error page), `reason` is derived from the status (502, 503 and 504 become `UNAVAILABLE`), or is `"UNKNOWN"`.
- `domain`: `"drophawk.net"` for errors the API raised.
- `metadata`: extra context, for example `max_identifiers` on `BATCH_TOO_LARGE`.
- `retryAfterSeconds`: seconds to wait, set for `RATE_LIMITED`.
- `retryable`: true for `RATE_LIMITED`, `UNAVAILABLE` and `INTERNAL`.

Branch on `reason`, not on `message`.
Network failures and aborted calls are not wrapped; they surface as the runtime's own `TypeError` or `AbortError`.

## Rate limits and retries

Each IP address may make 60 requests a minute on average, in bursts of up to 30.
A batch counts as one request, so prefer `getProducts` over many `getProduct` calls.
Successful GETs are cacheable for 5 minutes, so repeating a lookup is cheap.

The SDK never retries on its own.
`error.retryable` is true for `RATE_LIMITED`, `UNAVAILABLE` and `INTERNAL`, the reasons that can succeed later; the rest will fail the same way again.
A minimal retry on that flag:

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

To read the `RateLimit-Remaining` and `RateLimit-Reset` headers, pass a wrapping `fetch` in the options.

## Compatibility

The API is v1 and additive: fields, endpoints, error reasons and withheld reasons may be added, but none are removed or change meaning.
A breaking change would be a v2, served alongside v1 for at least 3 months.
The SDK follows semver and its types are generated from the API's OpenAPI document, so ignore properties and reasons you do not recognise.

Full documentation: https://developers.drophawk.net

## Maintaining this package

Types in `src/generated/api.ts` are generated from `spec/developer-v1.openapi.json` at the repository root (synced from the DropHawk backend, see the root README).
After that document changes, run `bun run generate` in this directory and commit the result.
CI fails when the generated file is stale.

Versions and changelogs come from [Changesets](https://github.com/changesets/changesets).
Run `bun run changeset` at the repository root for any change to this package and commit the file.
Merging to `main` opens a "chore: version packages" PR; merging that PR publishes to npm.
Never edit `CHANGELOG.md` or the version by hand.

### First publish (one-off, human)

Publishing runs through npm trusted publishing (OIDC, no token); npm adds provenance automatically once the repository is public.
npm configures a trusted publisher from the package's settings page on npmjs.com, so the package has to exist first.

Prerequisites:

- The repository is MIT licensed.
  `scripts/prepare-publish.ts` copies the root `LICENSE` into each package directory at publish time (npm then packs it automatically; the copies are gitignored), and the release workflow's publish job fails before publishing if the `LICENSE` or either `license` field is missing.
  Run the script yourself before a manual publish.
- The GitHub repository, `drophawk-net/drophawk-js`, is public.
  It is private until it is deliberately made public, and trusted publishing only attests provenance for public repositories, so make it public before the first automated release.

Then, as an owner of the `@drophawk` npm organisation:

1. Merge the "chore: version packages" PR that the Release workflow opens.
   That bumps the package to `0.1.0`.
   The first run of the publish job fails because npm does not know the package yet; that is expected.
2. From `main` at the version commit, run `bun install` and then, in `packages/sdk`, `npm publish --provenance=false`, signing in with 2FA.
   This publishes the real `0.1.0` as `latest`; the `prepack` script builds it first.
   Provenance is off only because a local publish cannot produce it.
3. On npmjs.com open `@drophawk/sdk` > Settings > Trusted Publisher, choose GitHub Actions, and enter organization or user `drophawk-net`, repository `drophawk-js`, workflow filename `release.yml`, and environment `npm`.
   The publish job runs in the GitHub environment `npm`, and npm rejects the token exchange if the two names differ.
4. Tag the release that the workflow could not: `git tag @drophawk/sdk@0.1.0 <version-commit>` and `git push origin @drophawk/sdk@0.1.0`.
5. In the package's publishing access settings, choose "Require two-factor authentication and disallow tokens".
   This is mandatory, not optional: it leaves trusted publishing as the only way to publish.

From the next release on, merging the version PR publishes automatically.
The workflow runs Node 24, whose npm supports trusted publishing (npm 11.5.1 or later).
