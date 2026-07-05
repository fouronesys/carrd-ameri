/* Fresatanika — Carrito de compras y cuentas de cliente (frontend)
 *
 * Expone window.FresaCart.add(item, origen) para que el catálogo agregue
 * servicios. "origen" (opcional) es el botón pulsado, usado como punto de
 * partida de la animación mágica hacia el carrito.
 * - Carrito guardado en localStorage (invitado) y sincronizado en el servidor
 *   cuando hay una sesión de cliente iniciada.
 * - Widget flotante con contador, panel del carrito, modal de cuenta
 *   (registro / inicio de sesión) y checkout combinado (un solo pago Wompi
 *   o transferencia para todos los servicios).
 * El total SIEMPRE lo valida y calcula el servidor; aquí solo se muestran estimados.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'fresa_carrito_v1';
  var WOMPI_PUBLIC_KEY = 'pub_test_gjhaZFqRwKaZMBcAEBYOjYNGqzGUyPXx';
  var COM = { pct: 0.0265, fijo: 700, iva: 0.19 };

  var estado = {
    items: [],
    cliente: null, // { email, nombre } cuando hay sesión
  };

  /* ---------- Utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtCOP(n) {
    return '$' + Number(n || 0).toLocaleString('es-CO') + ' COP';
  }

  function conComisionWompi(baseCop) {
    var factor = 1 - COM.pct * (1 + COM.iva);
    var fijo = COM.fijo * (1 + COM.iva);
    return Math.ceil((baseCop + fijo) / factor);
  }

  function nuevoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function firmaItem(it) {
    return [it.nombre, it.precio_cop, it.hechizo_clave, it.es_extra, it.es_adelanto].join('|');
  }

  function sanitizar(it) {
    if (!it || !it.nombre) return null;
    return {
      id: it.id || nuevoId(),
      nombre: String(it.nombre).slice(0, 200),
      precio_cop: parseInt(it.precio_cop, 10) || 0,
      precio_usd: String(it.precio_usd || '').slice(0, 20),
      precio_texto: String(it.precio_texto || '').slice(0, 120),
      es_hechizo: !!it.es_hechizo,
      hechizo_clave: String(it.hechizo_clave || '').toLowerCase().slice(0, 120),
      es_extra: !!it.es_extra,
      es_adelanto: !!it.es_adelanto,
      // Datos por servicio recogidos en el checkout (no se persisten en el servidor).
      objetivo_nombre: it.objetivo_nombre || '',
      objetivo_fecha_nac: it.objetivo_fecha_nac || '',
      info_extra: it.info_extra || '',
    };
  }

  /* ---------- Persistencia ---------- */
  function cargarLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      estado.items = (Array.isArray(arr) ? arr : []).map(sanitizar).filter(Boolean);
    } catch (e) { estado.items = []; }
  }

  function guardarLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(estado.items)); } catch (e) {}
  }

  // Si hay sesión, guarda también el carrito en el servidor.
  function sincronizarServidor() {
    if (!estado.cliente) return;
    try {
      fetch('/api/carrito', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrito: estado.items }),
      }).catch(function () {});
    } catch (e) {}
  }

  function persistir() {
    guardarLocal();
    sincronizarServidor();
    render();
  }

  /* ---------- API pública del carrito ---------- */
  function add(item, origen) {
    var it = sanitizar(item);
    if (!it) return;
    estado.items.push(it);
    persistir();
    // En vez de abrir el panel completo (intrusivo al añadir varios servicios),
    // se muestra una animación mágica hacia el carrito + un aviso discreto.
    volarAlCarrito(origen);
    mostrarToast(it.nombre);
  }

  function eliminar(id) {
    estado.items = estado.items.filter(function (it) { return it.id !== id; });
    persistir();
  }

  function vaciar() {
    estado.items = [];
    persistir();
  }

  function totalNeto() {
    return estado.items.reduce(function (s, it) { return s + (parseInt(it.precio_cop, 10) || 0); }, 0);
  }

  /* ---------- DOM: estilos ---------- */
  function inyectarEstilos() {
    if (document.getElementById('fresa-cart-css')) return;
    var css = [
      '#fc-fab-wrap{position:fixed;right:22px;bottom:24px;z-index:9998;display:flex;flex-direction:column;gap:12px;font-family:"Poppins",sans-serif;}',
      '.fc-fab{width:58px;height:58px;border-radius:50%;border:1px solid rgba(240,163,195,0.3);background:linear-gradient(145deg,#8a3d5e 0%,#7D3754 48%,#5f2740 100%);color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent;box-shadow:0 10px 26px rgba(0,0,0,0.45),0 3px 8px rgba(95,39,64,0.45),inset 0 1px 1px rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;position:relative;transition:transform .24s cubic-bezier(0.22,1,0.36,1),box-shadow .24s ease,border-color .24s ease;}',
      '.fc-fab svg{width:25px;height:25px;stroke:#fff;fill:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));transition:transform .24s cubic-bezier(0.22,1,0.36,1),filter .24s ease,stroke .24s ease;}',
      '.fc-fab:hover{transform:translateY(-3px) scale(1.06);border-color:rgba(240,163,195,0.62);box-shadow:0 16px 36px rgba(0,0,0,0.5),0 6px 14px rgba(95,39,64,0.55),inset 0 1px 1px rgba(255,255,255,0.28);}',
      '.fc-fab:hover svg{transform:scale(1.1);filter:drop-shadow(0 0 6px rgba(240,163,195,0.9));}',
      '.fc-fab:active{transform:translateY(-1px) scale(0.98);}',
      '.fc-fab:focus-visible{outline:2px solid #F0A3C3;outline-offset:3px;}',
      '.fc-fab.principal::before{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 0 rgba(240,163,195,0);animation:fcHalo 3.2s ease-in-out infinite;pointer-events:none;}',
      '@keyframes fcHalo{0%,100%{box-shadow:0 0 0 0 rgba(240,163,195,0);}50%{box-shadow:0 0 20px 4px rgba(240,163,195,0.45);}}',
      '.fc-fab.secundario{background:linear-gradient(145deg,#3a1e33 0%,#241322 55%,#180c16 100%);border-color:rgba(240,163,195,0.28);}',
      '.fc-fab.secundario svg{stroke:#F3C6D8;}',
      '.fc-fab.secundario:hover{border-color:rgba(240,163,195,0.55);}',
      '.fc-fab.secundario:hover svg{stroke:#fff;}',
      '.fc-fab::after{content:attr(data-tip);position:absolute;right:68px;top:50%;transform:translateY(-50%) translateX(8px);background:linear-gradient(135deg,#2a1526,#160610);border:1px solid rgba(240,163,195,0.4);color:#f4e6ee;font-family:"Poppins",sans-serif;font-size:11px;font-weight:600;letter-spacing:.03em;padding:6px 12px;border-radius:20px;white-space:nowrap;opacity:0;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,0.45);transition:opacity .2s ease,transform .2s cubic-bezier(0.22,1,0.36,1);}',
      '.fc-fab:hover::after{opacity:1;transform:translateY(-50%) translateX(0);}',
      '@media (prefers-reduced-motion: reduce){.fc-fab.principal::before{animation:none;}}',
      '.fc-fab.pulso{animation:fcPulso .5s cubic-bezier(0.22,1,0.36,1);}',
      '@keyframes fcPulso{0%{transform:scale(1);}45%{transform:scale(1.16);}100%{transform:scale(1);}}',
      '.fc-badge{position:absolute;top:-5px;right:-5px;min-width:21px;height:21px;padding:0 5px;border-radius:12px;background:linear-gradient(145deg,#F6B6D0,#EC8FB6);color:#3a0a1f;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #14060d;box-shadow:0 2px 6px rgba(0,0,0,0.4);}',
      '.fc-overlay{position:fixed;inset:0;z-index:9999;background:rgba(10,2,7,0.7);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:24px 14px;overflow-y:auto;}',
      '.fc-overlay.activo{display:flex;}',
      '.fc-panel{width:100%;max-width:460px;margin-top:4vh;background:#1a0710;border:1px solid #C2A7B7;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.6);color:#f4e6ee;overflow:hidden;}',
      '.fc-panel.ancho{max-width:560px;}',
      '.fc-head{background:linear-gradient(135deg,#7D3754,#9C4C6D);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;}',
      '.fc-head h3{margin:0;font-size:16px;font-weight:900;letter-spacing:.03em;color:#fff;}',
      '.fc-x{background:none;border:none;color:#f7d4e4;font-size:22px;cursor:pointer;line-height:1;}',
      '.fc-body{padding:18px 20px;max-height:66vh;overflow-y:auto;}',
      '.fc-item{display:flex;gap:10px;justify-content:space-between;align-items:flex-start;padding:11px 0;border-bottom:1px dashed rgba(194,167,183,0.2);}',
      '.fc-item .n{font-size:13.5px;font-weight:600;color:#f4e6ee;}',
      '.fc-item .p{font-size:12px;color:#c9a9ba;margin-top:2px;}',
      '.fc-item .tag{display:inline-block;margin-top:3px;font-size:10px;color:#F0A3C3;border:1px solid rgba(240,163,195,0.35);border-radius:10px;padding:1px 7px;}',
      '.fc-rm{background:none;border:1px solid rgba(194,167,183,0.35);color:#e8a9bf;border-radius:8px;font-size:11px;padding:4px 9px;cursor:pointer;white-space:nowrap;}',
      '.fc-rm:hover{background:rgba(240,163,195,0.12);}',
      '.fc-total{display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:#F0A3C3;padding:14px 0 4px;border-top:1px solid rgba(194,167,183,0.3);margin-top:6px;}',
      '.fc-nota{font-size:11px;color:#9c7788;margin:6px 0 0;line-height:1.5;}',
      '.fc-foot{padding:14px 20px 20px;border-top:1px solid rgba(194,167,183,0.15);display:flex;flex-direction:column;gap:10px;}',
      '.fc-btn{width:100%;padding:12px;border-radius:40px;border:1px solid #C2A7B7;font-family:"Poppins",sans-serif;font-weight:700;font-size:12.5px;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;transition:transform .12s ease;}',
      '.fc-btn:hover{transform:translateY(-1px);}',
      '.fc-btn.primario{background:#7D3754;color:#fff;}',
      '.fc-btn.sec{background:transparent;color:#e8c9d8;}',
      '.fc-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;}',
      '.fc-vacio{text-align:center;color:#9c7788;font-size:13px;padding:24px 0;}',
      '.fc-label{display:block;font-size:12px;color:#e0c0cf;font-weight:600;margin:12px 0 5px;}',
      '.fc-req{color:#F0A3C3;}',
      '.fc-input{width:100%;box-sizing:border-box;background:#0f040a;border:1px solid rgba(194,167,183,0.4);border-radius:8px;color:#f4e6ee;font-family:"Poppins",sans-serif;font-size:13px;padding:9px 11px;}',
      '.fc-input:focus{outline:none;border-color:#F0A3C3;}',
      'textarea.fc-input{min-height:60px;resize:vertical;}',
      '.fc-svc{background:rgba(125,55,84,0.1);border:1px solid rgba(194,167,183,0.22);border-radius:10px;padding:12px 14px;margin-bottom:12px;}',
      '.fc-svc-tit{font-size:13px;font-weight:700;color:#F0A3C3;margin-bottom:4px;}',
      '.fc-svc-precio{font-size:12px;color:#c9a9ba;margin-bottom:6px;}',
      '.fc-check{display:flex;align-items:flex-start;gap:10px;font-size:12.5px;color:#e0c0cf;line-height:1.45;background:rgba(125,55,84,0.16);border:1px solid rgba(240,163,195,0.32);border-radius:10px;padding:11px 13px;margin:0 0 12px;cursor:pointer;-webkit-user-select:none;user-select:none;}',
      '.fc-check input{margin:1px 0 0;width:17px;height:17px;flex-shrink:0;accent-color:#EC8FB6;cursor:pointer;}',
      '.fc-check b{color:#F0A3C3;font-weight:700;}',
      '.fc-metodos{display:flex;gap:8px;margin-top:4px;}',
      '.fc-metodo{flex:1;text-align:center;padding:9px;border-radius:10px;border:1px solid rgba(194,167,183,0.35);font-size:12px;color:#e0c0cf;cursor:pointer;}',
      '.fc-metodo.sel{background:rgba(240,163,195,0.14);border-color:#F0A3C3;color:#fff;font-weight:700;}',
      '.fc-msg{font-size:12px;padding:9px 11px;border-radius:8px;margin-top:10px;display:none;}',
      '.fc-msg.err{display:block;background:rgba(200,60,90,0.16);border:1px solid rgba(230,120,150,0.5);color:#f3b8c9;}',
      '.fc-msg.ok{display:block;background:rgba(90,180,120,0.14);border:1px solid rgba(120,200,150,0.5);color:#bfe8cf;}',
      '.fc-cuenta-tabs{display:flex;gap:8px;margin-bottom:14px;}',
      '.fc-tab{flex:1;text-align:center;padding:9px;border-radius:10px;border:1px solid rgba(194,167,183,0.3);font-size:12px;color:#c9a9ba;cursor:pointer;}',
      '.fc-tab.sel{background:rgba(125,55,84,0.3);border-color:#F0A3C3;color:#fff;font-weight:700;}',
      '.fc-sesion{font-size:12px;color:#c9a9ba;padding:8px 0;}',
      '.fc-sesion strong{color:#F0A3C3;}',
      '.fc-transfer-info{font-size:11.5px;color:#e0c0cf;line-height:1.5;background:rgba(125,55,84,0.14);border:1px solid rgba(194,167,183,0.25);border-radius:8px;padding:10px 12px;margin-top:8px;}',
      '.fc-link{background:none;border:none;color:#F0A3C3;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline;}',
      /* --- Programa de fidelidad "Círculo íntimo" --- */
      '.fc-fid{background:linear-gradient(135deg,rgba(240,163,195,0.12),rgba(125,55,84,0.14));border:1px solid rgba(240,163,195,0.34);border-radius:12px;padding:14px 15px;margin:0 0 16px;}',
      '.fc-fid-tit{font-size:13px;font-weight:900;color:#F0A3C3;margin:0 0 3px;letter-spacing:.02em;}',
      '.fc-fid-sub{font-size:11.5px;color:#d8b6c6;line-height:1.4;margin:0 0 10px;}',
      '.fc-sellos{display:flex;flex-wrap:wrap;gap:8px;}',
      '.fc-sello{width:30px;height:30px;border-radius:50%;border:1px dashed rgba(240,163,195,0.5);display:flex;align-items:center;justify-content:center;font-size:14px;color:#9c7788;background:rgba(15,4,10,0.4);}',
      '.fc-sello.on{border-style:solid;border-color:#F0A3C3;background:linear-gradient(145deg,#F6B6D0,#EC8FB6);color:#3a0a1f;box-shadow:0 0 10px rgba(240,163,195,0.5);}',
      '.fc-fid-goal{margin-top:10px;font-size:11.5px;font-weight:700;color:#e8c9d8;}',
      '.fc-fid-goal.win{color:#bfe8cf;}',
      /* --- Tarjetas de consulta + línea de tiempo --- */
      '.fc-consulta{background:rgba(125,55,84,0.1);border:1px solid rgba(194,167,183,0.24);border-radius:12px;padding:13px 15px;margin:0 0 12px;}',
      '.fc-consulta-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:2px;}',
      '.fc-consulta-ref{font-size:11px;color:#9c7788;}',
      '.fc-consulta-total{font-size:13px;font-weight:700;color:#F0A3C3;white-space:nowrap;}',
      '.fc-consulta-svc{font-size:12.5px;color:#e0c0cf;padding:3px 0;}',
      '.fc-tl{display:flex;justify-content:space-between;align-items:flex-start;gap:4px;margin:12px 0 4px;}',
      '.fc-tl-paso{flex:1;position:relative;text-align:center;}',
      '.fc-tl-paso::before{content:"";position:absolute;top:12px;left:-50%;width:100%;height:2px;background:rgba(194,167,183,0.28);z-index:0;}',
      '.fc-tl-paso:first-child::before{display:none;}',
      '.fc-tl-paso.hecho::before,.fc-tl-paso.activo::before{background:#F0A3C3;}',
      '.fc-tl-dot{position:relative;z-index:1;width:26px;height:26px;line-height:24px;margin:0 auto 6px;border-radius:50%;border:1px solid rgba(194,167,183,0.4);background:rgba(125,55,84,0.18);color:#9c7788;font-size:12px;font-weight:700;}',
      '.fc-tl-paso.hecho .fc-tl-dot{background:#F0A3C3;border-color:#F0A3C3;color:#3a0a1f;}',
      '.fc-tl-paso.activo .fc-tl-dot{border-color:#F0A3C3;color:#F0A3C3;}',
      '.fc-tl-paso.fallido .fc-tl-dot{background:rgba(229,123,160,0.2);border-color:#e57ba0;color:#f3b6cd;}',
      '.fc-tl-label{font-size:9.5px;line-height:1.25;color:#9c7788;}',
      '.fc-tl-paso.hecho .fc-tl-label,.fc-tl-paso.activo .fc-tl-label{color:#e8c9d8;}',
      '.fc-ev{margin-top:10px;padding-top:10px;border-top:1px dashed rgba(194,167,183,0.2);}',
      '.fc-ev-tit{font-size:11px;font-weight:700;color:#F0A3C3;margin:0 0 6px;}',
      '.fc-ev-fotos{display:flex;flex-wrap:wrap;gap:6px;}',
      '.fc-ev-fotos a{display:block;width:46px;height:46px;border-radius:8px;overflow:hidden;border:1px solid rgba(240,163,195,0.35);}',
      '.fc-ev-fotos img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.fc-ev-notas{font-size:11.5px;color:#d8b6c6;line-height:1.4;margin:6px 0 0;}',
      /* --- Checkout por pasos --- */
      '.fc-stepper{display:flex;align-items:center;gap:6px;margin:0 0 16px;}',
      '.fc-step-dot{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;position:relative;}',
      '.fc-step-dot::before{content:"";position:absolute;top:12px;left:-50%;width:100%;height:2px;background:rgba(194,167,183,0.28);z-index:0;}',
      '.fc-step-dot:first-child::before{display:none;}',
      '.fc-step-dot.hecho::before,.fc-step-dot.activo::before{background:#F0A3C3;}',
      '.fc-step-num{position:relative;z-index:1;width:26px;height:26px;line-height:24px;text-align:center;border-radius:50%;border:1px solid rgba(194,167,183,0.4);background:rgba(125,55,84,0.2);color:#c9a9ba;font-size:12px;font-weight:700;transition:all .2s ease;}',
      '.fc-step-dot.activo .fc-step-num{border-color:#F0A3C3;color:#fff;background:#7D3754;}',
      '.fc-step-dot.hecho .fc-step-num{border-color:#F0A3C3;background:#F0A3C3;color:#3a0a1f;}',
      '.fc-step-cap{font-size:9.5px;color:#9c7788;text-align:center;line-height:1.2;}',
      '.fc-step-dot.activo .fc-step-cap,.fc-step-dot.hecho .fc-step-cap{color:#e8c9d8;}',
      '.fc-step{animation:fcStepIn .32s cubic-bezier(0.22,1,0.36,1);}',
      '@keyframes fcStepIn{0%{opacity:0;transform:translateX(14px);}100%{opacity:1;transform:translateX(0);}}',
      '@media (prefers-reduced-motion: reduce){.fc-step{animation:none;}}',
      /* --- Animación "añadir al carrito" (estilo místico del catálogo) --- */
      '.fc-orb{position:fixed;left:0;top:0;width:30px;height:30px;z-index:10001;pointer-events:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:radial-gradient(circle at 34% 28%,#fff 0%,#F6B6D0 32%,#EC8FB6 58%,#7D3754 100%);box-shadow:0 0 12px 3px rgba(240,163,195,0.75),0 0 28px 9px rgba(156,76,109,0.45);will-change:transform,opacity;}',
      '.fc-orb span{color:#fff;font-size:15px;line-height:1;text-shadow:0 0 7px rgba(255,255,255,0.9);}',
      '.fc-spark{position:fixed;left:0;top:0;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;z-index:10000;pointer-events:none;border-radius:50%;background:radial-gradient(circle,#fff 0%,#F6B6D0 45%,rgba(240,163,195,0) 72%);animation:fcSpark .7s ease-out forwards;}',
      '@keyframes fcSpark{0%{transform:scale(1);opacity:.95;}100%{transform:scale(.15);opacity:0;}}',
      '.fc-spark.burst{width:9px;height:9px;margin:-4.5px 0 0 -4.5px;animation:fcBurst .72s cubic-bezier(0.22,1,0.36,1) forwards;}',
      '@keyframes fcBurst{0%{transform:translate(0,0) scale(1);opacity:1;}100%{transform:translate(var(--dx,0),var(--dy,0)) scale(.15);opacity:0;}}',
      '.fc-badge.bump{animation:fcBadgeBump .5s cubic-bezier(0.22,1,0.36,1);}',
      '@keyframes fcBadgeBump{0%{transform:scale(1);}35%{transform:scale(1.55);}100%{transform:scale(1);}}',
      '.fc-toast-wrap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:10002;display:flex;flex-direction:column;align-items:center;pointer-events:none;font-family:"Poppins",sans-serif;}',
      '.fc-toast{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:92vw;background:linear-gradient(135deg,#2a1526 0%,#160610 100%);border:1px solid rgba(240,163,195,0.42);border-radius:40px;box-shadow:0 14px 40px rgba(0,0,0,0.55),0 0 22px rgba(156,76,109,0.35);padding:10px 12px 10px 16px;color:#f4e6ee;transform:translateY(26px) scale(.94);opacity:0;transition:transform .34s cubic-bezier(0.22,1,0.36,1),opacity .34s ease;}',
      '.fc-toast.visible{transform:translateY(0) scale(1);opacity:1;}',
      '.fc-toast .ic{font-size:17px;line-height:1;filter:drop-shadow(0 0 6px rgba(240,163,195,0.85));animation:fcTwinkle 1.4s ease-in-out infinite;}',
      '@keyframes fcTwinkle{0%,100%{transform:scale(1) rotate(0);opacity:1;}50%{transform:scale(1.18) rotate(12deg);opacity:.82;}}',
      '.fc-toast .tx{font-size:12.5px;line-height:1.35;}',
      '.fc-toast .tx b{color:#F0A3C3;font-weight:700;}',
      '.fc-toast .ver{flex-shrink:0;background:linear-gradient(145deg,#8a3d5e,#5f2740);border:1px solid rgba(240,163,195,0.4);color:#fff;font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:30px;padding:7px 13px;cursor:pointer;white-space:nowrap;transition:transform .12s ease,box-shadow .12s ease;}',
      '.fc-toast .ver:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(95,39,64,0.55);}',
      '@media (prefers-reduced-motion: reduce){.fc-toast .ic{animation:none;}}',
      /* --- Beneficios de cuenta (modal de auth) --- */
      '.fc-benes{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:9px;}',
      '.fc-bene{display:flex;align-items:flex-start;gap:10px;font-size:12px;color:#e0c0cf;line-height:1.4;}',
      '.fc-bene .em{flex-shrink:0;font-size:15px;line-height:1.2;filter:drop-shadow(0 0 5px rgba(240,163,195,0.6));}',
      '.fc-bene b{color:#F0A3C3;font-weight:700;}',
      '.fc-benes-tit{font-size:12px;font-weight:800;color:#F0A3C3;letter-spacing:.02em;margin:2px 0 11px;}',
      /* --- Momento ritual (confirmación de pago) --- */
      '.fc-ritual-layer{position:fixed;inset:0;z-index:10010;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,4,10,0.95);backdrop-filter:blur(3px);}',
      '.fc-ritual{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:54px 26px;min-height:280px;animation:fcRitualIn .5s ease;}',
      '@keyframes fcRitualIn{0%{opacity:0;}100%{opacity:1;}}',
      '.fc-ritual-orb{position:relative;width:96px;height:96px;border-radius:50%;background:radial-gradient(circle at 34% 30%,#fff 0%,#F6B6D0 30%,#EC8FB6 56%,#7D3754 100%);box-shadow:0 0 26px 6px rgba(240,163,195,0.55),0 0 60px 18px rgba(156,76,109,0.4);display:flex;align-items:center;justify-content:center;font-size:38px;animation:fcRitualPulse 1.8s ease-in-out infinite;}',
      '.fc-ritual-orb::before,.fc-ritual-orb::after{content:"";position:absolute;inset:-12px;border-radius:50%;border:1px solid rgba(240,163,195,0.4);animation:fcRitualRing 2.4s ease-out infinite;}',
      '.fc-ritual-orb::after{animation-delay:1.2s;}',
      '@keyframes fcRitualPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.07);}}',
      '@keyframes fcRitualRing{0%{transform:scale(0.7);opacity:.7;}100%{transform:scale(1.5);opacity:0;}}',
      '.fc-ritual-tit{font-size:16px;font-weight:900;color:#F0A3C3;margin:24px 0 6px;letter-spacing:.02em;}',
      '.fc-ritual-sub{font-size:12.5px;color:#d8b6c6;line-height:1.5;max-width:280px;}',
      '.fc-ritual-dots{margin-top:16px;display:flex;gap:7px;}',
      '.fc-ritual-dots i{width:8px;height:8px;border-radius:50%;background:#F0A3C3;opacity:.35;animation:fcRitualDot 1.1s ease-in-out infinite;}',
      '.fc-ritual-dots i:nth-child(2){animation-delay:.18s;}',
      '.fc-ritual-dots i:nth-child(3){animation-delay:.36s;}',
      '@keyframes fcRitualDot{0%,100%{opacity:.3;transform:translateY(0);}50%{opacity:1;transform:translateY(-4px);}}',
      '@media (prefers-reduced-motion: reduce){.fc-ritual,.fc-ritual-orb,.fc-ritual-orb::before,.fc-ritual-orb::after,.fc-ritual-dots i{animation:none;}.fc-ritual-orb::before,.fc-ritual-orb::after{display:none;}}',
    ].join('');
    var el = document.createElement('style');
    el.id = 'fresa-cart-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---------- DOM: widget flotante ---------- */
  var refs = {};

  function construirWidget() {
    var wrap = document.createElement('div');
    wrap.id = 'fc-fab-wrap';
    wrap.innerHTML =
      '<button class="fc-fab principal" id="fc-fab-cart" data-tip="Carrito" aria-label="Ver carrito" title="Carrito">' +
      '<svg viewBox="0 0 24 24" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="9" cy="20" r="1.35"/><circle cx="18" cy="20" r="1.35"/>' +
      '<path d="M2.5 3.5h2.2l2.1 11.15a1.6 1.6 0 0 0 1.58 1.3h8.15a1.6 1.6 0 0 0 1.57-1.26L21 7.5H6.2"/></svg>' +
      '<span class="fc-badge" id="fc-badge" style="display:none">0</span></button>' +
      '<button class="fc-fab secundario" id="fc-fab-user" data-tip="Mi cuenta" aria-label="Mi cuenta" title="Mi cuenta">' +
      '<svg viewBox="0 0 24 24" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-3.9 3.4-6.2 7.5-6.2s7.5 2.3 7.5 6.2"/></svg>' +
      '</button>';
    document.body.appendChild(wrap);

    var overlay = document.createElement('div');
    overlay.className = 'fc-overlay';
    overlay.id = 'fc-overlay';
    document.body.appendChild(overlay);

    refs.fab = document.getElementById('fc-fab-cart');
    refs.badge = document.getElementById('fc-badge');
    refs.userFab = document.getElementById('fc-fab-user');
    refs.overlay = overlay;

    refs.fab.addEventListener('click', abrirPanel);
    refs.userFab.addEventListener('click', abrirCuenta);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) cerrar();
    });
  }

  function pulso() {
    if (!refs.fab) return;
    refs.fab.classList.remove('pulso');
    void refs.fab.offsetWidth;
    refs.fab.classList.add('pulso');
  }

  function bumpBadge() {
    if (!refs.badge) return;
    refs.badge.classList.remove('bump');
    void refs.badge.offsetWidth;
    refs.badge.classList.add('bump');
  }

  function centroDe(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Crea una pequeña chispa que se desvanece. Si es "estallido", se dispersa
  // en una dirección aleatoria mediante las variables --dx/--dy.
  function chispa(x, y, estallido) {
    var s = document.createElement('div');
    s.className = 'fc-spark' + (estallido ? ' burst' : '');
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    if (estallido) {
      var ang = Math.random() * Math.PI * 2;
      var dist = 16 + Math.random() * 24;
      s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    }
    document.body.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 760);
  }

  // Orbe mágico que vuela desde el botón hasta el carrito describiendo un arco,
  // dejando un rastro de chispas y terminando con un pequeño estallido + pulso.
  function volarAlCarrito(origen) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var valido = origen && typeof origen.getBoundingClientRect === 'function';
    if (!refs.fab || !valido || reduce) { pulso(); bumpBadge(); return; }

    var ini = centroDe(origen);
    var fin = centroDe(refs.fab);
    var orb = document.createElement('div');
    orb.className = 'fc-orb';
    orb.innerHTML = '<span>\u2726</span>';
    document.body.appendChild(orb);

    var cx = (ini.x + fin.x) / 2;
    var cy = Math.min(ini.y, fin.y) - 100;
    var dur = 720;
    var t0 = null;
    var ultima = 0;

    function frame(t) {
      if (t0 === null) t0 = t;
      var p = Math.min((t - t0) / dur, 1);
      var e = 1 - Math.pow(1 - p, 3);
      var mt = 1 - e;
      var x = mt * mt * ini.x + 2 * mt * e * cx + e * e * fin.x;
      var y = mt * mt * ini.y + 2 * mt * e * cy + e * e * fin.y;
      var s = 1 - 0.6 * e;
      orb.style.transform = 'translate(' + (x - 15) + 'px,' + (y - 15) + 'px) scale(' + s.toFixed(3) + ') rotate(' + (e * 240).toFixed(1) + 'deg)';
      orb.style.opacity = p < 0.88 ? '1' : ((1 - p) / 0.12).toFixed(2);
      if (t - ultima > 42) {
        ultima = t;
        chispa(x + (Math.random() * 14 - 7), y + (Math.random() * 14 - 7));
      }
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        if (orb.parentNode) orb.parentNode.removeChild(orb);
        pulso();
        bumpBadge();
        for (var i = 0; i < 7; i++) chispa(fin.x, fin.y, true);
      }
    }
    requestAnimationFrame(frame);
  }

  var toastTimer = null;
  function mostrarToast(nombre) {
    var wrap = document.getElementById('fc-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'fc-toast-wrap';
      wrap.className = 'fc-toast-wrap';
      document.body.appendChild(wrap);
    }
    wrap.innerHTML = '';
    var toast = document.createElement('div');
    toast.className = 'fc-toast';
    toast.innerHTML =
      '<span class="ic">\u2728</span>' +
      '<span class="tx"><b>' + esc(nombre || 'Servicio') + '</b><br>añadido al carrito</span>' +
      '<button class="ver" type="button">Ver carrito</button>';
    wrap.appendChild(toast);
    toast.querySelector('.ver').addEventListener('click', function () {
      ocultarToast();
      abrirPanel();
    });
    void toast.offsetWidth;
    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(ocultarToast, 3800);
  }

  function ocultarToast() {
    var wrap = document.getElementById('fc-toast-wrap');
    if (!wrap) return;
    var toast = wrap.querySelector('.fc-toast');
    if (!toast) return;
    toast.classList.remove('visible');
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 340);
  }

  function cerrar() {
    if (refs.overlay) refs.overlay.classList.remove('activo');
  }

  function render() {
    if (!refs.badge) return;
    var n = estado.items.length;
    refs.badge.textContent = String(n);
    refs.badge.style.display = n > 0 ? 'flex' : 'none';
  }

  /* ---------- Panel del carrito ---------- */
  function abrirPanel() {
    var filas = estado.items.map(function (it) {
      var tag = it.es_adelanto ? 'Adelanto' : (it.es_extra ? 'Extra' : (it.es_hechizo ? 'Hechizo' : ''));
      return '<div class="fc-item"><div>' +
        '<div class="n">' + esc(it.nombre) + '</div>' +
        '<div class="p">' + esc(it.precio_texto || fmtCOP(it.precio_cop)) + '</div>' +
        (tag ? '<span class="tag">' + esc(tag) + '</span>' : '') +
        '</div>' +
        '<button class="fc-rm" data-id="' + esc(it.id) + '">Quitar</button></div>';
    }).join('');

    var vacio = estado.items.length === 0;
    var neto = totalNeto();
    var estWompi = conComisionWompi(neto);

    var html =
      '<div class="fc-panel">' +
      '<div class="fc-head"><h3>🛒 Tu carrito</h3><button class="fc-x" id="fc-close">×</button></div>' +
      '<div class="fc-body">' +
      (vacio
        ? '<div class="fc-vacio">Tu carrito está vacío.<br>Agrega servicios desde el catálogo con “＋ Carrito”.</div>'
        : filas +
          '<div class="fc-total"><span>Subtotal</span><span>' + fmtCOP(neto) + '</span></div>' +
          '<p class="fc-nota">Con Wompi el total estimado (incluye comisión) sería <strong>' + fmtCOP(estWompi) + '</strong>. ' +
          'Por transferencia pagas ' + fmtCOP(neto) + '. El monto final lo confirma el servidor al pagar.</p>') +
      '</div>' +
      '<div class="fc-foot">' +
      (vacio ? '' :
        '<button class="fc-btn primario" id="fc-ir-checkout">Finalizar compra</button>' +
        '<button class="fc-btn sec" id="fc-vaciar">Vaciar carrito</button>') +
      '</div></div>';

    refs.overlay.innerHTML = html;
    refs.overlay.classList.add('activo');

    document.getElementById('fc-close').addEventListener('click', cerrar);
    Array.prototype.forEach.call(refs.overlay.querySelectorAll('.fc-rm'), function (b) {
      b.addEventListener('click', function () { eliminar(b.getAttribute('data-id')); abrirPanel(); });
    });
    var bv = document.getElementById('fc-vaciar');
    if (bv) bv.addEventListener('click', function () {
      if (confirm('¿Vaciar el carrito?')) { vaciar(); abrirPanel(); }
    });
    var bc = document.getElementById('fc-ir-checkout');
    if (bc) bc.addEventListener('click', abrirCheckout);
  }

  /* ---------- Modal de cuenta (registro / login / sesión) ---------- */
  function abrirCuenta() {
    if (estado.cliente) return vistaSesion();
    vistaAuth('login');
  }

  function vistaSesion() {
    var html =
      '<div class="fc-panel">' +
      '<div class="fc-head"><h3>👤 Mi cuenta</h3><button class="fc-x" id="fc-close">×</button></div>' +
      '<div class="fc-body">' +
      '<p class="fc-sesion">Sesión iniciada como <strong>' + esc(estado.cliente.email) + '</strong>' +
      (estado.cliente.nombre ? ' (' + esc(estado.cliente.nombre) + ')' : '') + '.</p>' +
      '<p class="fc-nota">Tu carrito se guarda en tu cuenta y estará disponible cuando vuelvas a iniciar sesión.</p>' +
      '</div>' +
      '<div class="fc-foot">' +
      '<button class="fc-btn primario" id="fc-consultas">✦ Mis consultas</button>' +
      '<button class="fc-btn sec" id="fc-logout">Cerrar sesión</button>' +
      '</div>' +
      '</div>';
    refs.overlay.innerHTML = html;
    refs.overlay.classList.add('activo');
    document.getElementById('fc-close').addEventListener('click', cerrar);
    document.getElementById('fc-consultas').addEventListener('click', vistaConsultas);
    document.getElementById('fc-logout').addEventListener('click', hacerLogout);
  }

  /* ---------- Vista "Mis consultas" (historial + fidelidad + evidencias) ---------- */
  // Línea de tiempo de un pedido a partir del estado de la base de datos y de si
  // el trabajo ya fue realizado.
  function timelineHtml(estadoPedido, trabajoHecho) {
    var rechazado = estadoPedido === 'rechazado';
    var pagado = estadoPedido === 'agendado';
    var enRevision = estadoPedido === 'pendiente_verificacion';
    var pasos = [
      { label: 'Pedido recibido', clase: 'hecho', icono: '\u2713' },
      {
        label: rechazado ? 'Pago rechazado' : (pagado ? 'Pago confirmado' : (enRevision ? 'Comprobante en revisión' : 'Esperando pago')),
        clase: rechazado ? 'fallido' : (pagado ? 'hecho' : (enRevision ? 'activo' : 'pendiente')),
        icono: rechazado ? '\u2715' : (pagado ? '\u2713' : '2'),
      },
      {
        label: trabajoHecho ? 'Trabajo realizado' : 'Trabajo por realizar',
        clase: trabajoHecho ? 'hecho' : (pagado ? 'activo' : 'pendiente'),
        icono: trabajoHecho ? '\u273f' : '3',
      },
    ];
    return '<div class="fc-tl">' + pasos.map(function (p) {
      return '<div class="fc-tl-paso ' + p.clase + '"><div class="fc-tl-dot">' + p.icono + '</div>' +
        '<div class="fc-tl-label">' + esc(p.label) + '</div></div>';
    }).join('') + '</div>';
  }

  function bloqueFidelidad(fid) {
    if (!fid) return '';
    var total = Math.max(fid.objetivo, fid.sellos);
    var sellos = '';
    for (var i = 0; i < total; i++) {
      var on = i < fid.sellos;
      sellos += '<div class="fc-sello' + (on ? ' on' : '') + '">' + (on ? '\u2726' : (i + 1)) + '</div>';
    }
    var meta = fid.desbloqueada
      ? '<div class="fc-fid-goal win">\u2728 ¡Desbloqueaste tu recompensa! ' + esc(fid.recompensa) + '</div>'
      : '<div class="fc-fid-goal">Te ' + (fid.faltan === 1 ? 'falta' : 'faltan') + ' <b>' + fid.faltan + '</b> ' +
        (fid.faltan === 1 ? 'consulta' : 'consultas') + ' para tu recompensa: ' + esc(fid.recompensa) + '</div>';
    return '<div class="fc-fid">' +
      '<div class="fc-fid-tit">\u2726 Círculo íntimo</div>' +
      '<div class="fc-fid-sub">Suma un sello por cada consulta confirmada y desbloquea un regalo.</div>' +
      '<div class="fc-sellos">' + sellos + '</div>' + meta + '</div>';
  }

  function evidenciaHtml(evidencia) {
    if (!evidencia) return '';
    var fotos = (evidencia.fotos || []).map(function (u) {
      return '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Evidencia" loading="lazy"></a>';
    }).join('');
    return '<div class="fc-ev"><div class="fc-ev-tit">🖼️ Evidencia de tu trabajo</div>' +
      (fotos ? '<div class="fc-ev-fotos">' + fotos + '</div>' : '') +
      (evidencia.notas ? '<p class="fc-ev-notas">' + esc(evidencia.notas) + '</p>' : '') +
      (evidencia.enlace ? '<p class="fc-ev-notas"><a href="' + esc(evidencia.enlace) + '" target="_blank" rel="noopener">Ver evidencia completa →</a></p>' : '') +
      '</div>';
  }

  function tarjetaConsulta(g) {
    var svcs = (g.servicios || []).map(function (s) {
      return '<div class="fc-consulta-svc">• ' + esc(s.producto) +
        (s.trabajo_hecho ? ' <span style="color:#bfe8cf">✓ realizado</span>' : '') +
        '<span style="float:right;color:#c9a9ba">' + esc(s.precio_texto) + '</span></div>';
    }).join('');
    var evid = (g.servicios || []).map(function (s) { return evidenciaHtml(s.evidencia); }).join('');
    var refTxt = g.pedido_ref ? ('Pedido ' + g.pedido_ref) : ('Ref ' + g.ref);
    return '<div class="fc-consulta">' +
      '<div class="fc-consulta-top"><span class="fc-consulta-ref">' + esc(refTxt) + '</span>' +
      '<span class="fc-consulta-total">' + fmtCOP(g.total_cop) + '</span></div>' +
      svcs +
      timelineHtml(g.estado, g.trabajo_hecho) +
      evid +
      '</div>';
  }

  function vistaConsultas() {
    var html =
      '<div class="fc-panel ancho">' +
      '<div class="fc-head"><h3>✦ Mis consultas</h3><button class="fc-x" id="fc-close">×</button></div>' +
      '<div class="fc-body" id="fc-consultas-body">' +
      '<div class="fc-vacio">Cargando tus consultas…</div>' +
      '</div>' +
      '<div class="fc-foot"><button class="fc-btn sec" id="fc-volver-cuenta">← Volver a mi cuenta</button></div>' +
      '</div>';
    refs.overlay.innerHTML = html;
    refs.overlay.classList.add('activo');
    document.getElementById('fc-close').addEventListener('click', cerrar);
    document.getElementById('fc-volver-cuenta').addEventListener('click', vistaSesion);

    fetch('/api/cuenta/consultas').then(parseJson).then(function (res) {
      if (!res.ok || !res.data.ok) throw new Error(res.data.error || 'No se pudieron cargar tus consultas.');
      var cont = document.getElementById('fc-consultas-body');
      if (!cont) return;
      var grupos = res.data.grupos || [];
      var cuerpo = bloqueFidelidad(res.data.fidelidad);
      if (grupos.length === 0) {
        cuerpo += '<div class="fc-vacio">Todavía no tienes consultas.<br>Cuando hagas tu primera compra aparecerá aquí con su estado y evidencias.</div>';
      } else {
        cuerpo += grupos.map(tarjetaConsulta).join('');
      }
      cont.innerHTML = cuerpo;
    }).catch(function (e) {
      var cont = document.getElementById('fc-consultas-body');
      if (cont) cont.innerHTML = '<div class="fc-msg err" style="display:block">' + esc(e.message) + '</div>';
    });
  }

  function vistaAuth(modo) {
    var esLogin = modo !== 'registro';
    var html =
      '<div class="fc-panel">' +
      '<div class="fc-head"><h3>👤 ' + (esLogin ? 'Iniciar sesión' : 'Crear cuenta') + '</h3>' +
      '<button class="fc-x" id="fc-close">×</button></div>' +
      '<div class="fc-body">' +
      '<div class="fc-cuenta-tabs">' +
      '<div class="fc-tab' + (esLogin ? ' sel' : '') + '" data-modo="login">Iniciar sesión</div>' +
      '<div class="fc-tab' + (!esLogin ? ' sel' : '') + '" data-modo="registro">Crear cuenta</div>' +
      '</div>' +
      (esLogin ?
        '<p class="fc-nota">Entra para ver tus consultas, su avance y las evidencias de tus trabajos.</p>' :
        '<p class="fc-benes-tit">✧ Al crear tu cuenta desbloqueas:</p>' +
        '<ul class="fc-benes">' +
        '<li class="fc-bene"><span class="em">🕯️</span><span><b>Seguimiento en vivo</b> del estado de cada consulta, paso a paso.</span></li>' +
        '<li class="fc-bene"><span class="em">📸</span><span><b>Historial con evidencias</b> de tus trabajos, guardadas en tu perfil.</span></li>' +
        '<li class="fc-bene"><span class="em">🔔</span><span><b>Avisos</b> cuando tu pago se confirma y cuando tu trabajo queda listo.</span></li>' +
        '<li class="fc-bene"><span class="em">🌙</span><span><b>Círculo íntimo:</b> junta sellos por cada consulta y gana una recompensa.</span></li>' +
        '</ul>') +
      (esLogin ? '' :
        '<label class="fc-label">Nombre</label>' +
        '<input class="fc-input" id="fc-nombre" type="text" placeholder="Tu nombre (opcional)">') +
      '<label class="fc-label">Correo electrónico <span class="fc-req">*</span></label>' +
      '<input class="fc-input" id="fc-email" type="email" placeholder="correo@ejemplo.com" autocomplete="email">' +
      '<label class="fc-label">Contraseña <span class="fc-req">*</span></label>' +
      '<input class="fc-input" id="fc-pass" type="password" placeholder="Mínimo 6 caracteres" autocomplete="' +
      (esLogin ? 'current-password' : 'new-password') + '">' +
      '<div class="fc-msg" id="fc-auth-msg"></div>' +
      '</div>' +
      '<div class="fc-foot"><button class="fc-btn primario" id="fc-auth-go">' +
      (esLogin ? 'Entrar' : 'Crear cuenta') + '</button></div>' +
      '</div>';
    refs.overlay.innerHTML = html;
    refs.overlay.classList.add('activo');
    document.getElementById('fc-close').addEventListener('click', cerrar);
    Array.prototype.forEach.call(refs.overlay.querySelectorAll('.fc-tab'), function (t) {
      t.addEventListener('click', function () { vistaAuth(t.getAttribute('data-modo')); });
    });
    document.getElementById('fc-auth-go').addEventListener('click', function () {
      esLogin ? hacerLogin() : hacerRegistro();
    });
  }

  function msgAuth(texto, tipo) {
    var el = document.getElementById('fc-auth-msg');
    if (!el) return;
    el.textContent = texto;
    el.className = 'fc-msg ' + (tipo || 'err');
  }

  function hacerRegistro() {
    var nombre = (document.getElementById('fc-nombre') || {}).value || '';
    var email = (document.getElementById('fc-email') || {}).value || '';
    var pass = (document.getElementById('fc-pass') || {}).value || '';
    var btn = document.getElementById('fc-auth-go');
    btn.disabled = true;
    fetch('/api/cuenta/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nombre, email: email, password: pass, carrito: estado.items }),
    }).then(parseJson).then(function (res) {
      if (!res.ok || !res.data.ok) throw new Error(res.data.error || 'No se pudo crear la cuenta.');
      aplicarCliente(res.data.cliente);
      cerrar();
    }).catch(function (e) {
      msgAuth(e.message, 'err');
      btn.disabled = false;
    });
  }

  function hacerLogin() {
    var email = (document.getElementById('fc-email') || {}).value || '';
    var pass = (document.getElementById('fc-pass') || {}).value || '';
    var btn = document.getElementById('fc-auth-go');
    btn.disabled = true;
    fetch('/api/cuenta/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: pass, carrito: estado.items }),
    }).then(parseJson).then(function (res) {
      if (!res.ok || !res.data.ok) throw new Error(res.data.error || 'No se pudo iniciar sesión.');
      aplicarCliente(res.data.cliente);
      cerrar();
    }).catch(function (e) {
      msgAuth(e.message, 'err');
      btn.disabled = false;
    });
  }

  function hacerLogout() {
    fetch('/api/cuenta/logout', { method: 'POST' })
      .then(parseJson).then(function () {
        estado.cliente = null;
        render();
        cerrar();
      }).catch(function () { cerrar(); });
  }

  // Al autenticarse, el servidor devuelve el carrito fusionado; se adopta local.
  function aplicarCliente(cliente) {
    estado.cliente = cliente ? { email: cliente.email, nombre: cliente.nombre } : null;
    if (cliente && Array.isArray(cliente.carrito)) {
      estado.items = cliente.carrito.map(sanitizar).filter(Boolean);
      guardarLocal();
    }
    render();
  }

  /* ---------- Checkout combinado ---------- */
  var metodoCheckout = 'wompi';

  function abrirCheckout() {
    if (estado.items.length === 0) { abrirPanel(); return; }
    metodoCheckout = 'wompi';

    var hayNormal = estado.items.some(function (it) { return !it.es_extra && !it.es_adelanto; });

    // Índices de los servicios "normales" (hechizo/lectura) que piden datos de la
    // persona. Con 2 o más se ofrece reutilizar los mismos datos para todos.
    var idxNormales = [];
    estado.items.forEach(function (it, i) {
      if (!it.es_extra && !it.es_adelanto) idxNormales.push(i);
    });
    var refNormal = idxNormales.length ? idxNormales[0] : -1;
    var permitirMismos = idxNormales.length >= 2;

    var bloques = estado.items.map(function (it, i) {
      var esNormal = !it.es_extra && !it.es_adelanto;
      var titulo = '<div class="fc-svc-tit">' + (i + 1) + '. ' + esc(it.nombre) + '</div>' +
        '<div class="fc-svc-precio">' + esc(it.precio_texto || fmtCOP(it.precio_cop)) + '</div>';
      var campos;
      if (it.es_adelanto) {
        campos = '<p class="fc-nota">Adelanto por urgencia. No requiere datos adicionales.</p>';
      } else if (it.es_extra) {
        campos =
          '<label class="fc-label">¿A cuál(es) hechizo(s) se aplica? <span class="fc-req">*</span></label>' +
          '<textarea class="fc-input" data-campo="info_extra" data-idx="' + i + '" ' +
          'placeholder="Ej: Amarre eterno, Endulzamiento..."></textarea>';
      } else {
        campos =
          '<label class="fc-label">Nombre de la persona</label>' +
          '<input class="fc-input" data-campo="objetivo_nombre" data-idx="' + i + '" type="text" placeholder="Nombre y apellidos">' +
          '<label class="fc-label">Fecha de nacimiento</label>' +
          '<input class="fc-input" data-campo="objetivo_fecha_nac" data-idx="' + i + '" type="date">' +
          '<label class="fc-label">Foto (opcional)</label>' +
          '<input class="fc-input" data-campo="foto" data-idx="' + i + '" type="file" accept="image/*">' +
          '<label class="fc-label">Información adicional</label>' +
          '<textarea class="fc-input" data-campo="info_extra" data-idx="' + i + '" placeholder="Cualquier detalle adicional..."></textarea>';
        if (i === refNormal && permitirMismos) {
          campos += '<p class="fc-nota fc-mismos-nota" style="display:none">\u2728 Estos datos se aplicarán a los ' + idxNormales.length + ' servicios.</p>';
        }
      }
      return '<div class="fc-svc" data-svc="' + i + '"' + (esNormal ? ' data-normal="1"' : '') + '>' + titulo + campos + '</div>';
    }).join('');

    // Casilla para indicar que todos los servicios comparten los mismos datos.
    var mismosHtml = permitirMismos
      ? '<label class="fc-check"><input type="checkbox" id="fc-mismos">' +
        '<span>Los datos son los <b>mismos para todos</b> los hechizos/lecturas. Rellena el primero y se copiarán a los demás.</span></label>'
      : '';

    var neto = totalNeto();
    var estWompi = conComisionWompi(neto);

    var stepperHtml =
      '<div class="fc-stepper">' +
      '<div class="fc-step-dot" data-dot="1"><div class="fc-step-num">1</div><div class="fc-step-cap">Contacto</div></div>' +
      '<div class="fc-step-dot" data-dot="2"><div class="fc-step-num">2</div><div class="fc-step-cap">Servicios</div></div>' +
      '<div class="fc-step-dot" data-dot="3"><div class="fc-step-num">3</div><div class="fc-step-cap">Pago</div></div>' +
      '</div>';

    var paso1 =
      '<label class="fc-label">Tu nombre y apellido <span class="fc-req">*</span></label>' +
      '<input class="fc-input" id="fc-cliente-nombre" type="text" placeholder="Tu nombre completo"' +
      (estado.cliente && estado.cliente.nombre ? ' value="' + esc(estado.cliente.nombre) + '"' : '') + '>' +
      (hayNormal
        ? '<label class="fc-label">WhatsApp o red social <span class="fc-req">*</span></label>' +
          '<input class="fc-input" id="fc-contacto" type="text" placeholder="Para entregarte la evidencia">'
        : '');

    var paso2 = mismosHtml + bloques;

    var paso3 =
      '<label class="fc-label">Método de pago</label>' +
      '<div class="fc-metodos">' +
      '<div class="fc-metodo sel" data-metodo="wompi">Tarjeta / Wompi</div>' +
      '<div class="fc-metodo" data-metodo="transferencia">Transferencia</div>' +
      '</div>' +
      '<div id="fc-transfer-box"></div>' +
      '<div class="fc-total"><span>Total estimado</span><span id="fc-total-est">' + fmtCOP(estWompi) + '</span></div>' +
      '<p class="fc-nota">El servidor recalcula y confirma el total al procesar el pago.</p>';

    var html =
      '<div class="fc-panel ancho">' +
      '<div class="fc-head"><h3>Finalizar compra</h3><button class="fc-x" id="fc-close">×</button></div>' +
      '<div class="fc-body">' +
      stepperHtml +
      '<div class="fc-step" id="fc-paso-1">' + paso1 + '</div>' +
      '<div class="fc-step" id="fc-paso-2" style="display:none">' + paso2 + '</div>' +
      '<div class="fc-step" id="fc-paso-3" style="display:none">' + paso3 + '</div>' +
      '<div class="fc-msg" id="fc-checkout-msg"></div>' +
      '</div>' +
      '<div class="fc-foot" id="fc-checkout-foot"></div>' +
      '</div>';

    refs.overlay.innerHTML = html;
    refs.overlay.classList.add('activo');

    document.getElementById('fc-close').addEventListener('click', cerrar);

    var chkMismos = document.getElementById('fc-mismos');
    if (chkMismos) {
      chkMismos.addEventListener('change', function () {
        aplicarMismosDatos(chkMismos.checked, refNormal, idxNormales);
      });
    }

    Array.prototype.forEach.call(refs.overlay.querySelectorAll('.fc-metodo'), function (m) {
      m.addEventListener('click', function () {
        metodoCheckout = m.getAttribute('data-metodo');
        Array.prototype.forEach.call(refs.overlay.querySelectorAll('.fc-metodo'), function (x) {
          x.classList.toggle('sel', x === m);
        });
        actualizarTotalYTransfer(neto);
      });
    });

    // Con solo servicios sin datos (adelanto/extra) el paso "Servicios" se omite.
    var hayServiciosConDatos = estado.items.some(function (it) { return !it.es_adelanto; });
    pasoCheckout = 1;
    mostrarPasoCheckout(1, neto, hayServiciosConDatos);
  }

  // Estado y navegación del checkout por pasos (1 Contacto → 2 Servicios → 3 Pago).
  var pasoCheckout = 1;

  function mostrarPasoCheckout(n, neto, hayServiciosConDatos) {
    pasoCheckout = n;
    [1, 2, 3].forEach(function (i) {
      var sec = document.getElementById('fc-paso-' + i);
      if (sec) sec.style.display = (i === n) ? '' : 'none';
      // Reinicia la animación de entrada al mostrar el paso activo.
      if (sec && i === n) { sec.style.animation = 'none'; void sec.offsetWidth; sec.style.animation = ''; }
      var dot = refs.overlay.querySelector('.fc-step-dot[data-dot="' + i + '"]');
      if (dot) {
        dot.classList.toggle('activo', i === n);
        dot.classList.toggle('hecho', i < n);
      }
    });
    msgCheckout('', 'ok');
    var msgEl = document.getElementById('fc-checkout-msg');
    if (msgEl) msgEl.className = 'fc-msg';
    renderFootCheckout(neto, hayServiciosConDatos);
    if (n === 3) actualizarTotalYTransfer(neto);
  }

  function renderFootCheckout(neto, hayServiciosConDatos) {
    var foot = document.getElementById('fc-checkout-foot');
    if (!foot) return;
    var n = pasoCheckout;
    var total = metodoCheckout === 'transferencia' ? neto : conComisionWompi(neto);
    if (n === 3) {
      foot.innerHTML =
        '<button class="fc-btn primario" id="fc-pagar">' +
        (metodoCheckout === 'transferencia' ? 'Confirmar ' : 'Pagar ') + fmtCOP(total) + '</button>' +
        '<button class="fc-btn sec" id="fc-atras">← Atrás</button>';
      document.getElementById('fc-pagar').addEventListener('click', enviarCheckout);
      document.getElementById('fc-atras').addEventListener('click', function () {
        mostrarPasoCheckout(hayServiciosConDatos ? 2 : 1, neto, hayServiciosConDatos);
      });
    } else {
      foot.innerHTML =
        '<button class="fc-btn primario" id="fc-siguiente">Siguiente →</button>' +
        '<button class="fc-btn sec" id="fc-atras">' + (n === 1 ? '← Volver al carrito' : '← Atrás') + '</button>';
      document.getElementById('fc-siguiente').addEventListener('click', function () {
        avanzarCheckout(neto, hayServiciosConDatos);
      });
      document.getElementById('fc-atras').addEventListener('click', function () {
        if (n === 1) abrirPanel();
        else mostrarPasoCheckout(1, neto, hayServiciosConDatos);
      });
    }
  }

  function avanzarCheckout(neto, hayServiciosConDatos) {
    if (pasoCheckout === 1) {
      if (!validarPaso1()) return;
      mostrarPasoCheckout(hayServiciosConDatos ? 2 : 3, neto, hayServiciosConDatos);
    } else if (pasoCheckout === 2) {
      if (!validarPaso2()) return;
      mostrarPasoCheckout(3, neto, hayServiciosConDatos);
    }
  }

  // Paso 1: nombre siempre; contacto solo si hay servicios que requieren datos.
  function validarPaso1() {
    var nombre = (document.getElementById('fc-cliente-nombre') || {}).value || '';
    if (!nombre.trim()) { msgCheckout('Escribe tu nombre y apellido.'); return false; }
    var contactoEl = document.getElementById('fc-contacto');
    if (contactoEl && !contactoEl.value.trim()) { msgCheckout('Escribe tu WhatsApp o red social.'); return false; }
    return true;
  }

  // Paso 2: valida los datos por servicio (misma lógica que el envío final).
  function validarPaso2() {
    var idxNormales = [];
    estado.items.forEach(function (it, i) { if (!it.es_extra && !it.es_adelanto) idxNormales.push(i); });
    var refIdx = idxNormales.length ? idxNormales[0] : -1;
    var mismos = idxNormales.length >= 2 && !!(document.getElementById('fc-mismos') || {}).checked;
    for (var i = 0; i < estado.items.length; i++) {
      var it = estado.items[i];
      if (it.es_adelanto) continue;
      var srcIdx = (mismos && !it.es_extra) ? refIdx : i;
      var bloque = refs.overlay.querySelector('.fc-svc[data-svc="' + srcIdx + '"]');
      if (!bloque) continue;
      var val = {}; var hasFoto = false;
      Array.prototype.forEach.call(bloque.querySelectorAll('[data-campo]'), function (c) {
        var campo = c.getAttribute('data-campo');
        if (campo === 'foto') { if (c.files && c.files[0]) hasFoto = true; }
        else val[campo] = (c.value || '').trim();
      });
      if (it.es_extra) {
        if (!val.info_extra) { msgCheckout('Indica a cuál(es) hechizo(s) se aplica: ' + it.nombre + '.'); return false; }
      } else {
        if (!val.objetivo_nombre && !val.objetivo_fecha_nac && !hasFoto) {
          msgCheckout('Faltan los datos de la persona para: ' + it.nombre + '.'); return false;
        }
      }
    }
    return true;
  }

  function actualizarTotalYTransfer(neto) {
    var esTransfer = metodoCheckout === 'transferencia';
    var total = esTransfer ? neto : conComisionWompi(neto);
    var elTot = document.getElementById('fc-total-est');
    if (elTot) elTot.textContent = fmtCOP(total);
    var elBtn = document.getElementById('fc-pagar');
    if (elBtn) elBtn.textContent = (esTransfer ? 'Confirmar ' : 'Pagar ') + fmtCOP(total);
    var box = document.getElementById('fc-transfer-box');
    if (!box) return;
    if (esTransfer) {
      box.innerHTML =
        '<div class="fc-transfer-info">Realiza la transferencia por <strong>' + fmtCOP(neto) + '</strong> ' +
        'y sube el comprobante. Verificaremos tu pago manualmente antes de agendar.</div>' +
        '<label class="fc-label">Comprobante de pago <span class="fc-req">*</span></label>' +
        '<input class="fc-input" id="fc-comprobante" type="file" accept="image/*">';
    } else {
      box.innerHTML = '';
    }
  }

  function msgCheckout(texto, tipo) {
    var el = document.getElementById('fc-checkout-msg');
    if (!el) return;
    el.textContent = texto;
    el.className = 'fc-msg ' + (tipo || 'err');
  }

  // Oculta/muestra los bloques de servicio duplicados cuando el cliente indica
  // que los datos son los mismos para todos (solo se rellena el primero).
  function aplicarMismosDatos(activo, refIdx, idxNormales) {
    idxNormales.forEach(function (i) {
      if (i === refIdx) return;
      var bloque = refs.overlay.querySelector('.fc-svc[data-svc="' + i + '"]');
      if (bloque) bloque.style.display = activo ? 'none' : '';
    });
    var nota = refs.overlay.querySelector('.fc-mismos-nota');
    if (nota) nota.style.display = activo ? 'block' : 'none';
  }

  function enviarCheckout() {
    var btn = document.getElementById('fc-pagar');
    var textoBtn = btn.textContent;
    var esTransfer = metodoCheckout === 'transferencia';

    var clienteNombre = (document.getElementById('fc-cliente-nombre') || {}).value || '';
    if (!clienteNombre.trim()) { msgCheckout('Escribe tu nombre y apellido.'); return; }

    var contactoEl = document.getElementById('fc-contacto');
    var contacto = contactoEl ? contactoEl.value : '';

    // Recolecta los datos por servicio desde el formulario.
    var fd = new FormData();

    // Servicios "normales" y opción "los datos son los mismos para todos".
    var idxNormales = [];
    estado.items.forEach(function (it, i) {
      if (!it.es_extra && !it.es_adelanto) idxNormales.push(i);
    });
    var refIdx = idxNormales.length ? idxNormales[0] : -1;
    var mismos = idxNormales.length >= 2 && !!(document.getElementById('fc-mismos') || {}).checked;

    // Lee una sola vez los datos (y la foto) del bloque de referencia.
    var refVals = { objetivo_nombre: '', objetivo_fecha_nac: '', info_extra: '' };
    var refFile = null;
    if (mismos && refIdx >= 0) {
      var refBloque = refs.overlay.querySelector('.fc-svc[data-svc="' + refIdx + '"]');
      if (refBloque) {
        Array.prototype.forEach.call(refBloque.querySelectorAll('[data-campo]'), function (c) {
          var campo = c.getAttribute('data-campo');
          if (campo === 'foto') {
            if (c.files && c.files[0]) refFile = c.files[0];
          } else {
            refVals[campo] = (c.value || '').trim();
          }
        });
      }
    }

    var itemsPayload = estado.items.map(function (it, i) {
      var out = {
        nombre: it.nombre,
        precio_cop: it.precio_cop,
        precio_usd: it.precio_usd,
        es_hechizo: it.es_hechizo,
        hechizo_clave: it.hechizo_clave,
        es_extra: it.es_extra,
        es_adelanto: it.es_adelanto,
        objetivo_nombre: '',
        objetivo_fecha_nac: '',
        info_extra: '',
        foto_campo: '',
      };

      // Con "mismos datos" activo, los servicios normales reutilizan los datos
      // y la foto del primero, sin volver a escribirlos.
      if (mismos && !it.es_extra && !it.es_adelanto) {
        out.objetivo_nombre = refVals.objetivo_nombre;
        out.objetivo_fecha_nac = refVals.objetivo_fecha_nac;
        out.info_extra = refVals.info_extra;
        if (refFile) {
          var fn = 'foto_' + i;
          fd.append(fn, refFile);
          out.foto_campo = fn;
        }
        return out;
      }

      var bloque = refs.overlay.querySelector('.fc-svc[data-svc="' + i + '"]');
      if (bloque) {
        var campos = bloque.querySelectorAll('[data-campo]');
        Array.prototype.forEach.call(campos, function (c) {
          var campo = c.getAttribute('data-campo');
          if (campo === 'foto') {
            if (c.files && c.files[0]) {
              var fieldName = 'foto_' + i;
              fd.append(fieldName, c.files[0]);
              out.foto_campo = fieldName;
            }
          } else {
            out[campo] = (c.value || '').trim();
          }
        });
      }
      return out;
    });

    // Validación básica en el cliente (el servidor vuelve a validar).
    for (var i = 0; i < estado.items.length; i++) {
      var it = estado.items[i];
      var p = itemsPayload[i];
      if (it.es_adelanto) continue;
      if (it.es_extra) {
        if (!p.info_extra) { msgCheckout('Indica a cuál(es) hechizo(s) se aplica: ' + it.nombre + '.'); return; }
      } else {
        if (!p.objetivo_nombre && !p.objetivo_fecha_nac && !p.foto_campo) {
          msgCheckout('Faltan los datos de la persona para: ' + it.nombre + '.'); return;
        }
        if (!contacto.trim()) { msgCheckout('Escribe tu WhatsApp o red social.'); return; }
      }
    }

    if (esTransfer) {
      var comp = document.getElementById('fc-comprobante');
      if (!comp || !comp.files || !comp.files.length) { msgCheckout('Sube el comprobante de tu pago.'); return; }
      fd.append('comprobante', comp.files[0]);
    }

    fd.append('items', JSON.stringify(itemsPayload));
    fd.append('cliente_nombre', clienteNombre.trim());
    fd.append('contacto', contacto.trim());
    fd.append('metodo', esTransfer ? 'transferencia' : 'wompi');

    btn.disabled = true;
    btn.textContent = 'Preparando…';
    mostrarRitual(
      esTransfer ? 'Recibiendo tu ofrenda' : 'Abriendo tu ritual',
      esTransfer
        ? 'Estamos registrando tu comprobante. En un instante verás el estado de tu consulta…'
        : 'Te llevamos a la pasarela de pago segura. No cierres esta ventana…'
    );

    fetch('/api/checkout', { method: 'POST', body: fd })
      .then(parseJson)
      .then(function (res) {
        if (!res.ok || !res.data.ok) throw new Error(res.data.error || 'No se pudo procesar el pedido.');
        // El carrito NO se vacía aquí: el pago aún no está confirmado. Si el pago
        // se rechaza o se abandona, el carrito debe seguir disponible para reintentar.
        // La página /pedido lo vacía solo cuando el pago queda confirmado/recibido.
        var destino = window.location.origin + '/pedido/' + encodeURIComponent(res.data.pedido_ref);
        if (esTransfer || !res.data.signature) {
          window.location.href = destino;
          return;
        }
        var centavos = res.data.total_cop * 100;
        var url = 'https://checkout.wompi.co/p/'
          + '?public-key=' + encodeURIComponent(WOMPI_PUBLIC_KEY)
          + '&currency=COP'
          + '&amount-in-cents=' + centavos
          + '&reference=' + encodeURIComponent(res.data.pedido_ref)
          + '&redirect-url=' + encodeURIComponent(destino)
          + '&signature:integrity=' + encodeURIComponent(res.data.signature);
        window.location.href = url;
      })
      .catch(function (e) {
        // Falló: quitamos el ritual y dejamos el checkout intacto para reintentar.
        ocultarRitual();
        btn.disabled = false;
        btn.textContent = textoBtn;
        msgCheckout(e.message || 'No se pudo procesar. Intenta de nuevo.');
      });
  }

  // Momento "ritual": capa inmersiva sobre el checkout mientras se confirma el
  // pago / se redirige a la pasarela. Se dibuja ENCIMA (no reemplaza) para que,
  // si algo falla, el formulario siga intacto. Respeta prefers-reduced-motion vía CSS.
  function mostrarRitual(titulo, sub) {
    ocultarRitual();
    var layer = document.createElement('div');
    layer.className = 'fc-ritual-layer';
    layer.id = 'fc-ritual-layer';
    layer.innerHTML =
      '<div class="fc-ritual">' +
      '<div class="fc-ritual-orb">🔮</div>' +
      '<div class="fc-ritual-tit">' + titulo + '</div>' +
      '<div class="fc-ritual-sub">' + sub + '</div>' +
      '<div class="fc-ritual-dots"><i></i><i></i><i></i></div>' +
      '</div>';
    document.body.appendChild(layer);
  }

  function ocultarRitual() {
    var el = document.getElementById('fc-ritual-layer');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ---------- Helpers de red ---------- */
  function parseJson(resp) {
    return resp.json().then(function (data) { return { ok: resp.ok, data: data || {} }; });
  }

  function cargarConfig() {
    try {
      fetch('/api/config').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cfg) {
          if (!cfg) return;
          if (cfg.wompiPublicKey) WOMPI_PUBLIC_KEY = cfg.wompiPublicKey;
          if (cfg.comision) COM = cfg.comision;
        }).catch(function () {});
    } catch (e) {}
  }

  function cargarSesion() {
    try {
      fetch('/api/cuenta').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.autenticado && data.cliente) {
            estado.cliente = { email: data.cliente.email, nombre: data.cliente.nombre };
            // El servidor es la fuente del carrito cuando hay sesión.
            if (Array.isArray(data.cliente.carrito) && data.cliente.carrito.length) {
              estado.items = data.cliente.carrito.map(sanitizar).filter(Boolean);
              guardarLocal();
            } else if (estado.items.length) {
              // Sube el carrito local (invitado) a la cuenta existente.
              sincronizarServidor();
            }
            render();
          }
        }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- Init ---------- */
  function init() {
    inyectarEstilos();
    construirWidget();
    cargarLocal();
    render();
    cargarConfig();
    cargarSesion();
  }

  window.FresaCart = { add: add, abrir: abrirPanel };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
