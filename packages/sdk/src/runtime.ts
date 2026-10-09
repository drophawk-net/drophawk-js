/**
 * True on server runtimes (Node, Bun, Deno), where a User-Agent header can and should be set.
 * Browsers forbid setting it: Firefox and Safari log or drop it, and it must not be part of a cross-origin request.
 * Anything with a `document`, and any runtime that is none of the above, counts as a browser.
 * @internal
 */
export function canSetUserAgent(g: Record<string, any> = globalThis): boolean {
  if (typeof g["document"] !== "undefined") return false;
  return Boolean(g["process"]?.versions?.node || g["Deno"] || g["Bun"]);
}
