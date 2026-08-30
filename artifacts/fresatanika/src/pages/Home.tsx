import type { Page } from "../App";
import { WHATSAPP_HREF } from "../lib/catalog";

interface Props {
  navigate: (p: Page) => void;
}

export default function Home({ navigate }: Props) {
  return (
    <div>
      <div className="intro-symbol">꣑୧・┈ <em>!</em></div>
      <div className="quote-text">. . . . . . . doy mi vida por el <strong style={{ color: "#e0a0b8" }}>cara tatuada</strong></div>

      <div className="home-main-section" style={{ marginTop: 10 }}>
        <div className="home-left">
          <div className="section-header" style={{ fontSize: 13 }}>ACLARACIONES;!</div>
          <p style={{ color: "#b08090", fontSize: 11, margin: "4px 0 8px", lineHeight: 1.5 }}>
            Te recomiendo leer <strong style={{ color: "#d4849a" }}>TODAS</strong> las aclaraciones antes de realizar tu compra!
          </p>
          <button className="pink-btn" onClick={() => navigate("aclaraciones")}>
            LÉELOS AQUÍ ♡ !
          </button>
        </div>
        <div className="home-right">
          <img src="/image18.jpg" alt="Fresatanika" />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 90, flexShrink: 0 }}>
            <img src="/image19.jpg" alt="trabajos" style={{ width: "100%" }} />
          </div>
          <div>
            <div className="section-header" style={{ fontSize: 13 }}>METODOS DE PAGO;!</div>
            <p style={{ color: "#b08090", fontSize: 11, margin: "4px 0 8px", lineHeight: 1.5 }}>
              Cuento con métodos de pago casi{" "}
              <span className="pink-highlight">para cada país</span>
              {" "}— puedes verlos en el haciendo click ...
            </p>
            <button className="pink-btn" onClick={() => navigate("metodos")}>
              AQUÍ ♡ !
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, borderTop: "1px solid #3d1a2a", paddingTop: 12 }}>
        <div className="section-header" style={{ fontSize: 13 }}>MIS TRABAJOS;!</div>
        <p style={{ color: "#b08090", fontSize: 11, margin: "4px 0 10px", lineHeight: 1.5 }}>
          <strong style={{ color: "#d4849a" }}>TODOS</strong> los trabajos tienen su precio y especificación, te recomiendo leer detallada!
        </p>

        <div className="nav-tabs-grid">
          <div className="nav-tab-item" onClick={() => navigate("hechizos")}>
            <img src="/image09.jpg" alt="Hechizos" />
            <span className="nav-tab-label">HECHIZOS</span>
          </div>
          <div className="nav-tab-item" onClick={() => navigate("lecturas")}>
            <img src="/image05.jpg" alt="Lecturas" />
            <span className="nav-tab-label">LECTURAS</span>
          </div>
        </div>

        <div style={{ marginTop: 12, textAlign: "center" }}>
          <a
            className="pink-btn"
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            Consultar ♡
          </a>
        </div>
      </div>

      <div style={{ marginTop: 14, borderTop: "1px solid #3d1a2a", paddingTop: 10 }}>
        <div className="intro-symbol" style={{ fontSize: 13 }}>⋆ ⁺ ₊ ☽ <em>!</em></div>
        <div className="quote-text">si creían que éramos iguales estaban viendo un espejismo</div>
      </div>

      <div style={{ marginTop: 10, textAlign: "center" }}>
        <button className="pink-btn" onClick={() => navigate("mensualidad")}>
          MENSUALIDAD ♡
        </button>
      </div>
    </div>
  );
}
