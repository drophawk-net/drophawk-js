import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_PATH, generateTypes } from "../scripts/openapi.ts";

describe("generated types", () => {
  it("match the checked-in OpenAPI document (run `bun run generate` if this fails)", async () => {
    expect(readFileSync(GENERATED_PATH, "utf8")).toBe(await generateTypes());
  });
});
