'use strict';

const COLORES = {
  fondo: '#100109',
  panel: '#1a0710',
  borde: '#C2A7B7',
  vino: '#7D3754',
  vinoClaro: '#9C4C6D',
  rosa: '#F0A3C3',
  texto: '#f4e6ee',
  tenue: '#c9a9ba',
};

function escaparHtml(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatearFecha(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
  } catch (e) {
    return iso;
  }
}

function baseEstilos() {
  return [
    '*{box-sizing:border-box;}',
    'body{margin:0;font-family:"Poppins",system-ui,sans-serif;background:' + COLORES.fondo + ';',
    'background-image:linear-gradient(180deg, rgba(125,55,84,0.12) 0%, rgba(0,0,0,0) 60%);color:' + COLORES.texto + ';min-height:100vh;}',
    'a{color:' + COLORES.rosa + ';}',
    '.wrap{max-width:1000px;margin:0 auto;padding:28px 18px 60px;}',
    '.deco{color:' + COLORES.vino + ';letter-spacing:0.2em;font-size:12px;text-align:center;}',
  ].join('');
}

/* ---------- Línea de tiempo del estado (reutilizable) ---------- */
// CSS de la línea de tiempo, para incrustar en el <style> de las páginas.
function estilosTimeline() {
  return [
    '.tl{display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin:4px 0 22px;padding:0 4px;}',
    '.tl-paso{flex:1;position:relative;text-align:center;}',
    '.tl-paso::before{content:"";position:absolute;top:15px;left:-50%;width:100%;height:2px;background:rgba(194,167,183,0.28);z-index:0;}',
    '.tl-paso:first-child::before{display:none;}',
    '.tl-paso.hecho::before,.tl-paso.activo::before{background:' + COLORES.rosa + ';}',
    '.tl-dot{position:relative;z-index:1;width:32px;height:32px;line-height:30px;margin:0 auto 8px;border-radius:50%;',
    'border:1px solid rgba(194,167,183,0.4);background:rgba(125,55,84,0.18);color:' + COLORES.tenue + ';font-size:14px;font-weight:700;}',
    '.tl-paso.hecho .tl-dot{background:' + COLORES.rosa + ';border-color:' + COLORES.rosa + ';color:#3a0a1f;box-shadow:0 0 12px rgba(240,163,195,0.5);}',
    '.tl-paso.activo .tl-dot{border-color:' + COLORES.rosa + ';color:' + COLORES.rosa + ';animation:tlPulse 1.8s ease-in-out infinite;}',
    '.tl-paso.fallido .tl-dot{background:rgba(229,123,160,0.2);border-color:#e57ba0;color:#f3b6cd;}',
    '@keyframes tlPulse{0%,100%{box-shadow:0 0 0 0 rgba(240,163,195,0);}50%{box-shadow:0 0 0 6px rgba(240,163,195,0.18);}}',
    '.tl-label{font-size:10.5px;line-height:1.3;color:' + COLORES.tenue + ';}',
    '.tl-paso.hecho .tl-label,.tl-paso.activo .tl-label{color:' + COLORES.texto + ';}',
    '@media (prefers-reduced-motion: reduce){.tl-paso.activo .tl-dot{animation:none;}}',
  ].join('');
}

// Devuelve el HTML de una línea de tiempo con 3 pasos (recibido → pago →
// realizado), calculada a partir del estado del pedido y de si el trabajo se hizo.
function lineaDeTiempo(opciones) {
  const estado = (opciones && opciones.estado) || '';
  const trabajoHecho = !!(opciones && opciones.trabajoHecho);
  const rechazado = estado === 'rechazado';
  const pagoHecho = estado === 'agendado';
  const enRevision = estado === 'comprobante_recibido';
  const pagoActivo = enRevision || estado === 'verificando';

  const pasos = [
    { label: 'Pedido recibido', clase: 'hecho', icono: '✓' },
    {
      label: rechazado ? 'Pago rechazado' : (pagoHecho ? 'Pago confirmado' : (enRevision ? 'Comprobante en revisión' : 'Esperando pago')),
      clase: rechazado ? 'fallido' : (pagoHecho ? 'hecho' : (pagoActivo ? 'activo' : 'pendiente')),
      icono: rechazado ? '✕' : (pagoHecho ? '✓' : '2'),
    },
    {
      label: trabajoHecho ? 'Trabajo realizado' : 'Trabajo por realizar',
      clase: trabajoHecho ? 'hecho' : (pagoHecho ? 'activo' : 'pendiente'),
      icono: trabajoHecho ? '✿' : '3',
    },
  ];

  return '<div class="tl">' + pasos.map(function (p) {
    return '<div class="tl-paso ' + p.clase + '">' +
      '<div class="tl-dot">' + p.icono + '</div>' +
      '<div class="tl-label">' + escaparHtml(p.label) + '</div></div>';
  }).join('') + '</div>';
}

// Botón de contacto directo por WhatsApp (o null si no hay número configurado).
function botonWhatsapp(numero, texto) {
  const num = String(numero || '').replace(/[^0-9]/g, '');
  if (!num) return '';
  const msg = encodeURIComponent(texto || '¡Hola! Acabo de hacer un pedido en Fresatanika ✦');
  return '<a class="btn-wa" href="https://wa.me/' + num + '?text=' + msg + '" target="_blank" rel="noopener">' +
    'Escríbenos por WhatsApp</a>';
}

// Estilo del botón de WhatsApp, para incrustar en el <style>.
function estilosWhatsapp() {
  return '.btn-wa{display:inline-block;margin:0 0 14px;padding:11px 22px;border-radius:40px;background:linear-gradient(135deg,#25D366,#128C7E);' +
    'color:#fff;text-decoration:none;font-weight:700;font-size:12.5px;letter-spacing:0.03em;border:1px solid rgba(255,255,255,0.25);' +
    'box-shadow:0 6px 18px rgba(18,140,126,0.4);transition:transform .15s ease;}.btn-wa:hover{transform:translateY(-1px);}';
}

// Recuadro de beneficios reales de crear cuenta, para las páginas de gracias.
function bloqueBeneficios(plural) {
  const svc = plural ? 'tus servicios' : 'tu servicio';
  return '<div style="text-align:left;background:rgba(240,163,195,0.10);border:1px solid rgba(240,163,195,0.35);border-radius:12px;padding:15px 17px;margin:0 0 20px;">' +
    '<div style="font-size:13.5px;font-weight:900;color:' + COLORES.rosa + ';margin:0 0 10px;">Crea tu cuenta y gana beneficios</div>' +
    '<div style="font-size:12.5px;line-height:1.5;color:#e8c9d8;display:flex;flex-direction:column;gap:7px;">' +
    '<div>✦ <strong>Círculo íntimo:</strong> suma un sello por cada consulta y desbloquea una lectura de regalo.</div>' +
    '<div>✦ <strong>Seguimiento en vivo</strong> del estado de ' + svc + ' desde “Mis consultas”.</div>' +
    '<div>✦ <strong>Historial y evidencias</strong> de tus trabajos siempre a mano.</div>' +
    '<div>✦ <strong>Avisos por correo</strong> cuando tu trabajo quede agendado o realizado.</div>' +
    '</div></div>';
}

/* ---------- Página de gracias / confirmación de pago ---------- */
function paginaGracias(opciones) {
  const estado = opciones.estado;
  const reg = opciones.reg || {};
  let titulo, mensaje, icono, colorIcono;

  if (estado === 'agendado') {
    icono = '✦';
    colorIcono = COLORES.rosa;
    titulo = '¡Pago confirmado y agendado!';
    mensaje = 'Tu pago fue aprobado y tu trabajo quedó agendado. Pronto nos pondremos en contacto contigo. Gracias por confiar en Fresatanika.';
  } else if (estado === 'rechazado') {
    icono = '✕';
    colorIcono = '#e57ba0';
    titulo = 'El pago no se completó';
    mensaje = 'Tu pago fue rechazado o cancelado. Si crees que es un error, intenta nuevamente desde el catálogo.';
  } else if (estado === 'no_encontrado') {
    icono = '?';
    colorIcono = COLORES.vinoClaro;
    titulo = 'Agendamiento no encontrado';
    mensaje = 'No encontramos este registro. Vuelve al catálogo e inténtalo de nuevo.';
  } else if (estado === 'comprobante_recibido') {
    icono = '✓';
    colorIcono = COLORES.rosa;
    titulo = '¡Comprobante recibido!';
    mensaje = 'Recibimos tu comprobante de pago. Vamos a verificarlo manualmente y te avisaremos por tu contacto cuando tu trabajo quede confirmado. Gracias por confiar en Fresatanika.';
  } else {
    icono = '⏳';
    colorIcono = COLORES.vinoClaro;
    titulo = 'Estamos verificando tu pago';
    mensaje = 'Si ya realizaste el pago, en unos instantes se confirmará. Puedes actualizar esta página. Si el pago quedó pendiente, no se agenda hasta que sea aprobado.';
  }

  const detalle = reg.producto
    ? ['<div class="detalle">',
        '<div class="fila"><span>Servicio</span><strong>' + escaparHtml(reg.producto) + '</strong></div>',
        reg.precio_texto ? '<div class="fila"><span>Valor</span><strong>' + escaparHtml(reg.precio_texto) + '</strong></div>' : '',
        reg.adelanto ? '<div class="fila"><span>Adelanto</span><strong>Urgencia · entrega en máx. 2 días</strong></div>' : '',
        reg.cliente_nombre ? '<div class="fila"><span>A nombre de</span><strong>' + escaparHtml(reg.cliente_nombre) + '</strong></div>' : '',
        reg.contacto ? '<div class="fila"><span>Contacto (evidencia)</span><strong>' + escaparHtml(reg.contacto) + '</strong></div>' : '',
        reg.ref ? '<div class="fila"><span>Referencia</span><strong>' + escaparHtml(reg.ref) + '</strong></div>' : '',
       '</div>'].join('')
    : '';

  const mostrarTimeline = estado !== 'no_encontrado';
  const timeline = mostrarTimeline
    ? lineaDeTiempo({ estado: estado, trabajoHecho: !!reg.trabajo_hecho })
    : '';
  const whatsapp = (estado === 'agendado' || estado === 'comprobante_recibido' || estado === 'verificando')
    ? botonWhatsapp(opciones.whatsapp, '¡Hola! Acabo de hacer un pedido en Fresatanika ✦' + (reg.ref ? ' (ref ' + reg.ref + ')' : ''))
    : '';

  const recomendar = (estado === 'agendado' || estado === 'comprobante_recibido') && !reg.cliente_id;
  const bloqueRegistro = recomendar ? bloqueBeneficios(false) : '';

  return [
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Fresatanika — Confirmación</title>',
    '<link href="https://fonts.googleapis.com/css2?display=swap&family=Poppins:wght@300;400;700;900" rel="stylesheet">',
    '<style>', baseEstilos(),
    '.card{max-width:460px;margin:8vh auto 0;background:' + COLORES.panel + ';border:1px solid ' + COLORES.borde + ';',
    'box-shadow:0 0 0 4px rgba(125,55,84,0.15),0 24px 60px rgba(0,0,0,0.6);border-radius:14px;padding:34px 28px;text-align:center;}',
    '.icono{width:64px;height:64px;line-height:64px;border-radius:50%;margin:0 auto 16px;font-size:28px;',
    'border:1px solid ' + COLORES.borde + ';background:rgba(125,55,84,0.18);}',
    'h1{font-size:22px;font-weight:900;color:' + COLORES.rosa + ';margin:6px 0 12px;letter-spacing:0.02em;}',
    'p.msg{font-size:14px;line-height:1.6;color:' + COLORES.tenue + ';margin:0 0 20px;}',
    '.detalle{text-align:left;background:rgba(125,55,84,0.10);border:1px solid rgba(194,167,183,0.25);border-radius:10px;padding:14px 16px;margin:0 0 22px;}',
    '.fila{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:6px 0;border-bottom:1px dashed rgba(194,167,183,0.18);}',
    '.fila:last-child{border-bottom:none;}',
    '.fila span{color:' + COLORES.tenue + ';}',
    '.fila strong{color:' + COLORES.texto + ';text-align:right;}',
    '.btn{display:inline-block;padding:12px 26px;border-radius:40px;background:' + COLORES.vino + ';color:#fff;',
    'text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;border:1px solid ' + COLORES.borde + ';}',
    estilosTimeline(), estilosWhatsapp(),
    '</style></head><body>',
    '<div class="card">',
    '<div class="deco">꣑୧・┈</div>',
    '<div class="icono" style="color:' + colorIcono + '">' + icono + '</div>',
    '<h1>' + escaparHtml(titulo) + '</h1>',
    '<p class="msg">' + escaparHtml(mensaje) + '</p>',
    timeline,
    detalle,
    whatsapp,
    bloqueRegistro,
    '<a class="btn" href="/">← Volver al catálogo</a>',
    '</div></body></html>',
  ].join('');
}

