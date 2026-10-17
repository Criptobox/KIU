/* Kiu · diagnóstico de voz (v2.9.3)
   ------------------------------------------------------------------
   Existe por un reporte concreto: «el audio no funciona, no me reconoce la voz
   ni activa por reconocimiento de voz». Desde afuera son el mismo síntoma
   cuatro causas distintas:

     1 · el APK instalado es viejo y no tiene los arreglos de voz
     2 · no hay servicio de reconocimiento de voz en el sistema
     3 · no está el modelo local de la palabra de activación (40 MB, no va en
         el repo) → el camino local está muerto y no lo dice en ningún lado
     4 · falta el permiso de micrófono

   Las cuatro se ven IGUAL: silencio. Y el silencio no se puede depurar. Esto
   no adivina: lee el estado real de cadasubsistema y, cuando algo está mal,
   dice la grilla concreta en vez de un «algo anda mal».

   También resuelve el problema de la versión: el rótulo del perfil usaba una
   constante escrita a mano en app-ui.js ('Kiu v2.9.3'). Con un APK viejo, el
   rótulo mentía — o el JS era viejo y no decía nada. La versión sale ahora de
   PackageManager, o sea del paquete realmente instalado, y si el diagnóstico
   falla se muestra '?' en vez de inventar un número.

   Sin dependencias más que bridge(). Nada de DOM salvo el panel de salida. */
