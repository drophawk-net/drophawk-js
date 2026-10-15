import * as z from "zod/v4";

/** An amount in one currency; `amount` is a decimal string, copied from the API untouched. */
export const moneySchema = z.object({
  amount: z.string().describe('Decimal string, for example "1299.00". Do not parse it as a float.'),
  currency: z.string().describe('ISO 4217 code, for example "AUD".'),
});

const specValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  unit: z.string().optional(),
});

/** One Product as the tools return it in `structuredContent`. */
export const productSchema = z.object({
  model_slug: z.string().describe("The Product's identifier. Pass it to get_products or get_daily_lows."),
  name: z.string(),
  model_number: z.string(),
  brand: z.object({ slug: z.string(), name: z.string() }),
  component_type: z.object({ slug: z.string(), name: z.string() }),
  url: z.string().describe("The Product's page on drophawk.net, with the full price comparison and history. For someone still comparing."),
  buy_url: z
    .string()
    .optional()
    .describe(
      "A DropHawk link that resolves to the best price when followed. For someone ready to buy. Give it out exactly as given and never fetch it. Opens only the Product page while best_price is withheld. Absent only if the API ever omits it: give url then.",
    ),
  best_price: moneySchema.optional().describe("Lowest in-stock price last observed. Absent when withheld; see best_price_withheld_reason."),
  best_price_observed_at: z.string().optional().describe("RFC 3339 time best_price was last observed."),
  best_price_withheld_reason: z.string().optional().describe("OUT_OF_STOCK, NO_DATA or MIXED_CURRENCY. More may be added."),
  in_stock_count: z.number().int().min(0).optional().describe("How many retailers last showed the Product in stock. Absent only if the API sent an invalid count."),
  all_time_low: moneySchema.extend({ date: z.string() }).optional().describe("The lowest daily price ever recorded, in stock or not, and the first day it was recorded at that price."),
  all_time_low_withheld_reason: z.string().optional().describe("NO_DATA or MIXED_CURRENCY. More may be added."),
  specs: z.record(z.string(), specValueSchema).describe("Specs keyed by the ComponentType's Spec keys. A missing key means the value is unknown."),
  image_url: z.string().optional().describe("The primary image, when DropHawk has one."),
});
export type ProductOutput = z.infer<typeof productSchema>;

export const searchOutputSchema = z.object({
  query: z.string(),
  products: z.array(productSchema).describe("Best match first."),
  has_more: z.boolean().describe("True when more Products matched than are listed here. Narrow the query to reach them."),
});
export type SearchOutput = z.infer<typeof searchOutputSchema>;

export const batchOutputSchema = z.object({
  results: z
    .array(
      z.object({
        identifier: z.string().describe("The identifier exactly as it was asked for."),
        found: z.boolean(),
        merged: z.boolean().describe("True when the identifier named a Product that DropHawk merged into another; product is the survivor. Use product.model_slug from now on."),
        product: productSchema.optional(),
        error: z.object({ reason: z.string(), message: z.string() }).optional(),
      }),
    )
    .describe("One entry per identifier, in the order asked."),
});
export type BatchOutput = z.infer<typeof batchOutputSchema>;

export const dailyLowsOutputSchema = z.object({
  identifier: z.string(),
  points: z
    .array(
      z.object({
        date: z.string().describe("UTC calendar day, YYYY-MM-DD."),
        price: moneySchema,
        is_carried_forward: z.boolean().describe("True for the one point before the 30-day window: the price in force when the window opened."),
      }),
    )
    .describe("Oldest first. Empty when withheld."),
  dropped_points: z
    .number()
    .int()
    .optional()
    .describe("How many points the API sent malformed (bad date, amount or currency) and were left out. Absent when none were."),
  withheld_reason: z.string().optional().describe("Why points is empty: NO_DATA or MIXED_CURRENCY. More may be added."),
});
export type DailyLowsOutput = z.infer<typeof dailyLowsOutputSchema>;