/* ---------- Página de gracias / confirmación de un PEDIDO (carrito) ---------- */
function paginaGraciasPedido(opciones) {
  const estado = opciones.estado;
  const registros = opciones.registros || [];
  const total = opciones.total || 0;
  const pedidoRef = opciones.pedidoRef || '';
  const esTransferencia = opciones.metodo === 'transferencia';
  let titulo, mensaje, icono, colorIcono;

  if (estado === 'agendado') {
    icono = '✦';
    colorIcono = COLORES.rosa;
    titulo = '¡Pago confirmado y agendado!';
    mensaje = 'Tu pago fue aprobado y todos los servicios de tu pedido quedaron agendados. Pronto nos pondremos en contacto contigo. Gracias por confiar en Fresatanika.';
  } else if (estado === 'rechazado') {
    icono = '✕';
    colorIcono = '#e57ba0';
    titulo = 'El pago no se completó';
    mensaje = 'Tu pago fue rechazado o cancelado. Si crees que es un error, intenta nuevamente desde el catálogo.';
  } else if (estado === 'comprobante_recibido') {
    icono = '✓';
    colorIcono = COLORES.rosa;
    titulo = '¡Comprobante recibido!';
    mensaje = 'Recibimos tu comprobante de pago. Vamos a verificarlo manualmente y te avisaremos por tu contacto cuando tu pedido quede confirmado. Gracias por confiar en Fresatanika.';
  } else {
    icono = '⏳';
    colorIcono = COLORES.vinoClaro;
    titulo = 'Estamos verificando tu pago';
    mensaje = 'Si ya realizaste el pago, en unos instantes se confirmará. Puedes actualizar esta página. Si el pago quedó pendiente, no se agenda hasta que sea aprobado.';
  }

  const filasServicios = registros.map(function (r) {
    const nota = r.adelanto === 'solo' ? ' · adelanto' : (r.adelanto === 'extra' ? ' · extra' : '');
    return '<div class="fila"><span>' + escaparHtml(r.producto || 'Servicio') + escaparHtml(nota) + '</span>' +
      '<strong>' + escaparHtml(r.precio_texto || ('$' + (r.precio_cop || 0) + ' COP')) + '</strong></div>';
  }).join('');

  const detalle = '<div class="detalle">' +
    filasServicios +
    '<div class="fila total"><span>Total del pedido' + (esTransferencia ? '' : ' (incluye comisión Wompi)') + '</span>' +
    '<strong>$' + Number(total).toLocaleString('es-CO') + ' COP</strong></div>' +
    (pedidoRef ? '<div class="fila"><span>Referencia</span><strong>' + escaparHtml(pedidoRef) + '</strong></div>' : '') +
    '</div>';

  // El carrito del navegador se vacía SOLO cuando el pago quedó confirmado
  // ('agendado') o cuando el comprobante ya fue enviado ('comprobante_recibido').
  // Si el pago está pendiente o fue rechazado, se conserva para reintentar.
  const limpiarCarrito = (estado === 'agendado' || estado === 'comprobante_recibido');
  const scriptCarrito = limpiarCarrito
    ? '<script>try{localStorage.removeItem("fresa_carrito_v1");}catch(e){}</script>'
    : '';

  const recomendar = (estado === 'agendado' || estado === 'comprobante_recibido') && !(registros[0] && registros[0].cliente_id);
  const bloqueRegistro = recomendar ? bloqueBeneficios(true) : '';

  const trabajoHechoPedido = registros.length > 0 && registros.every(function (r) { return r.trabajo_hecho; });
  const timeline = lineaDeTiempo({ estado: estado, trabajoHecho: trabajoHechoPedido });
  const whatsapp = (estado === 'agendado' || estado === 'comprobante_recibido' || estado === 'verificando')
    ? botonWhatsapp(opciones.whatsapp, '¡Hola! Acabo de hacer un pedido en Fresatanika ✦' + (pedidoRef ? ' (ref ' + pedidoRef + ')' : ''))
    : '';

  return [
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Fresatanika — Confirmación del pedido</title>',
    '<link href="https://fonts.googleapis.com/css2?display=swap&family=Poppins:wght@300;400;700;900" rel="stylesheet">',
    '<style>', baseEstilos(),
    '.card{max-width:500px;margin:8vh auto 0;background:' + COLORES.panel + ';border:1px solid ' + COLORES.borde + ';',
    'box-shadow:0 0 0 4px rgba(125,55,84,0.15),0 24px 60px rgba(0,0,0,0.6);border-radius:14px;padding:34px 28px;text-align:center;}',
    '.icono{width:64px;height:64px;line-height:64px;border-radius:50%;margin:0 auto 16px;font-size:28px;',
    'border:1px solid ' + COLORES.borde + ';background:rgba(125,55,84,0.18);}',
    'h1{font-size:22px;font-weight:900;color:' + COLORES.rosa + ';margin:6px 0 12px;letter-spacing:0.02em;}',
    'p.msg{font-size:14px;line-height:1.6;color:' + COLORES.tenue + ';margin:0 0 20px;}',
    '.detalle{text-align:left;background:rgba(125,55,84,0.10);border:1px solid rgba(194,167,183,0.25);border-radius:10px;padding:14px 16px;margin:0 0 22px;}',
    '.fila{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:6px 0;border-bottom:1px dashed rgba(194,167,183,0.18);}',
    '.fila:last-child{border-bottom:none;}',
    '.fila span{color:' + COLORES.tenue + ';}',
    '.fila strong{color:' + COLORES.texto + ';text-align:right;}',
    '.fila.total{border-top:1px solid rgba(194,167,183,0.35);margin-top:4px;padding-top:10px;}',
    '.fila.total span,.fila.total strong{color:' + COLORES.rosa + ';font-weight:700;}',
    '.btn{display:inline-block;padding:12px 26px;border-radius:40px;background:' + COLORES.vino + ';color:#fff;',
    'text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;border:1px solid ' + COLORES.borde + ';}',
    estilosTimeline(), estilosWhatsapp(),
    '</style></head><body>',
    '<div class="card">',
    '<div class="deco">꣑୧・┈</div>',
    '<div class="icono" style="color:' + colorIcono + '">' + icono + '</div>',
    '<h1>' + escaparHtml(titulo) + '</h1>',
    '<p class="msg">' + escaparHtml(mensaje) + '</p>',
    timeline,
    detalle,
    whatsapp,
    bloqueRegistro,
    '<a class="btn" href="/">← Volver al catálogo</a>',
    '</div>',
    scriptCarrito,
    '</body></html>',
  ].join('');
}

