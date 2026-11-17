'use strict';

const ACCIONES = { asignacion: 'Asignación', cambio: 'Cambio', desvinculacion: 'Desvinculación' };

function validarActor(actor) {
  if (!actor || actor.rol !== 'admin' || typeof actor.usuario !== 'string' || !actor.usuario.trim()) {
    const error = new Error('Se requiere un usuario administrador para registrar la vinculación.');
    error.status = 403;
    throw error;
  }
}

// Solo referencias y nombres: nunca precios, credenciales, cuerpo HTTP o sesión completa.
function servicio(ref, registro) {
  return ref ? { ref, producto: typeof registro?.producto === 'string' ? registro.producto : '' } : null;
}

function evento(anterior, nuevo, actor) {
  validarActor(actor);
  return {
    accion: !nuevo ? 'desvinculacion' : anterior ? 'cambio' : 'asignacion',
    fecha: new Date().toISOString(),
    actor: {
      usuario: actor.usuario.trim().slice(0, 120),
      usuario_id: typeof actor.usuario_id === 'string' ? actor.usuario_id.slice(0, 120) : '',
      rol: 'admin',
    },
    anterior, nuevo,
  };
}

module.exports = { ACCIONES, validarActor, servicio, evento };
