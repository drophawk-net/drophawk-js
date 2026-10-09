import { canSetUserAgent } from "./runtime.js";
import { DropHawkError } from "./errors.js";
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
   * @internal For DropHawk's own MCP server, so the `buy_url` it hands out is attributed to that surface.
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
  readonly #fetch: typeof fetch;
  readonly #userAgent: string | undefined;
  readonly #client: "mcp" | undefined;

  constructor(options: DropHawkOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
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
   * The response does not name the Product; to learn its canonical `model_slug` call {@link DropHawk.getProduct}.
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
    const init: RequestInit = { method, headers, redirect: "follow" };
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.json);
    }
    if (opts.signal) init.signal = opts.signal;

    const response = await this.#fetch(url.toString(), init);
    if (!response.ok) throw await DropHawkError.fromResponse(response);
    // Reading the body may fail for reasons that are not ours to hide (an abort, a dropped connection): let those through.
    // Only a body that is not valid JSON is reported as INVALID_RESPONSE.
    const text = await response.text();
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
