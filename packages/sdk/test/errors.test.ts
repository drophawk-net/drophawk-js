import { describe, expect, it } from "vitest";
import { DropHawk, DropHawkError } from "../src/index.ts";
import { errorBody, json, mockFetch } from "./helpers.ts";

async function failWith(res: Response): Promise<DropHawkError> {
  const m = mockFetch(() => res);
  const err = await new DropHawk({ fetch: m.fetch }).listBrands().catch((e) => e);
  expect(err).toBeInstanceOf(DropHawkError);
  return err;
}

describe("DropHawkError", () => {
  it("RATE_LIMITED carries retryAfterSeconds from the metadata", async () => {
    const err = await failWith(json(errorBody(8, "resource_exhausted", "RATE_LIMITED", { retry_after_seconds: "7" }), { status: 429, headers: { "retry-after": "9" } }));
    expect(err).toMatchObject({ status: 429, reason: "RATE_LIMITED", retryAfterSeconds: 7, retryable: true, domain: "drophawk.net", name: "DropHawkError" });
    expect(err.message).toContain("RATE_LIMITED");
  });

  it("falls back to the Retry-After header", async () => {
    const err = await failWith(json(errorBody(8, "resource_exhausted", "RATE_LIMITED"), { status: 429, headers: { "retry-after": "3" } }));
    expect(err.retryAfterSeconds).toBe(3);
  });

  it.each([
    [400, "invalid_argument", "INVALID_PAGE_SIZE", false],
    [404, "not_found", "NOT_FOUND", false],
    [405, "method_not_allowed", "METHOD_NOT_ALLOWED", false],
    [413, "resource_exhausted", "REQUEST_TOO_LARGE", false],
    [500, "internal", "INTERNAL", true],
    [503, "unavailable", "UNAVAILABLE", true],
  ])("status %i with ErrorInfo %s", async (status, message, reason, retryable) => {
    const err = await failWith(json(errorBody(0, message, reason), { status }));
    expect(err).toMatchObject({ status, reason, retryable });
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it("keeps unknown reasons as they are", async () => {
    const err = await failWith(json(errorBody(9, "failed_precondition", "BRAND_NEW_REASON"), { status: 409 }));
    expect(err).toMatchObject({ status: 409, reason: "BRAND_NEW_REASON", retryable: false });
  });

  it("skips detail types it does not know and finds the ErrorInfo", async () => {
    const body = { code: 3, message: "x", details: [{ "@type": "type.googleapis.com/other.Thing", reason: "NOPE" }, ...errorBody(3, "x", "EMPTY_BATCH").details] };
    expect((await failWith(json(body, { status: 400 }))).reason).toBe("EMPTY_BATCH");
  });

  it("matches ErrorInfo by its exact type URL", async () => {
    const body = {
      code: 3,
      message: "x",
      details: [
        { "@type": "example.google.rpc.ErrorInfo", reason: "IMPOSTOR", domain: "evil" },
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo.Other", reason: "IMPOSTOR2" },
        ...errorBody(3, "x", "EMPTY_BATCH").details,
      ],
    };
    expect(await failWith(json(body, { status: 400 }))).toMatchObject({ reason: "EMPTY_BATCH", domain: "drophawk.net" });
  });

  it.each([502, 504])("maps %i without ErrorInfo to retryable UNAVAILABLE", async (status) => {
    expect(await failWith(new Response("gateway", { status }))).toMatchObject({ reason: "UNAVAILABLE", retryable: true });
  });

  it("has retryable as an own enumerable property", async () => {
    const err = await failWith(json(errorBody(8, "x", "RATE_LIMITED"), { status: 429 }));
    expect(Object.keys(err)).toContain("retryable");
    expect({ ...err }).toMatchObject({ retryable: true, reason: "RATE_LIMITED" });
  });

  it("derives a reason from the status when there is no ErrorInfo", async () => {
    const err = await failWith(new Response("<html>bad gateway</html>", { status: 503 }));
    expect(err).toMatchObject({ status: 503, reason: "UNAVAILABLE", domain: undefined, retryable: true });
    const odd = await failWith(new Response("", { status: 418 }));
    expect(odd.reason).toBe("UNKNOWN");
  });

  it("throws INVALID_RESPONSE when a 200 is not JSON", async () => {
    const m = mockFetch(() => new Response("nope", { status: 200 }));
    await expect(new DropHawk({ fetch: m.fetch }).listBrands()).rejects.toMatchObject({ reason: "INVALID_RESPONSE", status: 200 });
  });

  it("lets network failures through untouched", async () => {
    const boom = new TypeError("fetch failed");
    const client = new DropHawk({ fetch: (() => Promise.reject(boom)) as typeof fetch });
    await expect(client.listBrands()).rejects.toBe(boom);
  });

  describe("body read failures", () => {
    const failingBody = (reason: unknown, status: number) => {
      const stream = new ReadableStream({ start: (c) => c.error(reason) });
      return new Response(stream, { status });
    };

    it.each([200, 503])("surface an abort while reading a %i body unchanged", async (status) => {
      const abort = new DOMException("aborted", "AbortError");
      const m = mockFetch(() => failingBody(abort, status));
      await expect(new DropHawk({ fetch: m.fetch }).listBrands()).rejects.toBe(abort);
    });

    it.each([200, 500])("surface a stream error on a %i body unchanged", async (status) => {
      const boom = new TypeError("terminated");
      const m = mockFetch(() => failingBody(boom, status));
      await expect(new DropHawk({ fetch: m.fetch }).listBrands()).rejects.toBe(boom);
    });

    it("still reports invalid JSON on a 2xx as INVALID_RESPONSE and on an error as status-derived", async () => {
      const ok = mockFetch(() => new Response("{not json", { status: 200 }));
      await expect(new DropHawk({ fetch: ok.fetch }).listBrands()).rejects.toMatchObject({ reason: "INVALID_RESPONSE" });
      const bad = mockFetch(() => new Response("{not json", { status: 503 }));
      await expect(new DropHawk({ fetch: bad.fetch }).listBrands()).rejects.toMatchObject({ reason: "UNAVAILABLE", status: 503 });
    });
  });
});
