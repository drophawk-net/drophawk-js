import { describe, expect, it } from "vitest";
import { canSetUserAgent } from "../src/runtime.ts";

describe("canSetUserAgent", () => {
  it("is true on Node, Bun and Deno", () => {
    expect(canSetUserAgent({ process: { versions: { node: "22.0.0" } } })).toBe(true);
    expect(canSetUserAgent({ Bun: {} })).toBe(true);
    expect(canSetUserAgent({ Deno: {} })).toBe(true);
  });
  it("is false in a browser, even a bundler's process shim", () => {
    expect(canSetUserAgent({ document: {} })).toBe(false);
    expect(canSetUserAgent({ document: {}, process: { versions: { node: "22" } } })).toBe(false);
    expect(canSetUserAgent({ process: { env: {} } })).toBe(false);
    expect(canSetUserAgent({})).toBe(false);
  });
});
