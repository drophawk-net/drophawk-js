# @drophawk/mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant look up current and historical prices for PC components sold by Australian retailers, and hand you a link to buy at the best price.
It is read only, needs no API key or account, and runs locally over stdio on Node >=22 (or Bun).
It wraps [`@drophawk/sdk`](https://www.npmjs.com/package/@drophawk/sdk) and the [DropHawk developer API](https://developers.drophawk.net).

## Quick start

Claude Code:

```sh
claude mcp add drophawk -- npx -y @drophawk/mcp
```

Claude Desktop (`claude_desktop_config.json`, via Settings > Developer > Edit Config, then restart) and Cursor (`~/.cursor/mcp.json`, or `.cursor/mcp.json` per project):

```json
{
  "mcpServers": {
    "drophawk": {
      "command": "npx",
      "args": ["-y", "@drophawk/mcp"]
    }
  }
}
```

Other clients run the same command, `npx -y @drophawk/mcp` or `bunx @drophawk/mcp`.
Then ask: "What's the cheapest RTX 4070 Super right now, and is it a good price?"

## Tools

| Tool | Parameters | Returns |
| --- | --- | --- |
| `search_products` | `query` (at most 256 UTF-8 bytes), `limit` (1 to 50, default 10) | One page of Products, best match first, and `has_more` |
| `get_products` | `identifiers`: 1 to 50 `model_slug`s or raw model numbers | One entry per identifier, in the order asked |
| `get_daily_lows` | `identifier`: a `model_slug` or raw model number | The Product's daily lows over the last 14 days, oldest first |

Each tool answers in compact markdown for the model, with the same data as `structuredContent` described by its `outputSchema`.

- A Product carries `model_slug`, name, model number, Brand, ComponentType, Specs, image, `in_stock_count`, `best_price` (`{ price, observed_at, retailer: { slug, name } }`), `all_time_low` and two links.
- A `get_products` batch counts as one request.
  An identifier with no Product gets its own not-found entry without failing the others, and `is_merged: true` means it was merged into another Product, whose `model_slug` to use from then on.
- `get_daily_lows` adds `model_slug`, `is_merged` and `window_start`, the window's first UTC day.
  Each point is the lowest price on its `date` across all retailers, in stock or not, and days with no observation have no point; an `is_carried_forward` point before the window is the price in force when it opened.
- Amounts are decimal strings, passed through exactly and never rounded.
- Failures are tool errors (`isError: true`) with a short next step, such as how long to wait after `RATE_LIMITED`.

## Resources

| URI | Contents |
| --- | --- |
| `drophawk://component-types` | Every class of product (graphics cards, CPUs, ...) with the Specs its Products carry |
| `drophawk://brands` | Every maker with at least one Product, and how many |

Both are markdown, read fresh from the API.

## Links and prices

The server instructions tell the assistant which link to give:

- `best_price_url`, for someone ready to buy, resolves to the best price when it is followed, so it may reach a different retailer than `best_price` names.
  Following it records a click attributed to MCP, so the assistant must never fetch, prefetch or unfurl it.
- `url`, for someone still comparing, is the Product's page on drophawk.net with the full comparison and history.

`best_price` is the lowest price among retailers with the Product in stock.
It names the one retailer offering it as of `observed_at`, presented as "at last check"; no other retailer is named, and the assistant is told not to guess.
A withheld best price has a reason: `OUT_OF_STOCK` (listed, but in stock nowhere), `NO_DATA` (no price yet) or `MIXED_CURRENCY` (in-stock prices span currencies).
Then `best_price_url` only opens the Product page, so the assistant gives `url` and says when the Product is out of stock.
Daily lows and the all-time low ignore stock, so they can be below anything buyable today; daily lows are withheld for `NO_DATA` and `MIXED_CURRENCY`.

## Retailer text is untrusted

Product, Brand, Spec and retailer text is written by retailers and may carry text aimed at the model.
The server presents it as data, and the instructions tell the model never to follow it:

- It sits between `BEGIN UNTRUSTED PRODUCT DATA <nonce>` and `END UNTRUSTED PRODUCT DATA <nonce>` lines, with a fresh random nonce per response, so the text cannot forge the end of the block.
- Each value is one line, length-capped, markdown-escaped and stripped of invisible characters.
- Web addresses inside it are defanged (`https[:]//evil[.]example`), including lookalike, encoded and punycode spellings, so they are never offered as links.
- Only canonical https links on drophawk.net or its subdomains, all controlled by DropHawk, are passed through; any other link is reported as unavailable.
- Identifiers are shown verbatim in code spans, because the model passes them back.
- Malformed values from the API are dropped or replaced with a fixed placeholder, and dropped daily lows are counted.

## What DropHawk does not know

- Prices are what DropHawk last observed, not live quotes; confirm at the retailer.
- Coverage is PC components and related hardware sold by Australian retailers, so a Product that is not found may still exist.
- Amounts in different currencies are never ranked against each other.
- There is no write API: price monitors and email alerts need a signed-in account at [drophawk.net/signup](https://drophawk.net/signup), which is a human's job.

## Configuration

Nothing is required.

| Environment variable | Meaning |
| --- | --- |
| `DROPHAWK_API_BASE_URL` | Another API origin, for development or a gateway you trust (warned about on stderr). Default `https://api.drophawk.net`. |

The API allows each IP 60 requests a minute on average, in bursts of up to 30.
Diagnostics go to stderr; stdout carries the protocol.
Full documentation is at [developers.drophawk.net](https://developers.drophawk.net).
