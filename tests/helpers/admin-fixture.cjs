'use strict';

// Isolated application: no connection to PostgreSQL, Wompi, SMTP or live data.
const session = require('express-session');
function sustituir(nombre, exports) {
  const id = require.resolve(nombre);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const servicios = new Map();
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
  guardarCatalogoItem: async i => { servicios.set(i.id, copia(i)); return copia(i); },
  actualizarCatalogoItem: async (id, cambios) => { Object.assign(servicios.get(id), cambios); return copia(servicios.get(id)); },
  eliminarCatalogoItem: async id => servicios.delete(id),
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
  listarUsuariosAdmin: async () => [], listarAccesos: async () => [], listarEliminados: async () => [],
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
app.get('/__test/state', (req, res) => res.json({ llamadas, servicios: [...servicios.values()], trabajos: [...trabajos.values()] }));
if (require.main === module) {
  const servidor = app.listen(Number(process.env.PORT || 5052), '0.0.0.0', () => console.log('Isolated admin fixture ready'));
  process.on('SIGTERM', () => servidor.close(() => process.exit(0)));
}
module.exports = { app, servicios, trabajos, llamadas };
