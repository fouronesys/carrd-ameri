'use strict';

function panelAdelanto({ adelanto, actual, candidatos, servicioActual }, escapar) {
  const e = escapar;
  const descripcion = r => e(r.producto || 'Servicio') + ' · ' + e(r.ref) +
    (r.pedido_ref ? ' · Pedido ' + e(r.pedido_ref) : '');
  return '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><title>Vincular adelanto — Fresatanika</title>' +
    '<style>body{margin:0;background:#100109;color:#f4e6ee;font:16px/1.6 system-ui,sans-serif}' +
    'main{max-width:720px;margin:5vh auto;padding:28px;background:#1a0710;border:1px solid #7D3754;border-radius:14px}' +
    'h1,a{color:#F0A3C3}h1{font-size:25px}label{display:block;font-weight:bold}' +
    'select,button{font:inherit;padding:12px;border:1px solid #C2A7B7;border-radius:7px;background:#100109;color:#f4e6ee}' +
    'select{display:block;width:100%;margin:12px 0 20px}button{background:#7D3754;cursor:pointer}' +
    'p{overflow-wrap:anywhere}small{color:#c9a9ba}@media(max-width:760px){main{margin:16px;padding:20px}}</style></head><body><main>' +
    '<a href="/admin?tab=agenda&amp;tipo=todos">Volver a la agenda</a>' +
    '<h1>Vincular adelanto independiente</h1><p>' + descripcion(adelanto) + '</p>' +
    '<p>Comprador: <strong>' + e(adelanto.cliente_nombre || 'Sin nombre') + '</strong> · ' +
    (adelanto.cliente_id ? 'Cuenta registrada' : 'Invitado: solo se permite el mismo pedido') + '</p>' +
    '<p>Vinculación actual: <strong>' + (actual ? (servicioActual ? descripcion(servicioActual) : e(actual)) : 'Sin servicio asociado') + '</strong></p>' +
    '<p>Solo se muestran servicios pagados y activos del mismo comprador, sin adelanto incluido ni otra vinculación. ' +
    'No se crean servicios ni se modifican precios o pagos. Cada adelanto puede priorizar un solo servicio.</p>' +
    '<form method="POST" action="/admin/adelanto/' + encodeURIComponent(adelanto.ref) + '">' +
    '<input type="hidden" name="anterior" value="' + e(actual) + '">' +
    '<label for="servicio_ref">Servicio que debe priorizarse</label>' +
    '<select id="servicio_ref" name="servicio_ref"><option value="">Sin vinculación / desvincular</option>' +
    (actual && !candidatos.some(r => r.ref === actual)
      ? '<option value="' + e(actual) + '" selected disabled>' + e(actual) + ' · no disponible; puedes desvincularlo</option>' : '') +
    candidatos.map(r => '<option value="' + e(r.ref) + '"' + (actual === r.ref ? ' selected' : '') + '>' +
      descripcion(r) + '</option>').join('') + '</select>' +
    '<button type="submit">Guardar vinculación</button></form>' +
    (!candidatos.length ? '<p>No hay servicios disponibles para vincular.</p>' : '') +
    '<p><small>La prioridad solo se mantiene mientras ambos pagos estén confirmados y ambos registros sigan activos. ' +
    'Una asociación inactiva se conserva hasta que el administrador la cambie o la quite.</small></p>' +
    '</main></body></html>';
}

module.exports = { panelAdelanto };
