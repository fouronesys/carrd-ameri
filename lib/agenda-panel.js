'use strict';

const TAMANO_PAGINA = 15;
const ESTADOS = ['todos', 'agendado', 'pendiente_verificacion', 'pendiente_pago', 'rechazado'];
const { tipoPanel } = require('./tipo-servicio');

// Un recargo conserva su registro y su valor, pero no es otro servicio entregable.
const SERVICIO_ENTREGABLE_SQL = "(data->>'adelanto' IS DISTINCT FROM 'solo')";
function esServicioEntregable(registro) { return registro.adelanto !== 'solo'; }
function estaEnAgenda(registro) {
  return !registro.eliminado_en && (!registro.trabajo_hecho || !esServicioEntregable(registro));
}
const ADELANTO_PRIORITARIO_SQL = "(data->>'adelanto' = 'incluido' OR (data->>'adelanto' IS DISTINCT FROM 'solo' AND data->>'adelanto_vinculado_activo' = 'true')) AND data->>'estado' = 'agendado'";
function esAdelantoPrioritario(registro) {
  return (registro.adelanto === 'incluido' ||
    (registro.adelanto !== 'solo' && registro.adelanto_vinculado_activo === true)) &&
    registro.estado === 'agendado' && !registro.trabajo_hecho && !registro.eliminado_en;
}

function opcionesAgenda(opciones = {}) {
  const numero = Number(opciones.pagina);
  return {
    pagina: Number.isSafeInteger(numero) && numero > 0 ? Math.min(numero, 1000000) : 1,
    buscar: typeof opciones.buscar === 'string' ? opciones.buscar.trim().slice(0, 200) : '',
    estado: ESTADOS.includes(opciones.estado) ? opciones.estado : 'todos',
    adelanto: opciones.adelanto === 'si' ? 'si' : 'todos',
    tipo: tipoPanel(opciones.tipo),
    tamano: TAMANO_PAGINA,
  };
}

module.exports = { opcionesAgenda, esAdelantoPrioritario, ADELANTO_PRIORITARIO_SQL,
  esServicioEntregable, estaEnAgenda, SERVICIO_ENTREGABLE_SQL };
