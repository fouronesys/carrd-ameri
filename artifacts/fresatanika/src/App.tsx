import { useEffect, useState } from "react";
import Home from "./pages/Home";
import Hechizos from "./pages/Hechizos";
import Lecturas from "./pages/Lecturas";
import Aclaraciones from "./pages/Aclaraciones";
import MetodosPago from "./pages/MetodosPago";
import Mensualidad from "./pages/Mensualidad";
import Generador from "./pages/Generador";
import { PaymentGateProvider } from "./components/PaymentGate";

export type Page = "home" | "hechizos" | "lecturas" | "aclaraciones" | "metodos" | "mensualidad" | "generador";

function pageFromHash(): Page {
  const h = window.location.hash.replace(/^#/, "");
  if (h === "generador") return "generador";
  return "home";
}

export default function App() {
  const [page, setPage] = useState<Page>(() => pageFromHash());

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (p: Page) => {
    setPage(p);
    if (p === "generador") {
      if (window.location.hash !== "#generador") window.location.hash = "generador";
    } else if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <PaymentGateProvider>
    <div className="site-wrapper">
      <div className="site-card">
        <div className="site-header">
          <span className="site-header-title">Fresatanika</span>
        </div>
        <div className="site-subtitle-bar">
          <span className="site-subtitle">Welcome to sweet hell ... <em>!</em></span>
          {page !== "home" && (
            <span className="nav-link" onClick={() => navigate("home")}>
              . . . inicio ›
            </span>
          )}
          {page === "home" && (
            <span className="nav-link" onClick={() => navigate("hechizos")}>
              . . . mis trabajos aquí ›
            </span>
          )}
        </div>

        <div className="site-content">
          {page === "home" && <Home navigate={navigate} />}
          {page === "hechizos" && <Hechizos navigate={navigate} />}
          {page === "lecturas" && <Lecturas navigate={navigate} />}
          {page === "aclaraciones" && <Aclaraciones navigate={navigate} />}
          {page === "metodos" && <MetodosPago navigate={navigate} />}
          {page === "mensualidad" && <Mensualidad navigate={navigate} />}
          {page === "generador" && <Generador />}
        </div>
      </div>
    </div>
    </PaymentGateProvider>
  );
}
