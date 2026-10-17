/**
 * Run by the release "build" job, which holds no publish credentials.
 *
 * For every package under packages/ whose current version is not released yet, runs `npm pack` into the directory given
 * as the first argument (default `release-tarballs`). The separate "publish" job then publishes exactly those tarballs,
 * so what was built and tested is what ships.
 *
 * Released means on the npm registry and tagged `name@version` in this repository (the checkout must have its tags).
 * A version that is on npm but not tagged is left over from a publish run that failed part way, so it is packed again:
 * the publish job then skips publishing it when npm already has this exact tarball, and tags it.
 *
 * Writes `has-tarballs=true|false` to $GITHUB_OUTPUT when it is set.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(process.argv[2] ?? "release-tarballs");
const packages = new URL("../packages/", import.meta.url);
mkdirSync(out, { recursive: true });

function isPublished(name: string, version: string): boolean {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim() === version;
  // A package or version that does not exist answers E404. Any other failure (network, registry outage) must not look like "unpublished".
  if (/E404|404 Not Found/.test(r.stderr)) return false;
  throw new Error(`could not look up ${name}@${version} on the npm registry:\n${r.stderr}`);
}

function isTagged(name: string, version: string): boolean {
  return spawnSync("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${name}@${version}`], { stdio: "ignore" }).status === 0;
}

let packed = 0;
for (const dir of readdirSync(packages, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const cwd = new URL(`${dir.name}/`, packages);
  const { name, version } = JSON.parse(readFileSync(new URL("package.json", cwd), "utf8")) as { name: string; version: string };
  if (isPublished(name, version)) {
    if (isTagged(name, version)) {
      console.log(`${name}@${version} is already released, skipping`);
      continue;
    }
    console.log(`${name}@${version} is on npm but not tagged; packing it so the publish job can check it and tag it`);
  }
  const r = spawnSync("npm", ["pack", "--pack-destination", out], { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`npm pack failed for ${name}`);
  console.log(`packed ${name}@${version}`);
  packed++;
}

if (process.env["GITHUB_OUTPUT"]) appendFileSync(process.env["GITHUB_OUTPUT"], `has-tarballs=${packed > 0}\n`);
