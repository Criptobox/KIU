/*!
 * kiu-estados.js — UN SOLO controlador de estados del avatar (tanda 8 · v2.8.0).
 *
 * El problema que resuelve: hasta v2.7 el estado del bot salía de DOS lados a la vez.
 *   1) kiu-avatar-boot.js envolvía window.KiuBridge con un Proxy y ADIVINABA el
 *      estado mirando cada llamada al puente (kiuGen, kiuIsLoaded, kiuLoad, speak…).
 *   2) app-ui.js / motor.js / models.js llamaban KiuAvatar.set() directamente.
 * Los dos caminos se pisaban: "Cargado" en cada mensaje (ensureLoaded → kiuIsLoaded),
 * "Respuesta lista" a los 2,5 s de una generación que seguía escribiendo, timers
 * sueltos que nadie cancelaba y un estado de reposo que se quedaba viejo.
 *
 * Acá el estado se decide por CAPAS con prioridad, no por adivinar:
 *
 *   KiuState.set(capa, estado, ms?) → estado pegado de esa capa (lo manda quien causa
 *                                     la acción). Con ms, caduca sola: si el evento de
 *                                     fin nunca llega, el bot no se queda clavado.
 *   KiuState.flash(capa, estado, ms)→ aviso momentáneo; se va solo y vuelve al de más prioridad
 *   KiuState.clear(capa)            → saca el estado de esa capa
 *   KiuState.reset(base)            → vuelve al reposo (todo limpio salvo 'rest')
 *   KiuState.get()                  → el estado que se ve (el de mayor prioridad)
 *   KiuState.snapshot()             → qué hay puesto en cada capa (diagnóstico/tests)
 *   KiuState.on(fn)                 → avisar cuando cambia el estado visible
 *   KiuState.warn(estado, ms)       → atajo: un error en la capa 'err' (máxima prioridad)
 *
 * Regla: lo persistente manda (job / ruta / voz) y un flash SOLO se ve si no hay
 * nada de mayor prioridad activo. Por eso "Generando" ya no se pisa con
 * "Respuesta lista", y un flash de "Cargado" no puede interrumpir una descarga.
 *
 * Los eventos son EXPLÍCITOS: los emite quien causa la acción (Kiu.ask, Mod.start,
 * Alarms, el TTS…), nunca se deducen mirando el puente.
 */
