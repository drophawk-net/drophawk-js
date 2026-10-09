import type { Brand, ComponentType, DailyLows, Product, ProductResult, SpecValue } from "@drophawk/sdk";
import { describeItemError } from "./errors.js";
import type { BatchOutput, DailyLowsOutput, ProductOutput } from "./output.js";

/** Converts an SDK Product to the shape of `structuredContent`. Links are copied verbatim. */
export function toProductOutput(p: Product): ProductOutput {
  const pricing = p.pricing;
  const specs: ProductOutput["specs"] = {};
  for (const [key, spec] of Object.entries(p.specs ?? {})) {
    const value = specValue(spec);
    if (value === undefined) continue;
    specs[key] = spec.unit ? { value, unit: spec.unit } : { value };
  }
  const image = p.images?.[0]?.url;
  return {
    model_slug: p.model_slug,
    name: p.name,
    model_number: p.model_number,
    brand: { slug: p.brand.slug, name: p.brand.name },
    component_type: { slug: p.component_type.slug, name: p.component_type.name },
    url: p.url,
    ...(buyUrl(p)),
    ...(pricing.best_price ? { best_price: money(pricing.best_price) } : {}),
    ...(pricing.best_price_observed_at ? { best_price_observed_at: pricing.best_price_observed_at } : {}),
    ...(pricing.best_price_withheld_reason ? { best_price_withheld_reason: pricing.best_price_withheld_reason } : {}),
    in_stock_count: pricing.in_stock_count,
    ...(pricing.all_time_low ? { all_time_low: { ...money(pricing.all_time_low.price), date: pricing.all_time_low.date } } : {}),
    ...(pricing.all_time_low_withheld_reason ? { all_time_low_withheld_reason: pricing.all_time_low_withheld_reason } : {}),
    specs,
    ...(image ? { image_url: image } : {}),
  };
}

/** buy_url is passed through verbatim. If the API ever omits it, say so rather than inventing a link. */
function buyUrl(p: Product): { buy_url?: string } {
  if (p.buy_url) return { buy_url: p.buy_url };
  console.error(`drophawk-mcp: the API sent no buy_url for ${p.model_slug}`);
  return {};
}

export function toBatchOutput(results: readonly ProductResult[]): BatchOutput {
  return {
    results: results.map((r) =>
      r.product
        ? { identifier: r.identifier, found: true, merged: r.merged === true, product: toProductOutput(r.product) }
        : { identifier: r.identifier, found: false, merged: false, error: { reason: r.error?.reason ?? "UNKNOWN", message: describeItemError(r.error?.reason ?? "UNKNOWN") } },
    ),
  };
}

export function toDailyLowsOutput(identifier: string, lows: DailyLows): DailyLowsOutput {
  return {
    identifier,
    points: lows.points.map((p) => ({ date: p.date, price: money(p.price), is_carried_forward: p.is_carried_forward })),
    ...(lows.withheld_reason ? { withheld_reason: lows.withheld_reason } : {}),
  };
}

function money(m: { amount: string; currency: string }): { amount: string; currency: string } {
  return { amount: m.amount, currency: m.currency };
}

function specValue(spec: SpecValue): string | number | boolean | undefined {
  if (typeof spec.string_value === "string") return spec.string_value;
  if (typeof spec.number_value === "number") return spec.number_value;
  if (typeof spec.bool_value === "boolean") return spec.bool_value;
  return undefined;
}

const fmt = (m: { amount: string; currency: string }): string => `${m.amount} ${m.currency}`;

function bestPriceLine(p: ProductOutput): string {
  if (p.best_price) {
    const observed = p.best_price_observed_at ? `, last observed ${p.best_price_observed_at}` : "";
    return `Best price: ${fmt(p.best_price)} (in stock at ${p.in_stock_count} ${p.in_stock_count === 1 ? "retailer" : "retailers"}${observed})`;
  }
  switch (p.best_price_withheld_reason) {
    case "OUT_OF_STOCK":
      return "Best price: none, retailers list it but none has it in stock right now";
    case "NO_DATA":
      return "Best price: none, DropHawk has no price for it yet";
    case "MIXED_CURRENCY":
      return "Best price: none, in-stock prices are in more than one currency so no single lowest exists";
    case undefined:
      return "Best price: none";
    default:
      return `Best price: unknown (${p.best_price_withheld_reason})`;
  }
}

function allTimeLowLine(p: ProductOutput): string | undefined {
  if (p.all_time_low) return `All-time low: ${fmt(p.all_time_low)}, the lowest daily price ever recorded (first on ${p.all_time_low.date}), in stock or not`;
  switch (p.all_time_low_withheld_reason) {
    case "NO_DATA":
    case undefined:
      return undefined;
    case "MIXED_CURRENCY":
      return "All-time low: none, its price history spans more than one currency";
    default:
      return `All-time low: unknown (${p.all_time_low_withheld_reason})`;
  }
}

function specsLine(p: ProductOutput): string | undefined {
  const parts = Object.entries(p.specs).map(([key, s]) => `${key} ${typeof s.value === "boolean" ? (s.value ? "yes" : "no") : s.value}${s.unit ? ` ${s.unit}` : ""}`);
  return parts.length ? `Specs: ${parts.join(", ")}` : undefined;
}

