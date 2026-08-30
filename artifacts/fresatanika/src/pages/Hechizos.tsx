import { useMemo, useState } from "react";
import type { Page } from "../App";
import CatalogControls from "../components/CatalogControls";
import { filterAndSort, consultaHref, uniqueCategories, uniqueDeities, type CatalogItem, type SortMode } from "../lib/catalog";
import { usePaymentGate } from "../components/PaymentGate";

interface Props {
  navigate: (p: Page) => void;
}

const ITEMS: CatalogItem[] = [
  { category: "Vinculares", name: "ෆ Limpieza de Vínculo ᵎᵎ", price: "$58.000 (29 USD)", desc: 'Limpia las "impurezas" de la relación, volviéndola más sana, que exista el respeto, el amor y la paz dentro de ésta.' },
  { category: "Vinculares", name: "ෆ Sanación de Vínculo ᵎᵎ", price: "$58.000 (29 USD)", desc: "Sana las inseguridades y problemáticas de la relación" },
  { category: "Vinculares", name: "ෆ Endulzamiento ᵎᵎ", price: "$55.000 (29 USD)", desc: "Endulza a tu persona, hazla más dulce, mejora la relación en todos los aspectos" },
  { category: "Vinculares", name: "ෆ Unión de pareja ᵎᵎ", price: "$58.000 (29 USD)", desc: "El hechizo ayuda a mejorar la comunicación, la confianza y a reforzar los sentimientos." },
  { category: "Vinculares", name: "ෆ Reconciliación ᵎᵎ", price: "$55.000 (28 USD)", desc: "Hagamos que esa persona y tú resuelvan el problema de forma sana." },
  { category: "Vinculares", name: "ෆ Entendámonos como antes ᵎᵎ", price: "$55.000 (28 usd)", desc: "¿Se perdió la chispa de la relación? vamos a encenderla nuevamente." },
  { category: "Vinculares", name: "ෆ Abundancia en Pareja ᵎᵎ", price: "$95.000 (40 USD)", desc: "Crece económicamente junto a tu pareja." },
  { category: "Vinculares", name: "ෆ Aumentar Pasión ᵎᵎ", price: "$75.000 (38 USD)", desc: "Aumenta la tensión sexual y la pasión entre tú y tu persona deseada." },
  { category: "Vinculares", name: "ෆ ¿Es nuestro? ᵎᵎ", price: "$215.000 (78 usd)", desc: "¿Quieres tener un hijo con esa persona? este hechizo es para ti." },
  { category: "Vinculares", name: "ෆ Unión eterna ᵎᵎ", price: "$200.000 (75 USD)", desc: "Refuerza la comunicación, la confianza, el contacto físico y hace la relación sana eternamente" },

  { category: "Amor propio", name: "⟡ Limpieza Propia", price: "$38.000 (25 usd)", desc: "Limpia las malas energías de tu vida." },
  { category: "Amor propio", name: "⟡ Sanación Emocional", price: "$38.000 (25 usd)", desc: "Curemos de raíz eso que te hace mal." },
  { category: "Amor propio", name: "⟡ Protección", price: "$38.000 (25 usd)", desc: "Protege tu energía, evita envidias y trabajos no deseados." },
  { category: "Amor propio", name: "⟡ Auto endulzamiento", price: "$38.000 (25 usd)", desc: "Te vuelve más magnética y atractiva, ayuda con el amor propio." },
  { category: "Amor propio", name: "⟡ Potenciador de Belleza", price: "$38.000 (25 usd)", desc: "Hazte más magnético, más lindo y más seguro." },
  { category: "Amor propio", name: "⟡ Cambio físico", price: "$38.000 (25 usd)", desc: "Logra ese cambio que tanto deseas, puedes cambiar lo que quieras, como quieras." },
  { category: "Amor propio", name: "☼ Atraer amor", price: "$45.000 (26 usd)", desc: "¿Llevas soltero mucho tiempo? ¡tranqui! este hechizo es para ti." },
  { category: "Amor propio", name: "☼ Belleza y magnetismo", price: "$65.000 (32 usd)", desc: "Combina el abre caminos, estudios, limpieza propia, cambio físico y auto endulzamiento haciendo que tu belleza y entorno mejore al 100." },

  { category: "Crush", name: "⊹˚ Acercamiento Amoroso", price: "$48.000 (25.50 usd)", desc: "Tu persona deseada se acerca a ti con las intenciones de formar un vínculo" },
  { category: "Crush", name: "⊹˚ Invítame", price: "$48.000 (25.50 usd)", desc: "Ideal para que esa persona te invite a lo que tú desees, ¡ten una date perfecta!" },
  { category: "Crush", name: "⊹˚ Corresponder amor", price: "$48.000 (25.50 usd)", desc: "Para que tu persona deseada te corresponda los sentimientos" },
  { category: "Crush", name: "⊹˚ Formalización", price: "$48.000 (25.50 usd)", desc: "¿Cansado de que no te suelte ni te elija? este hechizo es perfecto para ti." },

  { category: '"Último recurso"', name: "꒦ Generar discusiones", price: "$120.000 (47 USD)", desc: "Crea falta de comunicación, problemas y demás entre las personas que quieras" },
  { category: '"Último recurso"', name: "꒦ Corte de Lazos", price: "$120.000 (47 USD)", desc: "Cortar todo tipo de vínculo emocional, físico, sexual entre dos personas." },
  { category: '"Último recurso"', name: "ᶻ 𝗓 𐰁 Separación", price: "$120.000 (47 USD)", desc: "Haz que esa pareja tenga discusiones hasta el punto de terminar la relación." },
  { category: '"Último recurso"', name: "ᶻ 𝗓 𐰁 Alejamiento", price: "$120.000 (47 USD)", desc: "Aleja a esa persona de tu vida o de la vida de otras personas!" },
  { category: '"Último recurso"', name: "ೀ Yo me voy tú te quedas", price: "$120.000 (47 USD)", desc: "Un corte de lazos en el cual la única persona que suelta eres tú y la otra persona se obsesiona por ti." },
  { category: '"Último recurso"', name: "ೀ Olvida aquel amor", price: "$120.000 (47 USD)", desc: "Haz que tu pareja olvide a cualquier persona del pasado." },

  { category: "Toxic love", name: "꒦ Retorno", price: "$75.000 (32 usd)", desc: "Haz que tu persona de interés regrese a tu vida" },
  { category: "Toxic love", name: "꒦ Retorno con vudú", price: "$95.000 (34 usd)", desc: "La persona volverá amansada, totalmente dominada y arrodillada hacia ti, con ganas de formar un vínculo" },
  { category: "Toxic love", name: "꒦ Desespero", price: "$90.000 (34.50 usd)", desc: "Desespero con corazón de pollo para tener a tu persona." },
  { category: "Toxic love", name: "ೀ Obsesión", price: "$90.000 (34.50 USD)", desc: "Vuelve loca a esta persona por ti, que sea capaz de hacer cualquier cosa por estar contigo." },
  { category: "Toxic love", name: "ೀ Rompimiento de ego", price: "$95.000 (34 USD)", desc: "Ideal para aquella persona que no muestra sus sentimientos, que no se acerca ni nada así debido a su ego. (incluye velación por 3 noches)" },
  { category: "Toxic love", name: "ೀ Humillación", price: "$115.000 (37 USD)", desc: "Hace que la persona regrese totalmente humillada a ti, amansada y rogando" },
  { category: "Toxic love", name: "ೀ Dominio", price: "$95.000 (34.50 USD)", desc: "Tu persona deseada estará dispuesta a hacer lo que le órdenes sin reproches." },
  { category: "Toxic love", name: "ೀ Dominio sexual", price: "$115.000 (48 USD)", desc: "Tu persona deseada estará dispuesta a hacer lo que le órdenes sin reproches." },
  { category: "Toxic love", name: "ೀ Solo mío", price: "$95.000 (34.50 USD)", desc: "Esa persona estará loca por ti, combinamos la obsesión y el desespero en uno solo." },
  { category: "Toxic love", name: "ೀ Mírame solo a mi", price: "$98.000 (34.50 USD)", desc: "Protejamos tu relación de infidelidades o de terceras personas." },
  { category: "Toxic love", name: "ೀ Si no estoy, no funciona", price: "$130.000 (48 USD)", desc: "Provocamos disfunción eréctil o dolor al tener relaciones sexuales que no sean contigo." },
  { category: "Toxic love", name: "ೀ Tormento", price: "$115.000 (39.70 USD)", desc: "Un hechizo que mezcla el retorno, obsesión, desespero y dominio causando que tu persona deseada se sienta incompleta sin ti." },
  { category: "Toxic love", name: "ೀ Perrito faldero", price: "$300.000 (90 USD)", desc: "Tener detrás a tu persona deseada de manera desesperada, hará cualquier cosa con tal de que le prestes atención, te defenderá ante quien sea" },

  { category: "Familia", name: "ಎ Llevarte mejor con tu hermana/o", price: "$30.000 (23 USD)", desc: "Haz que esas peleas terminen y formen una relación sana." },
  { category: "Familia", name: "ಎ Soy tu hijo, no tu enemigo", price: "$30.000 (23 USD)", desc: "Limpia y reforma ese vínculo que tienes con tu padre/madre." },
  { category: "Familia", name: "ಎ Perfect Family", price: "$30.000 (23 USD)", desc: "Llévate bien con toda tu familia y disipa las discusiones." },
  { category: "Familia", name: "ಎ Somos padre e hijo", price: "$30.000 (23 USD)", desc: "¿Cansado de discutir con tu hijx? ¡arregla eso!" },
  { category: "Familia", name: "ෆ Eres parte de nosotros ᵎᵎ", price: "$65.000 (32 usd)", desc: "Hechizo para llevarse bien con la familia de tu pareja o que él se lleve bien con la tuya. (funciona también para amigos)" },

  { category: "No touch me", name: "꒦ Limpieza Brujería", price: "$80.000 (34.50 USD)", desc: "Quita algún trabajo que te hayan hecho." },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Volteo", price: "$120.000 (47 USD)", desc: "Hagamos que a esta persona se le devuelva TODO lo que te ha hecho de la peor manera posible" },
  { category: "No touch me", name: "꒦ Contra Hechizo", price: "$155.000 (51 USD)", desc: "Haz que rebote algún hechizo que te hicieron y libérate de él!" },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Págame lo que me debes", price: "$120.000 (47 USD)", desc: "Para que esta persona que no te paga el dinero que le prestaste te lo devuelva." },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Volver feo a alguien", price: "$120.000 (47 USD)", desc: "Haz que esa persona pierda todo su encanto ante los ojos de los demás" },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Calla bocas", price: "$120.000 (47 USD)", desc: "Un hechizo para que esa persona deje de nombrarte o hablar mal de ti." },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Enférmate", price: "$120.000 (47 USD)", desc: "Haz que esa persona que te hizo tanto daño se enferme gravemente." },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Cierre caminos", price: "$120.000 (47 USD)", desc: "Cierra los caminos de esa persona que te hizo daño en todos los aspectos" },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Cierre caminos potenciado", price: "$140.000 (50 USD)", desc: "Cierra los caminos de esa persona con corazones podridos" },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Congelamiento", price: "$45.000 (26 USD)", desc: "Has que a esa persona se le paren todos sus proyectos, que se sienta estancado" },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Rechazo", price: "$130.000 (45 USD)", desc: "Haz que esa persona no pueda encontrar amigos, no pueda relacionarse con nadie y mucho menos ser agradable para los demás" },
  { category: "No touch me", name: "ᶻ 𝗓 𐰁 Entierro", price: "$2.900.000 (500 USD)", desc: "Deshazte de esa persona que te atormenta para siempre, de quien te hizo daño, de quien te lastimó" },

  { category: "Abundancia", name: "☼ Abre caminos con naranja", price: "$48.000 (26 USD)", desc: "Atrae el éxito a tu vida, éxito amoroso, financiero y emocional potenciado con una naranja." },
  { category: "Abundancia", name: "☼ Abundancia económica", price: "$48.000 (26 USD)", desc: "Tus ingresos van a aumentar de forma considerable." },
  { category: "Abundancia", name: "☼ Conseguir Trabajo", price: "$48.000 (26 USD)", desc: "Hagamos que te llamen de ese trabajo que tanto deseas, sé el mejor candidato para esa empresa." },
  { category: "Abundancia", name: "☼ Atrae clientes", price: "$48.000 (26 USD)", desc: "Atrae clientes a tu negocio físico o virtual." },
  { category: "Abundancia", name: "☼ Estudios", price: "$48.000 (26 USD)", desc: "Aprueba tus exámenes, aprende a concentrarte y ten mejores notas." },
  { category: "Abundancia", name: "☼ Aprender Idioma", price: "$48.000 (26 USD)", desc: "Facilita el aprendizaje de cualquier idioma." },
  { category: "Abundancia", name: "☼ Vela de Manifestación", price: "$25.000 (18 USD)", desc: "Hagamos que tu deseo sea real." },

  { category: "Amarres", name: "𖥔 Amarre simple", price: "$80.000 (34 USD)", desc: "Crea una dependencia leve a la persona hacia ti. Duración: nueve meses" },
  { category: "Amarres", name: "𖥔 Amarre con corazón de pollo", price: "$95.000 (42 USD)", desc: "Esta persona se sentirá intranquila si tú no estás, genera dependencia emocional y física. Duración: dos años" },
  { category: "Amarres", name: "𖥔 Amarre con corazón de pollo y vela de amarre fuerte", price: "$115.000 (46 USD)", desc: "Crea una fuerte obsesión de la persona hacia ti, que solo pueda estar contigo, que nadie más lo llene. Duración: tres años" },
  { category: "Amarres", name: "𖥔 Amarre siete nudos", price: "$500.000 (148 USD)", desc: "Amarre que genera dependencia fuerte, también hace que esta persona esté totalmente dominada por ti, sexualmente y mentalmente, además causa que esta persona te dé todo lo que tú desees, que haga lo que tú quieras y se aleje de terceras personas que quieran interferir en su vínculo. Duración: siete años" },
  { category: "Amarres", name: "𖥔 Amarre con vudú", price: "$850.000 (165 USD)", desc: "Un amarre que controla a la persona, la amansa y es trabajado para generar dependencia física y emocional fuerte en la persona" },
  { category: "Amarres", name: "𖥔 Amarre de matrimonio", price: "$240.000 (80 USD)", desc: "Ideal si quieres que esta persona se comprometa del todo y quiera empezar un hogar contigo" },
  { category: "Amarres", name: "𖥔 Amarre siete nudos reforzado", price: "$1.100.000 (350 USD)", desc: "Amarre eterno, hace que la persona esté amarrada desde sus siete pilares haciendo que esté totalmente a tu disposición" },

  { category: "Deidades", deity: "Lilith", name: "ꗯ Corte de Lazos", price: "$160.000 (80 usd)", desc: "Deidad: Lilith — Cortar todo tipo de vínculo emocional, físico y sexual entre dos personas." },
  { category: "Deidades", deity: "Lilith", name: "ꗯ Auto endulzamiento", price: "$160.000 (80 usd)", desc: "Deidad: Lilith — Te vuelve más magnética y atractiva, ayuda con el amor propio." },
  { category: "Deidades", deity: "Hécate", name: "ꗯ Abundancia", price: "$160.000 (80 usd)", desc: "Deidad: Hécate — Mejora tus ingresos económicos." },
  { category: "Deidades", deity: "Hécate", name: "ꗯ Abre caminos", price: "$160.000 (80 usd)", desc: "Deidad: Hécate — Abre tus caminos en los ámbitos que desees." },
  { category: "Deidades", deity: "Lucifer", name: "ꗯ Protección", price: "$160.000 (80 usd)", desc: "Deidad: Lucifer — Protégete de males físicos y espirituales" },
];

const CATEGORY_IMAGES: Record<string, string> = {
  Vinculares: "/image09.jpg",
  "Amor propio": "/image10.jpg",
  Crush: "/image11.jpg",
  '"Último recurso"': "/image12.jpg",
  "Toxic love": "/image13.jpg",
  Familia: "/image14.jpg",
  "No touch me": "/image06.jpg",
  Abundancia: "/image21.jpg",
  Amarres: "/image15.jpg",
  Deidades: "/image03.jpg",
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
            href={consultaHref(item.name, "hechizo")}
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

export default function Hechizos({ navigate }: Props) {
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
      <h2 className="section-header">꣑୧・┈HECHIZOS<em>!</em></h2>
      <p className="section-subheader">(Los precios de los hechizos <strong>no incluyen comisión</strong> . . .)</p>

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
          MENSUALIDAD ♡
        </button>
      </div>
    </div>
  );
}
