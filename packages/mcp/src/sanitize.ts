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

// Link-looking text in free-text fields is defanged so a model reads it as text and never offers it as a link.
// One scheme throughout:
//   - every "://" becomes "[:]//", whatever precedes it        https://evil.example/pay -> https[:]//evil[.]example/pay
//   - every dot in a host name becomes "[.]", both after "://" and in bare domain names (a run of labels ending in an
//     alphabetic or punycode top-level label) and bare IPv4 addresses
//                                                             www.evil.example -> www[.]evil[.]example, 1.2.3.4/x -> 1[.]2[.]3[.]4/x
// Fullwidth and ideographic lookalikes of ".", ":" and "/" count as those characters (and become their ASCII defanged form),
// so https：／／evil。com is caught too. Numbers such as "1.5", "2.5GbE" or "v1.2.3.4" are left alone.
// Real links (url, buy_url, image_url) never pass through here: they are checked by safeUrl and copied verbatim.
//
// Every pattern is linear: SCHEME_SEP is anchored on a literal separator, and the domain patterns can only start where
// the lookbehind allows, at the start of a run, with labels separated by a single dot. cleanText also caps the input before any of this runs.
const DOT = "[.\\uFF0E\\u3002\\uFF61\\u2024\\uFE52]";
const DOTS = new RegExp(DOT, "gu");
const SCHEME_SEP = /[:\uFF1A\uFE55\uFE13][/\uFF0F\u2044\u2215]{2}([^\s/\uFF0F\u2044\u2215?#]*)/gu;
const LABEL = "[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?";
const BARE_DOMAIN = new RegExp(`(?<![\\p{L}\\p{N}-]|${DOT})(?:${LABEL}${DOT})+(?:[xX][nN]--[\\p{L}\\p{N}-]{1,59}|\\p{L}{2,63})(?![\\p{L}\\p{N}-])`, "gu");
const IPV4 = new RegExp(`(?<![\\p{L}\\p{N}]|${DOT})\\d{1,3}(?:${DOT}\\d{1,3}){3}(?![\\p{N}]|${DOT}\\d)`, "gu");

function defang(text: string): string {
  return text
    .replace(SCHEME_SEP, (_, host: string) => `[:]//${host.replace(DOTS, "[.]")}`)
    .replace(BARE_DOMAIN, (domain) => domain.replace(DOTS, "[.]"))
    .replace(IPV4, (ip) => ip.replace(DOTS, "[.]"));
}

/**
 * The longest raw input any pattern above sees, in UTF-16 code units: far more than any field shows (MAX_TEXT_LENGTH),
 * so the cap after defanging still decides what is kept, but small enough that a hostile megabyte costs nothing.
 */
const PRE_CAP = 4096;

export interface CleanOptions {
  /** Escape markdown-significant characters, for text rendered into markdown. */
  markdown?: boolean;
  /** Override the length cap. */
  max?: number;
}

/** Flattens an untrusted value to one short line of text with link-looking text defanged. Never throws. */
export function cleanText(value: unknown, options: CleanOptions = {}): string {
  if (value === undefined || value === null) return "";
  const raw = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  const max = options.max ?? MAX_TEXT_LENGTH;
  const flat = defang(preCap(raw, Math.max(PRE_CAP, max * 4)).replace(CONTROL, " ").replace(/ {2,}/g, " ").trim());
  const chars = Array.from(flat);
  const capped = chars.length > max ? `${chars.slice(0, max - 3).join("").trimEnd()}...` : flat;
  return options.markdown ? escapeMarkdown(capped) : capped;
}

// An underscore between letters or digits cannot start emphasis in CommonMark, so identifiers such as ray_tracing stay readable.
function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN, "\\$&").replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_");
}

function preCap(text: string, units: number): string {
  if (text.length <= units) return text;
  // Do not leave half a surrogate pair at the end.
  const end = /[\uD800-\uDBFF]/.test(text[units - 1]!) ? units - 1 : units;
  return text.slice(0, end);
}

/** Longest identifier the API accepts (model_slug, model number), in UTF-8 bytes. */
export const MAX_IDENTIFIER_BYTES = 256;
const encoder = new TextEncoder();
const ONE_LINE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Returns an identifier (model_slug, model number, Brand or ComponentType slug) exactly as given, or undefined.
 * Identifiers are passed back to the API, so they are never capped, defanged or otherwise rewritten: one that is empty,
 * longer than the API accepts or not a single line of visible text is rejected instead.
 */
export function identifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "" || value.length > MAX_IDENTIFIER_BYTES) return undefined;
  if (ONE_LINE.test(value) || encoder.encode(value).length > MAX_IDENTIFIER_BYTES) return undefined;
  return value;
}

/**
 * Renders text as a markdown code span without changing it: the fence is one backtick longer than the longest run inside,
 * and padded with spaces when CommonMark would otherwise eat or misread the edges. Line breaks and other invisible characters,
 * which only an identifier a caller typed can carry, are shown as U+FFFD so the text cannot start a line of its own.
 */
export function codeSpan(value: string): string {
  const text = value.replace(CONTROL, "\uFFFD");
  if (text === "") return "``";
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ")) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** An API reason or withheld-reason code such as PRODUCT_NOT_FOUND, or undefined for anything else. */
export function reasonCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined;
}

// Characters that never appear in a link DropHawk issues but can break out of markdown or quoted text around it:
// brackets and parentheses (markdown links), angle brackets (autolinks, HTML), quotes and backticks (attributes, code spans),
// and any whitespace or control, format, line or paragraph separator character.
const URL_FORBIDDEN = /[()[\]<>"'`\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Returns the URL unchanged if it is an https URL on drophawk.net or one of its subdomains, without credentials or a port,
 * and already in its exact canonical form; otherwise undefined.
 * "Unchanged" matters: buy_url carries a signature and must never be rewritten. Requiring the canonical form means the URL
 * a client resolves is byte for byte the one checked here: nothing (case, dot segments, a default port, backslashes,
 * non-ASCII) is normalised away between the check and the click.
 */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "" || value.length > MAX_URL_LENGTH) return undefined;
  if (URL_FORBIDDEN.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.href !== value) return undefined;
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return undefined;
  const host = url.hostname;
  if (host !== "drophawk.net" && !host.endsWith(".drophawk.net")) return undefined;
  return value;
}