(function (root) {
  'use strict';
  var W = root.window || root;

  var KiuDiagVoz = {
    ver: null,      // versión real del paquete instalado
    verFlojo: false, // no se pudo leer: el rótulo tiene que mostrar '?', no mentir
    raw: null,      // el JSON crudo de kiuDiag(), para el detalle técnico
    mezclada: [],   // capacidades del puente que este código necesita y no están
  };

  /* Capacidades que este código de JS da por_existentes. Se prueban por
     llamada, no por versión: si el método no está en el puente, la instalación
     no trae esta tanda — y eso se dice con el nombre del método, que es
     accionable, en vez de con un número de versión que hay que ir a buscar. */
  var CAPACIDADES = [
    'kiuDiag',        // este mismo diagnóstico
    'kiuGenSetGrammar', // gramatica de muestreo, v2.9.3
    'kiuWWStart',     // palabra de activación local
  ];

  /* ---------- 1 · leer el estado real ---------- */

  /** Pide el diagnóstico al nativo y guarda la versión real. Devuelve la versión. */
  KiuDiagVoz.verReal = function (cb) {
    /* sonda de capacidades: qué métodos del puente NO existen. */
    KiuDiagVoz.mezclada = [];
    for (var i = 0; i < CAPACIDADES.length; i++) {
      var cap = CAPACIDADES[i];
      var hay = false;
      try {
        hay = (W.KiuBridge && typeof W.KiuBridge[cap] === 'function');
      } catch (e0) {
        hay = false;
      }
      if (!hay) KiuDiagVoz.mezclada.push(cap);
    }
    var d = null;
    try {
      d = JSON.parse(W.bridge('kiuDiag') || '{}');
    } catch (e) {
      d = null;
    }
    if (d && d.version) {
      KiuDiagVoz.raw = d;
      KiuDiagVoz.ver = d.version;
      KiuDiagVoz.verFlojo = false;
    } else {
      /* Sin dato: NO se cae a la constante de antes. '?' es la respuesta honesta;
         un número plausible escrito a mano es peor que una incógnita, porque
         hace creer que se sabe. */
      KiuDiagVoz.verFlojo = true;
      if (KiuDiagVoz.ver == null) KiuDiagVoz.ver = '?';
    }
    if (cb) { try { cb(KiuDiagVoz.ver); } catch (e2) { } }
    return KiuDiagVoz.ver;
  };

  /* ---------- 2 · traducir el estado a filas accionables ---------- */

  function fila(ok, titulo, detalle, grilla) {
    return { ok: ok, titulo: titulo, detalle: detalle || '', grilla: grilla || '' };
  }

  KiuDiagVoz.diagVoz = function () {
    var d = KiuDiagVoz.raw;
    if (!d) { KiuDiagVoz.verReal(); d = KiuDiagVoz.raw || {}; }
    var svcs = d.recogSvcs || [];
    var f = [];

    /* La versión NO se puede comparar con "la que debería": el JS y el nativo
       salen del mismo árbol de compilación, así que siempre coinciden y la
       comparación no puede fallar. Un número esperado hardcodeado en el JS
       sería exactamente el tipo de Mentira que substitutionsame esta tanda.

       Lo que SÍ se puede detectar, y es el caso real, es una instalación
       MEZCLADA: assets viejos con nativo nuevo (o al revés). Eso se reconoce por
       CAPACIDAD, no por número: el JS declara qué necesita del puente y lo
       prueba. Si al método no existe, la instalación no es la que este código
       espera — que es justo el síntoma de "me instala otra versión". */
    f.push(fila(!KiuDiagVoz.verFlojo && KiuDiagVoz.mezclada.length === 0, 'Versión instalada',
      'v' + (d.version || '?') + ' (código ' + (d.versionCode || 0) + ')',
      KiuDiagVoz.verFlojo
        ? 'No se pudo leer del paquete: puede ser un APK viejo o una instalación sin el puente'
        : (KiuDiagVoz.mezclada.length
          ? 'El código y el nativo no son del mismo build — falta: ' + KiuDiagVoz.mezclada.join(', ')
          : '')));

    f.push(fila(!!d.mic, 'Permiso de micrófono',
      d.mic ? 'Concedido' : 'Falta',
      d.mic ? '' : 'Android · Ajustes · Apps · Kiu · Permisos · Micrófono'));

    /* recogn=false y recogSvcs vacío NO son lo mismo que recogn=false con
       servicios listados: en el primer caso no hay nada instalado contra qué
       escuchar; en el segundo hay algo pero el sistema no lo expone. */
    f.push(fila(!!d.recogn && svcs.length > 0, 'Reconocimiento de voz',
      d.recogn
        ? (svcs.length + ' servicio(s): ' + svcs.join(', '))
        : 'isRecognitionAvailable() = false' + (svcs.length ? ' (hay ' + svcs.length + ' servicio(s) pero no se expone)' : ' (no hay ninguno instalado)'),
      d.recogn ? '' : 'Sin servicio de voz del sistema no hay contra qué escuchar la palabra de activación.'))

    f.push(fila(!!d.voskModel, 'Palabra de activación local (Vosk)',
      d.voskModel ? 'Modelo instalado (' + (d.voskSize || '?') + ')' : 'SIN MODELO — el camino local está muerto',
      d.voskModel ? '' : 'Son 40 MB y no van en el repo. Sin esto la palabra de activación solo puede usar el servicio del sistema, que necesita internet.'));

    f.push(fila(!!d.ttsReady, 'Voz de Kiu (TTS)',
      d.ttsReady
        ? ((d.ttsEngine || '?') + ' · ' + (d.ttsLang || '?'))
        : ('No arrancó' + (d.ttsErr ? ' — ' + d.ttsErr : '')),
      d.ttsReady
        ? ''
        : 'Sin motor de TTS, o el sistema lo tiene deshabilitado para esta app. Kiu responde escrito pero no habla: eso NO es lo mismo que "está pensando".'))

    return f;
  };

  /* ---------- 3 · render ---------- */

  KiuDiagVoz.render = function (box) {
    if (!box && W.document) box = W.document.getElementById('diag-voz-box');
    if (!box) return null;
    var filas = KiuDiagVoz.diagVoz();
    var malas = filas.filter(function (x) { return !x.ok; });
    var h = '<div style="margin:-6px 0 14px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--card)">';
    h += '<div style="font:600 13px var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--mut);margin-bottom:10px">Voz · ' +
      (malas.length ? malas.length + ' problema(s)' : 'todo bien') + '</div>';
    for (var i = 0; i < filas.length; i++) {
      var f = filas[i];
      h += '<div style="display:flex;gap:9px;padding:7px 0;border-top:' + (i ? '1px solid var(--line)' : 'none') + '">';
      h += '<span style="color:' + (f.ok ? 'var(--ok,#3fb950)' : 'var(--warn,#d29922)') + ';font-size:15px;line-height:1.35">' + (f.ok ? '&#10003;' : '!') + '</span>';
      h += '<div style="flex:1;min-width:0"><div style="font:500 13.5px/1.35 system-ui,sans-serif">' + f.titulo + '</div>';
      h += '<div style="font:400 12px/1.45 system-ui,sans-serif;color:var(--mut);word-break:break-word">' + f.detalle + '</div>';
      if (f.grilla) h += '<div style="font:400 11.5px/1.45 system-ui,sans-serif;color:var(--warn,#d29922);margin-top:3px">' + f.grilla + '</div>';
      h += '</div></div>';
    }
    /* el botón aparece SOLO cuando falta el modelo y se puede instalar desde acá:
       si ya está, un botón de «instalar» es ruido. */
    if (faltaElModelo(filas) && puedeInstalar()) {
      h += '<button class="btn-ghost full" id="btn-ww-install" style="justify-content:center;margin:10px 0 0">'
        + 'Bajar el modelo de voz (39 MB)</button>';
    }
    if (!malas.length) {
      h += '<div style="font:400 12px/1.5 system-ui,sans-serif;color:var(--mut);margin-top:10px">' +
        'Si sigue sin oírte, el detalle técnico está en logcat: <code>adb logcat | grep -i kiu</code>.</div>';
    }
    box.innerHTML = h + '</div>';
    return box;
  };

  function faltaElModelo(filas) {
    for (var i = 0; i < filas.length; i++) {
      if (filas[i].titulo.indexOf('Vosk') >= 0) { return !filas[i].ok; }
    }
    return false;
  }

  /* Se puede instalar solo si el puente trae el método. En el navegador no existe,
     y ahí el botón no debe aparecer: es mejor que no ofrezcas algo que no podés. */
  function puedeInstalar() {
    try { return !!(W.KiuBridge && typeof W.KiuBridge.wwInstall === 'function'); }
    catch (e) { return false; }
  }

  /* ---------- instalar el modelo de la palabra de activación ----------
     v2.9.7. Son 39 MB y no van en el repo, así que hasta ahora la única forma de
     tenerlos era saber el comando de adb. Acá se bajan desde la app.

     El flujo tiene tres etapas porque son tres estados distintos, y cada una puede
     fallar por su cuenta: la descarga (red, espacio, verificación del SHA), la
     descompresión (el archivo bajó corrupto) y la comprobación final de que el
     modelo quedó donde el motor lo busca.

     Esa última es la que importa: el zip oficial trae el modelo dentro de
     `vosk-model-small-es-0.42/`, y descomprimirlo sin quitar esa carpeta deja el
     modelo un nivel más abajo de donde `modelPresent()` lo mira. El síntoma es el
     peor: 60 MB en disco y la app diciendo «falta el modelo» para siempre. */
  KiuDiagVoz.instalando = null;     // id del job de descarga o de extracción

  KiuDiagVoz.puedeInstalar = function () {
    try { return !!rawBridge('wwInstall'); } catch (e) { return false; }
  };

  KiuDiagVoz.instalar = function (cb) {
    if (KiuDiagVoz.instalando) { App.toast('Ya está bajando el modelo…'); return; }
    var r;
    try {
      r = JSON.parse(rawBridge('wwInstall') || '{}');
    } catch (e) {
      App.toast('No se puede instalar desde la app del navegador');
      return;
    }
    if (r.st === 'done' && r.present) {
      App.toast('El modelo ya estaba instalado ✓');
      W.verReal();
      if (cb) cb(true);
      return;
    }
    if (r.st === 'error') {
      App.toast('No pude empezar la descarga: ' + (r.err || 'sin motivo'));
      return;
    }
    if (!r.id) {
      App.toast('No hay motor de descargas en esta instalación');
      return;
    }
    KiuDiagVoz.instalando = { id: r.id, fase: 'descargando' };
    App.toast('Bajando el modelo de voz (39 MB)…');
    KiuDiagVoz.sigueDescarga(cb);
  };

  KiuDiagVoz.sigueDescarga = function (cb) {
    setTimeout(function () {
      if (!KiuDiagVoz.instalando) { return; }
      var st = {};
      try { st = JSON.parse(rawBridge('dlStatus', [KiuDiagVoz.instalando.id]) || '{}'); } catch (e) { }
      if (st.st === 'done') {
        var path = st.path || '';
        KiuDiagVoz.extrae(path, cb);
        return;
      }
      if (st.st === 'error' || st.st === 'cancelled') {
        KiuDiagVoz.instalando = null;
        App.toast('Falló la descarga: ' + (st.err || 'sin motivo'));
        return;
      }
      KiuDiagVoz.sigueDescarga(cb);
    }, 900);
  };

  KiuDiagVoz.extrae = function (zipPath, cb) {
    var r = {};
    try { r = JSON.parse(rawBridge('wwUnzip', [zipPath]) || '{}'); } catch (e) { }
    if (r.st === 'error' || !r.id) {
      KiuDiagVoz.instalando = null;
      App.toast('No pude descomprimir: ' + (r.err || 'el zip no llegó bien'));
      return;
    }
    KiuDiagVoz.instalando = { id: r.id, fase: 'descomprimiendo' };
    App.toast('Instalando el modelo…');
    var t = setInterval(function () {
      var st = {};
      try { st = JSON.parse(rawBridge('wwUnzipStatus', [KiuDiagVoz.instalando.id]) || '{}'); } catch (e) { }
      if (st.st === 'done') {
        clearInterval(t);
        KiuDiagVoz.instalando = null;
        W.verReal();
        App.toast('Listo: Kiu ya te escucha sin internet ✓');
        if (cb) cb(true);
      } else if (st.st === 'error') {
        clearInterval(t);
        KiuDiagVoz.instalando = null;
        App.toast('Falló la instalación: ' + (st.err || 'sin motivo'));
        if (cb) cb(false);
      }
    }, 600);
  };

  W.KiuDiagVoz = KiuDiagVoz;
  if (typeof module !== 'undefined' && module.exports) module.exports = KiuDiagVoz;
})(typeof window !== 'undefined' ? window : globalThis);
