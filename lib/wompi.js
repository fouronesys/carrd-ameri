'use strict';

// La consulta de transacciones requiere una llave PRIVADA, exclusivamente
// servidor-a-servidor. No reutilizar la llave pública ni el secreto de integridad.
function crearClienteWompi({ publicKey, privateKey, fetchImpl, timeoutMs = 10000, log = console } = {}) {
  const publica = String(publicKey || '').trim();
  const privada = String(privateKey || '').trim();
  const entorno = publica.startsWith('pub_prod_') ? 'production' :
    publica.startsWith('pub_test_') ? 'sandbox' : '';
  const prefijo = entorno === 'production' ? 'prv_prod_' : 'prv_test_';
  function configuracion() {
    const motivo = !entorno ? 'llave_publica_invalida' : !privada ? 'falta_WOMPI_PRIVATE_KEY' :
      !privada.startsWith(prefijo) ? 'llaves_de_ambientes_distintos' : '';
    return { entorno: entorno || 'desconocido', configurado: !motivo, motivo };
  }
  function registrar(evento, datos = {}) {
    // Nunca registrar URLs, headers, cuerpos del proveedor ni mensajes de red:
    // pueden contener credenciales o información personal.
    log.warn('[wompi]', JSON.stringify({ evento, entorno: entorno || 'desconocido', ...datos }));
  }
  function fallo(codigo, operacion, http) {
    registrar(codigo, { operacion, ...(http ? { http } : {}) });
    return Object.assign(new Error('No se pudo verificar el pago con Wompi (' + codigo + ').'), { codigo });
  }
  async function consultar(ruta, operacion) {
    const cfg = configuracion();
    if (!cfg.configurado) throw fallo(cfg.motivo, operacion);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await (fetchImpl || globalThis.fetch)('https://' + entorno + '.wompi.co/v1' + ruta, {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + privada },
        signal: controller.signal,
      });
      if (!resp.ok) throw fallo('consulta_http', operacion, resp.status);
      let json;
      try { json = await resp.json(); } catch (_) { throw fallo('respuesta_json_invalida', operacion); }
      return json && json.data;
    } catch (e) {
      if (e.codigo) throw e;
      throw fallo(controller.signal.aborted ? 'consulta_timeout' : 'consulta_red', operacion);
    } finally {
      clearTimeout(timer);
    }
  }
  async function transaccion(id) {
    if (typeof id !== 'string' || !id || id.length > 255) throw fallo('id_invalido', 'transaccion');
    const tx = await consultar('/transactions/' + encodeURIComponent(id), 'transaccion');
    if (!tx || Array.isArray(tx) || tx.id !== id || typeof tx.reference !== 'string' ||
        typeof tx.status !== 'string' || !Number.isSafeInteger(Number(tx.amount_in_cents)) ||
        typeof tx.currency !== 'string') {
      throw fallo('respuesta_transaccion_invalida', 'transaccion');
    }
    return tx;
  }
  async function porReferencia(ref) {
    try {
      const txs = await consultar('/transactions?reference=' + encodeURIComponent(ref), 'referencia');
      if (!Array.isArray(txs) || txs.some(t => !t || typeof t.id !== 'string' ||
          t.reference !== ref || typeof t.status !== 'string')) {
        throw fallo('respuesta_referencia_invalida', 'referencia');
      }
      return txs;
    } catch (_) {
      // null = estado desconocido, NUNCA equivale a "no hay pagos".
      return null;
    }
  }
  return { configuracion, transaccion, porReferencia, registrar };
}

module.exports = { crearClienteWompi };
