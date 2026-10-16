import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGUE_LIMITS, INSTRUCTIONS } from "../src/copy.js";
import { connect, json, mockFetch } from "./helpers.js";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The limits as the website renders them, synced into spec/catalogue-limits.txt. */
function websiteLimits(): string {
  return readFileSync(new URL("../../../spec/catalogue-limits.txt", import.meta.url), "utf8");
}

describe("catalogue limits", () => {
  it("say exactly what spec/catalogue-limits.txt says", () => {
    expect(squash(CATALOGUE_LIMITS)).toBe(squash(websiteLimits()));
  });
});

describe("server instructions", () => {
  it("reach the client and carry the limits, the link rules and the withheld reasons", async () => {
    const c = await connect(mockFetch(() => json({})).fetch);
    try {
      const instructions = c.client.getInstructions();
      expect(instructions).toBe(INSTRUCTIONS);
      expect(instructions).toContain(CATALOGUE_LIMITS);
      expect(instructions).toContain("Give best_price_url to someone who is ready to buy");
      expect(instructions).toContain("do not guess others");
      for (const reason of ["OUT_OF_STOCK", "NO_DATA", "MIXED_CURRENCY"]) expect(instructions).toContain(reason);
      expect(instructions).not.toContain(String.fromCharCode(0x2014));
    } finally {
      await c.close();
    }
  });
});
