(function () {
  'use strict';
  var API = '/admin/catalogo/precios';
  var POR_PAGINA = 25;
  var MAX_CAMBIOS = 500;
  var instancias = [];
  // Memoria de la sesión de página: sobrevive a la destrucción/recreación del panel.
  var memoria = { borrador: {}, invalidos: {}, f: null, orden: null };
  function vaciar(o) { Object.keys(o).forEach(function (k) { delete o[k]; }); }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function fCop(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CO') + ' COP'; }
  function fUsd(n) { return Number(n) > 0 ? 'US$' + Number(n).toFixed(2) : 'No ofrecido'; }
  function validoCop(n) { return Number.isInteger(n) && n >= 1000 && n <= 1e9; }
  function validoUsd(n) { return isFinite(n) && n >= 0 && n <= 1e6 && Math.round(n * 100) === Math.round(n * 100 * 1e6) / 1e6; }
  function parseNum(v) { var t = String(v).trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? NaN : Number(t); }

  function crear(root) {
    var mount = root.querySelector('[data-pp-mount]');
    var ctrl = new AbortController();
    var st = {
      items: [], porId: {}, borrador: memoria.borrador, invalidos: memoria.invalidos, sel: {}, version: 0,
      f: memoria.f || (memoria.f = { q: '', tipo: '', seccion: '', origen: '', estado: '' }),
      orden: 'nombre', dir: 1, pagina: 1, preview: null, ocupado: false,
      dialogo: null, volverFoco: null
    };

    function req(url, cuerpo) {
      var op = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: ctrl.signal };
      if (cuerpo) { op.method = 'POST'; op.headers['Content-Type'] = 'application/json'; op.body = JSON.stringify(cuerpo); }
      return fetch(url, op).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.ok && d && d.ok) return d;
          var e = new Error(d && (d.error || d.mensaje) || ''); e.status = r.status; throw e;
        });
      }, function (err) { if (err.name === 'AbortError') throw err; var e = new Error(''); e.status = 0; throw e; });
    }
    function mensaje(e) {
      if (e.status === 0) return 'No hay conexión con el servidor. Tu borrador sigue intacto; inténtalo de nuevo.';
      if (e.status === 401) return 'Tu sesión caducó. Recarga la página e inicia sesión; el borrador se perderá al recargar.';
      if (e.status === 403) return 'Tu cuenta no tiene permiso para modificar precios.';
      if (e.status === 409) return 'Otro cambio modificó algunos precios mientras editabas. Recarga la lista y revisa antes de guardar.';
      if (e.status === 400) return 'El servidor rechazó los datos: ' + (e.message || 'revisa los valores marcados.');
      return e.message || 'Ocurrió un error inesperado (' + e.status + ').';
    }

    /* ---------- estructura ---------- */
    function esqueleto() {
      mount.innerHTML =
        '<div class="pp-alert" data-pp-alert role="status" aria-live="polite" hidden></div>' +
        '<div class="pp-filters">' +
          '<label class="pp-field">Buscar por nombre<input class="pp-input" type="search" data-f="q" placeholder="Ej. endulzamiento, tarot…" autocomplete="off"></label>' +
          '<label class="pp-field">Tipo<select class="pp-select" data-f="tipo"><option value="">Todos</option><option value="hechizo">Trabajos y hechizos</option><option value="lectura">Lecturas</option></select></label>' +
          '<label class="pp-field">Sección<select class="pp-select" data-f="seccion"><option value="">Todas</option></select></label>' +
          '<label class="pp-field">Origen<select class="pp-select" data-f="origen"><option value="">Todos</option><option value="original">Original</option><option value="administrable">Administrable</option></select></label>' +
          '<label class="pp-field">Estado<select class="pp-select" data-f="estado"><option value="">Todos</option><option value="activo">Publicados</option><option value="oculto">Ocultos</option><option value="cambiado">Con cambios</option></select></label>' +
          '<label class="pp-field">Ordenar<select class="pp-select" data-pp-orden><option value="nombre:1">Nombre A-Z</option><option value="nombre:-1">Nombre Z-A</option><option value="precio_cop:1">COP menor a mayor</option><option value="precio_cop:-1">COP mayor a menor</option><option value="precio_usd:1">USD menor a mayor</option><option value="precio_usd:-1">USD mayor a menor</option><option value="seccion:1">Sección</option></select></label>' +
        '</div>' +
        '<div class="pp-draft" data-pp-draft hidden><p class="pp-draft-text" data-pp-draft-text></p>' +
          '<button type="button" class="pp-btn" data-act="descartar">Descartar borrador</button>' +
          '<button type="button" class="pp-btn pp-btn-primary" data-act="revisar">Revisar y guardar</button></div>' +
        '<div class="pp-bar"><p class="pp-bar-info" data-pp-info aria-live="polite"></p>' +
          '<button type="button" class="pp-btn pp-btn-ghost" data-act="sel-filtrados"></button>' +
          '<button type="button" class="pp-btn pp-btn-ghost" data-act="sel-limpiar">Quitar selección</button>' +
          '<button type="button" class="pp-btn" data-act="masivo">Ajuste masivo</button></div>' +
        '<div class="pp-table-wrap"><table class="pp-table"><caption class="pp-sr">Precios del catálogo</caption><thead><tr>' +
          '<th scope="col"><input type="checkbox" class="pp-check" data-pp-pagina aria-label="Seleccionar servicios de esta página"></th>' +
          '<th scope="col">Servicio</th><th scope="col">Precio COP</th><th scope="col">Precio USD</th>' +
        '</tr></thead><tbody data-pp-body></tbody></table></div>' +
        '<nav class="pp-pager" aria-label="Paginación de precios" data-pp-pager></nav>' +
        '<div class="pp-overlay" data-pp-overlay hidden></div>';
    }
    function q(s) { return mount.querySelector(s); }

    function alerta(tipo, html) {
      var a = q('[data-pp-alert]'); if (!a) return;
      if (!tipo) { a.hidden = true; a.innerHTML = ''; return; }
      a.className = 'pp-alert pp-alert-' + tipo; a.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
      a.innerHTML = html; a.hidden = false;
    }

    /* ---------- datos ---------- */
    function cargar(conservar) {
      return req(API).then(function (d) {
        var anterior = st.porId;
        st.items = (d.items || []).map(function (it) {
          return { id: String(it.id), nombre: it.nombre || '', tipo: it.tipo === 'lectura' ? 'lectura' : 'hechizo', seccion: it.seccion || 'Sin sección', origen: it.origen === 'original' ? 'original' : 'administrable', activo: it.activo !== false, precio_cop: Number(it.precio_cop) || 0, precio_usd: Number(it.precio_usd) || 0, revision: String(it.revision || ''), _n: norm(it.nombre) };
        });
        st.porId = {}; st.items.forEach(function (i) { st.porId[i.id] = i; });
        var descartados = [];
        Object.keys(st.borrador).forEach(function (id) {
          var it = st.porId[id], b = st.borrador[id];
          if (!conservar || !it || it.revision !== b.revision) { if (conservar) descartados.push(it ? it.nombre : b.nombre || id); delete st.borrador[id]; }
        });
        Object.keys(st.invalidos).forEach(function (k) {
          var v = st.invalidos[k], it = st.porId[v.id];
          if (!conservar || !it || it.revision !== v.revision) { if (conservar && descartados.indexOf(it ? it.nombre : v.nombre) < 0) descartados.push(it ? it.nombre : v.nombre); delete st.invalidos[k]; }
        });
        Object.keys(st.sel).forEach(function (id) { if (!st.porId[id]) delete st.sel[id]; });
        st.version++; st.preview = null;
        if (!q('[data-pp-body]')) esqueleto();
        secciones();
        render();
        void anterior;
        restaurarControles();
        return descartados;
      });
    }
    function secciones() {
      var s = q('[data-f="seccion"]'), act = st.f.seccion, vistos = {};
      st.items.forEach(function (i) { vistos[i.seccion] = 1; });
      s.innerHTML = '<option value="">Todas</option>' + Object.keys(vistos).sort(function (a, b) { return a.localeCompare(b, 'es'); }).map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('');
      if (vistos[act]) s.value = act; else st.f.seccion = '';
    }
    function valor(it, campo) { var b = st.borrador[it.id]; return b && b[campo] !== undefined ? b[campo] : it[campo]; }
    function filtrados() {
      var f = st.f, nq = norm(f.q);
      var r = st.items.filter(function (i) {
        if (nq && i._n.indexOf(nq) < 0) return false;
        if (f.tipo && i.tipo !== f.tipo) return false;
        if (f.seccion && i.seccion !== f.seccion) return false;
        if (f.origen && i.origen !== f.origen) return false;
        if (f.estado === 'activo' && !i.activo) return false;
        if (f.estado === 'oculto' && i.activo) return false;
        if (f.estado === 'cambiado' && !st.borrador[i.id]) return false;
        return true;
      });
      var k = st.orden, d = st.dir;
      r.sort(function (a, b) {
        if (k === 'nombre' || k === 'seccion') return d * (String(a[k]).localeCompare(String(b[k]), 'es') || a.nombre.localeCompare(b.nombre, 'es'));
        return d * (valor(a, k) - valor(b, k));
      });
      return r;
    }

    /* ---------- borrador ---------- */
    function fijar(id, cop, usd) {
      var it = st.porId[id]; if (!it) return;
      if (cop === it.precio_cop && usd === it.precio_usd) delete st.borrador[id];
      else st.borrador[id] = { precio_cop: cop, precio_usd: usd, revision: it.revision, nombre: it.nombre };
      st.version++;
    }
    function nBorrador() { return Object.keys(st.borrador).length; }
    function nInvalidos() { return Object.keys(st.invalidos).length; }
    function restaurarControles() {
      Object.keys(st.f).forEach(function (k) { var el = q('[data-f="' + k + '"]'); if (el) el.value = st.f[k]; });
      if (memoria.orden) { st.orden = memoria.orden[0]; st.dir = memoria.orden[1]; var o = q('[data-pp-orden]'); if (o) o.value = st.orden + ':' + st.dir; }
    }
    function nSel() { return Object.keys(st.sel).length; }

    /* ---------- render ---------- */
    function fila(it) {
      var b = st.borrador[it.id], cop = valor(it, 'precio_cop'), usd = valor(it, 'precio_usd');
      var cCop = b && cop !== it.precio_cop, cUsd = b && usd !== it.precio_usd;
      function campo(c, actual) {
        var inv = st.invalidos[it.id + '|' + c], eid = 'pp-err-' + c + '-' + it.id.replace(/\W/g, '_');
        return { v: inv ? inv.texto : actual, a: inv ? ' aria-invalid="true" aria-describedby="' + eid + '"' : '', e: inv ? '<small class="pp-row-err" id="' + eid + '">' + esc(textoError(c)) + '</small>' : '' };
      }
      var xc = campo('precio_cop', cop), xu = campo('precio_usd', usd);
      return '<tr data-id="' + esc(it.id) + '"' + (b ? ' class="pp-dirty"' : '') + '>' +
        '<td class="pp-c-check"><input type="checkbox" class="pp-check" data-pp-sel' + (st.sel[it.id] ? ' checked' : '') + ' aria-label="Seleccionar ' + esc(it.nombre) + '"></td>' +
        '<td class="pp-c-name"><div class="pp-name">' + esc(it.nombre) + '</div><div class="pp-sub">' +
          '<span class="pp-tag">' + (it.tipo === 'lectura' ? 'Lectura' : 'Hechizo') + '</span>' +
          '<span class="pp-tag">' + esc(it.seccion) + '</span>' +
          '<span class="pp-tag ' + (it.origen === 'original' ? 'pp-tag-orig' : '') + '">' + (it.origen === 'original' ? 'Original' : 'Administrable') + '</span>' +
          (it.activo ? '' : '<span class="pp-tag pp-tag-off">Oculto</span>') + '</div></td>' +
        '<td class="pp-c-cop" data-label="COP"><div class="pp-price"><span aria-hidden="true">COP</span><input class="pp-input' + (cCop ? ' pp-changed' : '') + '" inputmode="numeric" data-campo="precio_cop" value="' + esc(xc.v) + '"' + xc.a + ' aria-label="Precio COP de ' + esc(it.nombre) + '"></div>' +
          '<small class="pp-was">' + (cCop ? 'Antes ' + esc(fCop(it.precio_cop)) : '') + '</small>' + xc.e + '</td>' +
        '<td class="pp-c-usd" data-label="USD"><div class="pp-price"><span aria-hidden="true">USD</span><input class="pp-input' + (cUsd ? ' pp-changed' : '') + '" inputmode="decimal" data-campo="precio_usd" value="' + esc(xu.v) + '"' + xu.a + ' aria-label="Precio USD de ' + esc(it.nombre) + ' (0 si no se ofrece en el exterior)"></div>' +
          '<small class="pp-was">' + (cUsd ? 'Antes ' + esc(fUsd(it.precio_usd)) : '') + '</small>' + xu.e + '</td></tr>';
    }
    function render() {
      // No reconstruir la fila que se está editando: conservar foco y texto.
      var activo = document.activeElement, enEdicion = activo && activo.matches && activo.matches('[data-campo]') && mount.contains(activo) ? activo : null;
      if (enEdicion) editar(enEdicion);
      var focoId = enEdicion ? enEdicion.closest('tr').dataset.id : null, focoCampo = enEdicion ? enEdicion.dataset.campo : null, selIni = enEdicion ? enEdicion.selectionStart : null;
      var lista = filtrados(), total = lista.length;
      var paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
      if (st.pagina > paginas) st.pagina = paginas;
      var ini = (st.pagina - 1) * POR_PAGINA, vista = lista.slice(ini, ini + POR_PAGINA);
      st.vista = vista; st.filtrados = lista;
      var body = q('[data-pp-body]');
      body.innerHTML = vista.length ? vista.map(fila).join('') :
        '<tr><td colspan="4"><div class="pp-empty"><h3>Sin coincidencias</h3><p>' + (st.items.length ? 'Ningún servicio cumple estos filtros. Prueba con otra búsqueda.' : 'El catálogo todavía no tiene servicios.') + '</p></div></td></tr>';
      if (focoId) { var nuevo = body.querySelector('tr[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focoId) : focoId) + '"] [data-campo="' + focoCampo + '"]'); if (nuevo) { nuevo.focus(); try { nuevo.setSelectionRange(selIni, selIni); } catch (x) { void x; } } }
      q('[data-pp-pager]').innerHTML = total ? '<span>Mostrando ' + (ini + 1) + '–' + (ini + vista.length) + ' de ' + total + '</span><span class="pp-pager-btns">' +
        '<button type="button" class="pp-btn" data-act="prev"' + (st.pagina <= 1 ? ' disabled' : '') + '>Anterior</button>' +
        '<span aria-current="page">Página ' + st.pagina + ' de ' + paginas + '</span>' +
        '<button type="button" class="pp-btn" data-act="next"' + (st.pagina >= paginas ? ' disabled' : '') + '>Siguiente</button></span>' : '';
      contadores();
    }
    function contadores() {
      var lista = st.filtrados || [], ns = nSel(), nb = nBorrador();
      var selFil = lista.filter(function (i) { return st.sel[i.id]; }).length;
      q('[data-pp-info]').innerHTML = '<strong>' + lista.length + '</strong> de ' + st.items.length + ' servicios · <strong>' + ns + '</strong> seleccionados' + (ns && selFil !== ns ? ' (' + selFil + ' visibles con estos filtros)' : '');
      var bf = q('[data-act="sel-filtrados"]');
      bf.textContent = 'Seleccionar los ' + lista.length + ' filtrados'; bf.disabled = !lista.length || selFil === lista.length;
      q('[data-act="sel-limpiar"]').disabled = !ns;
      q('[data-act="masivo"]').disabled = !ns || st.ocupado;
      var hp = q('[data-pp-pagina]'), vis = st.vista || [], selVis = vis.filter(function (i) { return st.sel[i.id]; }).length;
      hp.checked = vis.length > 0 && selVis === vis.length; hp.indeterminate = selVis > 0 && selVis < vis.length;
      var d = q('[data-pp-draft]');
      var ni = nInvalidos();
      d.hidden = !nb && !ni;
      q('[data-pp-draft-text]').innerHTML = '<strong>' + nb + '</strong> ' + (nb === 1 ? 'servicio con cambios sin guardar' : 'servicios con cambios sin guardar') + (ni ? ' · <strong>' + ni + '</strong> ' + (ni === 1 ? 'valor inválido' : 'valores inválidos') + ' por corregir' : '') + (nb > MAX_CAMBIOS ? ' · máximo ' + MAX_CAMBIOS + ' por guardado' : '');
      q('[data-act="revisar"]').disabled = st.ocupado || !nb || ni > 0 || nb > MAX_CAMBIOS;
      q('[data-act="descartar"]').disabled = st.ocupado;
    }
    function refrescarFila(tr) {
      var it = st.porId[tr.dataset.id]; if (!it) return;
      var b = st.borrador[it.id];
      tr.classList.toggle('pp-dirty', !!b);
      ['precio_cop', 'precio_usd'].forEach(function (c) {
        var inp = tr.querySelector('[data-campo="' + c + '"]'), cambio = b && b[c] !== it[c];
        inp.classList.toggle('pp-changed', !!cambio);
        var was = inp.closest('td').querySelector('.pp-was');
        was.textContent = cambio ? 'Antes ' + (c === 'precio_cop' ? fCop(it[c]) : fUsd(it[c])) : '';
      });
    }

    /* ---------- edición individual ---------- */
    function textoError(c) { return c === 'precio_cop' ? 'Entero entre 1.000 y 1.000.000.000' : 'Entre 0 y 1.000.000, máximo 2 decimales'; }
    function editar(inp) {
      var tr = inp.closest('tr'), it = st.porId[tr.dataset.id], campo = inp.dataset.campo;
      var n = parseNum(inp.value), td = inp.closest('td'), err = td.querySelector('.pp-row-err');
      var ok = campo === 'precio_cop' ? validoCop(n) : validoUsd(n);
      var clave = it.id + '|' + campo;
      if (!ok) {
        st.invalidos[clave] = { id: it.id, campo: campo, texto: inp.value, revision: it.revision, nombre: it.nombre };
        inp.setAttribute('aria-invalid', 'true');
        if (!err) { err = document.createElement('small'); err.className = 'pp-row-err'; err.id = 'pp-err-' + campo + '-' + it.id.replace(/\W/g, '_'); td.appendChild(err); inp.setAttribute('aria-describedby', err.id); }
        err.textContent = textoError(campo);
        contadores();
        return;
      }
      delete st.invalidos[clave];
      inp.removeAttribute('aria-invalid'); inp.removeAttribute('aria-describedby'); if (err) err.remove();
      var cop = campo === 'precio_cop' ? n : valor(it, 'precio_cop'), usd = campo === 'precio_usd' ? Math.round(n * 100) / 100 : valor(it, 'precio_usd');
      fijar(it.id, cop, usd);
      refrescarFila(tr); contadores();
    }

    /* ---------- diálogos ---------- */
    function abrir(html) {
      var ov = q('[data-pp-overlay]');
      st.volverFoco = document.activeElement;
      ov.innerHTML = '<div class="pp-dialog" role="dialog" aria-modal="true" aria-labelledby="pp-dlg-t" aria-describedby="pp-dlg-d">' + html + '</div>';
      ov.hidden = false; st.dialogo = ov.firstChild;
      var f = st.dialogo.querySelector('[data-autofocus]') || st.dialogo.querySelector('button,input,select');
      if (f) f.focus();
    }
    function cerrar() {
      var ov = q('[data-pp-overlay]'); if (!ov || ov.hidden) return;
      ov.hidden = true; ov.innerHTML = ''; st.dialogo = null;
      if (st.volverFoco && st.volverFoco.isConnected) st.volverFoco.focus();
    }
    function trampa(e) {
      if (!st.dialogo) return;
      if (e.key === 'Escape') { e.preventDefault(); if (!st.ocupado) cerrar(); return; }
      if (e.key !== 'Tab') return;
      var fs = Array.prototype.filter.call(st.dialogo.querySelectorAll('button,input,select,[tabindex]'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!fs.length) return;
      var a = fs[0], z = fs[fs.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }

    function dlgMasivo() {
      var n = nSel();
      abrir('<div class="pp-dialog-head"><h3 id="pp-dlg-t">Ajuste masivo</h3><p id="pp-dlg-d">Se aplicará a <strong>' + n + '</strong> ' + (n === 1 ? 'servicio seleccionado' : 'servicios seleccionados') + '. Quedará en borrador hasta que confirmes.</p></div>' +
        '<form class="pp-dialog-body" data-pp-masivo novalidate>' +
          '<fieldset class="pp-seg"><legend>Divisa</legend><label><input type="radio" name="divisa" value="precio_cop" checked> COP</label><label><input type="radio" name="divisa" value="precio_usd"> USD</label></fieldset>' +
          '<div class="pp-dialog-grid"><label class="pp-field">Operación<select class="pp-select" name="modo">' +
            '<option value="fijo">Fijar valor exacto</option><option value="pct+">Aumentar porcentaje</option><option value="pct-">Reducir porcentaje</option><option value="sum">Sumar monto</option><option value="res">Restar monto</option></select></label>' +
          '<label class="pp-field">Valor<input class="pp-input" name="valor" inputmode="decimal" required data-autofocus></label></div>' +
          '<p class="pp-note">COP y USD son independientes: ajustar una divisa no convierte ni modifica la otra. COP se redondea a entero y USD a 2 decimales. En USD, 0 significa que no se ofrece en el exterior.</p>' +
          '<p class="pp-alert pp-alert-error" data-pp-merr role="alert" hidden></p>' +
        '</form>' +
        '<div class="pp-dialog-foot"><button type="button" class="pp-btn" data-act="cerrar">Cancelar</button><button type="button" class="pp-btn pp-btn-primary" data-act="aplicar-masivo">Aplicar al borrador</button></div>');
    }
    function aplicarMasivo() {
      var f = st.dialogo.querySelector('[data-pp-masivo]'), err = st.dialogo.querySelector('[data-pp-merr]');
      var campo = f.divisa.value, modo = f.modo.value, v = parseNum(f.valor.value);
      if (!isFinite(v) || v < 0) { err.textContent = 'Escribe un valor numérico positivo.'; err.hidden = false; f.valor.focus(); return; }
      var ids = Object.keys(st.sel), malos = [], plan = [];
      ids.forEach(function (id) {
        var it = st.porId[id]; if (!it) return;
        var act = valor(it, campo), r;
        if (modo === 'fijo') r = v; else if (modo === 'pct+') r = act * (1 + v / 100); else if (modo === 'pct-') r = act * (1 - v / 100); else if (modo === 'sum') r = act + v; else r = act - v;
        r = campo === 'precio_cop' ? Math.round(r) : Math.round(r * 100) / 100;
        if (campo === 'precio_cop' ? !validoCop(r) : !validoUsd(r)) { malos.push(it.nombre + ' (' + (campo === 'precio_cop' ? fCop(r) : 'US$' + r.toFixed(2)) + ')'); return; }
        plan.push([id, campo === 'precio_cop' ? r : valor(it, 'precio_cop'), campo === 'precio_usd' ? r : valor(it, 'precio_usd')]);
      });
      if (malos.length) {
        err.innerHTML = esc('No se aplicó nada: ' + malos.length + ' de ' + ids.length + ' quedarían fuera de rango (' + textoError(campo) + '). Corrige el ajuste o quita estos servicios de la selección:') + '<br>' + esc(malos.slice(0, 12).join(', ') + (malos.length > 12 ? ' y ' + (malos.length - 12) + ' más' : ''));
        err.hidden = false; f.valor.focus(); return;
      }
      plan.forEach(function (p) { fijar(p[0], p[1], p[2]); delete st.invalidos[p[0] + '|' + campo]; });
      st.preview = null;
      cerrar(); render();
      alerta('ok', esc(plan.length + ' precios actualizados en el borrador.'));
    }

    function revisar() {
      var cambios = Object.keys(st.borrador).map(function (id) { var b = st.borrador[id]; return { id: id, revision: b.revision, precio_cop: b.precio_cop, precio_usd: b.precio_usd }; });
      if (!cambios.length) return;
      if (cambios.length > MAX_CAMBIOS) { alerta('error', 'Máximo ' + MAX_CAMBIOS + ' cambios por guardado.'); return; }
      if (nInvalidos()) { alerta('error', 'Hay valores inválidos marcados en rojo. Corrígelos antes de revisar.'); return; }
      var version = st.version;
      ocupar(true); alerta('ok', 'Preparando la vista previa…');
      req(API + '/preview', { cambios: cambios }).then(function (d) {
        ocupar(false); alerta(null);
        st.preview = { token: d.token, version: version, expira: d.expires_at };
        var filas = (d.cambios || []).map(function (c) {
          var a = c.antes || {}, p = c.despues || {};
          function celda(x, y, fmt) { var cls = y > x ? 'pp-up' : y < x ? 'pp-down' : ''; var moneda = fmt === fCop ? 'COP' : 'USD'; return '<td class="pp-num" data-label="' + moneda + ' antes">' + esc(fmt(x)) + '</td><td class="pp-num ' + cls + '" data-label="' + moneda + ' después">' + esc(fmt(y)) + '</td>'; }
          return '<tr><td>' + esc(c.nombre) + '</td>' + celda(a.precio_cop, p.precio_cop, fCop) + celda(a.precio_usd, p.precio_usd, fUsd) + '</tr>';
        }).join('');
        var exp = d.expires_at ? new Date(d.expires_at) : null;
        abrir('<div class="pp-dialog-head"><h3 id="pp-dlg-t">Confirmar ' + esc(d.total) + ' cambios de precio</h3><p id="pp-dlg-d">Comprobado por el servidor. Se guardarán todos juntos o ninguno. Los pedidos existentes no se modifican.' + (exp && !isNaN(exp) ? ' Esta vista previa vence a las ' + esc(exp.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })) + '.' : '') + '</p></div>' +
          '<div class="pp-dialog-body"><div class="pp-table-wrap"><table class="pp-table pp-preview"><thead><tr><th scope="col">Servicio</th><th scope="col">COP antes</th><th scope="col">COP después</th><th scope="col">USD antes</th><th scope="col">USD después</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
          '<p class="pp-alert pp-alert-error" data-pp-perr role="alert" hidden></p></div>' +
          '<div class="pp-dialog-foot"><button type="button" class="pp-btn" data-act="cerrar">Seguir editando</button><button type="button" class="pp-btn pp-btn-primary" data-act="confirmar" data-autofocus>Confirmar y guardar</button></div>');
      }, function (e) { if (e.name === 'AbortError') return; ocupar(false); fallo(e); });
    }
    function confirmar() {
      var p = st.preview, perr = st.dialogo && st.dialogo.querySelector('[data-pp-perr]');
      if (!p || p.version !== st.version) { if (perr) { perr.textContent = 'El borrador cambió después de esta vista previa. Vuelve a revisarlo.'; perr.hidden = false; } return; }
      ocupar(true);
      var btn = st.dialogo.querySelector('[data-act="confirmar"]'); btn.textContent = 'Guardando…';
      req(API + '/aplicar', { token: p.token }).then(function (d) {
        vaciar(st.borrador); vaciar(st.invalidos); st.version++; st.sel = {}; st.preview = null; ocupar(false); cerrar();
        document.dispatchEvent(new CustomEvent('catalogo:precios-guardados'));
        return cargar(true).then(function () { alerta('ok', esc((d.actualizados || 0) + ' precios guardados. La lista muestra los valores vigentes.')); });
      }).catch(function (e) {
        if (e.name === 'AbortError') return;
        ocupar(false); st.preview = null; cerrar(); fallo(e);
      });
    }
    function fallo(e) {
      var extra = e.status === 409 ? ' <button type="button" class="pp-btn" data-act="recargar">Recargar y revisar</button>' : e.status === 0 ? ' <button type="button" class="pp-btn" data-act="revisar">Reintentar</button>' : '';
      alerta(e.status === 409 ? 'warn' : 'error', esc(mensaje(e)) + extra);
    }
    function informarMerge(n, okTxt) {
      if (n.length) alerta('warn', esc(n.length + (n.length === 1 ? ' cambio del borrador se descartó' : ' cambios del borrador se descartaron') + ' porque el servicio cambió o ya no existe en el servidor: ' + n.slice(0, 12).join(', ') + (n.length > 12 ? '…' : '') + '. Revisa sus precios actuales; el resto del borrador se conserva.'));
      else if (okTxt) alerta('ok', esc(okTxt));
    }
    function ocupar(v) { st.ocupado = v; if (st.dialogo) Array.prototype.forEach.call(st.dialogo.querySelectorAll('button'), function (b) { b.disabled = v; }); contadores(); }

    /* ---------- eventos (en el root: desaparecen con él) ---------- */
    var temp = null;
    function onInput(e) {
      var t = e.target;
      if (t.matches('[data-f="q"]')) { clearTimeout(temp); temp = setTimeout(function () { st.f.q = t.value; st.pagina = 1; render(); }, 160); }
    }
    function onChange(e) {
      var t = e.target;
      if (t.dataset.f && t.dataset.f !== 'q') { st.f[t.dataset.f] = t.value; st.pagina = 1; render(); }
      else if (t.matches('[data-pp-orden]')) { var p = t.value.split(':'); st.orden = p[0]; st.dir = Number(p[1]); memoria.orden = [st.orden, st.dir]; render(); }
      else if (t.matches('[data-pp-sel]')) { var id = t.closest('tr').dataset.id; if (t.checked) st.sel[id] = 1; else delete st.sel[id]; contadores(); }
      else if (t.matches('[data-pp-pagina]')) { (st.vista || []).forEach(function (i) { if (t.checked) st.sel[i.id] = 1; else delete st.sel[i.id]; }); render(); }
      else if (t.matches('[data-campo]')) editar(t);
    }
    function onKey(e) {
      if (st.dialogo) { trampa(e); return; }
      if (e.key === 'Enter' && e.target.matches('[data-campo]')) { e.preventDefault(); editar(e.target); }
      if (e.key === 'Escape' && e.target.matches('[data-campo]')) { var it = st.porId[e.target.closest('tr').dataset.id]; delete st.invalidos[it.id + '|' + e.target.dataset.campo]; e.target.value = valor(it, e.target.dataset.campo); editar(e.target); }
    }
    function onClick(e) {
      if (e.target.matches('[data-pp-overlay]') && !st.ocupado) { cerrar(); return; }
      var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      var a = b.dataset.act;
      if (a === 'prev') { st.pagina--; render(); }
      else if (a === 'next') { st.pagina++; render(); }
      else if (a === 'sel-filtrados') { (st.filtrados || []).forEach(function (i) { st.sel[i.id] = 1; }); render(); }
      else if (a === 'sel-limpiar') { st.sel = {}; render(); }
      else if (a === 'masivo') dlgMasivo();
      else if (a === 'aplicar-masivo') aplicarMasivo();
      else if (a === 'cerrar') cerrar();
      else if (a === 'descartar') { if (window.confirm('¿Descartar ' + nBorrador() + ' cambios sin guardar' + (nInvalidos() ? ' y ' + nInvalidos() + ' valores inválidos' : '') + '?')) { vaciar(st.borrador); vaciar(st.invalidos); st.version++; st.preview = null; render(); alerta(null); } }
      else if (a === 'revisar') revisar();
      else if (a === 'confirmar') confirmar();
      else if (a === 'recargar') { alerta('ok', 'Recargando…'); cargar(true).then(function (n) { informarMerge(n, 'Lista actualizada. Tu borrador se conserva.'); }, function (er) { if (er.name !== 'AbortError') fallo(er); }); }
      else if (a === 'reintentar-carga') iniciar();
    }
    function onSubmit(e) { e.preventDefault(); e.stopPropagation(); if (e.target.matches('[data-pp-masivo]') && !st.ocupado) aplicarMasivo(); }
    function antesDeSalir(e) { if (nBorrador() || nInvalidos()) { e.preventDefault(); e.returnValue = ''; } }

    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKey);
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    window.addEventListener('beforeunload', antesDeSalir);

    function iniciar() {
      var habia = nBorrador() + nInvalidos();
      cargar(true).then(function (n) { informarMerge(n, habia ? 'Recuperamos tu borrador (' + habia + ' pendientes) tras actualizar la sección.' : ''); }).catch(function (e) {
        if (e.name === 'AbortError') return;
        mount.innerHTML = '<div class="pp-alert pp-alert-error" role="alert">' + esc(mensaje(e)) + ' <button type="button" class="pp-btn" data-act="reintentar-carga">Reintentar</button></div>';
      });
    }
    iniciar();

    return {
      root: root,
      destruir: function () {
        ctrl.abort(); clearTimeout(temp);
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onChange);
        root.removeEventListener('keydown', onKey);
        root.removeEventListener('click', onClick);
        root.removeEventListener('submit', onSubmit);
        window.removeEventListener('beforeunload', antesDeSalir);
      }
    };
  }

  function revisarDom() {
    instancias = instancias.filter(function (i) { if (i.root.isConnected) return true; i.destruir(); return false; });
    document.querySelectorAll('[data-panel-precios]:not([data-pp-init])').forEach(function (root) {
      root.setAttribute('data-pp-init', '');
      instancias.push(crear(root));
    });
  }
  var pendiente = false;
  var obs = new MutationObserver(function () {
    if (pendiente) return; pendiente = true;
    (window.requestAnimationFrame || setTimeout)(function () { pendiente = false; revisarDom(); });
  });
  function arrancar() { revisarDom(); obs.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar, { once: true }); else arrancar();
  window.addEventListener('pagehide', function () { obs.disconnect(); instancias.forEach(function (i) { i.destruir(); }); instancias = []; }, { once: true });
})();
