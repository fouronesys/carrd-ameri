(function () {
  'use strict';
  var secuencia = 0, aplicada = 0, generacion = 0, guardando = false;
  var pendiente = null, fallos = 0, canal;
  var campos = {
    'stat-personas': 'personas_agendadas', 'stat-agendados': 'agendados',
    'stat-total': 'total', 'stat-verificar': 'verificar', 'stat-ingresos': 'ingresos_registrados',
    'stat-servicios': 'ingresos',
    'stat-comisiones': 'comisiones', 'stat-cobrado': 'cobrado',
    'stat-sin-desglose': 'ingresos_sin_desglose',
  };
  function tipoActual() { return new URLSearchParams(location.search).get('tipo') || 'trabajo'; }
  function consulta() { return { numero: ++secuencia, generacion: generacion, tipo: tipoActual() }; }
  function vigente(turno) {
    return turno && turno.generacion === generacion && turno.tipo === tipoActual() && turno.numero >= aplicada;
  }
  function estado(mensaje) {
    var el = document.getElementById('contadores-estado');
    if (el) { if (el.textContent !== mensaje) el.textContent = mensaje; el.hidden = !mensaje; }
  }
  function numero(n) {
    return (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') &&
      Number.isFinite(Number(n)) && Number(n) >= 0;
  }
  function aplicar(resumen, turno) {
    if (!vigente(turno)) return false;
    // No mezclar un resumen parcial con valores anteriores ni aceptar un login HTML.
    if (!resumen || !Object.values(campos).concat(['realizados', 'catalogo']).every(function (clave) {
      return numero(resumen[clave]);
    })) throw new Error('Resumen incompleto');
    var cambiaron = false;
    Object.keys(campos).forEach(function (id) {
      var el = document.getElementById(id), n = Number(resumen[campos[id]]);
      if (!el) return;
      var texto = ['stat-ingresos', 'stat-servicios', 'stat-comisiones', 'stat-cobrado'].includes(id)
        ? '$' + n.toLocaleString('es-CO') : String(n);
      if (el.textContent !== texto) cambiaron = true;
      el.textContent = texto;
      if (id === 'stat-verificar') el.parentElement.classList.toggle('destacado', n > 0);
    });
    [['agenda', 'personas_agendadas'], ['realizados', 'realizados'], ['catalogo', 'catalogo']].forEach(function (par) {
      var el = document.querySelector('[data-tab="' + par[0] + '"] .tab-count');
      if (el) el.textContent = String(Number(resumen[par[1]]));
    });
    aplicada = turno.numero;
    fallos = 0;
    estado('');
    // Datos de otra sesión: avisar, nunca reorganizar el recorrido o sus borradores.
    var aviso = document.getElementById('agenda-cambios');
    if (cambiaron && !guardando && aviso) aviso.hidden = false;
    return true;
  }
  async function actualizar() {
    if (pendiente) return pendiente.promesa;
    if (guardando) estado('Actualizando contadores…');
    var turno = consulta(), controlador = new AbortController();
    var espera = setTimeout(function () { controlador.abort(); }, 10000);
    var peticion = { controlador: controlador };
    pendiente = peticion;
    peticion.promesa = (async function () {
      try {
        var r = await fetch('/admin/resumen?' + new URLSearchParams({ tipo: turno.tipo }), {
          credentials: 'same-origin', cache: 'no-store', signal: controlador.signal,
        });
        if (!vigente(turno)) return false;
        if (r.status === 401 || r.status === 403) {
          estado('Sesión caducada: los contadores conservan el último valor confirmado. Inicia sesión en otra pestaña.');
          return false;
        }
        if (!r.ok || !(r.headers.get('content-type') || '').includes('application/json')) throw new Error('Respuesta no válida');
        var datos = await r.json();
        if (!datos || datos.ok !== true || datos.tipo !== turno.tipo) throw new Error('Resumen no válido');
        return aplicar(datos.resumen, turno);
      } catch (_) {
        if (vigente(turno) && (++fallos >= 2 || guardando)) estado(
          'No se pudieron actualizar los contadores. Se muestran los últimos valores confirmados; se reintentará automáticamente.');
        return false;
      } finally {
        clearTimeout(espera);
        if (pendiente === peticion) pendiente = null;
      }
    })();
    return peticion.promesa;
  }
  function cancelar() {
    if (pendiente) pendiente.controlador.abort();
    pendiente = null;
  }
  function tick() { if (!document.hidden && !guardando) return actualizar(); }
  window.adminContadores = {
    consulta: consulta,
    aceptarDocumento: function (doc) {
      var turno = doc.contadoresTurno;
      if (!vigente(turno)) return false;
      aplicada = turno.numero;
      fallos = 0;
      estado('');
      return true;
    },
    pausar: function () { guardando = true; generacion++; cancelar(); },
    reanudar: function () { guardando = false; },
    actualizar: actualizar,
    avisar: function () { if (canal) canal.postMessage('cambio'); },
  };
  setInterval(tick, 5000);
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick);
  window.addEventListener('online', tick);
  window.addEventListener('pageshow', function (e) { if (e.persisted) tick(); });
  if (typeof BroadcastChannel === 'function') {
    try {
      canal = new BroadcastChannel('fresatanika-admin-contadores');
      canal.onmessage = function (e) { if (e.data === 'cambio') tick(); };
    } catch (_) {
      console.info('Sin comunicación entre pestañas; los contadores se actualizarán automáticamente cada cinco segundos.');
    }
  }
})();
