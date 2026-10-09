import { afterEach, describe, expect, it } from "vitest";
import { connect } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

/** A fetch that never answers on its own: it settles only when its request signal aborts. */
function hangingFetch() {
  const seen: AbortSignal[] = [];
  const fn = ((_input: unknown, init: RequestInit = {}) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (!signal) return; // no signal passed: hangs forever, which fails the test
      seen.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
    })) as typeof fetch;
  return { fetch: fn, seen };
}

async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(condition()).toBe(true);
}

describe("cancellation", () => {
  const calls: [string, () => (c: Awaited<ReturnType<typeof connect>>["client"], signal: AbortSignal) => Promise<unknown>][] = [
    ["search_products", () => (c, signal) => c.callTool({ name: "search_products", arguments: { query: "x" } }, { signal })],
    ["get_products", () => (c, signal) => c.callTool({ name: "get_products", arguments: { identifiers: ["x"] } }, { signal })],
    ["get_daily_lows", () => (c, signal) => c.callTool({ name: "get_daily_lows", arguments: { identifier: "x" } }, { signal })],
    ["drophawk://component-types", () => (c, signal) => c.readResource({ uri: "drophawk://component-types" }, { signal })],
    ["drophawk://brands", () => (c, signal) => c.readResource({ uri: "drophawk://brands" }, { signal })],
  ];

  it.each(calls)("cancelling %s aborts the underlying fetch and the server keeps serving", async (_name, make) => {
    const stub = hangingFetch();
    const c = await connect(stub.fetch);
    close = c.close;

    const controller = new AbortController();
    const pending = make()(c.client, controller.signal);
    pending.catch(() => {});
    await waitFor(() => stub.seen.length === 1);
    expect(stub.seen[0]?.aborted).toBe(false);

    controller.abort();
    await expect(pending).rejects.toThrow();
    await waitFor(() => stub.seen[0]?.aborted === true);

    expect((await c.client.listTools()).tools).toHaveLength(3);
  });
});
