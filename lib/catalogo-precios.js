'use strict';
const crypto = require('node:crypto');
const { analizar } = require('./catalogo');
const { cargarEstaticos } = require('./catalogo-compra');
const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });

function originales(html) {
  const resultado = new Map();
  for (const tipo of ['hechizo', 'lectura']) {
    for (const grupo of analizar(html, tipo).grupos) {
      for (const p of grupo.parrafos) for (const servicio of p.servicios) {
        const section = tipo === 'hechizo' ? 'hechizos-section' : 'lecturas-section';
        const item = [...cargarEstaticos('<section id="' + section + '">' + servicio.html + '</section>').values()][0];
        if (!item) continue;
        const id = 'base-' + crypto.createHash('sha256').update(JSON.stringify([tipo, item.nombre, item.precio_cop, item.precio_usd])).digest('hex').slice(0, 24);
        resultado.set(id, { ...item, id, seccion: grupo.nombre, orden: servicio.orden,
          activo: true, origen: 'original', html: servicio.html });
      }
    }
  }
  return resultado;
}

function publico(item) {
  const r = {
    id: item.id, nombre: item.nombre, tipo: item.tipo, seccion: item.seccion || '',
    origen: item.origen === 'original' ? 'original' : 'administrable',
    activo: item.activo !== false, precio_cop: Number(item.precio_cop), precio_usd: Number(item.precio_usd || 0),
    actualizado_en: item.actualizado_en || '',
  };
  return { ...r, revision: crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex') };
}

function listar(base, guardados) {
  const overrides = new Map(guardados.filter(i => i.origen === 'original').map(i => [i.id, i]));
  return [
    ...[...base.values()].map(i => publico({ ...i, ...overrides.get(i.id) })),
    ...guardados.filter(i => i.origen !== 'original' && ['hechizo', 'lectura'].includes(i.tipo)).map(publico),
  ];
}

function validarCambio(actual, cambio) {
  if (!actual || actual.revision !== cambio.revision) throw error('Un servicio cambió. Recarga la lista y revisa los precios antes de confirmar.', 409);
  if (typeof cambio.precio_cop !== 'number' || !Number.isSafeInteger(cambio.precio_cop) ||
      cambio.precio_cop < 1000 || cambio.precio_cop > 1e9) throw error('COP debe ser un entero entre 1.000 y 1.000.000.000.');
  if (typeof cambio.precio_usd !== 'number' || !Number.isFinite(cambio.precio_usd) || cambio.precio_usd < 0 ||
      cambio.precio_usd > 1e6 || Math.abs(cambio.precio_usd * 100 - Math.round(cambio.precio_usd * 100)) > 0.00001) {
    throw error('USD debe estar entre 0 y 1.000.000, con máximo dos decimales.');
  }
}

function planificar(items, cambios) {
  if (!Array.isArray(cambios) || !cambios.length || cambios.length > 500) throw error('Selecciona entre 1 y 500 servicios.');
  const mapa = new Map(items.map(i => [i.id, i])), vistos = new Set();
  return cambios.map(c => {
    if (!c || typeof c.id !== 'string' || vistos.has(c.id)) throw error('La selección contiene servicios inválidos o repetidos.');
    vistos.add(c.id);
    const actual = mapa.get(c.id);
    validarCambio(actual, c);
    if (actual.precio_cop === c.precio_cop && actual.precio_usd === c.precio_usd) throw error('La selección contiene un servicio sin cambios.');
    return { id: c.id, revision: c.revision, precio_cop: c.precio_cop, precio_usd: c.precio_usd };
  });
}

function crearConfirmaciones(secreto) {
  const llave = secreto || crypto.randomBytes(32);
  const firmar = s => crypto.createHmac('sha256', llave).update(s).digest('base64url');
  return {
    crear(cambios, usuario) {
      const expires_at = new Date(Date.now() + 10 * 60000).toISOString();
      const texto = Buffer.from(JSON.stringify({ cambios, usuario, expires_at })).toString('base64url');
      return { token: texto + '.' + firmar(texto), expires_at };
    },
    validar(token, usuario) {
      if (typeof token !== 'string' || token.length > 250000) throw error('Confirmación inválida.', 409);
      const [texto, firma, extra] = token.split('.');
      if (!texto || !firma || extra) throw error('Confirmación inválida.', 409);
      const a = Buffer.from(firmar(texto)), b = Buffer.from(firma);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw error('La vista previa fue alterada. Vuelve a revisarla.', 409);
      const d = JSON.parse(Buffer.from(texto, 'base64url').toString());
      if (d.usuario !== usuario || !(Date.parse(d.expires_at) > Date.now())) throw error('La vista previa venció. Vuelve a revisar los cambios.', 409);
      return d.cambios;
    },
  };
}

function aplicarHtml(html, base, guardados) {
  for (const item of guardados) {
    const original = base.get(item.id);
    if (item.origen !== 'original' || !original) continue;
    let span = original.html.replace(/\$\s*[0-9]{1,3}(?:\.[0-9]{3})+/, '$' + Number(item.precio_cop).toLocaleString('es-CO'))
      .replace(/([0-9]+(?:[.,][0-9]+)?)\s*USD/i, Number(item.precio_usd || 0) + ' USD');
    // Identidad estable y autoritativa; se preserva todo el contenido Carrd.
    span = span.replace('<span class="p">', '<span class="p" data-catalogo-id="' + original.id + '">');
    html = html.split(original.html).join(span);
  }
  return html;
}

module.exports = { originales, publico, listar, validarCambio, planificar, crearConfirmaciones, aplicarHtml };
