'use strict';

const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { agruparClientes } = require('./agenda-clientes');
const { describirTarifa, NOTA_TARIFAS, NOTA_HISTORICO } = require('./reporte-tarifas');

// Mismo alcance que listarAgendamientos/resumenPanel: sin entregados ni eliminados.
// Se filtra también aquí para mantener coherentes resumen y detalle en ambos formatos.
function prepararReporte(registros) {
  const activos = registros.filter(r => !r.trabajo_hecho && !r.eliminado_en);
  const agendados = activos.filter(r => r.estado === 'agendado');
  const metricas = [
    ['Clientes compradores únicos (total)', agruparClientes(activos).length],
    ['Personas agendadas (clientes compradores únicos)', agruparClientes(agendados).length],
    ['Trabajos (total)', activos.length],
    ['Trabajos agendados (confirmados por entregar)', agendados.length],
    ['Trabajos por verificar', activos.filter(r => r.estado === 'pendiente_verificacion').length],
    ['Trabajos pendientes de pago', activos.filter(r => r.estado === 'pendiente_pago').length],
    ['Trabajos rechazados', activos.filter(r => r.estado === 'rechazado').length],
  ];
  return { activos, metricas };
}

const ALCANCE = 'Alcance: trabajos sin entregar ni eliminar. Personas agendadas: compradores con al menos un trabajo confirmado por entregar.';
const IDENTIDAD = 'Cuentas agrupadas por cliente_id entre pedidos; invitados por pedido; sin cuenta ni pedido, por referencia. Nunca por nombre.';

function formatearFecha(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'America/Bogota',
    });
  } catch (e) { return iso; }
}

function estadoTexto(estado) {
  if (estado === 'agendado') return 'Agendado';
  if (estado === 'rechazado') return 'Rechazado';
  if (estado === 'pendiente_verificacion') return 'En verificación';
  return 'Pendiente de pago';
}

function metodoTexto(metodo) {
  return metodo === 'transferencia' ? 'Transferencia' : 'Wompi';
}

