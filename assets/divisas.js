/* Fresatanika — Divisas y cotizaciones (frontend)
 *
 * window.FresaDivisas
 *   listo            Promise que se resuelve tras el primer intento de cargar tasas.
 *   actual()         Conserva COP sin tasas; las extranjeras usan USD como referencia.
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
    // Solo se guarda una selección explícita. La detección puede adaptarse en
    // futuras visitas y nunca sustituye una moneda que la persona ya eligió.
    var zonas = {
      COP: ['America/Bogota'],
      USD: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix',
        'America/Detroit', 'America/Indiana/Indianapolis', 'America/Indianapolis', 'America/Kentucky/Louisville',
        'America/Louisville', 'America/Boise', 'America/Anchorage', 'America/Juneau', 'America/Nome',
        'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Adak', 'Pacific/Honolulu',
        'US/Eastern', 'US/Central', 'US/Mountain', 'US/Pacific', 'US/Alaska', 'US/Hawaii',
        'America/Puerto_Rico', 'America/Guayaquil', 'Pacific/Galapagos', 'America/El_Salvador'],
      EUR: ['Europe/Madrid', 'Atlantic/Canary', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
        'Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira', 'Europe/Amsterdam', 'Europe/Brussels',
        'Europe/Luxembourg', 'Europe/Vienna', 'Europe/Dublin', 'Europe/Helsinki', 'Europe/Athens',
        'Europe/Tallinn', 'Europe/Riga', 'Europe/Vilnius', 'Europe/Bratislava', 'Europe/Ljubljana',
        'Europe/Zagreb', 'Europe/Malta', 'Asia/Nicosia', 'Asia/Famagusta', 'Europe/Nicosia',
        'Europe/Andorra', 'Europe/Monaco', 'Europe/San_Marino', 'Europe/Vatican', 'Europe/Podgorica',
        'Europe/Sofia', 'Europe/Mariehamn', 'Europe/Busingen'],
      MXN: ['America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey',
        'America/Matamoros', 'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga',
        'America/Hermosillo', 'America/Mazatlan', 'America/Bahia_Banderas', 'America/Tijuana',
        'Mexico/General', 'Mexico/BajaSur', 'Mexico/BajaNorte'],
      PEN: ['America/Lima'], DOP: ['America/Santo_Domingo'],
      ARS: ['America/Buenos_Aires', 'America/Cordoba', 'America/Catamarca', 'America/Jujuy', 'America/Mendoza'],
      BRL: ['America/Sao_Paulo', 'America/Rio_Branco', 'America/Porto_Acre', 'America/Eirunepe',
        'America/Manaus', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Cuiaba',
        'America/Campo_Grande', 'America/Belem', 'America/Fortaleza', 'America/Recife',
        'America/Araguaina', 'America/Maceio', 'America/Bahia', 'America/Santarem',
        'America/Noronha', 'Brazil/East', 'Brazil/West', 'Brazil/Acre', 'Brazil/DeNoronha'],
      CLP: ['America/Santiago', 'America/Punta_Arenas', 'America/Coyhaique', 'Pacific/Easter', 'Chile/Continental', 'Chile/EasterIsland'],
      PYG: ['America/Asuncion'], VES: ['America/Caracas']
    };
    try {
      var zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zona && zona.indexOf('America/Argentina/') === 0) return 'ARS';
      if (zona && (zona.indexOf('America/Indiana/') === 0 || zona.indexOf('America/Kentucky/') === 0 ||
        zona.indexOf('America/North_Dakota/') === 0)) return 'USD';
      for (var codigo in zonas) if (zonas[codigo].indexOf(zona) >= 0) return codigo;
    } catch (e) {}
    var regiones = {
      CO: 'COP', US: 'USD', PR: 'USD', EC: 'USD', SV: 'USD', MX: 'MXN', PE: 'PEN', DO: 'DOP', AR: 'ARS', BR: 'BRL', CL: 'CLP', PY: 'PYG', VE: 'VES',
      ES: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR', BE: 'EUR', LU: 'EUR', AT: 'EUR',
      IE: 'EUR', FI: 'EUR', GR: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', SK: 'EUR', SI: 'EUR', HR: 'EUR',
      MT: 'EUR', CY: 'EUR', AD: 'EUR', MC: 'EUR', SM: 'EUR', VA: 'EUR', ME: 'EUR', BG: 'EUR', AX: 'EUR', XK: 'EUR'
    };
    var nav = typeof navigator === 'undefined' ? {} : navigator;
    var idiomas = nav.languages && nav.languages.length ? nav.languages : [nav.language || ''];
    for (var i = 0; i < idiomas.length; i++) {
      // Acepta etiquetas con escritura y extensiones, p. ej. es-Latn-MX-u-nu-latn.
      var partes = String(idiomas[i]).replace(/_/g, '-').split('-');
      for (var j = 1; j < partes.length && partes[j].length !== 1; j++) {
        if (/^[a-z]{2}$/i.test(partes[j])) {
          var moneda = regiones[partes[j].toUpperCase()];
          if (moneda) return moneda;
          break;
        }
      }
    }
    return 'COP';
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
    if (st.preferida === 'COP') return 'COP';
    if (hayTasas() && st.tasas[st.preferida] > 0) return st.preferida;
    return 'USD';
  }

  function disponibles() {
    if (!hayTasas()) return ['COP', 'USD'].map(function (c) { return { codigo: c, nombre: NOMBRES[c] }; });
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

  // COP y USD son tarifas independientes del catálogo, no equivalencias.
  function precio(cop, usd, codigo) {
    var c = codigo || actual();
    if (c === 'COP') {
      var n = Number(cop);
      return isFinite(n) && n > 0 ? fmt(n, 'COP') : '';
    }
    if (!(numUsd(usd) > 0)) return 'No disponible en esta divisa';
    return formato(usd, c);
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
        st.error = 'No pudimos cargar las tasas de cambio. Puedes pagar con la tarifa COP original; los pagos en divisas extranjeras requieren tasas vigentes.';
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
      '.fd-wrap .fd-chev{position:absolute;right:11px;top:50%;margin-top:-5px;width:10px;height:10px;pointer-events:none;color:#F0A3C3;transition:transform .18s ease;}',
      '.fd-btn{display:inline-flex;align-items:center;gap:8px;font-family:"Poppins",sans-serif;font-size:13px;font-weight:700;color:#fff;background:#2a1023;border:1px solid #C2A7B7;border-radius:2rem;padding:6px 30px 6px 11px;cursor:pointer;min-width:10.5rem;text-align:left;}',
      '.fd-btn:focus-visible{outline:2px solid #F0A3C3;outline-offset:2px;}',
      '.fd-btn:disabled{opacity:.6;cursor:not-allowed;}',
      '.fd-btn[aria-expanded="true"] + .fd-chev{transform:rotate(180deg);}',
      '.fd-flag{display:inline-block;flex:0 0 auto;width:20px;height:14px;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,0.22);overflow:hidden;vertical-align:middle;}',
      '.fd-flag svg{display:block;width:100%;height:100%;position:static;}',
      '.fd-lista{position:absolute;z-index:60;top:calc(100% + 6px);left:0;min-width:100%;width:max-content;max-width:min(17rem,86vw);max-height:16.5rem;overflow:auto;margin:0;padding:5px;list-style:none;background:#1a0710;border:1px solid rgba(194,167,183,0.55);border-radius:12px;box-shadow:0 14px 30px rgba(16,1,9,0.55);text-align:left;}',
      '.fd-lista[hidden]{display:none;}',
      '.fd-lista:focus{outline:none;}',
      '.fd-op{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:8px;font-size:12.5px;color:#f4e6ee;cursor:pointer;}',
      '.fd-op b{font-weight:700;color:#fff;min-width:2.4em;}',
      '.fd-op span.fd-op-n{color:#d6b9c8;font-weight:400;}',
      '.fd-op.activa{background:rgba(240,163,195,0.16);outline:1px solid rgba(240,163,195,0.5);}',
      '.fd-op[aria-selected="true"] b{color:#F0A3C3;}',
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
  var CHEVRON = '<svg class="fd-chev" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  /* Banderas vectoriales locales (viewBox 30x20), sin emoji. */
  function estrellasCirculo(cx, cy, r, n, rad, color, desde, hasta) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var a = desde + (hasta - desde) * (n === 1 ? 0 : i / (desde === 0 && hasta === 360 ? n : n - 1));
      var rr = a * Math.PI / 180;
      s += '<circle cx="' + (cx + r * Math.cos(rr)).toFixed(2) + '" cy="' + (cy + r * Math.sin(rr)).toFixed(2) + '" r="' + rad + '" fill="' + color + '"/>';
    }
    return s;
  }
  var BANDERAS = {
    COP: '<rect width="30" height="10" fill="#FCD116"/><rect y="10" width="30" height="5" fill="#003893"/><rect y="15" width="30" height="5" fill="#CE1126"/>',
    USD: (function () {
      var s = '<rect width="30" height="20" fill="#fff"/>';
      for (var i = 0; i < 7; i++) s += '<rect y="' + (i * 20 / 6.5).toFixed(2) + '" width="30" height="1.54" fill="#B22234"/>';
      return s + '<rect width="13" height="10.77" fill="#3C3B6E"/>' +
        '<g fill="#fff"><circle cx="2.5" cy="2.2" r=".55"/><circle cx="6.5" cy="2.2" r=".55"/><circle cx="10.5" cy="2.2" r=".55"/><circle cx="4.5" cy="5.4" r=".55"/><circle cx="8.5" cy="5.4" r=".55"/><circle cx="2.5" cy="8.6" r=".55"/><circle cx="6.5" cy="8.6" r=".55"/><circle cx="10.5" cy="8.6" r=".55"/></g>';
    })(),
    EUR: '<rect width="30" height="20" fill="#003399"/>' + estrellasCirculo(15, 10, 6, 12, 0.8, '#FFCC00', 0, 360),
    MXN: '<rect width="10" height="20" fill="#006847"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#CE1126"/><circle cx="15" cy="10" r="2.6" fill="#8C5A2B"/><path d="M12.4 11.2q2.6 2.6 5.2 0" fill="none" stroke="#006847" stroke-width=".8"/>',
    PEN: '<rect width="10" height="20" fill="#D91023"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#D91023"/>',
    DOP: '<rect width="30" height="20" fill="#fff"/><rect width="12.5" height="8.5" fill="#002D62"/><rect x="17.5" width="12.5" height="8.5" fill="#CE1126"/><rect y="11.5" width="12.5" height="8.5" fill="#CE1126"/><rect x="17.5" y="11.5" width="12.5" height="8.5" fill="#002D62"/><circle cx="15" cy="10" r="1.3" fill="#2E7D32"/>',
    ARS: '<rect width="30" height="20" fill="#74ACDF"/><rect y="6.67" width="30" height="6.66" fill="#fff"/><circle cx="15" cy="10" r="2" fill="#F6B40E" stroke="#85340A" stroke-width=".3"/>',
    BRL: '<rect width="30" height="20" fill="#009C3B"/><path d="M15 2.2L27 10 15 17.8 3 10z" fill="#FFDF00"/><circle cx="15" cy="10" r="4.2" fill="#002776"/><path d="M11 9.2q4-1.4 8 .9" fill="none" stroke="#fff" stroke-width=".7"/>',
    CLP: '<rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#D52B1E"/><rect width="10" height="10" fill="#0039A6"/><path d="M5 2.3l.9 2.7h2.8L6.4 6.7l.9 2.7L5 7.7 2.7 9.4l.9-2.7-2.3-1.7h2.8z" fill="#fff"/>',
    PYG: '<rect width="30" height="6.67" fill="#D52B1E"/><rect y="6.67" width="30" height="6.66" fill="#fff"/><rect y="13.33" width="30" height="6.67" fill="#0038A8"/><circle cx="15" cy="10" r="1.9" fill="none" stroke="#2E7D32" stroke-width=".6"/>',
    VES: '<rect width="30" height="6.67" fill="#FFCC00"/><rect y="6.67" width="30" height="6.66" fill="#00247D"/><rect y="13.33" width="30" height="6.67" fill="#CF142B"/>' + estrellasCirculo(15, 13.6, 4.6, 8, 0.5, '#fff', 200, 340)
  };
  function bandera(c) {
    var b = BANDERAS[c];
    if (!b) return '';
    return '<span class="fd-flag" aria-hidden="true"><svg viewBox="0 0 30 20" preserveAspectRatio="none" focusable="false">' + b + '</svg></span>';
  }

  var abierto = null;
  function cerrarLista(w, foco) {
    if (!w) return;
    var btn = w.querySelector('.fd-btn'), ul = w.querySelector('.fd-lista');
    ul.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    ul.removeAttribute('aria-activedescendant');
    if (abierto === w) abierto = null;
    if (foco) btn.focus();
  }
  function opciones(w) { return Array.prototype.slice.call(w.querySelectorAll('.fd-op')); }
  function activar(w, i) {
    var ops = opciones(w), ul = w.querySelector('.fd-lista');
    if (!ops.length) return;
    i = Math.max(0, Math.min(ops.length - 1, i));
    ops.forEach(function (o, k) { o.classList.toggle('activa', k === i); });
    ul.setAttribute('aria-activedescendant', ops[i].id);
    w._activa = i;
    var o = ops[i];
    if (o.offsetTop < ul.scrollTop) ul.scrollTop = o.offsetTop;
    else if (o.offsetTop + o.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = o.offsetTop + o.offsetHeight - ul.clientHeight;
  }
  function abrirLista(w, idx) {
    var btn = w.querySelector('.fd-btn'), ul = w.querySelector('.fd-lista');
    if (btn.disabled) return;
    if (abierto && abierto !== w) cerrarLista(abierto);
    ul.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    abierto = w;
    var ops = opciones(w), sel = w.querySelector('select'), cur = 0;
    ops.forEach(function (o, k) { if (o.getAttribute('data-v') === sel.value) cur = k; });
    activar(w, idx == null ? cur : (idx < 0 ? ops.length - 1 : idx));
    ul.focus();
  }
  function elegir(w, i) {
    var ops = opciones(w), sel = w.querySelector('select');
    var o = ops[i];
    cerrarLista(w, true);
    if (!o) return;
    var v = o.getAttribute('data-v');
    if (sel.value !== v) {
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true })); // contrato nativo .fd-select
    }
  }
  document.addEventListener('mousedown', function (e) {
    if (abierto && !abierto.querySelector('.fd-wrap').contains(e.target)) cerrarLista(abierto);
  }, true);

  function montarSelector(padre, antesDe) {
    if (!padre) return null;
    var id = 'fd-sel-' + (++uid);
    var w = document.createElement('div');
    w.className = 'fd-sel';
    w.setAttribute('role', 'group');
    w.setAttribute('aria-label', 'Moneda para ver los precios');
    w.innerHTML =
      '<span class="fd-lbl" id="' + id + '-l">Ver precios en</span>' +
      '<span class="fd-wrap">' +
      '<select id="' + id + '" class="fd-select fd-oculto" tabindex="-1" aria-hidden="true"></select>' +
      '<button type="button" class="fd-btn" id="' + id + '-b" aria-haspopup="listbox" aria-expanded="false" aria-controls="' + id + '-lb" aria-labelledby="' + id + '-l ' + id + '-b" aria-describedby="' + id + '-n"></button>' +
      CHEVRON +
      '<ul class="fd-lista" id="' + id + '-lb" role="listbox" tabindex="-1" aria-labelledby="' + id + '-l" hidden></ul>' +
      '</span>' +
      '<p class="fd-nota" id="' + id + '-n" aria-live="polite"></p>';
    padre.insertBefore(w, antesDe || null);
    var sel = w.querySelector('select'), btn = w.querySelector('.fd-btn'), ul = w.querySelector('.fd-lista');
    sel.addEventListener('change', function () { establecer(sel.value); });
    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-expanded') === 'true') cerrarLista(w, true); else abrirLista(w);
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        abrirLista(w);
      }
    });
    ul.addEventListener('keydown', function (e) {
      var n = opciones(w).length, i = w._activa || 0;
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); activar(w, i + 1); break;
        case 'ArrowUp': e.preventDefault(); activar(w, i - 1); break;
        case 'Home': e.preventDefault(); activar(w, 0); break;
        case 'End': e.preventDefault(); activar(w, n - 1); break;
        case 'Enter': case ' ': e.preventDefault(); elegir(w, i); break;
        case 'Escape': e.preventDefault(); cerrarLista(w, true); break;
        case 'Tab': cerrarLista(w); break;
        default:
          if (/^[a-z]$/i.test(e.key)) {
            var ops = opciones(w), k = e.key.toUpperCase();
            for (var j = 1; j <= n; j++) {
              var o = ops[(i + j) % n];
              if (o.getAttribute('data-v').charAt(0) === k) { activar(w, (i + j) % n); break; }
            }
          }
      }
    });
    ul.addEventListener('click', function (e) {
      var o = e.target.closest && e.target.closest('.fd-op');
      if (o) elegir(w, opciones(w).indexOf(o));
    });
    ul.addEventListener('mousemove', function (e) {
      var o = e.target.closest && e.target.closest('.fd-op');
      if (o) { var k = opciones(w).indexOf(o); if (k !== w._activa) activar(w, k); }
    });
    selectores.push(w);
    pintarSelector(w);
    return w;
  }

  function pintarSelector(w) {
    var sel = w.querySelector('select');
    var nota = w.querySelector('.fd-nota');
    var btn = w.querySelector('.fd-btn');
    var ul = w.querySelector('.fd-lista');
    var lista = disponibles();
    var html = lista.map(function (d) {
      return '<option value="' + esc(d.codigo) + '">' + esc(d.codigo + ' · ' + d.nombre) + '</option>';
    }).join('');
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = actual();
    var bloqueado = false; // COP está disponible incluso durante la carga o sin tasas.
    sel.disabled = bloqueado;
    if (btn && ul) {
      var lid = ul.id;
      var opsHtml = lista.map(function (d, k) {
        var si = d.codigo === sel.value;
        return '<li class="fd-op" role="option" id="' + lid + '-o' + k + '" data-v="' + esc(d.codigo) + '" aria-selected="' + si + '">' +
          bandera(d.codigo) + '<b>' + esc(d.codigo) + '</b><span class="fd-op-n">' + esc(d.nombre) + '</span></li>';
      }).join('');
      if (ul.getAttribute('data-h') !== opsHtml) {
        ul.innerHTML = opsHtml;
        ul.setAttribute('data-h', opsHtml);
      }
      var cur = null;
      lista.forEach(function (d) { if (d.codigo === sel.value) cur = d; });
      cur = cur || { codigo: actual(), nombre: NOMBRES[actual()] };
      btn.innerHTML = bandera(cur.codigo) + '<span>' + esc(cur.codigo) + '</span><span class="fd-oculto">' + esc(cur.nombre) + '</span>';
      btn.title = cur.nombre;
      btn.disabled = bloqueado;
      if (bloqueado) cerrarLista(w);
    }
    nota.className = 'fd-nota';
    if (st.cargando) {
      nota.textContent = 'Cargando tasas de referencia…';
    } else if (!hayTasas()) {
      nota.className = 'fd-nota err';
      nota.innerHTML = esc(st.error || 'Tasas no disponibles. Puedes pagar con la tarifa COP original.') +
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
    var originalCop = (precio.textContent || '').match(/\$\s*([0-9][0-9.]*)/);
    if (originalCop) p.setAttribute('data-fd-cop', originalCop[1].replace(/\./g, ''));
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
    pill.setAttribute('data-fd', precio(p.getAttribute('data-fd-cop'), usd));
    pill.setAttribute('title', actual() === 'COP' ? 'Tarifa COP original' : 'Precio base ' + fmt(numUsd(usd), 'USD'));
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
      var cop = Number(p.getAttribute('data-fd-cop'));
      b.textContent = '\u2212' + pct + '% \u2192 ' + precio(Math.round(cop * (1 - pct / 100)), numUsd(usd) * (1 - pct / 100));
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
    var control = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var temporizador;
    var limite = new Promise(function (_, reject) {
      temporizador = setTimeout(function () {
        var e = new Error('El cálculo del total tardó demasiado. Comprueba tu conexión y pulsa «Volver a calcular». No se inició ningún cobro.');
        e.status = 408;
        reject(e);
        if (control) control.abort();
      }, 15000);
    });
    var solicitud = fetch('/api/cotizacion', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: control ? control.signal : undefined,
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
        if (d.divisa !== String(cuerpo.divisa || 'COP').toUpperCase() || !desgloseCompleto(d)) {
          throw new Error('El resumen de tu divisa no está disponible. Vuelve a calcular antes de pagar.');
        }
        return d;
      });
    }, function () {
      var e = new Error('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
      e.status = 0;
      throw e;
    });
    return Promise.race([solicitud, limite]).then(function (d) {
      clearTimeout(temporizador);
      return d;
    }, function (e) {
      clearTimeout(temporizador);
      throw e;
    });
  }

  var MARGEN_MS = 20000;

  function desgloseCompleto(d) {
    if (d.divisa === 'COP') return true;
    var fin = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0; };
    return fin(d.subtotal_divisa) && fin(d.comision_divisa) && fin(d.total_divisa) &&
      fin(d.tasa_divisa) && d.tasa_divisa > 0 && Array.isArray(d.items) && d.items.length > 0 &&
      d.items.every(function (it) { return fin(it.importe_divisa); });
  }

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
        (s.fase === 'expirada' ? 'La cotización venció. Actualizando el precio…' : 'Calculando tu total…') + '</p></div>';
    } else if (s.fase === 'error') {
      html = '<div class="fd-cot-err" role="alert">' + esc(s.error || 'No pudimos calcular el total.') +
        ' No es posible pagar sin un total confirmado.</div>' +
        '<button type="button" class="fd-cot-btn" data-fd-accion="reintentar">Volver a calcular</button>';
    } else {
      var d = s.datos;
      var ped = d.pedido || {};
      var div = d.divisa || ped.divisa || 'COP';
      var metodo = String(ped.metodo || d.metodo || 'wompi').toLowerCase();
      var esTransf = metodo.indexOf('transf') === 0;
      var items = d.items || [];
      var extranjera = div !== 'COP';
      // Montos solo de la cotización firmada; nunca de la tasa actual del navegador.
      var completa = desgloseCompleto(d);
      var hasta = aFecha(d.expires_at);
      var hastaTxt = hasta ? hasta.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '';
      var reservado = hastaTxt ? ' Precio reservado hasta las ' + esc(hastaTxt) + '.' : '';
      var off = function (it) { return Number(it.descuento_pct) > 0 ? '<span class="fd-cot-off">\u2212' + esc(it.descuento_pct) + '%</span>' : ''; };
      var fila = function (a, b) { return '<div class="fd-cot-fila"><span>' + a + '</span><b>' + esc(b) + '</b></div>'; };
      if (!completa) {
        html = '<div class="fd-cot-err" role="alert">No pudimos mostrar tu total en ' + esc(div) +
          '. No es posible pagar sin un total confirmado.</div>' +
          '<button type="button" class="fd-cot-btn" data-fd-accion="reintentar">Volver a calcular</button>';
      } else if (extranjera && !esTransf) {
        html = items.map(function (it) { return fila(esc(it.nombre) + off(it), fmt(it.importe_divisa, div)); }).join('') +
          '<hr class="fd-cot-sep">' +
          fila('Subtotal', fmt(d.subtotal_divisa, div)) +
          (Number(d.comision_divisa) > 0 ? fila('Comisión de la pasarela', fmt(d.comision_divisa, div)) : '') +
          '<div class="fd-cot-total"><span>Total aproximado</span><strong>\u2248 ' + esc(fmt(d.total_divisa, div)) + '</strong></div>' +
          '<div class="fd-cot-pie">Wompi cobra en pesos colombianos (COP); la conversión de tu banco puede variar.' + reservado + '</div>';
      } else {
        var comision = Number(d.total_cop) - Number(d.subtotal_cop);
        var eq = extranjera ? '<div class="fd-cot-eq">\u2248 ' + esc(fmt(d.total_divisa, div)) + '</div>' : '';
        html = items.map(function (it) { return fila(esc(it.nombre) + off(it), fmt(it.cop, 'COP')); }).join('') +
          '<hr class="fd-cot-sep">' +
          fila('Subtotal', fmt(d.subtotal_cop, 'COP')) +
          (comision > 0 ? fila('Comisión de la pasarela', fmt(comision, 'COP')) : '') +
          '<div class="fd-cot-total"><span>' + (esTransf ? 'Total exacto a transferir' : 'Total a pagar') + '</span><strong>' + esc(fmt(d.total_cop, 'COP')) + '</strong></div>' + eq +
          '<div class="fd-cot-pie">' + (esTransf ? 'Transfiere exactamente este valor en pesos colombianos (COP).' : 'El cobro se realiza en pesos colombianos (COP).') +
          (eq ? ' El equivalente es de referencia; tu banco puede usar otra conversión.' : '') + reservado + '</div>';
      }
      html +=
        (s.revisar && completa ? '<div class="fd-cot-revisar" role="alert">Tu cotización anterior venció y actualizamos el precio. Revisa el nuevo total antes de continuar.' +
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
    precio: precio,
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
