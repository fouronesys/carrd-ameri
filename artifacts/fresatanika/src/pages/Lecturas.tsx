import { useMemo, useState } from "react";
import type { Page } from "../App";
import CatalogControls from "../components/CatalogControls";
import { filterAndSort, consultaHref, uniqueCategories, uniqueDeities, type CatalogItem, type SortMode } from "../lib/catalog";
import { usePaymentGate } from "../components/PaymentGate";

interface Props {
  navigate: (p: Page) => void;
}

const ITEMS: CatalogItem[] = [
  { category: "Preguntas", name: "𝜗᭪ Pregunta de si/no", price: "$2.500 (1 usd)", desc: "Pregunta corta de si/no con explicación con fotos de las cartas." },
  { category: "Preguntas", name: "𝜗᭪ Pregunta Extensa", price: "$9.000 (2 usd)", desc: "Pregunta con explicación de más de un minuto y medio con foto de las cartas." },
  { category: "Preguntas", name: "𝜗᭪ Tarot libre treinta minutos", price: "$55.000 (12 usd)", desc: "Se hace por medio de llamada y se hacen la cantidad de preguntas que se puedan en ese lapso." },
  { category: "Preguntas", name: "𝜗᭪ Tarot libre una hora", price: "$85.000 (18 usd)", desc: "Se hace por medio de llamada y se hacen la cantidad de preguntas que se puedan en ese lapso." },
  { category: "Preguntas", name: "𝜗᭪ Pregunta de tiempo", price: "$12.000 (5 usd)", desc: "Sirve para saber en qué tiempo van a suceder ciertas situaciones." },
  { category: "Preguntas", name: "𝜗᭪ Dos preguntas de tiempo", price: "$20.000 (8 usd)", desc: "Sirve para saber en qué tiempo van a suceder ciertas situaciones." },

  { category: "Vinculares", name: "𐙚 Vinculares", price: "$40.000 (20 USD)", desc: "¿Qué siente? ¿Cómo está la relación? ¿Qué problemas tiene la relación? ¿Cómo mejorarla? ¿Cómo me ve? + posible futuro y un consejo del tarot." },
  { category: "Vinculares", name: "𐙚 Ex-Vincular", price: "$40.000 (20 USD)", desc: "¿Cómo está? ¿Va a volver? ¿Me conviene? ¿Qué le faltó a la relación? ¿Qué me enseñó el vínculo? + consejo." },
  { category: "Vinculares", name: "𐙚 Lectura de Crush", price: "$40.000 (20 USD)", desc: "¿Le gusto? ¿Cómo me acerco? ¿Qué piensa de mí? ¿Cómo sería si tuviésemos una relación? + consejo" },
  { category: "Vinculares", name: "𐙚 Lectura vincular extensa", price: "$50.000 (25 USD)", desc: "Energía de ambos, comunicación, virtudes y defectos de ambos, energía sexual, pasado, presente y futuro + consejos." },
  { category: "Vinculares", name: "𐙚 Lectura de Futuro amor", price: "$40.000 (20 USD)", desc: "¿Cómo será este futuro amor? ¿Qué me enseñará? + posibles características físicas y consejo." },

  { category: "Autoconocimiento", name: "✩ Lectura General", price: "$50.000 (25 USD)", desc: "Se ve la energía del consultante en varias áreas de su vida; amor, familia, amigos, dinero, trabajo/estudios, salud + ¿Qué necesita tu atención? + tu energía + consejo." },
  { category: "Autoconocimiento", name: "✩ Lectura Autoconocimiento", price: "$25.000 (10 usd)", desc: "¿En qué debo enfocar mi energía? ¿Qué me tiene trabado? ¿Cómo estoy en el plano espiritual y terrenal? + consejo." },
  { category: "Autoconocimiento", name: "✩ Lectura Brujería", price: "$35.000 (18 usd)", desc: "¿Tengo algún trabajo? ¿Qué tipo de trabajo es? ¿Por qué lo hizo? + posibles características de la persona que lo hizo. Si no tienes brujería: ¿Por qué te sientes así? ¿Cómo quitar ese trabe? + consejo." },
  { category: "Autoconocimiento", name: "✩ Lectura de Mascota", price: "$18.000 (6 usd)", desc: "¿Tiene algún mensaje para mí? ¿Cómo se siente conmigo? + canalización" },
  { category: "Autoconocimiento", name: "✩ Lectura de Shifting", price: "$18.000 (6 usd)", desc: "¿Hay algún mensaje de mi RD? ¿Qué me falta para poder llegar? ¿Debería cambiar el método? + consejo" },
  { category: "Autoconocimiento", name: "✩ Lectura Anual", price: "$100.000 (50 USD)", desc: "Se ve la energía del año en aspectos tales como: amor, trabajo, dinero, familia y amigos + ¿Qué debo soltar este año? consejo mes a mes y carta del mes." },
  { category: "Autoconocimiento", name: "✩ Consejo de la semana", price: "$4.000 (1 usd)", desc: "¿En qué enfocar mi energía esta semana?" },
  { category: "Autoconocimiento", name: "✩ Lectura Solteros", price: "$16.000 (5 usd)", desc: "¿Por qué estoy soltero? ¿Me conviene seguir soltero? ¿Qué me bloquea? ¿Cómo quitar ese bloqueo? ¿Cuándo llegará un nuevo amor? + consejo." },
  { category: "Autoconocimiento", name: "✩ Lectura de trabajo", price: "$16.000 (5 usd)", desc: "¿Me conviene este trabajo? ¿Cómo puedo mejorar en este aspecto? ¿Cómo relacionarme más con mis compañeros de trabajo? + consejo" },
  { category: "Autoconocimiento", name: "✩ Lectura de vidas pasadas", price: "$40.000 (8 usd)", desc: "¿Quién fui? ¿Qué aprendí? ¿Tengo algún vínculo pasado en esta vida?" },
  { category: "Autoconocimiento", name: "✩ Mensajes de guías", price: "$20.000 (8 usd)", desc: "¿Qué consejo tienen mis guías para mí? ¿Qué me quieren decir mis guías?" },
  { category: "Autoconocimiento", name: "✩ Mensajes de persona fallecida", price: "$30.000 (10 usd)", desc: "¿Qué me quiere decir esta persona? ¿Qué consejo tiene?" },
];

