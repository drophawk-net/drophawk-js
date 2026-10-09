# @drophawk/mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant look up current and historical prices for PC components and related hardware sold by Australian retailers, and hand you a link to buy at the best price.

- Three tools and two resources, all read only, plus server instructions that carry the shared rules.
- No API key and no account.
  It is a thin layer over [`@drophawk/sdk`](../sdk/README.md) and the anonymous [DropHawk developer API](https://developers.drophawk.net).
- Runs locally over stdio on Node 22+ (or Bun), started by your MCP client.

## Install

The command is always `npx -y @drophawk/mcp` (or `bunx @drophawk/mcp`).
Your MCP client starts it for you.

### Claude Code

```sh
claude mcp add drophawk -- npx -y @drophawk/mcp
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop.

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

### Cursor

Add this to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project).

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

## Tools

| Tool | Use it to |
| --- | --- |
| `search_products(query, limit?)` | Find Products by text, such as a model name or number. Returns the best matches first, one page, `limit` 1 to 50 (default 10). |
| `get_products(identifiers[])` | Get one or many Products, up to 50, by `model_slug` or raw model number. Results keep the order asked and a Product that is not found is reported in its own entry. A batch counts as one request. |
| `get_daily_lows(identifier)` | Get the last 30 days of daily lows for a Product: the lowest price observed each day across all retailers, in stock or not. |

Every tool answers with compact markdown for the model and the same data as `structuredContent`, described by the tool's `outputSchema`.
Failures come back as a tool error (`isError: true`) with a short explanation of what to do next, for example how long to wait after `RATE_LIMITED`.

### Links

Every Product carries two links.

- `buy_url` is for someone who is ready to buy.
  It is a DropHawk link that resolves to the best price at the moment it is followed, and it never names a retailer.
  Following it is recorded as a click, so an assistant must never fetch, prefetch or unfurl it.
  The server asks the API for it as an MCP surface, so those clicks are attributed to MCP.
- `url` is for someone who is still comparing.
  It is the Product's page on drophawk.net with the full price comparison and history.

When a Product has no best price, `buy_url` only opens the Product page, so the assistant is told to give `url` instead and to say the Product is out of stock if that is why.
DropHawk never says which retailer has the best price, so the assistant is told not to guess one.

Both are passed through exactly as the API gave them.

### What DropHawk does not know

- Prices are what DropHawk last observed, not live retailer quotes.
- Coverage is PC components and related hardware sold by Australian retailers.
  A Product that is not found is not proof that it does not exist.
- The best price counts retailers that have the Product in stock, and it can be withheld.
  `OUT_OF_STOCK` means retailers list the Product but none has it in stock right now.
  `NO_DATA` means DropHawk has no price for it yet.
  `MIXED_CURRENCY` means the in-stock prices are in more than one currency, so no single lowest exists.
- There is no write API here: price monitors and email alerts need a signed-in account at https://drophawk.net/signup, which is a human's job.
- Daily lows ignore stock, so a daily low may be lower than anything that can be bought today.
  They are withheld for `NO_DATA` and `MIXED_CURRENCY` as well.

## Resources

| URI | Contents |
| --- | --- |
| `drophawk://component-types` | Every class of product DropHawk lists (graphics cards, CPUs, ...) with the Specs its Products carry. |
| `drophawk://brands` | Every maker with at least one Product, and how many. |

Both are markdown, and read fresh from the API when requested.

## Example

Illustrative: the Product, prices and link below are made up.

> **You:** What's the cheapest RTX 4070 Super right now, and is it a good price?
>
> The assistant calls `search_products("rtx 4070 super", 5)`, picks the Product that matches, then calls `get_daily_lows` for it.
>
> **Assistant:** The lowest in-stock price DropHawk last saw for the Gigabyte RTX 4070 Super Windforce OC is 849.00 AUD, in stock at 4 retailers.
> Over the last 30 days its daily low ranged from 829.00 AUD to 899.00 AUD, so this is close to the bottom of the range.
> Prices are observed rather than live, so check the retailer before you pay.
> If you want to compare, the full price history is at https://drophawk.net/p/gv-n407swf3oc-12gd.
> To buy at the best price: https://go.drophawk.net/p/gv-n407swf3oc-12gd?src=mcp&rep=json&sig=...

## Configuration

Nothing is required.

| Environment variable | Meaning |
| --- | --- |
| `DROPHAWK_API_BASE_URL` | Use another API origin, for testing. Defaults to `https://api.drophawk.net`. |

The API allows each IP address 60 requests a minute on average.
Diagnostics go to stderr, because stdout carries the protocol.

## Maintaining this package

The catalogue limits in the server instructions are generated from `spec/catalogue-limits.txt` (`bun run generate` here); CI fails when they are stale.
The server is built on `@modelcontextprotocol/server`, the stable v2 line of the MCP TypeScript SDK, and on `@drophawk/sdk` through the workspace.
Build the SDK before this package (`bun run --filter @drophawk/sdk build`), because this package compiles and tests against the SDK's `dist`.
`bun run test` here builds the server and then runs the unit tests and an end-to-end test that spawns `dist/bin.js` over stdio against a local stub API.

Versions and changelogs come from [Changesets](https://github.com/changesets/changesets), exactly as for the SDK: run `bun run changeset` at the repository root and commit the file.
Never edit `CHANGELOG.md` or the version by hand.
The release workflow rewrites the `workspace:` range on `@drophawk/sdk` to a real version range just before publishing (`scripts/resolve-workspace-deps.ts`), because `npm publish` would otherwise upload it verbatim.

### First publish (one-off, human)

This is a one-off step for a human who owns the `@drophawk` npm organisation.
No agent or workflow does it.

Prerequisites, both already met (the same as the SDK's):

- The repository is MIT licensed.
- The GitHub repository, `drophawk-net/drophawk-js`, is public.
  Trusted publishing only attests provenance for public repositories.

npm packs a `LICENSE` file automatically once it exists in the package directory.
The root `LICENSE` is the single source, so `scripts/prepare-publish.ts` copies it into each package directory at publish time (the copies are gitignored, never committed).
The release workflow's publish job runs that script first and fails there, before anything is published, if the root `LICENSE` or either `license` field is missing.
Pull requests are not affected.
`bun run release` runs it too, and step 2 below runs it for the manual publish.

npm configures a trusted publisher from the package's settings page, so the package has to exist first.
Do the SDK's [first publish](../sdk/README.md#first-publish-one-off-human) before this one, because this package depends on `@drophawk/sdk`.

A plain `npm publish` skips the release workflow's `workspace:` rewrite, so it would upload `"@drophawk/sdk": "workspace:^"` and the package could not be installed.
Publish from a throwaway checkout after the rewrite:

1. Merge the "chore: version packages" PR that the Release workflow opens, which bumps `@drophawk/mcp` to `0.1.0`.
   The first run of the publish job fails for this package because npm does not know it yet; that is expected.
2. In a throwaway clone of `main` at the version commit, run these at the repository root:
   `bun install --frozen-lockfile`, then `bun scripts/prepare-publish.ts`, then `bun run --filter @drophawk/sdk build`, then `bun scripts/resolve-workspace-deps.ts`.
   The SDK build is needed because packing builds this package, which compiles against `packages/sdk/dist`, and that is gitignored so a fresh clone has none.
   Never commit the result.
3. In `packages/mcp`, run `npm pack --dry-run --json` and check that no `workspace:` appears in the packed `package.json`; for example `npm pack --pack-destination /tmp --silent && tar -xzOf /tmp/drophawk-mcp-0.1.0.tgz package/package.json | grep workspace:` must print nothing.
4. Still in `packages/mcp`, run `npm publish --provenance=false`, signing in with 2FA.
   This publishes the real `0.1.0` as `latest`; the `prepack` script builds it first.
   Provenance is off only because a local publish cannot produce it; trusted publishing adds it from the next release on.
5. On npmjs.com open `@drophawk/mcp` > Settings > Trusted Publisher, choose GitHub Actions, and enter organization or user `drophawk-net`, repository `drophawk-js`, workflow filename `release.yml`, and no environment.
6. Tag the release that the workflow could not: `git tag @drophawk/mcp@0.1.0 <version-commit>` and `git push origin @drophawk/mcp@0.1.0`.
