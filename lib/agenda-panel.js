'use strict';

const TAMANO_PAGINA = 15;
const ESTADOS = ['todos', 'agendado', 'pendiente_verificacion', 'pendiente_pago', 'rechazado'];
const { tipoPanel } = require('./tipo-servicio');
const { esAdelantoIndependiente, sqlAdelantoIndependiente } = require('./adelanto-independiente');

// Un recargo conserva su registro y su valor, pero no es otro servicio entregable.
const SERVICIO_ENTREGABLE_SQL = `(NOT ${sqlAdelantoIndependiente()})`;
function esServicioEntregable(registro) { return !esAdelantoIndependiente(registro); }
function estaEnAgenda(registro) {
  return !registro.eliminado_en && (!registro.trabajo_hecho || !esServicioEntregable(registro));
}
const ADELANTO_PRIORITARIO_SQL = `(data->>'adelanto' = 'incluido' OR (${SERVICIO_ENTREGABLE_SQL} AND data->>'adelanto_vinculado_activo' = 'true')) AND data->>'estado' = 'agendado'`;
const ADELANTO_FILTRO_SQL = `((${ADELANTO_PRIORITARIO_SQL}) OR (${sqlAdelantoIndependiente()} AND data->>'estado' = 'agendado'))`;
function esAdelantoPrioritario(registro) {
  return (registro.adelanto === 'incluido' ||
    (!esAdelantoIndependiente(registro) && registro.adelanto_vinculado_activo === true)) &&
    registro.estado === 'agendado' && !registro.trabajo_hecho && !registro.eliminado_en;
}
function coincideFiltroAdelanto(registro) {
  return esAdelantoPrioritario(registro) ||
    (esAdelantoIndependiente(registro) && registro.estado === 'agendado' && !registro.eliminado_en);
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

module.exports = { opcionesAgenda, esAdelantoPrioritario, coincideFiltroAdelanto, ADELANTO_PRIORITARIO_SQL, ADELANTO_FILTRO_SQL,
  esServicioEntregable, estaEnAgenda, SERVICIO_ENTREGABLE_SQL };
