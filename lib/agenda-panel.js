'use strict';

const TAMANO_PAGINA = 15;
const ESTADOS = ['todos', 'agendado', 'pendiente_verificacion', 'pendiente_pago', 'rechazado'];

function opcionesAgenda(opciones = {}) {
  const numero = Number(opciones.pagina);
  return {
    pagina: Number.isSafeInteger(numero) && numero > 0 ? Math.min(numero, 1000000) : 1,
    buscar: typeof opciones.buscar === 'string' ? opciones.buscar.trim().slice(0, 200) : '',
    estado: ESTADOS.includes(opciones.estado) ? opciones.estado : 'todos',
    tamano: TAMANO_PAGINA,
  };
}

module.exports = { opcionesAgenda };
