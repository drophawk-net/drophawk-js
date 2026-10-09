/**
 * Replaces `workspace:` dependency ranges in every package.json under packages/ with the real version range, in place.
 *
 * `changeset publish` runs `npm publish`, which uploads `"@drophawk/sdk": "workspace:^"` verbatim and
 * leaves the package uninstallable. The release workflow runs this just before publishing; the rewrite is
 * never committed. Run it locally only in a throwaway checkout.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../packages/", import.meta.url);
const manifests = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => new URL(`${d.name}/package.json`, root));

type Manifest = { name: string; version: string } & Partial<Record<(typeof FIELDS)[number], Record<string, string>>>;
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

const read = (url: URL): Manifest => JSON.parse(readFileSync(url, "utf8")) as Manifest;
const versions = new Map(manifests.map((url) => [read(url).name, read(url).version]));

function resolveRange(range: string, version: string): string {
  const spec = range.slice("workspace:".length);
  if (spec === "^" || spec === "~") return `${spec}${version}`;
  if (spec === "*" || spec === "") return version;
  return spec;
}

for (const url of manifests) {
  const manifest = read(url);
  let changed = false;
  for (const field of FIELDS) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (!range.startsWith("workspace:")) continue;
      const version = versions.get(dep);
      if (!version) throw new Error(`${manifest.name} depends on ${dep} by workspace: but no such package is in packages/`);
      manifest[field]![dep] = resolveRange(range, version);
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(url, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`resolved workspace: ranges in ${manifest.name}`);
  }
}
