/* Reglas puras compartidas por el buscador público y sus pruebas. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FresaCatalogoFiltros = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function normalizar(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9$.,\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function precioCOP(t) {
    var m = t.match(/\$\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/);
    return m ? Number(m[1].replace(/[.,]/g, '')) : null;
  }
  function precioUSD(t) {
    var m = t.match(/(\d+(?:[.,]\d{1,2})?)\s*usd/i);
    return m ? Number(m[1].replace(',', '.')) : null;
  }
  function presupuesto(texto, moneda) {
    var t = String(texto || '').trim().replace(/\s/g, '').replace(/^\$/, '');
    if (!t) return null;
    if (moneda === 'cop') {
      if (!/^\d+$/.test(t) && !/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(t)) return NaN;
      var cop = Number(t.replace(/[.,]/g, ''));
      return Number.isSafeInteger(cop) ? cop : NaN;
    }
    return /^\d+(?:[.,]\d{1,2})?$/.test(t) && isFinite(Number(t.replace(',', '.')))
      ? Number(t.replace(',', '.')) : NaN;
  }
  function ordenar(items, orden, moneda) {
    return items.sort(function (a, b) {
      if (orden === 'az') return a.clave.localeCompare(b.clave, 'es') || a.idx - b.idx;
      if (orden !== 'asc' && orden !== 'desc') return a.idx - b.idx;
      var pa = a[moneda], pb = b[moneda];
      // No inventar tasas de cambio: precios ausentes van al final.
      if (pa === null && pb === null) return a.idx - b.idx;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return (orden === 'asc' ? pa - pb : pb - pa) || a.idx - b.idx;
    });
  }
  return { normalizar: normalizar, precioCOP: precioCOP, precioUSD: precioUSD, presupuesto: presupuesto, ordenar: ordenar };
});
