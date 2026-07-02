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
    return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
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
        reg.cliente_nombre ? '<div class="fila"><span>A nombre de</span><strong>' + escaparHtml(reg.cliente_nombre) + '</strong></div>' : '',
        reg.contacto ? '<div class="fila"><span>Contacto (evidencia)</span><strong>' + escaparHtml(reg.contacto) + '</strong></div>' : '',
        reg.ref ? '<div class="fila"><span>Referencia</span><strong>' + escaparHtml(reg.ref) + '</strong></div>' : '',
       '</div>'].join('')
    : '';

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
    '</style></head><body>',
    '<div class="card">',
    '<div class="deco">꣑୧・┈</div>',
    '<div class="icono" style="color:' + colorIcono + '">' + icono + '</div>',
    '<h1>' + escaparHtml(titulo) + '</h1>',
    '<p class="msg">' + escaparHtml(mensaje) + '</p>',
    detalle,
    '<a class="btn" href="/">← Volver al catálogo</a>',
    '</div></body></html>',
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
    '<label for="password">Contraseña</label>',
    '<input type="password" id="password" name="password" autofocus autocomplete="current-password" required>',
    '<button type="submit">Entrar</button>',
    '</form></body></html>',
  ].join('');
}

/* ---------- Panel de administración: listado ---------- */
function adminDashboard(opciones) {
  const registros = (opciones && opciones.registros) || [];
  const total = registros.length;
  const agendados = registros.filter(function (r) { return r.estado === 'agendado'; }).length;
  const pendientes = total - agendados;

  const badge = function (estado) {
    if (estado === 'agendado') return '<span class="badge ok">Agendado</span>';
    if (estado === 'rechazado') return '<span class="badge no">Rechazado</span>';
    return '<span class="badge pend">Pendiente</span>';
  };

  const filas = registros.map(function (r) {
    const foto = r.objetivo_foto
      ? '<a href="/admin/foto/' + encodeURIComponent(r.objetivo_foto) + '" target="_blank">Ver foto</a>'
      : '<span class="vacio">—</span>';
    const datos = [
      r.objetivo_nombre ? '<div><b>Nombre:</b> ' + escaparHtml(r.objetivo_nombre) + '</div>' : '',
      r.objetivo_fecha_nac ? '<div><b>Nac.:</b> ' + escaparHtml(r.objetivo_fecha_nac) + '</div>' : '',
    ].join('') || '<span class="vacio">—</span>';

    const estadoCol = badge(r.estado) +
      (r.trabajo_hecho ? '<span class="badge trab">✓ Trabajo realizado</span>' : '');

    const refEnc = encodeURIComponent(r.ref || '');
    const botonTrabajo = '<form method="POST" action="/admin/trabajo/' + refEnc + '" style="margin:0">' +
      '<button class="btn-acc btn-hecho' + (r.trabajo_hecho ? ' on' : '') + '" type="submit">' +
      (r.trabajo_hecho ? '✓ Realizado' : 'Marcar realizado') + '</button></form>' +
      (r.trabajo_hecho && r.trabajo_hecho_en
        ? '<div class="hecho-fecha">' + escaparHtml(formatearFecha(r.trabajo_hecho_en)) + '</div>'
        : '');
    const botonEliminar = '<form method="POST" action="/admin/eliminar/' + refEnc + '" style="margin:0" ' +
      'onsubmit="return confirm(\'¿Eliminar este agendamiento? Esta acción no se puede deshacer.\');">' +
      '<button class="btn-acc btn-del" type="submit">Eliminar</button></form>';

    return [
      '<tr>',
      '<td><div class="prod">' + escaparHtml(r.producto || '') + '</div><div class="ref">' + escaparHtml(r.ref || '') + '</div></td>',
      '<td>' + escaparHtml(r.precio_texto || ('$' + (r.precio_cop || 0))) + '</td>',
      '<td>' + escaparHtml(r.cliente_nombre || '') + '</td>',
      '<td>' + (r.contacto ? escaparHtml(r.contacto) : '<span class="vacio">—</span>') + '</td>',
      '<td>' + datos + '</td>',
      '<td>' + foto + '</td>',
      '<td class="info">' + (r.info_extra ? escaparHtml(r.info_extra) : '<span class="vacio">—</span>') + '</td>',
      '<td>' + estadoCol + '</td>',
      '<td class="fecha">' + escaparHtml(formatearFecha(r.pagado_en || r.creado_en)) + '</td>',
      '<td><div class="acc">' + botonTrabajo + botonEliminar + '</div></td>',
      '</tr>',
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
    '.hecho-fecha{font-size:9.5px;color:' + COLORES.tenue + ';text-align:center;margin-top:2px;}',
    '.badge.trab{background:rgba(120,200,150,0.16);color:#9be0b4;border:1px solid rgba(120,200,150,0.4);display:block;margin-top:5px;}',
    '.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;}',
    '.stat{flex:1;min-width:130px;background:' + COLORES.panel + ';border:1px solid rgba(194,167,183,0.3);border-radius:12px;padding:14px 16px;}',
    '.stat .n{font-size:26px;font-weight:900;color:' + COLORES.rosa + ';}',
    '.stat .l{font-size:11px;color:' + COLORES.tenue + ';text-transform:uppercase;letter-spacing:0.08em;}',
    '.tabla-wrap{overflow-x:auto;border:1px solid rgba(194,167,183,0.25);border-radius:12px;}',
    'table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:840px;}',
    'th{background:rgba(125,55,84,0.25);color:' + COLORES.rosa + ';text-align:left;padding:11px 12px;font-weight:700;',
    'font-size:11px;text-transform:uppercase;letter-spacing:0.05em;position:sticky;top:0;}',
    'td{padding:11px 12px;border-top:1px solid rgba(194,167,183,0.14);vertical-align:top;color:' + COLORES.texto + ';}',
    'tr:hover td{background:rgba(125,55,84,0.08);}',
    '.prod{font-weight:700;}',
    '.ref{font-size:10.5px;color:' + COLORES.tenue + ';margin-top:2px;}',
    '.info{max-width:240px;white-space:pre-wrap;color:' + COLORES.tenue + ';}',
    '.fecha{color:' + COLORES.tenue + ';white-space:nowrap;}',
    '.vacio{color:#6d5460;}',
    '.badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:10.5px;font-weight:700;white-space:nowrap;}',
    '.badge.ok{background:rgba(120,200,150,0.16);color:#9be0b4;border:1px solid rgba(120,200,150,0.4);}',
    '.badge.pend{background:rgba(240,180,120,0.14);color:#f0c79a;border:1px solid rgba(240,180,120,0.4);}',
    '.badge.no{background:rgba(229,123,160,0.14);color:#f3b6cd;border:1px solid rgba(229,123,160,0.4);}',
    '.vacia{text-align:center;padding:40px;color:' + COLORES.tenue + ';}',
    '</style></head><body><div class="wrap">',
    '<div class="top"><h1>✦ Agendamientos</h1><div class="acciones"><a class="btn-exp excel" href="/admin/exportar/excel">⬇ Excel</a><a class="btn-exp pdf" href="/admin/exportar/pdf">⬇ PDF</a><form method="POST" action="/admin/logout" style="margin:0"><button class="logout" type="submit">Cerrar sesión</button></form></div></div>',
    '<div class="stats">',
    '<div class="stat"><div class="n">' + total + '</div><div class="l">Total</div></div>',
    '<div class="stat"><div class="n">' + agendados + '</div><div class="l">Agendados</div></div>',
    '<div class="stat"><div class="n">' + pendientes + '</div><div class="l">Pendientes</div></div>',
    '</div>',
    total === 0
      ? '<div class="tabla-wrap"><div class="vacia">Aún no hay agendamientos.</div></div>'
      : '<div class="tabla-wrap"><table><thead><tr>' +
        '<th>Servicio</th><th>Valor</th><th>Cliente</th><th>Contacto</th><th>Persona a trabajar</th><th>Foto</th><th>Información extra</th><th>Estado</th><th>Fecha</th><th>Acciones</th>' +
        '</tr></thead><tbody>' + filas + '</tbody></table></div>',
    '</div></body></html>',
  ].join('');
}

/* ---------- Correo de notificación ---------- */
function correoNotificacion(reg) {
  const fila = function (etiqueta, valor) {
    if (!valor) return '';
    return '<tr><td style="padding:9px 0;color:#c9a9ba;font-size:13px;width:170px;vertical-align:top;">' + escaparHtml(etiqueta) + '</td>' +
      '<td style="padding:9px 0;color:#f4e6ee;font-size:14px;font-weight:600;">' + escaparHtml(valor) + '</td></tr>';
  };
  return [
    '<div style="margin:0;padding:0;background:#0c0007;">',
    '<div style="max-width:520px;margin:0 auto;padding:28px 18px;font-family:Poppins,Arial,sans-serif;">',
    '<div style="background:#1a0710;border:1px solid #C2A7B7;border-radius:14px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.5);">',
    '<div style="background:linear-gradient(135deg,#7D3754 0%,#9C4C6D 100%);padding:26px 24px;text-align:center;">',
    '<div style="color:#f7d4e4;letter-spacing:0.25em;font-size:11px;">꣑୧・┈</div>',
    '<div style="color:#ffffff;font-size:20px;font-weight:900;letter-spacing:0.04em;margin-top:6px;">✦ Nuevo agendamiento ✦</div>',
    '<div style="color:#f7d4e4;font-size:12px;margin-top:4px;">Fresatanika</div>',
    '</div>',
    '<div style="padding:24px;">',
    '<p style="color:#f0a3c3;font-size:14px;font-weight:700;margin:0 0 14px;">' + escaparHtml(reg.producto || 'Servicio') + '</p>',
    '<table style="width:100%;border-collapse:collapse;">',
    fila('Valor', reg.precio_texto || ('$' + (reg.precio_cop || 0) + ' COP')),
    fila('Cliente', reg.cliente_nombre),
    fila('Contacto (evidencia)', reg.contacto),
    fila('Persona a trabajar', reg.objetivo_nombre),
    fila('Fecha de nacimiento', reg.objetivo_fecha_nac),
    fila('Foto adjunta', reg.objetivo_foto ? 'Sí (revísala en el panel de administración)' : ''),
    fila('Información extra', reg.info_extra),
    fila('Referencia', reg.ref),
    fila('Transacción Wompi', reg.wompi_tx),
    fila('Pagado el', formatearFecha(reg.pagado_en || reg.creado_en)),
    '</table>',
    '<div style="margin-top:22px;padding:14px;background:rgba(125,55,84,0.18);border:1px solid rgba(194,167,183,0.3);border-radius:10px;color:#e8c9d8;font-size:12.5px;line-height:1.6;">',
    'El pago fue <strong style="color:#f0a3c3;">aprobado</strong> y el cliente quedó agendado. Ingresa al panel de administración para ver todos los detalles.',
    '</div>',
    '</div>',
    '<div style="padding:16px 24px;border-top:1px solid rgba(194,167,183,0.2);text-align:center;color:#9c7788;font-size:11px;">',
    'Notificación automática · Fresatanika',
    '</div>',
    '</div></div></div>',
  ].join('');
}

module.exports = {
  paginaGracias: paginaGracias,
  adminLogin: adminLogin,
  adminDashboard: adminDashboard,
  correoNotificacion: correoNotificacion,
  escaparHtml: escaparHtml,
};
