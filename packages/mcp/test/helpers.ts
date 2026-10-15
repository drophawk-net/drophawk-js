import { DropHawk } from "@drophawk/sdk";
import type { Product } from "@drophawk/sdk";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "../src/index.js";

export interface Call {
  url: URL;
  init: RequestInit;
}

type Responder = (call: Call) => Response | Promise<Response>;

/** An injected fetch that records calls and answers with the given responder(s) in order. */
export function mockFetch(...responders: Responder[]) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = { url: new URL(String(input)), init };
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (!responder) throw new Error("no responder");
    return responder(call);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function json(body: unknown, init: ResponseInit & { url?: string; redirected?: boolean } = {}): Response {
  const { url, redirected, ...rest } = init;
  const res = new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...rest });
  if (url !== undefined) Object.defineProperty(res, "url", { value: url });
  if (redirected !== undefined) Object.defineProperty(res, "redirected", { value: redirected });
  return res;
}

export function errorBody(code: number, message: string, reason: string, metadata?: Record<string, string>) {
  return {
    code,
    message,
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "drophawk.net", ...(metadata ? { metadata } : {}) }],
  };
}

/** The best_price_url's query is deliberately awkward: a `+` encoded as %2B must survive untouched. */
export function product(slug = "rtx-4090", overrides: Partial<Product> = {}): Product {
  return {
    model_slug: slug,
    model_number: slug.toUpperCase(),
    name: `Product ${slug}`,
    brand: { slug: "asus", name: "ASUS" },
    component_type: { slug: "gpu", name: "Graphics Cards" },
    specs: { vram: { number_value: 24, unit: "GB" }, ray_tracing: { bool_value: true }, chipset: { string_value: "RTX 4090" } },
    images: [{ url: `https://img.drophawk.net/${slug}.webp`, alt_text: "", width: 100, height: 100 }],
    pricing: {
      best_price: { price: { amount: "1999.00", currency: "AUD" }, observed_at: "2026-10-09T01:02:03Z" },
      in_stock_count: 3,
      all_time_low: { price: { amount: "1799.00", currency: "AUD" }, date: "2025-11-28" },
    },
    url: `https://drophawk.net/p/${slug}`,
    best_price_url: `https://go.drophawk.net/p/${slug}?src=mcp&rep=json&sig=a%2Bb`,
    ...overrides,
  } as Product;
}

/** Connects a real MCP client to the server in memory, with the real SDK talking to the stubbed fetch. */
export async function connect(fetch: typeof globalThis.fetch) {
  const server = createServer({ fetch, baseUrl: "https://api.test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export { DropHawk };

export function textOf(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text?: string }[])[0];
  if (!first || first.type !== "text" || first.text === undefined) throw new Error("no text content");
  return first.text;
}
