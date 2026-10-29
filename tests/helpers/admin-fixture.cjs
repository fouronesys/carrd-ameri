'use strict';

// Isolated application: no connection to PostgreSQL, Wompi, SMTP or live data.
if (require.main === module) {
  process.env.ADMIN_PASSWORD = 'isolated-admin-test';
  process.env.ASSISTANT_PASSWORD = 'isolated-assistant-test';
  process.env.SESSION_SECRET = 'isolated-session-test-not-a-live-secret';
  process.env.NODE_ENV = 'test';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_sintetica';
  process.env.WOMPI_PRIVATE_KEY = 'prv_test_sintetica';
  process.env.WOMPI_INTEGRITY_SECRET = 'integridad-sintetica';
}
const session = require('express-session');
function sustituir(nombre, exports) {
  const id = require.resolve(nombre);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const servicios = new Map();
const historial = [];
const usuarios = new Map();
const destinatarios = new Map();
const trabajos = new Map([
  ['TEST-OLD', { ref: 'TEST-OLD', estado: 'agendado', producto: 'Trabajo de prueba antiguo', precio_cop: 20000, creado_en: '2026-01-01', cliente_id: 'TEST-CLIENT' }],
  ['TEST-NEW', { ref: 'TEST-NEW', estado: 'agendado', producto: 'Trabajo de prueba reciente', precio_cop: 30000, creado_en: '2026-02-01' }],
]);
const llamadas = {};
const copia = x => JSON.parse(JSON.stringify(x));
const tipoServicio = r => require('../../lib/tipo-servicio').tipoServicio(r, [...servicios.values()]);
function sembrarAgendaAgrupada() {
  trabajos.clear();
  const datos = [
    { ref: 'CLIENTE-A-1', cliente_id: 'CLIENTE-A', pedido_ref: 'PEDIDO-A-1', producto: 'Servicio primero', estado: 'agendado', cliente_nombre: 'Cliente de prueba', contacto: '3000000001' },
    { ref: 'CLIENTE-A-2', cliente_id: 'CLIENTE-A', pedido_ref: 'PEDIDO-A-2', producto: 'Servicio segundo', estado: 'agendado', cliente_nombre: 'Cliente de prueba', contacto: '3000000001' },
    { ref: 'CLIENTE-A-3', cliente_id: 'CLIENTE-A', producto: 'Servicio por verificar', estado: 'pendiente_verificacion', cliente_nombre: 'Cliente de prueba' },
    { ref: 'INVITADO-1', pedido_ref: 'PEDIDO-INVITADO', producto: 'Lectura invitado', estado: 'agendado', cliente_nombre: 'Invitado de prueba', contacto: '3000000002' },
    { ref: 'INVITADO-2', pedido_ref: 'PEDIDO-INVITADO', producto: 'Servicio adicional invitado', estado: 'agendado', cliente_nombre: 'Invitado de prueba' },
    { ref: 'SIN-PAGO', producto: 'Servicio sin pagar', estado: 'pendiente_pago', cliente_nombre: 'Cliente de prueba', contacto: '3000000003' },
  ];
  datos.forEach((r, i) => trabajos.set(r.ref, {
    precio_cop: 20000, creado_en: '2026-01-01', objetivo_nombre: 'Persona objetivo ' + (i + 1), metodo: 'wompi', ...r,
  }));
}
const db = {
  DATA_DIR: '/tmp', UPLOADS_DIR: '/tmp', pool: {},
  listarCatalogo: async () => copia([...servicios.values()]),
  listarCatalogoActivo: async () => copia([...servicios.values()].filter(i => i.activo)),
  obtenerCatalogoPorId: async id => servicios.has(id) ? copia(servicios.get(id)) : null,
  guardarCatalogoItem: async (i, actor) => {
    historial.push(require('../../lib/catalogo-historial').evento('creacion', null, i, actor));
    servicios.set(i.id, copia(i)); return copia(i);
  },
  actualizarCatalogoItem: async (id, cambios, actor, operacion) => {
    if (!servicios.has(id)) return null;
    const antes = copia(servicios.get(id));
    cambios = { ...cambios };
    if (operacion === 'estado') cambios = { activo: antes.activo === false, actualizado_en: new Date().toISOString() };
    else delete cambios.activo;
    const nuevo = { ...antes, ...cambios };
    historial.push(require('../../lib/catalogo-historial').evento(operacion === 'estado' ? (nuevo.activo ? 'activacion' : 'desactivacion') : 'edicion', antes, nuevo, actor));
    servicios.set(id, nuevo); return copia(nuevo);
  },
  eliminarCatalogoItem: async (id, actor) => {
    if (!servicios.has(id)) return null;
    const antes = copia(servicios.get(id));
    historial.push(require('../../lib/catalogo-historial').evento('eliminacion', antes, null, actor));
    servicios.delete(id); return antes;
  },
  listarHistorialCatalogo: async query => {
    const filtros = require('../../lib/catalogo-historial').filtros(query);
    const eventos = [...historial].reverse().filter(e =>
      (!filtros.accion || e.accion === filtros.accion) &&
      (!filtros.desde || e.fecha >= filtros.desde + 'T00:00:00.000Z') &&
      (!filtros.hasta || e.fecha <= filtros.hasta + 'T23:59:59.999Z') &&
      (!filtros.buscar || [e.catalogo_id, e.usuario, e.usuario_id, e.anterior?.nombre, e.nuevo?.nombre].join(' ').toLowerCase().includes(filtros.buscar.toLowerCase())));
    const offset = (filtros.pagina - 1) * 30;
    return { filtros, eventos: copia(eventos.slice(offset, offset + 30)), hayMas: eventos.length > offset + 30 };
  },
  listarAgendamientos: async () => copia([...trabajos.values()].filter(r => !r.trabajo_hecho && !r.eliminado_en)),
  listarAgendaPanel: async query => {
    const filtros = require('../../lib/agenda-panel').opcionesAgenda(query);
    const grupos = require('../../lib/agenda-clientes').agruparClientes(
      [...trabajos.values()].filter(r => !r.trabajo_hecho && !r.eliminado_en && (filtros.tipo === 'todos' || tipoServicio(r) === filtros.tipo))
        .map(r => ({ ...r, tipo_servicio: tipoServicio(r) }))
    ).filter(g => (filtros.estado === 'todos' || g.registros.some(r => r.estado === filtros.estado)) &&
      (!filtros.buscar || g.registros.some(r => [r.ref, r.pedido_ref, r.cliente_nombre, r.contacto, r.producto, r.objetivo_nombre, r.cliente_email]
        .join(' ').toLowerCase().includes(filtros.buscar.toLowerCase()))));
    const paginas = Math.max(1, Math.ceil(grupos.length / filtros.tamano));
    const pagina = Math.min(filtros.pagina, paginas);
    return { ...filtros, pagina, paginas, personas: grupos.length,
      trabajos: grupos.reduce((n, g) => n + g.registros.length, 0),
      registros: copia(grupos.slice((pagina - 1) * filtros.tamano, pagina * filtros.tamano).flatMap(g => g.registros)) };
  },
  listarRealizados: async (tipo = 'todos') => copia([...trabajos.values()].filter(r => r.trabajo_hecho && (tipo === 'todos' || tipoServicio(r) === tipo))),
  crearAgendamiento: async r => { trabajos.set(r.ref, copia(r)); return copia(r); },
  obtenerPorPedido: async ref => copia([...trabajos.values()].filter(r => r.pedido_ref === ref)),
  obtenerPorRef: async ref => trabajos.has(ref) ? copia(trabajos.get(ref)) : null,
  actualizarPorRef: async (ref, cambios) => { Object.assign(trabajos.get(ref), cambios); return copia(trabajos.get(ref)); },
  marcarTrabajoRealizado: async ref => {
    Object.assign(trabajos.get(ref), { trabajo_hecho: true, trabajo_hecho_en: new Date().toISOString() });
    return copia(trabajos.get(ref));
  },
  procesarSiguienteAvisoRealizado: async () => false,
  obtenerClientePorId: async () => ({ email: 'cliente@example.invalid' }),
  resumenPanel: async (tipo = 'todos') => {
    const activos = [...trabajos.values()].filter(r => !r.trabajo_hecho && !r.eliminado_en && (tipo === 'todos' || tipoServicio(r) === tipo));
    const pagados = activos.filter(r => r.estado === 'agendado');
    return {
      total: activos.length, agendados: pagados.length,
      personas_agendadas: require('../../lib/agenda-clientes').agruparClientes(pagados).length,
      verificar: activos.filter(r => r.estado === 'pendiente_verificacion').length,
      realizados: [...trabajos.values()].filter(r => r.trabajo_hecho && !r.eliminado_en && (tipo === 'todos' || tipoServicio(r) === tipo)).length,
      ingresos: [...trabajos.values()].filter(r => r.estado === 'agendado' && (tipo === 'todos' || tipoServicio(r) === tipo))
        .reduce((s, r) => s + (Number(r.precio_cop) || 0), 0), catalogo: servicios.size,
    };
  },
  listarPromos: async () => [], listarCodigosConUsos: async () => [],
  listarUsuariosAdmin: async () => copia([...usuarios.values()]),
  obtenerUsuarioAdmin: async nombre => copia([...usuarios.values()].find(u => u.usuario === nombre) || null),
  obtenerUsuarioAdminPorId: async id => copia(usuarios.get(id) || null),
  crearUsuarioAdmin: async u => { usuarios.set(u.id, copia(u)); return copia(u); },
  actualizarUsuarioAdmin: async (id, cambios) => {
    if (!usuarios.has(id)) return null;
    Object.assign(usuarios.get(id), cambios); return copia(usuarios.get(id));
  },
  eliminarUsuarioAdmin: async id => usuarios.delete(id),
  listarDestinatariosNotificaciones: async () => copia([...destinatarios.values()]),
  obtenerDestinatarioNotificaciones: async id => copia(destinatarios.get(id) || null),
  guardarDestinatarioNotificaciones: async d => {
    if ([...destinatarios.values()].some(x => x.email === d.email && x.id !== d.id)) {
      throw Object.assign(new Error('duplicado'), { code: '23505' });
    }
    destinatarios.set(d.id, copia(d)); return copia(d);
  },
  eliminarDestinatarioNotificaciones: async id => destinatarios.delete(id),
  listarAccesos: async () => [],
  listarEliminados: async (tipo = 'todos') => copia([...trabajos.values()].filter(r => r.eliminado_en && (tipo === 'todos' || tipoServicio(r) === tipo))),
  registrarAcceso: async () => {}, verificarConexion: async () => {},
};
for (const nombre of Object.keys(db)) {
  if (typeof db[nombre] !== 'function') continue;
  const original = db[nombre];
  db[nombre] = async (...args) => { llamadas[nombre] = (llamadas[nombre] || 0) + 1; return original(...args); };
}
sustituir('../../lib/db', db);
sustituir('../../lib/mailer', {
  enviarAlertaLogin: async () => ({ enviado: false }),
  enviarEstadoCliente: async () => { await new Promise(r => setTimeout(r, 1200)); return { enviado: true }; },
});
sustituir('connect-pg-simple', () => session.MemoryStore);
const divisasReales = require('../../lib/divisas');
sustituir('../../lib/divisas', { ...divisasReales, crearDivisas: () => divisasReales.crearDivisas({
  fetchImpl: async () => ({ ok: !process.argv.includes('--sin-tasas'), json: async () => require('./tasas.cjs').tasasPrueba() }),
}) });
const { app } = require('../../server');
// These diagnostic routes exist only in this test entrypoint.
app.get('/__test/state', (req, res) => res.json({
  llamadas, servicios: [...servicios.values()], trabajos: [...trabajos.values()],
  usuarios: [...usuarios.values()].map(({ salt, hash, ...u }) => u),
  destinatarios: [...destinatarios.values()],
}));
if (require.main === module) {
  if (process.argv.includes('--agenda-clientes')) sembrarAgendaAgrupada();
  if (process.argv.includes('--divisas')) {
    sembrarAgendaAgrupada();
    trabajos.set('LECTURA-1', { ref: 'LECTURA-1', tipo_servicio: 'lectura', cliente_id: 'CLIENTE-A',
      cliente_nombre: 'Cliente de prueba', producto: 'Lectura de prueba', estado: 'agendado', precio_cop: 40000 });
  }
  if (process.argv.includes('--agenda-paginacion')) {
    trabajos.clear();
    for (let i = 0; i < 31; i++) {
      for (let j = 0; j < (i === 30 ? 1 : 3); j++) {
        const ref = 'PAG-' + i + '-' + j;
        trabajos.set(ref, {
          ref, cliente_id: 'PAG-C-' + i, pedido_ref: 'PED-' + i,
          cliente_nombre: 'Comprador ' + i, contacto: 'contacto-' + i,
          producto: 'Servicio ' + j, estado: j === 2 ? 'pendiente_verificacion' : 'agendado',
          creado_en: '2026-01-01',
        });
      }
    }
  }
  const servidor = app.listen(Number(process.env.PORT || 5052), '0.0.0.0', () => console.log('Isolated admin fixture ready'));
  process.on('SIGTERM', () => servidor.close(() => process.exit(0)));
}
module.exports = { app, servicios, historial, trabajos, llamadas, usuarios, destinatarios, sembrarAgendaAgrupada };
