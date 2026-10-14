import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

function run(env: Record<string, string | undefined>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin], { env: { ...process.env, DROPHAWK_API_BASE_URL: undefined, ...env }, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(stderr));
    setTimeout(() => child.stdin.end(), 500);
  });
}

describe("bin", () => {
  it("warns on stderr when DROPHAWK_API_BASE_URL is set", async () => {
    const stderr = await run({ DROPHAWK_API_BASE_URL: "http://127.0.0.1:9" });
    expect(stderr).toContain("warning: DROPHAWK_API_BASE_URL is set");
    expect(stderr).toContain("http://127.0.0.1:9");
  });

  it("is silent about it when the variable is unset", async () => {
    expect(await run({})).not.toContain("DROPHAWK_API_BASE_URL");
  });
});
