import { DropHawkError } from "@drophawk/sdk";

/** What a tool returns when it fails: text for the model and `isError`, never a thrown exception. */
export interface ToolError {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: true;
}

/**
 * Explains a failed API call to the model: what happened, and what to do about it.
 * Never includes raw API messages or stack traces, and never throws.
 */
export function describeError(err: unknown): string {
  if (err instanceof DropHawkError) return describeApiError(err);
  if (err instanceof Error && err.name === "AbortError") return "The request to DropHawk was cancelled.";
  if (isNetworkError(err)) {
    return "Could not reach the DropHawk API (a network error). Prices cannot be looked up right now; try again shortly.";
  }
  return "Something unexpected went wrong while asking DropHawk. Try again shortly.";
}

/**
 * fetch reports a network failure as `TypeError: fetch failed` with the system error as `cause`.
 * Any other TypeError is a bug in this server, not a network problem, and is not described as one.
 */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && (err.cause !== undefined || /^(fetch failed|network|failed to fetch|terminated)/i.test(err.message));
}

function describeApiError(err: DropHawkError): string {
  switch (err.reason) {
    case "PRODUCT_NOT_FOUND":
      return "DropHawk has no Product with that identifier. Use search_products to find the Product's model_slug, and note that DropHawk only covers PC components sold by Australian retailers.";
    case "INVALID_IDENTIFIER":
      return "That identifier is not valid. Use a Product's model_slug (such as deco-x1500-1-pack) or its model number, at most 256 bytes. A model number containing a slash cannot be used; use its model_slug from search_products.";
    case "INVALID_QUERY":
      return "The search text is not valid. Give a non-blank query of at most 256 bytes, such as a model name or number.";
    case "INVALID_PAGE_SIZE":
      return "The limit is not valid. Use a whole number from 1 to 50.";
    case "INVALID_PAGE_TOKEN":
      return "The page token is not valid. Search again from the first page.";
    case "EMPTY_BATCH":
      return "No identifiers were given. Pass at least one model_slug or model number.";
    case "BATCH_TOO_LARGE": {
      const max = err.metadata["max_identifiers"] ?? "50";
      return `Too many identifiers in one call. Send at most ${max} and split the rest into further calls.`;
    }
    case "REQUEST_TOO_LARGE":
      return "The request was too large. Send fewer identifiers or shorter text.";
    case "RATE_LIMITED": {
      const seconds = err.retryAfterSeconds === undefined ? undefined : Math.max(1, Math.ceil(err.retryAfterSeconds));
      const when = seconds === undefined ? "a minute" : `${seconds} second${seconds === 1 ? "" : "s"}`;
      return `DropHawk is rate limiting requests from this machine. Wait ${when} before trying again, and prefer get_products for several Products at once because a batch counts as one request.`;
    }
    case "UNAVAILABLE":
    case "INTERNAL":
    case "INVALID_RESPONSE":
      return "The DropHawk API is having trouble right now. Try again shortly.";
    default:
      return err.status >= 500
        ? "The DropHawk API is having trouble right now. Try again shortly."
        : `DropHawk could not answer that request (${err.reason}). Check the input and try again.`;
  }
}

export function toolError(err: unknown): ToolError {
  return { content: [{ type: "text", text: describeError(err) }], isError: true };
}

/** Explains why one identifier of a batch has no Product. */
export function describeItemError(reason: string): string {
  switch (reason) {
    case "PRODUCT_NOT_FOUND":
      return "not found (DropHawk has no Product with this identifier; try search_products)";
    case "INVALID_IDENTIFIER":
      return "not a valid identifier (use a model_slug or model number of at most 256 bytes; a model number containing a slash must be given as its model_slug)";
    default:
      return `could not be looked up (${reason})`;
  }
}
