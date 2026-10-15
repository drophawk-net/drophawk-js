import { canSetUserAgent } from "./runtime.js";
import { discard, DropHawkError, readBodyText } from "./errors.js";
import type {
  DailyLows,
  ListBrandsResponse,
  ListComponentTypesResponse,
  Product,
  ProductResult,
  SearchPage,
  SearchParams,
} from "./types.js";
import { VERSION } from "./version.js";

/** The production API origin. */
export const DEFAULT_BASE_URL = "https://api.drophawk.net";

export interface DropHawkOptions {
  /** The API origin. Defaults to https://api.drophawk.net. */
  baseUrl?: string;
  /** A fetch implementation, for tests, proxies or runtimes without a global fetch. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Appended to the User-Agent, such as "my-app/1.2".
   * Applies on Node, Bun and Deno only: browsers do not allow a script to set User-Agent, so the SDK leaves it alone there.
   */
  userAgent?: string;
  /**
   * @internal For DropHawk's own MCP server, so the `best_price_url` it hands out is attributed to that surface.
   *
   * Stripped from the published .d.ts on purpose (`stripInternal`): third-party integrations count as the API surface and must not set it.
   * The MCP package passes it with a cast, which keeps it off the public types without a second entry point:
   *
   *     new DropHawk({ client: "mcp" } as DropHawkOptions)
   */
  client?: "mcp";
}

/** Options accepted by every method. */
export interface CallOptions {
  /** Aborts the request. Rejects with the runtime's `AbortError`. */
  signal?: AbortSignal;
}

/**
 * A client for the DropHawk developer API.
 * Every method rejects with {@link DropHawkError} for a non-2xx answer and never retries.
 */
export class DropHawk {
  readonly #baseUrl: string;
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  readonly #userAgent: string | undefined;
  readonly #client: "mcp" | undefined;

  constructor(options: DropHawkOptions = {}) {
    const base = parseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#baseUrl = base.baseUrl;
    this.#origin = base.origin;
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#userAgent = canSetUserAgent() ? `drophawk-sdk/${VERSION}${options.userAgent ? ` ${options.userAgent}` : ""}` : undefined;
    this.#client = options.client;
  }

  /**
   * Gets one Product by its `model_slug` or its raw model number.
   * A merged Product is followed transparently: the returned Product is the survivor, so store its `model_slug`.
   * @throws {DropHawkError} PRODUCT_NOT_FOUND, INVALID_IDENTIFIER, RATE_LIMITED and the like.
   */
  async getProduct(identifier: string, options: CallOptions = {}): Promise<Product> {
    const query = this.#client ? { client: this.#client } : undefined;
    return this.#request<Product>("GET", `/v1/products/${segment(identifier)}`, { query, signal: options.signal });
  }

