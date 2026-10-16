import { expect, it } from "vitest";
import type { BestPrice, ProductResult, RetailerRef } from "../src/index.ts";

it("ProductResult narrows on error", () => {
  const r = { identifier: "a", is_merged: false, error: { reason: "PRODUCT_NOT_FOUND" } } as ProductResult;
  if (r.error) expect(r.error.reason).toBe("PRODUCT_NOT_FOUND");
  else expect(r.product.model_slug).toBeDefined();
});

it("BestPrice names its Retailer as a required { slug, name }", () => {
  const retailer: RetailerRef = { slug: "pccasegear", name: "PC Case Gear" };
  const best: BestPrice = { price: { amount: "849.00", currency: "AUD" }, observed_at: "2026-10-16T01:00:00Z", retailer };
  const name: string = best.retailer.name;
  expect(name).toBe("PC Case Gear");
  // @ts-expect-error the Retailer is required inside a BestPrice
  const missing: BestPrice = { price: best.price, observed_at: best.observed_at };
  expect(missing).toBeDefined();
});
