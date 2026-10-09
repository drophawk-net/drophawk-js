/** The domain every DropHawk API error carries. */
export const ERROR_DOMAIN = "drophawk.net";

/**
 * Error reasons the API documents for v1, plus `INVALID_RESPONSE`, which the SDK raises itself.
 * The vocabulary is open: more may be added within v1, so {@link DropHawkError.reason} also accepts any string.
 */
export type KnownReason =
  | "PRODUCT_NOT_FOUND"
  | "INVALID_IDENTIFIER"
  | "INVALID_QUERY"
  | "INVALID_PAGE_TOKEN"
  | "INVALID_PAGE_SIZE"
  | "EMPTY_BATCH"
  | "BATCH_TOO_LARGE"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "REQUEST_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

/** A reason: one of the known ones, or any other string. */
export type Reason = KnownReason | (string & {});

/** Reasons worth retrying after a wait. */
const RETRYABLE: ReadonlySet<string> = new Set(["RATE_LIMITED", "UNAVAILABLE", "INTERNAL"]);

/** Used when a response carries no ErrorInfo, such as an error raised by a proxy or by the RPC framework. */
const REASON_BY_STATUS: Record<number, KnownReason> = {
  400: "INVALID_REQUEST",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  413: "REQUEST_TOO_LARGE",
  429: "RATE_LIMITED",
  500: "INTERNAL",
  502: "UNAVAILABLE",
  503: "UNAVAILABLE",
  504: "UNAVAILABLE",
};

const ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";

export interface DropHawkErrorInit {
  status: number;
  reason: Reason;
  message: string;
  domain?: string | undefined;
  metadata?: Record<string, string> | undefined;
  retryAfterSeconds?: number | undefined;
}

/**
 * Thrown for every non-2xx answer from the API, and for answers the SDK cannot use.
 * Branch on `reason`, not on `message`.
 * Network failures and aborted calls are not wrapped: they surface as the runtime's own error (`TypeError`, `AbortError`).
 */
export class DropHawkError extends Error {
  override readonly name = "DropHawkError";
  /** The HTTP status; 400 for an identifier the SDK rejected before sending anything. */
  readonly status: number;
  /**
   * The machine-readable reason, such as "PRODUCT_NOT_FOUND" or "RATE_LIMITED".
   * An open vocabulary: compare against the reasons you handle and fall back on `status` for the rest.
   * When the response carries no ErrorInfo, a reason is derived from the status ("UNKNOWN" if there is none).
   */
  readonly reason: Reason;
  /** The ErrorInfo domain, "drophawk.net" for errors the API raised; undefined when the response carried no ErrorInfo. */
  readonly domain: string | undefined;
  /** The ErrorInfo metadata, such as `max_identifiers` for BATCH_TOO_LARGE. */
  readonly metadata: Readonly<Record<string, string>>;
  /** Seconds to wait before retrying; set for RATE_LIMITED. */
  readonly retryAfterSeconds: number | undefined;
  /** True for reasons that may succeed if the same request is retried later: RATE_LIMITED, UNAVAILABLE and INTERNAL. */
  readonly retryable: boolean;

  constructor(init: DropHawkErrorInit) {
    super(init.message);
    this.status = init.status;
    this.reason = init.reason;
    this.domain = init.domain;
    this.metadata = init.metadata ?? {};
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.retryable = RETRYABLE.has(init.reason);
  }

  /** @internal Builds the error for a failed response. */
  static async fromResponse(response: Response): Promise<DropHawkError> {
    // Reading the body may fail for reasons that are not ours to hide (an abort, a dropped connection): let those through.
    // Only a body that is not valid JSON falls back to an error derived from the status.
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    const info = findErrorInfo(body);
    const status = response.status;
    const metadata = info?.metadata ?? {};
    const retryAfterSeconds = parseSeconds(metadata["retry_after_seconds"]) ?? parseSeconds(response.headers.get("retry-after"));
    const reason = info?.reason ?? REASON_BY_STATUS[status] ?? "UNKNOWN";
    const detail = typeof (body as { message?: unknown } | undefined)?.message === "string" ? (body as { message: string }).message : response.statusText;
    return new DropHawkError({
      status,
      reason,
      domain: info?.domain,
      metadata,
      retryAfterSeconds,
      message: `DropHawk API error ${status} ${reason}${detail ? `: ${detail}` : ""}`,
    });
  }
}

interface ErrorInfo {
  reason: string;
  domain?: string;
  metadata?: Record<string, string>;
}

function findErrorInfo(body: unknown): ErrorInfo | undefined {
  const details = (body as { details?: unknown } | undefined)?.details;
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    if (d && typeof d === "object" && (d as Record<string, unknown>)["@type"] === ERROR_INFO_TYPE) {
      const { reason, domain, metadata } = d as Record<string, unknown>;
      if (typeof reason !== "string") continue;
      return {
        reason,
        ...(typeof domain === "string" ? { domain } : {}),
        ...(metadata && typeof metadata === "object" ? { metadata: metadata as Record<string, string> } : {}),
      };
    }
  }
  return undefined;
}

function parseSeconds(value: string | null | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
