/* Fresatanika — Divisas y cotizaciones (frontend)
 *
 * window.FresaDivisas
 *   listo            Promise que se resuelve tras el primer intento de cargar tasas.
 *   actual()         Divisa efectiva para mostrar (si no hay tasas: "USD", la base).
 *   preferida()      Divisa elegida por la persona (persistida en localStorage).
 *   establecer(c)    Cambia la divisa y emite el evento "fresa:divisa".
 *   disponibles()    [{codigo, nombre}] utilizables ahora mismo.
 *   convertir(usd,c) Número convertido desde la base USD, o null si no hay tasa.
 *   formato(usd,c)   Texto Intl con código claro ("MXN 520,00"). Base USD si faltan tasas.
 *   fmt(monto,c)     Formatea un monto que ya está en la divisa c (sin convertir).
 *   cotizar(data)    POST /api/cotizacion -> Promise<respuesta ok> (rechaza con Error).
 *   cotizador(cb)    Controlador de cotización: orden de respuestas, vencimiento y revisión.
 *   pintarCotizacion(el, estado, {reintentar, confirmar})
 *
 * Las tasas son de referencia diaria (no en tiempo real). El cobro real siempre es
 * en COP y lo calcula el servidor; aquí nunca se inventa una tasa.
 */
(function () {
  'use strict';

  var KEY = 'fresa_divisa_v1';
  var ADMITIDAS = ['COP', 'USD', 'EUR', 'MXN', 'PEN', 'DOP', 'ARS', 'BRL', 'CLP', 'PYG', 'VES'];
  var NOMBRES = {
    COP: 'Peso colombiano', USD: 'Dólar estadounidense', EUR: 'Euro', MXN: 'Peso mexicano',
    PEN: 'Sol peruano', DOP: 'Peso dominicano', ARS: 'Peso argentino', BRL: 'Real brasileño',
    CLP: 'Peso chileno', PYG: 'Guaraní paraguayo', VES: 'Bolívar venezolano'
  };
  var SIN_DECIMALES = { COP: 1, CLP: 1, PYG: 1 };
  var FUENTE_URL = 'https://www.exchangerate-api.com';

  var st = {
    tasas: null, divisas: [], actualizado: null, vigente: null, fuente: FUENTE_URL,
    error: '', cargando: false, preferida: leerPreferida()
  };

  function leerPreferida() {
    try {
      var c = localStorage.getItem(KEY);
      if (c && ADMITIDAS.indexOf(c) >= 0) return c;
    } catch (e) {}
    var l = String((navigator && navigator.language) || '').toLowerCase();
    var mapa = {
      'es-mx': 'MXN', 'es-pe': 'PEN', 'es-do': 'DOP', 'es-ar': 'ARS', 'pt-br': 'BRL', 'pt': 'BRL',
      'es-cl': 'CLP', 'es-py': 'PYG', 'es-ve': 'VES', 'es-es': 'EUR', 'en-us': 'USD', 'en': 'USD'
    };
    return mapa[l] || 'COP';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function aFecha(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : (/^\d+$/.test(String(v)) ? Number(v) : NaN);
    var d = isNaN(n) ? new Date(v) : new Date(n < 1e12 ? n * 1000 : n);
    return isNaN(d.getTime()) ? null : d;
  }

  function numUsd(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function hayTasas() { return !!st.tasas; }

  function actual() {
    if (hayTasas() && st.tasas[st.preferida] > 0) return st.preferida;
    return 'USD';
  }

  function disponibles() {
    if (!hayTasas()) return [{ codigo: 'USD', nombre: NOMBRES.USD }];
    var lista = (st.divisas && st.divisas.length ? st.divisas : ADMITIDAS.map(function (c) {
      return { codigo: c, nombre: NOMBRES[c] };
    }));
    return lista.filter(function (d) {
      return d && ADMITIDAS.indexOf(d.codigo) >= 0 && st.tasas[d.codigo] > 0;
    }).map(function (d) { return { codigo: d.codigo, nombre: d.nombre || NOMBRES[d.codigo] || d.codigo }; });
  }

  function convertir(usd, codigo) {
    var n = numUsd(usd);
    if (n === null) return null;
    var c = codigo || actual();
    if (c === 'USD') return n;
    if (!hayTasas() || !(st.tasas[c] > 0)) return null;
    return n * st.tasas[c];
  }

  function fmt(monto, codigo) {
    var c = codigo || actual();
    var n = Number(monto);
    if (!isFinite(n)) return '';
    var dec = SIN_DECIMALES[c] ? 0 : 2;
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: c, currencyDisplay: 'code',
        minimumFractionDigits: dec, maximumFractionDigits: dec
      }).format(n).replace(/\u00a0/g, ' ');
    } catch (e) {
      return c + ' ' + n.toFixed(dec);
    }
  }

  function formato(usd, codigo) {
    var c = codigo || actual();
    var v = convertir(usd, c);
    if (v === null) {
      var base = numUsd(usd);
      return base === null ? '' : fmt(base, 'USD');
    }
    return fmt(v, c);
  }

  function fechaReferencia() {
    var d = aFecha(st.actualizado);
    if (!d) return '';
    try { return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }

  function emitir() {
    try { window.dispatchEvent(new CustomEvent('fresa:divisa', { detail: { codigo: actual(), preferida: st.preferida, tasas: hayTasas() } })); }
    catch (e) {}
    pintarTodo();
  }

  function establecer(codigo) {
    if (ADMITIDAS.indexOf(codigo) < 0) return;
    st.preferida = codigo;
    try { localStorage.setItem(KEY, codigo); } catch (e) {}
    emitir();
  }

  function cargar() {
    st.cargando = true;
    st.error = '';
    pintarSelectores();
    return fetch('/api/divisas', { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        var t = d && d.tasas;
        if (!t || Number(t.USD) !== 1) throw new Error('Respuesta sin tasas');
        var limpias = { USD: 1 };
        ADMITIDAS.forEach(function (c) {
          var v = Number(t[c]);
          if (isFinite(v) && v > 0) limpias[c] = v;
        });
        st.tasas = limpias;
        st.divisas = Array.isArray(d.divisas) ? d.divisas : [];
        st.actualizado = d.actualizado_en || null;
        st.vigente = d.vigente_hasta || null;
        st.fuente = d.fuente || FUENTE_URL;
      })
      .catch(function () {
        st.tasas = null;
        st.error = 'No pudimos cargar las tasas de cambio. Te mostramos el precio base en USD.';
      })
      .then(function () {
        st.cargando = false;
        emitir();
      });
  }

  /* ---------- Estilos ---------- */
  function inyectarEstilos() {
    if (document.getElementById('fresa-divisas-css')) return;
    var css = [
      '.fd-sel{font-family:"Poppins",sans-serif;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;margin:0.6rem auto 0.9rem;max-width:30rem;padding:0.55rem 0.75rem;border:1px solid rgba(194,167,183,0.32);border-radius:1.4rem;background:linear-gradient(135deg,rgba(125,55,84,0.16),rgba(16,1,9,0.35));color:#e0c0cf;}',
      '.fd-lbl{font-size:11.5px;font-weight:600;letter-spacing:.04em;color:#F0A3C3;text-transform:uppercase;}',
      '.fd-wrap{position:relative;display:inline-flex;align-items:center;}',
      '.fd-select{appearance:none;-webkit-appearance:none;font-family:"Poppins",sans-serif;font-size:13px;font-weight:700;color:#fff;background:#2a1023;border:1px solid #C2A7B7;border-radius:2rem;padding:6px 30px 6px 13px;cursor:pointer;min-width:10.5rem;}',
      '.fd-select:focus-visible{outline:2px solid #F0A3C3;outline-offset:2px;}',
      '.fd-select:disabled{opacity:.6;cursor:not-allowed;}',
      '.fd-select option{background:#1a0710;color:#f4e6ee;}',
      '.fd-wrap svg{position:absolute;right:11px;width:10px;height:10px;pointer-events:none;color:#F0A3C3;}',
      '.fd-nota{flex-basis:100%;margin:0;text-align:center;font-size:10.5px;line-height:1.45;color:#b58ca1;}',
      '.fd-nota a{color:#d6b9c8;text-decoration:underline;text-underline-offset:2px;}',
      '.fd-nota.err{color:#f3b6cd;}',
      '.fd-retry{margin-left:6px;background:none;border:1px solid rgba(240,163,195,0.5);color:#F0A3C3;border-radius:1rem;font:inherit;font-weight:700;padding:1px 9px;cursor:pointer;}',
      '.fd-retry:hover{background:rgba(240,163,195,0.12);}',
      '.fd-oculto{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;border:0!important;}',
      '.wm-fd{font-weight:900;font-style:italic;letter-spacing:.01em;}',
      '.wm-fd:empty::after{content:attr(data-fd);}',
      /* Cotización */
      '.fd-cot{font-family:"Poppins",sans-serif;background:rgba(125,55,84,0.12);border:1px solid rgba(194,167,183,0.3);border-radius:10px;padding:12px 14px;margin:10px 0 14px;color:#f4e6ee;text-align:left;}',
      '.fd-cot-fila{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:#e0c0cf;padding:3px 0;}',
      '.fd-cot-fila b{color:#fff;font-weight:600;white-space:nowrap;}',
      '.fd-cot-off{display:inline-block;margin-left:5px;background:#7D3754;color:#fff;font-size:10px;font-weight:800;padding:1px 7px;border-radius:20px;}',
      '.fd-cot-sep{border:none;border-top:1px dashed rgba(194,167,183,0.3);margin:7px 0;}',
      '.fd-cot-total{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:4px;}',
      '.fd-cot-total span{font-size:12px;font-weight:700;color:#F0A3C3;text-transform:uppercase;letter-spacing:.05em;}',
      '.fd-cot-total strong{font-size:18px;font-weight:900;font-style:italic;color:#fff;}',
      '.fd-cot-eq{text-align:right;font-size:12.5px;font-weight:700;color:#F0A3C3;margin-top:1px;}',
      '.fd-cot-pie{font-size:10.5px;color:#b58ca1;line-height:1.45;margin-top:8px;}',
      '.fd-cot-carga{display:flex;flex-direction:column;gap:7px;}',
      '.fd-cot-carga i{display:block;height:10px;border-radius:6px;background:linear-gradient(90deg,rgba(194,167,183,0.12),rgba(240,163,195,0.28),rgba(194,167,183,0.12));background-size:200% 100%;animation:fdBrillo 1.2s ease-in-out infinite;}',
      '.fd-cot-carga i:nth-child(2){width:70%;}.fd-cot-carga i:nth-child(3){width:45%;margin-left:auto;height:14px;}',
      '.fd-cot-carga p{margin:2px 0 0;font-size:11px;color:#b58ca1;}',
      '@keyframes fdBrillo{0%{background-position:100% 0;}100%{background-position:-100% 0;}}',
      '@media (prefers-reduced-motion: reduce){.fd-cot-carga i{animation:none;}}',
      '.fd-cot-err{font-size:12px;color:#f3b6cd;line-height:1.45;}',
      '.fd-cot-btn{display:inline-block;margin-top:8px;background:#7D3754;color:#fff;border:1px solid #C2A7B7;border-radius:2rem;font-family:"Poppins",sans-serif;font-size:11.5px;font-weight:700;letter-spacing:.04em;padding:6px 14px;cursor:pointer;}',
      '.fd-cot-btn:hover{background:#9C4C6D;}',
      '.fd-cot-revisar{margin-top:10px;padding:10px 12px;border-radius:8px;border:1px solid rgba(240,163,195,0.55);background:rgba(240,163,195,0.1);font-size:12px;color:#f7dbe7;line-height:1.45;}',
      '.fd-cot.fd-nueva{animation:fdNueva .5s ease;}',
      '@keyframes fdNueva{0%{opacity:.4;transform:translateY(3px);}100%{opacity:1;transform:none;}}'
    ].join('');
    var el = document.createElement('style');
    el.id = 'fresa-divisas-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---------- Selector público ---------- */
  var selectores = [];
  var uid = 0;
  var CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  function montarSelector(padre, antesDe) {
    if (!padre) return null;
    var id = 'fd-sel-' + (++uid);
    var w = document.createElement('div');
    w.className = 'fd-sel';
    w.setAttribute('role', 'group');
    w.setAttribute('aria-label', 'Moneda para ver los precios');
    w.innerHTML =
      '<label class="fd-lbl" for="' + id + '">Ver precios en</label>' +
      '<span class="fd-wrap"><select id="' + id + '" class="fd-select" aria-describedby="' + id + '-n"></select>' + CHEVRON + '</span>' +
      '<p class="fd-nota" id="' + id + '-n" aria-live="polite"></p>';
    padre.insertBefore(w, antesDe || null);
    var sel = w.querySelector('select');
    sel.addEventListener('change', function () { establecer(sel.value); });
    selectores.push(w);
    pintarSelector(w);
    return w;
  }

  function pintarSelector(w) {
    var sel = w.querySelector('select');
    var nota = w.querySelector('.fd-nota');
    var lista = disponibles();
    var html = lista.map(function (d) {
      return '<option value="' + esc(d.codigo) + '">' + esc(d.codigo + ' · ' + d.nombre) + '</option>';
    }).join('');
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = actual();
    sel.disabled = st.cargando || !hayTasas();
    nota.className = 'fd-nota';
    if (st.cargando) {
      nota.textContent = 'Cargando tasas de referencia…';
    } else if (!hayTasas()) {
      nota.className = 'fd-nota err';
      nota.innerHTML = esc(st.error || 'Tasas no disponibles.') + ' El total en COP se confirma al pagar.' +
        '<button type="button" class="fd-retry">Reintentar</button>';
      nota.querySelector('.fd-retry').addEventListener('click', function () { cargar(); });
    } else {
      var f = fechaReferencia();
      nota.innerHTML = 'Tasa de referencia diaria' + (f ? ' del ' + esc(f) : '') +
        ' · <a href="' + esc(st.fuente || FUENTE_URL) + '" target="_blank" rel="noopener">Rates by ExchangeRate-API</a>' +
        '. Wompi cobra en COP; tu banco puede usar otra conversión.';
    }
  }

  function pintarSelectores() { selectores.forEach(pintarSelector); }

  /* ---------- Precios del catálogo ---------- */
  var RE_USD = /([0-9]+(?:[.,][0-9]+)?)\s*usd/i;
  var RE_COP = /\$\s*\d/;

  function decorar(p) {
    if (p.getAttribute('data-fd-hecho')) return;
    if (p.closest && p.closest('#wompi-overlay, #fc-overlay, .fsb-panel')) return;
    var txt = p.textContent || '';
    if (!RE_COP.test(txt)) return;
    var precio = null;
    var fuertes = p.querySelectorAll('strong');
    for (var i = 0; i < fuertes.length; i++) {
      if (RE_COP.test(fuertes[i].textContent || '')) { precio = fuertes[i]; break; }
    }
    p.setAttribute('data-fd-hecho', '1');
    var m = (precio ? precio.textContent : txt).match(RE_USD);
    if (!precio || !m) return; // sin precio USD: se deja el texto original intacto
    p.setAttribute('data-fd-usd', m[1].replace(',', '.'));
    var pill = document.createElement('span');
    pill.className = 'wm-fd';
    pill.setAttribute('data-fd', '');
    precio.parentNode.insertBefore(pill, precio.nextSibling);
    precio.classList.add('fd-oculto');
    precio.setAttribute('aria-hidden', 'true');
    pintarPrecio(p);
  }

  function pintarPrecio(p) {
    var pill = p.querySelector('.wm-fd');
    if (!pill) return;
    var usd = p.getAttribute('data-fd-usd');
    pill.setAttribute('data-fd', formato(usd));
    pill.setAttribute('title', 'Precio base ' + fmt(numUsd(usd), 'USD'));
  }

  function pintarInsignias() {
    var bs = document.querySelectorAll('.wm-promo-badge');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], p = b.closest && b.closest('.p');
      var pct = parseFloat((b.textContent || '').replace(/[^\d.]/g, ' ').trim().split(' ')[0]);
      if (b.getAttribute('data-fd-pct')) pct = Number(b.getAttribute('data-fd-pct'));
      else if (isFinite(pct)) b.setAttribute('data-fd-pct', String(pct));
      var usd = p && p.getAttribute('data-fd-usd');
      if (!usd || !isFinite(pct)) continue;
      b.textContent = '\u2212' + pct + '% \u2192 ' + formato(numUsd(usd) * (1 - pct / 100));
    }
  }

  function escanear() {
    var ps = document.querySelectorAll('span.p');
    for (var i = 0; i < ps.length; i++) decorar(ps[i]);
  }

  function pintarTodo() {
    pintarSelectores();
    var ps = document.querySelectorAll('[data-fd-usd]');
    for (var i = 0; i < ps.length; i++) pintarPrecio(ps[i]);
    pintarInsignias();
  }

  var tObs = null;
  function observar() {
    if (!window.MutationObserver) return;
    new MutationObserver(function () {
      clearTimeout(tObs);
      tObs = setTimeout(function () { escanear(); pintarInsignias(); }, 120);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function montarSelectoresCatalogo() {
    ['hechizos-section', 'lecturas-section'].forEach(function (sid) {
      var s = document.getElementById(sid);
      if (!s || s.querySelector('.fd-sel')) return;
      var hr = s.querySelector('hr');
      if (hr) montarSelector(hr.parentNode, hr);
    });
  }

  /* ---------- Cotizaciones ---------- */
  function cotizar(data) {
    var cuerpo = {};
    for (var k in data) cuerpo[k] = data[k];
    if (!cuerpo.divisa) cuerpo.divisa = st.preferida || 'COP';
    return fetch('/api/cotizacion', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (!r.ok || !d || !d.ok || !d.token || !(Number(d.total_cop) > 0)) {
          var msg = (d && d.error) || (r.status === 503
            ? 'El cotizador no está disponible en este momento.'
            : 'No pudimos calcular el total.');
          var e = new Error(msg);
          e.status = r.status;
          throw e;
        }
        return d;
      });
    }, function () {
      var e = new Error('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
      e.status = 0;
      throw e;
    });
  }

  var MARGEN_MS = 20000;

  function cotizador(alCambiar) {
    var seq = 0, timer = null;
    var s = { fase: 'vacia', datos: null, error: '', revisar: false, payload: null };
    function emit() { try { alCambiar(s); } catch (e) { console.error(e); } }
    function limpiarTimer() { if (timer) { clearTimeout(timer); timer = null; } }
    function vence() {
      var d = s.datos && aFecha(s.datos.expires_at);
      return d ? d.getTime() : 0;
    }
    function pedir(payload, op) {
      limpiarTimer();
      var mio = ++seq;
      var revisar = !!(op && op.revisar) || s.revisar;
      s = { fase: 'cargando', datos: null, error: '', revisar: revisar, payload: payload };
      emit();
      cotizar(payload).then(function (d) {
        if (mio !== seq) return; // respuesta vieja: se ignora
        s = { fase: 'lista', datos: d, error: '', revisar: s.revisar, payload: payload };
        var espera = Math.max(1000, vence() - Date.now() - MARGEN_MS);
        if (vence()) timer = setTimeout(function () { if (mio === seq) expirar(); }, espera);
        emit();
      }, function (e) {
        if (mio !== seq) return;
        s = { fase: 'error', datos: null, error: e.message, status: e.status, revisar: s.revisar, payload: payload };
        emit();
      });
    }
    function expirar() {
      if (!s.payload) return;
      var p = s.payload;
      s = { fase: 'expirada', datos: null, error: '', revisar: true, payload: p };
      emit();
      pedir(p, { revisar: true });
    }
    return {
      pedir: pedir,
      expirar: expirar,
      reintentar: function () { if (s.payload) pedir(s.payload); },
      estado: function () { return s; },
      listo: function () { return s.fase === 'lista' && !s.revisar && !!(s.datos && s.datos.token); },
      vigente: function () { var v = vence(); return !v || v - Date.now() > 5000; },
      token: function () { return s.datos ? s.datos.token : ''; },
      confirmarRevision: function () { s.revisar = false; emit(); },
      reiniciar: function () {
        limpiarTimer(); seq++;
        s = { fase: 'vacia', datos: null, error: '', revisar: false, payload: null };
      }
    };
  }

  function pintarCotizacion(el, s, h) {
    if (!el) return;
    h = h || {};
    var html;
    if (s.fase === 'vacia') {
      html = '';
    } else if (s.fase === 'cargando' || s.fase === 'expirada') {
      html = '<div class="fd-cot-carga" aria-busy="true"><i></i><i></i><i></i><p>' +
        (s.fase === 'expirada' ? 'La cotización venció. Actualizando el precio…' : 'Calculando tu total en COP…') + '</p></div>';
    } else if (s.fase === 'error') {
      html = '<div class="fd-cot-err" role="alert">' + esc(s.error || 'No pudimos calcular el total.') +
        ' No es posible pagar sin un total confirmado.</div>' +
        '<button type="button" class="fd-cot-btn" data-fd-accion="reintentar">Volver a calcular</button>';
    } else {
      var d = s.datos;
      var filas = (d.items || []).map(function (it) {
        var off = Number(it.descuento_pct) > 0 ? '<span class="fd-cot-off">\u2212' + esc(it.descuento_pct) + '%</span>' : '';
        return '<div class="fd-cot-fila"><span>' + esc(it.nombre) + off + '</span><b>' + esc(fmt(it.cop, 'COP')) + '</b></div>';
      }).join('');
      var comision = Number(d.total_cop) - Number(d.subtotal_cop);
      var div = d.divisa || 'COP';
      var eq = (div !== 'COP' && d.total_divisa != null && isFinite(Number(d.total_divisa)))
        ? '<div class="fd-cot-eq">\u2248 ' + esc(fmt(d.total_divisa, div)) + '</div>' : '';
      var hasta = aFecha(d.expires_at);
      var hastaTxt = hasta ? hasta.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '';
      html = filas +
        '<hr class="fd-cot-sep">' +
        '<div class="fd-cot-fila"><span>Subtotal</span><b>' + esc(fmt(d.subtotal_cop, 'COP')) + '</b></div>' +
        (comision > 0 ? '<div class="fd-cot-fila"><span>Comisión de la pasarela</span><b>' + esc(fmt(comision, 'COP')) + '</b></div>' : '') +
        '<div class="fd-cot-total"><span>Total a pagar</span><strong>' + esc(fmt(d.total_cop, 'COP')) + '</strong></div>' + eq +
        '<div class="fd-cot-pie">El cobro se realiza en pesos colombianos (COP).' +
        (eq ? ' El equivalente es de referencia; tu banco puede usar otra conversión.' : '') +
        (hastaTxt ? ' Precio reservado hasta las ' + esc(hastaTxt) + '.' : '') + '</div>' +
        (s.revisar ? '<div class="fd-cot-revisar" role="alert">Tu cotización anterior venció y actualizamos el precio. Revisa el nuevo total antes de continuar.' +
          '<br><button type="button" class="fd-cot-btn" data-fd-accion="confirmar">He revisado el nuevo total</button></div>' : '');
    }
    el.classList.add('fd-cot');
    el.style.display = html ? '' : 'none';
    el.innerHTML = html;
    if (s.fase === 'lista') { el.classList.remove('fd-nueva'); void el.offsetWidth; el.classList.add('fd-nueva'); }
    var bs = el.querySelectorAll('[data-fd-accion]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].addEventListener('click', function (e) {
        e.preventDefault();
        var a = this.getAttribute('data-fd-accion');
        if (a === 'reintentar' && h.reintentar) h.reintentar();
        if (a === 'confirmar' && h.confirmar) h.confirmar();
      });
    }
  }

  /* ---------- API pública ---------- */
  var listo = cargar();

  window.FresaDivisas = {
    listo: listo,
    actual: actual,
    preferida: function () { return st.preferida; },
    establecer: establecer,
    disponibles: disponibles,
    convertir: convertir,
    formato: formato,
    fmt: fmt,
    sinDecimales: function (c) { return !!SIN_DECIMALES[c || actual()]; },
    hayTasas: hayTasas,
    estado: function () {
      return { tasas: st.tasas, actualizado_en: st.actualizado, vigente_hasta: st.vigente, fuente: st.fuente, error: st.error, cargando: st.cargando };
    },
    reintentar: cargar,
    cotizar: cotizar,
    cotizador: cotizador,
    pintarCotizacion: pintarCotizacion,
    montarSelector: montarSelector
  };

  function iniciar() {
    inyectarEstilos();
    montarSelectoresCatalogo();
    escanear();
    observar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
