(function () {
  'use strict';
  var navegacion = 0;
  var mutando = false;
  var agendaInicial = document.querySelector('#agenda-busqueda');
  var agendaUrl = agendaInicial ? agendaInicial.dataset.url : '/admin?tab=agenda';
  function seccion(id, root) { return (root || document).querySelector('[data-sec="' + id + '"]'); }
  function activa() { var el = document.querySelector('.admin-sec.activo'); return el ? el.dataset.sec : 'agenda'; }
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
  }
  function reemplazar(tab, doc) {
    var anterior = seccion(tab), nuevo = seccion(tab, doc);
    if (anterior && nuevo) {
      var visible = anterior.classList.contains('activo');
      var buscar = anterior.querySelector('#catalogo-buscador');
      var valor = buscar ? buscar.value : '';
      var select = anterior.querySelector('#catalogo-filtro');
      var seleccionado = select ? select.value : '';
      anterior.innerHTML = nuevo.innerHTML;
      anterior.classList.toggle('activo', visible);
      buscar = anterior.querySelector('#catalogo-buscador');
      if (buscar) buscar.value = valor;
      select = anterior.querySelector('#catalogo-filtro');
      if (select && seleccionado) select.value = seleccionado;
    }
    if (tab === 'agenda') {
      var formulario = seccion(tab).querySelector('#agenda-busqueda');
      if (formulario) agendaUrl = formulario.dataset.url;
    }
    contadores(doc);
    filtrar();
    if (tab === 'catalogo') {
      var crear = document.querySelector('.catalog-create form');
      if (crear) sugerir(crear, true);
    }
  }
  async function navegar(tab, guardarHistoria, url) {
    var turno = ++navegacion;
    var indicador = document.createElement('div'); indicador.className = 'admin-loading';
    document.body.appendChild(indicador);
    try {
      var doc = await cargar(tab, url);
      if (turno !== navegacion) return;
      reemplazar(tab, doc);
      document.querySelectorAll('.admin-sec').forEach(function (s) { s.classList.toggle('activo', s.dataset.sec === tab); });
      document.querySelectorAll('.admin-tab').forEach(function (b) { b.classList.toggle('activo', b.dataset.tab === tab); });
      // Los enlaces de tipo están fuera del contenido que reemplaza AJAX.
      // Mantener Entregados/Papelera al cambiar entre lecturas y trabajos.
      document.querySelectorAll('nav[aria-label="Tipo de servicio"] a').forEach(function (a) {
        var params = new URLSearchParams(a.getAttribute('href').split('?')[1]);
        params.set('tab', ['agenda', 'realizados', 'eliminados'].indexOf(tab) >= 0 ? tab : 'agenda');
        a.setAttribute('href', '/admin?' + params.toString());
      });
      if (guardarHistoria) history.pushState(null, '', tab === 'agenda' ? agendaUrl : urlTab(tab));
      window.scrollTo(0, 0);
    } catch (err) { mostrarToast(err.message, 'error'); }
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
    if (agenda) { e.preventDefault(); if (!mutando) navegar('agenda', true, agenda.getAttribute('href')); return; }
    var tab = e.target.closest('.admin-tab');
    if (tab) { e.preventDefault(); if (!mutando) navegar(tab.dataset.tab, true); return; }
  });
  document.addEventListener('input', function (e) {
    if (e.target.matches('#catalogo-buscador')) filtrar();
    if (e.target.matches('.catalog-panel input, .catalog-panel textarea, .catalog-panel select, [data-usuarios-form] input')) { e.target.removeAttribute('aria-invalid'); e.target.setCustomValidity(''); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches('.catalog-panel select, [data-usuarios-form] select')) { e.target.removeAttribute('aria-invalid'); e.target.setCustomValidity(''); }
    if (e.target.matches('#catalogo-filtro')) filtrar();
    if (e.target.matches('.catalog-create [name=tipo]')) sugerir(e.target.form);
  });
  document.addEventListener('submit', async function (e) {
    var form = e.target;
    if (form.id === 'agenda-busqueda') {
      e.preventDefault();
      if (!mutando) navegar('agenda', true, '/admin?' + new URLSearchParams(new FormData(form)).toString());
      return;
    }
    if (form.method.toLowerCase() !== 'post') return;
    var trabajo = form.matches('.trabajo-form');
    var catalogo = !!form.closest('.catalog-panel');
    var usuarios = form.matches('[data-usuarios-form]');
    if (!trabajo && !catalogo && !usuarios) return;
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (mutando) return;
    mutando = true;
    ++navegacion;
    var btn = form.querySelector('[type=submit]'), original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Guardando…'; form.setAttribute('aria-busy', 'true');
    var guardado = false;
    try {
      var datos = new URLSearchParams();
      new FormData(form).forEach(function (v, k) { datos.append(k, v); });
      var r = await fetch(form.getAttribute('action'), {
        method: 'POST', body: datos, credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      if (!(r.headers.get('content-type') || '').includes('application/json')) {
        throw new Error(r.redirected ? 'Tu sesión caducó. Inicia sesión otra vez.' : 'El servidor no pudo procesar la solicitud. Inténtalo de nuevo.');
      }
      var d = await r.json();
      if (!r.ok || !d.ok) { errorFormulario(form, d.error || 'No se pudo guardar.', d.campos); return; }
      guardado = true;
      if (trabajo) {
        var docs = await Promise.all([cargar('agenda'), cargar('realizados')]);
        reemplazar('agenda', docs[0]); reemplazar('realizados', docs[1]);
        if (activa() === 'agenda') history.replaceState(null, '', agendaUrl);
        mostrarToast(d.realizado ? 'Trabajo marcado como entregado' : 'Trabajo devuelto a la agenda');
      } else if (usuarios) {
        reemplazar('usuarios', await cargar('usuarios'));
        mostrarToast(d.mensaje || 'Usuarios y notificaciones actualizados');
      } else {
        reemplazar('catalogo', await cargar('catalogo'));
        mostrarToast(d.mensaje || 'Catálogo actualizado');
      }
    } catch (err) {
      var mensaje = guardado ? 'El cambio se guardó, pero no se pudo actualizar la vista. Recarga el panel para verlo.' : err.message;
      if (guardado) mostrarToast(mensaje, 'error'); else errorFormulario(form, mensaje);
    } finally {
      btn.disabled = false; btn.textContent = original; form.removeAttribute('aria-busy'); mutando = false;
    }
  });
  window.addEventListener('popstate', function () {
    if (!mutando) navegar(new URLSearchParams(location.search).get('tab') || 'agenda', false, location.pathname + location.search);
  });
  filtrar();
  var crear = document.querySelector('.catalog-create form');
  if (crear) sugerir(crear, true);
})();
