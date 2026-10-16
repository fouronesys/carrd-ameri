'use strict';

// Una sola ejecución por instancia; otras instancias consumen filas distintas
// gracias a SKIP LOCKED. El límite permite apagar sin drenar toda la cola.
function crearColaAvisos(db, mailer) {
  let enCurso = null;
  let detenida = false;
  let intervalo = null;
  function despertar() {
    if (detenida) return Promise.resolve();
    if (enCurso) return enCurso;
    enCurso = (async () => {
      for (let i = 0; i < 20 && !detenida; i++) {
        const procesado = await db.procesarSiguienteAvisoRealizado(
          (reg, to, messageId) => mailer.enviarEstadoCliente('realizado', reg, to, { messageId })
        );
        if (!procesado) break;
      }
    })().catch(e => console.error('[avisos] No se pudo procesar la cola:', e.message))
      .finally(() => { enCurso = null; });
    return enCurso;
  }
  return {
    despertar,
    iniciar() {
      if (intervalo || detenida) return;
      intervalo = setInterval(despertar, 5000);
      intervalo.unref();
      despertar();
    },
    async detener() {
      detenida = true;
      clearInterval(intervalo);
      await enCurso;
    },
  };
}

module.exports = { crearColaAvisos };
