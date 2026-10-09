import { readFileSync, writeFileSync } from "node:fs";

/** Copies package.json's version into src/version.ts after `changeset version`. */
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const file = new URL("../src/version.ts", import.meta.url);
const next = readFileSync(file, "utf8").replace(/VERSION = ".*"/, `VERSION = "${pkg.version}"`);
writeFileSync(file, next);
console.log(`src/version.ts -> ${pkg.version}`);
