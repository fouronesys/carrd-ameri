/* Buscador y filtros del catálogo público (hechizos / lecturas).
   - Compatible con la carga asíncrona de botones de wompi.js.
   - Nunca clona servicios ni reescribe su innerHTML: los nodos reales se mueven a
     una vista de resultados y vuelven a su lugar exacto mediante comentarios marcadores. */
(function () {
  'use strict';
  var SECCIONES = ['hechizos-section', 'lecturas-section'];
  var uid = 0;
  var filtros = window.FresaCatalogoFiltros;
  var norm = filtros.normalizar;
  function textoPropio(el) {
    // Texto del servicio sin botones ni insignias agregadas por wompi.js.
    var out = '';
    (function rec(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.tagName === 'BUTTON' || /\bwm-/.test(c.className || '')) continue;
          if (c.tagName === 'BR') out += '\n'; else rec(c);
        }
      }
    })(el);
    return out.replace(/\u00a0/g, ' ');
  }
  function esCategoria(p) {
    var t = p.textContent || '';
    return t.indexOf('ꔫ') >= 0 && t.indexOf('$') < 0;
  }
  function nombreCategoria(p) {
    return ((p.textContent || '').split('ꔫ')[1] || '').replace(/[︶₊˚｡]/g, '').trim();
  }
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    return e;
  }

  function recolectar(sec) {
    var items = [], cats = [], actual = '';
    var nodos = sec.querySelectorAll('p, span.p');
    for (var i = 0; i < nodos.length; i++) {
      var n = nodos[i];
      if (n.tagName === 'P') {
        if (esCategoria(n)) {
          actual = nombreCategoria(n);
          if (actual && cats.indexOf(actual) < 0) cats.push(actual);
        }
        continue;
      }
      var txt = textoPropio(n);
      if (!/\$\s*\d/.test(txt)) continue;
      var s = n.querySelector('strong');
      var nombre = (s ? s.textContent : txt.split('\n')[0]).replace(/\u00a0/g, ' ')
        .replace(/^[^A-Za-zÀ-ÿ0-9¿¡]+/, '').replace(/[ᵎ\s]+$/, '').trim();
      items.push({
        node: n, idx: items.length, cat: actual, nombre: nombre,
        hay: norm(txt + ' ' + actual), clave: norm(nombre),
        cop: filtros.precioCOP(txt), usd: filtros.precioUSD(txt)
      });
    }
    return { items: items, cats: cats };
  }

  var ORN = '<svg class="fsb-orn" viewBox="0 0 120 12" aria-hidden="true" focusable="false">' +
    '<path d="M0 6h48M72 6h48" stroke="currentColor" stroke-width=".8"/>' +
    '<path d="M60 1l3.2 5L60 11l-3.2-5z" fill="currentColor"/>' +
    '<circle cx="50" cy="6" r="1.2" fill="currentColor"/><circle cx="70" cy="6" r="1.2" fill="currentColor"/></svg>';
  var LUPA = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  function montar(sec) {
    var hr = sec.querySelector('hr');
    if (!hr || sec.querySelector('.fsb-panel')) return;
    var datos = recolectar(sec);
    if (!datos.items.length) return;
    var id = 'fsb' + (++uid);
    var tipo = sec.id.indexOf('hechizo') === 0 ? 'hechizos' : 'lecturas';

    var panel = el('div', 'fsb-panel', { role: 'search', 'aria-label': 'Buscar ' + tipo });
    panel.innerHTML =
      '<div class="fsb-head">' + ORN + '<p class="fsb-title">Buscar ' + tipo + '</p>' + ORN + '</div>' +
      '<label class="fsb-label" for="' + id + '-q">Nombre, intención o palabra clave</label>' +
      '<div class="fsb-qwrap">' + LUPA +
      '<input id="' + id + '-q" class="fsb-input fsb-q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="ej. amor, limpieza, tiempo">' +
      '<button type="button" class="fsb-x" aria-label="Borrar búsqueda" hidden>&times;</button></div>' +
      '<div class="fsb-grid">' +
      '<div class="fsb-field fsb-wide"><label class="fsb-label" for="' + id + '-c">Categoría</label>' +
      '<select id="' + id + '-c" class="fsb-input fsb-c"><option value="">Todas las categorías</option></select></div>' +
      '<div class="fsb-field"><label class="fsb-label" for="' + id + '-m">Presupuesto máx.</label>' +
      '<div class="fsb-budget"><input id="' + id + '-m" class="fsb-input fsb-m" type="text" inputmode="decimal" autocomplete="off" placeholder="Sin límite" aria-describedby="' + id + '-error">' +
      '<select class="fsb-input fsb-cur" aria-label="Moneda del presupuesto y ordenación"><option value="cop">COP</option><option value="usd">USD</option></select></div>' +
      '<p id="' + id + '-error" class="fsb-budget-error" hidden role="status"></p></div>' +
      '<div class="fsb-field"><label class="fsb-label" for="' + id + '-s">Ordenar</label>' +
      '<select id="' + id + '-s" class="fsb-input fsb-s"><option value="orig">Orden original</option><option value="asc">Precio: menor a mayor</option><option value="desc">Precio: mayor a menor</option><option value="az">Nombre: A–Z</option></select></div>' +
      '</div>' +
      '<p class="fsb-note">Precios base, sin comisión. Se ordenan en la moneda elegida; los servicios sin precio en ella aparecen al final.</p>' +
      '<div class="fsb-foot"><p class="fsb-count" aria-live="polite" aria-atomic="true"></p>' +
      '<button type="button" class="fsb-reset" disabled>Limpiar filtros</button></div>';

    var sel = panel.querySelector('.fsb-c');
    datos.cats.forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
    });

    var res = el('div', 'fsb-results', { id: id + '-r', role: 'list', 'aria-label': 'Resultados' });
    var vacio = el('div', 'fsb-empty', { hidden: '' });
    vacio.innerHTML = ORN + '<p>Nada coincide con esos filtros.</p><button type="button" class="fsb-reset fsb-reset-2">Ver todo el catálogo</button>';

    hr.parentNode.insertBefore(panel, hr.nextSibling);
    panel.parentNode.insertBefore(vacio, panel.nextSibling);
    panel.parentNode.insertBefore(res, vacio.nextSibling);

    // Marca todo el contenido original posterior para ocultarlo con filtros activos.
    var originales = [];
    var n = res.nextElementSibling;
    for (; n; n = n.nextElementSibling) originales.push(n);
    var cont = panel.parentNode;
    while (cont && cont.parentNode !== sec) cont = cont.parentNode;
    for (n = cont && cont.nextElementSibling; n; n = n.nextElementSibling) originales.push(n);
    originales.forEach(function (o) { o.classList.add('fsb-orig'); });

    var q = panel.querySelector('.fsb-q'), m = panel.querySelector('.fsb-m'),
      cur = panel.querySelector('.fsb-cur'), so = panel.querySelector('.fsb-s'),
      x = panel.querySelector('.fsb-x'), count = panel.querySelector('.fsb-count'),
      reset = panel.querySelector('.fsb-reset'), error = panel.querySelector('.fsb-budget-error');
    q.setAttribute('aria-controls', res.id);
    var movidos = []; // { node, mark }

    function restaurar() {
      movidos.forEach(function (r) {
        r.mark.parentNode.insertBefore(r.node, r.mark);
        r.mark.parentNode.removeChild(r.mark);
      });
      movidos = [];
      while (res.firstChild) res.removeChild(res.firstChild);
    }

    function aplicar() {
      datos = recolectar(sec.classList.contains('fsb-activo') ? (restaurar(), sec) : sec);
      var tokens = norm(q.value).split(' ').filter(Boolean);
      var cat = sel.value, moneda = cur.value;
      var maxTxt = m.value.trim();
      var max = filtros.presupuesto(maxTxt, moneda);
      var invalido = Number.isNaN(max);
      error.hidden = !invalido;
      error.textContent = invalido ? (moneda === 'cop' ? 'Escribe un valor COP válido, por ejemplo 50.000.' : 'Escribe un valor USD válido, por ejemplo 25,50.') : '';
      m.setAttribute('aria-invalid', String(invalido));
      if (invalido) max = null;
      var orden = so.value;
      var activo = tokens.length || cat || max !== null || orden !== 'orig';
      x.hidden = !q.value;
      reset.disabled = !(activo || maxTxt || moneda !== 'cop');
      var total = datos.items.length;
      if (!activo) {
        sec.classList.remove('fsb-activo');
        vacio.hidden = true;
        count.textContent = total + ' ' + tipo + ' en el catálogo';
        return;
      }
      var lista = datos.items.filter(function (it) {
        if (cat && it.cat !== cat) return false;
        if (max !== null) {
          var p = moneda === 'cop' ? it.cop : it.usd;
          if (p === null || p > max) return false;
        }
        for (var i = 0; i < tokens.length; i++) if (it.hay.indexOf(tokens[i]) < 0) return false;
        return true;
      });
      filtros.ordenar(lista, orden, moneda);

      lista.forEach(function (it) {
        var mark = document.createComment('fsb');
        it.node.parentNode.insertBefore(mark, it.node);
        movidos.push({ node: it.node, mark: mark });
        var fila = el('div', 'fsb-item', { role: 'listitem' });
        if (it.cat) {
          var c = el('p', 'fsb-cat'); c.textContent = it.cat; fila.appendChild(c);
        }
        fila.appendChild(it.node);
        res.appendChild(fila);
      });
      sec.classList.add('fsb-activo');
      vacio.hidden = lista.length > 0;
      count.textContent = lista.length + ' de ' + total + ' ' + tipo;
    }

    function limpiar() {
      q.value = ''; m.value = ''; sel.value = ''; so.value = 'orig'; cur.value = 'cop';
      aplicar();
    }

    q.addEventListener('input', aplicar);
    m.addEventListener('input', aplicar);
    [sel, cur, so].forEach(function (s) { s.addEventListener('change', aplicar); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; aplicar(); }
      if (e.key === 'Enter') e.preventDefault();
    });
    x.addEventListener('click', function () { q.value = ''; aplicar(); q.focus(); });
    reset.addEventListener('click', function () { limpiar(); q.focus(); });
    vacio.querySelector('button').addEventListener('click', function () { limpiar(); q.focus(); });

    sec.__fsbLimpiar = limpiar;
    sec.__fsbDesmontar = function () {
      restaurar();
      sec.classList.remove('fsb-activo');
      originales.forEach(function (o) { o.classList.remove('fsb-orig'); });
      [panel, vacio, res].forEach(function (o) { o.remove(); });
    };
    aplicar();
    panel.classList.add('fsb-listo');
  }

  function iniciar() {
    SECCIONES.forEach(function (sid) {
      var s = document.getElementById(sid);
      if (s) try { montar(s); } catch (e) {
        if (s.__fsbDesmontar) s.__fsbDesmontar();
        console.error('[catálogo] No se pudo iniciar el buscador:', e);
      }
    });
    // El acceso Premium necesita el encabezado original visible: limpia antes de bajar.
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('.fs-premium-link');
      var s = document.getElementById('hechizos-section');
      if (a && s && s.classList.contains('fsb-activo') && s.__fsbLimpiar) s.__fsbLimpiar();
    }, true);
  }

  // Los nodos reales siguen dentro de su sección aunque la respuesta de
  // promociones llegue después: Wompi encuentra y conecta los mismos servicios.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
