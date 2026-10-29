'use strict';

/*
 * Panel de precios del catálogo (solo administración).
 * Devuelve un punto de montaje autónomo; assets/admin-precios.js lo inicializa
 * cuando la pestaña de catálogo aparece o se reemplaza por AJAX.
 */
function panelPrecios() {
  return '<link rel="stylesheet" href="/assets/admin-precios.css">' +
    '<section class="pp-root" data-panel-precios aria-labelledby="pp-titulo">' +
      '<header class="pp-head">' +
        '<div class="pp-head-copy">' +
          '<p class="pp-eyebrow">Catálogo &middot; Tarifas</p>' +
          '<h2 class="pp-title" id="pp-titulo">Precios de trabajos y lecturas</h2>' +
          '<p class="pp-lede">Edita COP y USD de todos los servicios, originales y administrables. Los cambios quedan en borrador hasta que revises la vista previa y confirmes. Los pedidos existentes conservan su importe.</p>' +
        '</div>' +
      '</header>' +
      '<div class="pp-mount" data-pp-mount>' +
        '<div class="pp-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>' +
        '<p class="pp-sr">Cargando precios…</p>' +
      '</div>' +
      '<noscript><p class="pp-alert pp-alert-error">Activa JavaScript para editar precios.</p></noscript>' +
    '</section>';
}

module.exports = { panelPrecios };
