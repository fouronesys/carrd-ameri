'use strict';

// Reutiliza los controles y colores del panel existente.
function panelNotificaciones(destinatarios, escapar) {
  function campos(email, rol) {
    return '<div class="promo-fila">' +
      '<label class="promo-label">Correo<input class="promo-input" type="email" name="email" maxlength="254" autocomplete="email" value="' + escapar(email || '') + '" required></label>' +
      '<label class="promo-label">Recibir como<select class="promo-input" name="rol">' +
      '<option value="asistente"' + (rol !== 'admin' ? ' selected' : '') + '>Asistente · operativos</option>' +
      '<option value="admin"' + (rol === 'admin' ? ' selected' : '') + '>Administrador · todos</option></select></label></div>';
  }
  const filas = destinatarios.map(d => {
    const ruta = '/admin/notificaciones/' + encodeURIComponent(d.id);
    return '<li class="promo-item notification-item">' +
      '<form method="POST" action="' + ruta + '" data-usuarios-form class="promo-form">' +
      campos(d.email, d.rol) + '<button class="btn-acc" type="submit">Guardar destinatario</button></form>' +
      '<form method="POST" action="' + ruta + '/eliminar" data-usuarios-form ' +
      'onsubmit="return confirm(\'¿Dejar de enviar avisos a este destinatario adicional?\');">' +
      '<button class="btn-acc btn-del" type="submit">Eliminar destinatario</button></form></li>';
  }).join('');
  return '<div class="promo-card">' +
    '<h3>Notificaciones por correo</h3>' +
    '<p class="promo-sub">Administradores: reservas, pedidos, entregas, seguimientos y alertas de acceso. ' +
    'Asistentes: solo reservas, pedidos, entregas y seguimientos. Los mensajes privados al cliente no se copian.</p>' +
    '<p class="promo-sub">Puedes vincular un correo a cada usuario o añadir destinatarios sin darles acceso al panel. ' +
    'El destinatario principal configurado en el servidor se conserva como administrador.</p>' +
    '<h4>Destinatarios adicionales sin acceso al panel</h4>' +
    '<form method="POST" action="/admin/notificaciones" data-usuarios-form class="promo-form">' +
    campos('', 'asistente') + '<button class="btn-exp excel promo-btn" type="submit">Añadir destinatario</button></form>' +
    '<ul class="promo-lista">' + (filas || '<li class="promo-vacio">No hay destinatarios adicionales.</li>') + '</ul>' +
    '<p class="promo-sub">Cada correo recibe una sola copia por aviso. Si también está vinculado como administrador, ' +
    'recibe alertas de acceso. Quitar un vínculo no elimina los demás.</p></div>';
}

module.exports = { panelNotificaciones };
