import type { Product } from "../src/index.ts";

export interface Call {
  url: URL;
  init: RequestInit;
  headers: Headers;
}

type Responder = (call: Call) => Response | Promise<Response>;

/** An injected fetch that records calls and answers with the given responder(s) in order. */
export function mockFetch(...responders: Responder[]) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = { url: new URL(String(input)), init, headers: new Headers(init.headers) };
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

export function product(slug = "rtx-4090", overrides: Partial<Product> = {}): Product {
  return {
    model_slug: slug,
    model_number: slug.toUpperCase(),
    name: `Product ${slug}`,
    brand: { slug: "asus", name: "ASUS" },
    component_type: { slug: "gpu", name: "Graphics Cards" },
    specs: { vram: { number_value: 24, unit: "GB" } },
    images: [],
    pricing: { best_price: { amount: "1999.00", currency: "AUD" }, in_stock_count: 3 },
    url: `https://drophawk.net/p/${slug}`,
    buy_url: `https://go.drophawk.net/p/${slug}?src=api&rep=json&sig=a%2Bb`,
    ...overrides,
  } as Product;
}