const CATEGORY_IMAGES: Record<string, string> = {
  Preguntas: "/image05.jpg",
  Vinculares: "/image16.jpg",
  Autoconocimiento: "/image20.jpg",
};

function ServiceRow({ item }: { item: CatalogItem }) {
  const { requestPayment } = usePaymentGate();
  return (
    <div className="service-item">
      <div className="service-row-head">
        <div className="service-row-name-col">
          <div className="service-name">{item.name}</div>
          <div className="service-price"><em>{item.price}</em></div>
        </div>
        <div className="service-btns">
          <a
            className="pay-btn pay-btn-secondary"
            href={consultaHref(item.name, "lectura")}
            target="_blank"
            rel="noreferrer"
          >
            consultar ♡
          </a>
          <button
            className="pay-btn"
            onClick={() => requestPayment({ priceString: item.price, itemName: item.name })}
          >
            pagar ♡
          </button>
        </div>
      </div>
      <div className="service-desc">{item.desc}</div>
    </div>
  );
}

export default function Lecturas({ navigate }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("default");

  const [category, setCategory] = useState("");
  const [deity, setDeity] = useState("");

  const categories = useMemo(() => uniqueCategories(ITEMS), []);
  const deities = useMemo(() => uniqueDeities(ITEMS), []);

  const filtered = useMemo(
    () => filterAndSort(ITEMS, { query, sort, category, deity }),
    [query, sort, category, deity],
  );

  const isFilteringOrSorting =
    query.trim() !== "" || sort !== "default" || category !== "" || deity !== "";

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const it of filtered) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    return map;
  }, [filtered]);

  return (
    <div>
      <span className="back-link" onClick={() => navigate("home")}>{"< vuelve . . ."}</span>
      <h2 className="section-header">꣑୧・┈LECTURAS<em>!</em></h2>
      <p className="section-subheader">(Los precios de las lecturas <strong>no incluyen comisión</strong> . . .)</p>

      <CatalogControls
        query={query}
        setQuery={setQuery}
        sort={sort}
        setSort={setSort}
        category={category}
        setCategory={setCategory}
        categories={categories}
        deity={deity}
        setDeity={setDeity}
        deities={deities}
        resultCount={filtered.length}
        categoryLabel="tipo"
      />

      <hr className="divider" />

      {filtered.length === 0 ? (
        <div className="catalog-empty">no encontramos nada con "{query}" ♡</div>
      ) : isFilteringOrSorting ? (
        <div className="service-grid">
          {filtered.map((item, idx) => <ServiceRow key={`${item.category}-${item.name}-${idx}`} item={item} />)}
        </div>
      ) : (
        Array.from(grouped.entries()).map(([category, items]) => (
          <div key={category}>
            <div className="category-title">｡ ˚ ︶︶ꔫ {category} ꔫ︶︶ ₊ ˚</div>
            <div className="heart-divider">・┈・♡・┈・</div>
            <div className="service-grid">
              {items.map((item, idx) => (
                <ServiceRow key={`${category}-${item.name}-${idx}`} item={item} />
              ))}
            </div>
            {CATEGORY_IMAGES[category] && (
              <img src={CATEGORY_IMAGES[category]} alt="" className="section-image" />
            )}
          </div>
        ))
      )}

      <div style={{ textAlign: "center", marginTop: 8 }}>
        <button className="pink-btn" onClick={() => navigate("mensualidad")}>
          PROMOS ♡
        </button>
      </div>
    </div>
  );
}