  /**
   * Gets up to 50 Products in one call, such as the parts of a basket.
   * Results come back in request order, `results[i]` answering `identifiers[i]`.
   * A per-identifier failure is returned as `result.error`, never thrown; only a problem with the batch itself (EMPTY_BATCH, BATCH_TOO_LARGE, ...) throws.
   */
  async getProducts(identifiers: readonly string[], options: CallOptions = {}): Promise<ProductResult[]> {
    const payload = { identifiers, ...(this.#client ? { client: this.#client } : {}) };
    const body = await this.#request<{ results: ProductResult[] }>("POST", "/v1/products:batchGet", { json: payload, signal: options.signal });
    return body.results;
  }

  /**
   * Searches Products by text and returns one page.
   * Pass the returned `next_page_token` as `page_token` for the next page, or use {@link DropHawk.iterateSearchProducts} to walk them all.
   */
  async searchProducts(params: SearchParams, options: CallOptions = {}): Promise<SearchPage> {
    const query: Record<string, string | number | undefined> = {
      q: params.query,
      page_size: params.page_size,
      page_token: params.page_token || undefined,
      client: this.#client,
    };
    return this.#request<SearchPage>("GET", "/v1/products:search", { query, signal: options.signal });
  }

  /**
   * Iterates every Product matching a search, best match first, fetching pages lazily.
   * Stop early with `break`; no further page is requested.
   * `page_token` in `params` starts iteration from that page.
   * Rejects with INVALID_RESPONSE if the API ever repeats a page token, rather than looping forever.
   * @example
   * for await (const product of dh.iterateSearchProducts({ query: "rtx 4090" })) { ... }
   */
  async *iterateSearchProducts(params: SearchParams, options: CallOptions = {}): AsyncIterableIterator<Product> {
    const seen = new Set<string>();
    let pageToken = params.page_token || undefined;
    do {
      if (pageToken) seen.add(pageToken);
      const page = await this.searchProducts({ ...params, page_token: pageToken }, options);
      yield* page.products;
      pageToken = page.next_page_token || undefined;
      if (pageToken && seen.has(pageToken)) {
        throw new DropHawkError({ status: 200, reason: "INVALID_RESPONSE", message: "DropHawk API repeated a page token; stopping to avoid an endless loop" });
      }
    } while (pageToken);
  }

  /**
   * Gets a Product's daily lows over the last 30 days.
   * A merged Product is followed transparently.
   * The response names the Product it belongs to (`model_slug`, the survivor after a merge) and the first day of the window (`window_start`).
   */
  async getDailyLows(identifier: string, options: CallOptions = {}): Promise<DailyLows> {
    return this.#request<DailyLows>("GET", `/v1/products/${segment(identifier)}/daily-lows`, { signal: options.signal });
  }

  /** Lists every ComponentType with the schema of the Specs its Products can carry, ordered by name. */
  async listComponentTypes(options: CallOptions = {}): Promise<ListComponentTypesResponse> {
    return this.#request<ListComponentTypesResponse>("GET", "/v1/component-types", { signal: options.signal });
  }

  /** Lists every Brand that has at least one Product, ordered by name. */
  async listBrands(options: CallOptions = {}): Promise<ListBrandsResponse> {
    return this.#request<ListBrandsResponse>("GET", "/v1/brands", { signal: options.signal });
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string | number | undefined> | undefined; json?: unknown; signal?: AbortSignal | undefined },
  ): Promise<T> {
    const url = new URL(this.#baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.#userAgent) headers["User-Agent"] = this.#userAgent;
    // GET follows redirects: a merged Product answers 301 to its survivor, and the final URL is checked below. A redirected GET
    // carries no body and no credentials, and a browser cannot follow redirects itself (a manual redirect is opaque there).
    // The batch POST is never redirected by the API, and following a 307 or 308 would resend its body to wherever the redirect
    // points before any check could run, so for POST fetch must not follow at all and any redirect is INVALID_RESPONSE.
    const init: RequestInit = { method, headers, redirect: method === "GET" ? "follow" : "manual", credentials: "omit" };
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.json);
    }
    if (opts.signal) init.signal = opts.signal;

    const response = await this.#fetch(url.toString(), init);
    // Redirects are followed (a merged Product answers 301 to its survivor, on the same origin), but the final URL must still be ours.
    // Anything else is a misconfigured or hostile endpoint, and its answer is not read. An empty url means the fetch implementation does not report one.
    if (response.url && safeOrigin(response.url) !== this.#origin) {
      discard(response.body);
      throw new DropHawkError({ status: response.status, reason: "INVALID_RESPONSE", message: "DropHawk API request was redirected to a different origin; refusing to use the answer" });
    }
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response.body);
      throw new DropHawkError({ status: response.status, reason: "INVALID_RESPONSE", message: `DropHawk API answered a ${method} with a redirect; refusing to follow it` });
    }
    if (!response.ok) throw await DropHawkError.fromResponse(response);
    // Reading the body may fail for reasons that are not ours to hide (an abort, a dropped connection): let those through.
    // Only a body that is not valid JSON, or is too large, is reported as INVALID_RESPONSE.
    const text = await readBodyText(response);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DropHawkError({
        status: response.status,
        reason: "INVALID_RESPONSE",
        message: `DropHawk API returned ${response.status} with a body that is not JSON`,
      });
    }
  }
}

/**
 * Encodes an identifier as one path segment.
 * "/" cannot be carried in a path segment, and "." and ".." are dot-segments that URL parsing resolves away (even as %2E), so none can be sent this way.
 * They are rejected here with the error the API would give an identifier that names no Product.
 */
function segment(identifier: string): string {
  if (typeof identifier !== "string" || identifier === "") {
    throw new TypeError("identifier must be a non-empty string");
  }
  if (identifier.includes("/") || identifier === "." || identifier === "..") {
    throw new DropHawkError({
      status: 400,
      reason: "INVALID_IDENTIFIER",
      message: `Identifier ${JSON.stringify(identifier)} cannot be sent in a URL path (it contains "/" or is a dot segment); use the Product's model_slug instead`,
    });
  }
  return encodeURIComponent(identifier);
}

/**
 * Validates the API origin: http(s) only, no credentials, query or fragment.
 * Trailing slashes are stripped with a linear scan (a regex like /\/+$/ backtracks quadratically on long runs of slashes).
 */
function parseBaseUrl(value: string): { baseUrl: string; origin: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`baseUrl must be an absolute http(s) URL, got ${JSON.stringify(value)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError(`baseUrl must use http or https, got ${url.protocol}`);
  if (url.username !== "" || url.password !== "") throw new TypeError("baseUrl must not contain credentials");
  if (url.search !== "" || url.hash !== "" || value.includes("?") || value.includes("#")) throw new TypeError("baseUrl must not contain a query string or fragment");
  let path = url.pathname;
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
  path = path.slice(0, end);
  return { baseUrl: url.origin + path, origin: url.origin };
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
