/* ========= Kiu SafeBoot: captor global de errores (visible, no silencioso) =========
   Si algo falla al arrancar, en vez de una pantalla negra se muestra el motivo
   exacto + un boton para reparar. 100% ES5 para WebViews viejos. */
(function () {
  var BOOT_MS = 8000;
  /* Migas de contexto: ayudan a diagnosticar aun cuando Chromium oculta el error */
  window.kiuBc = [];
  window.kiuBread = function (m) {
    try { window.kiuBc.push(String(m).slice(0, 90)); if (window.kiuBc.length > 6) window.kiuBc.shift(); } catch (e) { }
  };
  function save(msg) {
    try { localStorage.setItem('nexo_lasterr', JSON.stringify({ t: Date.now(), m: String(msg).slice(0, 600) })); } catch (e) { }
  }
  function show(msg) {
    try {
      save(msg);
      var old = document.getElementById('kiu-errbox'); if (old) old.parentNode.removeChild(old);
      var d = document.createElement('div');
      d.id = 'kiu-errbox';
      d.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;top:0;z-index:99999;background:#1a0b10;color:#ffb4c0;padding:18px;overflow:auto;font:13px/1.5 monospace;-webkit-user-select:text;user-select:text;');
      var h = document.createElement('div');
      h.setAttribute('style', 'font:bold 16px sans-serif;color:#fff;margin-bottom:10px');
      h.appendChild(document.createTextNode('Kiu \u2014 error detectado'));
      var p = document.createElement('div');
      p.setAttribute('style', 'white-space:pre-wrap;word-break:break-word;margin-bottom:14px');
      p.appendChild(document.createTextNode(String(msg)));
      var b1 = document.createElement('button');
      b1.setAttribute('style', 'display:block;width:100%;margin:6px 0;padding:12px;border:0;border-radius:12px;background:#14b8a6;color:#04211f;font:bold 15px sans-serif');
      b1.appendChild(document.createTextNode('Reiniciar interfaz (conservar datos)'));
      b1.onclick = function () { try { localStorage.removeItem('nexo_lasterr'); } catch (e) { } location.reload(); };
      var b2 = document.createElement('button');
      b2.setAttribute('style', 'display:block;width:100%;margin:6px 0;padding:12px;border:0;border-radius:12px;background:#3b2530;color:#ffb4c0;font:14px sans-serif');
      b2.appendChild(document.createTextNode('Cerrar y seguir igual'));
      b2.onclick = function () { if (d.parentNode) d.parentNode.removeChild(d); };
      d.appendChild(h); d.appendChild(p); d.appendChild(b1); d.appendChild(b2);
      (document.body || document.documentElement).appendChild(d);
    } catch (e) { }
  }
  function onErr(msg, src, line, col, err) {
    var where = '';
    try { where = String(src || '').split('/').pop() + ':' + line + (col ? ':' + col : ''); } catch (e) { }
    var detail = (err && err.stack) ? String(err.stack).slice(0, 400) : '';
    var crumbs = '';
    try { if (window.kiuBc && window.kiuBc.length) crumbs = '\nHaciendo: ' + window.kiuBc.join(' | '); } catch (e) { }
    show(msg + (where ? '\nEn: ' + where : '') + (detail ? '\n' + detail : '') + crumbs);
    return false;
  }
  window.onerror = onErr;
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target.tagName && !e.message) return; /* recursos */
    onErr(e.message, e.filename, e.lineno, e.colno, e.error);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; show('Promise sin capturar: ' + ((r && r.message) ? r.message : r));
  });
  window.kiuShowError = show;
  /* Vigilante de arranque: si app.js no avisa en BOOT_MS, mostrar aviso */
  setTimeout(function () {
    if (!window.__kiuBooted) {
      var last = '';
      try { var raw = localStorage.getItem('nexo_lasterr'); if (raw) last = (JSON.parse(raw) || {}).m || ''; } catch (e) { }
      show('La interfaz no termin\u00f3 de arrancar en ' + (BOOT_MS / 1000) + ' s.' + (last ? '\n\u00datltimo error registrado:\n' + last : '\nPosible WebView del sistema muy antiguo o datos da\u00f1ados.\nUs\u00e1 \u00abBorrar datos y reiniciar\u00bb abajo.'));
    }
  }, BOOT_MS);
})();
