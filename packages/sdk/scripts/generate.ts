import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { GENERATED_PATH, generateTypes } from "./openapi.ts";

const check = process.argv.includes("--check");
const next = await generateTypes();
const current = existsSync(GENERATED_PATH) ? readFileSync(GENERATED_PATH, "utf8") : "";

if (check) {
  if (current !== next) {
    console.error("src/generated/api.ts is stale. Run `bun run generate` in packages/sdk and commit the result.");
    process.exit(1);
  }
  console.log("src/generated/api.ts is up to date.");
} else {
  mkdirSync(dirname(GENERATED_PATH), { recursive: true });
  writeFileSync(GENERATED_PATH, next);
  console.log("wrote src/generated/api.ts");
}
