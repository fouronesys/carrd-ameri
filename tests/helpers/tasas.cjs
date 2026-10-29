'use strict';
function tasasPrueba() {
  return { result: 'success', base_code: 'USD', time_last_update_unix: Math.floor(Date.now() / 1000),
    rates: { USD: 1, COP: 4000, EUR: 0.9, MXN: 20, PEN: 3.8, DOP: 60, ARS: 1000, BRL: 5, CLP: 950, PYG: 7500, VES: 50 } };
}
module.exports = { tasasPrueba };
