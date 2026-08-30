'use strict';

const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

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
  ];

  const filas = registros.map(function (r) {
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
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas, { header: COLS.map(function (c) { return c.header; }) });

  const anchos = [
    { wch: 28 }, { wch: 26 }, { wch: 30 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
    { wch: 22 }, { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 6  },
    { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 22 }, { wch: 26 },
    { wch: 18 }, { wch: 18 },
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
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

/* ---------- PDF ---------- */
function generarPDF(registros, res) {
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

  const agendados   = registros.filter(function (r) { return r.estado === 'agendado'; }).length;
  const porVerificar = registros.filter(function (r) { return r.estado === 'pendiente_verificacion'; }).length;
  const pendientes  = registros.length - agendados - porVerificar;
  doc.fontSize(9).fillColor('#FFFFFF')
     .text('Total: ' + registros.length + '  |  Agendados: ' + agendados + '  |  Por verificar: ' + porVerificar + '  |  Pendientes: ' + pendientes,
       doc.page.width - 320, 28, { width: 284, align: 'right' });

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
  let y = 72;
  const rowH = 22;
  const headerH = 24;

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

    if (y + rowH > doc.page.height - 36) {
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

    doc.rect(startX, y, totalW, rowH).fill(isEven ? '#FFFFFF' : '#F5EDF2');

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
         .text(c.v, cx + 5, y + 7, { width: COLS[ci].w - 10, ellipsis: true });
      cx += COLS[ci].w;
    });

    doc.strokeColor('#E0D0D8').lineWidth(0.3)
       .moveTo(startX, y + rowH).lineTo(startX + totalW, y + rowH).stroke();

    y += rowH;
  });

  const pages = doc.bufferedPageRange ? doc.bufferedPageRange() : null;
  doc.end();
}

module.exports = { generarExcel: generarExcel, generarPDF: generarPDF };