/* ---------- Panel de administración: login ---------- */
function adminLogin(opciones) {
  const error = (opciones && opciones.error) || '';
  const noConfig = (opciones && opciones.noConfig) || false;
  return [
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Fresatanika — Acceso</title>',
    '<meta name="robots" content="noindex,nofollow">',
    '<link href="https://fonts.googleapis.com/css2?display=swap&family=Poppins:wght@300;400;700;900" rel="stylesheet">',
    '<style>', baseEstilos(),
    '.card{max-width:360px;margin:12vh auto 0;background:' + COLORES.panel + ';border:1px solid ' + COLORES.borde + ';',
    'box-shadow:0 0 0 4px rgba(125,55,84,0.15),0 24px 60px rgba(0,0,0,0.6);border-radius:14px;padding:32px 26px;}',
    'h1{font-size:19px;font-weight:900;color:' + COLORES.rosa + ';text-align:center;margin:6px 0 20px;text-transform:uppercase;letter-spacing:0.06em;}',
    'label{display:block;font-size:12px;color:' + COLORES.tenue + ';margin-bottom:7px;}',
    'input{width:100%;padding:12px 13px;border-radius:8px;border:1px solid ' + COLORES.borde + ';background:rgba(0,0,0,0.35);',
    'color:#fff;font-size:14px;font-family:inherit;margin-bottom:16px;}',
    'button{width:100%;padding:12px;border-radius:40px;background:' + COLORES.vino + ';color:#fff;font-weight:700;',
    'font-size:13px;letter-spacing:0.06em;text-transform:uppercase;border:1px solid ' + COLORES.borde + ';cursor:pointer;}',
    '.err{background:rgba(229,123,160,0.14);border:1px solid rgba(229,123,160,0.4);color:#f3b6cd;',
    'font-size:12px;padding:10px 12px;border-radius:8px;margin-bottom:16px;text-align:center;}',
    '</style></head><body>',
    '<form class="card" method="POST" action="/admin/login">',
    '<div class="deco">꣑୧・┈</div>',
    '<h1>♡ Panel Fresatanika ♡</h1>',
    noConfig ? '<div class="err">El acceso no está configurado. Define la variable ADMIN_PASSWORD.</div>' : '',
    error ? '<div class="err">' + escaparHtml(error) + '</div>' : '',
    '<label for="usuario">Usuario <span style="color:' + COLORES.tenue + ';font-weight:400;">(opcional)</span></label>',
    '<input type="text" id="usuario" name="usuario" autocomplete="username" autocapitalize="none" placeholder="Tu usuario">',
    '<label for="password">Contraseña</label>',
    '<input type="password" id="password" name="password" autocomplete="current-password" required>',
    '<button type="submit">Entrar</button>',
    '</form></body></html>',
  ].join('');
}

/* ---------- Script del panel (búsqueda, filtros, lightbox) ---------- */
function scriptAdmin() {
  return [
    'function verImagen(src){var lb=document.getElementById("lightbox");document.getElementById("lightbox-img").src=src;lb.classList.add("activo");}',
    'function cerrarImagen(){document.getElementById("lightbox").classList.remove("activo");}',
    'document.addEventListener("keydown",function(e){if(e.key==="Escape")cerrarImagen();});',
    '(function(){',
    '  var buscador=document.getElementById("buscador");',
    '  var filtros=document.querySelectorAll(".filtro");',
    '  var filas=Array.prototype.slice.call(document.querySelectorAll("#cuerpo-tabla tr[data-estado]"));',
    '  var sinRes=document.getElementById("sin-resultados");',
    '  var filtroActivo="todos";',
    '  function aplicar(){',
    '    var q=(buscador&&buscador.value?buscador.value:"").trim().toLowerCase();',
    '    var visibles=0;',
    '    filas.forEach(function(tr){',
    '      var okEstado=filtroActivo==="todos"||tr.getAttribute("data-estado")===filtroActivo;',
    '      var okBusca=!q||(tr.getAttribute("data-buscar")||"").indexOf(q)!==-1;',
    '      var mostrar=okEstado&&okBusca;',
    '      tr.style.display=mostrar?"":"none";',
    '      if(mostrar)visibles++;',
    '    });',
    '    if(sinRes)sinRes.style.display=visibles===0?"block":"none";',
    '  }',
    '  if(buscador)buscador.addEventListener("input",aplicar);',
    '  filtros.forEach(function(btn){',
    '    btn.addEventListener("click",function(){',
    '      filtros.forEach(function(b){b.classList.remove("activo");});',
    '      btn.classList.add("activo");',
    '      filtroActivo=btn.getAttribute("data-filtro");',
    '      aplicar();',
    '    });',
    '  });',
    '})();',
    'function togglearObjetivo(sel,id){var c=document.getElementById(id);if(c)c.style.display=(sel.value==="especificos")?"block":"none";}',
    'function toggleEditar(ref){var r=document.getElementById("edit-"+ref);if(r){var v=(r.style.display==="none"||!r.style.display);r.style.display=v?"table-row":"none";}}',
  ].join('');
}

/* ---------- Panel de administración: promociones ---------- */
function seccionPromociones(opciones) {
  const rol = (opciones && opciones.rol) || 'admin';
  // Toda la gestión de promociones (por fecha y códigos) es solo del administrador.
  if (rol !== 'admin') return '';
  const hechizos = (opciones && opciones.hechizos) || [];
  const promos = (opciones && opciones.promos) || [];
  const codigos = (opciones && opciones.codigos) || [];

  const opcionesHechizos = hechizos.map(function (h) {
    return '<option value="' + escaparHtml(h.clave) + '">' + escaparHtml(h.nombre) +
      ' ($' + (h.precio_cop || 0).toLocaleString('es-CO') + ')</option>';
  }).join('');

  const nombrePorClave = {};
  hechizos.forEach(function (h) { nombrePorClave[h.clave] = h.nombre; });

  const objetivoTexto = function (objetivo) {
    if (objetivo === 'todos' || !objetivo) return 'Todos los hechizos';
    if (Array.isArray(objetivo)) {
      return objetivo.map(function (c) { return nombrePorClave[c] || c; }).join(', ');
    }
    return String(objetivo);
  };

  const selectHechizos = function (idContenedor) {
    return '<div class="promo-especificos" id="' + idContenedor + '" style="display:none">' +
      '<label class="promo-label">Elige los hechizos (mantén Ctrl/Cmd para varios)</label>' +
      '<select name="hechizos" multiple size="6" class="promo-select-multi">' + opcionesHechizos + '</select>' +
      '</div>';
  };

  // Promociones por fecha
  const filasPromos = promos.length
    ? promos.map(function (p) {
      return '<li class="promo-item"><div><b>-' + escaparHtml(String(p.porcentaje)) + '%</b> · ' +
        escaparHtml(p.desde || '') + ' → ' + escaparHtml(p.hasta || '') +
        '<div class="promo-obj">' + escaparHtml(objetivoTexto(p.objetivo)) + '</div></div>' +
        '<form method="POST" action="/admin/promo/eliminar/' + encodeURIComponent(p.id) + '" style="margin:0" ' +
        'onsubmit="return confirm(\'¿Eliminar esta promoción?\');">' +
        '<button class="btn-acc btn-del" type="submit">Eliminar</button></form></li>';
    }).join('')
    : '<li class="promo-vacio">No hay promociones por fecha.</li>';

  const cardPromos = '<div class="promo-card">' +
    '<h3>Promociones por fecha</h3>' +
    '<p class="promo-sub">Aplican automáticamente a los hechizos durante el rango de fechas.</p>' +
    '<form method="POST" action="/admin/promo" class="promo-form">' +
    '<div class="promo-fila">' +
    '<label class="promo-label">Descuento %<input class="promo-input" type="number" name="porcentaje" min="1" max="100" required></label>' +
    '<label class="promo-label">Desde<input class="promo-input" type="date" name="desde" required></label>' +
    '<label class="promo-label">Hasta<input class="promo-input" type="date" name="hasta" required></label>' +
    '<label class="promo-label">Aplica a<select class="promo-input" name="objetivo_tipo" onchange="togglearObjetivo(this,\'promo-fecha-hechizos\')">' +
    '<option value="todos">Todos los hechizos</option><option value="especificos">Hechizos específicos</option></select></label>' +
    '</div>' + selectHechizos('promo-fecha-hechizos') +
    '<button class="btn-exp excel promo-btn" type="submit">＋ Crear promoción</button>' +
    '</form>' +
    '<ul class="promo-lista">' + filasPromos + '</ul></div>';

  // Códigos promocionales (solo admin)
  let cardCodigos = '';
  if (rol === 'admin') {
    const filasCodigos = codigos.length
      ? codigos.map(function (c) {
        const limite = Number(c.limite_usos) || 0;
        const usos = Number(c.usos) || 0;
        const usosTexto = limite > 0
          ? usos + ' / ' + limite + ' usos' + (usos >= limite ? ' · agotado' : '')
          : usos + ' usos · ilimitado';
        return '<li class="promo-item"><div><b>' + escaparHtml(c.codigo || '') + '</b> · -' +
          escaparHtml(String(c.porcentaje)) + '% · ' + escaparHtml(c.desde || '') + ' → ' + escaparHtml(c.hasta || '') +
          '<div class="promo-obj">' + escaparHtml(objetivoTexto(c.objetivo)) + '</div>' +
          '<div class="promo-usos' + (limite > 0 && usos >= limite ? ' agotado' : '') + '">' + escaparHtml(usosTexto) + '</div></div>' +
          '<form method="POST" action="/admin/codigo/eliminar/' + encodeURIComponent(c.id) + '" style="margin:0" ' +
          'onsubmit="return confirm(\'¿Eliminar este código?\');">' +
          '<button class="btn-acc btn-del" type="submit">Eliminar</button></form></li>';
      }).join('')
      : '<li class="promo-vacio">No hay códigos promocionales.</li>';

    cardCodigos = '<div class="promo-card">' +
      '<h3>Códigos promocionales</h3>' +
      '<p class="promo-sub">El cliente los escribe al reservar. Válidos dentro del rango de fechas.</p>' +
      '<form method="POST" action="/admin/codigo" class="promo-form">' +
      '<div class="promo-fila">' +
      '<label class="promo-label">Código<input class="promo-input" type="text" name="codigo" maxlength="40" required></label>' +
      '<label class="promo-label">Descuento %<input class="promo-input" type="number" name="porcentaje" min="1" max="100" required></label>' +
      '<label class="promo-label">Desde<input class="promo-input" type="date" name="desde" required></label>' +
      '<label class="promo-label">Hasta<input class="promo-input" type="date" name="hasta" required></label>' +
      '<label class="promo-label">Límite de usos<input class="promo-input" type="number" name="limite_usos" min="0" value="0" title="0 = usos ilimitados"></label>' +
      '<label class="promo-label">Aplica a<select class="promo-input" name="objetivo_tipo" onchange="togglearObjetivo(this,\'codigo-hechizos\')">' +
      '<option value="todos">Todos los hechizos</option><option value="especificos">Hechizos específicos</option></select></label>' +
      '</div>' + selectHechizos('codigo-hechizos') +
      '<button class="btn-exp excel promo-btn" type="submit">＋ Crear código</button>' +
      '</form>' +
      '<ul class="promo-lista">' + filasCodigos + '</ul></div>';
  }

  return '<section class="promos-panel">' +
    '<h2 class="promos-titulo">✦ Promociones <span>(solo hechizos)</span></h2>' +
    '<div class="promo-grid">' + cardPromos + cardCodigos + '</div></section>';
}

