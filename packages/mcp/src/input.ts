import type * as z from "zod/v4";

const encoder = new TextEncoder();

/**
 * A non-empty string of at most `maxBytes` UTF-8 bytes, which is how the API measures its limits.
 * zod's `.max()` counts UTF-16 code units, so 100 CJK characters (300 bytes) would pass it and then fail at the API.
 * JSON Schema's `maxLength` cannot express bytes either, so callers say "UTF-8 bytes" in the description.
 */
export function utf8Text(maxBytes: number, base: z.ZodString) {
  return base
    .min(1)
    .refine((s) => encoder.encode(s).length <= maxBytes, { message: `Too long: at most ${maxBytes} UTF-8 bytes (a non-ASCII character takes 2 to 4 bytes).` });
}