/* ---------- EXCEL ---------- */
function generarExcel(registros) {
  const reporte = prepararReporte(registros);
  registros = reporte.activos;
  const COLS = [
    { key: 'ref',               header: 'Referencia' },
    { key: 'pedido_ref',        header: 'Pedido' },
    { key: 'producto',          header: 'Servicio' },
    { key: 'precio_texto',      header: 'Valor' },
    { key: 'metodo',            header: 'Método de pago' },
    { key: 'adelanto',          header: 'Adelanto (urgencia)' },
    { key: 'cliente_nombre',    header: 'Cliente' },
    { key: 'contacto',          header: 'Contacto (evidencia)' },
    { key: 'objetivo_nombre',   header: 'Persona a trabajar' },
    { key: 'objetivo_fecha_nac',header: 'Fecha de nacimiento' },
    { key: 'objetivo_foto',     header: 'Foto' },
    { key: 'comprobante',       header: 'Comprobante' },
    { key: 'info_extra',        header: 'Información extra' },
    { key: 'estado',            header: 'Estado' },
    { key: 'trabajo_hecho',     header: 'Trabajo realizado' },
    { key: 'wompi_tx',          header: 'Transacción Wompi' },
    { key: 'creado_en',         header: 'Creado' },
    { key: 'pagado_en',         header: 'Pagado/Confirmado' },
    { key: 'precio_cop',        header: 'Importe registrado (COP)' },
    { key: 'tarifa',            header: 'Tarifa aplicada' },
    { key: 'vista',             header: 'Divisa vista' },
    { key: 'tasa',              header: 'Tasa USD/COP registrada' },
    { key: 'metadatos',         header: 'Metadatos de tarifa' },
  ];

  const filas = registros.map(function (r) {
    const tarifa = describirTarifa(r);
    return {
      'Referencia':          r.ref || '',
      'Pedido':              r.pedido_ref || '',
      'Servicio':            r.producto || '',
      'Valor':               r.precio_texto || ('$' + (r.precio_cop || 0) + ' COP'),
      'Método de pago':      metodoTexto(r.metodo),
      'Adelanto (urgencia)': r.adelanto === 'solo' ? 'Sí (pago suelto)' : (r.adelanto === 'incluido' ? 'Sí (incluido)' : 'No'),
      'Cliente':             r.cliente_nombre || '',
      'Contacto (evidencia)': r.contacto || '',
      'Persona a trabajar':  r.objetivo_nombre || '',
      'Fecha de nacimiento': r.objetivo_fecha_nac || '',
      'Foto':                r.objetivo_foto ? 'Sí' : 'No',
      'Comprobante':         r.comprobante ? 'Sí' : 'No',
      'Información extra':   r.info_extra || '',
      'Estado':              estadoTexto(r.estado),
      'Trabajo realizado':   r.trabajo_hecho ? ('Sí — ' + formatearFecha(r.trabajo_hecho_en)) : 'No',
      'Transacción Wompi':   r.wompi_tx || '',
      'Creado':              formatearFecha(r.creado_en),
      'Pagado/Confirmado':   formatearFecha(r.pagado_en),
      'Importe registrado (COP)': r.precio_cop === undefined || r.precio_cop === null || r.precio_cop === '' ? '' : r.precio_cop,
      'Tarifa aplicada': tarifa.tarifa,
      'Divisa vista': tarifa.vista,
      'Tasa USD/COP registrada': tarifa.tasa === null ? 'No registrada' : tarifa.tasa,
      'Metadatos de tarifa': tarifa.metadatos,
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas, { header: COLS.map(function (c) { return c.header; }) });

  const anchos = [
    { wch: 28 }, { wch: 26 }, { wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
    { wch: 22 }, { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 6  },
    { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 22 }, { wch: 26 },
    { wch: 18 }, { wch: 18 },
    { wch: 26 }, { wch: 20 }, { wch: 18 }, { wch: 26 }, { wch: 40 },
  ];
  ws['!cols'] = anchos;

  const rango = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let C = rango.s.c; C <= rango.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!ws[addr]) continue;
    ws[addr].s = {
      font:      { bold: true, color: { rgb: 'FFFFFF' } },
      fill:      { fgColor: { rgb: '7D3754' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        bottom: { style: 'medium', color: { rgb: 'C2A7B7' } },
      },
    };
  }

  for (let R = 1; R <= rango.e.r; R++) {
    const fillColor = R % 2 === 0 ? 'F5EDF2' : 'FFFFFF';
    for (let C = rango.s.c; C <= rango.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = {
        fill:      { fgColor: { rgb: fillColor } },
        alignment: { vertical: 'top', wrapText: true },
        border: {
          bottom: { style: 'thin', color: { rgb: 'E0D0D8' } },
        },
      };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Agendamientos');
  const resumen = XLSX.utils.aoa_to_sheet([
    ['Métrica', 'Cantidad'],
    ...reporte.metricas,
    [],
    [ALCANCE],
    [IDENTIDAD],
    [NOTA_TARIFAS],
    [NOTA_HISTORICO],
    ['Importe registrado (COP) es el valor histórico del trabajo; solo los pagos confirmados cuentan como ingresos. Este reporte de agenda activa no incluye todos los ingresos del panel.'],
    ['El detalle de Agendamientos conserva una fila por trabajo, con su servicio y valor.'],
  ]);
  resumen['!cols'] = [{ wch: 135 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, resumen, 'Resumen');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

/* ---------- PDF ---------- */
function generarPDF(registros, res) {
  const reporte = prepararReporte(registros);
  registros = reporte.activos;
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });

  doc.pipe(res);

  const VINO  = '#7D3754';
  const ROSA  = '#F0A3C3';
  const TENUE = '#9C7788';
  const TEXTO = '#1a0710';
  const FONDO = '#FDF6FA';

  doc.rect(0, 0, doc.page.width, doc.page.height).fill(FONDO);

  doc.rect(0, 0, doc.page.width, 54).fill(VINO);
  doc.fontSize(18).fillColor('#FFFFFF').font('Helvetica-Bold')
     .text('✦ Fresatanika — Agendamientos', 36, 16);
  const fechaExport = new Date().toLocaleString('es-CO', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota',
  });
  doc.fontSize(9).fillColor(ROSA).font('Helvetica')
     .text('Exportado el ' + fechaExport, 36, 38);

  const valores = reporte.metricas.map(m => m[0] + ': ' + m[1]);
  doc.fontSize(9).fillColor(TEXTO).font('Helvetica')
     .text(valores.slice(0, 2).join('  |  '), 36, 64, { width: 770 })
     .text(valores.slice(2, 4).join('  |  '), 36, 80, { width: 770 })
     .text(valores.slice(4).join('  |  '), 36, 96, { width: 770 });
  doc.fontSize(8).fillColor(TENUE)
     .text(ALCANCE, 36, 114, { width: 770 })
     .text(IDENTIDAD, 36, 128, { width: 770 });
  doc.text(NOTA_TARIFAS, 36, 144, { width: 770 })
     .text(NOTA_HISTORICO, { width: 770 });

  const COLS = [
    { label: 'Pedido',              w: 58 },
    { label: 'Servicio',            w: 84 },
    { label: 'Valor',               w: 50 },
    { label: 'Método',              w: 44 },
    { label: 'Cliente',             w: 64 },
    { label: 'Contacto',            w: 76 },
    { label: 'Persona a trabajar',  w: 64 },
    { label: 'Info extra',          w: 66 },
    { label: 'Comprob.',            w: 38 },
    { label: 'Estado',              w: 58 },
    { label: 'Trabajo',             w: 48 },
    { label: 'Fecha',               w: 62 },
  ];

  const startX = 36;
  let y = doc.y + 12;
  const rowH = 38;
  const headerH = 34;

  doc.rect(startX, y, COLS.reduce(function (s, c) { return s + c.w; }, 0), headerH).fill(VINO);
  let x = startX;
  COLS.forEach(function (col) {
    doc.fontSize(8).fillColor('#FFFFFF').font('Helvetica-Bold')
       .text(col.label, x + 5, y + 7, { width: col.w - 10, ellipsis: true });
    x += col.w;
  });
  y += headerH;

  registros.forEach(function (r, i) {
    const isEven = i % 2 === 0;
    const totalW = COLS.reduce(function (s, c) { return s + c.w; }, 0);
    const importe = r.precio_cop === undefined || r.precio_cop === null || r.precio_cop === '' ? 'No registrado' : String(r.precio_cop);
    const detalle = 'Importe registrado: ' + importe + ' COP | ' + describirTarifa(r).detalle;
    doc.font('Helvetica').fontSize(8);
    const detalleH = doc.heightOfString(detalle, { width: totalW - 10 }) + 10;
    const alturaFila = rowH + detalleH;

    if (y + alturaFila > doc.page.height - 36) {
      doc.addPage({ margin: 36, size: 'A4', layout: 'landscape' });
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(FONDO);
      y = 36;
      doc.rect(startX, y, totalW, headerH).fill(VINO);
      let hx = startX;
      COLS.forEach(function (col) {
        doc.fontSize(8).fillColor('#FFFFFF').font('Helvetica-Bold')
           .text(col.label, hx + 5, y + 7, { width: col.w - 10, ellipsis: true });
        hx += col.w;
      });
      y += headerH;
    }

    doc.rect(startX, y, totalW, alturaFila).fill(isEven ? '#FFFFFF' : '#F5EDF2');

    const estadoColor = r.estado === 'agendado' ? '#2d7a50' : r.estado === 'rechazado' ? '#a04060' : '#8a6020';

    const adelantoNota = r.adelanto === 'solo' ? ' (adelanto)' : (r.adelanto === 'incluido' ? ' (+ adelanto)' : '');
    const pedidoCorto = r.pedido_ref ? r.pedido_ref.replace(/^FRESA-PED-/, '') : '—';
    const celdas = [
      { v: pedidoCorto, color: r.pedido_ref ? VINO : TENUE },
      { v: (r.producto || '—') + adelantoNota },
      { v: r.precio_texto || ('$' + (r.precio_cop || 0)) },
      { v: metodoTexto(r.metodo) },
      { v: r.cliente_nombre || '—' },
      { v: r.contacto || '—' },
      { v: [r.objetivo_nombre, r.objetivo_fecha_nac].filter(Boolean).join(' · ') || '—' },
      { v: (r.info_extra || '—').slice(0, 60) },
      { v: r.comprobante ? 'Sí' : '—', color: r.comprobante ? '#2d7a50' : TENUE },
      { v: estadoTexto(r.estado), color: estadoColor },
      { v: r.trabajo_hecho ? 'Realizado' : '—', color: r.trabajo_hecho ? '#2d7a50' : TENUE },
      { v: formatearFecha(r.pagado_en || r.creado_en) },
    ];

    let cx = startX;
    celdas.forEach(function (c, ci) {
      doc.fontSize(7.5).fillColor(c.color || TEXTO).font('Helvetica')
         .text(c.v, cx + 5, y + 7, { width: COLS[ci].w - 10, height: rowH - 10, ellipsis: true });
      cx += COLS[ci].w;
    });

    doc.fontSize(8).fillColor(TEXTO).font('Helvetica')
       .text(detalle, startX + 5, y + rowH + 3, { width: totalW - 10 });
    doc.strokeColor('#E0D0D8').lineWidth(0.3)
       .moveTo(startX, y + alturaFila).lineTo(startX + totalW, y + alturaFila).stroke();

    y += alturaFila;
  });

  const pages = doc.bufferedPageRange ? doc.bufferedPageRange() : null;
  doc.end();
}

module.exports = { generarExcel: generarExcel, generarPDF: generarPDF };
