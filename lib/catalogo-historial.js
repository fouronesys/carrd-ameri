'use strict';

const ACCIONES = {
  creacion: 'Creación', edicion: 'Edición', activacion: 'Activación',
  desactivacion: 'Desactivación', eliminacion: 'Eliminación',
};
const CAMPOS = {
  id: 'ID', nombre: 'Nombre', tipo: 'Tipo', seccion: 'Sección', descripcion: 'Descripción',
  icono: 'Símbolo', precio_cop: 'Precio COP', precio_usd: 'Precio USD', orden: 'Orden',
  activo: 'Publicado', clave: 'Clave', creado_en: 'Creado', actualizado_en: 'Actualizado',
};

// Lista permitida: nunca copiar el cuerpo HTTP, la sesión ni credenciales.
function instantanea(item) {
  if (!item) return null;
  const salida = {};
  for (const campo of Object.keys(CAMPOS)) {
    const valor = item[campo];
    if (['string', 'number', 'boolean'].includes(typeof valor) || valor === null) salida[campo] = valor;
  }
  return salida;
}

function evento(accion, anterior, nuevo, actor) {
  if (!actor || actor.rol !== 'admin' || typeof actor.usuario !== 'string' || !actor.usuario.trim()) {
    throw new Error('Se requiere un usuario administrador para registrar el cambio.');
  }
  if (!ACCIONES[accion]) throw new Error('Acción de catálogo inválida.');
  return {
    accion, fecha: new Date().toISOString(), catalogo_id: (nuevo || anterior).id,
    usuario: actor.usuario.slice(0, 120), usuario_id: String(actor.usuario_id || '').slice(0, 120),
    anterior: instantanea(anterior), nuevo: instantanea(nuevo),
  };
}

function filtros(query) {
  const q = query || {};
  const texto = valor => typeof valor === 'string' ? valor.trim().slice(0, 160) : '';
  const fecha = valor => {
    const s = texto(valor);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 1 &&
      Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : '';
  };
  return {
    buscar: texto(q.h_buscar), accion: Object.hasOwn(ACCIONES, q.h_accion) ? q.h_accion : '',
    desde: fecha(q.h_desde), hasta: fecha(q.h_hasta),
    pagina: Math.min(1000000, Math.max(1, parseInt(q.h_pagina, 10) || 1)),
  };
}

module.exports = { ACCIONES, CAMPOS, instantanea, evento, filtros };
