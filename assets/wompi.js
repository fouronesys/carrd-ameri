(function () {
  var WOMPI_PUBLIC_KEY = 'pub_test_gjhaZFqRwKaZMBcAEBYOjYNGqzGUyPXx';

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

  function generarReferencia() {
    return 'FRESA-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
  }

  var REGEX_COP = /\$\s*([0-9]{1,3}(?:\.[0-9]{3})+)/;

  function extraerPrecioCOP(texto) {
    var match = texto.match(REGEX_COP);
    if (match) {
      var val = parseInt(match[1].replace(/\./g, ''), 10);
      if (val > 999) return val;
    }
    return null;
  }

  function extraerNombreProducto(texto) {
    var linea = texto.split('\n')[0].trim();
    linea = linea.replace(/[ෆ⟡⊹˚꒦ᶻ𝗓𐰁ೀ𖥔ꗯಎ☼𝜗᭪𐙚✩]/g, '').trim();
    linea = linea.replace(/^\s*/, '').trim();
    if (linea.length > 60) linea = linea.substring(0, 57) + '…';
    return linea;
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
      '#wompi-modal .wm-divider{border:none;border-top:1px solid rgba(194,167,183,0.35);margin:14px 0;}',
      '#wompi-modal .wm-aclaraciones-titulo{text-align:center;font-size:12px;font-weight:700;color:#F0A3C3;letter-spacing:0.04em;margin-bottom:10px;}',
      '#wompi-modal .wm-aclaraciones-titulo span{color:#9C4C6D;}',
      '#wompi-modal .wm-aclaraciones-lista{background:rgba(125,55,84,0.10);border:1px solid rgba(194,167,183,0.25);border-radius:6px;padding:14px 16px;margin-bottom:14px;max-height:160px;overflow-y:auto;}',
      '#wompi-modal .wm-aclaraciones-lista li{font-size:12px;color:#d6b9c8;line-height:1.55;margin-bottom:8px;padding-left:18px;position:relative;}',
      '#wompi-modal .wm-aclaraciones-lista li:last-child{margin-bottom:0;}',
      '#wompi-modal .wm-aclaraciones-lista li::before{content:"ꪮꫀ.";position:absolute;left:0;color:#9C4C6D;font-size:10px;}',
      '#wompi-modal .wm-aclaraciones-lista li strong{color:#F0A3C3;}',
      '#wompi-modal .wm-aclaraciones-link{display:block;font-size:12px;color:#F0A3C3;text-decoration:underline;margin-bottom:16px;text-align:center;}',
      '#wompi-modal .wm-check-wrap{display:flex;align-items:flex-start;gap:10px;margin-bottom:18px;cursor:pointer;background:rgba(125,55,84,0.08);border:1px solid rgba(194,167,183,0.25);border-radius:6px;padding:12px 13px;}',
      '#wompi-modal .wm-check-wrap input[type=checkbox]{width:18px;height:18px;min-width:18px;accent-color:#7D3754;margin-top:2px;cursor:pointer;}',
      '#wompi-modal .wm-check-wrap label{font-size:12px;color:#e0c0cf;line-height:1.45;cursor:pointer;}',
      '#wompi-modal .wm-check-wrap label strong{color:#F0A3C3;}',
      '#wompi-modal .wm-btn-pagar{display:block;width:100%;padding:13px;background-color:#7D3754;background-image:linear-gradient(360deg, rgba(0,0,0,0.72) 0%, rgba(125,55,84,0.012) 100%);color:#fff;font-family:"Poppins",sans-serif;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border:solid 1px #C2A7B7;border-radius:48px;cursor:pointer;transition:transform 0.125s ease,opacity 0.2s;text-align:center;text-decoration:none;}',
      '#wompi-modal .wm-btn-pagar:hover:not(:disabled){transform:translateY(-1px);}',
      '#wompi-modal .wm-btn-pagar:disabled{opacity:0.35;cursor:not-allowed;border-color:rgba(194,167,183,0.4);}',
      '#wompi-modal .wm-btn-cerrar{position:absolute;top:12px;right:14px;background:none;border:none;color:#9C4C6D;font-size:22px;cursor:pointer;line-height:1;transition:color 0.15s;}',
      '#wompi-modal .wm-btn-cerrar:hover{color:#F0A3C3;}',
      '#wompi-modal .wm-nota{font-size:10px;color:#9c7788;text-align:center;margin-top:11px;}',
      '.wm-pay-btn{display:inline-block;margin-top:0.5rem;padding:0.22rem 0.7rem;font-family:"Poppins",sans-serif;font-size:0.48rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#fff;background-color:#7D3754;background-image:linear-gradient(360deg, rgba(0,0,0,0.72) 0%, rgba(125,55,84,0.012) 100%);border:solid 1px #C2A7B7;border-radius:3rem;cursor:pointer;transition:transform 0.125s ease;vertical-align:middle;}',
      '.wm-pay-btn:hover{transform:translateY(-1px);}',
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

    modal.innerHTML = [
      '<button class="wm-btn-cerrar" id="wm-cerrar" aria-label="Cerrar">✕</button>',
      '<div class="wm-deco">꣑୧・┈</div>',
      '<h3><span>♡</span> Confirmar pago <span>♡</span></h3>',
      '<div class="wm-producto" id="wm-nombre-producto"></div>',
      '<div class="wm-precio" id="wm-precio-producto"></div>',
      '<hr class="wm-divider">',
      '<div class="wm-aclaraciones-titulo"><span>｡ ˚ ︶︶ꔫ</span> Aclaraciones <span>ꔫ︶︶ ₊ ˚</span></div>',
      '<ul class="wm-aclaraciones-lista">' + listItems + '</ul>',
      '<a class="wm-aclaraciones-link" href="#aclaraciones" id="wm-link-aclaraciones">→ Leer todas las aclaraciones completas</a>',
      '<hr class="wm-divider">',
      '<label class="wm-check-wrap">',
      '  <input type="checkbox" id="wm-acepto">',
      '  <span>He leído <strong>todas las aclaraciones</strong> y las acepto. Entiendo que <strong>no hay reembolsos</strong> una vez realizado el pago y que el precio no incluye comisión.</span>',
      '</label>',
      '<button class="wm-btn-pagar" id="wm-btn-pagar" disabled>Pagar con Wompi ↗</button>',
      '<p class="wm-nota">Serás redirigido/a al checkout seguro de Wompi</p>'
    ].join('');

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var estado = { precioCOP: 0, nombre: '' };

    document.getElementById('wm-cerrar').addEventListener('click', cerrarModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) cerrarModal();
    });

    var checkbox = document.getElementById('wm-acepto');
    var btnPagar = document.getElementById('wm-btn-pagar');

    checkbox.addEventListener('change', function () {
      btnPagar.disabled = !checkbox.checked;
    });

    btnPagar.addEventListener('click', function () {
      if (!checkbox.checked) return;
      var centavos = estado.precioCOP * 100;
      var ref = generarReferencia();
      var url = 'https://checkout.wompi.co/p/'
        + '?public-key=' + encodeURIComponent(WOMPI_PUBLIC_KEY)
        + '&currency=COP'
        + '&amount-in-cents=' + centavos
        + '&reference=' + encodeURIComponent(ref)
        + '&redirect-url=' + encodeURIComponent(window.location.href);
      window.open(url, '_blank', 'noopener');
    });

    document.getElementById('wm-link-aclaraciones').addEventListener('click', function () {
      cerrarModal();
    });

    function cerrarModal() {
      overlay.classList.remove('activo');
      checkbox.checked = false;
      btnPagar.disabled = true;
    }

    return function abrirModal(nombre, precioCOP, precioTexto) {
      estado.precioCOP = precioCOP;
      estado.nombre = nombre;
      document.getElementById('wm-nombre-producto').textContent = nombre;
      document.getElementById('wm-precio-producto').textContent = precioTexto;
      checkbox.checked = false;
      btnPagar.disabled = true;
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
      var precioTexto = precioMatch ? '$' + precioMatch[1] + ' COP' : '$' + precioCOP + ' COP';

      var btn = document.createElement('button');
      btn.className = 'wm-pay-btn';
      btn.textContent = 'PAGAR ↗';
      btn.setAttribute('aria-label', 'Pagar ' + nombre);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        abrirModal(nombre, precioCOP, precioTexto);
      });

      span.appendChild(btn);
    });
  }

  function init() {
    var abrirModal = crearModal();
    agregarBotones(abrirModal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
