/**
 * Everything the DropHawk API sends is text that retailers ultimately control (names, model numbers, spec values, labels).
 * It ends up in a model's context, so it is treated as untrusted: flattened to one line, length-capped, markdown-escaped
 * where it is rendered, and links are shown only when they point at DropHawk over https.
 */

/** Longest text kept from any single API string, in characters. */
export const MAX_TEXT_LENGTH = 200;
/** Longest URL accepted. Anything longer is shown as unavailable. */
const MAX_URL_LENGTH = 2048;

// Control characters (including CR, LF, tab), line and paragraph separators, and invisible format characters
// such as zero-width spaces and bidi overrides, which can hide or reorder text.
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const MARKDOWN = /[\\`*[\]()<>|~#]/g;

export interface CleanOptions {
  /** Escape markdown-significant characters, for text rendered into markdown. */
  markdown?: boolean;
  /** Override the length cap. */
  max?: number;
}

/** Flattens an untrusted value to one short line of text. Never throws. */
export function cleanText(value: unknown, options: CleanOptions = {}): string {
  if (value === undefined || value === null) return "";
  const raw = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  const flat = raw.replace(CONTROL, " ").replace(/ {2,}/g, " ").trim();
  const max = options.max ?? MAX_TEXT_LENGTH;
  const chars = Array.from(flat);
  const capped = chars.length > max ? `${chars.slice(0, max - 3).join("").trimEnd()}...` : flat;
  return options.markdown ? escapeMarkdown(capped) : capped;
}

// An underscore between letters or digits cannot start emphasis in CommonMark, so identifiers such as ray_tracing stay readable.
function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN, "\\$&").replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_");
}

/** Text for display inside a markdown code span: no backticks, so it cannot close the span. */
export function codeText(value: unknown): string {
  return cleanText(value).replace(/`/g, "'");
}

/**
 * Returns the URL unchanged if it is an https URL on drophawk.net or one of its subdomains, without credentials; otherwise undefined.
 * "Unchanged" matters: buy_url carries a signature and must never be rewritten.
 */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "" || value.length > MAX_URL_LENGTH) return undefined;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
  const host = url.hostname.toLowerCase();
  if (host !== "drophawk.net" && !host.endsWith(".drophawk.net")) return undefined;
  if (url.port !== "") return undefined;
  return value;
}