(function (global) {
  'use strict';

  /* Prioridad por capa. Mayor número = gana. El orden refleja "qué le importa más
     al usuario que está mirando la pantalla":
       err   90  algo salió mal: no se tapa con nada
       job   70  trabajo pesado en curso (descargando / cargando / generando / importando)
       pausa 65  un proveedor falló y se aparta un momento
       ruta  60  Kiu está resolviendo a quién preguntarle
       voz   50  micrófono o TTS
       tool  35  acción en el teléfono / reglas offline
       flash 30  avisos momentáneos genéricos
       rag   25  documentos — abajo del aviso genérico a propósito: 'RAG apagado' es
                  un estado de reposo y si viviera más arriba taparía para siempre
                  los avisos ('Disparado', 'Respuesta lista', 'Entrada'…)
       rest  10  reposo y estado del motor (inactivo / sin modelo / sin motor)
     'pausa' va aparte de 'ruta' a propósito: si se anunciara como un flash de esa
     misma capa nunca se vería, porque 'Enrutando' (60) taparía al aviso (30) justo
     mientras Kiu está buscando a quién preguntarle, que es cuando pasa.
  */
  var PRIO = {
    err: 90, job: 70, pausa: 65, ruta: 60, voz: 50, tool: 35, flash: 30, rag: 25, rest: 10
  };

  /* Estado inicial de cada capa. Las que arrancan vacías solo se ven cuando algo
     las enciende; 'rest' siempre tiene algo (el avatar nunca queda en blanco). */
  var DEF = {
    err: null, job: null, pausa: null, ruta: null, voz: null, rag: null, tool: null,
    flash: null, rest: 'Inactivo'
  };

  var layers = {}, subs = [], last = null, seq = 0;
  for (var k in DEF) if (Object.prototype.hasOwnProperty.call(DEF, k)) layers[k] = { state: DEF[k], t: 0, until: 0 };

  function has(v) { return !!(v && typeof v === 'string' && v); }
  function known(layer) { return Object.prototype.hasOwnProperty.call(layers, layer); }
  /* una capa con 'until' vencido está libre aunque su setTimeout no haya corrido
     todavía (WebView en segundo plano, timers congelados): el estado se decide por
     reloj, no por confianza en el temporizador. */
  function alive(L) {
    if (!has(L.state)) return false;
    if (L.until && Date.now() >= L.until) { L.state = null; L.until = 0; return false; }
    return true;
  }

  /* El estado visible = el de mayor prioridad entre las capas con algo puesto.
     A igual prioridad gana el más reciente (el evento más nuevo). */
  function compute() {
    var bestState = null, bestP = -1, bestT = -1;
    for (var name in layers) {
      if (!known(name)) continue;
      var L = layers[name];
      if (!alive(L)) continue;
      var p = PRIO[name] || 0;
      if (p > bestP || (p === bestP && L.t >= bestT)) { bestState = L.state; bestP = p; bestT = L.t; }
    }
    return bestState || 'Inactivo';
  }

  function paint() {
    var st = compute();
    if (st === last) return st;
    last = st;
    try { if (global.KiuAvatar) global.KiuAvatar.set(st); } catch (e) { }
    for (var i = 0; i < subs.length; i++) { try { subs[i](st); } catch (e2) { } }
    return st;
  }

  /* set(capa, estado, ms?) — con ms la capa caduca sola. Sirve para las que se
     encienden junto a una operación asíncrona: si esa promesa nunca resuelve (un
     fetch colgado, un proveedor que no contesta), el estado se cae solo en vez de
     dejar al bot clavado para siempre. El temporizador es UNO, del controlador, y
     se cancela solo si la capa recibe otro evento: no es un timer suelto más. */
  function set(layer, state, ms) {
    if (!known(layer)) {
      /* Capa desconocida: se crea con la prioridad más baja para no romper nada
         (un typo no debe dejar el avatar sin estado). */
      layers[layer] = { state: null, t: 0, until: 0 };
      PRIO[layer] = 1;
    }
    var L = layers[layer];
    L.state = state || null;
    L.t = ++seq;
    L.until = (ms && state) ? Date.now() + Math.max(1000, ms) : 0;
    if (L.until) expireLater(L, L.until - Date.now());
    return paint();
  }

  function expireLater(L, ms) {
    setTimeout(function () {
      if (!L.until) return;                       /* ya lo apagó otro evento */
      if (Date.now() < L.until) { expireLater(L, L.until - Date.now()); return; }
      L.state = null; L.until = 0; paint();
    }, ms);
  }

  function clear(layer) { return set(layer, null); }

  function flash(layer, state, ms) {
    var ms2 = Math.max(300, ms || 1800);
    if (!known(layer)) { layers[layer] = { state: null, t: 0, until: 0 }; PRIO[layer] = 1; }
    var L = layers[layer];
    L.state = state || null;
    L.t = ++seq;
    L.until = Date.now() + ms2;
    paint();
    expireLater(L, ms2);
    return compute();
  }

  /* Vuelve al reposo: limpia todo menos el estado base (por defecto, Inactivo). */
  function reset(base) {
    for (var name in layers) {
      if (!known(name)) continue;
      layers[name].state = (name === 'rest') ? (base || 'Inactivo') : null;
      layers[name].t = ++seq;
      layers[name].until = 0;
    }
    last = null;
    return paint();
  }

  function get() { return compute(); }
  function layerState(name) { return layers[name] ? layers[name].state : null; }

  /* Para diagnóstico y tests: qué se ve y qué hay puesto en cada capa. */
  function snapshot() {
    var out = { visible: compute(), layers: {} };
    for (var name in layers) {
      if (!known(name)) continue;
      if (alive(layers[name])) out.layers[name] = layers[name].state;
    }
    return out;
  }

  function on(fn) {
    if (typeof fn !== 'function') return function () { };
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }

  /* Atajo para el caso "algo salió mal y hay que avisar", que usan casi todos
     los emisores: KiuState.warn('Error', 2500). */
  function warn(state, ms) { return flash('err', state, ms || 2500); }

  global.KiuState = {
    PRIO: PRIO,
    set: set, flash: flash, clear: clear, reset: reset,
    get: get, layer: layerState, snapshot: snapshot, on: on, warn: warn,
    /* nombres de capa, para no escribirlos a mano y que un typo no cree una capa nueva */
    L: { err: 'err', job: 'job', pausa: 'pausa', ruta: 'ruta', voz: 'voz', rag: 'rag', tool: 'tool', flash: 'flash', rest: 'rest' }
  };
})(window);
