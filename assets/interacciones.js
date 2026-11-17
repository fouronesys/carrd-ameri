(function () {
  'use strict';
  if (!window.PointerEvent) return;
  var inicio = null;
  var selector = 'button, a[href], [role="button"], input[type="submit"], input[type="button"], input[type="reset"], summary';
  function boton(evento) {
    var el = evento.target.closest && evento.target.closest(selector);
    return el && !el.matches(':disabled') && !el.closest('[aria-disabled="true"], [inert]') ? el : null;
  }
  document.addEventListener('pointerdown', function (e) {
    inicio = e.pointerType === 'touch' && e.isPrimary !== false && boton(e)
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, el: boton(e) } : null;
  }, { passive: true, capture: true });
  document.addEventListener('pointercancel', function () { inicio = null; }, { passive: true });
  document.addEventListener('pointermove', function (e) {
    if (inicio && e.pointerId === inicio.id &&
        Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 12) inicio = null;
  }, { passive: true });
  document.addEventListener('pointerup', function (e) {
    var toque = inicio;
    inicio = null;
    if (!toque || e.pointerId !== toque.id || boton(e) !== toque.el ||
        Math.hypot(e.clientX - toque.x, e.clientY - toque.y) > 12) return;
    // Limitar efectos si se toca varias veces; ninguna referencia a datos del cliente.
    var anteriores = document.querySelectorAll('.fs-toque');
    if (anteriores.length >= 4) anteriores[0].remove();
    var efecto = document.createElement('span');
    efecto.className = 'fs-toque';
    efecto.setAttribute('aria-hidden', 'true');
    efecto.style.setProperty('--toque-x', e.clientX + 'px');
    efecto.style.setProperty('--toque-y', e.clientY + 'px');
    document.body.appendChild(efecto);
    window.setTimeout(function () { efecto.remove(); },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 450);
  }, { passive: true, capture: true });
})();