/* ---------- Panel de administración: usuarios y auditoría (solo admin) ---------- */
function seccionUsuarios(opciones) {
  const rol = (opciones && opciones.rol) || 'admin';
  if (rol !== 'admin') return '';
  const usuarios = (opciones && opciones.usuarios) || [];
  const accesos = (opciones && opciones.accesos) || [];
  const usuarioActualId = (opciones && opciones.usuarioId) || '';

  const filasUsuarios = usuarios.length
    ? usuarios.map(function (u) {
      const rolTxt = u.rol === 'admin' ? 'Administrador' : 'Asistente';
      const esActual = u.id && u.id === usuarioActualId;
      const eliminar = esActual
        ? '<span class="acc-bloq" title="No puedes eliminar tu propia cuenta.">🔒 Tu cuenta</span>'
        : '<form method="POST" action="/admin/usuarios/eliminar/' + encodeURIComponent(u.id) + '" style="margin:0" ' +
          'onsubmit="return confirm(\'¿Eliminar este usuario? No podrá volver a entrar.\');">' +
          '<button class="btn-acc btn-del" type="submit">Eliminar</button></form>';
      return '<li class="promo-item"><div><b>' + escaparHtml(u.usuario || '') + '</b> · ' + escaparHtml(rolTxt) +
        (u.nombre && u.nombre !== u.usuario ? '<div class="promo-obj">' + escaparHtml(u.nombre) + '</div>' : '') +
        '<div class="promo-obj">Último acceso: ' + (u.ultimo_acceso ? escaparHtml(formatearFecha(u.ultimo_acceso)) : 'nunca') + '</div>' +
        '</div>' + eliminar + '</li>';
    }).join('')
    : '<li class="promo-vacio">Aún no has creado usuarios con nombre. Puedes seguir entrando con la contraseña general.</li>';

  const cardUsuarios = '<div class="promo-card">' +
    '<h3>Usuarios del panel</h3>' +
    '<p class="promo-sub">Crea cuentas con nombre y contraseña propios, y elige si son asistentes o administradores.</p>' +
    '<form method="POST" action="/admin/usuarios" class="promo-form">' +
    '<div class="promo-fila">' +
    '<label class="promo-label">Nombre<input class="promo-input" type="text" name="nombre" maxlength="120" placeholder="Nombre visible"></label>' +
    '<label class="promo-label">Usuario<input class="promo-input" type="text" name="usuario" maxlength="30" autocapitalize="none" placeholder="ej. lucia" required></label>' +
    '</div>' +
    '<div class="promo-fila">' +
    '<label class="promo-label">Contraseña<input class="promo-input" type="password" name="password" minlength="6" placeholder="Mínimo 6 caracteres" required></label>' +
    '<label class="promo-label">Rol<select class="promo-input" name="rol">' +
    '<option value="asistente">Asistente</option><option value="admin">Administrador</option></select></label>' +
    '</div>' +
    '<button class="btn-exp excel promo-btn" type="submit">＋ Crear usuario</button>' +
    '</form>' +
    '<ul class="promo-lista">' + filasUsuarios + '</ul></div>';

  const filasAccesos = accesos.length
    ? accesos.map(function (a) {
      const ok = a.exito;
      const rolTxt = a.rol === 'admin' ? 'Administrador' : (a.rol === 'asistente' ? 'Asistente' : '—');
      return '<tr>' +
        '<td>' + (ok ? '<span class="badge ok">✓ Correcto</span>' : '<span class="badge no">✕ Fallido</span>') + '</td>' +
        '<td>' + escaparHtml(a.usuario || '—') + '</td>' +
        '<td>' + escaparHtml(ok ? rolTxt : '—') + '</td>' +
        '<td class="fecha">' + escaparHtml(formatearFecha(a.cuando)) + '</td>' +
        '<td>' + escaparHtml(a.ip || '—') + '</td>' +
        '<td class="info">' + escaparHtml(a.agente || '—') + '</td>' +
        '</tr>';
    }).join('')
    : '<tr><td colspan="6" class="promo-vacio" style="padding:12px;">Todavía no hay accesos registrados.</td></tr>';

  const cardAccesos = '<div class="promo-card">' +
    '<h3>Historial de accesos</h3>' +
    '<p class="promo-sub">Cada inicio de sesión (correcto o fallido) queda registrado y se envía una alerta por correo.</p>' +
    '<div class="tabla-wrap"><table class="tabla-accesos"><thead><tr>' +
    '<th>Resultado</th><th>Usuario</th><th>Rol</th><th>Fecha</th><th>IP</th><th>Navegador</th>' +
    '</tr></thead><tbody>' + filasAccesos + '</tbody></table></div></div>';

  return '<section class="promos-panel">' +
    '<h2 class="promos-titulo">✦ Usuarios y seguridad <span>(solo administrador)</span></h2>' +
    '<div class="promo-grid">' + cardUsuarios + cardAccesos + '</div></section>';
}

