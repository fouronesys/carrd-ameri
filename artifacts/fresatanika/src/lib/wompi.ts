import { parsePriceCop } from "./catalog";

interface CheckoutResponse {
  checkoutUrl?: string;
  reference?: string;
  error?: string;
  missingSecrets?: string[];
}

export async function startWompiCheckout(opts: {
  priceString: string;
  itemName: string;
}): Promise<void> {
  const amountCop = parsePriceCop(opts.priceString);
  if (amountCop <= 0) {
    alert("No pudimos calcular el precio de este servicio. Contáctame por WhatsApp ♡");
    return;
  }

  try {
    const res = await fetch("/api/wompi/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCop, itemName: opts.itemName }),
    });

    const data: CheckoutResponse = await res.json();

    if (!res.ok || !data.checkoutUrl) {
      const msg =
        data.error ??
        "No pudimos iniciar el pago en este momento. Intenta más tarde o contáctame por WhatsApp ♡";
      alert(msg);
      return;
    }

    window.location.href = data.checkoutUrl;
  } catch (err) {
    console.error(err);
    alert(
      "No pudimos conectar con la pasarela de pago. Revisa tu conexión o contáctame por WhatsApp ♡",
    );
  }
}
