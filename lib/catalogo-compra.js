'use strict';

// Resuelve la identidad y ambos precios juntos. Las banderas del navegador no
// deciden qué artículo se cobra ni si puede recibir promociones.
function textoHtml(valor) {
  return String(valor || '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ');
}

function nombreEstatico(valor) {
  const nombre = textoHtml(valor).replace(/[ෆ⟡⊹˚꒦ᶻ𝗓𐰁ೀ𖥔ꗯಎ☼𝜗᭪𐙚✩✦ᵎ]/g, '')
    .replace(/\s+/g, ' ').trim();
  return nombre.length > 60 ? nombre.slice(0, 57) + '…' : nombre;
}

function nombreExtra(contenido) {
  let t = textoHtml(contenido).replace(/\s+/g, ' ').trim();
  const bajo = t.toLowerCase();
  if (bajo.includes('urgencia')) return 'Adelanto (urgencia)';
  if (bajo.includes('velación') || bajo.includes('velacion')) return 'Velación nocturna';
  if (bajo.includes('ocultamiento')) return 'Ocultamiento';
  if (bajo.includes('velita')) return 'Velita de ansiedad';
  t = t.replace(/^[^0-9A-Za-zÁÉÍÓÚáéíóúÑñ]+/, '')
    .replace(/^si deseas (una |un )?/i, '').replace(/^si hacés /i, '')
    .split(/[,(]|\$/)[0].trim();
  if (t.length > 60) t = t.slice(0, 57) + '…';
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Extra';
}

function numero(valor) {
  const s = String(valor == null ? '' : valor).trim().replace(',', '.');
  return s === '' ? 0 : Number(s);
}

function clave(nombre, cop, usd) {
  return JSON.stringify([String(nombre || '').trim(), numero(cop), numero(usd)]);
}

function cargarEstaticos(html) {
  const mapa = new Map();
  for (const [id, tipo] of [
    ['hechizos-section', 'hechizo'],
    ['lecturas-section', 'lectura'],
    ['aclaraciones-section', 'extra'],
    ['promos-section', 'paquete'],
  ]) {
    const inicio = html.indexOf('id="' + id + '"');
    if (inicio < 0) continue;
    const fin = html.indexOf('</section>', inicio);
    const bloque = html.slice(inicio, fin < 0 ? html.length : fin);
    for (const match of bloque.matchAll(/<span class="p">([\s\S]*?)<\/span>/g)) {
      const contenido = match[1];
      const titulo = contenido.match(/<strong>([\s\S]*?)<\/strong>/);
      const cop = contenido.match(/\$\s*([0-9]{1,3}(?:\.[0-9]{3})+)/);
      const usd = textoHtml(contenido).match(/([0-9]+(?:[.,][0-9]+)?)\s*USD/i);
      if (!cop || (!titulo && tipo !== 'extra')) continue;
      const nombre = tipo === 'extra' ? nombreExtra(contenido) : nombreEstatico(titulo[1]);
      const item = {
        nombre, tipo,
        precio_cop: Number(cop[1].replace(/\./g, '')),
        precio_usd: usd ? numero(usd[1]) : 0,
        clave: tipo === 'hechizo'
          ? textoHtml(titulo[1]).replace(/[ෆ⟡⊹˚꒦ᶻ𝗓𐰁ೀ𖥔ꗯಎ☼𝜗᭪𐙚✩✦ᵎ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
          : '',
      };
      mapa.set(clave(nombre, item.precio_cop, item.precio_usd), item);
    }
  }
  return mapa;
}

async function resolverCompra(raw, estaticos, obtenerPorId) {
  const id = String(raw.catalogo_id || '').trim();
  if (!id) return estaticos.get(clave(raw.nombre, raw.precio_cop, raw.precio_usd)) || null;
  const item = await obtenerPorId(id);
  if (!item || item.activo === false) return null;
  if (String(raw.nombre || '').trim() !== item.nombre ||
      numero(raw.precio_cop) !== Number(item.precio_cop) ||
      numero(raw.precio_usd) !== Number(item.precio_usd || 0)) return null;
  return item;
}

module.exports = { cargarEstaticos, resolverCompra };
