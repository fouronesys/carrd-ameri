import { Router, type IRouter, type Request } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const router: IRouter = Router();

const CheckoutBody = z.object({
  amountCop: z.number().int().positive(),
  itemName: z.string().min(1).max(120),
  site: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});

const PaymentLinkBody = z.object({
  amountCop: z.number().int().positive().max(50_000_000),
  itemName: z.string().min(1).max(120),
  site: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  returnUrl: z.string().url().optional(),
});

interface WompiConfig {
  publicKey: string;
  integritySecret: string;
}

function getWompiConfig(): WompiConfig | { missing: string[] } {
  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
  const missing: string[] = [];
  if (!publicKey) missing.push("WOMPI_PUBLIC_KEY");
  if (!integritySecret) missing.push("WOMPI_INTEGRITY_SECRET");
  if (missing.length) return { missing };
  return { publicKey: publicKey!, integritySecret: integritySecret! };
}

function getLinkHmacKey(integritySecret: string): Buffer {
  return createHash("sha256").update(`payment-link:${integritySecret}`).digest();
}

function getOrigin(req: Request): string {
  // Explicit override for production (e.g. CapRover): PUBLIC_ORIGIN=https://tu-dominio.com
  const explicit = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const domains = process.env.REPLIT_DOMAINS?.split(",").filter(Boolean) ?? [];
  if (domains[0]) return `https://${domains[0]}`;
  return `${req.protocol}://${req.get("host")}`;
}

function defaultRedirectUrl(req: Request): string {
  return `${getOrigin(req)}/?pago=ok`;
}

interface LinkPayload {
  a: number;       // amount in COP
  i: string;       // item name
  s?: string;      // site tag
  r?: string;      // return URL
  c: number;       // created at (ms)
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function signPayload(payload: LinkPayload, integritySecret: string): string {
  const json = JSON.stringify(payload);
  const payloadPart = b64urlEncode(Buffer.from(json, "utf8"));
  const sig = createHmac("sha256", getLinkHmacKey(integritySecret)).update(payloadPart).digest();
  return `${payloadPart}.${b64urlEncode(sig)}`;
}

function verifyAndDecodeToken(token: string, integritySecret: string): LinkPayload | null {
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) return null;
  const expected = createHmac("sha256", getLinkHmacKey(integritySecret)).update(payloadPart).digest();
  let received: Buffer;
  try {
    received = b64urlDecode(sigPart);
  } catch {
    return null;
  }
  if (received.length !== expected.length) return null;
  if (!timingSafeEqual(received, expected)) return null;
  try {
    const json = b64urlDecode(payloadPart).toString("utf8");
    const parsed = JSON.parse(json) as LinkPayload;
    if (typeof parsed.a !== "number" || typeof parsed.i !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildCheckoutUrl(opts: {
  config: WompiConfig;
  amountCop: number;
  site?: string;
  returnUrl?: string;
  defaultReturnUrl: string;
}): { checkoutUrl: string; reference: string; amountInCents: number } {
  const amountInCents = opts.amountCop * 100;
  const currency = "COP";
  const sitePart = opts.site ? `${opts.site}-` : "";
  const reference = `${sitePart}${Date.now()}-${randomBytes(4).toString("hex")}`;

  const signature = createHash("sha256")
    .update(`${reference}${amountInCents}${currency}${opts.config.integritySecret}`)
    .digest("hex");

  const params = new URLSearchParams({
    "public-key": opts.config.publicKey,
    currency,
    "amount-in-cents": String(amountInCents),
    reference,
    "signature:integrity": signature,
    "redirect-url": opts.returnUrl ?? opts.defaultReturnUrl,
  });

  return {
    checkoutUrl: `https://checkout.wompi.co/p/?${params.toString()}`,
    reference,
    amountInCents,
  };
}

// ---------- Endpoints ----------

// Used by fresatanika's own React app — trusted internal call (prices come from bundled catalog).
router.post("/wompi/create-checkout", (req, res) => {
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
  }
  const cfg = getWompiConfig();
  if ("missing" in cfg) {
    return res.status(503).json({
      error: "Wompi no está configurado todavía. Agrega las llaves WOMPI_PUBLIC_KEY y WOMPI_INTEGRITY_SECRET.",
      missingSecrets: cfg.missing,
    });
  }
  const built = buildCheckoutUrl({
    config: cfg,
    amountCop: parsed.data.amountCop,
    site: parsed.data.site,
    defaultReturnUrl: defaultRedirectUrl(req),
  });
  req.log.info({ ...built, itemName: parsed.data.itemName, site: parsed.data.site }, "wompi checkout created");
  return res.json({ checkoutUrl: built.checkoutUrl, reference: built.reference });
});

// Generate a signed payment link (used by the link-generator page).
// Returns a URL whose amount/item cannot be tampered with — protected by HMAC.
router.post("/payment-links/create", (req, res) => {
  const parsed = PaymentLinkBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
  }
  const cfg = getWompiConfig();
  if ("missing" in cfg) {
    return res.status(503).json({
      error: "Wompi no está configurado todavía.",
      missingSecrets: cfg.missing,
    });
  }
  const payload: LinkPayload = {
    a: parsed.data.amountCop,
    i: parsed.data.itemName,
    c: Date.now(),
  };
  if (parsed.data.site) payload.s = parsed.data.site;
  if (parsed.data.returnUrl) payload.r = parsed.data.returnUrl;
  const token = signPayload(payload, cfg.integritySecret);
  const payUrl = `${getOrigin(req)}/api/wompi/pay/${token}`;
  req.log.info({ site: payload.s, item: payload.i, amount: payload.a }, "payment link generated");
  return res.json({ payUrl, token });
});

// Public redirect to Wompi, verified via HMAC token.
// Anyone with the URL can pay; amount/item cannot be modified without invalidating the signature.
router.get("/wompi/pay/:token", (req, res) => {
  const cfg = getWompiConfig();
  if ("missing" in cfg) {
    return res.status(503).type("html").send(htmlError(
      "Pagos no configurados",
      `Faltan las llaves: ${cfg.missing.join(", ")}.`,
    ));
  }
  const payload = verifyAndDecodeToken(req.params.token, cfg.integritySecret);
  if (!payload) {
    return res.status(400).type("html").send(htmlError(
      "Link de pago inválido",
      "Este link no es válido o fue modificado. Pídele al vendedor uno nuevo.",
    ));
  }
  const built = buildCheckoutUrl({
    config: cfg,
    amountCop: payload.a,
    site: payload.s,
    returnUrl: payload.r,
    defaultReturnUrl: defaultRedirectUrl(req),
  });
  req.log.info({ ...built, item: payload.i, site: payload.s }, "wompi pay token redirect");
  return res.redirect(302, built.checkoutUrl);
});

function htmlError(title: string, body: string): string {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>body{font-family:system-ui,sans-serif;background:#0d0509;color:#e8d5dc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}main{max-width:480px;text-align:center}h1{color:#d4849a}p{color:#b08090;line-height:1.5}</style></head><body><main><h1>${safeTitle}</h1><p>${safeBody}</p></main></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default router;
