import { useId, useMemo, useState } from "react";
import { Ornament, Preview, Results, SearchIcon, normalize, services } from "./_shared";

// Toolbar structure extracted from montar() in assets/catalogo-buscador.js.
// Production DOM scanning, payments and network effects are replaced by a local sample.
export function Current() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("cop");
  const [order, setOrder] = useState("orig");
  const limit = budget.trim() ? Number(budget.replace(currency === "cop" ? /[.,]/g : /,/g, currency === "cop" ? "" : ".")) : null;
  const invalid = limit !== null && (!Number.isFinite(limit) || limit < 0);
  const filtered = useMemo(() => {
    const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
    const list = services.filter(s => (!category || s.category === category) && (limit === null || invalid || s[currency as "cop" | "usd"] <= limit) && tokens.every(t => normalize(s.name + " " + s.description + " " + s.category).includes(t)));
    if (order === "az") list.sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (order === "asc" || order === "desc") list.sort((a, b) => (a[currency as "cop" | "usd"] - b[currency as "cop" | "usd"]) * (order === "asc" ? 1 : -1));
    return list;
  }, [query, category, currency, limit, invalid, order]);
  const active = Boolean(query || category || budget || currency !== "cop" || order !== "orig");
  function reset() { setQuery(""); setCategory(""); setBudget(""); setCurrency("cop"); setOrder("orig"); }
  return <Preview current>
    <div className="fsb-panel fsb-listo" role="search" aria-label="Buscar hechizos">
      <div className="fsb-head"><Ornament /><p className="fsb-title">Buscar hechizos</p><Ornament /></div>
      <label className="fsb-label" htmlFor={id + "-q"}>Nombre, intención o palabra clave</label>
      <div className="fsb-qwrap"><SearchIcon /><input id={id + "-q"} className="fsb-input fsb-q" type="search" autoComplete="off" spellCheck={false} enterKeyHint="search" placeholder="ej. amor, limpieza, tiempo" value={query} onChange={e => setQuery(e.target.value)} /><button type="button" className="fsb-x" aria-label="Borrar búsqueda" hidden={!query} onClick={() => setQuery("")}>×</button></div>
      <div className="fsb-grid">
        <div className="fsb-field fsb-wide"><label className="fsb-label" htmlFor={id + "-c"}>Categoría</label><select id={id + "-c"} className="fsb-input fsb-c" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option><option>Vinculares</option></select></div>
        <div className="fsb-field"><label className="fsb-label" htmlFor={id + "-m"}>Presupuesto máx.</label>
          <div className="fsb-budget"><input id={id + "-m"} className="fsb-input fsb-m" type="text" inputMode="decimal" autoComplete="off" placeholder="Sin límite" value={budget} onChange={e => setBudget(e.target.value)} aria-invalid={invalid} aria-describedby={id + "-error"} /><select className="fsb-input fsb-cur" aria-label="Moneda del presupuesto y ordenación" value={currency} onChange={e => setCurrency(e.target.value)}><option value="cop">COP</option><option value="usd">USD</option></select></div>
          <p className="fsb-budget-error" id={id + "-error"} role="status" hidden={!invalid}>Escribe un presupuesto válido.</p>
        </div>
        <div className="fsb-field"><label className="fsb-label" htmlFor={id + "-s"}>Ordenar</label><select id={id + "-s"} className="fsb-input fsb-s" value={order} onChange={e => setOrder(e.target.value)}><option value="orig">Orden original</option><option value="asc">Precio: menor a mayor</option><option value="desc">Precio: mayor a menor</option><option value="az">Nombre: A–Z</option></select></div>
      </div>
      <p className="fsb-note">Precios base, sin comisión. Se ordenan en la moneda elegida; los servicios sin precio en ella aparecen al final.</p>
      <div className="fsb-foot"><p className="fsb-count" aria-live="polite">{active ? filtered.length + " de " : ""}{active ? services.length : filtered.length} hechizos{!active && " en el catálogo"}</p><button type="button" className="fsb-reset" disabled={!active} onClick={reset}>Limpiar filtros</button></div>
    </div>
    <Results items={filtered} />
  </Preview>;
}
