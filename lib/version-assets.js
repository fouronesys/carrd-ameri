'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// URLs distintas por contenido: una actualización no reutiliza JS de otra versión.
function versionarScripts(html, root) {
  return html.replace(/src="(\/?assets\/[a-zA-Z0-9_.-]+\.js)(?:\?[^"]*)?"/g, (_, ruta) => {
    const bytes = fs.readFileSync(path.join(root, ruta.replace(/^\//, '')));
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    return 'src="/' + ruta.replace(/^\//, '') + '?v=' + hash + '"';
  });
}
module.exports = { versionarScripts };
