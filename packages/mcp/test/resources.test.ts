import { afterEach, describe, expect, it } from "vitest";
import { connect, errorBody, json, mockFetch } from "./helpers.js";

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

describe("resources", () => {
  it("lists the two resources", async () => {
    const { client } = await setup(() => json({}));
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["drophawk://brands", "drophawk://component-types"]);
  });

  it("reads ComponentTypes with their Spec schema", async () => {
    const { client, calls } = await setup(() =>
      json({
        component_types: [
          { slug: "gpu", name: "Graphics Cards", product_count: 120, spec_schema: [{ key: "vram", label: "VRAM", type: "number", unit: "GB" }, { key: "ray_tracing", label: "Ray tracing", type: "boolean" }] },
        ],
      }),
    );
    const { contents } = await client.readResource({ uri: "drophawk://component-types" });
    expect(calls[0]?.url.pathname).toBe("/v1/component-types");
    const first = contents[0] as { text: string; mimeType: string };
    expect(first.mimeType).toBe("text/markdown");
    expect(first.text).toContain("**Graphics Cards** (`gpu`), 120 Products");
    expect(first.text).toContain("vram (VRAM, number, GB); ray_tracing (Ray tracing, boolean)");
  });

  it("reads Brands", async () => {
    const { client } = await setup(() => json({ brands: [{ slug: "asus", name: "ASUS", product_count: 45 }] }));
    const { contents } = await client.readResource({ uri: "drophawk://brands" });
    expect((contents[0] as { text: string }).text).toContain("- ASUS (`asus`), 45 Products");
  });

  it("fails a read with a helpful message, not a crash", async () => {
    const { client } = await setup(() => json(errorBody(429, "x", "RATE_LIMITED", { retry_after_seconds: "5" }), { status: 429 }));
    await expect(client.readResource({ uri: "drophawk://brands" })).rejects.toThrow(/Wait 5 seconds/);
    expect((await client.listResources()).resources).toHaveLength(2);
  });
});
