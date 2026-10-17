---
"@drophawk/sdk": minor
"@drophawk/mcp": minor
---

Name the best price Retailer (drophawk-net/drophawk#397).
`pricing.best_price.retailer` is a required `{ slug, name }` (`RetailerRef`): the Retailer offering the price as of `observed_at`.
No other Retailer is ever named, and `best_price_url` resolves when followed, so it may since have moved to a different Retailer.
The MCP tools carry `retailer` in `structuredContent` only when its slug is well formed, name it in the best price line as "at last check", and clean its name like other Retailer text, shown only inside the untrusted block.
The server instructions no longer say that DropHawk never names a Retailer.
