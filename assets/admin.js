(function () {
  'use strict';
  var navegacion = 0;
  var mutando = false;
  var busquedaTimer;
  var agendaInicial = document.querySelector('#agenda-busqueda');
  var agendaUrl = agendaInicial ? agendaInicial.dataset.url : '/admin?tab=agenda';
  function seccion(id, root) { return (root || document).querySelector('[data-sec="' + id + '"]'); }
  function activa() { var el = document.querySelector('.admin-sec.activo'); return el ? el.dataset.sec : 'agenda'; }
  // Solo marcas en el DOM: no copiar notas ni archivos a almacenamiento persistente.
  var revisionBorradores = 0;
  var revisionesFormulario = new WeakMap();
  // Solo memoria del formulario abierto. Nunca reintentar por conexión, foco o temporizador.
  var enviosEvidencia = new WeakMap();
  var saliendo = false;
  var urlVisible = location.pathname + location.search;
  function borradores(root) {
    return (root || document).querySelectorAll('form[data-agenda-editado]');
  }
  function preciosPendientes(root) {
    return window.adminPreciosBorradores && window.adminPreciosBorradores.hay(root);
  }
  function confirmarBorradores(root) {
    return (!borradores(root).length && !preciosPendientes(root)) || window.confirm(
      'Hay notas, archivos seleccionados o cambios sin guardar. Al continuar pueden perderse. ¿Continuar?');
  }
  function marcarBorrador(campo) {
    var form = campo.closest('form[data-agenda-borrador], form[data-admin-borrador], form[data-usuarios-form]');
    if (!form) return;
    form.setAttribute('data-agenda-editado', '');
    revisionBorradores++;
    revisionesFormulario.set(form, revisionBorradores);
    // Una búsqueda pendiente no debe borrar lo que acaba de escribirse.
    clearTimeout(busquedaTimer);
    ++navegacion;
  }
  function limpiarBorradores() {
    borradores().forEach(function (form) {
      form.reset();
      form.removeAttribute('data-agenda-editado');
      enviosEvidencia.delete(form);
    });
    if (window.adminPreciosBorradores) window.adminPreciosBorradores.limpiar();
  }
  window.adminConfirmarBorradores = confirmarBorradores;
  document.addEventListener('catalogo:precios-editados', function () {
    revisionBorradores++;
    ++navegacion;
    clearTimeout(busquedaTimer);
  });
  window.addEventListener('beforeunload', function (e) {
    if (saliendo || (!borradores().length && !preciosPendientes())) return;
    e.preventDefault();
    e.returnValue = '';
  });
  // No recuperar notas ni archivos mediante la caché Atrás/Adelante tras salir.
  window.addEventListener('pagehide', limpiarBorradores);
  window.addEventListener('pageshow', function () { saliendo = false; });
  var comprobandoAgenda = false;
  var fallosAgenda = 0;
  var estadoComprobacion = '';
  function mostrarEstadoAgenda() {
    var indicador = document.getElementById('agenda-comprobacion');
    if (!indicador) return;
    var mensaje = estadoComprobacion === 'sesion'
      ? 'Tu sesión caducó. No se pueden comprobar novedades. Conserva esta página y abre el panel en otra pestaña para iniciar sesión; tus ediciones abiertas no se han modificado.'
      : estadoComprobacion === 'conexion'
        ? 'No se pudo conectar para comprobar novedades de la agenda. Se reintentará automáticamente. Tus ediciones abiertas no se han modificado.'
        : estadoComprobacion === 'servidor'
          ? 'No se pueden comprobar novedades de la agenda en este momento. Se reintentará automáticamente. Tus ediciones abiertas no se han modificado.'
          : '';
    indicador.textContent = mensaje;
    indicador.hidden = !mensaje;
  }
  function falloAgenda(estado) {
    fallosAgenda++;
    // Una sesión caducada no se disfraza de fallo de conexión en el siguiente intento.
    if (estado === 'sesion' || (fallosAgenda >= 3 && estadoComprobacion !== 'sesion')) {
      estadoComprobacion = estado;
    }
    mostrarEstadoAgenda();
  }
  async function comprobarAgenda() {
    if (comprobandoAgenda || mutando || document.hidden || activa() !== 'agenda') return;
    var formulario = document.querySelector('#agenda-busqueda');
    if (!formulario) return;
    var urlOriginal = formulario.dataset.url;
    var destino = new URL(urlOriginal, location.href);
    if (!destino.searchParams.get('vista')) return;
    destino.searchParams.set('comprobar_agenda', '1');
    comprobandoAgenda = true;
    var controlador = new AbortController();
    var espera = setTimeout(function () { controlador.abort(); }, 10000);
    function vigente() { return formulario.isConnected && formulario.dataset.url === urlOriginal; }
    try {
      var r = await fetch(destino.pathname + destino.search, {
        credentials: 'same-origin', cache: 'no-store', signal: controlador.signal,
      });
      if (!vigente()) return;
      if (r.status === 401 || r.status === 403) { falloAgenda('sesion'); return; }
      if (!r.ok || !(r.headers.get('content-type') || '').includes('application/json')) {
        falloAgenda('servidor'); return;
      }
      var datos = await r.json();
      if (!vigente()) return;
      if (!datos || typeof datos.cambios !== 'boolean' || typeof datos.caducada !== 'boolean') {
        falloAgenda('servidor'); return;
      }
      fallosAgenda = 0;
      estadoComprobacion = '';
      mostrarEstadoAgenda();
      var aviso = document.getElementById('agenda-cambios');
      if (aviso && datos.cambios) {
        aviso.hidden = false;
        if (datos.caducada) aviso.querySelector('[data-agenda-aviso]').textContent =
          'Este recorrido caducó. Puedes seguir revisando lo abierto y actualizar la agenda cuando termines.';
      }
    } catch (_) {
      if (vigente()) falloAgenda(!r || controlador.signal.aborted ? 'conexion' : 'servidor');
      // Los errores de fetch y de JSON no deben tocar formularios ni navegación.
    }
    finally { clearTimeout(espera); comprobandoAgenda = false; }
  }
  setInterval(comprobarAgenda, 30000);
  document.addEventListener('visibilitychange', comprobarAgenda);
  window.addEventListener('focus', comprobarAgenda);
  window.addEventListener('online', comprobarAgenda);
  function urlTab(tab) {
    if (tab === 'agenda') return agendaUrl;
    var params = new URLSearchParams(location.search);
    if (tab !== 'catalogo' || params.get('tab') !== 'catalogo') params = new URLSearchParams();
    params.set('tab', tab);
    params.set('tipo', new URLSearchParams(location.search).get('tipo') || 'trabajo');
    return '/admin?' + params.toString();
  }
  async function cargar(tab, url) {
    var r = await fetch(url || urlTab(tab), { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error('No se pudo cargar el panel. Inténtalo nuevamente.');
    var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    if (!doc.querySelector('.admin-nav')) throw new Error('Tu sesión caducó. Recarga la página e inicia sesión.');
    if (!seccion(tab, doc)) throw new Error('No tienes acceso a esta sección.');
    return doc;
  }
  function contadores(doc) {
    doc.querySelectorAll('.admin-tab').forEach(function (btn) {
      var actual = document.querySelector('[data-tab="' + btn.dataset.tab + '"] .tab-count');
      var nuevo = btn.querySelector('.tab-count');
      if (actual && nuevo) actual.textContent = nuevo.textContent;
    });
    // Los resumenes viven fuera de las secciones que se reemplazan por AJAX.
    // Sin sincronizarlos, la tabla se actualiza pero el conteo queda obsoleto.
    ['stat-personas', 'stat-agendados', 'stat-total', 'stat-verificar', 'stat-ingresos',
      'stat-comisiones', 'stat-cobrado', 'stat-sin-desglose'].forEach(function (id) {
      var actual = document.getElementById(id), nuevo = doc.getElementById(id);
      if (!actual || !nuevo) return;
      actual.textContent = nuevo.textContent;
      if (id === 'stat-verificar') actual.parentElement.className = nuevo.parentElement.className;
    });
  }
  document.addEventListener('catalogo:precios-guardados', async function () {
    try {
      var doc = await cargar('catalogo');
      // Sin destruir el editor activo: actualizar también tarjetas e historial.
      ['catalogo-lista', 'historial-catalogo'].forEach(function (id) {
        var actual = document.getElementById(id), nuevo = doc.getElementById(id);
        if (actual && nuevo) {
          nuevo = document.importNode(nuevo, true);
          conservarFormularios(actual, nuevo);
          actual.replaceWith(nuevo);
        }
      });
      filtrar();
    } catch (e) { mostrarToast('Precios guardados. Recarga el catálogo para actualizar su historial.', 'error'); }
  });
  // Mover los nodos originales conserva también contraseña, foco y revisiones,
  // sin serializar ni copiar los datos privados del formulario a otro almacén.
  function conservarFormularios(anterior, nuevo) {
    var pares = Array.from(borradores(anterior)).map(function (form) {
      var destino = Array.from(nuevo.querySelectorAll('form[action]')).find(function (f) {
        return f.getAttribute('action') === form.getAttribute('action');
      });
      if (!destino) throw new Error('Se conservó la vista porque un formulario pendiente ya no existe.');
      return [form, destino];
    });
    pares.forEach(function (par) {
      var form = par[0], destino = par[1];
      destino.replaceWith(form);
      var editor = form.closest('.catalog-edit');
      if (editor) editor.classList.add('activo');
    });
  }
  function reemplazar(tab, doc, confirmado, conservar) {
    var anterior = seccion(tab), nuevo = seccion(tab, doc);
    if (anterior && nuevo) {
      nuevo = document.importNode(nuevo, true);
      // Guardar una fila también refresca las demás: proteger sus borradores.
      if (!conservar && !confirmado && !confirmarBorradores(anterior)) {
        throw new Error('Se conservaron los formularios sin guardar.');
      }
      var visible = anterior.classList.contains('activo');
      var buscar = anterior.querySelector('#catalogo-buscador');
      var valor = buscar ? buscar.value : '';
      var select = anterior.querySelector('#catalogo-filtro');
      var seleccionado = select ? select.value : '';
      var abiertos = Array.from(anterior.querySelectorAll('details[open]')).map(function (el) {
        var form = el.querySelector('form[action]');
        return form && form.getAttribute('action');
      }).filter(Boolean);
      if (conservar) {
        conservarFormularios(anterior, nuevo);
        var precios = anterior.querySelector('[data-panel-precios]');
        var nuevosPrecios = nuevo.querySelector('[data-panel-precios]');
        if (precios && nuevosPrecios) nuevosPrecios.replaceWith(precios);
      }
      anterior.replaceChildren.apply(anterior, Array.from(nuevo.childNodes));
      anterior.querySelectorAll('details').forEach(function (el) {
        var form = el.querySelector('form[action]');
        if (form && abiertos.includes(form.getAttribute('action'))) el.open = true;
      });
      anterior.classList.toggle('activo', visible);
      buscar = anterior.querySelector('#catalogo-buscador');
      if (buscar) buscar.value = valor;
      select = anterior.querySelector('#catalogo-filtro');
      if (select && seleccionado) select.value = seleccionado;
    }
    if (tab === 'agenda') {
      var formulario = seccion(tab).querySelector('#agenda-busqueda');
      if (formulario) agendaUrl = formulario.dataset.url;
      mostrarEstadoAgenda();
    }
    contadores(doc);
    filtrar();
    if (tab === 'catalogo') {
      var crear = document.querySelector('.catalog-create form');
      if (crear) sugerir(crear, true);
    }
  }
  async function navegar(tab, guardarHistoria, url, conservarPosicion) {
    clearTimeout(busquedaTimer);
    var origen = seccion(activa()), destinoSeccion = seccion(tab);
    if (!confirmarBorradores(origen) ||
        (destinoSeccion !== origen && !confirmarBorradores(destinoSeccion))) return false;
    var revision = revisionBorradores;
    var turno = ++navegacion;
    var indicador = document.createElement('div'); indicador.className = 'admin-loading';
    document.body.appendChild(indicador);
    try {
      var doc = await cargar(tab, url);
      if (turno !== navegacion || revision !== revisionBorradores) return false;
      var y = window.scrollY;
      var campo = document.activeElement;
      var focoBusqueda = campo && campo.id === 'buscador';
      var cursor = focoBusqueda ? campo.selectionStart : null;
      reemplazar(tab, doc, true);
      document.querySelectorAll('.admin-sec').forEach(function (s) { s.classList.toggle('activo', s.dataset.sec === tab); });
      document.querySelectorAll('.admin-tab').forEach(function (b) { b.classList.toggle('activo', b.dataset.tab === tab); });
      // Los enlaces de tipo están fuera del contenido que reemplaza AJAX.
      // Mantener Entregados/Papelera al cambiar entre lecturas y trabajos.
      document.querySelectorAll('nav[aria-label="Tipo de servicio"] a').forEach(function (a) {
        var params = new URLSearchParams(a.getAttribute('href').split('?')[1]);
        params.set('tab', ['agenda', 'realizados', 'eliminados'].indexOf(tab) >= 0 ? tab : 'agenda');
        a.setAttribute('href', '/admin?' + params.toString());
      });
      var destino = tab === 'agenda' ? agendaUrl : (url || urlTab(tab));
      if (guardarHistoria) history.pushState(null, '', destino);
      else history.replaceState(null, '', destino);
      urlVisible = destino;
      if (focoBusqueda && conservarPosicion) {
        campo = document.getElementById('buscador');
        if (campo) { campo.focus({ preventScroll: true }); campo.setSelectionRange(cursor, cursor); }
      }
      window.scrollTo(0, conservarPosicion ? y : 0);
      return true;
    } catch (err) { if (turno === navegacion) mostrarToast(err.message, 'error'); }
    finally { indicador.remove(); }
  }
  function filtrar() {
    var buscador = document.getElementById('catalogo-buscador');
    var texto = (buscador ? buscador.value : '').trim().toLowerCase();
    var filtro = document.getElementById('catalogo-filtro');
    var tipo = filtro ? filtro.value : 'todos';
    var visibles = 0;
    document.querySelectorAll('[data-catalogo-item]').forEach(function (el) {
      var mostrar = (tipo === 'todos' || tipo === el.dataset.tipo || tipo === el.dataset.estado) && (!texto || el.dataset.buscar.includes(texto));
      el.style.display = mostrar ? '' : 'none';
      if (mostrar) visibles++;
    });
    var lista = document.getElementById('catalogo-lista');
    if (lista) {
      var vacio = lista.querySelector('.catalog-empty-results');
      if (!vacio) { vacio = document.createElement('p'); vacio.className = 'catalog-empty-results'; vacio.textContent = 'No hay servicios que coincidan con tu búsqueda.'; lista.appendChild(vacio); }
      vacio.hidden = !!visibles || !lista.querySelector('[data-catalogo-item]');
    }
  }
  function sugerir(form, conservar) {
    var nodo = document.getElementById('catalogo-resumen');
    if (!nodo) return;
    var resumen = JSON.parse(nodo.textContent);
    var tipo = form.elements.tipo.value;
    var info = resumen[tipo];
    if (!info) return;
    if (!conservar) form.elements.orden.value = info.siguiente;
    var hint = form.querySelector('.catalog-order-hint');
    hint.textContent = 'Hay ' + info.total + ' ' + (tipo === 'hechizo' ? 'hechizos' : 'lecturas') +
      ' en total (' + info.originales + ' originales y ' + info.administrables + ' administrables, incluidos ocultos). ' +
      'Siguiente orden: ' + info.siguiente + '. El orden se aplica dentro de la sección elegida.';
    var lista = document.getElementById('categorias-catalogo');
    if (lista) lista.replaceChildren.apply(lista, info.secciones.map(function (nombre) { var op = document.createElement('option'); op.value = nombre; return op; }));
  }
  function errorFormulario(form, mensaje, campos) {
    var el = form.querySelector('.form-error');
    if (!el) { el = document.createElement('p'); el.className = 'form-error'; el.setAttribute('role', 'alert'); form.prepend(el); }
    el.textContent = mensaje; el.hidden = false;
    Object.keys(campos || {}).forEach(function (nombre) {
      var campo = form.elements[nombre];
      if (campo) { campo.setAttribute('aria-invalid', 'true'); campo.setCustomValidity(campos[nombre]); }
    });
    var invalido = form.querySelector('[aria-invalid=true]');
    if (invalido) { invalido.focus(); invalido.reportValidity(); }
    else el.scrollIntoView({ block: 'nearest' });
  }
  document.addEventListener('click', function (e) {
    var agenda = e.target.closest('[data-agenda-nav]');
    if (agenda) {
      e.preventDefault();
      if (agenda.hasAttribute('data-agenda-renovar') &&
          !borradores(seccion('agenda')).length &&
          Array.from(document.querySelectorAll('[data-sec="agenda"] .edit-row')).some(function (fila) { return fila.style.display !== 'none'; }) &&
          !window.confirm('Actualizar renovará el recorrido y los formularios. Los cambios sin guardar se perderán. ¿Continuar?')) return;
      var destino = new URL(agenda.getAttribute('href'), location.href);
      var campo = document.getElementById('buscador');
      if (campo && (agenda.hasAttribute('data-filtro') || agenda.hasAttribute('data-adelanto') || agenda.closest('[aria-label="Páginas de la agenda"]'))) {
        if (campo.value.trim() !== (destino.searchParams.get('buscar') || '')) {
          destino.searchParams.delete('vista');
          destino.searchParams.set('pagina', '1');
        }
        destino.searchParams.set('buscar', campo.value);
      }
      if (!mutando) navegar('agenda', true, destino.pathname + destino.search, true);
      return;
    }
    var tab = e.target.closest('.admin-tab');
    if (tab) { e.preventDefault(); if (!mutando) navegar(tab.dataset.tab, true); return; }
  });
  document.addEventListener('input', function (e) {
    marcarBorrador(e.target);
    if (e.target.matches('#agenda-busqueda [name=buscar]')) {
      clearTimeout(busquedaTimer);
      ++navegacion; // Una respuesta anterior nunca debe sustituir lo recién escrito.
      var form = e.target.closest('form');
      busquedaTimer = setTimeout(function () {
        if (!mutando && form.isConnected && activa() === 'agenda') {
          navegar('agenda', false, '/admin?' + new URLSearchParams(new FormData(form)).toString(), true);
        }
      }, 300);
    }
    if (e.target.matches('#catalogo-buscador')) filtrar();
    if (e.target.matches('.catalog-panel input, .catalog-panel textarea, .catalog-panel select, [data-usuarios-form] input')) { e.target.removeAttribute('aria-invalid'); e.target.setCustomValidity(''); }
  });
  document.addEventListener('change', function (e) {
    marcarBorrador(e.target);
    if (e.target.matches('.catalog-panel select, [data-usuarios-form] select')) { e.target.removeAttribute('aria-invalid'); e.target.setCustomValidity(''); }
    if (e.target.matches('#catalogo-filtro')) filtrar();
    if (e.target.matches('.catalog-create [name=tipo]')) sugerir(e.target.form);
  });
  document.addEventListener('submit', async function (e) {
    var form = e.target;
    if (new URL(form.getAttribute('action') || location.href, location.href).pathname === '/admin/logout') {
      if (e.defaultPrevented) return;
      if (!confirmarBorradores()) { e.preventDefault(); return; }
      // La salida sigue siendo un POST normal; no interceptarla con AJAX.
      saliendo = true;
      limpiarBorradores();
      return;
    }
    if (form.id === 'agenda-busqueda') {
      e.preventDefault();
      if (!mutando) navegar('agenda', false, '/admin?' + new URLSearchParams(new FormData(form)).toString(), true);
      return;
    }
    if (form.method.toLowerCase() !== 'post') return;
    var trabajo = form.matches('.trabajo-form');
    var evidencia = form.matches('.ev-form');
    var catalogo = !!form.closest('.catalog-panel');
    var usuarios = form.matches('[data-usuarios-form]');
    var panel = form.closest('.admin-sec');
    if (!panel || !new URL(form.getAttribute('action'), location.href).pathname.startsWith('/admin/')) return;
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (mutando) return;
    mutando = true;
    clearTimeout(busquedaTimer);
    ++navegacion;
    var tabActual = activa(), y = window.scrollY;
    var btn = e.submitter || form.querySelector('[type=submit], button:not([type])');
    var original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    form.setAttribute('aria-busy', 'true');
    var revisionEnvio = revisionesFormulario.get(form);
    var guardado = false;
    var errorEnvio = '';
    try {
      var pendiente = evidencia && enviosEvidencia.get(form);
      var datos = pendiente ? pendiente.datos : new FormData(form);
      if (pendiente) revisionEnvio = pendiente.revision;
      if (evidencia && !pendiente) {
        // La plantilla aporta una clave también para el POST sin JavaScript.
        enviosEvidencia.set(form, { datos: datos, revision: revisionEnvio });
        form.setAttribute('data-agenda-editado', '');
      }
      if (e.submitter && e.submitter.name) datos.append(e.submitter.name, e.submitter.value);
      if (form.enctype !== 'multipart/form-data') datos = new URLSearchParams(datos);
      var r = await fetch(form.getAttribute('action'), {
        method: 'POST', body: datos, credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      var d;
      if ((r.headers.get('content-type') || '').includes('application/json')) d = await r.json();
      else {
        var texto = await r.text();
        if (!r.ok) throw new Error(new DOMParser().parseFromString(texto, 'text/html').body.textContent.slice(0, 500) || 'No se pudo guardar.');
        var respuesta = new DOMParser().parseFromString(texto, 'text/html');
        if (!respuesta.querySelector('.admin-nav')) throw new Error('Tu sesión caducó. Inicia sesión otra vez.');
        d = { ok: true };
      }
      if (!r.ok || !d.ok) {
        errorEnvio = d.error || 'No se pudo guardar.';
        errorFormulario(form, errorEnvio, d.campos); return;
      }
      guardado = true;
      if (evidencia) {
        enviosEvidencia.delete(form);
        form.querySelector('[name=operacion]').value = window.crypto.randomUUID();
        var errorAnterior = form.querySelector('.form-error');
        if (errorAnterior) errorAnterior.remove();
      }
      // Solo el envío explícito y confirmado limpia este formulario, nunca los demás.
      if (revisionEnvio === revisionesFormulario.get(form)) {
        form.removeAttribute('data-agenda-editado');
        form.querySelectorAll('input[type=file]').forEach(function (campo) { campo.value = ''; });
        if (catalogo || usuarios) {
          form.reset();
          form.querySelectorAll('input[type=password]').forEach(function (campo) { campo.value = ''; });
        }
      }
      if (trabajo) {
        var docs = await Promise.all([cargar('agenda'), cargar('realizados')]);
        reemplazar('agenda', docs[0]); reemplazar('realizados', docs[1]);
        if (activa() === 'agenda') history.replaceState(null, '', agendaUrl);
        mostrarToast(d.realizado ? 'Trabajo marcado como entregado' : 'Trabajo devuelto a la agenda');
      } else if (usuarios) {
        reemplazar('usuarios', await cargar('usuarios'), false, true);
        mostrarToast(d.mensaje || 'Usuarios y notificaciones actualizados');
      } else if (catalogo) {
        reemplazar('catalogo', await cargar('catalogo'), false, true);
        mostrarToast(d.mensaje || 'Catálogo actualizado');
      } else {
        reemplazar(tabActual, await cargar(tabActual));
        if (tabActual === 'agenda') history.replaceState(null, '', agendaUrl);
        mostrarToast(d.mensaje || 'Cambio guardado');
      }
      window.scrollTo(0, y);
    } catch (err) {
      errorEnvio = err.message;
      var mensaje = guardado ? (evidencia && d.mensaje ? d.mensaje + ' ' : '') +
        'El cambio se guardó, pero no se pudo actualizar la vista. Recarga el panel para verlo.' : err.message;
      if (guardado) mostrarToast(mensaje, 'error'); else errorFormulario(form, mensaje);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = evidencia && enviosEvidencia.has(form)
        ? 'Reintentar envío original' : evidencia ? '✦ Enviar evidencia' : original; }
      if (evidencia && enviosEvidencia.has(form)) errorFormulario(form,
        errorEnvio + ' Pulsa «Reintentar envío original» para consultar o completar esa misma operación sin duplicarla. Los cambios posteriores no se enviarán hasta resolverla. No se reintentará automáticamente.');
      form.removeAttribute('aria-busy'); mutando = false;
    }
  });
  window.addEventListener('popstate', async function () {
    var anterior = urlVisible;
    var destino = location.pathname + location.search;
    if ((mutando || !await navegar(new URLSearchParams(location.search).get('tab') || 'agenda', false, destino)) &&
        location.pathname + location.search === destino) {
      history.pushState(null, '', anterior);
    }
  });
  // Guardar la primera vista también: Atrás y una recarga conservan el recorrido.
  if (agendaInicial && activa() === 'agenda') {
    history.replaceState(null, '', agendaUrl);
    urlVisible = agendaUrl;
  }
  filtrar();
  var crear = document.querySelector('.catalog-create form');
  if (crear) sugerir(crear, true);
})();
