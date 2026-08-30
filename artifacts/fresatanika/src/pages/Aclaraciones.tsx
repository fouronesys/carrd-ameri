import type { Page } from "../App";
import AclaracionesContent from "../components/AclaracionesContent";

interface Props {
  navigate: (p: Page) => void;
}

export default function Aclaraciones({ navigate }: Props) {
  return (
    <div>
      <span className="back-link" onClick={() => navigate("home")}>{"< vuelve . . ."}</span>
      <h2 className="section-header">꣑୧・┈ACLARACIONES<em>!</em></h2>
      <p className="section-subheader">(Al usted pagar se asume que <strong>leyó todas las aclaraciones</strong> y las acepta. . .)</p>

      <hr className="divider" />

      <AclaracionesContent />
    </div>
  );
}
