import type { components, operations } from "./generated/api.js";

type Schemas = components["schemas"];

/**
 * A Product at the manufacturer-SKU level, with its current pricing.
 * `model_slug` is the canonical identifier to store; `best_price_url` is the only way to send a buyer onward and must be used exactly as given.
 */
export type Product = Omit<Schemas["Product"], "specs"> & {
  /** Structured attributes keyed by the Spec keys of the Product's ComponentType. A missing key means the value is unknown. */
  specs: { [key: string]: SpecValue };
};
export type ProductPricing = Schemas["ProductPricing"];
export type ProductImage = Schemas["ProductImage"];
/**
 * One structured attribute: exactly one of `string_value`, `number_value` or `bool_value`, matching the type its ComponentType declares, and an optional `unit`.
 * Narrow on whichever field is present.
 */
export type SpecValue = (
  | { string_value: string; number_value?: never; bool_value?: never }
  | { number_value: number; string_value?: never; bool_value?: never }
  | { bool_value: boolean; string_value?: never; number_value?: never }
) &
  {
    /** The unit the value is measured in, for example "GB" or "W". Absent when the attribute has no unit. */
    unit?: string;
  };
export type BrandRef = Schemas["BrandRef"];
export type ComponentTypeRef = Schemas["ComponentTypeRef"];
/** The Retailer offering a BestPrice as of its `observed_at`: the only Retailer the API ever names. */
export type RetailerRef = Schemas["RetailerRef"];
/** A Product's lowest current in-stock price, when it was observed and the Retailer offering it. */
export type BestPrice = Schemas["BestPrice"];
/**
 * An amount in one currency.
 * `amount` is a non-negative decimal string with any number of decimal places (usually the currency's minor units, never rounded), so parse it with a decimal type and never reject it for its decimals.
 */
export type Money = Schemas["Money"];
export type DatedPrice = Schemas["DatedPrice"];
export type DailyLow = Schemas["DailyLow"];
/** A Brand that has at least one Product. */
export type Brand = Schemas["Brand"];
/** A class of product, with the schema of the Specs its Products can carry. */
export type ComponentType = Schemas["ComponentType"];
export type SpecField = Schemas["SpecField"];
/** Why one identifier of a batch has no Product. `reason` is an open vocabulary. */
export type ProductResultError = Schemas["ProductResultError"];

/** The raw shape of one batch answer, before the either-or between `product` and `error` is applied. */
type ProductResultFields = Schemas["ProductResult"];

/**
 * The answer for one identifier of {@link DropHawk.getProducts}: a Product or an error, never both.
 * Check `result.error` to narrow.
 * When `is_merged` is true the identifier named a Product that was merged into another and `product` is the survivor, so store `product.model_slug`.
 */
export type ProductResult = Omit<ProductResultFields, "product" | "error"> &
  (
    | { product: Product; error?: undefined }
    | { product?: undefined; error: ProductResultError }
  );

/** One page of search results; pass `next_page_token` as `page_token` for the next page (empty on the last page). */
export type SearchPage = Omit<Schemas["SearchProductsResponse"], "products"> & {
  /** The matching Products, best match first. Empty when nothing matches. */
  products: Product[];
};

/** A Product's daily lows over the last 14 days; `points` is empty when `withheld_reason` is set. `model_slug` names the Product and `window_start` is the window's first UTC date. */
export type DailyLows = Schemas["GetProductDailyLowsResponse"];

/** The ComponentTypes, ordered by name. */
export type ListComponentTypesResponse = Schemas["ListComponentTypesResponse"];

/** The Brands that have Products, ordered by name. */
export type ListBrandsResponse = Schemas["ListBrandsResponse"];

type SearchQuery = NonNullable<operations["searchProducts"]["parameters"]["query"]>;

/** Search parameters. Names after `query` match the wire. */
export type SearchParams = Omit<SearchQuery, "q" | "client"> & {
  /** The text to search for, such as "rtx 4090". Not blank, at most 256 bytes. */
  query: string;
};
