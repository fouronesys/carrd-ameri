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
  // Divisa global: COP original o conversión de la tarifa USD, como el catálogo.
  function D() { return window.FresaDivisas || null; }
  function monedaActual() { return D() ? D().actual() : 'USD'; }
  function convertir(usd, c, cop) {
    if (c === 'COP') return cop > 0 ? cop : null;
    if (usd === null || usd === undefined) return null;
    if (D()) return D().convertir(usd, c);
    return c === 'USD' ? usd : null;
  }
  function fmtMonto(n, c) {
    return D() ? D().fmt(n, c) : c + ' ' + n.toLocaleString('es-CO');
  }
  function sinDecimales(c) { return D() ? D().sinDecimales(c) : false; }
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
  var AJUSTES = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><path d="M3 6h14M3 14h14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="6" r="2" fill="#18070f" stroke="currentColor" stroke-width="1.3"/><circle cx="13" cy="14" r="2" fill="#18070f" stroke="currentColor" stroke-width="1.3"/></svg>';

  function montar(sec) {
    var hr = sec.querySelector('hr');
    if (!hr || sec.querySelector('.fsb-panel')) return;
    var datos = recolectar(sec);
    if (!datos.items.length) return;
    var id = 'fsb' + (++uid);
    var tipo = sec.id.indexOf('hechizo') === 0 ? 'hechizos' : 'lecturas';

    var panel = el('div', 'fsb-panel', { role: 'search', 'aria-label': 'Buscar ' + tipo });
    panel.innerHTML =
      '<div class="fsb-bar"><div class="fsb-qwrap">' + LUPA +
      '<input id="' + id + '-q" class="fsb-q" aria-label="Buscar ' + tipo + ' por nombre, intención o palabra clave" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="Busca tu intención…">' +
      '<button type="button" class="fsb-x" aria-label="Borrar búsqueda" hidden>&times;</button></div>' +
      '<button type="button" class="fsb-trigger" aria-expanded="false" aria-controls="' + id + '-filters">' + AJUSTES + '<span>Filtros</span><span class="fsb-badge" hidden></span></button></div>' +
      '<div class="fsb-meta"><p class="fsb-count" aria-live="polite" aria-atomic="true"></p>' +
      '<button type="button" class="fsb-reset" hidden>Limpiar todo</button></div>' +
      '<div class="fsb-chips" aria-label="Filtros activos" hidden></div>' +
      '<section id="' + id + '-filters" class="fsb-popover" aria-label="Filtros de ' + tipo + '" hidden>' +
      '<header class="fsb-popover-head"><h2>Afina tu búsqueda</h2><button type="button" class="fsb-close" aria-label="Cerrar filtros">&times;</button></header>' +
      '<div class="fsb-fields">' +
      '<div class="fsb-field"><label class="fsb-label" for="' + id + '-c">Categoría</label>' +
      '<select id="' + id + '-c" class="fsb-input fsb-c"><option value="">Todas las categorías</option></select></div>' +
      '<div class="fsb-field"><label class="fsb-label" for="' + id + '-m">Presupuesto máximo</label>' +
      '<div class="fsb-budget"><input id="' + id + '-m" class="fsb-input fsb-m" type="text" inputmode="decimal" autocomplete="off" placeholder="Sin límite" aria-describedby="' + id + '-error">' +
      '<select class="fsb-input fsb-cur" aria-label="Moneda de los precios, el presupuesto y la ordenación"></select></div>' +
      '<p class="fsb-help">Precio base, sin comisión. La moneda se comparte con todo el catálogo.</p><p id="' + id + '-error" class="fsb-budget-error" hidden role="status"></p></div>' +
      '<div class="fsb-field"><label class="fsb-label" for="' + id + '-s">Ordenar por</label>' +
      '<select id="' + id + '-s" class="fsb-input fsb-s"><option value="orig">Orden del catálogo</option><option value="asc">Precio: menor a mayor</option><option value="desc">Precio: mayor a menor</option><option value="az">Nombre: A–Z</option></select></div>' +
      '<p class="fsb-note"></p></div>' +
      '<footer class="fsb-popover-foot"><button type="button" class="fsb-restore" disabled>Restablecer</button><button type="button" class="fsb-apply">Ver resultados <span aria-hidden="true">→</span></button></footer></section>';

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
      reset = panel.querySelector('.fsb-reset'), error = panel.querySelector('.fsb-budget-error'),
      trigger = panel.querySelector('.fsb-trigger'), popup = panel.querySelector('.fsb-popover'),
      chips = panel.querySelector('.fsb-chips'), badge = panel.querySelector('.fsb-badge'),
      restore = panel.querySelector('.fsb-restore'), apply = panel.querySelector('.fsb-apply');
    var abierto = false, capaSuperior = typeof popup.showPopover === 'function';
    if (capaSuperior) popup.setAttribute('popover', 'manual');
    q.setAttribute('aria-controls', res.id);
    var movidos = []; // { node, mark }

    function poblarMonedas() {
      var lista = D() ? D().disponibles() : [{ codigo: 'USD', nombre: 'Dólar estadounidense' }];
      var html = lista.map(function (d) { return '<option value="' + d.codigo + '">' + d.codigo + '</option>'; }).join('');
      if (cur.innerHTML !== html) cur.innerHTML = html;
      cur.value = monedaActual();
      cur.disabled = lista.length < 2;
    }
    poblarMonedas();

    function posicionar() {
      if (!abierto || !panel.getBoundingClientRect) return;
      var barra = panel.querySelector('.fsb-bar').getBoundingClientRect();
      var vp = window.visualViewport;
      var alto = vp ? vp.height : window.innerHeight;
      var ancho = vp ? vp.width : window.innerWidth;
      var y = vp ? vp.offsetTop : 0, izquierda = vp ? vp.offsetLeft : 0;
      var w = Math.max(0, Math.min(360, barra.width, ancho - 24));
      popup.style.width = w + 'px';
      popup.style.maxHeight = Math.max(0, alto - 24) + 'px';
      var top = Math.max(y + 12, Math.min(barra.bottom + 10, y + alto - popup.getBoundingClientRect().height - 12));
      var left = Math.max(izquierda + 12, Math.min(barra.right - w, izquierda + ancho - w - 12));
      if (!capaSuperior) {
        var base = panel.getBoundingClientRect();
        top -= base.top; left -= base.left;
      }
      popup.style.top = top + 'px'; popup.style.left = left + 'px';
    }

    function cerrar(devolverFoco) {
      if (!abierto) return;
      abierto = false;
      if (capaSuperior) popup.hidePopover();
      popup.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      panel.classList.remove('fsb-open');
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('focusin', focoFuera);
      document.removeEventListener('keydown', teclado, true);
      document.removeEventListener('scroll', desplazar, true);
      window.removeEventListener('resize', posicionar);
      window.removeEventListener('hashchange', cambioSeccion);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', posicionar);
      if (devolverFoco) trigger.focus();
    }
    function fuera(e) { if (!panel.contains(e.target)) cerrar(false); }
    function focoFuera(e) { if (!panel.contains(e.target)) cerrar(false); }
    function teclado(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    }
    function desplazar(e) { if (!popup.contains(e.target)) posicionar(); }
    function cambioSeccion() { cerrar(false); }
    function abrir() {
      abierto = true; popup.hidden = false;
      if (capaSuperior) popup.showPopover();
      panel.classList.add('fsb-open');
      trigger.setAttribute('aria-expanded', 'true');
      posicionar();
      sel.focus();
      document.addEventListener('pointerdown', fuera);
      document.addEventListener('focusin', focoFuera);
      document.addEventListener('keydown', teclado, true);
      document.addEventListener('scroll', desplazar, true);
      window.addEventListener('resize', posicionar);
      window.addEventListener('hashchange', cambioSeccion);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', posicionar);
    }
    function etiqueta(texto, nombre, quitar) {
      var b = el('button', 'fsb-chip', { type: 'button', 'aria-label': nombre });
      b.appendChild(document.createTextNode(texto));
      var cruz = el('span', '', { 'aria-hidden': 'true' }); cruz.textContent = '×'; b.appendChild(cruz);
      b.addEventListener('click', function () { quitar(); aplicar(); trigger.focus(); });
      chips.appendChild(b);
    }
    function controles(cat, maxTxt, max, invalido, orden, moneda, activo) {
      chips.textContent = '';
      if (cat) etiqueta(cat, 'Quitar categoría ' + cat, function () { sel.value = ''; });
      if (maxTxt) etiqueta(invalido ? 'Revisar presupuesto' : 'Hasta ' + fmtMonto(max, moneda), 'Quitar presupuesto', function () { m.value = ''; });
      if (orden !== 'orig') etiqueta(orden === 'az' ? 'Nombre A–Z' : (orden === 'asc' ? 'Menor precio' : 'Mayor precio') + ' · ' + moneda, 'Quitar ordenación', function () { so.value = 'orig'; });
      var cuantos = chips.children.length;
      chips.hidden = !cuantos; badge.hidden = !cuantos;
      badge.textContent = cuantos;
      badge.setAttribute('aria-label', cuantos + ' filtros activos');
      reset.hidden = !activo;
      restore.disabled = !activo;
      panel.querySelector('.fsb-note').textContent = moneda === 'USD'
        ? 'Se compara en USD, el precio base. Los servicios sin precio en USD aparecen al final.'
        : 'Se compara en ' + moneda + ' convertido desde el precio base en USD con la tasa de referencia diaria. Los servicios sin precio base aparecen al final.';
      posicionar();
    }

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
      poblarMonedas();
      var cat = sel.value, moneda = monedaActual();
      var maxTxt = m.value.trim();
      var max = filtros.presupuesto(maxTxt, sinDecimales(moneda) ? 'cop' : 'usd');
      var invalido = Number.isNaN(max) || Boolean(maxTxt && max === null);
      error.hidden = !invalido;
      error.textContent = invalido ? (sinDecimales(moneda) ? 'Escribe un valor ' + moneda + ' válido, por ejemplo 50.000.' : 'Escribe un valor ' + moneda + ' válido, por ejemplo 25,50.') : '';
      m.setAttribute('aria-invalid', String(invalido));
      if (invalido) max = null;
      var orden = so.value;
      var activo = tokens.length || cat || max !== null || orden !== 'orig';
      x.hidden = !q.value;
      controles(cat, maxTxt, max, invalido, orden, moneda, Boolean(q.value || cat || maxTxt || orden !== 'orig'));
      datos.items.forEach(function (it) { it.precioSel = convertir(it.usd, moneda, it.cop); });
      var total = datos.items.length;
      if (!activo) {
        sec.classList.remove('fsb-activo');
        vacio.hidden = true;
        count.textContent = total + ' ' + tipo;
        apply.textContent = 'Ver ' + total + ' resultados →';
        return;
      }
      var lista = datos.items.filter(function (it) {
        if (cat && it.cat !== cat) return false;
        if (max !== null) {
          var p = it.precioSel;
          if (p === null || p > max) return false;
        }
        for (var i = 0; i < tokens.length; i++) if (it.hay.indexOf(tokens[i]) < 0) return false;
        return true;
      });
      filtros.ordenar(lista, orden, 'precioSel');

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
      apply.textContent = 'Ver ' + lista.length + ' resultados →';
    }

    function limpiar() {
      q.value = ''; m.value = ''; sel.value = ''; so.value = 'orig';
      aplicar();
    }

    q.addEventListener('input', aplicar);
    m.addEventListener('input', aplicar);
    [sel, so].forEach(function (s) { s.addEventListener('change', aplicar); });
    cur.addEventListener('change', function () {
      if (D()) D().establecer(cur.value); else aplicar();
    });
    // El selector global (y la carga de tasas) re-aplica filtros y orden.
    function alCambiarDivisa() { aplicar(); }
    window.addEventListener('fresa:divisa', alCambiarDivisa);
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !abierto && q.value) { e.preventDefault(); q.value = ''; aplicar(); }
      if (e.key === 'Enter') e.preventDefault();
    });
    x.addEventListener('click', function () { q.value = ''; aplicar(); q.focus(); });
    reset.addEventListener('click', function () { limpiar(); q.focus(); });
    restore.addEventListener('click', function () { limpiar(); });
    trigger.addEventListener('click', function () { if (abierto) cerrar(false); else abrir(); });
    panel.querySelector('.fsb-close').addEventListener('click', function () { cerrar(true); });
    apply.addEventListener('click', function () {
      if (m.getAttribute('aria-invalid') === 'true') { m.focus(); return; }
      cerrar(true);
    });
    vacio.querySelector('button').addEventListener('click', function () { limpiar(); q.focus(); });

    sec.__fsbLimpiar = limpiar;
    sec.__fsbDesmontar = function () {
      cerrar(false);
      window.removeEventListener('fresa:divisa', alCambiarDivisa);
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
