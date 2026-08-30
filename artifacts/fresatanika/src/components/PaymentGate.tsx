import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import AclaracionesContent from "./AclaracionesContent";
import { startWompiCheckout } from "../lib/wompi";

interface PendingPayment {
  priceString: string;
  itemName: string;
}

interface PaymentGateContextValue {
  requestPayment: (payment: PendingPayment) => void;
}

const PaymentGateContext = createContext<PaymentGateContextValue | null>(null);

const SESSION_KEY = "fresatanika_acl_aceptadas";

export function usePaymentGate(): PaymentGateContextValue {
  const ctx = useContext(PaymentGateContext);
  if (!ctx) throw new Error("usePaymentGate debe usarse dentro de <PaymentGateProvider>");
  return ctx;
}

export function PaymentGateProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [processing, setProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const proceed = useCallback(async (payment: PendingPayment) => {
    setProcessing(true);
    try {
      await startWompiCheckout(payment);
    } finally {
      setProcessing(false);
    }
  }, []);

  const requestPayment = useCallback(
    (payment: PendingPayment) => {
      if (sessionStorage.getItem(SESSION_KEY) === "1") {
        void proceed(payment);
        return;
      }
      setReachedEnd(false);
      setAccepted(false);
      setPending(payment);
    },
    [proceed],
  );

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setReachedEnd(true);
    }
  };

  const close = useCallback(() => {
    setProcessing((p) => {
      if (!p) setPending(null);
      return p;
    });
  }, []);

  // When the modal opens, if the content fits without scrolling there is nothing
  // to scroll through, so unlock the checkbox immediately. Also re-check on resize.
  useEffect(() => {
    if (!pending) return;
    const check = () => {
      const el = scrollRef.current;
      if (el && el.scrollHeight <= el.clientHeight + 24) setReachedEnd(true);
    };
    const raf = requestAnimationFrame(check);
    window.addEventListener("resize", check);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", check);
      window.removeEventListener("keydown", onKey);
    };
  }, [pending, close]);

  const confirm = async () => {
    if (!pending || !accepted || !reachedEnd) return;
    sessionStorage.setItem(SESSION_KEY, "1");
    const payment = pending;
    setPending(null);
    await proceed(payment);
  };

  return (
    <PaymentGateContext.Provider value={{ requestPayment }}>
      {children}
      {pending && (
        <div className="acl-modal-overlay" onClick={close}>
          <div className="acl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="acl-modal-header">
              <span>Antes de pagar, lee las aclaraciones</span>
              <button className="acl-modal-close" onClick={close} aria-label="Cerrar" disabled={processing}>
                ×
              </button>
            </div>
            <p className="acl-modal-sub">
              Estás por pagar <strong>{pending.itemName}</strong>. Lee todo hasta el final para poder continuar.
            </p>
            <div className="acl-modal-scroll" ref={scrollRef} onScroll={handleScroll}>
              <AclaracionesContent />
              <div className="acl-modal-endmark">— fin de las aclaraciones —</div>
            </div>
            {!reachedEnd && <div className="acl-modal-hint">↓ desliza hasta el final para continuar</div>}
            <label className={`acl-modal-accept ${reachedEnd ? "" : "is-disabled"}`}>
              <input
                type="checkbox"
                checked={accepted}
                disabled={!reachedEnd}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>He leído y acepto todas las aclaraciones</span>
            </label>
            <div className="acl-modal-actions">
              <button className="pay-btn pay-btn-secondary" onClick={close} disabled={processing}>
                cancelar
              </button>
              <button className="pay-btn" onClick={confirm} disabled={!accepted || !reachedEnd || processing}>
                {processing ? "..." : "continuar al pago ♡"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PaymentGateContext.Provider>
  );
}