/* ---------- Panel de administración: listado ---------- */
function adminDashboard(opciones) {
  const registros = (opciones && opciones.registros) || [];
  const rol = (opciones && opciones.rol) || 'admin';
  const esAsistente = rol !== 'admin';
  const baseUrl = (opciones && opciones.baseUrl) || '';
  const total = registros.length;
  const agendadosList = registros.filter(function (r) { return r.estado === 'agendado'; });
  const agendados = agendadosList.length;
  const porVerificar = registros.filter(function (r) { return r.estado === 'pendiente_verificacion'; }).length;
  const ingresosCOP = agendadosList.reduce(function (sum, r) { return sum + (parseInt(r.precio_cop, 10) || 0); }, 0);
  const ingresosTexto = '$' + ingresosCOP.toLocaleString('es-CO');

  const badge = function (estado) {
    if (estado === 'agendado') return '<span class="badge ok">Agendado</span>';
    if (estado === 'rechazado') return '<span class="badge no">Rechazado</span>';
    if (estado === 'pendiente_verificacion') return '<span class="badge verif">En verificación</span>';
    return '<span class="badge pend">Pendiente de pago</span>';
  };

  const etiquetaEstado = function (estado) {
    if (estado === 'agendado') return 'Agendado';
    if (estado === 'rechazado') return 'Rechazado';
    if (estado === 'pendiente_verificacion') return 'En verificación';
    return 'Pendiente de pago';
  };

  const miniatura = function (nombre, alt) {
    if (!nombre) return '<span class="vacio">—</span>';
    const url = '/admin/foto/' + encodeURIComponent(nombre);
    return '<img class="thumb" src="' + url + '" alt="' + escaparHtml(alt) + '" ' +
      'onclick="verImagen(this.src)" loading="lazy">';
  };

  const filas = registros.map(function (r) {
    const foto = miniatura(r.objetivo_foto, 'Foto de la persona');
    const comprobante = miniatura(r.comprobante, 'Comprobante de pago');
    const datos = [
      r.objetivo_nombre ? '<div><b>Nombre:</b> ' + escaparHtml(r.objetivo_nombre) + '</div>' : '',
      r.objetivo_fecha_nac ? '<div><b>Nac.:</b> ' + escaparHtml(r.objetivo_fecha_nac) + '</div>' : '',
    ].join('') || '<span class="vacio">—</span>';

    const badgeAdelanto = r.adelanto === 'solo'
      ? '<span class="badge ade">⚡ Adelanto (urgencia)</span>'
      : (r.adelanto === 'incluido' ? '<span class="badge ade">⚡ Incluye adelanto</span>' : '');
    const estadoCol = badge(r.estado) +
      (r.metodo === 'transferencia' ? '<span class="badge metodo">Transferencia</span>' : '') +
      badgeAdelanto +
      (r.trabajo_hecho ? '<span class="badge trab">✓ Trabajo realizado</span>' : '');

    const refEnc = encodeURIComponent(r.ref || '');
    const botonesVerif = (r.estado === 'pendiente_verificacion' && !esAsistente)
      ? '<form method="POST" action="/admin/aprobar/' + refEnc + '" style="margin:0">' +
        '<button class="btn-acc btn-aprobar" type="submit">✓ Aprobar pago</button></form>' +
        '<form method="POST" action="/admin/rechazar/' + refEnc + '" style="margin:0" ' +
        'onsubmit="return confirm(\'¿Rechazar este pago?\');">' +
        '<button class="btn-acc btn-rechazar" type="submit">✕ Rechazar</button></form>'
      : (r.estado === 'pendiente_verificacion' && esAsistente
        ? '<span class="acc-bloq" title="Solo el administrador puede aprobar o rechazar pagos.">🔒 Solo admin</span>'
        : '');
    const botonTrabajo = '<form method="POST" action="/admin/trabajo/' + refEnc + '" style="margin:0">' +
      '<button class="btn-acc btn-hecho' + (r.trabajo_hecho ? ' on' : '') + '" type="submit">' +
      (r.trabajo_hecho ? '✓ Realizado' : 'Marcar realizado') + '</button></form>' +
      (r.trabajo_hecho && r.trabajo_hecho_en
        ? '<div class="hecho-fecha">' + escaparHtml(formatearFecha(r.trabajo_hecho_en)) + '</div>'
        : '');
    const botonEliminar = (esAsistente && r.trabajo_hecho)
      ? '<span class="acc-bloq" title="Solo el administrador puede eliminar un agendamiento realizado.">🔒 Solo admin</span>'
      : '<form method="POST" action="/admin/eliminar/' + refEnc + '" style="margin:0" ' +
        'onsubmit="return confirm(\'¿Eliminar este agendamiento? Esta acción no se puede deshacer.\');">' +
        '<button class="btn-acc btn-del" type="submit">Eliminar</button></form>';

    const cuentaInd = r.cliente_id
      ? '<div class="cuenta si">✓ Cliente registrado' +
        (r.cliente_email ? '<div class="cuenta-mail">' + escaparHtml(r.cliente_email) + '</div>' : '') + '</div>'
      : '<div class="cuenta no">Invitado · sin cuenta<div class="cuenta-mail">No recibe correos automáticos</div></div>';

    const evThumbs = (Array.isArray(r.evidencia_fotos) && r.evidencia_fotos.length)
      ? '<div class="ev-thumbs">' + r.evidencia_fotos.map(function (n) { return miniatura(n, 'Evidencia del trabajo'); }).join('') + '</div>' +
        (r.evidencia_en ? '<div class="ev-fecha">Enviada: ' + escaparHtml(formatearFecha(r.evidencia_en)) + '</div>' : '')
      : '';

    const evForm = '<form class="ev-form" method="POST" action="/admin/evidencia/' + refEnc + '" enctype="multipart/form-data" ' +
      'onsubmit="return confirm(\'¿Guardar y enviar la evidencia al cliente?\');">' +
      '<input type="file" name="fotos" accept="image/jpeg,image/png,image/webp" multiple>' +
      '<textarea name="notas" rows="2" placeholder="Notas para el cliente (opcional)">' + escaparHtml(r.evidencia_notas || '') + '</textarea>' +
      '<button class="btn-acc btn-ev" type="submit">✦ Enviar evidencia</button>' +
      (r.cliente_id ? '' : '<div class="ev-aviso">Sin cuenta: no se enviará correo. Comparte por WhatsApp.</div>') +
      '</form>';

    const tel = (r.contacto || '').replace(/\D/g, '');
    const evidenciaUrl = (r.evidencia_token && baseUrl) ? (baseUrl + '/evidencia/' + refEnc + '/' + r.evidencia_token) : '';
    const waMsg = 'Hola ' + (r.cliente_nombre || '') + ' ✦ Te escribo de Fresatanika sobre tu servicio: ' +
      (r.producto || 'tu servicio') + '. Estado: ' + etiquetaEstado(r.estado) +
      (r.trabajo_hecho ? ' · Trabajo realizado' : '') + '.' +
      (evidenciaUrl ? ' Puedes ver la evidencia de tu trabajo aquí: ' + evidenciaUrl : '');
    const waHref = (tel ? 'https://wa.me/' + tel + '?text=' : 'https://api.whatsapp.com/send?text=') + encodeURIComponent(waMsg);
    const waBtn = '<a class="btn-acc btn-wa" href="' + waHref + '" target="_blank" rel="noopener">🟢 Compartir por WhatsApp</a>';

    const celdaEvidencia = cuentaInd + evThumbs + evForm + waBtn;

    const buscable = [r.producto, r.ref, r.pedido_ref, r.cliente_nombre, r.contacto, r.objetivo_nombre]
      .filter(Boolean).join(' ').toLowerCase();

    const badgePedido = r.pedido_ref
      ? '<span class="badge-pedido" title="Servicio comprado dentro de un pedido con varios servicios (' + escaparHtml(r.pedido_ref) + ')">🛒 Pedido ' + escaparHtml(r.pedido_ref.replace(/^FRESA-PED-/, '')) + '</span>'
      : '';

    // Edición del pedido (solo administrador): corregir servicio/precio/estado
    // y agregar un servicio adicional al mismo pedido.
    const opcionEstado = function (valor, etiqueta) {
      return '<option value="' + valor + '"' + (r.estado === valor ? ' selected' : '') + '>' + etiqueta + '</option>';
    };
    const botonEditar = esAsistente ? '' :
      '<button type="button" class="btn-acc btn-editar" onclick="toggleEditar(\'' + escaparHtml(r.ref || '') + '\')">✎ Editar</button>';
    const filaEdicion = esAsistente ? '' : [
      '<tr class="edit-row" id="edit-' + escaparHtml(r.ref || '') + '" style="display:none">',
      '<td colspan="12"><div class="edit-box">',
      '<div class="edit-col">',
      '<h4>Editar este servicio</h4>',
      '<form method="POST" action="/admin/editar/' + refEnc + '" class="edit-form">',
      '<label>Servicio<input type="text" name="producto" value="' + escaparHtml(r.producto || '') + '" maxlength="200"></label>',
      '<label>Precio (COP)<input type="number" name="precio_cop" min="0" step="1" value="' + (parseInt(r.precio_cop, 10) || 0) + '"></label>',
      '<label>Estado de pago<select name="estado">' +
        opcionEstado('pendiente_pago', 'Pendiente de pago') +
        opcionEstado('pendiente_verificacion', 'En verificación') +
        opcionEstado('agendado', 'Agendado') +
        opcionEstado('rechazado', 'Rechazado') +
      '</select></label>',
      '<button class="btn-acc btn-guardar" type="submit">Guardar cambios</button>',
      '</form></div>',
      '<div class="edit-col">',
      '<h4>Agregar un servicio al pedido</h4>',
      '<form method="POST" action="/admin/servicio/' + refEnc + '" class="edit-form">',
      '<label>Servicio<input type="text" name="producto" maxlength="200" placeholder="Nombre del servicio" required></label>',
      '<label>Precio (COP)<input type="number" name="precio_cop" min="0" step="1" placeholder="0" required></label>',
      '<label>Persona a trabajar (opcional)<input type="text" name="objetivo_nombre" maxlength="200"></label>',
      '<label>Información extra (opcional)<textarea name="info_extra" rows="2"></textarea></label>',
      '<button class="btn-acc btn-agregar" type="submit">＋ Agregar servicio</button>',
      '</form></div>',
      '</div></td></tr>',
    ].join('');

    return [
      '<tr data-estado="' + escaparHtml(r.estado || '') + '" data-buscar="' + escaparHtml(buscable) + '">',
      '<td><div class="prod">' + escaparHtml(r.producto || '') + '</div><div class="ref">' + escaparHtml(r.ref || '') + '</div>' + badgePedido + '</td>',
      '<td>' + escaparHtml(r.precio_texto || ('$' + (r.precio_cop || 0))) + '</td>',
      '<td>' + escaparHtml(r.cliente_nombre || '') + '</td>',
      '<td>' + (r.contacto ? escaparHtml(r.contacto) : '<span class="vacio">—</span>') + '</td>',
      '<td>' + datos + '</td>',
      '<td>' + foto + '</td>',
      '<td>' + comprobante + '</td>',
      '<td class="ev-cell">' + celdaEvidencia + '</td>',
      '<td class="info">' + (r.info_extra ? escaparHtml(r.info_extra) : '<span class="vacio">—</span>') + '</td>',
      '<td>' + estadoCol + '</td>',
      '<td class="fecha">' + escaparHtml(formatearFecha(r.pagado_en || r.creado_en)) + '</td>',
      '<td><div class="acc">' + botonesVerif + botonEditar + botonTrabajo + botonEliminar + '</div></td>',
      '</tr>',
      filaEdicion,
    ].join('');
  }).join('');

  return [
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Fresatanika — Agendamientos</title>',
    '<meta name="robots" content="noindex,nofollow">',
    '<link href="https://fonts.googleapis.com/css2?display=swap&family=Poppins:wght@300;400;700;900" rel="stylesheet">',
    '<style>', baseEstilos(),
    '.top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:18px;}',
    'h1{font-size:20px;font-weight:900;color:' + COLORES.rosa + ';margin:0;letter-spacing:0.04em;}',
    '.logout{font-size:12px;color:#fff;text-decoration:none;background:' + COLORES.vino + ';border:1px solid ' + COLORES.borde + ';padding:8px 14px;border-radius:40px;cursor:pointer;font-weight:600;}',
    '.acciones{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
    '.btn-exp{font-size:12px;font-weight:600;padding:8px 14px;border-radius:40px;text-decoration:none;border:1px solid ' + COLORES.borde + ';cursor:pointer;white-space:nowrap;}',
    '.btn-exp.excel{background:#1e6b3a;color:#fff;}',
    '.btn-exp.pdf{background:#8b1a2f;color:#fff;}',
    '.acc{display:flex;flex-direction:column;gap:6px;min-width:120px;}',
    '.btn-acc{font-size:11px;font-weight:600;padding:6px 10px;border-radius:8px;border:1px solid ' + COLORES.borde + ';cursor:pointer;white-space:nowrap;text-align:center;}',
    '.btn-hecho{background:rgba(120,200,150,0.16);color:#9be0b4;}',
    '.btn-hecho.on{background:#1e6b3a;color:#fff;}',
    '.btn-del{background:rgba(229,123,160,0.14);color:#f3b6cd;}',
    '.btn-aprobar{background:#1e6b3a;color:#fff;}',
    '.btn-rechazar{background:rgba(229,123,160,0.14);color:#f3b6cd;}',
    '.hecho-fecha{font-size:9.5px;color:' + COLORES.tenue + ';text-align:center;margin-top:2px;}',
    '.badge.trab{background:rgba(120,200,150,0.16);color:#9be0b4;border:1px solid rgba(120,200,150,0.4);display:block;margin-top:5px;}',
    '.badge.metodo{background:rgba(150,180,240,0.14);color:#b9c9f0;border:1px solid rgba(150,180,240,0.4);display:block;margin-top:5px;}',
    '.badge.ade{background:rgba(240,180,120,0.16);color:#f0c79a;border:1px solid rgba(240,180,120,0.5);display:block;margin-top:5px;}',
    '.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;}',
    '.stat{flex:1;min-width:130px;background:' + COLORES.panel + ';border:1px solid rgba(194,167,183,0.3);border-radius:12px;padding:14px 16px;}',
    '.stat.destacado{border-color:#f0c79a;background:rgba(240,180,120,0.10);}',
    '.stat .n{font-size:26px;font-weight:900;color:' + COLORES.rosa + ';}',
    '.stat.destacado .n{color:#f0c79a;}',
    '.stat .l{font-size:11px;color:' + COLORES.tenue + ';text-transform:uppercase;letter-spacing:0.08em;}',
    '.controles{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px;}',
    '.buscador{flex:1;min-width:220px;padding:11px 14px;border-radius:40px;border:1px solid ' + COLORES.borde + ';background:rgba(0,0,0,0.35);color:#fff;font-size:13px;font-family:inherit;}',
    '.filtros{display:flex;gap:6px;flex-wrap:wrap;}',
    '.filtro{font-size:11.5px;font-weight:600;padding:7px 13px;border-radius:40px;border:1px solid ' + COLORES.borde + ';background:rgba(125,55,84,0.15);color:' + COLORES.tenue + ';cursor:pointer;}',
    '.filtro.activo{background:' + COLORES.vino + ';color:#fff;}',
    '.thumb{width:46px;height:46px;object-fit:cover;border-radius:7px;border:1px solid rgba(194,167,183,0.4);cursor:pointer;transition:transform 0.12s;}',
    '.thumb:hover{transform:scale(1.06);}',
    '.lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;justify-content:center;align-items:center;padding:24px;cursor:zoom-out;}',
    '.lightbox.activo{display:flex;}',
    '.lightbox img{max-width:95%;max-height:92%;border-radius:10px;border:1px solid ' + COLORES.borde + ';box-shadow:0 20px 60px rgba(0,0,0,0.7);}',
    '.sin-resultados{text-align:center;padding:30px;color:' + COLORES.tenue + ';display:none;}',
    '.tabla-wrap{overflow-x:auto;border:1px solid rgba(194,167,183,0.25);border-radius:12px;}',
    'table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1060px;}',
    'th{background:rgba(125,55,84,0.25);color:' + COLORES.rosa + ';text-align:left;padding:11px 12px;font-weight:700;',
    'font-size:11px;text-transform:uppercase;letter-spacing:0.05em;position:sticky;top:0;}',
    'td{padding:11px 12px;border-top:1px solid rgba(194,167,183,0.14);vertical-align:top;color:' + COLORES.texto + ';}',
    'tr:hover td{background:rgba(125,55,84,0.08);}',
    '.prod{font-weight:700;}',
    '.ref{font-size:10.5px;color:' + COLORES.tenue + ';margin-top:2px;}',
    '.badge-pedido{display:inline-block;margin-top:4px;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;' +
      'background:rgba(240,163,195,0.16);color:' + COLORES.rosa + ';border:1px solid rgba(240,163,195,0.35);}',
    '.info{max-width:240px;white-space:pre-wrap;color:' + COLORES.tenue + ';}',
    '.fecha{color:' + COLORES.tenue + ';white-space:nowrap;}',
    '.vacio{color:#6d5460;}',
    '.badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:10.5px;font-weight:700;white-space:nowrap;}',
    '.badge.ok{background:rgba(120,200,150,0.16);color:#9be0b4;border:1px solid rgba(120,200,150,0.4);}',
    '.badge.pend{background:rgba(240,180,120,0.14);color:#f0c79a;border:1px solid rgba(240,180,120,0.4);}',
    '.badge.no{background:rgba(229,123,160,0.14);color:#f3b6cd;border:1px solid rgba(229,123,160,0.4);}',
    '.badge.verif{background:rgba(240,180,120,0.16);color:#f0c79a;border:1px solid rgba(240,180,120,0.5);}',
    '.vacia{text-align:center;padding:40px;color:' + COLORES.tenue + ';}',
    '.rol-badge{font-size:10.5px;font-weight:700;background:' + COLORES.vino + ';color:#fff;padding:3px 10px;border-radius:20px;vertical-align:middle;margin-left:6px;letter-spacing:0.04em;}',
    '.promos-panel{margin-bottom:22px;}',
    '.promos-titulo{font-size:15px;font-weight:900;color:' + COLORES.rosa + ';margin:0 0 12px;letter-spacing:0.03em;}',
    '.promos-titulo span{color:' + COLORES.tenue + ';font-size:12px;font-weight:600;}',
    '.promo-grid{display:flex;gap:14px;flex-wrap:wrap;}',
    '.promo-card{flex:1;min-width:300px;background:' + COLORES.panel + ';border:1px solid rgba(194,167,183,0.3);border-radius:12px;padding:16px 18px;}',
    '.promo-card h3{font-size:13px;font-weight:800;color:' + COLORES.rosa + ';margin:0 0 4px;}',
    '.promo-sub{font-size:11px;color:' + COLORES.tenue + ';margin:0 0 12px;line-height:1.45;}',
    '.promo-fila{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;}',
    '.promo-label{display:flex;flex-direction:column;font-size:10.5px;color:#e0c0cf;font-weight:600;gap:4px;flex:1 1 120px;min-width:120px;}',
    '.promo-input{width:100%;min-width:0;padding:8px 10px;border-radius:7px;border:1px solid ' + COLORES.borde + ';background:rgba(0,0,0,0.35);color:#fff;font-family:inherit;font-size:12px;}',
    'input.promo-input[type=date]{-webkit-appearance:none;appearance:none;}',
    '@media (max-width:560px){.promo-label{flex-basis:100%;min-width:100%;}.promo-fila{gap:8px;}.promo-card{padding:14px;}}',
    '.promo-especificos{margin-bottom:10px;}',
    '.promo-select-multi{width:100%;padding:8px;border-radius:7px;border:1px solid ' + COLORES.borde + ';background:rgba(0,0,0,0.35);color:#fff;font-family:inherit;font-size:12px;}',
    '.promo-btn{border:none;margin-top:2px;}',
    '.promo-lista{list-style:none;padding:0;margin:14px 0 0;display:flex;flex-direction:column;gap:8px;}',
    '.promo-item{display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(0,0,0,0.25);border:1px solid rgba(194,167,183,0.18);border-radius:8px;padding:9px 12px;font-size:12px;color:' + COLORES.texto + ';}',
    '.promo-obj{font-size:10.5px;color:' + COLORES.tenue + ';margin-top:3px;}',
    '.promo-usos{font-size:10.5px;color:#9fd0b0;margin-top:2px;font-weight:600;}',
    '.promo-usos.agotado{color:#e79aa8;}',
    '.promo-vacio{font-size:11.5px;color:' + COLORES.tenue + ';list-style:none;}',
    '.acc-bloq{font-size:10.5px;color:' + COLORES.tenue + ';font-style:italic;white-space:nowrap;}',
    '.ev-cell{min-width:210px;max-width:230px;}',
    '.cuenta{font-size:10.5px;font-weight:700;padding:4px 8px;border-radius:7px;margin-bottom:7px;}',
    '.cuenta.si{background:rgba(120,200,150,0.14);color:#9be0b4;border:1px solid rgba(120,200,150,0.35);}',
    '.cuenta.no{background:rgba(240,180,120,0.12);color:#f0c79a;border:1px solid rgba(240,180,120,0.35);}',
    '.cuenta-mail{font-size:9.5px;font-weight:500;color:' + COLORES.tenue + ';margin-top:2px;word-break:break-all;}',
    '.ev-thumbs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;}',
    '.ev-thumbs .thumb{width:38px;height:38px;}',
    '.ev-fecha{font-size:9.5px;color:' + COLORES.tenue + ';margin-bottom:6px;}',
    '.ev-form{display:flex;flex-direction:column;gap:5px;margin-bottom:7px;}',
    '.ev-form input[type=file]{font-size:10px;color:' + COLORES.tenue + ';max-width:100%;}',
    '.ev-form textarea{font-size:11px;font-family:inherit;padding:6px 8px;border-radius:7px;border:1px solid ' + COLORES.borde + ';background:rgba(0,0,0,0.35);color:#fff;resize:vertical;}',
    '.btn-ev{background:rgba(125,55,84,0.35);color:#f4d9e6;}',
    '.btn-ev:hover{background:' + COLORES.vino + ';color:#fff;}',
    '.ev-aviso{font-size:9.5px;color:#f0c79a;line-height:1.35;}',
    '.btn-wa{display:block;background:#1e7d47;color:#fff;text-decoration:none;}',
    '.btn-wa:hover{background:#25a35a;}',
    '.acc-bloq{display:inline-block;font-size:10.5px;color:#d9a9bf;background:rgba(125,55,84,0.18);border:1px solid ' + COLORES.borde + ';border-radius:7px;padding:6px 9px;}',
    '.btn-editar{background:rgba(150,180,240,0.14);color:#b9c9f0;}',
    '.btn-editar:hover{background:rgba(150,180,240,0.28);}',
    '.edit-row td{background:rgba(125,55,84,0.10);}',
    '.edit-box{display:flex;gap:16px;flex-wrap:wrap;padding:6px 2px;}',
    '.edit-col{flex:1;min-width:260px;}',
    '.edit-col h4{margin:0 0 10px;font-size:12px;font-weight:800;color:' + COLORES.rosa + ';letter-spacing:0.03em;}',
    '.edit-form{display:flex;flex-direction:column;gap:9px;}',
    '.edit-form label{display:flex;flex-direction:column;gap:4px;font-size:10.5px;color:#e0c0cf;font-weight:600;}',
    '.edit-form input,.edit-form select,.edit-form textarea{padding:8px 10px;border-radius:7px;border:1px solid ' + COLORES.borde + ';background:rgba(0,0,0,0.35);color:#fff;font-family:inherit;font-size:12px;}',
    '.edit-form textarea{resize:vertical;}',
    '.btn-guardar{background:#1e6b3a;color:#fff;margin-top:2px;}',
    '.btn-agregar{background:rgba(125,55,84,0.35);color:#f4d9e6;margin-top:2px;}',
    '.btn-agregar:hover{background:' + COLORES.vino + ';color:#fff;}',
    '.tabla-accesos{min-width:640px;font-size:11.5px;}',
    '.tabla-accesos th{position:static;}',
    '</style></head><body><div class="wrap">',
    '<div class="top"><h1>✦ Agendamientos <span class="rol-badge">' + (esAsistente ? 'Asistente' : 'Administrador') + '</span></h1><div class="acciones"><a class="btn-exp excel" href="/admin/exportar/excel">⬇ Excel</a><a class="btn-exp pdf" href="/admin/exportar/pdf">⬇ PDF</a><form method="POST" action="/admin/logout" style="margin:0"><button class="logout" type="submit">Cerrar sesión</button></form></div></div>',
    seccionPromociones(opciones),
    seccionUsuarios(opciones),
    '<div class="stats">',
    '<div class="stat"><div class="n">' + total + '</div><div class="l">Total</div></div>',
    '<div class="stat' + (porVerificar > 0 ? ' destacado' : '') + '"><div class="n">' + porVerificar + '</div><div class="l">Por verificar</div></div>',
    '<div class="stat"><div class="n">' + agendados + '</div><div class="l">Agendados</div></div>',
    '<div class="stat"><div class="n">' + ingresosTexto + '</div><div class="l">Ingresos (COP)</div></div>',
    '</div>',
    total === 0
      ? '<div class="tabla-wrap"><div class="vacia">Aún no hay agendamientos.</div></div>'
      : '<div class="controles">' +
        '<input type="text" class="buscador" id="buscador" placeholder="Buscar por nombre, referencia o contacto...">' +
        '<div class="filtros">' +
        '<button class="filtro activo" data-filtro="todos">Todos</button>' +
        '<button class="filtro" data-filtro="pendiente_verificacion">En verificación</button>' +
        '<button class="filtro" data-filtro="agendado">Agendados</button>' +
        '<button class="filtro" data-filtro="pendiente_pago">Pendientes de pago</button>' +
        '<button class="filtro" data-filtro="rechazado">Rechazados</button>' +
        '</div></div>' +
        '<div class="tabla-wrap"><table><thead><tr>' +
        '<th>Servicio</th><th>Valor</th><th>Cliente</th><th>Contacto</th><th>Persona a trabajar</th><th>Foto</th><th>Comprobante</th><th>Evidencia / Cliente</th><th>Información extra</th><th>Estado</th><th>Fecha</th><th>Acciones</th>' +
        '</tr></thead><tbody id="cuerpo-tabla">' + filas + '</tbody></table>' +
        '<div class="sin-resultados" id="sin-resultados">No hay agendamientos que coincidan con tu búsqueda.</div></div>',
    '<div class="lightbox" id="lightbox" onclick="cerrarImagen()"><img id="lightbox-img" src="" alt="Imagen ampliada"></div>',
    '<script>' + scriptAdmin() + '</script>',
    '</div></body></html>',
  ].join('');
}

