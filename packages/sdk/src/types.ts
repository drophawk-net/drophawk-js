import type { components, operations } from "./generated/api.js";

type Schemas = components["schemas"];

/**
 * A Product at the manufacturer-SKU level, with its current pricing.
 * `model_slug` is the canonical identifier to store; `buy_url` is the only way to send a buyer onward and must be used exactly as given.
 */
export type Product = Omit<Schemas["drophawk.developer.v1.Product"], "specs"> & {
  /** Structured attributes keyed by the Spec keys of the Product's ComponentType. A missing key means the value is unknown. */
  specs: { [key: string]: SpecValue };
};
export type ProductPricing = Schemas["drophawk.developer.v1.ProductPricing"];
export type ProductImage = Schemas["drophawk.developer.v1.ProductImage"];
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
export type BrandRef = Schemas["drophawk.developer.v1.BrandRef"];
export type ComponentTypeRef = Schemas["drophawk.developer.v1.ComponentTypeRef"];
/** An amount in one currency; `amount` is a decimal string, parse it with a decimal type. */
export type Money = Schemas["drophawk.developer.v1.Money"];
export type DatedPrice = Schemas["drophawk.developer.v1.DatedPrice"];
export type DailyLow = Schemas["drophawk.developer.v1.DailyLow"];
/** A Brand that has at least one Product. */
export type Brand = Schemas["drophawk.developer.v1.Brand"];
/** A class of product, with the schema of the Specs its Products can carry. */
export type ComponentType = Schemas["drophawk.developer.v1.ComponentType"];
export type SpecField = Schemas["drophawk.developer.v1.SpecField"];
/** Why one identifier of a batch has no Product. `reason` is an open vocabulary. */
export type ProductResultError = Schemas["drophawk.developer.v1.ProductResultError"];

/** The raw shape of one batch answer, before the either-or between `product` and `error` is applied. */
type ProductResultFields = Schemas["drophawk.developer.v1.ProductResult"];

/**
 * The answer for one identifier of {@link DropHawk.getProducts}: a Product or an error, never both.
 * Check `result.error` to narrow.
 * When `merged` is true the identifier named a Product that was merged into another and `product` is the survivor, so store `product.model_slug`.
 */
export type ProductResult = Omit<ProductResultFields, "product" | "error"> &
  (
    | { product: Product; error?: undefined }
    | { product?: undefined; error: ProductResultError }
  );

/** One page of search results; pass `next_page_token` as `page_token` for the next page (empty on the last page). */
export type SearchPage = Omit<Schemas["drophawk.developer.v1.SearchProductsResponse"], "products"> & {
  /** The matching Products, best match first. Empty when nothing matches. */
  products: Product[];
};

/** A Product's daily lows over the last 30 days; `points` is empty when `withheld_reason` is set. */
export type DailyLows = Schemas["drophawk.developer.v1.GetProductDailyLowsResponse"];

/** The ComponentTypes, ordered by name. */
export type ListComponentTypesResponse = Schemas["drophawk.developer.v1.ListComponentTypesResponse"];

/** The Brands that have Products, ordered by name. */
export type ListBrandsResponse = Schemas["drophawk.developer.v1.ListBrandsResponse"];

type SearchQuery = NonNullable<operations["ProductService_SearchProducts"]["parameters"]["query"]>;

/** Search parameters. Names after `query` match the wire. */
export type SearchParams = Omit<SearchQuery, "q" | "client"> & {
  /** The text to search for, such as "rtx 4090". Not blank, at most 256 bytes. */
  query: string;
};
