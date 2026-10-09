/**
 * Run by the release job just before publishing; fails it unless every package can be published with a license.
 *
 * - Each package.json under packages/ must have a non-empty `license` field.
 * - The repository root must have a LICENSE file, which is copied into each package directory
 *   (npm packs a LICENSE file in the package directory automatically). The copies are gitignored.
 *
 * The repository owner chooses the license; until a LICENSE exists this fails on purpose, so nothing ships without one.
 * It deliberately does not run on pull requests.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const packages = new URL("packages/", root);
const problems: string[] = [];

const dirs = readdirSync(packages, { withFileTypes: true }).filter((d) => d.isDirectory());
const rootLicense = new URL("LICENSE", root);
if (!existsSync(rootLicense)) problems.push("there is no LICENSE file at the repository root");

for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(new URL(`${dir.name}/package.json`, packages), "utf8")) as { name: string; license?: unknown };
  if (typeof manifest.license !== "string" || manifest.license.trim() === "") problems.push(`${manifest.name} has no "license" field in its package.json`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::cannot publish: ${p}`);
  process.exit(1);
}

for (const dir of dirs) {
  copyFileSync(rootLicense, new URL(`${dir.name}/LICENSE`, packages));
  console.log(`copied LICENSE into packages/${dir.name}`);
}
