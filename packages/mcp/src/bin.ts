#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

// stdout is the protocol channel, so everything diagnostic goes to stderr.
// A tool call never throws (errors become tool results), so reaching either handler means the process is in an unknown state.
// Log and exit non-zero so the client sees the server die and can restart it, rather than hang on a half-working one.
process.on("unhandledRejection", (reason) => {
  console.error("drophawk-mcp: unhandled rejection:", reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("drophawk-mcp: uncaught exception:", err);
  process.exit(1);
});

const baseUrl = process.env["DROPHAWK_API_BASE_URL"]?.trim() || undefined;

if (baseUrl) {
  // Everything the model sees comes from this host, so pointing it elsewhere is a trust decision the person should see.
  console.error(`drophawk-mcp: warning: DROPHAWK_API_BASE_URL is set; using ${baseUrl} instead of the production API. Only do this for development or a gateway you trust.`);
}

serveStdio(() => createServer({ baseUrl }), {
  onerror: (err) => console.error("drophawk-mcp:", err),
});