function buyUrlLine(p: ProductOutput): string {
  if (!p.buy_url) return "buy_url: unavailable, use url";
  if (!p.best_price) return `buy_url: ${p.buy_url} (no best price right now, so this only opens the Product page; give url instead)`;
  return `buy_url: ${p.buy_url}`;
}

/** One Product as a markdown list item; `full` adds specs. `url` is always listed; `buy_url` is listed as given, or as an unavailable notice when the API omitted it. */
export function productMarkdown(p: ProductOutput, opts: { full: boolean }): string {
  const lines = [`- **${p.name}** (\`${p.model_slug}\`, model number ${p.model_number}), ${p.brand.name}, ${p.component_type.name}`, `  - ${bestPriceLine(p)}`];
  const low = allTimeLowLine(p);
  if (low) lines.push(`  - ${low}`);
  if (opts.full) {
    const specs = specsLine(p);
    if (specs) lines.push(`  - ${specs}`);
  }
  lines.push(`  - url: ${p.url}`, `  - ${buyUrlLine(p)}`);
  return lines.join("\n");
}

export function searchMarkdown(query: string, products: ProductOutput[], hasMore: boolean): string {
  if (products.length === 0) {
    return `No Products match "${query}". DropHawk covers PC components sold by Australian retailers; try fewer or different words, or a model number.`;
  }
  const head = hasMore
    ? `${products.length} best matches for "${query}" (more matched: raise limit, up to 50, or narrow the query):`
    : `${products.length} ${products.length === 1 ? "match" : "matches"} for "${query}":`;
  return [head, "", ...products.map((p) => productMarkdown(p, { full: false }))].join("\n");
}

export function batchMarkdown(out: BatchOutput): string {
  const blocks = out.results.map((r, i) => {
    if (!r.product) return `${i + 1}. \`${r.identifier}\`: ${r.error?.message ?? "not found"}`;
    const note = r.merged === true ? ` (merged into the Product below; use its model_slug from now on)` : "";
    const nested = productMarkdown(r.product, { full: true })
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n");
    return `${i + 1}. \`${r.identifier}\`${note}\n${nested}`;
  });
  return blocks.join("\n\n");
}

export function dailyLowsMarkdown(out: DailyLowsOutput): string {
  const subject = `\`${out.identifier}\``;
  if (out.points.length === 0) {
    const why =
      out.withheld_reason === "MIXED_CURRENCY"
        ? "its prices span more than one currency, so they cannot be compared"
        : out.withheld_reason === "NO_DATA" || !out.withheld_reason
          ? "DropHawk has no price history for it"
          : `the series is unknown (${out.withheld_reason})`;
    return `No daily lows for ${subject}: ${why}.`;
  }
  const currency = out.points[0]!.price.currency;
  // The carried-forward point predates the 30-day window: it is the price in force when the window opened,
  // so it is shown on its own and never counted as the window's lowest, highest or latest.
  const carried = out.points.find((p) => p.is_carried_forward);
  const inWindow = out.points.filter((p) => !p.is_carried_forward);
  const lines = [`Daily lows for ${subject} over the last 30 days: the lowest price observed each day across all retailers, in stock or not (${currency}).`];
  if (inWindow.length > 0) {
    const sorted = [...inWindow].sort((a, b) => Number(a.price.amount) - Number(b.price.amount));
    const lowest = sorted[0]!;
    const highest = sorted[sorted.length - 1]!;
    const latest = inWindow[inWindow.length - 1]!;
    lines.push(`Lowest ${lowest.price.amount} on ${lowest.date}, highest ${highest.price.amount} on ${highest.date}, latest ${latest.price.amount} on ${latest.date}.`);
  } else {
    lines.push("No price was observed inside the window.");
  }
  if (carried) {
    lines.push(`Before the window: ${carried.price.amount}, the price in force when it opened (carried forward from ${carried.date}); not part of the lowest, highest or latest above.`);
  }
  lines.push("", ...inWindow.map((p) => `- ${p.date}: ${p.price.amount}`));
  return lines.join("\n");
}

export function componentTypesMarkdown(types: readonly ComponentType[]): string {
  const lines = types.map((t) => {
    const specs = t.spec_schema.map((s) => `${s.key} (${s.label}, ${s.type}${s.unit ? `, ${s.unit}` : ""})`).join("; ");
    return `- **${t.name}** (\`${t.slug}\`), ${t.product_count} Products${specs ? `. Specs: ${specs}` : ""}`;
  });
  return ["# DropHawk ComponentTypes", "", "Each class of product DropHawk lists, with the Specs its Products carry.", "", ...lines].join("\n");
}

export function brandsMarkdown(brands: readonly Brand[]): string {
  const lines = brands.map((b) => `- ${b.name} (\`${b.slug}\`), ${b.product_count} Products`);
  return ["# DropHawk Brands", "", "Every maker with at least one Product. Search by name with search_products.", "", ...lines].join("\n");
}
