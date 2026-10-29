'use strict';

// No inferir identidades por nombres o teléfonos compartidos. Una cuenta
// identifica al comprador; un pedido permite agrupar invitados sin cuenta.
const CLAVE_CLIENTE_SQL = `coalesce(
  'cliente:' || nullif(btrim(data->>'cliente_id'), ''),
  'pedido:' || nullif(btrim(data->>'pedido_ref'), ''),
  'servicio:' || ref
)`;

function claveCliente(registro) {
  const cliente = String(registro.cliente_id || '').trim();
  const pedido = String(registro.pedido_ref || '').trim();
  return cliente ? 'cliente:' + cliente : pedido ? 'pedido:' + pedido : 'servicio:' + registro.ref;
}

function agruparClientes(registros) {
  const grupos = new Map();
  for (const registro of registros) {
    const clave = claveCliente(registro);
    if (!grupos.has(clave)) grupos.set(clave, { registros: [] });
    grupos.get(clave).registros.push(registro);
  }
  return [...grupos.values()];
}

module.exports = { CLAVE_CLIENTE_SQL, claveCliente, agruparClientes };
