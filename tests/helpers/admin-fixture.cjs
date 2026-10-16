'use strict';

// Isolated application: no connection to PostgreSQL, Wompi, SMTP or live data.
if (require.main === module) {
  process.env.ADMIN_PASSWORD = 'isolated-admin-test';
  process.env.ASSISTANT_PASSWORD = 'isolated-assistant-test';
  process.env.SESSION_SECRET = 'isolated-session-test-not-a-live-secret';
  process.env.NODE_ENV = 'test';
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
  listarAgendaPanel: async () => copia([...trabajos.values()].filter(r => !r.trabajo_hecho)),
  listarRealizados: async () => copia([...trabajos.values()].filter(r => r.trabajo_hecho)),
  obtenerPorRef: async ref => trabajos.has(ref) ? copia(trabajos.get(ref)) : null,
  actualizarPorRef: async (ref, cambios) => { Object.assign(trabajos.get(ref), cambios); return copia(trabajos.get(ref)); },
  marcarTrabajoRealizado: async ref => {
    Object.assign(trabajos.get(ref), { trabajo_hecho: true, trabajo_hecho_en: new Date().toISOString() });
    return copia(trabajos.get(ref));
  },
  procesarSiguienteAvisoRealizado: async () => false,
  obtenerClientePorId: async () => ({ email: 'cliente@example.invalid' }),
  resumenPanel: async () => ({
    total: [...trabajos.values()].filter(r => !r.trabajo_hecho).length,
    agendados: [...trabajos.values()].filter(r => !r.trabajo_hecho).length,
    verificar: 0, realizados: [...trabajos.values()].filter(r => r.trabajo_hecho).length,
    ingresos: 50000, catalogo: servicios.size,
  }),
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
  listarAccesos: async () => [], listarEliminados: async () => [],
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
const { app } = require('../../server');
// These diagnostic routes exist only in this test entrypoint.
app.get('/__test/state', (req, res) => res.json({
  llamadas, servicios: [...servicios.values()], trabajos: [...trabajos.values()],
  usuarios: [...usuarios.values()].map(({ salt, hash, ...u }) => u),
  destinatarios: [...destinatarios.values()],
}));
if (require.main === module) {
  const servidor = app.listen(Number(process.env.PORT || 5052), '0.0.0.0', () => console.log('Isolated admin fixture ready'));
  process.on('SIGTERM', () => servidor.close(() => process.exit(0)));
}
module.exports = { app, servicios, historial, trabajos, llamadas, usuarios, destinatarios };
