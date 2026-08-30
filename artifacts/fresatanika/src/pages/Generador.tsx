import { useState } from "react";

interface GenerateResponse {
  payUrl: string;
  token: string;
}

export default function Generador() {
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState("");
  const [site, setSite] = useState("");
  const [returnUrl, setReturnUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setCopied(false);
    const amountCop = parseInt(amount.replace(/[^\d]/g, ""), 10);
    if (!itemName.trim()) return setError("Falta el nombre del servicio.");
    if (!Number.isFinite(amountCop) || amountCop <= 0) return setError("El precio debe ser un número mayor a 0.");

    setLoading(true);
    try {
      const body: Record<string, unknown> = { itemName: itemName.trim(), amountCop };
      if (site.trim()) body.site = site.trim();
      if (returnUrl.trim()) body.returnUrl = returnUrl.trim();
      const res = await fetch("/api/payment-links/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "No se pudo generar el link.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Error de red. Revisa tu conexión.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.payUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No se pudo copiar. Copia el link manualmente.");
    }
  };

  const formatCop = (n: number) => "$" + n.toLocaleString("es-CO");
  const previewAmount = parseInt(amount.replace(/[^\d]/g, ""), 10);

  return (
    <div className="page page-generador">
      <h2>Generador de links de pago ♡</h2>
      <p className="generador-intro">
        Crea un link de pago Wompi para tu propio sitio web o Carrd. El monto va <em>firmado</em> con HMAC,
        así nadie puede cambiarlo en la URL.
      </p>

      <form className="generador-form" onSubmit={handleSubmit}>
        <label>
          <span>Nombre del servicio *</span>
          <input
            type="text"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="Ej: Lectura de tarot completa"
            maxLength={120}
            required
          />
        </label>

        <label>
          <span>Precio en COP *</span>
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="58000"
            required
          />
          {Number.isFinite(previewAmount) && previewAmount > 0 && (
            <small className="hint">= {formatCop(previewAmount)} COP</small>
          )}
        </label>

        <label>
          <span>Identificador de tu sitio <em>(opcional)</em></span>
          <input
            type="text"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="tarot-mariana"
            pattern="[a-zA-Z0-9_\-]+"
            maxLength={40}
          />
          <small className="hint">Solo letras, números, guion y guion bajo. Se ve en la referencia del pago.</small>
        </label>

        <label>
          <span>URL de retorno <em>(opcional)</em></span>
          <input
            type="url"
            value={returnUrl}
            onChange={(e) => setReturnUrl(e.target.value)}
            placeholder="https://tusitio.carrd.co/?pago=ok"
          />
          <small className="hint">A dónde vuelve el cliente después de pagar.</small>
        </label>

        <button type="submit" className="pay-btn" disabled={loading}>
          {loading ? "Generando..." : "Generar link ♡"}
        </button>
      </form>

      {error && <div className="generador-error">{error}</div>}

      {result && (
        <div className="generador-result">
          <h3>¡Tu link está listo!</h3>
          <p>Pégalo en tu botón de Carrd o compártelo por WhatsApp:</p>
          <div className="link-box">
            <code>{result.payUrl}</code>
          </div>
          <div className="result-actions">
            <button className="pay-btn" onClick={handleCopy}>
              {copied ? "¡copiado!" : "copiar link"}
            </button>
            <a className="pay-btn pay-btn-secondary" href={result.payUrl} target="_blank" rel="noreferrer">
              probar pago
            </a>
          </div>
          <details className="how-to-embed">
            <summary>¿Cómo lo uso en mi Carrd?</summary>
            <ol>
              <li>En el editor de Carrd, añade un elemento <strong>Button</strong>.</li>
              <li>En "URL", pega el link de arriba.</li>
              <li>Cambia el texto del botón a algo como "Pagar ♡ {Number.isFinite(previewAmount) ? formatCop(previewAmount) : "$XX.XXX"}".</li>
              <li>Marca "Open in new tab" si prefieres que el checkout abra en otra pestaña.</li>
            </ol>
            <p className="hint">
              Cada link es para <strong>un servicio con un precio fijo</strong>. Si tienes 5 servicios,
              genera 5 links distintos.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
