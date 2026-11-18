'use strict';

const { activoPagado } = require('./adelantos');
const { esAdelantoIndependiente } = require('./adelanto-independiente');
const DIA = 24 * 60 * 60 * 1000;

function fecha(valor) {
  const ms = valor ? new Date(valor).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function plazoEntrega(reg) {
  if (!activoPagado(reg) || esAdelantoIndependiente(reg)) return null;
  const base = fecha(reg.pagado_en || reg.creado_en);
  if (base === null) return null;
  const normal = base + 42 * DIA;
  const vinculado = reg.adelanto_vinculado_activo === true && !!reg.adelanto_origen_ref;
  const conAdelanto = reg.adelanto === 'incluido' || vinculado;
  // Nunca usar la fecha de vinculación: corregir una asociación no renueva el
  // plazo. Tampoco una urgencia comprada tarde prorroga la entrega original.
  const pagoAdelanto = vinculado ? fecha(reg.adelanto_pagado_en) : base;
  if (conAdelanto && pagoAdelanto === null) return null;
  const desde = conAdelanto ? Math.max(base, pagoAdelanto) : base;
  const limite = conAdelanto ? Math.min(normal, desde + 3 * DIA) : normal;
  const origen = vinculado ? reg.adelanto_origen_ref : '';
  return {
    conAdelanto,
    adelantoRef: origen,
    desde: new Date(desde).toISOString(),
    limite: new Date(limite).toISOString(),
    avisarDesde: limite - (conAdelanto ? 1 : 7) * DIA,
    clave: JSON.stringify([conAdelanto ? 'urgente' : 'normal', origen, desde, limite]),
  };
}

function avisosPrevios(reg) {
  if (Array.isArray(reg.aviso_entrega_claves)) return reg.aviso_entrega_claves;
  if (!reg.aviso_entrega_en) return [];
  // Compatibilidad con avisos históricos, que solo contemplaban el adelanto
  // incluido y el plazo normal. No deben silenciar una nueva urgencia vinculada.
  const anterior = plazoEntrega({ ...reg, adelanto_vinculado_activo: false });
  return anterior ? [anterior.clave] : [];
}

function crearProcesadorSeguimientos({ db, mailer, reloj = Date.now, logger = console }) {
  let enCurso = false;
  return async function procesarSeguimientos() {
    if (enCurso) return;
    enCurso = true;
    try {
      const ahora = reloj();
      const registros = await db.listarParaSeguimientos();
      for (const candidato of registros) {
        // Volver a consultar el vínculo y los estados, no fiarse de una lista
        // tomada antes de otros envíos SMTP potencialmente lentos.
        const reg = await db.obtenerParaSeguimiento(candidato.ref);
        if (!reg) continue;
        const plazo = plazoEntrega(reg);
        if (plazo && ahora >= plazo.avisarDesde && !avisosPrevios(reg).includes(plazo.clave)) {
          try {
            const r = await mailer.enviarAvisoEntrega(reg, {
              ...plazo, diasRestantes: Math.max(0, Math.ceil((Date.parse(plazo.limite) - ahora) / DIA)),
            });
            if (r.enviado) await db.actualizarPorRef(reg.ref, {
              aviso_entrega_en: new Date(ahora).toISOString(),
              aviso_entrega_claves: [...avisosPrevios(reg), plazo.clave],
            });
          } catch (e) { logger.error('[aviso entrega]', reg.ref, e.message); }
        }
        if (reg.estado !== 'agendado' || reg.eliminado_en ||
            !reg.trabajo_hecho || fecha(reg.trabajo_hecho_en) === null || esAdelantoIndependiente(reg)) continue;
        const meses = new Date(reg.trabajo_hecho_en);
        meses.setMonth(meses.getMonth() + 4);
        for (const [campo, tipo, limite] of [
          ['seguimiento_5s_en', '5semanas', fecha(reg.trabajo_hecho_en) + 35 * DIA],
          ['seguimiento_4m_en', '4meses', meses.getTime()],
        ]) {
          if (reg[campo] || ahora < limite) continue;
          try {
            const r = await mailer.enviarSeguimiento(reg, tipo);
            if (r.enviado) await db.actualizarPorRef(reg.ref, { [campo]: new Date(ahora).toISOString() });
          } catch (e) { logger.error('[seguimiento ' + tipo + ']', reg.ref, e.message); }
        }
      }
    } catch (e) { logger.error('[seguimiento]', e.message); }
    finally { enCurso = false; }
  };
}

module.exports = { crearProcesadorSeguimientos, plazoEntrega };
