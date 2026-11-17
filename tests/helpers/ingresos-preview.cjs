'use strict';

// Vista visual con datos sintéticos: sin base, credenciales, sesiones ni correos.
const express = require('express');
const { adminDashboard } = require('../../lib/templates');
const registros = [
  { ref: 'DEMO-INDIVIDUAL', producto: 'Servicio individual de prueba', precio_cop: 3442,
    finanzas_compra: { version: 1, servicios_cop: 2500, comision_cop: 942, cobrado_cop: 3442 } },
  { ref: 'DEMO-CARRITO-1', pedido_ref: 'DEMO-CARRITO', pedido_total_cop: 3442,
    producto: 'Mismo servicio desde el carrito', precio_cop: 2500,
    finanzas_compra: { version: 1, servicios_cop: 2500, comision_cop: 942, cobrado_cop: 3442 } },
  { ref: 'DEMO-HISTORICO', producto: 'Registro antiguo sin desglose', precio_cop: 3442 },
].map(r => ({ estado: 'agendado', tipo_servicio: 'trabajo', metodo: 'wompi',
  creado_en: '2026-01-01', cliente_nombre: 'Comprador sintético', ...r }));
const app = express();
app.use('/assets', express.static(require('node:path').join(__dirname, '../../assets')));
app.get('/', (_, res) => res.send(adminDashboard({ registros, rol: 'admin', tipoPanel: 'todos' })));
const http = app.listen(Number(process.env.PORT || 5052), '0.0.0.0', () => console.log('Vista sintética de ingresos disponible'));
process.on('SIGTERM', () => http.close(() => process.exit(0)));
