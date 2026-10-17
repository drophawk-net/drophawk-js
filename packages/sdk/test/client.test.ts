import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BASE_URL, DropHawk, DropHawkError, VERSION, type DropHawkOptions, type Product } from "../src/index.ts";
import { errorBody, json, mockFetch, product } from "./helpers.ts";

afterEach(() => vi.unstubAllGlobals());

describe("construction", () => {
  it("defaults to the production API and sends a versioned User-Agent", async () => {
    const m = mockFetch(() => json({ brands: [] }));
    await new DropHawk({ fetch: m.fetch }).listBrands();
    expect(DEFAULT_BASE_URL).toBe("https://api.drophawk.net");
    expect(m.calls[0]!.url.origin).toBe("https://api.drophawk.net");
    expect(m.calls[0]!.headers.get("user-agent")).toBe(`drophawk-sdk/${VERSION}`);
    expect(m.calls[0]!.headers.get("accept")).toBe("application/json");
    expect(m.calls[0]!.init.redirect).toBe("follow");
  });

  it("does not set User-Agent in a browser", async () => {
    vi.stubGlobal("document", {});
    const m = mockFetch(() => json({ brands: [] }));
    await new DropHawk({ fetch: m.fetch, userAgent: "shop/1.0" }).listBrands();
    expect(m.calls[0]!.headers.has("user-agent")).toBe(false);
    expect(Object.keys(m.calls[0]!.init.headers as object)).toEqual(["Accept"]);
  });

  it("honours baseUrl (trailing slash tolerated) and a userAgent suffix", async () => {
    const m = mockFetch(() => json({ brands: [] }));
    await new DropHawk({ fetch: m.fetch, baseUrl: "http://localhost:8080/", userAgent: "shop/1.0" }).listBrands();
    expect(m.calls[0]!.url.href).toBe("http://localhost:8080/v1/brands");
    expect(m.calls[0]!.headers.get("user-agent")).toBe(`drophawk-sdk/${VERSION} shop/1.0`);
  });

  it("falls back to the global fetch", async () => {
    const original = globalThis.fetch;
    const m = mockFetch(() => json({ brands: [] }));
    globalThis.fetch = m.fetch;
    try {
      await new DropHawk().listBrands();
      expect(m.calls).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("passes the per-call AbortSignal to fetch", async () => {
    const m = mockFetch(() => json({ brands: [] }));
    const controller = new AbortController();
    await new DropHawk({ fetch: m.fetch }).listBrands({ signal: controller.signal });
    expect(m.calls[0]!.init.signal).toBe(controller.signal);
  });

  it("lets an aborted call reject with the runtime's abort error", async () => {
    const controller = new AbortController();
    const fetchImpl = ((_u: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    const pending = new DropHawk({ fetch: fetchImpl }).listBrands({ signal: controller.signal });
    controller.abort(new DOMException("stop", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("getProduct", () => {
  it("GETs the product and percent-encodes raw model numbers", async () => {
    const p = product("deco-x1500-1-pack");
    const m = mockFetch(() => json(p));
    const got = await new DropHawk({ fetch: m.fetch }).getProduct("Deco X1500(1-pack)");
    expect(got).toEqual(p);
    expect(m.calls[0]!.init.method).toBe("GET");
    expect(m.calls[0]!.url.pathname).toBe("/v1/products/Deco%20X1500(1-pack)");
    expect(m.calls[0]!.url.search).toBe("");
  });

  it("returns best_price_url byte for byte", async () => {
    const p = product("rtx-4090");
    const m = mockFetch(() => json(p));
    const got = await new DropHawk({ fetch: m.fetch }).getProduct("rtx-4090");
    expect(got.best_price_url).toBe("https://go.drophawk.net/p/rtx-4090?src=api&rep=json&sig=a%2Bb");
  });

  it("exposes the canonical model_slug after a followed merged-Product redirect", async () => {
    const survivor = product("survivor");
    const m = mockFetch(() => json(survivor, { url: "https://api.drophawk.net/v1/products/survivor", redirected: true }));
    const got = await new DropHawk({ fetch: m.fetch }).getProduct("old-slug");
    expect(got.model_slug).toBe("survivor");
  });

  it("sends client=mcp only when configured", async () => {
    const m = mockFetch(() => json(product()));
    await new DropHawk({ fetch: m.fetch }).getProduct("a");
    await new DropHawk({ fetch: m.fetch, client: "mcp" } as DropHawkOptions).getProduct("a");
    expect(m.calls[0]!.url.searchParams.has("client")).toBe(false);
    expect(m.calls[1]!.url.searchParams.get("client")).toBe("mcp");
  });

  it.each(["a/b", ".", ".."])("rejects %j locally as INVALID_IDENTIFIER", async (id) => {
    const m = mockFetch(() => json(product()));
    const err = await new DropHawk({ fetch: m.fetch }).getProduct(id).catch((e) => e);
    expect(err).toBeInstanceOf(DropHawkError);
    expect(err).toMatchObject({ reason: "INVALID_IDENTIFIER", status: 400 });
    expect(err.message).toContain("model_slug");
    expect(m.calls).toHaveLength(0);
  });

  it("sends dots inside an identifier and other awkward characters safely", async () => {
    const m = mockFetch(() => json(product()));
    await new DropHawk({ fetch: m.fetch }).getProduct("a.b ...?#%");
    expect(m.calls[0]!.url.pathname).toBe("/v1/products/a.b%20...%3F%23%25");
  });

  it("rejects an empty identifier without calling the API", async () => {
    const m = mockFetch(() => json(product()));
    await expect(new DropHawk({ fetch: m.fetch }).getProduct("")).rejects.toThrow(TypeError);
    expect(m.calls).toHaveLength(0);
  });

  it("throws DropHawkError with the reason for a 404", async () => {
    const m = mockFetch(() => json(errorBody(5, "not_found", "PRODUCT_NOT_FOUND"), { status: 404 }));
    const err = await new DropHawk({ fetch: m.fetch }).getProduct("nope").catch((e) => e);
    expect(err).toBeInstanceOf(DropHawkError);
    expect(err).toMatchObject({ status: 404, reason: "PRODUCT_NOT_FOUND", domain: "drophawk.net", retryable: false, retryAfterSeconds: undefined });
  });
});

describe("getProducts", () => {
  it("POSTs identifiers and returns results in request order with per-item errors", async () => {
    const results = [
      { identifier: "a", is_merged: false, product: product("a") },
      { identifier: "ghost", is_merged: false, error: { reason: "PRODUCT_NOT_FOUND" } },
      { identifier: "old", is_merged: true, product: product("new") },
      { identifier: "   ", is_merged: false, error: { reason: "INVALID_IDENTIFIER" } },
    ];
    const m = mockFetch(() => json({ results }));
    const got = await new DropHawk({ fetch: m.fetch }).getProducts(["a", "ghost", "old", "   "]);
    expect(got).toEqual(results);
    expect(got[1]!.error?.reason).toBe("PRODUCT_NOT_FOUND");
    expect(got[2]!.is_merged).toBe(true);
    const call = m.calls[0]!;
    expect(call.init.method).toBe("POST");
    expect(call.url.pathname).toBe("/v1/products:batchGet");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(call.init.body))).toEqual({ identifiers: ["a", "ghost", "old", "   "] });
  });

  it("puts client in the body for the MCP server", async () => {
    const m = mockFetch(() => json({ results: [] }));
    await new DropHawk({ fetch: m.fetch, client: "mcp" } as DropHawkOptions).getProducts(["a"]);
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({ identifiers: ["a"], client: "mcp" });
  });

  it("throws for a batch-level problem and exposes its metadata", async () => {
    const m = mockFetch(() => json(errorBody(3, "invalid_argument", "BATCH_TOO_LARGE", { max_identifiers: "50" }), { status: 400 }));
    const err = (await new DropHawk({ fetch: m.fetch }).getProducts(Array(51).fill("a")).catch((e) => e)) as DropHawkError;
    expect(err.reason).toBe("BATCH_TOO_LARGE");
    expect(err.metadata).toEqual({ max_identifiers: "50" });
  });
});

describe("searchProducts", () => {
  it("maps params to the query string and returns the page", async () => {
    const page = { products: [product("a")], next_page_token: "tok" };
    const m = mockFetch(() => json(page));
    const got = await new DropHawk({ fetch: m.fetch }).searchProducts({ query: "rtx 4090", page_size: 5, page_token: "t0" });
    expect(got).toEqual(page);
    const q = m.calls[0]!.url.searchParams;
    expect(m.calls[0]!.url.pathname).toBe("/v1/products:search");
    expect([q.get("q"), q.get("page_size"), q.get("page_token"), q.has("client")]).toEqual(["rtx 4090", "5", "t0", false]);
  });

  it("omits unset optional params and sends client=mcp when configured", async () => {
    const m = mockFetch(() => json({ products: [], next_page_token: "" }));
    await new DropHawk({ fetch: m.fetch, client: "mcp" } as DropHawkOptions).searchProducts({ query: "x" });
    expect([...m.calls[0]!.url.searchParams.keys()].sort()).toEqual(["client", "q"]);
  });

  it("throws INVALID_QUERY", async () => {
    const m = mockFetch(() => json(errorBody(3, "invalid_argument", "INVALID_QUERY"), { status: 400 }));
    await expect(new DropHawk({ fetch: m.fetch }).searchProducts({ query: " " })).rejects.toMatchObject({ reason: "INVALID_QUERY", status: 400 });
  });
});

describe("iterateSearchProducts", () => {
  const pages = [
    { products: [product("a"), product("b")], next_page_token: "p2" },
    { products: [product("c")], next_page_token: "p3" },
    { products: [product("d")], next_page_token: "" },
  ];
  const pager = () => mockFetch((c) => json(pages[{ "": 0, p2: 1, p3: 2 }[c.url.searchParams.get("page_token") ?? ""]!]));

  it("walks every page in order, threading tokens and params", async () => {
    const m = pager();
    const slugs: string[] = [];
    for await (const p of new DropHawk({ fetch: m.fetch }).iterateSearchProducts({ query: "gpu", page_size: 2 })) slugs.push(p.model_slug);
    expect(slugs).toEqual(["a", "b", "c", "d"]);
    expect(m.calls.map((c) => c.url.searchParams.get("page_token"))).toEqual([null, "p2", "p3"]);
    expect(m.calls.every((c) => c.url.searchParams.get("page_size") === "2" && c.url.searchParams.get("q") === "gpu")).toBe(true);
  });

  it("is lazy: breaking out stops fetching", async () => {
    const m = pager();
    for await (const p of new DropHawk({ fetch: m.fetch }).iterateSearchProducts({ query: "gpu" })) {
      if (p.model_slug === "b") break;
    }
    expect(m.calls).toHaveLength(1);
  });

  it("surfaces a mid-iteration error", async () => {
    const m = mockFetch(
      () => json(pages[0]),
      () => json(errorBody(3, "invalid_argument", "INVALID_PAGE_TOKEN"), { status: 400 }),
    );
    const seen: string[] = [];
    const run = async () => {
      for await (const p of new DropHawk({ fetch: m.fetch }).iterateSearchProducts({ query: "gpu" })) seen.push(p.model_slug);
    };
    await expect(run()).rejects.toMatchObject({ reason: "INVALID_PAGE_TOKEN" });
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("getDailyLows", () => {
  const body = { model_slug: "rtx-4090", is_merged: false, window_start: "2026-09-17", points: [{ date: "2026-10-01", price: { amount: "10.00", currency: "AUD" }, is_carried_forward: false }] };

  const meta = { model_slug: "x", is_merged: false, window_start: "2026-09-17" };

  it("exposes the response model_slug, is_merged and window_start", async () => {
    const m = mockFetch(() => json({ ...meta, model_slug: "survivor", points: [] }));
    const got = await new DropHawk({ fetch: m.fetch }).getDailyLows("old");
    expect([got.model_slug, got.is_merged, got.window_start]).toEqual(["survivor", false, "2026-09-17"]);
  });

  it("GETs the daily lows", async () => {
    const m = mockFetch(() => json(body));
    const got = await new DropHawk({ fetch: m.fetch }).getDailyLows("rtx-4090");
    expect(m.calls[0]!.url.pathname).toBe("/v1/products/rtx-4090/daily-lows");
    expect(got).toEqual(body);
  });

  it("passes a withheld reason through", async () => {
    const m = mockFetch(() => json({ ...meta, points: [], withheld_reason: "MIXED_CURRENCY" }));
    expect(await new DropHawk({ fetch: m.fetch }).getDailyLows("x")).toEqual({ ...meta, points: [], withheld_reason: "MIXED_CURRENCY" });
  });
});

describe("repeated page tokens", () => {
  it("stop iteration with INVALID_RESPONSE instead of looping", async () => {
    const m = mockFetch(() => json({ products: [product("a")], next_page_token: "same" }));
    const seen: string[] = [];
    const run = async () => {
      for await (const p of new DropHawk({ fetch: m.fetch }).iterateSearchProducts({ query: "x" })) seen.push(p.model_slug);
    };
    await expect(run()).rejects.toMatchObject({ reason: "INVALID_RESPONSE" });
    expect(m.calls).toHaveLength(2);
  });
});

describe("types", () => {
  it("reject typos in request params and unknown fields", () => {
    // @ts-expect-error pageSize is not a wire name
    const a: Parameters<DropHawk["searchProducts"]>[0] = { query: "x", pageSize: 1 };
    // @ts-expect-error unknown field on a Product
    const b: string = product().best_price_urll;
    expect([a, b]).toBeDefined();
  });

  it("best_price is a nested price and observation time, and Money keeps any decimals", () => {
    const best = product("x", { pricing: { best_price: { price: { amount: "599", currency: "JPY" }, observed_at: "2026-10-16T01:00:00Z" }, in_stock_count: 1 } }).pricing.best_price;
    expect(best?.price.amount).toBe("599");
    expect(best?.observed_at).toBe("2026-10-16T01:00:00Z");
  });

  it("best_price_url is a required string", () => {
    const url: string = product().best_price_url;
    expect(typeof url).toBe("string");
  });
});

describe("catalog lists", () => {
  it("listComponentTypes unwraps component_types", async () => {
    const ct = [{ slug: "gpu", name: "Graphics Cards", product_count: 1, spec_schema: [] }];
    const m = mockFetch(() => json({ component_types: ct }));
    expect(await new DropHawk({ fetch: m.fetch }).listComponentTypes()).toEqual({ component_types: ct });
    expect(m.calls[0]!.url.pathname).toBe("/v1/component-types");
  });

  it("listBrands unwraps brands", async () => {
    const brands = [{ slug: "asus", name: "ASUS", product_count: 2 }];
    const m = mockFetch(() => json({ brands }));
    expect(await new DropHawk({ fetch: m.fetch }).listBrands()).toEqual({ brands });
    expect(m.calls[0]!.url.pathname).toBe("/v1/brands");
  });
});

describe("SpecValue", () => {
  it("requires exactly one value field", () => {
    const ok: Product["specs"] = {
      vram: { number_value: 24, unit: "GB" },
      model: { string_value: "RTX" },
      rgb: { bool_value: true },
    };
    // @ts-expect-error a SpecValue needs a value
    const none: Product["specs"] = { vram: {} };
    // @ts-expect-error a SpecValue has exactly one value
    const two: Product["specs"] = { vram: { number_value: 24, string_value: "24" } };
    // @ts-expect-error a value alone is not enough with the wrong type
    const wrong: Product["specs"] = { vram: { number_value: "24" } };
    expect([ok, none, two, wrong]).toBeDefined();
  });
});

describe("hardening", () => {
  const stream = (chunks: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });

  it("never sends credentials", async () => {
    const m = mockFetch(() => json({ brands: [] }));
    await new DropHawk({ fetch: m.fetch }).listBrands();
    expect(m.calls[0]!.init.credentials).toBe("omit");
  });

  it("rejects a body over 8 MiB with INVALID_RESPONSE and stops reading", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const m = mockFetch(() => new Response(body, { status: 200 }));
    const err = await new DropHawk({ fetch: m.fetch }).listBrands().catch((e) => e);
    expect(err).toBeInstanceOf(DropHawkError);
    expect(err.reason).toBe("INVALID_RESPONSE");
    expect(pulled).toBeLessThan(20);
  });

  it("caps error bodies too", async () => {
    const m = mockFetch(() => new Response(stream(Array.from({ length: 10 }, () => new Uint8Array(1024 * 1024))), { status: 500 }));
    const err = await new DropHawk({ fetch: m.fetch }).listBrands().catch((e) => e);
    expect(err).toBeInstanceOf(DropHawkError);
    expect(err.reason).toBe("INVALID_RESPONSE");
  });

  it("rejects an oversized declared content-length without reading", async () => {
    const m = mockFetch(() => new Response("{}", { status: 200, headers: { "content-length": String(9 * 1024 * 1024) } }));
    const err = await new DropHawk({ fetch: m.fetch }).listBrands().catch((e) => e);
    expect(err.reason).toBe("INVALID_RESPONSE");
  });

  describe("rejects promptly while an unread clone keeps the body alive", () => {
    // Cancelling one branch of a tee resolves only once every branch is cancelled, so awaiting the cancel would hang forever here.
    const kept: Response[] = [];
    afterEach(() => void kept.splice(0));
    function retaining(res: Response): () => Response {
      return () => {
        kept.push(res.clone());
        return res;
      };
    }
    const endless = () => new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(1024 * 1024).fill(0x20)) });
    const within = <T,>(p: Promise<T>, ms = 1000) =>
      Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms))]);

    it.each([
      ["a declared oversized body", () => new Response(endless(), { status: 200, headers: { "content-length": String(9 * 1024 * 1024) } })],
      ["a streamed oversized body", () => new Response(endless(), { status: 200 })],
      [
        "a redirect to another origin",
        () => {
          const res = new Response(endless(), { status: 200 });
          Object.defineProperty(res, "url", { value: "https://evil.example/v1/brands" });
          return res;
        },
      ],
    ])("%s", async (_, make) => {
      const m = mockFetch(retaining(make()));
      const err = await within(new DropHawk({ fetch: m.fetch }).listBrands().catch((e: unknown) => e));
      expect(err).toBeInstanceOf(DropHawkError);
      expect((err as DropHawkError).reason).toBe("INVALID_RESPONSE");
    });
  });

  it("still reads an ordinary body", async () => {
    const m = mockFetch(() => new Response(stream([new TextEncoder().encode('{"brands":'), new TextEncoder().encode("[]}")]), { status: 200 }));
    expect(await new DropHawk({ fetch: m.fetch }).listBrands()).toEqual({ brands: [] });
  });

  it("accepts a same-origin redirect (merged Product)", async () => {
    const m = mockFetch(() => json(product("survivor"), { url: "https://api.drophawk.net/v1/products/survivor", redirected: true }));
    expect((await new DropHawk({ fetch: m.fetch }).getProduct("old")).model_slug).toBe("survivor");
  });

  it("rejects a redirect that ends on another origin", async () => {
    const m = mockFetch(() => json({ brands: [] }, { url: "https://evil.example/v1/brands", redirected: true }));
    const err = await new DropHawk({ fetch: m.fetch }).listBrands().catch((e) => e);
    expect(err).toBeInstanceOf(DropHawkError);
    expect(err.reason).toBe("INVALID_RESPONSE");
  });

  it("never lets fetch follow a redirect for the batch POST, so its body is never resent elsewhere", async () => {
    const m = mockFetch(() => json({ results: [] }));
    await new DropHawk({ fetch: m.fetch }).getProducts(["a"]);
    expect(m.calls[0]!.init.method).toBe("POST");
    expect(m.calls[0]!.init.redirect).toBe("manual");
  });

  it.each([301, 302, 303, 307, 308])("rejects a %i answer to the batch POST", async (status) => {
    const m = mockFetch(() => new Response(null, { status, headers: { location: "https://evil.example/v1/products:batchGet" } }));
    const err = await new DropHawk({ fetch: m.fetch }).getProducts(["a"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DropHawkError);
    expect((err as DropHawkError).reason).toBe("INVALID_RESPONSE");
    expect(m.calls).toHaveLength(1);
  });

  it("rejects an opaque redirect (how a browser reports a manual redirect) to the batch POST", async () => {
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, "type", { value: "opaqueredirect" });
    Object.defineProperty(res, "status", { value: 0 });
    Object.defineProperty(res, "ok", { value: false });
    const err = await new DropHawk({ fetch: mockFetch(() => res).fetch }).getProducts(["a"]).catch((e: unknown) => e);
    expect((err as DropHawkError).reason).toBe("INVALID_RESPONSE");
  });

  it("still follows redirects for GET (a merged Product answers 301)", async () => {
    const m = mockFetch(() => json({ brands: [] }));
    await new DropHawk({ fetch: m.fetch }).listBrands();
    expect(m.calls[0]!.init.redirect).toBe("follow");
  });

  it("rejects a redirect to another origin even when the answer is an error", async () => {
    const m = mockFetch(() => json({}, { status: 500, url: "http://api.drophawk.net/v1/brands", redirected: true }));
    const err = await new DropHawk({ fetch: m.fetch }).listBrands().catch((e) => e);
    expect(err.reason).toBe("INVALID_RESPONSE");
  });
});

describe("baseUrl validation", () => {
  it.each(["ftp://api.drophawk.net", "javascript:alert(1)", "not a url", "https://api.drophawk.net?x=1", "https://api.drophawk.net/#frag", "https://user:pw@api.drophawk.net", "https://api.drophawk.net?", ""])(
    "rejects %j",
    (baseUrl) => {
      expect(() => new DropHawk({ baseUrl })).toThrow(TypeError);
    },
  );

  it("strips trailing slashes and keeps a path prefix", async () => {
    const m = mockFetch(() => json({ brands: [] }));
    await new DropHawk({ fetch: m.fetch, baseUrl: "https://gw.example.com/api///" }).listBrands();
    expect(m.calls[0]!.url.href).toBe("https://gw.example.com/api/v1/brands");
  });

  it("handles a huge run of slashes quickly", () => {
    const start = performance.now();
    new DropHawk({ baseUrl: "https://api.drophawk.net" + "/".repeat(200_000) });
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("accepts http for local development", () => {
    expect(() => new DropHawk({ baseUrl: "http://127.0.0.1:8080" })).not.toThrow();
  });
});
