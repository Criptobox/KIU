/* kiu-autoprueba.js — v2.19.0: "¿el modelo que tengo CARGADO en este teléfono sirve de agente?"
 *
 * El arnés de tests/evals necesita una PC con llama-server. Esto es lo mismo pero DENTRO de la
 * app: corre pedidos reales contra el modelo del teléfono, mismo prompt y misma gramática que el
 * agente de verdad, y cuenta aciertos y tiempo. No ejecuta ninguna herramienta (solo mira qué
 * elegiría), así que no suena ninguna alarma ni se manda ningún mensaje.
 *
 * Los casos son un subconjunto de tests/evals/escenarios.mjs; un test comprueba que no se
 * desincronicen (misma herramienta y mismos argumentos esperados).
 *
 * node --check js/kiu-autoprueba.js
 */
window.KiuAutoprueba = (function () {
  'use strict';

  var KEY = 'kiu_autoprueba';
  var MIGAS = 'kiu_autoprueba_migas';   /* rastro para saber DÓNDE murió la app si el sistema la mata */
  var UMBRAL_BIEN = 0.8;     /* mismo umbral que el arnés de la PC */
  var UMBRAL_REGULAR = 0.5;

  /* tool: herramienta esperada · acepta: otras válidas · args: valor exacto o {re:'regex'} */
  var CASOS = [
    { pedido: 'poné una alarma a las 7 y media', tool: 'set_alarm', args: { when: { re: '7' } }, rapido: 1 },
    { pedido: 'qué alarmas tengo programadas', tool: 'manage_alarm', args: { action: 'list' } },
    { pedido: 'acordate de que el dentista es el martes', tool: 'remember' },
    { pedido: '¿cuándo era el dentista?', tool: 'recall', args: { query: { re: 'dentista' } }, rapido: 1 },
    { pedido: 'agregá una tarea: comprar pan', tool: 'manage_task', args: { action: 'add', text: { re: 'pan' } }, rapido: 1 },
    { pedido: 'qué tareas tengo pendientes', tool: 'manage_task', args: { action: 'list' } },
    { pedido: 'qué tengo mañana', tool: 'read_calendar', rapido: 1 },
    { pedido: '¿cuál es el número de Ana?', tool: 'find_contact', args: { name: { re: 'ana', i: 1 } } },
    { pedido: 'llamá a mamá', tool: 'call_contact' },
    { pedido: 'mandale un whatsapp a Juan diciendo ya llegué', tool: 'send_message', args: { text: { re: 'llegu' } } },
    { pedido: 'encendé la linterna', tool: 'device_action', args: { what: 'linterna' }, rapido: 1 },
    { pedido: 'llévame al aeropuerto', tool: 'device_action', args: { what: 'maps' } },
    { pedido: 'qué hora es', tool: 'now' },
    { pedido: 'buscá el precio del dólar hoy', tool: 'web_search' },
    { pedido: 'qué tiempo hace en Córdoba', tool: 'get_weather', args: { place: { re: 'c[oó]rdoba', i: 1 } }, rapido: 1 },
    { pedido: 'resumí esta página https://example.com/nota', tool: 'summarize_url', args: { url: { re: 'example\\.com' } } },
    { pedido: 'gasté 12 en almuerzo', tool: 'log_expense', args: { action: 'add' }, rapido: 1 },
    { pedido: 'buen día, qué tengo hoy', tool: 'daily_briefing' },
    { pedido: 'qué notificaciones me llegaron', tool: 'read_notifications' },
    { pedido: 'pausá la música', tool: 'media_control', args: { action: 'pause' } },
    { pedido: 'todos los días a las 8 dame el resumen', tool: 'manage_routine', args: { action: 'add', at: { re: '8' } } },
    /* v2.21.0 · rutinas por voz (solo en la prueba completa) */
    { pedido: 'pausá la rutina del resumen', tool: 'manage_routine', args: { action: 'pause' } },
    { pedido: 'reanudá la rutina del resumen', tool: 'manage_routine', args: { action: 'resume' } },
    { pedido: 'cambiá la rutina del resumen a las 9', tool: 'manage_routine', args: { action: 'edit', at: { re: '9' } } }
  ];

  /* v2.20.0 · PEDIDOS COMPUESTOS (solo en la prueba completa). Dos partes, en cualquier orden:
     la 1.ª decisión tiene que ser una de las dos; la 2.ª, con la 1.ª ya hecha, la otra (no "listo"). */
  var COMPUESTOS = [
    { pedido: 'poné una alarma a las 7 y decime qué tiempo hace en Córdoba', partes: [{ tool: 'set_alarm', args: { when: { re: '7' } } }, { tool: 'get_weather' }] },
    { pedido: 'agregá una tarea: comprar pan, y anotá que el dentista es el martes', partes: [{ tool: 'manage_task', args: { action: 'add', text: { re: 'pan' } } }, { tool: 'remember' }] },
    { pedido: 'encendé la linterna y pausá la música', partes: [{ tool: 'device_action', args: { what: 'linterna' } }, { tool: 'media_control' }] }   /* sin args: play y pause son lo mismo (alternan) */
  ];

  function coincide(valor, esperado) {
    if (esperado && typeof esperado === 'object' && esperado.re) {
      return new RegExp(esperado.re, esperado.i ? 'i' : '').test(String(valor == null ? '' : valor));
    }
    return String(valor) === String(esperado);
  }
  /* ¿esta decisión del modelo es la correcta para el caso? → {ok, motivo} */
  function evaluar(caso, dec) {
    if (!dec || !dec.ok) return { ok: false, motivo: 'el motor no respondió' + (dec && dec.err ? ' (' + dec.err + ')' : '') };
    if (!dec.tool) return { ok: false, motivo: dec.listo ? 'dijo "listo" sin hacer nada' : 'no devolvió una herramienta válida' };
    var buenas = [caso.tool].concat(caso.acepta || []);
    if (buenas.indexOf(dec.tool) < 0) return { ok: false, motivo: 'eligió ' + dec.tool };
    var esp = caso.args || {};
    for (var k in esp) {
      if (Object.prototype.hasOwnProperty.call(esp, k) && !coincide(dec.args ? dec.args[k] : undefined, esp[k])) {
        return { ok: false, motivo: 'eligió ' + dec.tool + ' pero con ' + k + ' = «' + String(dec.args && dec.args[k] != null ? dec.args[k] : '') + '»' };
      }
    }
    if (!dec.valida) return { ok: false, motivo: 'los argumentos no pasan la validación' };
    return { ok: true, motivo: '' };
  }

  /* v2.19.4: ms = segundos por decisión en ms (opcional). Un modelo que acierta pero tarda más de
     LENTO_MS no "sirve" sin reservas: con Qwen3-8B el teléfono daba 100 % a 43 s por decisión. */
  var LENTO_MS = 15000;
  function veredicto(acierto, ms) {
    if (acierto >= UMBRAL_BIEN && ms > LENTO_MS) return { nivel: 'bien', lento: true, texto: 'Acierta, pero es lento (' + Math.round(ms / 1000) + ' s por decisión): se nota la espera. Probá un modelo más chico si querés respuestas ágiles.' };
    if (acierto >= UMBRAL_BIEN) return { nivel: 'bien', texto: 'Este modelo sirve como agente en tu teléfono.' };
    if (acierto >= UMBRAL_REGULAR) return { nivel: 'regular', texto: 'Anda a medias: se equivoca seguido. Probá un modelo más grande, o usalo solo para órdenes simples.' };
    return { nivel: 'mal', texto: 'Este modelo es demasiado chico para elegir herramientas. Probá uno más grande (1,5 B o más).' };
  }

  function guardar(res) {
    try {
      var m = JSON.parse(localStorage.getItem(KEY) || '{}');
      m[res.modelo] = { acierto: res.acierto, total: res.total, ms: res.msPromedio, tps: res.tps, preMs: res.preMs, genTps: res.genTps, nivel: res.nivel, at: Date.now() };
      localStorage.setItem(KEY, JSON.stringify(m));
    } catch (e) { }
  }
  function ultima(modelo) {
    try { return (JSON.parse(localStorage.getItem(KEY) || '{}'))[modelo] || null; } catch (e) { return null; }
  }

  /* Si Android mata la app en medio de la prueba, JS no puede avisar. Por eso antes de CADA
     pedido se deja una miga en localStorage y se borra al terminar; al próximo arranque,
     migasPendientes() dice en qué pedido, con qué modelo y con o sin gramática se cayó. */
  function miga(m) { try { if (m) localStorage.setItem(MIGAS, JSON.stringify(m)); else localStorage.removeItem(MIGAS); } catch (e) { } }
  function migasPendientes() {
    try { var m = JSON.parse(localStorage.getItem(MIGAS) || 'null'); return m && m.pedido ? m : null; } catch (e) { return null; }
  }
  function limpiarMigas() { miga(null); }
  function ramLibreMB() {
    try { var d = JSON.parse(window.rawBridge('sysInfo') || '{}'); return typeof d.ramAvail === 'number' ? Math.round(d.ramAvail / 1048576) : null; } catch (e) { return null; }
  }

  function compuesto(caso, opcs, vista, fin) {
    var A = window.KiuAgente, P = caso.partes;
    A.probarDecision(caso.pedido, function (d1) {
      vista(d1);
      var i1 = -1;
      for (var k = 0; k < P.length; k++) if (evaluar(P[k], d1).ok) { i1 = k; break; }
      if (i1 < 0) {
        var e1 = evaluar(P[0], d1);
        var m = d1 && d1.tool && (d1.tool === P[1].tool) ? evaluar(P[1], d1).motivo : e1.motivo;
        fin({ ok: false, motivo: '1.ª parte: ' + (m || 'eligió ' + (d1 && d1.tool)) }, d1 && d1.ms || 0);
        return;
      }
      var otra = P[1 - i1];
      var hecha = '[' + P[i1].tool + ' ok] Listo.';
      /* v2.20.7: igual que el agente: si se sabe qué parte falta, solo se ofrece esa herramienta y no se admite «listo» */
      var forz = null;
      try { forz = A.faltaParte ? A.faltaParte(caso.pedido, [P[i1].tool]) : null; } catch (eF) { forz = null; }
      A.probarDecision(caso.pedido, function (d2) {
        vista(d2);
        var ms = (d1.ms || 0) + (d2 && d2.ms || 0);
        /* v2.20.6 · lo mismo que hace el agente de verdad: un «listo» con una parte sin hacer se rechaza UNA vez y se vuelve a preguntar */
        if (d2 && d2.ok && !d2.tool && d2.listo) {
          var falta = null;
          try { falta = A.faltaParte ? A.faltaParte(caso.pedido, [P[i1].tool]) : null; } catch (e) { falta = null; }
          if (falta) {
            A.probarDecision(caso.pedido, function (d3) {
              vista(d3);
              var ms3 = ms + (d3 && d3.ms || 0);
              var e3 = evaluar(otra, d3);
              fin(e3.ok ? { ok: true, motivo: '' } : { ok: false, motivo: '2.ª parte (tras avisarle que faltaba): ' + (d3 && d3.listo ? 'volvió a decir "listo" sin hacer ' + otra.tool : e3.motivo) }, ms3);
            }, { sinGramatica: opcs.sinGramatica, obs: [hecha, 'Falta otra parte del pedido: usá ' + falta + '.'] });
            return;
          }
          fin({ ok: false, motivo: '2.ª parte: dijo "listo" sin hacer ' + otra.tool }, ms); return;
        }
        var e2 = evaluar(otra, d2);
        fin(e2.ok ? { ok: true, motivo: '' } : { ok: false, motivo: '2.ª parte: ' + e2.motivo }, ms);
      }, { sinGramatica: opcs.sinGramatica, obs: [hecha], forzar: forz || undefined });
    }, opcs);
  }

  /* opts: {completa:bool, sinGramatica:bool, progreso:fn(i, n, caso), cancelar:fn()->bool}
     cb({ok, modelo, total, aciertos, acierto, msPromedio, tps, fallos:[{pedido, motivo}], nivel, texto}) */
  function correr(opts, cb) {
    var o = opts || {};
    var A = window.KiuAgente;
    var K = window.Kiu;
    var cargado = !!(window.S && window.S.kiu && window.S.kiu.ok);
    if (!A || typeof A.probarDecision !== 'function' || !K) { cb({ ok: false, err: 'el agente no está disponible' }); return; }
    if (!cargado) { cb({ ok: false, err: 'cargá un modelo primero (Ajustes → Modelos)' }); return; }
    var casos = CASOS.filter(function (c) { return o.completa || c.rapido; }).concat(o.completa ? COMPUESTOS : []);
    var filas = [], i = 0, tpsSum = 0, tpsN = 0;
    /* v2.20.8: aparte de los tok/s de siempre (que mezclan leer el prompt con generar), lo que tarda en leer el pedido y la velocidad de generación */
    var preSum = 0, preN = 0, genSum = 0, genN = 0;
    function medir(dec) {
      if (!dec) return;
      if (dec.tps) { tpsSum += dec.tps; tpsN++; }
      if (typeof dec.preMs === 'number' && dec.preMs > 0) { preSum += dec.preMs; preN++; }
      if (typeof dec.genTps === 'number' && dec.genTps > 0) { genSum += dec.genTps; genN++; }
    }
    (function sig() {
      if ((typeof o.cancelar === 'function' && o.cancelar()) || i >= casos.length) { fin(); return; }
      var caso = casos[i];
      try { if (typeof o.progreso === 'function') o.progreso(i, casos.length, caso); } catch (e) { }
      miga({ pedido: caso.pedido, n: i + 1, de: casos.length, modelo: String(window.S.kiu.name || ''), gram: !o.sinGramatica, ramMB: ramLibreMB(), at: Date.now() });
      var opcs = { sinGramatica: !!o.sinGramatica };
      function listo(ev, ms) { filas.push({ pedido: caso.pedido, ok: ev.ok, motivo: ev.motivo, ms: ms }); i++; sig(); }
      if (caso.partes) { compuesto(caso, opcs, function (dec) { medir(dec); }, listo); return; }
      A.probarDecision(caso.pedido, function (dec) {
        var ev = evaluar(caso, dec);
        medir(dec);
        listo(ev, dec && dec.ms || 0);
      }, opcs);
    })();
    function fin() {
      miga(null);   /* terminó (bien o cancelada): no murió */
      var hechos = filas.length;
      var aciertos = filas.filter(function (f) { return f.ok; }).length;
      var acierto = hechos ? aciertos / hechos : 0;
      var msProm = hechos ? Math.round(filas.reduce(function (a, f) { return a + f.ms; }, 0) / hechos) : 0;
      var v = veredicto(acierto, msProm);
      var res = {
        ok: hechos > 0, modelo: String(window.S.kiu.name || ''), total: hechos, aciertos: aciertos, acierto: acierto,
        msPromedio: hechos ? Math.round(filas.reduce(function (a, f) { return a + f.ms; }, 0) / hechos) : 0,
        tps: tpsN ? tpsSum / tpsN : 0,
        preMs: preN ? Math.round(preSum / preN) : 0,
        genTps: genN ? genSum / genN : 0,
        fallos: filas.filter(function (f) { return !f.ok; }).map(function (f) { return { pedido: f.pedido, motivo: f.motivo }; }),
        nivel: v.nivel, texto: v.texto, parcial: hechos < casos.length, sinGramatica: !!o.sinGramatica
      };
      if (res.ok && !res.parcial) guardar(res);
      cb(res);
    }
  }

  return { migasPendientes: migasPendientes, limpiarMigas: limpiarMigas, CASOS: CASOS, COMPUESTOS: COMPUESTOS, correr: correr, evaluar: evaluar, veredicto: veredicto, ultima: ultima, UMBRAL_BIEN: UMBRAL_BIEN, LENTO_MS: LENTO_MS };
})();
