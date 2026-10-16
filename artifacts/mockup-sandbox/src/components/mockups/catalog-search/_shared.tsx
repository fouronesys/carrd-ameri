import type { ReactNode } from "react";
import "./_group.css";

// Catalog copy extracted from index.html, #text31. No backend or payment calls.
export const services = [
  { name: "Limpieza de Vínculo", cop: 58000, usd: 29, category: "Vinculares", description: 'Limpia las "impurezas" de la relación, volviéndola más sana, que exista el respeto, el amor y la paz dentro de ésta.' },
  { name: "Sanacion de Vínculo", cop: 58000, usd: 29, category: "Vinculares", description: "Sana las inseguridades y problemáticas de la relación" },
  { name: "Endulzamiento", cop: 55000, usd: 29, category: "Vinculares", description: "Endulza a tu persona, hazla más dulce, mejora la relación en todos los aspectos" },
  { name: "Unión de pareja", cop: 58000, usd: 29, category: "Vinculares", description: "El hechizo ayuda a mejorar la comunicación, la confianza y a reforzar los sentimientos." },
  { name: "Reconciliación", cop: 55000, usd: 28, category: "Vinculares", description: "Hagamos que esa persona y tu resuelvan el problema de forma sana." },
  { name: "Abundancia en Pareja", cop: 95000, usd: 40, category: "Vinculares", description: "Crece económicamente junto a tu pareja." },
];
export const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
export const money = (value: number) => new Intl.NumberFormat("es-CO").format(value);

export function SearchIcon() {
  // Exact search icon from assets/catalogo-buscador.js.
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M15.5 15.5L21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

export function Ornament() {
  return <svg className="fsb-orn" viewBox="0 0 120 12" aria-hidden="true" focusable="false"><path d="M0 6h48M72 6h48" stroke="currentColor" strokeWidth=".8" /><path d="M60 1l3.2 5L60 11l-3.2-5z" fill="currentColor" /><circle cx="50" cy="6" r="1.2" fill="currentColor" /><circle cx="70" cy="6" r="1.2" fill="currentColor" /></svg>;
}

export function Preview({ children, current = false }: { children: ReactNode; current?: boolean }) {
  return <main className={`catalog-search-preview ${current ? "baseline" : "compact"}`}>
    <div className="catalog-excerpt">
      <header className="catalog-heading">
        <h1><span>꣑୧・┈</span>HECHIZOS<span><em>!</em></span></h1>
        <p>(Los precios de los hechizos <strong>no incluyen comisión</strong> . . .)</p>
      </header>
      <hr />
      {children}
    </div>
    <p className="preview-disclaimer">Vista de diseño · muestra de 6 servicios · sin pagos</p>
  </main>;
}

export function Results({ items }: { items: typeof services }) {
  if (!items.length) return <div className="preview-empty">No encontramos coincidencias.<br /><span>Prueba otra palabra o ajusta los filtros.</span></div>;
  return <section className="catalog-sample" aria-label="Servicios de muestra">
    <h2>｡ ˚ ︶︶ꔫ &nbsp; Vinculares &nbsp; ꔫ︶︶ ₊ ˚</h2>
    {items.map(item => <article key={item.name}>
      <h3>ෆ {item.name} ᵎᵎ</h3>
      <p className="sample-price">${money(item.cop)} <span>({item.usd} USD)</span></p>
      <p>{item.description}</p>
    </article>)}
  </section>;
}
