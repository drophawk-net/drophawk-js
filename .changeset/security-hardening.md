---
"@drophawk/sdk": patch
"@drophawk/mcp": patch
---

Harden against hostile API data and endpoints: the SDK caps response bodies, omits credentials, keeps redirects on the configured origin and validates `baseUrl`; the MCP server sanitises API text and defangs web addresses inside it, shows only DropHawk https links in their exact canonical form, drops malformed daily lows, and fences product data between untrusted-data markers that carry a per-response nonce.
