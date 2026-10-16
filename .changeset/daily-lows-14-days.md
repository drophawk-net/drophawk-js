---
"@drophawk/sdk": minor
"@drophawk/mcp": minor
---

Follow the 14-day daily lows window (drophawk-net/drophawk#398).
The window is today (UTC) and the 13 days before, starting at `window_start`, plus the carried-forward point: up to 15 points.
The MCP tool is titled "Get a PC component's 14-day price lows"; its output and instructions say "recent" and name the window by `window_start`, so a later change of window needs no MCP release.
