import { DropHawk, DropHawkError, type DropHawkOptions } from "@drophawk/sdk";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { describeError, toolError } from "./errors.js";
import {
  batchMarkdown,
  brandsMarkdown,
  componentTypesMarkdown,
  dailyLowsMarkdown,
  searchMarkdown,
  toBatchOutput,
  toDailyLowsOutput,
  toProductOutput,
} from "./format.js";
import { utf8Text } from "./input.js";
import { batchOutputSchema, dailyLowsOutputSchema, searchOutputSchema, type ProductOutput } from "./output.js";
import { DAILY_LOWS_DESCRIPTION, GET_PRODUCTS_DESCRIPTION, INSTRUCTIONS, SEARCH_DESCRIPTION } from "./copy.js";
import { VERSION } from "./version.js";

/** The slice of the SDK the server uses, so tests can inject a stub. */
// Every call passes the MCP request's cancellation signal (`ctx.mcpReq.signal`) to the SDK, so a cancelled
// request aborts its fetch instead of spending rate limit on an answer nobody will read.
export type Catalogue = Pick<DropHawk, "searchProducts" | "getProducts" | "getDailyLows" | "listComponentTypes" | "listBrands">;

export interface CreateServerOptions {
  /** The SDK client to use. Defaults to one built from `baseUrl` and `fetch`, attributing best_price_url Clicks to MCP. */
  catalogue?: Catalogue;
  /** The API origin, for testing. Defaults to https://api.drophawk.net. */
  baseUrl?: string | undefined;
  /** A fetch implementation, for testing. */
  fetch?: typeof fetch;
}

export const COMPONENT_TYPES_URI = "drophawk://component-types";
export const BRANDS_URI = "drophawk://brands";

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

/** Builds the DropHawk MCP server. Nothing is connected until the caller attaches a transport. */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const catalogue: Catalogue =
    options.catalogue ??
    // `client` is @internal in the SDK and stripped from its .d.ts, so it is passed with a cast.
    // It makes the API attribute every best_price_url Click to this MCP surface (src=mcp).
    new DropHawk({
      client: "mcp",
      userAgent: `drophawk-mcp/${VERSION}`,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    } as DropHawkOptions);

  const server = new McpServer({ name: "drophawk", title: "DropHawk", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "search_products",
    {
      title: "Search PC component prices",
      description: SEARCH_DESCRIPTION,
      inputSchema: z.object({
        query: utf8Text(256, z.string().trim()).describe('What to search for, such as "rtx 4090" or a model number. At most 256 UTF-8 bytes.'),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT).describe(`How many Products to return, 1 to ${MAX_SEARCH_LIMIT}. Defaults to ${DEFAULT_SEARCH_LIMIT}.`),
      }),
      outputSchema: searchOutputSchema,
      annotations: { title: "Search PC component prices", ...READ_ONLY },
    },
    async ({ query, limit }, ctx) => {
      try {
        const page = await catalogue.searchProducts({ query, page_size: limit }, { signal: ctx.mcpReq.signal });
        // Hold the caller's limit even if the API returns more.
        const products = page.products
          .slice(0, limit)
          .map(toProductOutput)
          .filter((p): p is ProductOutput => p !== undefined);
        const hasMore = page.next_page_token !== "" || page.products.length > limit;
        return answer(searchOutputSchema, { query, products, has_more: hasMore }, () => searchMarkdown(query, products, hasMore));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_products",
    {
      title: "Get PC components by identifier",
      description: GET_PRODUCTS_DESCRIPTION,
      inputSchema: z.object({
        identifiers: z
          .array(utf8Text(256, z.string()))
          .min(1)
          .max(50)
          .describe("Product model_slugs or raw model numbers, 1 to 50, each at most 256 UTF-8 bytes. Duplicates are allowed and answered in place."),
      }),
      outputSchema: batchOutputSchema,
      annotations: { title: "Get PC components by identifier", ...READ_ONLY },
    },
    async ({ identifiers }, ctx) => {
      try {
        const out = toBatchOutput(await catalogue.getProducts(identifiers, { signal: ctx.mcpReq.signal }), identifiers);
        return answer(batchOutputSchema, out, () => batchMarkdown(out));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_daily_lows",
    {
      title: "Get a PC component's 14-day price lows",
      description: DAILY_LOWS_DESCRIPTION,
      inputSchema: z.object({
        identifier: utf8Text(256, z.string()).describe("The Product's model_slug or raw model number. At most 256 UTF-8 bytes."),
      }),
      outputSchema: dailyLowsOutputSchema,
      annotations: { title: "Get a PC component's 14-day price lows", ...READ_ONLY },
    },
    async ({ identifier }, ctx) => {
      try {
        const out = toDailyLowsOutput(identifier, await catalogue.getDailyLows(identifier, { signal: ctx.mcpReq.signal }));
        return answer(dailyLowsOutputSchema, out, () => dailyLowsMarkdown(out));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerResource(
    "component-types",
    COMPONENT_TYPES_URI,
    {
      title: "ComponentTypes",
      description: "Every class of product DropHawk lists (graphics cards, CPUs, ...), with the Specs its Products carry. Read it to learn what DropHawk covers before searching.",
      mimeType: "text/markdown",
    },
    async (uri, ctx) => {
      try {
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: componentTypesMarkdown((await catalogue.listComponentTypes({ signal: ctx.mcpReq.signal })).component_types) }] };
      } catch (err) {
        throw new Error(describeError(err));
      }
    },
  );

  server.registerResource(
    "brands",
    BRANDS_URI,
    {
      title: "Brands",
      description: "Every maker with at least one Product in DropHawk, with how many. Read it to spell a brand the way DropHawk does before searching.",
      mimeType: "text/markdown",
    },
    async (uri, ctx) => {
      try {
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: brandsMarkdown((await catalogue.listBrands({ signal: ctx.mcpReq.signal })).brands) }] };
      } catch (err) {
        throw new Error(describeError(err));
      }
    },
  );

  return server;
}

/**
 * A tool result, checked against its output schema here first. The MCP SDK would otherwise reject a non-conforming result
 * with an error that names the offending field, outside the untrusted data block; API data must never be able to cause that.
 */
function answer<T extends Record<string, unknown>>(schema: z.ZodType<T>, structured: T, text: () => string) {
  if (!schema.safeParse(structured).success) {
    console.error("drophawk-mcp: an answer built from API data did not match its output schema; it is not returned");
    return toolError(new DropHawkError({ status: 200, reason: "INVALID_RESPONSE", message: "output schema mismatch" }));
  }
  return { content: [{ type: "text" as const, text: text() }], structuredContent: structured };
}
