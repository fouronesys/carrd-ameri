export interface CatalogItem {
  name: string;
  price: string;
  desc: string;
  category: string;
  deity?: string;
}

export type SortMode = "default" | "az" | "za" | "price-asc" | "price-desc";

export interface CatalogFilters {
  query?: string;
  sort?: SortMode;
  category?: string;
  deity?: string;
}

export function parsePriceCop(price: string): number {
  const match = price.match(/\$\s*([\d.]+)/);
  if (!match) return 0;
  return parseInt(match[1].replace(/\./g, ""), 10) || 0;
}

export function uniqueCategories(items: CatalogItem[]): string[] {
  return Array.from(new Set(items.map((it) => it.category)));
}

export function uniqueDeities(items: CatalogItem[]): string[] {
  return Array.from(
    new Set(items.map((it) => it.deity).filter((d): d is string => !!d)),
  ).sort((a, b) => a.localeCompare(b, "es"));
}

export function filterAndSort(
  items: CatalogItem[],
  filters: CatalogFilters,
): CatalogItem[] {
  const q = (filters.query ?? "").trim().toLowerCase();
  const sort = filters.sort ?? "default";
  let result = items;

  if (filters.category) {
    result = result.filter((it) => it.category === filters.category);
  }

  if (filters.deity) {
    result = result.filter((it) => it.deity === filters.deity);
  }

  if (q) {
    result = result.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        it.desc.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        (it.deity?.toLowerCase().includes(q) ?? false),
    );
  }

  if (sort === "default") return result;

  const sorted = [...result];
  switch (sort) {
    case "az":
      sorted.sort((a, b) => a.name.localeCompare(b.name, "es"));
      break;
    case "za":
      sorted.sort((a, b) => b.name.localeCompare(a.name, "es"));
      break;
    case "price-asc":
      sorted.sort((a, b) => parsePriceCop(a.price) - parsePriceCop(b.price));
      break;
    case "price-desc":
      sorted.sort((a, b) => parsePriceCop(b.price) - parsePriceCop(a.price));
      break;
  }
  return sorted;
}

export const WHATSAPP_NUMBER = "18492472516";

export function waHref(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export const WHATSAPP_HREF = waHref(
  "¡Hola! Buen día ✨ No estoy segura/o de qué servicio necesito y me encantaría que me orientes, por favor. ¡Muchas gracias!",
);

export function consultaHref(itemName: string, kind: "hechizo" | "lectura"): string {
  return waHref(
    `¡Hola! Buen día ✨ Me gustaría consultar sobre ${kind === "hechizo" ? "el hechizo" : "la lectura"} «${itemName}». ¿Me podrías dar más información, por favor? ¡Muchas gracias! ♡`,
  );
}
