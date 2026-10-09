import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, errorBody, json, mockFetch, product, textOf } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(...responders: Parameters<typeof mockFetch>) {
  const stub = mockFetch(...responders);
  const c = await connect(stub.fetch);
  close = c.close;
  return { ...c, calls: stub.calls };
}

describe("tools/list", () => {
  it("lists exactly the three tools, read only, each with an output schema", async () => {
    const { client } = await setup(() => json({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_daily_lows", "get_products", "search_products"]);
    for (const t of tools) {
      expect(t.outputSchema).toBeDefined();
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("tells the model how to use links and what DropHawk does not know, without an em dash", async () => {
    const { client } = await setup(() => json({}));
    const { tools } = await client.listTools();
    for (const name of ["search_products", "get_products"]) {
      const d = tools.find((t) => t.name === name)?.description ?? "";
      expect(d).toContain("Give buy_url to someone who is ready to buy");
      expect(d).toContain("Give url to someone who is still comparing");
      expect(d).toMatch(/never fetch, prefetch or unfurl buy_url/i);
      expect(d).toContain("not live retailer quotes");
      expect(d).toContain("PC components and related hardware sold by Australian retailers");
      expect(d).toContain("buy_url only opens the Product page");
      expect(d).toContain("DropHawk does not say which retailer has the best price; do not guess one.");
      for (const reason of ["OUT_OF_STOCK", "NO_DATA", "MIXED_CURRENCY"]) expect(d).toContain(reason);
    }
    const lows = tools.find((t) => t.name === "get_daily_lows")?.description ?? "";
    expect(lows).toMatch(/whether or not the retailer had stock/);
    expect(tools.find((t) => t.name === "search_products")?.description).toContain("raise limit (up to 50) or narrow the query");
    for (const t of tools) expect(JSON.stringify(t)).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("byte limits", () => {
  const cjk100 = "显卡".repeat(50); // 100 characters, 300 UTF-8 bytes
  const cjk85 = "显".repeat(85); // 85 characters, 255 bytes

  it("rejects text over 256 UTF-8 bytes even when it is under 256 characters, before calling the API", async () => {
    expect(cjk100.length).toBeLessThan(256);
    const { client, calls } = await setup(() => json({}));
    const results = await Promise.all([
      client.callTool({ name: "search_products", arguments: { query: cjk100 } }),
      client.callTool({ name: "get_products", arguments: { identifiers: ["ok", cjk100] } }),
      client.callTool({ name: "get_daily_lows", arguments: { identifier: cjk100 } }),
    ]);
    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("at most 256 UTF-8 bytes");
    }
    expect(calls).toHaveLength(0);
  });

  it("accepts multi-byte text that fits", async () => {
    const { client, calls } = await setup(() => json({ products: [], next_page_token: "" }));
    const r = await client.callTool({ name: "search_products", arguments: { query: cjk85 } });
    expect(r.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
  });

  it("says bytes, not characters, in the declared schemas", async () => {
    const { client } = await setup(() => json({}));
    const { tools } = await client.listTools();
    for (const t of tools) expect(JSON.stringify(t.inputSchema)).toContain("UTF-8 bytes");
  });
});

describe("search_products", () => {
  it("returns markdown and structuredContent, passes buy_url through untouched, and asks as client=mcp", async () => {
    const p = product("rtx-4090");
    const { client, calls } = await setup(() => json({ products: [p], next_page_token: "" }));
    const result = await client.callTool({ name: "search_products", arguments: { query: "rtx 4090" } });

    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain("Product rtx-4090");
    expect(text).toContain("Best price: 1999.00 AUD");
    expect(text).toContain("All-time low: 1799.00 AUD, the lowest daily price ever recorded (first on 2025-11-28)");
    expect(text).toContain("model number RTX-4090");
    expect(text).toContain(`url: ${p.url}`);
    expect(text).toContain(`buy_url: ${p.buy_url}`);

    const sc = result.structuredContent as { products: { buy_url: string; url: string; best_price: unknown }[]; has_more: boolean };
    expect(sc.products[0]?.buy_url).toBe(p.buy_url);
    expect(sc.products[0]?.url).toBe(p.url);
    expect(sc.products[0]?.best_price).toEqual({ amount: "1999.00", currency: "AUD" });
    expect(sc.has_more).toBe(false);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/v1/products:search");
    expect(calls[0]?.url.searchParams.get("client")).toBe("mcp");
    expect(calls[0]?.url.searchParams.get("q")).toBe("rtx 4090");
    expect(calls[0]?.url.searchParams.get("page_size")).toBe("10");
  });

  it("passes the limit through and flags more results", async () => {
    const { client, calls } = await setup(() => json({ products: [product("a"), product("b")], next_page_token: "next" }));
    const result = await client.callTool({ name: "search_products", arguments: { query: "gpu", limit: 2 } });
    expect(calls[0]?.url.searchParams.get("page_size")).toBe("2");
    expect((result.structuredContent as { has_more: boolean }).has_more).toBe(true);
    expect(textOf(result)).toContain("raise limit, up to 50, or narrow the query");
  });

  it("holds the caller's limit when the API returns more", async () => {
    const { client } = await setup(() => json({ products: [product("a"), product("b"), product("c")], next_page_token: "" }));
    const result = await client.callTool({ name: "search_products", arguments: { query: "gpu", limit: 2 } });
    const sc = result.structuredContent as { products: unknown[]; has_more: boolean };
    expect(sc.products).toHaveLength(2);
    expect(sc.has_more).toBe(true);
  });

  it("says plainly when nothing matches", async () => {
    const { client } = await setup(() => json({ products: [], next_page_token: "" }));
    const result = await client.callTool({ name: "search_products", arguments: { query: "zzz" } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('No Products match "zzz"');
    expect((result.structuredContent as { products: unknown[] }).products).toEqual([]);
  });

  it("rejects a limit over 50 and a blank query before calling the API", async () => {
    const { client, calls } = await setup(() => json({}));
    const over = await client.callTool({ name: "search_products", arguments: { query: "x", limit: 51 } });
    const blank = await client.callTool({ name: "search_products", arguments: { query: "   " } });
    expect(over.isError).toBe(true);
    expect(blank.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("explains each reason a price is withheld", async () => {
    const withheld = (best_price_withheld_reason: string) => product("x", { pricing: { in_stock_count: 0, best_price_withheld_reason } });
    const { client } = await setup(() =>
      json({ products: [withheld("OUT_OF_STOCK"), withheld("NO_DATA"), withheld("MIXED_CURRENCY"), withheld("SOMETHING_NEW")], next_page_token: "" }),
    );
    const text = textOf(await client.callTool({ name: "search_products", arguments: { query: "x" } }));
    expect(text).toContain("none has it in stock right now");
    expect(text).toContain("no best price right now, so this only opens the Product page; give url instead");
    expect(text).toContain("DropHawk has no price for it yet");
    expect(text).toContain("more than one currency");
    expect(text).toContain("unknown (SOMETHING_NEW)");
  });
});

describe("get_products", () => {
  it("preserves order, reports per-item not-found, and flags merges", async () => {
    const survivor = product("survivor");
    const { client, calls } = await setup(() =>
      json({
        results: [
          { identifier: "rtx-4090", merged: false, product: product("rtx-4090") },
          { identifier: "no-such-part", merged: false, error: { reason: "PRODUCT_NOT_FOUND", message: "x" } },
          { identifier: "old-name", merged: true, product: survivor },
          { identifier: "a/b", merged: false, error: { reason: "INVALID_IDENTIFIER", message: "x" } },
        ],
      }),
    );
    const result = await client.callTool({ name: "get_products", arguments: { identifiers: ["rtx-4090", "no-such-part", "old-name", "a/b"] } });
    expect(result.isError).toBeFalsy();

    const body = JSON.parse(String(calls[0]?.init.body)) as { identifiers: string[]; client: string };
    expect(body).toEqual({ identifiers: ["rtx-4090", "no-such-part", "old-name", "a/b"], client: "mcp" });

    const sc = result.structuredContent as { results: { identifier: string; found: boolean; merged: boolean; product?: { buy_url: string }; error?: { reason: string } }[] };
    expect(sc.results.map((r) => [r.identifier, r.found, r.merged])).toEqual([
      ["rtx-4090", true, false],
      ["no-such-part", false, false],
      ["old-name", true, true],
      ["a/b", false, false],
    ]);
    expect(sc.results[0]?.product?.buy_url).toBe(product("rtx-4090").buy_url);
    expect(sc.results[1]?.error?.reason).toBe("PRODUCT_NOT_FOUND");

    const text = textOf(result);
    expect(text.indexOf("`rtx-4090`")).toBeLessThan(text.indexOf("`no-such-part`"));
    expect(text).toContain("`no-such-part`: not found");
    expect(text).toContain("`old-name` (merged into the Product below");
    expect(text).toContain("not a valid identifier");
    expect(text).toContain("\n   - **Product survivor**");
    expect(text).toContain("model number SURVIVOR");
    expect(text).toContain("Specs: vram 24 GB, ray_tracing yes, chipset RTX 4090");
    expect(text).toContain(`buy_url: ${survivor.buy_url}`);
  });

  it("rejects an empty batch and more than 50 identifiers before calling the API", async () => {
    const { client, calls } = await setup(() => json({}));
    const empty = await client.callTool({ name: "get_products", arguments: { identifiers: [] } });
    const many = await client.callTool({ name: "get_products", arguments: { identifiers: Array.from({ length: 51 }, (_, i) => `p${i}`) } });
    expect(empty.isError).toBe(true);
    expect(many.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("get_daily_lows", () => {
  const points = [
    { date: "2026-09-08", price: { amount: "2100.00", currency: "AUD" }, is_carried_forward: true },
    { date: "2026-09-12", price: { amount: "1950.00", currency: "AUD" }, is_carried_forward: false },
    { date: "2026-09-20", price: { amount: "2050.00", currency: "AUD" }, is_carried_forward: false },
  ];

  it("returns the series with a summary and structuredContent", async () => {
    const { client, calls } = await setup(() => json({ points }));
    const result = await client.callTool({ name: "get_daily_lows", arguments: { identifier: "rtx-4090" } });
    expect(result.isError).toBeFalsy();
    expect(calls[0]?.url.pathname).toBe("/v1/products/rtx-4090/daily-lows");
    const text = textOf(result);
    // The carried-forward 2026-09-08 point is outside the window: it must not be the highest, and is not listed as a day in it.
    expect(text).toContain("Lowest 1950.00 on 2026-09-12, highest 2050.00 on 2026-09-20, latest 2050.00 on 2026-09-20");
    expect(text).not.toContain("on 2026-09-08");
    expect(text).not.toContain("- 2026-09-08");
    expect(text).toContain("Before the window: 2100.00, the price in force when it opened (carried forward from 2026-09-08)");
    expect(text).toContain("in stock or not");
    const sc = result.structuredContent as { points: { date: string; price: { amount: string } }[] };
    expect(sc.points.map((p) => p.date)).toEqual(["2026-09-08", "2026-09-12", "2026-09-20"]);
    expect(sc.points[1]?.price.amount).toBe("1950.00");
  });

  it("handles a series with only a carried-forward point", async () => {
    const { client } = await setup(() => json({ points: [points[0]] }));
    const text = textOf(await client.callTool({ name: "get_daily_lows", arguments: { identifier: "q" } }));
    expect(text).toContain("No price was observed inside the window.");
    expect(text).toContain("carried forward from 2026-09-08");
    expect(text).not.toContain("Lowest");
  });

  it("explains a withheld series", async () => {
    const { client } = await setup(
      () => json({ points: [], withheld_reason: "MIXED_CURRENCY" }),
      () => json({ points: [], withheld_reason: "NO_DATA" }),
    );
    const mixed = await client.callTool({ name: "get_daily_lows", arguments: { identifier: "a" } });
    expect(textOf(mixed)).toContain("more than one currency");
    expect((mixed.structuredContent as { withheld_reason: string }).withheld_reason).toBe("MIXED_CURRENCY");
    const none = await client.callTool({ name: "get_daily_lows", arguments: { identifier: "b" } });
    expect(textOf(none)).toContain("no price history");
  });
});

describe("error mapping", () => {
  async function failWith(status: number, reason: string, metadata?: Record<string, string>, headers?: Record<string, string>) {
    const { client } = await setup(() => json(errorBody(status, "raw api message", reason, metadata), { status, ...(headers ? { headers } : {}) }));
    const result = await client.callTool({ name: "get_daily_lows", arguments: { identifier: "x" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    return textOf(result);
  }

  it("points a missing Product at search_products", async () => {
    const text = await failWith(404, "PRODUCT_NOT_FOUND");
    expect(text).toContain("search_products");
    expect(text).not.toContain("raw api message");
  });

  it("includes the retry-after time for RATE_LIMITED", async () => {
    expect(await failWith(429, "RATE_LIMITED", { retry_after_seconds: "17" })).toContain("Wait 17 seconds");
    expect(await failWith(429, "RATE_LIMITED", undefined, { "retry-after": "1" })).toContain("Wait 1 second ");
  });

  it("falls back to a generic wait when no retry-after is known", async () => {
    expect(await failWith(429, "RATE_LIMITED")).toContain("Wait a minute");
  });

  it("maps server trouble, unknown reasons and invalid input", async () => {
    expect(await failWith(503, "UNAVAILABLE")).toContain("having trouble");
    expect(await failWith(500, "SOMETHING_NEW")).toContain("having trouble");
    expect(await failWith(400, "SOMETHING_NEW")).toContain("SOMETHING_NEW");
    expect(await failWith(400, "INVALID_IDENTIFIER")).toContain("model_slug");
  });

  it("does not call an unrelated TypeError a network error", async () => {
    const { client } = await setup(() => {
      throw new TypeError("x is not a function");
    });
    const r = await client.callTool({ name: "search_products", arguments: { query: "x" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).not.toContain("network");
    expect(textOf(r)).toContain("unexpected");
  });

  it("maps a connection that drops while the body is read to the network message", async () => {
    const { client } = await setup(() => {
      const body = new ReadableStream({
        pull() {
          throw new TypeError("terminated", { cause: new Error("other side closed") });
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const r = await client.callTool({ name: "search_products", arguments: { query: "x" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Could not reach the DropHawk API");
  });

  it("maps an abort to the cancelled message", async () => {
    const { client } = await setup(() => {
      throw new DOMException("This operation was aborted", "AbortError");
    });
    const r = await client.callTool({ name: "search_products", arguments: { query: "x" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("cancelled");
  });

  it("treats an API reply the SDK cannot read as service trouble", async () => {
    const { client } = await setup(() => new Response("<html>bad gateway</html>", { status: 200 }));
    const r = await client.callTool({ name: "search_products", arguments: { query: "x" } });
    expect(textOf(r)).toContain("having trouble");
  });

  it("maps a network failure and an unparseable body without crashing", async () => {
    const down = await setup(() => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    });
    const r1 = await down.client.callTool({ name: "search_products", arguments: { query: "x" } });
    expect(r1.isError).toBe(true);
    expect(textOf(r1)).toContain("Could not reach the DropHawk API");
    await down.close();

    const bad = await setup(() => new Response("<html>bad gateway</html>", { status: 200 }));
    const r2 = await bad.client.callTool({ name: "search_products", arguments: { query: "x" } });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).not.toContain("<html>");

    // The server is still alive after both.
    const again = await bad.client.listTools();
    expect(again.tools).toHaveLength(3);
  });
});

describe("a Product without buy_url", () => {
  it("omits it, says so beside url, and warns on stderr", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = product("no-link");
    delete (p as { buy_url?: string }).buy_url;
    const { client } = await setup(() => json({ products: [p], next_page_token: "" }));
    const result = await client.callTool({ name: "search_products", arguments: { query: "x" } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("buy_url: unavailable, use url");
    const sc = result.structuredContent as { products: Record<string, unknown>[] };
    expect("buy_url" in (sc.products[0] ?? {})).toBe(false);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("no buy_url for no-link"));
    stderr.mockRestore();
  });
});