/* ---------- Envoltura común de los correos ---------- */
// Todos los correos comparten la misma tarjeta: cabecera con degradado, cuerpo y
// pie. Así el aspecto es consistente y profesional en cualquier plantilla.
function envolturaCorreo(opciones) {
  const o = opciones || {};
  const icono = o.icono || '✦';
  const titulo = o.titulo || 'Fresatanika';
  const preheader = o.preheader || '';
  const cuerpo = o.cuerpo || '';
  const pie = o.pie || 'Mensaje automático · Fresatanika';
  return [
    '<div style="margin:0;padding:0;background:#0c0007;">',
    preheader
      ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0c0007;font-size:1px;line-height:1px;">' + escaparHtml(preheader) + '</div>'
      : '',
    '<div style="max-width:520px;margin:0 auto;padding:28px 18px;font-family:Poppins,Arial,Helvetica,sans-serif;">',
    '<div style="background:#1a0710;border:1px solid #C2A7B7;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.5);">',
    '<div style="background:linear-gradient(135deg,#7D3754 0%,#9C4C6D 60%,#c76b91 130%);padding:30px 24px;text-align:center;">',
    '<div style="color:#f7d4e4;letter-spacing:0.3em;font-size:11px;">꣑୧・┈</div>',
    '<div style="color:#ffffff;font-size:20px;font-weight:900;letter-spacing:0.03em;margin-top:8px;line-height:1.3;">' + icono + '&nbsp; ' + escaparHtml(titulo) + ' &nbsp;' + icono + '</div>',
    '<div style="color:#f7d4e4;font-size:11px;margin-top:6px;letter-spacing:0.22em;text-transform:uppercase;">Fresatanika</div>',
    '</div>',
    '<div style="padding:26px 24px;">',
    cuerpo,
    '</div>',
    '<div style="padding:16px 24px;border-top:1px solid rgba(194,167,183,0.2);text-align:center;color:#9c7788;font-size:11px;line-height:1.7;">',
    escaparHtml(pie),
    '</div>',
    '</div></div></div>',
  ].join('');
}

