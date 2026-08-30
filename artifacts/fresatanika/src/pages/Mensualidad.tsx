import type { Page } from "../App";

interface Props {
  navigate: (p: Page) => void;
}

export default function Mensualidad({ navigate }: Props) {
  return (
    <div>
      <span className="back-link" onClick={() => navigate("home")}>{"< vuelve . . ."}</span>
      <h2 className="section-header">꣑୧・┈MENSUALIDAD<em>!</em></h2>

      <hr className="divider" />

      <p style={{ color: "#b08090", fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>
        La mensualidad es un servicio continuo en el que puedes solicitar hechizos y lecturas de manera mensual con descuentos especiales. Contáctame por TikTok o WhatsApp para conocer los planes disponibles.
      </p>

      <img src="/image03.jpg" alt="Mensualidad" className="mensual-img" />

      <div style={{ marginTop: 10, textAlign: "center" }}>
        <p style={{ color: "#c4809a", fontSize: 12, fontStyle: "italic", marginBottom: 10 }}>
          ¿Interesada/o? escríbeme y te cuento . . . ♡
        </p>
        <button className="pink-btn" onClick={() => navigate("aclaraciones")}>
          VER ACLARACIONES
        </button>
      </div>
    </div>
  );
}
