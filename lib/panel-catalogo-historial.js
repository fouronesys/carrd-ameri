'use strict';

const { ACCIONES, CAMPOS } = require('./catalogo-historial');

function panelHistorialCatalogo(historial, esc) {
  const h = historial || { eventos: [], filtros: {}, hayMas: false };
  const f = h.filtros;
  const valor = v => v === undefined || v === null ? '—' : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v);
  function enlace(pagina) {
    const params = new URLSearchParams({ tab: 'catalogo', h_pagina: pagina });
    for (const campo of ['buscar', 'accion', 'desde', 'hasta']) {
      if (f[campo]) params.set('h_' + campo, f[campo]);
    }
    return esc('/admin?' + params + '#historial-catalogo');
  }
  const filas = h.eventos.map(e => {
    const antes = e.anterior || {}, despues = e.nuevo || {};
    const campos = Object.keys(CAMPOS).filter(k => antes[k] !== undefined || despues[k] !== undefined);
    const detalle = campos.map(k => '<tr' + (antes[k] !== despues[k] ? ' class="historial-cambio"' : '') + '><th scope="row">' +
      esc(CAMPOS[k]) + '</th><td>' + esc(valor(antes[k])) + '</td><td>' + esc(valor(despues[k])) + '</td></tr>').join('');
    return '<tr><td><time datetime="' + esc(e.fecha) + '">' + esc(e.fecha.replace('T', ' ').replace('Z', ' UTC')) + '</time></td>' +
      '<td>' + esc(e.usuario) + (e.usuario_id ? '<div class="ref">' + esc(e.usuario_id) + '</div>' : '') + '</td>' +
      '<td>' + esc(ACCIONES[e.accion] || e.accion) + '</td><td>' + esc(despues.nombre || antes.nombre || e.catalogo_id) +
      '<div class="ref">' + esc(e.catalogo_id) + '</div></td>' +
      '<td><details><summary>Ver valores anteriores y nuevos</summary><div class="tabla-wrap"><table class="historial-valores"><thead><tr>' +
      '<th>Campo</th><th>Anterior</th><th>Nuevo</th></tr></thead><tbody>' + detalle + '</tbody></table></div></details></td></tr>';
  }).join('');
  const opciones = Object.entries(ACCIONES).map(([v, label]) =>
    '<option value="' + v + '"' + (f.accion === v ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
  return '<section class="catalog-history" id="historial-catalogo" aria-labelledby="historial-titulo">' +
    '<div class="section-heading"><div><h2 id="historial-titulo">Historial de cambios del catálogo</h2>' +
    '<p>Solo administradores. Se registran los cambios realizados desde la incorporación del historial; las fechas y filtros usan UTC. No incluye cambios de promociones.</p></div></div>' +
    '<form method="GET" action="/admin#historial-catalogo" class="catalog-form-grid">' +
    '<input type="hidden" name="tab" value="catalogo">' +
    '<label class="promo-label">Buscar servicio o usuario<input class="promo-input" name="h_buscar" maxlength="160" value="' + esc(f.buscar || '') + '"></label>' +
    '<label class="promo-label">Acción<select class="promo-input" name="h_accion"><option value="">Todas las acciones</option>' + opciones + '</select></label>' +
    '<label class="promo-label">Desde (UTC)<input class="promo-input" type="date" name="h_desde" value="' + esc(f.desde || '') + '"></label>' +
    '<label class="promo-label">Hasta (UTC)<input class="promo-input" type="date" name="h_hasta" value="' + esc(f.hasta || '') + '"></label>' +
    '<div class="catalog-edit-actions"><button type="submit" class="btn-acc btn-guardar">Filtrar historial</button>' +
    '<a class="btn-acc" href="/admin?tab=catalogo#historial-catalogo">Limpiar filtros</a></div></form>' +
    '<div class="tabla-wrap"><table class="historial-tabla"><thead><tr><th>Fecha (UTC)</th><th>Administrador</th><th>Acción</th><th>Servicio</th><th>Valores</th></tr></thead>' +
    '<tbody>' + (filas || '<tr><td colspan="5" class="vacia">No hay cambios para los filtros seleccionados.</td></tr>') + '</tbody></table></div>' +
    '<nav class="catalog-edit-actions" aria-label="Páginas del historial">' +
    ((f.pagina || 1) > 1 ? '<a class="btn-acc" href="' + enlace(f.pagina - 1) + '">Anterior</a>' : '') +
    '<span>Página ' + (f.pagina || 1) + ' · Hasta 30 cambios por página</span>' +
    (h.hayMas ? '<a class="btn-acc" href="' + enlace((f.pagina || 1) + 1) + '">Siguiente</a>' : '') + '</nav></section>';
}

module.exports = { panelHistorialCatalogo };
