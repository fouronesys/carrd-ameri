'use strict';

// Instantánea financiera por línea, independiente de la valoración administrativa.
// La comisión se reparte por acumulados: la suma siempre coincide con el pedido.
function desdeCotizacion(c, indice = 0) {
  const previo = c.items.slice(0, indice).reduce((s, i) => s + i.cop, 0);
  const servicios = c.items[indice].cop;
  const comision = c.total_cop - c.subtotal_cop;
  const parte = Math.round((previo + servicios) * comision / c.subtotal_cop) -
    Math.round(previo * comision / c.subtotal_cop);
  return { version: 1, servicios_cop: servicios, comision_cop: parte, cobrado_cop: servicios + parte };
}

const sinCobro = () => ({ version: 1, servicios_cop: 0, comision_cop: 0, cobrado_cop: 0 });
function fiable(f) {
  return f?.version === 1 && [f.servicios_cop, f.comision_cop, f.cobrado_cop]
    .every(n => Number.isSafeInteger(n) && n >= 0) &&
    f.servicios_cop + f.comision_cop === f.cobrado_cop;
}
function resumir(registros) {
  const vistos = new Set();
  const resultado = { ingresos: 0, comisiones: 0, cobrado: 0, ingresos_sin_desglose: 0 };
  for (const r of registros) {
    if (r.estado !== 'agendado' || vistos.has(r.ref)) continue;
    vistos.add(r.ref);
    const f = r.finanzas_compra;
    if (!fiable(f)) { resultado.ingresos_sin_desglose++; continue; }
    resultado.ingresos += f.servicios_cop;
    resultado.comisiones += f.comision_cop;
    resultado.cobrado += f.cobrado_cop;
  }
  return resultado;
}

// Misma validación que en JS; no convertir null, strings ni datos incompletos a cero.
const F = "data->'finanzas_compra'";
const SQL_FIABLE = `(${F}->'version' = '1'::jsonb AND ${['servicios_cop', 'comision_cop', 'cobrado_cop'].map(k =>
  `(jsonb_typeof(${F}->'${k}') = 'number' AND ${F}->>'${k}' ~ '^[0-9]+$' AND
    (${F}->>'${k}')::numeric BETWEEN 0 AND 9007199254740991)`).join(' AND ')}
  AND (${F}->>'servicios_cop')::numeric + (${F}->>'comision_cop')::numeric = (${F}->>'cobrado_cop')::numeric)`;
// CASE protege los casts aun cuando PostgreSQL reordena predicados AND.
const SQL_VALIDADO = `CASE WHEN ${['servicios_cop', 'comision_cop', 'cobrado_cop'].map(k =>
  `${F}->>'${k}' ~ '^[0-9]+$'`).join(' AND ')} THEN coalesce(${SQL_FIABLE},false) ELSE false END`;
const SQL_RESUMEN = `
  coalesce(sum(CASE WHEN data->>'estado' = 'agendado' AND (${SQL_VALIDADO})
    THEN (${F}->>'servicios_cop')::numeric ELSE 0 END),0) AS ingresos,
  coalesce(sum(CASE WHEN data->>'estado' = 'agendado' AND (${SQL_VALIDADO})
    THEN (${F}->>'comision_cop')::numeric ELSE 0 END),0) AS comisiones,
  coalesce(sum(CASE WHEN data->>'estado' = 'agendado' AND (${SQL_VALIDADO})
    THEN (${F}->>'cobrado_cop')::numeric ELSE 0 END),0) AS cobrado,
  count(*) FILTER (WHERE data->>'estado' = 'agendado' AND NOT (${SQL_VALIDADO}))::int AS ingresos_sin_desglose`;

module.exports = { desdeCotizacion, sinCobro, fiable, resumir, SQL_RESUMEN };
