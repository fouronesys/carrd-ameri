'use strict';

const { claveCliente } = require('./agenda-clientes');

function activoPagado(r) {
  return !!r && r.estado === 'agendado' && !r.eliminado_en && !r.trabajo_hecho;
}

function errorVinculo(mensaje, status = 400) {
  return Object.assign(new Error(mensaje), { status });
}

function validarVinculo(adelanto, servicio) {
  if (!activoPagado(adelanto) || adelanto.adelanto !== 'solo') {
    throw errorVinculo('El adelanto debe ser independiente, estar pagado y seguir activo.');
  }
  if (!activoPagado(servicio) || servicio.adelanto === 'solo' || servicio.adelanto === 'incluido' ||
      servicio.ref === adelanto.ref) {
    throw errorVinculo('Selecciona un servicio pagado, activo y sin adelanto incluido.');
  }
  if (claveCliente(adelanto) !== claveCliente(servicio)) {
    throw errorVinculo('El adelanto y el servicio deben pertenecer al mismo comprador. Para invitados se exige el mismo pedido.');
  }
}

// Campos derivados, no copiados al JSON del pago: cambios de estado, entrega o
// eliminación suspenden la prioridad sin perder la asociación para corregirla.
const CAMPOS_VINCULO_SQL = `jsonb_build_object(
  'adelanto_pagado_en', (SELECT coalesce(nullif(origen.data->>'pagado_en',''), origen.data->>'creado_en')
    FROM agendamientos origen WHERE origen.data->>'adelanto_servicio_ref' = a.ref LIMIT 1),
  'adelanto_origen_ref', (SELECT origen.ref FROM agendamientos origen
    WHERE origen.data->>'adelanto_servicio_ref' = a.ref LIMIT 1),
  'adelanto_vinculado_activo', EXISTS (
    SELECT 1 FROM agendamientos origen WHERE origen.data->>'adelanto_servicio_ref' = a.ref
      AND origen.data->>'adelanto' = 'solo' AND origen.data->>'estado' = 'agendado'
      AND origen.data->>'eliminado_en' IS NULL AND coalesce(origen.data->>'trabajo_hecho','false') != 'true'
      AND coalesce('cliente:' || nullif(btrim(origen.data->>'cliente_id'),''),
        'pedido:' || nullif(btrim(origen.data->>'pedido_ref'),''), 'servicio:' || origen.ref)
        = coalesce('cliente:' || nullif(btrim(a.data->>'cliente_id'),''),
        'pedido:' || nullif(btrim(a.data->>'pedido_ref'),''), 'servicio:' || a.ref)
  ))`;

module.exports = { activoPagado, validarVinculo, errorVinculo, CAMPOS_VINCULO_SQL };
