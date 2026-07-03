'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'agendamientos.json');
const PROMOS_FILE = path.join(DATA_DIR, 'promociones.json');
const CLIENTES_FILE = path.join(DATA_DIR, 'clientes.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function asegurarDirectorios() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    escribir({ agendamientos: [] });
  }
  if (!fs.existsSync(PROMOS_FILE)) {
    escribirPromos({ promos: [], codigos: [] });
  }
  if (!fs.existsSync(CLIENTES_FILE)) {
    escribirClientes({ clientes: [] });
  }
}

function leer() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { agendamientos: [] };
  }
}

function escribir(data) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function crearAgendamiento(registro) {
  const data = leer();
  data.agendamientos.push(registro);
  escribir(data);
  return registro;
}

function obtenerPorRef(ref) {
  return leer().agendamientos.find(function (a) { return a.ref === ref; }) || null;
}

function actualizarPorRef(ref, cambios) {
  const data = leer();
  const idx = data.agendamientos.findIndex(function (a) { return a.ref === ref; });
  if (idx === -1) return null;
  data.agendamientos[idx] = Object.assign({}, data.agendamientos[idx], cambios);
  escribir(data);
  return data.agendamientos[idx];
}

function listarAgendamientos() {
  return leer().agendamientos.slice().sort(function (a, b) {
    return (b.creado_en || '').localeCompare(a.creado_en || '');
  });
}

// Todos los agendamientos que comparten una referencia de pedido (carrito).
function obtenerPorPedido(pedidoRef) {
  if (!pedidoRef) return [];
  return leer().agendamientos.filter(function (a) { return a.pedido_ref === pedidoRef; });
}

// Aplica los mismos cambios a todos los agendamientos de un pedido en una sola
// escritura (p. ej. marcarlos todos como agendados al confirmarse el pago).
function actualizarPorPedido(pedidoRef, cambios) {
  const data = leer();
  const afectados = [];
  data.agendamientos.forEach(function (a, i) {
    if (a.pedido_ref === pedidoRef) {
      data.agendamientos[i] = Object.assign({}, a, cambios);
      afectados.push(data.agendamientos[i]);
    }
  });
  if (afectados.length) escribir(data);
  return afectados;
}

function eliminarFoto(nombre) {
  if (!nombre) return;
  try { fs.unlinkSync(path.join(UPLOADS_DIR, nombre)); } catch (e) { /* noop */ }
}

function eliminarAdjuntos(registro) {
  if (!registro) return;
  eliminarFoto(registro.objetivo_foto);
  eliminarFoto(registro.comprobante);
}

function eliminarPorRef(ref) {
  const data = leer();
  const idx = data.agendamientos.findIndex(function (a) { return a.ref === ref; });
  if (idx === -1) return false;
  eliminarAdjuntos(data.agendamientos[idx]);
  data.agendamientos.splice(idx, 1);
  escribir(data);
  return true;
}

function eliminarPendientesAntiguos(horas) {
  const limite = Date.now() - horas * 60 * 60 * 1000;
  const data = leer();
  let eliminados = 0;
  const restantes = [];
  data.agendamientos.forEach(function (a) {
    const esPendiente = a.estado === 'pendiente_pago';
    const creado = a.creado_en ? new Date(a.creado_en).getTime() : 0;
    if (esPendiente && creado && creado < limite) {
      eliminarAdjuntos(a);
      eliminados++;
    } else {
      restantes.push(a);
    }
  });
  if (eliminados > 0) {
    data.agendamientos = restantes;
    escribir(data);
  }
  return eliminados;
}

/* ---------- Promociones (promos por fecha y códigos) ---------- */
function leerPromos() {
  try {
    const data = JSON.parse(fs.readFileSync(PROMOS_FILE, 'utf8'));
    if (!Array.isArray(data.promos)) data.promos = [];
    if (!Array.isArray(data.codigos)) data.codigos = [];
    return data;
  } catch (e) {
    return { promos: [], codigos: [] };
  }
}

