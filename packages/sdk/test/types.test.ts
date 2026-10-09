import { expect, it } from "vitest";
import type { ProductResult } from "../src/index.ts";

it("ProductResult narrows on error", () => {
  const r = { identifier: "a", merged: false, error: { reason: "PRODUCT_NOT_FOUND" } } as ProductResult;
  if (r.error) expect(r.error.reason).toBe("PRODUCT_NOT_FOUND");
  else expect(r.product.model_slug).toBeDefined();
});
