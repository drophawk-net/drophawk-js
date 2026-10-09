import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VERSION } from "../src/index.ts";

it("VERSION matches package.json (run scripts/sync-version.ts after `changeset version`)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(VERSION).toBe(pkg.version);
});
