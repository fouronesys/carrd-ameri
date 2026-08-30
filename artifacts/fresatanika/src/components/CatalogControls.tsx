import { WHATSAPP_HREF, type SortMode } from "../lib/catalog";

interface Props {
  query: string;
  setQuery: (v: string) => void;
  sort: SortMode;
  setSort: (v: SortMode) => void;
  category: string;
  setCategory: (v: string) => void;
  categories: string[];
  deity: string;
  setDeity: (v: string) => void;
  deities: string[];
  resultCount: number;
  categoryLabel?: string;
}

export default function CatalogControls({
  query,
  setQuery,
  sort,
  setSort,
  category,
  setCategory,
  categories,
  deity,
  setDeity,
  deities,
  resultCount,
  categoryLabel = "tipo",
}: Props) {
  const hasActiveFilters =
    query.trim() !== "" ||
    sort !== "default" ||
    category !== "" ||
    deity !== "";

  const clearAll = () => {
    setQuery("");
    setSort("default");
    setCategory("");
    setDeity("");
  };

  return (
    <div className="catalog-controls">
      <div className="catalog-search-row">
        <input
          type="text"
          className="catalog-search"
          placeholder="buscar . . ."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar en el catálogo"
        />
        <a
          href={WHATSAPP_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="pink-btn catalog-help-btn"
        >
          ¿no sabes? ♡
        </a>
      </div>

      <div className="catalog-filter-row">
        <label className="catalog-filter-label">{categoryLabel}:</label>
        <select
          className="catalog-sort"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={`Filtrar por ${categoryLabel}`}
        >
          <option value="">todos</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {deities.length > 0 && (
          <select
            className="catalog-sort"
            value={deity}
            onChange={(e) => setDeity(e.target.value)}
            aria-label="Filtrar por deidad"
          >
            <option value="">toda deidad</option>
            {deities.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="catalog-filter-row">
        <label className="catalog-filter-label">orden:</label>
        <select
          className="catalog-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          aria-label="Ordenar"
        >
          <option value="default">orden original</option>
          <option value="az">nombre A-Z</option>
          <option value="za">nombre Z-A</option>
          <option value="price-asc">precio: menor a mayor</option>
          <option value="price-desc">precio: mayor a menor</option>
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            className="catalog-clear-btn"
            onClick={clearAll}
            aria-label="Limpiar filtros"
          >
            limpiar ✕
          </button>
        )}
        <span className="catalog-count">{resultCount} ítems</span>
      </div>
    </div>
  );
}
