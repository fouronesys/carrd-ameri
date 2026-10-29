'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { cargarEstaticos } = require('./catalogo-compra');
const lecturas = [...cargarEstaticos(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')).values()]
  .filter(i => i.tipo === 'lectura').map(i => i.nombre);
const nombres = new Set(lecturas);
function tipoServicio(registro, catalogo = []) {
  if (['lectura', 'trabajo'].includes(registro.tipo_servicio)) return registro.tipo_servicio;
  const item = catalogo.find(c => c.id === registro.catalogo_id);
  return item ? (item.tipo === 'lectura' ? 'lectura' : 'trabajo') : nombres.has(registro.producto) ? 'lectura' : 'trabajo';
}
// Solo fragmentos estáticos; los nombres del catálogo original se escapan como
// literales SQL. Nunca se inserta texto de una petición en esta expresión.
const SQL_TIPO = `CASE
  WHEN agendamientos.data->>'tipo_servicio' IN ('lectura','trabajo') THEN agendamientos.data->>'tipo_servicio'
  WHEN EXISTS (SELECT 1 FROM catalogo cat WHERE cat.id = agendamientos.data->>'catalogo_id' AND cat.data->>'tipo' = 'lectura') THEN 'lectura'
  WHEN EXISTS (SELECT 1 FROM catalogo cat WHERE cat.id = agendamientos.data->>'catalogo_id') THEN 'trabajo'
  WHEN agendamientos.data->>'producto' = ANY(ARRAY[${lecturas.map(n => "'" + n.replace(/'/g, "''") + "'").join(',')}]::text[]) THEN 'lectura'
  ELSE 'trabajo' END`;
function tipoPanel(valor) { return ['trabajo', 'lectura', 'todos'].includes(valor) ? valor : 'todos'; }
module.exports = { tipoServicio, tipoPanel, SQL_TIPO, lecturas };
