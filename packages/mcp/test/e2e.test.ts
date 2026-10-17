import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { product } from "./helpers.js";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

describe("built server over stdio", () => {
  let api: Server;
  let baseUrl: string;
  const requests: { method: string; url: URL; userAgent: string | undefined }[] = [];
  let client: Client;

  beforeAll(async () => {
    if (!existsSync(bin)) throw new Error("dist/bin.js is missing: run `bun run build` first");
    api = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      requests.push({ method: req.method ?? "", url, userAgent: req.headers["user-agent"] });
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/v1/products:search") {
        res.end(JSON.stringify({ products: [product("rtx-4090")], next_page_token: "" }));
      } else if (url.pathname === "/v1/brands") {
        res.end(JSON.stringify({ brands: [{ slug: "asus", name: "ASUS", product_count: 45 }] }));
      } else if (url.pathname === "/v1/component-types") {
        res.end(JSON.stringify({ component_types: [] }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

    client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [bin],
        env: { ...process.env as Record<string, string>, DROPHAWK_API_BASE_URL: baseUrl },
        stderr: "inherit",
      }),
    );
  });

  afterAll(async () => {
    await client?.close();
    await new Promise<void>((resolve) => api?.close(() => resolve()) ?? resolve());
  });

  it("lists 3 tools and 2 resources", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_daily_lows", "get_products", "search_products"]);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["drophawk://brands", "drophawk://component-types"]);
  });

  it("calls search_products and gets both content forms, asking the API as client=mcp", async () => {
    const result = await client.callTool({ name: "search_products", arguments: { query: "rtx 4090", limit: 5 } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).toContain("best_price_url: https://go.drophawk.net/p/rtx-4090?src=mcp&rep=json&sig=a%2Bb");
    const sc = result.structuredContent as { products: { model_slug: string; url: string; best_price_url: string }[] };
    expect(sc.products[0]?.model_slug).toBe("rtx-4090");
    expect(sc.products[0]?.best_price_url).toContain("src=mcp");

    const search = requests.find((r) => r.url.pathname === "/v1/products:search");
    expect(search?.url.searchParams.get("client")).toBe("mcp");
    expect(search?.url.searchParams.get("page_size")).toBe("5");
    expect(search?.userAgent).toMatch(/^drophawk-sdk\/\S+ drophawk-mcp\/\S+$/);
  });

  it("reads a resource", async () => {
    const { contents } = await client.readResource({ uri: "drophawk://brands" });
    expect((contents[0] as { text: string }).text).toContain("ASUS");
  });

  it("answers an API error as a tool error and keeps serving", async () => {
    const result = await client.callTool({ name: "get_daily_lows", arguments: { identifier: "nope" } });
    expect(result.isError).toBe(true);
    expect((await client.listTools()).tools).toHaveLength(3);
  });
});
