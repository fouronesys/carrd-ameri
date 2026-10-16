import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Preview, Results, SearchIcon, money, normalize, services } from "./_shared";
import "./_compact.css";

export function Compact({ initialOpen = false }: { initialOpen?: boolean }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState<"cop" | "usd">("cop");
  const [order, setOrder] = useState("orig");
  const [open, setOpen] = useState(initialOpen);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const categorySelect = useRef<HTMLSelectElement>(null);
  const raw = budget.trim().replace(/^\$\s*/, "");
  const validBudget = !raw || (currency === "cop" ? /^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(raw) : /^\d+(?:[.,]\d{1,2})?$/.test(raw));
  const limit = raw && validBudget ? Number(currency === "cop" ? raw.replace(/[.,]/g, "") : raw.replace(",", ".")) : null;
  const invalid = !validBudget || (limit !== null && !Number.isFinite(limit));
  const activeCount = Number(!!category) + Number(!!budget) + Number(order !== "orig") + Number(currency !== "cop" && !budget && order === "orig");
  const active = Boolean(query || activeCount);
  const filtered = useMemo(() => {
    const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
    const list = services.filter(s => (!category || s.category === category) && (limit === null || invalid || s[currency] <= limit) && tokens.every(t => normalize(s.name + " " + s.description + " " + s.category).includes(t)));
    if (order === "az") list.sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (order === "asc" || order === "desc") list.sort((a, b) => (a[currency] - b[currency]) * (order === "asc" ? 1 : -1));
    return list;
  }, [query, category, currency, limit, invalid, order]);
  useEffect(() => {
    if (!open) return;
    categorySelect.current?.focus();
    function outside(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  function clear() {
    setQuery(""); setCategory(""); setBudget(""); setCurrency("cop"); setOrder("orig");
  }
  function finish() {
    if (invalid) { root.current?.querySelector<HTMLInputElement>(".cs-budget-input")?.focus(); return; }
    setOpen(false); trigger.current?.focus();
  }
  function removeBudget() {
    setBudget(""); setCurrency("cop");
  }
  return <Preview>
    <div className="cs-search" role="search" aria-label="Buscar hechizos" ref={root}>
      <div className="cs-bar">
        <div className="cs-query">
          <SearchIcon />
          <input ref={input} id={id + "-q"} aria-label="Buscar por nombre, intención o palabra clave" aria-controls={id + "-results"} type="search" autoComplete="off" spellCheck={false} enterKeyHint="search" placeholder="Busca tu intención…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape" && !open) setQuery(""); }} />
          {query && <button className="cs-x" type="button" aria-label="Borrar búsqueda" onClick={() => { setQuery(""); input.current?.focus(); }}>×</button>}
        </div>
        <button ref={trigger} className={`cs-trigger ${open ? "is-open" : ""}`} type="button" aria-expanded={open} aria-controls={id + "-filters"} onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="7" cy="6" r="2" fill="#18070f" stroke="currentColor" strokeWidth="1.3" /><circle cx="13" cy="14" r="2" fill="#18070f" stroke="currentColor" strokeWidth="1.3" /></svg>
          <span>Filtros</span>{activeCount > 0 && <span className="cs-badge" aria-label={activeCount + " filtros activos"}>{activeCount}</span>}
        </button>
      </div>
      <div className="cs-meta">
        <p aria-live="polite" aria-atomic="true">{active ? `${filtered.length} de ${services.length}` : services.length} hechizos <span>· muestra</span></p>
        {active && <button type="button" onClick={clear}>Limpiar todo</button>}
      </div>
      {activeCount > 0 && <div className="cs-chips" aria-label="Filtros activos">
        {category && <button type="button" onClick={() => setCategory("")} aria-label={`Quitar categoría ${category}`}>{category}<span aria-hidden="true">×</span></button>}
        {budget && <button type="button" className={invalid ? "cs-invalid-chip" : ""} onClick={removeBudget} aria-label="Quitar presupuesto">{invalid ? "Revisar presupuesto" : `Hasta ${money(limit ?? 0)} ${currency.toUpperCase()}`}<span aria-hidden="true">×</span></button>}
        {order !== "orig" && <button type="button" onClick={() => setOrder("orig")} aria-label="Quitar ordenación">{order === "az" ? "Nombre A–Z" : (order === "asc" ? "Menor precio" : "Mayor precio") + " · " + currency.toUpperCase()}<span aria-hidden="true">×</span></button>}
        {currency !== "cop" && !budget && order === "orig" && <button type="button" onClick={() => setCurrency("cop")} aria-label="Restablecer moneda a COP">USD<span aria-hidden="true">×</span></button>}
      </div>}
      {open && <section id={id + "-filters"} className="cs-popover" aria-label="Filtros del catálogo" onBlur={e => { if (e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
        <header><h2>Afina tu búsqueda</h2><button type="button" className="cs-close" aria-label="Cerrar filtros" onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button></header>
        <div className="cs-fields">
          <label htmlFor={id + "-category"}>Categoría<select ref={categorySelect} id={id + "-category"} value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option><option>Vinculares</option></select></label>
          <label htmlFor={id + "-budget"}>Presupuesto máximo
            <div className="cs-budget">
              <input id={id + "-budget"} className="cs-budget-input" type="text" inputMode="decimal" placeholder="Sin límite" autoComplete="off" value={budget} onChange={e => setBudget(e.target.value)} aria-invalid={invalid} aria-describedby={id + "-budget-help"} />
              <select aria-label="Moneda del presupuesto y ordenación" value={currency} onChange={e => setCurrency(e.target.value as "cop" | "usd")}><option value="cop">COP</option><option value="usd">USD</option></select>
            </div>
            <span className={invalid ? "cs-error" : "cs-help"} id={id + "-budget-help"} role={invalid ? "status" : undefined}>{invalid ? `Escribe un valor válido, por ejemplo ${currency === "cop" ? "50.000 COP" : "25,50 USD"}.` : "Precio base, sin comisión."}</span>
          </label>
          <label htmlFor={id + "-order"}>Ordenar por<select id={id + "-order"} value={order} onChange={e => setOrder(e.target.value)}><option value="orig">Orden del catálogo</option><option value="asc">Precio: menor a mayor</option><option value="desc">Precio: mayor a menor</option><option value="az">Nombre: A–Z</option></select></label>
          <p className="cs-help">El precio se ordena en {currency.toUpperCase()}, sin conversiones.</p>
        </div>
        <footer><button type="button" className="cs-clear" onClick={clear} disabled={!active}>Restablecer</button><button type="button" className="cs-apply" onClick={finish}>Ver {filtered.length} resultados <span aria-hidden="true">→</span></button></footer>
      </section>}
    </div>
    <div id={id + "-results"}><Results items={filtered} /></div>
  </Preview>;
}