function escribirPromos(data) {
  const tmp = PROMOS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, PROMOS_FILE);
}

function listarPromos() {
  return leerPromos().promos.slice();
}

function crearPromo(promo) {
  const data = leerPromos();
  data.promos.push(promo);
  escribirPromos(data);
  return promo;
}

function eliminarPromo(id) {
  const data = leerPromos();
  const idx = data.promos.findIndex(function (p) { return p.id === id; });
  if (idx === -1) return false;
  data.promos.splice(idx, 1);
  escribirPromos(data);
  return true;
}

function listarCodigos() {
  return leerPromos().codigos.slice();
}

function crearCodigo(codigo) {
  const data = leerPromos();
  data.codigos.push(codigo);
  escribirPromos(data);
  return codigo;
}

function eliminarCodigo(id) {
  const data = leerPromos();
  const idx = data.codigos.findIndex(function (c) { return c.id === id; });
  if (idx === -1) return false;
  data.codigos.splice(idx, 1);
  escribirPromos(data);
  return true;
}

/* ---------- Cuentas de cliente (correo + contraseña) ---------- */
// Totalmente independientes del acceso de administrador. Cada cliente guarda su
// carrito en el servidor para retomarlo desde cualquier dispositivo.
function leerClientes() {
  try {
    const data = JSON.parse(fs.readFileSync(CLIENTES_FILE, 'utf8'));
    if (!Array.isArray(data.clientes)) data.clientes = [];
    return data;
  } catch (e) {
    return { clientes: [] };
  }
}

function escribirClientes(data) {
  const tmp = CLIENTES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, CLIENTES_FILE);
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function obtenerClientePorEmail(email) {
  const e = normalizarEmail(email);
  if (!e) return null;
  return leerClientes().clientes.find(function (c) { return c.email === e; }) || null;
}

function obtenerClientePorId(id) {
  if (!id) return null;
  return leerClientes().clientes.find(function (c) { return c.id === id; }) || null;
}

function crearCliente(cliente) {
  const data = leerClientes();
  data.clientes.push(cliente);
  escribirClientes(data);
  return cliente;
}

function actualizarClientePorId(id, cambios) {
  const data = leerClientes();
  const idx = data.clientes.findIndex(function (c) { return c.id === id; });
  if (idx === -1) return null;
  data.clientes[idx] = Object.assign({}, data.clientes[idx], cambios);
  escribirClientes(data);
  return data.clientes[idx];
}

function guardarCarritoCliente(id, carrito) {
  return actualizarClientePorId(id, { carrito: Array.isArray(carrito) ? carrito : [] });
}

asegurarDirectorios();

module.exports = {
  DATA_DIR: DATA_DIR,
  DB_FILE: DB_FILE,
  UPLOADS_DIR: UPLOADS_DIR,
  crearAgendamiento: crearAgendamiento,
  obtenerPorRef: obtenerPorRef,
  actualizarPorRef: actualizarPorRef,
  obtenerPorPedido: obtenerPorPedido,
  actualizarPorPedido: actualizarPorPedido,
  listarAgendamientos: listarAgendamientos,
  eliminarPorRef: eliminarPorRef,
  eliminarPendientesAntiguos: eliminarPendientesAntiguos,
  listarPromos: listarPromos,
  crearPromo: crearPromo,
  eliminarPromo: eliminarPromo,
  listarCodigos: listarCodigos,
  crearCodigo: crearCodigo,
  eliminarCodigo: eliminarCodigo,
  normalizarEmail: normalizarEmail,
  obtenerClientePorEmail: obtenerClientePorEmail,
  obtenerClientePorId: obtenerClientePorId,
  crearCliente: crearCliente,
  actualizarClientePorId: actualizarClientePorId,
  guardarCarritoCliente: guardarCarritoCliente,
};