// Fila etiqueta/valor reutilizable en las tablas de los correos.
function filaCorreo(etiqueta, valor, anchoEtiqueta) {
  if (!valor) return '';
  const w = anchoEtiqueta || 170;
  return '<tr><td style="padding:9px 0;color:#c9a9ba;font-size:13px;width:' + w + 'px;vertical-align:top;">' + escaparHtml(etiqueta) + '</td>' +
    '<td style="padding:9px 0;color:#f4e6ee;font-size:14px;font-weight:600;">' + escaparHtml(valor) + '</td></tr>';
}

// Bloque destacado (aviso/nota) al pie del cuerpo del correo.
function notaCorreo(html) {
  return '<div style="margin-top:22px;padding:15px 16px;background:rgba(125,55,84,0.18);border:1px solid rgba(194,167,183,0.3);border-radius:12px;color:#e8c9d8;font-size:12.5px;line-height:1.65;">' + html + '</div>';
}

/* ---------- Correo de notificación ---------- */
function correoNotificacion(reg) {
  const cuerpo = [
    '<p style="color:#f0a3c3;font-size:15px;font-weight:700;margin:0 0 16px;">' + escaparHtml(reg.producto || 'Servicio') + '</p>',
    '<table style="width:100%;border-collapse:collapse;">',
    filaCorreo('Valor', reg.precio_texto || ('$' + (reg.precio_cop || 0) + ' COP')),
    filaCorreo('Método de pago', reg.metodo === 'transferencia' ? 'Transferencia (verificado manualmente)' : 'Wompi'),
    filaCorreo('Adelanto (urgencia)', reg.adelanto === 'solo'
      ? 'Sí — pago de adelanto suelto (entrega en máx. 2 días)'
      : (reg.adelanto === 'incluido' ? 'Sí — incluye adelanto (entrega en máx. 2 días)' : '')),
    filaCorreo('Cliente', reg.cliente_nombre),
    filaCorreo('Contacto (evidencia)', reg.contacto),
    filaCorreo('Persona a trabajar', reg.objetivo_nombre),
    filaCorreo('Fecha de nacimiento', reg.objetivo_fecha_nac),
    filaCorreo('Foto adjunta', reg.objetivo_foto ? 'Sí (revísala en el panel de administración)' : ''),
    filaCorreo('Comprobante adjunto', reg.comprobante ? 'Sí (revísalo en el panel de administración)' : ''),
    filaCorreo('Información extra', reg.info_extra),
    filaCorreo('Referencia', reg.ref),
    filaCorreo('Transacción Wompi', reg.wompi_tx),
    filaCorreo('Confirmado el', formatearFecha(reg.pagado_en || reg.creado_en)),
    '</table>',
    notaCorreo('El pago fue <strong style="color:#f0a3c3;">aprobado</strong> y el cliente quedó agendado. Ingresa al panel de administración para ver todos los detalles.'),
  ].join('');
  return envolturaCorreo({
    icono: '✦',
    titulo: 'Nuevo agendamiento',
    preheader: (reg.producto || 'Nuevo servicio') + ' · ' + (reg.cliente_nombre || 'Cliente'),
    cuerpo: cuerpo,
    pie: 'Notificación automática · Fresatanika',
  });
}

/* ---------- Correo de notificación de un PEDIDO (carrito, varios servicios) ---------- */
function correoNotificacionPedido(registros, total) {
  const regs = registros || [];
  const primero = regs[0] || {};
  const esTransferencia = primero.metodo === 'transferencia';
  const bloquesServicios = regs.map(function (r, i) {
    const detalles = [
      r.precio_texto ? '<div style="color:#f4e6ee;font-size:13px;font-weight:600;margin-top:2px;">' + escaparHtml(r.precio_texto) + '</div>' : '',
      r.contacto ? '<div style="color:#c9a9ba;font-size:12px;">Contacto: ' + escaparHtml(r.contacto) + '</div>' : '',
      r.objetivo_nombre ? '<div style="color:#c9a9ba;font-size:12px;">Persona: ' + escaparHtml(r.objetivo_nombre) + '</div>' : '',
      r.objetivo_fecha_nac ? '<div style="color:#c9a9ba;font-size:12px;">Nac.: ' + escaparHtml(r.objetivo_fecha_nac) + '</div>' : '',
      r.objetivo_foto ? '<div style="color:#c9a9ba;font-size:12px;">Foto adjunta (revísala en el panel)</div>' : '',
      r.info_extra ? '<div style="color:#c9a9ba;font-size:12px;">Info: ' + escaparHtml(r.info_extra) + '</div>' : '',
    ].join('');
    return '<div style="padding:12px 0;border-bottom:1px solid rgba(194,167,183,0.2);">' +
      '<div style="color:#f0a3c3;font-size:14px;font-weight:700;">' + (i + 1) + '. ' + escaparHtml(r.producto || 'Servicio') + '</div>' +
      detalles + '</div>';
  }).join('');
  const cuerpo = [
    '<table style="width:100%;border-collapse:collapse;">',
    filaCorreo('Cliente', primero.cliente_nombre),
    filaCorreo('Contacto (evidencia)', primero.contacto),
    filaCorreo('Método de pago', esTransferencia ? 'Transferencia (verificado manualmente)' : 'Wompi'),
    filaCorreo('Referencia del pedido', primero.pedido_ref),
    filaCorreo('Total del pedido', '$' + Number(total || 0).toLocaleString('es-CO') + ' COP' + (esTransferencia ? '' : ' (incluye comisión Wompi)')),
    filaCorreo('Confirmado el', formatearFecha(primero.pagado_en || primero.creado_en)),
    '</table>',
    '<div style="margin-top:14px;">' + bloquesServicios + '</div>',
    notaCorreo('El pago del pedido fue <strong style="color:#f0a3c3;">aprobado</strong> y todos los servicios quedaron agendados. Ingresa al panel para ver los detalles.'),
  ].join('');
  return envolturaCorreo({
    icono: '✦',
    titulo: 'Nuevo pedido (' + regs.length + ' servicios)',
    preheader: (primero.cliente_nombre || 'Cliente') + ' · ' + regs.length + ' servicios',
    cuerpo: cuerpo,
    pie: 'Notificación automática · Fresatanika',
  });
}

function correoSeguimiento(reg, tipo) {
  const esCinco = tipo === '5semanas';
  const plazo = esCinco ? '5 semanas' : '4 meses';
  const cuerpo = [
    '<p style="color:#f0a3c3;font-size:15px;font-weight:700;margin:0 0 16px;">' + escaparHtml(reg.producto || 'Servicio') + '</p>',
    '<table style="width:100%;border-collapse:collapse;">',
    filaCorreo('Cliente', reg.cliente_nombre),
    filaCorreo('Contacto', reg.contacto),
    filaCorreo('Persona trabajada', reg.objetivo_nombre),
    filaCorreo('Referencia', reg.ref),
    filaCorreo('Trabajo realizado el', formatearFecha(reg.trabajo_hecho_en)),
    '</table>',
    notaCorreo('Han pasado <strong style="color:#f0a3c3;">' + plazo + '</strong> desde que marcaste este trabajo como realizado. Es momento de hacer el seguimiento con el cliente por su contacto.'),
  ].join('');
  return envolturaCorreo({
    icono: '✦',
    titulo: 'Seguimiento a ' + plazo,
    preheader: 'Recordatorio de seguimiento · ' + (reg.cliente_nombre || reg.producto || 'Cliente'),
    cuerpo: cuerpo,
    pie: 'Recordatorio automático · Fresatanika',
  });
}

