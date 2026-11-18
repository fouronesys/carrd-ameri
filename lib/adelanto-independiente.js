'use strict';

// Compatibilidad de lectura: los carritos antiguos guardaban la urgencia como
// extra. Otros extras no son adelantos y deben conservar su tratamiento.
function esAdelantoIndependiente(r) {
  return r?.adelanto === 'solo' ||
    (r?.adelanto === 'extra' && String(r.producto || '').trim().toLowerCase() === 'adelanto (urgencia)');
}
// campo solo se pasa desde constantes internas, nunca desde una petición.
function sqlAdelantoIndependiente(campo = 'data') {
  return `(coalesce(${campo}->>'adelanto','') = 'solo' OR
    (coalesce(${campo}->>'adelanto','') = 'extra' AND
      lower(btrim(coalesce(${campo}->>'producto',''))) = 'adelanto (urgencia)'))`;
}
module.exports = { esAdelantoIndependiente, sqlAdelantoIndependiente };
