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

  function extraerPrecioCOP(texto) {
    var match = texto.match(/\$([0-9]+(?:\.[0-9]{3})*(?:\.[0-9]{3})*)\s*(?:\(|[^U])/);
    if (!match) {
      match = texto.match(/\$([0-9]+(?:\.[0-9]{3})*)/);
    }
    if (match) {
      var str = match[1].replace(/\./g, '');
      var val = parseInt(str, 10);
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
      '#wompi-overlay{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);align-items:center;justify-content:center;padding:1rem;}',
      '#wompi-overlay.activo{display:flex;}',
      '#wompi-modal{background:#0e0610;border:1px solid #9C4C6D;border-radius:0.5rem;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;padding:1.8rem 1.6rem;font-family:"Poppins",sans-serif;color:#fff;position:relative;}',
      '#wompi-modal h3{color:#F0A3C3;font-size:0.95rem;font-weight:700;margin-bottom:0.3rem;letter-spacing:0.04em;text-transform:uppercase;}',
      '#wompi-modal .wm-producto{font-size:0.85rem;font-weight:600;color:#fff;margin-bottom:0.15rem;line-height:1.3;}',
      '#wompi-modal .wm-precio{font-size:1.1rem;font-weight:700;color:#F0A3C3;margin-bottom:1.1rem;}',
      '#wompi-modal .wm-divider{border:none;border-top:1px solid #3a1a2a;margin:0.9rem 0;}',
      '#wompi-modal .wm-aclaraciones-titulo{font-size:0.72rem;font-weight:700;color:#9C4C6D;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.5rem;}',
      '#wompi-modal .wm-aclaraciones-lista{background:#1a0820;border-radius:0.3rem;padding:0.8rem 1rem;margin-bottom:0.9rem;max-height:160px;overflow-y:auto;}',
      '#wompi-modal .wm-aclaraciones-lista li{font-size:0.65rem;color:#cca8bb;line-height:1.5;margin-bottom:0.4rem;padding-left:0.8rem;position:relative;}',
      '#wompi-modal .wm-aclaraciones-lista li::before{content:"ꪮꫀ";position:absolute;left:0;color:#9C4C6D;}',
      '#wompi-modal .wm-aclaraciones-link{display:block;font-size:0.65rem;color:#F0A3C3;text-decoration:underline;margin-bottom:1rem;text-align:center;}',
      '#wompi-modal .wm-check-wrap{display:flex;align-items:flex-start;gap:0.6rem;margin-bottom:1.1rem;cursor:pointer;}',
      '#wompi-modal .wm-check-wrap input[type=checkbox]{width:1rem;height:1rem;min-width:1rem;accent-color:#9C4C6D;margin-top:0.15rem;cursor:pointer;}',
      '#wompi-modal .wm-check-wrap label{font-size:0.68rem;color:#e0c0cf;line-height:1.4;cursor:pointer;}',
      '#wompi-modal .wm-check-wrap label strong{color:#F0A3C3;}',
      '#wompi-modal .wm-btn-pagar{display:block;width:100%;padding:0.75rem;background:#9C4C6D;color:#fff;font-family:"Poppins",sans-serif;font-size:0.78rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border:none;border-radius:0.25rem;cursor:pointer;transition:background 0.2s,opacity 0.2s;text-align:center;text-decoration:none;}',
      '#wompi-modal .wm-btn-pagar:hover:not(:disabled){background:#b05680;}',
      '#wompi-modal .wm-btn-pagar:disabled{opacity:0.4;cursor:not-allowed;}',
      '#wompi-modal .wm-btn-cerrar{position:absolute;top:0.8rem;right:1rem;background:none;border:none;color:#9C4C6D;font-size:1.3rem;cursor:pointer;line-height:1;}',
      '#wompi-modal .wm-nota{font-size:0.6rem;color:#7a5568;text-align:center;margin-top:0.7rem;}',
      '.wm-pay-btn{display:inline-block;margin-top:0.55rem;padding:0.28rem 0.75rem;font-family:"Poppins",sans-serif;font-size:0.58rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#fff;background:#9C4C6D;border:none;border-radius:0.2rem;cursor:pointer;transition:background 0.2s;vertical-align:middle;}',
      '.wm-pay-btn:hover{background:#b05680;}',
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
      '<h3>Confirmar pago ↗</h3>',
      '<div class="wm-producto" id="wm-nombre-producto"></div>',
      '<div class="wm-precio" id="wm-precio-producto"></div>',
      '<hr class="wm-divider">',
      '<div class="wm-aclaraciones-titulo">꣑୧ Aclaraciones importantes</div>',
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

      var precioMatch = texto.match(/\$([0-9]+(?:\.[0-9]{3})*(?:\.[0-9]{3})*)/);
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