/* ---------- Correo dirigido AL CLIENTE: aviso de estado del servicio ---------- */
function correoEstadoCliente(estado, datos) {
  const reg = datos || {};
  let asunto, titulo, mensaje, icono;

  if (estado === 'agendado') {
    icono = '✦';
    asunto = '✦ Tu servicio quedó agendado — Fresatanika';
    titulo = 'Tu servicio quedó agendado';
    mensaje = 'Confirmamos tu pago y tu trabajo ya está en nuestra agenda. Nos pondremos manos a la obra con todo el cuidado que mereces. Gracias por confiar en Fresatanika.';
  } else if (estado === 'realizado') {
    icono = '✿';
    asunto = '✿ Tu trabajo fue realizado — Fresatanika';
    titulo = 'Tu trabajo fue realizado';
    mensaje = 'Tu servicio ya fue realizado con toda nuestra dedicación. Si tenemos evidencia de tu trabajo, te la haremos llegar. Cualquier duda, estamos para acompañarte.';
  } else if (estado === 'rechazado') {
    icono = '✕';
    asunto = 'Sobre tu pago — Fresatanika';
    titulo = 'No pudimos confirmar tu pago';
    mensaje = 'No logramos confirmar el pago de tu servicio, por lo que no quedó agendado. Si crees que es un error o ya realizaste el pago, escríbenos y lo revisamos contigo con gusto.';
  } else {
    icono = '✦';
    asunto = 'Actualización de tu servicio — Fresatanika';
    titulo = 'Actualización de tu servicio';
    mensaje = 'Hay una novedad sobre tu servicio en Fresatanika.';
  }

  const cuerpo = [
    reg.cliente_nombre ? '<p style="color:#f4e6ee;font-size:14px;margin:0 0 14px;">Hola <strong style="color:#f0a3c3;">' + escaparHtml(reg.cliente_nombre) + '</strong>,</p>' : '',
    '<p style="color:#e8c9d8;font-size:13.5px;line-height:1.7;margin:0 0 18px;">' + escaparHtml(mensaje) + '</p>',
    '<table style="width:100%;border-collapse:collapse;">',
    filaCorreo('Servicio', reg.producto, 150),
    filaCorreo('Valor', reg.precio_texto, 150),
    filaCorreo('Referencia', reg.ref, 150),
    '</table>',
  ].join('');

  const html = envolturaCorreo({
    icono: icono,
    titulo: titulo,
    preheader: mensaje.slice(0, 90),
    cuerpo: cuerpo,
    pie: 'Mensaje automático · Fresatanika',
  });

  return { asunto: asunto, html: html };
}

/* ---------- Correo dirigido AL CLIENTE: evidencia del trabajo ---------- */
function correoEvidenciaCliente(reg, cids, baseUrl) {
  const r = reg || {};
  const ids = Array.isArray(cids) ? cids : [];
  const imagenes = ids.map(function (cid) {
    return '<img src="cid:' + cid + '" alt="Evidencia del trabajo" ' +
      'style="width:100%;max-width:460px;border-radius:10px;border:1px solid rgba(194,167,183,0.35);margin:0 0 12px;display:block;">';
  }).join('');
  const enlacePublico = (r.evidencia_token && baseUrl)
    ? baseUrl + '/evidencia/' + encodeURIComponent(r.ref || '') + '/' + r.evidencia_token
    : '';

  const cuerpo = [
    r.cliente_nombre ? '<p style="color:#f4e6ee;font-size:14px;margin:0 0 12px;">Hola <strong style="color:#f0a3c3;">' + escaparHtml(r.cliente_nombre) + '</strong>,</p>' : '',
    '<p style="color:#e8c9d8;font-size:13.5px;line-height:1.7;margin:0 0 18px;">Te compartimos la evidencia del trabajo realizado para <strong style="color:#f0a3c3;">' + escaparHtml(r.producto || 'tu servicio') + '</strong>. Gracias por confiar en Fresatanika ✦</p>',
    imagenes || '',
    r.evidencia_notas ? '<div style="margin-top:8px;padding:14px;background:rgba(125,55,84,0.18);border:1px solid rgba(194,167,183,0.3);border-radius:10px;color:#e8c9d8;font-size:13px;line-height:1.6;white-space:pre-wrap;">' + escaparHtml(r.evidencia_notas) + '</div>' : '',
    enlacePublico ? '<p style="margin-top:20px;text-align:center;"><a href="' + enlacePublico + '" style="display:inline-block;padding:12px 26px;border-radius:40px;background:#7D3754;color:#fff;text-decoration:none;font-size:12.5px;font-weight:700;letter-spacing:0.05em;">Ver la evidencia en línea</a></p>' : '',
  ].join('');

  return envolturaCorreo({
    icono: '✿',
    titulo: 'La evidencia de tu trabajo',
    preheader: 'Evidencia de ' + (r.producto || 'tu servicio'),
    cuerpo: cuerpo,
    pie: 'Mensaje automático · Fresatanika',
  });
}

/* ---------- Correo AL ADMINISTRADOR: alerta de inicio de sesión ---------- */
function correoAlertaLogin(evento) {
  const e = evento || {};
  const exito = !!e.exito;
  const icono = exito ? '✓' : '⚠';
  const estadoTxt = exito ? 'Acceso correcto' : 'Intento fallido';
  const rolTxt = e.rol === 'admin' ? 'Administrador' : (e.rol === 'asistente' ? 'Asistente' : '—');
  const cuerpo = [
    '<p style="color:#e8c9d8;font-size:13.5px;line-height:1.7;margin:0 0 18px;">' +
      (exito
        ? 'Se registró un <strong style="color:#f0a3c3;">inicio de sesión</strong> en el panel de administración de Fresatanika.'
        : 'Se registró un <strong style="color:#f0a3c3;">intento de acceso fallido</strong> al panel de administración de Fresatanika.') +
      '</p>',
    '<table style="width:100%;border-collapse:collapse;">',
    filaCorreo('Resultado', estadoTxt, 140),
    filaCorreo('Usuario', e.usuario || '—', 140),
    filaCorreo('Rol', exito ? rolTxt : '', 140),
    filaCorreo('Fecha y hora', formatearFecha(e.cuando), 140),
    filaCorreo('Dirección IP', e.ip, 140),
    filaCorreo('Navegador', e.agente, 140),
    '</table>',
    notaCorreo(exito
      ? 'Si reconoces este acceso, no necesitas hacer nada. Si no fuiste tú ni alguien de tu equipo, cambia las contraseñas del panel cuanto antes.'
      : 'Si no reconoces este intento, revisa quién pudo intentar entrar y considera cambiar las contraseñas del panel.'),
  ].join('');
  return envolturaCorreo({
    icono: icono,
    titulo: exito ? 'Inicio de sesión en el panel' : 'Intento de acceso al panel',
    preheader: estadoTxt + ' · ' + (e.usuario || ''),
    cuerpo: cuerpo,
    pie: 'Alerta de seguridad automática · Fresatanika',
  });
}

/* ---------- Página pública de evidencia (acceso por token) ---------- */
function paginaEvidencia(reg, baseUrl) {
  const r = reg || {};
  const token = r.evidencia_token || '';
  const refEnc = encodeURIComponent(r.ref || '');
  const fotos = (Array.isArray(r.evidencia_fotos) ? r.evidencia_fotos : []).map(function (nombre) {
    const url = (baseUrl || '') + '/evidencia-foto/' + refEnc + '/' + token + '/' + encodeURIComponent(nombre);
    return '<img class="ev-img" src="' + url + '" alt="Evidencia del trabajo" loading="lazy">';
  }).join('');

  return [
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    '<title>Fresatanika — Evidencia de tu trabajo</title>',
    '<link href="https://fonts.googleapis.com/css2?display=swap&family=Poppins:wght@300;400;700;900" rel="stylesheet">',
    '<style>', baseEstilos(),
    '.card{max-width:560px;margin:6vh auto 0;background:' + COLORES.panel + ';border:1px solid ' + COLORES.borde + ';',
    'box-shadow:0 0 0 4px rgba(125,55,84,0.15),0 24px 60px rgba(0,0,0,0.6);border-radius:14px;padding:32px 26px;}',
    'h1{font-size:21px;font-weight:900;color:' + COLORES.rosa + ';margin:6px 0 10px;text-align:center;letter-spacing:0.02em;}',
    'p.msg{font-size:13.5px;line-height:1.6;color:' + COLORES.tenue + ';margin:0 0 18px;text-align:center;}',
    '.ev-img{width:100%;border-radius:10px;border:1px solid rgba(194,167,183,0.35);margin:0 0 14px;display:block;}',
    '.notas{padding:14px 16px;background:rgba(125,55,84,0.12);border:1px solid rgba(194,167,183,0.25);border-radius:10px;',
    'color:' + COLORES.texto + ';font-size:13.5px;line-height:1.6;white-space:pre-wrap;margin:0 0 18px;}',
    '.btn{display:block;text-align:center;padding:12px 26px;border-radius:40px;background:' + COLORES.vino + ';color:#fff;',
    'text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;border:1px solid ' + COLORES.borde + ';}',
    '.vacio{text-align:center;color:' + COLORES.tenue + ';padding:20px;}',
    '</style></head><body>',
    '<div class="card">',
    '<div class="deco">꣑୧・┈</div>',
    '<h1>✿ Evidencia de tu trabajo</h1>',
    '<p class="msg">' + escaparHtml(r.producto || 'Servicio') + (r.cliente_nombre ? ' · ' + escaparHtml(r.cliente_nombre) : '') + '</p>',
    fotos || '<div class="vacio">Aún no hay imágenes de evidencia.</div>',
    r.evidencia_notas ? '<div class="notas">' + escaparHtml(r.evidencia_notas) + '</div>' : '',
    '<a class="btn" href="/">Ir a Fresatanika</a>',
    '</div></body></html>',
  ].join('');
}

module.exports = {
  paginaGracias: paginaGracias,
  paginaGraciasPedido: paginaGraciasPedido,
  adminLogin: adminLogin,
  adminDashboard: adminDashboard,
  correoNotificacion: correoNotificacion,
  correoNotificacionPedido: correoNotificacionPedido,
  correoSeguimiento: correoSeguimiento,
  correoEstadoCliente: correoEstadoCliente,
  correoEvidenciaCliente: correoEvidenciaCliente,
  correoAlertaLogin: correoAlertaLogin,
  paginaEvidencia: paginaEvidencia,
  escaparHtml: escaparHtml,
};
