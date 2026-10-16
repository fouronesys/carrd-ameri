'use strict';

// The Carrd catalog remains the source of the original services and layout.
function normalizar(texto) {
  return String(texto || '').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function analizar(html, tipo) {
  const nombre = tipo === 'hechizo' ? 'hechizos' : 'lecturas';
  const inicio = html.indexOf('id="' + nombre + '-section"');
  if (inicio < 0) return { total: 0, grupos: [] };
  const fin = html.indexOf('</section>', inicio);
  const bloque = html.slice(inicio, fin);
  let total = 0;
  let grupo;
  const grupos = [];
  for (const m of bloque.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const contenido = m[1];
    if (contenido.includes('ꔫ') && !contenido.includes('$')) {
      const texto = contenido.replace(/<[^>]*>/g, '').replace(/&quot;/g, '');
      const nombreSeccion = (texto.split('ꔫ')[1] || '').trim();
      grupo = { nombre: nombreSeccion, clave: normalizar(nombreSeccion), parrafos: [] };
      grupos.push(grupo);
    }
    if (!grupo) continue;
    const servicios = [];
    for (const span of contenido.matchAll(/<span class="p">[\s\S]*?<\/span>/g)) {
      if (/\$\s*[0-9]/.test(span[0])) servicios.push({ html: span[0], orden: ++total });
    }
    if (servicios.length) grupo.parrafos.push({ inicio: inicio + m.index, html: m[0], servicios });
  }
  return { total, grupos };
}

function resumen(html, items) {
  const resultado = {};
  for (const tipo of ['hechizo', 'lectura']) {
    const base = analizar(html, tipo);
    const nuevos = items.filter(i => i.tipo === tipo);
    resultado[tipo] = {
      originales: base.total, administrables: nuevos.length, total: base.total + nuevos.length,
      siguiente: Math.max(base.total, ...nuevos.map(i => Number(i.orden) || 0)) + 1,
      secciones: base.grupos.map(g => g.nombre),
    };
  }
  return resultado;
}

function integrar(html, items, renderSpan, renderGrupo) {
  const cambios = [];
  for (const tipo of ['hechizo', 'lectura']) {
    const base = analizar(html, tipo);
    const pendientes = items.filter(i => i.tipo === tipo && i.activo !== false);
    const usados = new Set();
    for (const grupo of base.grupos) {
      const nuevos = pendientes.filter(i => normalizar(i.seccion) === grupo.clave);
      if (!grupo.parrafos.length || !nuevos.length) continue;
      nuevos.forEach(i => usados.add(i.id));
      nuevos.sort((a, b) => a.orden - b.orden || String(a.id).localeCompare(String(b.id)));
      let cursor = 0;
      grupo.parrafos.forEach((p, indice) => {
        let contenido = p.html;
        for (const original of p.servicios) {
          let antes = '';
          while (cursor < nuevos.length && nuevos[cursor].orden <= original.orden) antes += renderSpan(nuevos[cursor++]);
          contenido = contenido.replace(original.html, antes + original.html);
        }
        if (indice === grupo.parrafos.length - 1) {
          let resto = '';
          while (cursor < nuevos.length) resto += renderSpan(nuevos[cursor++]);
          contenido = contenido.replace(/<\/p>$/, resto + '</p>');
        }
        cambios.push({ inicio: p.inicio, longitud: p.html.length, html: contenido });
      });
    }
    const marcador = tipo === 'hechizo' ? '__CATALOGO_HECHIZOS__' : '__CATALOGO_LECTURAS__';
    const inicio = html.indexOf(marcador);
    if (inicio >= 0) cambios.push({ inicio, longitud: marcador.length, html: renderGrupo(pendientes.filter(i => !usados.has(i.id)), tipo) });
  }
  cambios.sort((a, b) => b.inicio - a.inicio).forEach(c => {
    html = html.slice(0, c.inicio) + c.html + html.slice(c.inicio + c.longitud);
  });
  return html;
}

module.exports = { analizar, resumen, integrar };
