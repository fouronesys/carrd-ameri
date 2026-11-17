'use strict';

// Vista estática de las plantillas reales con datos sintéticos, sin cargar la
// aplicación, credenciales, PostgreSQL, Wompi o SMTP. Solo para revisión visual.
const http = require('node:http');
const templates = require('../../lib/templates');
const adelanto = {
  ref: 'DEMO-ADELANTO', producto: 'Adelanto independiente', adelanto: 'solo',
  cliente_id: 'DEMO-COMPRADOR', cliente_nombre: 'Comprador de demostración', estado: 'agendado',
  adelanto_servicio_ref: 'DEMO-SERVICIO-1',
};
const candidatos = [
  { ref: 'DEMO-SERVICIO-1', producto: 'Servicio de demostración', pedido_ref: 'DEMO-PEDIDO-1' },
  { ref: 'DEMO-SERVICIO-2', producto: 'Lectura de demostración', pedido_ref: 'DEMO-PEDIDO-2' },
];
const registros = [adelanto, ...candidatos.map((r, i) => ({
  ...r, cliente_id: adelanto.cliente_id, cliente_nombre: adelanto.cliente_nombre, estado: 'agendado',
  tipo_servicio: i ? 'lectura' : 'trabajo', adelanto_origen_ref: i ? null : adelanto.ref,
  adelanto_vinculado_activo: !i,
}))];
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url === '/agenda'
    ? templates.adminDashboard({ registros, tipoPanel: 'todos' })
    : templates.panelAdelanto({ adelanto, actual: candidatos[0].ref, candidatos, servicioActual: candidatos[0] }));
});
server.listen(Number(process.env.PORT || 8082), '0.0.0.0', () => console.log('Vista sintética de adelantos lista'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
