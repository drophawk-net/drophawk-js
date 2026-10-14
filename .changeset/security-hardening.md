---
"@drophawk/sdk": patch
"@drophawk/mcp": patch
---

Harden against hostile API data and endpoints: the SDK caps response bodies, omits credentials, keeps redirects on the configured origin and validates `baseUrl`; the MCP server sanitises API text, shows only DropHawk https links and marks product data as untrusted.
