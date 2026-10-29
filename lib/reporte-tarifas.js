'use strict';

// Solo describe la huella guardada. Nunca consulta tasas ni convierte importes.
const NOTA_TARIFAS = 'Tarifas COP y USD independientes: el mismo servicio puede tener un coste COP distinto según la tarifa elegida. Los ingresos se suman en COP con los importes guardados, sin recalcular el histórico.';
const NOTA_HISTORICO = 'Sin metadatos: registro antiguo o sin huella de tarifa. Los datos faltantes no se deducen del importe ni de tasas actuales.';

function describirTarifa(r) {
  const texto = valor => valor === undefined || valor === null ? '' : String(valor).trim();
  const base = texto(r.base_divisa);
  const divisa = texto(r.divisa_vista);
  const tasa = texto(r.tasa_usd_cop);
  const tasaValida = tasa !== '' && Number.isFinite(Number(tasa)) && Number(tasa) > 0;
  const tarifa = ['COP', 'USD'].includes(base) ? base : (base ? 'No reconocida' : 'No registrada');
  const vista = /^[A-Z]{3}$/.test(divisa) ? divisa : (divisa ? 'No reconocida' : 'No registrada');
  const metadatos = !base && !divisa && !tasa ? 'Sin metadatos (antiguo o sin huella)' :
    (['COP', 'USD'].includes(base) && /^[A-Z]{3}$/.test(divisa) && tasaValida ? 'Registrados' : 'Metadatos incompletos');
  return {
    tarifa, vista, tasa: tasaValida ? Number(tasa) : null, metadatos,
    detalle: 'Tarifa: ' + tarifa + ' | Divisa vista: ' + vista +
      ' | Tasa USD/COP registrada: ' + (tasaValida ? tasa : 'No registrada') + ' | ' + metadatos,
  };
}

module.exports = { describirTarifa, NOTA_TARIFAS, NOTA_HISTORICO };
