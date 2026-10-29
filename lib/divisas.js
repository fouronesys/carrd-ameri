'use strict';

const DIVISAS = [
  ['COP', 'Peso colombiano'], ['USD', 'Dólar estadounidense'], ['EUR', 'Euro'],
  ['MXN', 'Peso mexicano'], ['PEN', 'Sol peruano'], ['DOP', 'Peso dominicano'],
  ['ARS', 'Peso argentino'], ['BRL', 'Real brasileño'], ['CLP', 'Peso chileno'],
  ['PYG', 'Guaraní paraguayo'], ['VES', 'Bolívar venezolano'],
].map(([codigo, nombre]) => ({ codigo, nombre }));

function crearDivisas({ fetchImpl = (...args) => fetch(...args), ahora = Date.now } = {}) {
  let cache = null, enCurso = null, reintentarEn = 0;
  async function obtener() {
    if (cache && ahora() < cache.vigente) return cache.publico;
    if (enCurso) return enCurso;
    if (ahora() < reintentarEn) throw new Error('La conversión de divisas no está disponible. Intenta nuevamente en unos minutos.');
    enCurso = (async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 8000);
      try {
        const r = await fetchImpl('https://open.er-api.com/v6/latest/USD', { signal: abort.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('proveedor');
        const d = await r.json();
        const fecha = Number(d.time_last_update_unix) * 1000;
        if (d.result !== 'success' || d.base_code !== 'USD' || !Number.isFinite(fecha) ||
          fecha > ahora() + 300000 || ahora() - fecha > 36 * 3600000 || Number(d.rates?.USD) !== 1) throw new Error('tasas');
        const tasas = {};
        for (const { codigo } of DIVISAS) {
          const tasa = Number(d.rates?.[codigo]);
          if (!Number.isFinite(tasa) || tasa <= 0 || tasa > 1e9) throw new Error('divisa');
          tasas[codigo] = tasa;
        }
        // Nunca usar una tasa obsoleta para cobrar. La fuente actualiza a diario.
        const vigente = Math.min(fecha + 36 * 3600000, ahora() + 24 * 3600000);
        const publico = { base: 'USD', tasas, divisas: DIVISAS,
          actualizado_en: new Date(fecha).toISOString(), vigente_hasta: new Date(vigente).toISOString(),
          fuente: 'https://www.exchangerate-api.com' };
        cache = { publico, vigente };
        return publico;
      } catch {
        reintentarEn = ahora() + 60000;
        throw new Error('No pudimos obtener una tasa de cambio vigente. Intenta nuevamente; no se ha registrado ningún pago.');
      } finally { clearTimeout(timer); }
    })();
    try { return await enCurso; } finally { enCurso = null; }
  }
  return { obtener };
}

module.exports = { DIVISAS, crearDivisas };
