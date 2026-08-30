import type { Page } from "../App";

interface Props {
  navigate: (p: Page) => void;
}

export default function MetodosPago({ navigate }: Props) {
  return (
    <div>
      <span className="back-link" onClick={() => navigate("home")}>{"< vuelve . . ."}</span>
      <h2 className="section-header">꣑୧・┈LINKS DE PAGO<em>!</em></h2>

      <hr className="divider" />

      <div className="payment-item">
        <div className="payment-method">BBVA México</div>
        <div className="payment-details">
          4152314395088746<br />
          Naomi Carrillo
        </div>
      </div>

      <div className="payment-item">
        <div className="payment-method">Nequi:</div>
        <div className="payment-details">
          3104462860 (Sa* Izq**)
        </div>
      </div>

      <div className="payment-item">
        <div className="payment-method">Mercado pago</div>
        <div className="payment-details">
          opacelia (Celeste Villalba)
        </div>
      </div>

      <div className="payment-item">
        <div className="payment-method">Yape</div>
        <div className="payment-details">
          964 806 000 (Andrea)
        </div>
      </div>

      <div className="payment-item">
        <div className="payment-method">Banco Popular RD</div>
        <div className="payment-details">
          Cuenta de ahorros: 844480111<br />
          Cédula: 40215343837
        </div>
      </div>

      <div className="payment-item" style={{ borderBottom: "none" }}>
        <div className="payment-method">Astropay, Paypal, Western Union y Remitly</div>
        <div className="payment-details" style={{ marginTop: 4 }}>
          <a
            href="https://vendercomprardolares.com/calculadora-comisiones-paypal.php"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            Comisión de paypal →
          </a>
        </div>
      </div>
    </div>
  );
}
