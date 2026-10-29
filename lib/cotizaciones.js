'use strict';
const crypto = require('node:crypto');
const { DIVISAS } = require('./divisas');
const redondear = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fallo = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });

function identidad(item) {
  return [String(item.catalogo_id || ''), String(item.nombre || '').trim(),
    Number(item.precio_cop), Number(item.precio_usd || 0), !!item.es_adelanto, !!item.incluye_adelanto];
}
function pedido(datos) {
  return {
    items: datos.items.map(identidad),
    metodo: datos.metodo === 'transferencia' ? 'transferencia' : 'wompi',
    codigo: String(datos.codigo || '').trim(),
  };
}
function crearCotizaciones({ divisas, resolver, descuento, comision, adelanto, secreto, ahora = Date.now }) {
  const llave = secreto || crypto.randomBytes(32);
  const firmar = texto => crypto.createHmac('sha256', llave).update(texto).digest('base64url');
  async function crear(datos) {
    if (!Array.isArray(datos.items) || !datos.items.length || datos.items.length > 30) throw fallo('Elige entre 1 y 30 servicios.');
    const divisa = String(datos.divisa || 'COP').toUpperCase();
    if (!DIVISAS.some(d => d.codigo === divisa)) throw fallo('Divisa no disponible.');
    const lineas = [];
    // Autorizar primero los servicios, sin consultar tasas para peticiones inválidas.
    for (const raw of datos.items) {
      if (!raw || typeof raw !== 'object') throw fallo('Servicio inválido.');
      const item = raw.es_adelanto ? adelanto(raw) : await resolver(raw);
      if (!item) throw fallo('Un servicio cambió o ya no está disponible. Actualiza el catálogo.');
      let usd = Number(item.precio_usd), pct = 0;
      if (!Number.isFinite(usd) || usd <= 0) throw fallo('Este servicio no tiene precio base USD. Consulta antes de pagar.', 422);
      if (item.tipo === 'hechizo') pct = Number(await descuento(item, datos.codigo || '')) || 0;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw fallo('Descuento inválido.');
      usd = redondear(usd * (1 - pct / 100));
      if (raw.incluye_adelanto) {
        if (item.tipo !== 'hechizo') throw fallo('El adelanto solo se puede añadir a un hechizo.');
        usd = redondear(usd + Number(adelanto().precio_usd));
      }
      lineas.push({ nombre: item.nombre, usd, base_usd: Number(item.precio_usd),
        tipo: item.tipo === 'lectura' ? 'lectura' : 'trabajo', descuento_pct: pct });
    }
    const fx = await divisas.obtener();
    for (const linea of lineas) {
      linea.cop = Math.round(linea.usd * fx.tasas.COP);
      linea.base_cop = Math.round(linea.base_usd * fx.tasas.COP);
      if (!Number.isSafeInteger(linea.cop) || linea.cop <= 0) throw fallo('El importe no es válido.');
    }
    const subtotal = lineas.reduce((s, l) => s + l.cop, 0);
    const solicitado = pedido(datos);
    const total = solicitado.metodo === 'wompi' ? comision(subtotal) : subtotal;
    if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(total * 100)) throw fallo('Importe fuera de rango.');
    // Distribuir el redondeo acumulado mantiene filas + comisión = total,
    // usando exclusivamente la misma instantánea que firma el importe COP.
    const precision = ['COP', 'CLP', 'PYG'].includes(divisa) ? 1 : 100;
    const tasaVista = fx.tasas[divisa] / fx.tasas.COP;
    const unidades = cop => Math.round(cop * tasaVista * precision);
    let acumulado = 0, previo = 0;
    for (const linea of lineas) {
      acumulado += linea.cop;
      const siguiente = unidades(acumulado);
      linea.importe_divisa = (siguiente - previo) / precision;
      previo = siguiente;
    }
    const subtotalVista = unidades(subtotal), totalVista = unidades(total);
    const expira = Math.min(ahora() + 15 * 60000, Date.parse(fx.vigente_hasta));
    const contenido = { version: 1, pedido: solicitado, items: lineas, subtotal_cop: subtotal, total_cop: total,
      divisa, total_divisa: totalVista / precision, subtotal_divisa: subtotalVista / precision,
      comision_divisa: (totalVista - subtotalVista) / precision, tasa_divisa: fx.tasas[divisa],
      tasa_cop: fx.tasas.COP, actualizado_en: fx.actualizado_en, expires_at: new Date(expira).toISOString() };
    const texto = Buffer.from(JSON.stringify(contenido)).toString('base64url');
    return { ok: true, ...contenido, token: texto + '.' + firmar(texto) };
  }
  function validar(token, datos) {
    if (typeof token !== 'string' || token.length > 60000) throw fallo('Revisa el total antes de pagar.', 409);
    const [texto, firma, extra] = token.split('.');
    if (!texto || !firma || extra) throw fallo('La cotización no es válida. Actualiza el total.', 409);
    const esperado = Buffer.from(firmar(texto)), recibido = Buffer.from(firma);
    if (esperado.length !== recibido.length || !crypto.timingSafeEqual(esperado, recibido)) throw fallo('La cotización no es válida.', 409);
    let cotizacion;
    try { cotizacion = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8')); } catch { throw fallo('Cotización inválida.', 409); }
    if (cotizacion.version !== 1 || Date.parse(cotizacion.expires_at) <= ahora() ||
      !Number.isFinite(Date.parse(cotizacion.expires_at)) || JSON.stringify(cotizacion.pedido) !== JSON.stringify(pedido(datos))) {
      throw fallo('El total venció o cambió el pedido. Revisa una nueva cotización antes de pagar.', 409);
    }
    return cotizacion;
  }
  return { crear, validar };
}
function datosBooking(b) {
  return { metodo: b.metodo, codigo: b.codigo || '', items: [{
    catalogo_id: b.catalogo_id || '', nombre: b.producto, precio_cop: b.precio_cop,
    precio_usd: b.precio_usd, es_adelanto: b.adelanto === 'solo',
    incluye_adelanto: String(b.incluye_adelanto || '') === '1',
  }] };
}
function huellaCotizacion(c) {
  return { base_divisa: 'USD', tasa_usd_cop: c.tasa_cop, tasa_actualizada_en: c.actualizado_en,
    cotizacion_vence_en: c.expires_at, divisa_vista: c.divisa };
}
module.exports = { crearCotizaciones, datosBooking, huellaCotizacion };
