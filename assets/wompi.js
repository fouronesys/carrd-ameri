(function () {
  var WOMPI_PUBLIC_KEY = 'pub_test_gjhaZFqRwKaZMBcAEBYOjYNGqzGUyPXx';

  // Intenta obtener la llave pública desde el servidor (fuente única: variable de entorno).
  try {
    fetch('/api/config')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) { if (cfg && cfg.wompiPublicKey) WOMPI_PUBLIC_KEY = cfg.wompiPublicKey; })
      .catch(function () {});
  } catch (e) {}

  var ACLARACIONES_RESUMEN = [
    'Los precios <strong>no incluyen comisión</strong> de la pasarela de pago.',
    'El trabajo se agenda únicamente cuando el pago esté <strong>totalmente cancelado</strong>.',
    '<strong>No se realizan reembolsos</strong> después de haber realizado el pago.',
    'Si deseas el hechizo con urgencia (mismo día o en dos días siguientes), se aplica un recargo de <strong>$10 USD / $28.000 COP</strong>.',
    'Al realizar el pago, envía el comprobante junto con tus datos (nombre completo y fecha de nacimiento) por TikTok o WhatsApp.',
    'Si el servicio incluye a otra persona, también debes enviar sus datos o signo zodiacal.',
    'Lunes a viernes: 1:40 p.m. a 9:30 p.m. (hora Colombia). Sábados: 11:30 a.m. a 5:30 p.m.',
    'Al pagar se asume que leíste <strong>TODAS</strong> las aclaraciones y las aceptas.'
  ];

  var REGEX_COP = /\$\s*([0-9]{1,3}(?:\.[0-9]{3})+)/;
  var REGEX_USD = /([0-9]+(?:[.,][0-9]+)?)\s*usd/i;

  var METODOS_PAGO = [
    { nombre: 'BBVA México', detalle: '4152314395088746 · Naomi Carrillo' },
    { nombre: 'Nequi', detalle: '3104462860 (Sa* Izq**)' },
    { nombre: 'Mercado Pago', detalle: 'opacelia (Celeste Villalba)' },
    { nombre: 'Yape', detalle: '964 806 000 (Andrea)' },
    { nombre: 'Banco Popular RD', detalle: 'Ahorros: 844480111 · Cédula: 40215343837' },
    { nombre: 'También', detalle: 'Western Union y Remitly' }
  ];

  var URL_ASTROPAY = 'https://onetouch.astropay.com/payment?external_reference_id=D90q4hqQNtroahncdgks9jBSIKMwxV89';
  var CORREO_PAYPAL = 'galvisestefania038@gmail.com';

  function extraerPrecioCOP(texto) {
    var match = texto.match(REGEX_COP);
    if (match) {
      var val = parseInt(match[1].replace(/\./g, ''), 10);
      if (val > 999) return val;
    }
    return null;
  }

  function extraerPrecioUSD(texto) {
    var match = texto.match(REGEX_USD);
    if (match) return match[1].replace(',', '.');
    return null;
  }

  function extraerNombreProducto(texto) {
    var linea = texto.split('\n')[0].trim();
    linea = linea.replace(/[ෆ⟡⊹˚꒦ᶻ𝗓𐰁ೀ𖥔ꗯಎ☼𝜗᭪𐙚✩]/g, '').trim();
    linea = linea.replace(/^\s*/, '').trim();
    if (linea.length > 60) linea = linea.substring(0, 57) + '…';
    return linea;
  }

  // Promociones por fecha activas (mapa clave -> porcentaje). Se llena al iniciar.
  var PROMOS_FECHA = {};
  var ICONOS_HECHIZO = /[ෆ⟡⊹˚꒦ᶻ𝗓𐰁ೀ𖥔ꗯಎ☼𝜗᭪𐙚✩ᵎ]/g;

  // Deriva la clave estable de un hechizo (debe coincidir con el servidor).
  function claveHechizo(strongEl) {
    if (!strongEl) return '';
    var t = (strongEl.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(ICONOS_HECHIZO, '')
      .replace(/\s+/g, ' ')
      .trim();
    return t.toLowerCase();
  }

  function aplicarDescuentoCliente(base, pct) {
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    return Math.round(base * (1 - p / 100));
  }

  function crearModal() {
    var estilos = document.createElement('style');
    estilos.textContent = [
      '#wompi-overlay{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.88);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);align-items:center;justify-content:center;padding:16px;}',
      '#wompi-overlay.activo{display:flex;}',
      '#wompi-modal{background:#100109;background-image:linear-gradient(360deg, rgba(0,0,0,0.72) 0%, rgba(125,55,84,0.10) 100%);border:solid 1px #C2A7B7;box-shadow:0 0 0 4px rgba(125,55,84,0.15), 0 20px 60px rgba(0,0,0,0.7);max-width:420px;width:100%;max-height:90vh;overflow-y:auto;padding:26px 24px;font-family:"Poppins",sans-serif;color:#fff;position:relative;font-size:16px;}',
      '#wompi-modal .wm-deco{text-align:center;color:#7D3754;font-size:11px;letter-spacing:0.1em;margin-bottom:6px;}',
      '#wompi-modal h3{text-align:center;color:#F0A3C3;font-size:17px;font-weight:900;margin-bottom:14px;letter-spacing:0.03em;text-transform:uppercase;}',
      '#wompi-modal h3 span{color:#9C4C6D;}',
      '#wompi-modal .wm-producto{text-align:center;font-size:14px;font-weight:700;color:#fff;margin-bottom:3px;line-height:1.35;}',
      '#wompi-modal .wm-precio{text-align:center;font-size:19px;font-weight:900;font-style:italic;color:#F0A3C3;margin-bottom:16px;}',
      '#wompi-modal .wm-precio-tachado{color:#b58ca1;text-decoration:line-through;font-weight:600;font-size:14px;margin-right:6px;}',
      '#wompi-modal .wm-precio-off{display:inline-block;background:#7D3754;color:#fff;font-size:11px;font-weight:800;font-style:normal;padding:2px 8px;border-radius:20px;margin-left:6px;vertical-align:middle;}',
      '#wompi-modal .wm-promo{background:rgba(125,55,84,0.10);border:1px solid rgba(194,167,183,0.25);border-radius:8px;padding:12px 14px;margin-bottom:14px;}',
      '#wompi-modal .wm-promo .wm-label{margin-bottom:0;}',
      '#wompi-modal .wm-codigo-btn{padding:0 16px;background:#7D3754;color:#fff;border:1px solid #C2A7B7;border-radius:7px;font-family:"Poppins",sans-serif;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;}',
      '#wompi-modal .wm-codigo-btn:hover{background:#9C4C6D;}',
      '#wompi-modal .wm-codigo-msg{font-size:11px;margin-top:8px;line-height:1.4;min-height:0;}',
      '#wompi-modal .wm-codigo-msg.ok{color:#9be0b4;}',
      '#wompi-modal .wm-codigo-msg.err{color:#f3b6cd;}',
      '.wm-promo-badge{display:inline-block;margin-left:0.4rem;padding:0.12rem 0.5rem;font-family:"Poppins",sans-serif;font-size:0.42rem;font-weight:800;letter-spacing:0.04em;color:#fff;background:#7D3754;border-radius:2rem;vertical-align:middle;}',
      '#wompi-modal .wm-divider{border:none;border-top:1px solid rgba(194,167,183,0.35);margin:14px 0;}',
      '#wompi-modal .wm-form-titulo{text-align:center;font-size:12px;font-weight:700;color:#F0A3C3;letter-spacing:0.04em;margin-bottom:12px;}',
      '#wompi-modal .wm-form-titulo span{color:#9C4C6D;}',
      '#wompi-modal .wm-label{display:block;font-size:11.5px;color:#e0c0cf;margin-bottom:12px;font-weight:500;}',
      '#wompi-modal .wm-label .wm-req{color:#F0A3C3;}',
      '#wompi-modal .wm-input{display:block;width:100%;margin-top:5px;padding:10px 12px;border-radius:7px;border:1px solid rgba(194,167,183,0.4);background:rgba(0,0,0,0.35);color:#fff;font-family:"Poppins",sans-serif;font-size:13px;}',
      '#wompi-modal .wm-input:focus{outline:none;border-color:#F0A3C3;}',
      '#wompi-modal .wm-textarea{resize:vertical;min-height:60px;}',
      '#wompi-modal .wm-file{padding:8px 10px;font-size:12px;color:#d6b9c8;}',
      '#wompi-modal .wm-file::file-selector-button{background:#7D3754;color:#fff;border:1px solid #C2A7B7;border-radius:20px;padding:5px 12px;font-size:11px;cursor:pointer;margin-right:10px;font-family:"Poppins",sans-serif;}',
      '#wompi-modal .wm-fieldset{background:rgba(125,55,84,0.10);border:1px solid rgba(194,167,183,0.25);border-radius:8px;padding:14px 14px 4px;margin-bottom:14px;}',
      '#wompi-modal .wm-fieldset-tit{font-size:12px;font-weight:700;color:#F0A3C3;margin-bottom:4px;}',
      '#wompi-modal .wm-fieldset-sub{font-size:10.5px;color:#b58ca1;line-height:1.45;margin-bottom:12px;}',
      '#wompi-modal .wm-aclaraciones-titulo{text-align:center;font-size:12px;font-weight:700;color:#F0A3C3;letter-spacing:0.04em;margin-bottom:10px;}',
      '#wompi-modal .wm-aclaraciones-titulo span{color:#9C4C6D;}',
      '#wompi-modal .wm-aclaraciones-lista{background:rgba(125,55,84,0.10);border:1px solid rgba(194,167,183,0.25);border-radius:6px;padding:14px 16px;margin-bottom:14px;max-height:140px;overflow-y:auto;}',
      '#wompi-modal .wm-aclaraciones-lista li{font-size:12px;color:#d6b9c8;line-height:1.55;margin-bottom:8px;padding-left:18px;position:relative;}',
      '#wompi-modal .wm-aclaraciones-lista li:last-child{margin-bottom:0;}',
      '#wompi-modal .wm-aclaraciones-lista li::before{content:"ꪮꫀ.";position:absolute;left:0;color:#9C4C6D;font-size:10px;}',
      '#wompi-modal .wm-aclaraciones-lista li strong{color:#F0A3C3;}',
      '#wompi-modal .wm-aclaraciones-link{display:block;font-size:12px;color:#F0A3C3;text-decoration:underline;margin-bottom:16px;text-align:center;}',
      '#wompi-modal .wm-check-wrap{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;cursor:pointer;background:rgba(125,55,84,0.08);border:1px solid rgba(194,167,183,0.25);border-radius:6px;padding:12px 13px;}',
      '#wompi-modal .wm-check-wrap input[type=checkbox]{width:18px;height:18px;min-width:18px;accent-color:#7D3754;margin-top:2px;cursor:pointer;}',
      '#wompi-modal .wm-check-wrap label{font-size:12px;color:#e0c0cf;line-height:1.45;cursor:pointer;}',
      '#wompi-modal .wm-check-wrap label strong{color:#F0A3C3;}',
      '#wompi-modal .wm-error{display:none;background:rgba(229,123,160,0.14);border:1px solid rgba(229,123,160,0.4);color:#f3b6cd;font-size:11.5px;padding:9px 11px;border-radius:6px;margin-bottom:14px;text-align:center;}',
      '#wompi-modal .wm-error.activo{display:block;}',
      '#wompi-modal .wm-btn-pagar{display:block;width:100%;padding:13px;background-color:#7D3754;background-image:linear-gradient(360deg, rgba(0,0,0,0.72) 0%, rgba(125,55,84,0.012) 100%);color:#fff;font-family:"Poppins",sans-serif;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border:solid 1px #C2A7B7;border-radius:48px;cursor:pointer;transition:transform 0.125s ease,opacity 0.2s;text-align:center;text-decoration:none;}',
      '#wompi-modal .wm-btn-pagar:hover:not(:disabled){transform:translateY(-1px);}',
      '#wompi-modal .wm-btn-pagar:disabled{opacity:0.35;cursor:not-allowed;border-color:rgba(194,167,183,0.4);}',
      '#wompi-modal .wm-btn-cerrar{position:absolute;top:12px;right:14px;background:none;border:none;color:#9C4C6D;font-size:22px;cursor:pointer;line-height:1;transition:color 0.15s;}',
      '#wompi-modal .wm-btn-cerrar:hover{color:#F0A3C3;}',
      '#wompi-modal .wm-nota{font-size:10px;color:#9c7788;text-align:center;margin-top:11px;}',
      '.wm-pay-btn{display:inline-block;margin-top:0.5rem;padding:0.22rem 0.7rem;font-family:"Poppins",sans-serif;font-size:0.48rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#fff;background-color:#7D3754;background-image:linear-gradient(360deg, rgba(0,0,0,0.72) 0%, rgba(125,55,84,0.012) 100%);border:solid 1px #C2A7B7;border-radius:3rem;cursor:pointer;transition:transform 0.125s ease;vertical-align:middle;}',
      '.wm-pay-btn:hover{transform:translateY(-1px);}',
      '.wm-pay-btn.transfer{background-color:#4c2740;margin-left:0.3rem;}',
      '#wompi-modal .wm-metodos{background:rgba(125,55,84,0.12);border:1px solid rgba(194,167,183,0.3);border-radius:8px;padding:12px 14px;margin-bottom:14px;}',
      '#wompi-modal .wm-metodos-tit{font-size:12px;font-weight:700;color:#F0A3C3;margin-bottom:8px;}',
      '#wompi-modal .wm-metodo{font-size:11.5px;color:#e0c0cf;line-height:1.45;padding:6px 0;border-top:1px solid rgba(194,167,183,0.15);}',
      '#wompi-modal .wm-metodo:first-of-type{border-top:none;}',
      '#wompi-modal .wm-metodo b{color:#fff;}',
      '#wompi-modal .wm-transfer-only{display:none;}',
      '#wompi-modal.modo-transfer .wm-transfer-only{display:block;}',
      '#wompi-modal.modo-transfer .wm-wompi-only{display:none;}',
      '#wompi-modal .wm-pagos{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;}',
      '#wompi-modal .wm-pago-btn{display:block;width:100%;padding:11px;background:rgba(125,55,84,0.28);color:#fff;font-family:"Poppins",sans-serif;font-size:12.5px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;border:1px solid #C2A7B7;border-radius:48px;text-align:center;text-decoration:none;transition:transform 0.125s ease,background 0.2s;}',
      '#wompi-modal .wm-pago-btn:hover{transform:translateY(-1px);background:rgba(125,55,84,0.5);}',
      '#wompi-modal .wm-pago-cap{font-size:11px;color:#e0c0cf;text-align:center;margin-top:-2px;line-height:1.4;}',
      '#wompi-modal .wm-pago-cap b{color:#fff;}',
      '.p{position:relative;}'
    ].join('');
    document.head.appendChild(estilos);

    var overlay = document.createElement('div');
    overlay.id = 'wompi-overlay';

    var modal = document.createElement('div');
    modal.id = 'wompi-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    var listItems = ACLARACIONES_RESUMEN.map(function (t) {
      return '<li>' + t + '</li>';
    }).join('');

    var metodosItems = METODOS_PAGO.map(function (m) {
      return '<div class="wm-metodo"><b>' + m.nombre + ':</b> ' + m.detalle + '</div>';
    }).join('');

    modal.innerHTML = [
      '<button class="wm-btn-cerrar" id="wm-cerrar" aria-label="Cerrar">✕</button>',
      '<div class="wm-deco">꣑୧・┈</div>',
      '<h3><span>♡</span> Confirmar pago <span>♡</span></h3>',
      '<div class="wm-producto" id="wm-nombre-producto"></div>',
      '<div class="wm-precio" id="wm-precio-producto"></div>',
      '<div class="wm-promo" id="wm-promo" style="display:none">',
      '  <label class="wm-label">¿Tienes un código promocional?',
      '    <span style="display:flex;gap:8px;margin-top:6px;">',
      '      <input type="text" class="wm-input" id="wm-codigo" placeholder="Escribe tu código" style="margin-top:0;" autocomplete="off">',
      '      <button type="button" class="wm-codigo-btn" id="wm-codigo-btn">Aplicar</button>',
      '    </span>',
      '  </label>',
      '  <div class="wm-codigo-msg" id="wm-codigo-msg"></div>',
      '</div>',
      '<hr class="wm-divider">',
      '<div class="wm-form-titulo"><span>｡ ˚ ︶︶ꔫ</span> Tus datos <span>ꔫ︶︶ ₊ ˚</span></div>',
      '<label class="wm-label">Tu nombre y apellido <span class="wm-req">*</span>',
      '  <input type="text" class="wm-input" id="wm-cliente" placeholder="Escribe tu nombre y apellido" autocomplete="name">',
      '</label>',
      '<label class="wm-label">WhatsApp o red social para entregarte la evidencia <span class="wm-req">*</span>',
      '  <input type="text" class="wm-input" id="wm-contacto" placeholder="Ej: WhatsApp +57 300 123 4567 o @tu_usuario" autocomplete="tel">',
      '</label>',
      '<div class="wm-fieldset">',
      '  <div class="wm-fieldset-tit">Datos de la persona a trabajar</div>',
      '  <div class="wm-fieldset-sub">Pueden ser tuyos o de otra persona. Si no tienes los datos, sube una foto de la persona.</div>',
      '  <label class="wm-label">Nombre y apellidos',
      '    <input type="text" class="wm-input" id="wm-obj-nombre" placeholder="Nombre y apellidos">',
      '  </label>',
      '  <label class="wm-label">Fecha de nacimiento',
      '    <input type="date" class="wm-input" id="wm-obj-fecha">',
      '  </label>',
      '  <label class="wm-label">O una foto de la persona',
      '    <input type="file" class="wm-input wm-file" id="wm-obj-foto" accept="image/*">',
      '  </label>',
      '</div>',
      '<label class="wm-label">Otra información que desees proporcionar',
      '  <textarea class="wm-input wm-textarea" id="wm-info" placeholder="Escribe aquí cualquier detalle adicional..."></textarea>',
      '</label>',
      '<div class="wm-transfer-only">',
      '  <hr class="wm-divider">',
      '  <div class="wm-metodos">',
      '    <div class="wm-metodos-tit">Realiza el pago a cualquiera de estos métodos:</div>',
      '    ' + metodosItems,
      '  </div>',
      '  <div class="wm-pagos">',
      '    <a class="wm-pago-btn" href="' + URL_ASTROPAY + '" target="_blank" rel="noopener">Pagar por AstroPay ↗</a>',
      '    <a class="wm-pago-btn" href="https://www.paypal.com/myaccount/transfer/homepage/pay" target="_blank" rel="noopener">Pagar por PayPal ↗</a>',
      '    <div class="wm-pago-cap">Envía tu pago de PayPal a: <b>' + CORREO_PAYPAL + '</b></div>',
      '  </div>',
      '  <label class="wm-label">Sube el comprobante de tu pago <span class="wm-req">*</span>',
      '    <input type="file" class="wm-input wm-file" id="wm-comprobante" accept="image/*">',
      '  </label>',
      '</div>',
      '<hr class="wm-divider">',
      '<div class="wm-aclaraciones-titulo"><span>｡ ˚ ︶︶ꔫ</span> Aclaraciones <span>ꔫ︶︶ ₊ ˚</span></div>',
      '<ul class="wm-aclaraciones-lista">' + listItems + '</ul>',
      '<a class="wm-aclaraciones-link" href="#aclaraciones" id="wm-link-aclaraciones">→ Leer todas las aclaraciones completas</a>',
      '<label class="wm-check-wrap">',
      '  <input type="checkbox" id="wm-acepto">',
      '  <span>He leído <strong>todas las aclaraciones</strong> y las acepto. Entiendo que <strong>no hay reembolsos</strong> una vez realizado el pago y que el precio no incluye comisión.</span>',
      '</label>',
      '<div class="wm-error" id="wm-error"></div>',
      '<button class="wm-btn-pagar" id="wm-btn-pagar" disabled>Pagar con Wompi ↗</button>',
      '<p class="wm-nota wm-wompi-only">Serás redirigido/a al checkout seguro de Wompi. Tu trabajo se agenda automáticamente cuando el pago sea aprobado.</p>',
      '<p class="wm-nota wm-transfer-only">Después de enviar tu comprobante, verificaremos tu pago manualmente. Te avisaremos por tu contacto cuando quede confirmado.</p>'
    ].join('');

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var estado = {
      precioCOP: 0, precioUSD: '', nombre: '', precioTexto: '', modo: 'wompi',
      esHechizo: false, clave: '', base: 0, pctFecha: 0, pctCodigo: 0, codigo: '', precioFinal: 0,
    };

    var checkbox = document.getElementById('wm-acepto');
    var btnPagar = document.getElementById('wm-btn-pagar');
    var errorBox = document.getElementById('wm-error');
    var inpCliente = document.getElementById('wm-cliente');
    var inpContacto = document.getElementById('wm-contacto');
    var inpObjNombre = document.getElementById('wm-obj-nombre');
    var inpObjFecha = document.getElementById('wm-obj-fecha');
    var inpObjFoto = document.getElementById('wm-obj-foto');
    var inpComprobante = document.getElementById('wm-comprobante');
    var inpInfo = document.getElementById('wm-info');
    var precioEl = document.getElementById('wm-precio-producto');
    var promoWrap = document.getElementById('wm-promo');
    var inpCodigo = document.getElementById('wm-codigo');
    var btnCodigo = document.getElementById('wm-codigo-btn');
    var codigoMsg = document.getElementById('wm-codigo-msg');

    function pctActual() {
      return Math.max(estado.pctFecha || 0, estado.pctCodigo || 0);
    }

    function actualizarPrecio() {
      var pct = pctActual();
      if (estado.esHechizo && pct > 0) {
        var fin = aplicarDescuentoCliente(estado.base, pct);
        estado.precioFinal = fin;
        precioEl.innerHTML = '<span class="wm-precio-tachado">' + estado.precioTexto + '</span> $' +
          fin.toLocaleString('es-CO') + ' COP <span class="wm-precio-off">-' + pct + '%</span>';
      } else {
        estado.precioFinal = estado.precioCOP;
        precioEl.textContent = estado.precioTexto;
      }
    }

    function mostrarMsgCodigo(texto, tipo) {
      codigoMsg.textContent = texto;
      codigoMsg.className = 'wm-codigo-msg' + (tipo ? ' ' + tipo : '');
    }

    btnCodigo.addEventListener('click', function () {
      var code = inpCodigo.value.trim();
      if (!estado.esHechizo || !estado.clave) return;
      if (!code) { mostrarMsgCodigo('Escribe un código.', 'err'); return; }
      btnCodigo.disabled = true;
      var txt = btnCodigo.textContent;
      btnCodigo.textContent = '...';
      fetch('/api/codigo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hechizo_clave: estado.clave, codigo: code }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok || !res.d || !res.d.ok) {
            estado.pctCodigo = 0;
            estado.codigo = '';
            mostrarMsgCodigo((res.d && res.d.error) || 'El código no es válido para este hechizo.', 'err');
          } else {
            estado.pctCodigo = Number(res.d.porcentaje) || 0;
            estado.codigo = code;
            if (estado.pctCodigo <= (estado.pctFecha || 0)) {
              mostrarMsgCodigo('Código aplicado. Ya tienes un descuento mayor o igual por promoción vigente.', 'ok');
            } else {
              mostrarMsgCodigo('✓ Código aplicado: -' + estado.pctCodigo + '%.', 'ok');
            }
          }
          actualizarPrecio();
        })
        .catch(function () {
          mostrarMsgCodigo('No se pudo validar el código. Intenta de nuevo.', 'err');
        })
        .then(function () {
          btnCodigo.disabled = false;
          btnCodigo.textContent = txt;
        });
    });

    function textoBoton() {
      return estado.modo === 'transferencia' ? 'Enviar comprobante ↗' : 'Pagar con Wompi ↗';
    }

    function mostrarError(msg) {
      errorBox.textContent = msg;
      errorBox.classList.add('activo');
    }
    function limpiarError() {
      errorBox.textContent = '';
      errorBox.classList.remove('activo');
    }

    function datosCompletos() {
      var cliente = inpCliente.value.trim();
      var contacto = inpContacto.value.trim();
      var tienePersona = inpObjNombre.value.trim() || inpObjFecha.value || (inpObjFoto.files && inpObjFoto.files.length);
      var comprobanteOk = estado.modo !== 'transferencia' || (inpComprobante.files && inpComprobante.files.length);
      return checkbox.checked && cliente && contacto && tienePersona && comprobanteOk;
    }

    function actualizarBoton() {
      btnPagar.disabled = !datosCompletos();
      if (datosCompletos()) limpiarError();
    }

    checkbox.addEventListener('change', actualizarBoton);
    [inpCliente, inpContacto, inpObjNombre, inpObjFecha, inpObjFoto, inpComprobante, inpInfo].forEach(function (el) {
      el.addEventListener('input', actualizarBoton);
      el.addEventListener('change', actualizarBoton);
    });

    document.getElementById('wm-cerrar').addEventListener('click', cerrarModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) cerrarModal();
    });

    btnPagar.addEventListener('click', function () {
      if (btnPagar.disabled) return;
      var cliente = inpCliente.value.trim();
      if (!cliente) { mostrarError('Escribe tu nombre y apellido.'); return; }
      var contacto = inpContacto.value.trim();
      if (!contacto) { mostrarError('Escribe tu WhatsApp o red social para entregarte la evidencia.'); return; }
      var foto = inpObjFoto.files && inpObjFoto.files[0];
      if (!inpObjNombre.value.trim() && !inpObjFecha.value && !foto) {
        mostrarError('Proporciona los datos de la persona o sube una foto.');
        return;
      }
      var esTransfer = estado.modo === 'transferencia';
      var comprobante = inpComprobante.files && inpComprobante.files[0];
      if (esTransfer && !comprobante) {
        mostrarError('Sube el comprobante de tu pago.');
        return;
      }
      limpiarError();
      btnPagar.disabled = true;
      var textoOriginal = btnPagar.textContent;
      btnPagar.textContent = 'Procesando...';

      var fd = new FormData();
      fd.append('cliente_nombre', cliente);
      fd.append('contacto', contacto);
      fd.append('objetivo_nombre', inpObjNombre.value.trim());
      fd.append('objetivo_fecha_nac', inpObjFecha.value);
      fd.append('info_extra', inpInfo.value.trim());
      fd.append('producto', estado.nombre);
      fd.append('precio_cop', String(estado.precioCOP));
      fd.append('precio_texto', estado.precioTexto);
      fd.append('precio_usd', estado.precioUSD || '');
      fd.append('metodo', esTransfer ? 'transferencia' : 'wompi');
      if (estado.esHechizo && estado.clave) {
        fd.append('es_hechizo', '1');
        fd.append('hechizo_clave', estado.clave);
        if (estado.codigo) fd.append('codigo', estado.codigo);
      }
      if (foto) fd.append('objetivo_foto', foto);
      if (comprobante) fd.append('comprobante', comprobante);

      fetch('/api/booking', { method: 'POST', body: fd })
        .then(function (resp) {
          return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
        })
        .then(function (res) {
          if (!res.ok || !res.data || !res.data.ok) {
            throw new Error((res.data && res.data.error) || 'No se pudo registrar.');
          }
          var destino = window.location.origin + '/gracias/' + encodeURIComponent(res.data.ref);
          if (esTransfer) {
            window.location.href = destino;
            return;
          }
          var precioFinalServidor = parseInt(res.data.precio_cop, 10) || estado.precioCOP;
          var centavos = precioFinalServidor * 100;
          var url = 'https://checkout.wompi.co/p/'
            + '?public-key=' + encodeURIComponent(WOMPI_PUBLIC_KEY)
            + '&currency=COP'
            + '&amount-in-cents=' + centavos
            + '&reference=' + encodeURIComponent(res.data.ref)
            + '&redirect-url=' + encodeURIComponent(destino);
          window.location.href = url;
        })
        .catch(function (e) {
          mostrarError(e.message || 'No se pudo procesar. Intenta de nuevo.');
          btnPagar.disabled = false;
          btnPagar.textContent = textoOriginal;
        });
    });

    document.getElementById('wm-link-aclaraciones').addEventListener('click', function () {
      cerrarModal();
    });

    function cerrarModal() {
      overlay.classList.remove('activo');
      checkbox.checked = false;
      btnPagar.disabled = true;
      btnPagar.textContent = textoBoton();
      limpiarError();
    }

    return function abrirModal(nombre, precioCOP, precioTexto, precioUSD, modo, hechizoInfo) {
      estado.precioCOP = precioCOP;
      estado.precioUSD = precioUSD || '';
      estado.nombre = nombre;
      estado.precioTexto = precioTexto;
      estado.modo = modo === 'transferencia' ? 'transferencia' : 'wompi';
      estado.esHechizo = !!(hechizoInfo && hechizoInfo.clave);
      estado.clave = estado.esHechizo ? hechizoInfo.clave : '';
      estado.base = precioCOP;
      estado.pctFecha = estado.esHechizo ? (Number(hechizoInfo.pctFecha) || 0) : 0;
      estado.pctCodigo = 0;
      estado.codigo = '';
      modal.classList.toggle('modo-transfer', estado.modo === 'transferencia');
      document.getElementById('wm-nombre-producto').textContent = nombre;
      promoWrap.style.display = estado.esHechizo ? 'block' : 'none';
      inpCodigo.value = '';
      mostrarMsgCodigo('', '');
      actualizarPrecio();
      checkbox.checked = false;
      inpCliente.value = '';
      inpObjNombre.value = '';
      inpObjFecha.value = '';
      inpObjFoto.value = '';
      inpComprobante.value = '';
      inpInfo.value = '';
      limpiarError();
      btnPagar.disabled = true;
      btnPagar.textContent = textoBoton();
      overlay.classList.add('activo');
    };
  }

  function agregarBotones(abrirModal) {
    var spans = document.querySelectorAll('.p');
    spans.forEach(function (span) {
      var texto = span.textContent || '';
      var precioCOP = extraerPrecioCOP(texto);
      if (!precioCOP) return;

      var nombre = extraerNombreProducto(texto);
      if (!nombre) return;

      var precioMatch = texto.match(REGEX_COP);
      var precioUSD = extraerPrecioUSD(texto);
      var precioTexto = precioMatch ? '$' + precioMatch[1] + ' COP' : '$' + precioCOP + ' COP';
      if (precioUSD) precioTexto += ' · ' + precioUSD + ' USD';

      // Los descuentos aplican SOLO a los hechizos (sección #hechizos-section).
      var enHechizos = !!(span.closest && span.closest('#hechizos-section'));
      var clave = enHechizos ? claveHechizo(span.querySelector('strong')) : '';
      var pctFecha = (clave && PROMOS_FECHA[clave]) ? Number(PROMOS_FECHA[clave]) : 0;
      var hechizoInfo = clave ? { clave: clave, pctFecha: pctFecha } : null;

      if (clave && pctFecha > 0) {
        var fin = aplicarDescuentoCliente(precioCOP, pctFecha);
        var badge = document.createElement('span');
        badge.className = 'wm-promo-badge';
        badge.textContent = '−' + pctFecha + '% → $' + fin.toLocaleString('es-CO') + ' COP';
        span.appendChild(badge);
      }

      var btn = document.createElement('button');
      btn.className = 'wm-pay-btn';
      btn.textContent = 'PAGAR ↗';
      btn.setAttribute('aria-label', 'Pagar ' + nombre);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        abrirModal(nombre, precioCOP, precioTexto, precioUSD, 'wompi', hechizoInfo);
      });
      span.appendChild(btn);

      var btnT = document.createElement('button');
      btnT.className = 'wm-pay-btn transfer';
      btnT.textContent = 'TRANSFERENCIA ↗';
      btnT.setAttribute('aria-label', 'Pagar por transferencia ' + nombre);
      btnT.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        abrirModal(nombre, precioCOP, precioTexto, precioUSD, 'transferencia', hechizoInfo);
      });
      span.appendChild(btnT);
    });
  }

  function init() {
    var abrirModal = crearModal();
    // Carga las promociones por fecha activas antes de dibujar botones/precios.
    try {
      fetch('/api/promociones')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.descuentos) PROMOS_FECHA = data.descuentos;
        })
        .catch(function () {})
        .then(function () { agregarBotones(abrirModal); });
    } catch (e) {
      agregarBotones(abrirModal);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
