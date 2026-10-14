/*!
 * kiu-avatar-boot.js — inicialización ÚNICA del avatar de Kiu (tanda 8 · v2.7.0).
 *
 * Consolida lo que antes estaba repartido entre avatar.js (bot viejo de 13
 * estados, ELIMINADO) y este boot: ahora hay UN solo avatar (kiu-avatar.js,
 * 37 estados) y UNA sola forma de arrancarlo:
 *
 *   index.html:
 *     <script src="js/kiu-avatar.js"></script>
 *     <script src="js/kiu-avatar-boot.js"></script>
 *
 * 1) Monta el bot en TODOS los [data-avatar] (hero, chat, perfil) y en los
 *    mini-bots [data-avatar-mini] (esquina del home, bloque Acerca de) con
 *    tamaño fijo. Nada de adivinar layouts ajenos: el HTML declara los huecos.
 * 2) Envuelve window.KiuBridge con un Proxy para cambiar de estado según lo
 *    que hace la app (escuchar, hablar, wake word, generar, descargar, cargar
 *    modelo, alarmas, temporizadores, acciones del dispositivo...).
 * 3) Reajusta el tamaño de cada bot cuando su hueco cambia (pantalla que se
 *    abre, giro del teléfono...).
 * Uso manual: KiuAvatarBoot.set('Sin modelo') / .hold('Generando') / .flash('Error',3000).
 */
(function () {
  'use strict';

  function log() { try { console.log.apply(console, ['[kiu-avatar]'].concat([].slice.call(arguments))); } catch (e) { } }

  /* set/flash/hold/reset → API global del avatar nuevo (repinta TODOS los bots
     y usa UN solo temporizador de retorno, sin pisarse con la app) */
  function set(s) { if (window.KiuAvatar) KiuAvatar.set(s); }
  function flash(s, ms) { if (window.KiuAvatar) KiuAvatar.flash(s, ms); }
  function hold(s) { if (window.KiuAvatar) KiuAvatar.hold(s); }
  function reset() { if (window.KiuAvatar) KiuAvatar.reset(); }

  /* ---------- 1) montaje: solo huecos declarados por el HTML ---------- */
  function mountMinis() {
    if (typeof KiuAvatar === 'undefined') return 0;
    var els = document.querySelectorAll('[data-avatar-mini]'), n = 0;
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-kiu-mounted')) { n++; continue; }
      var sz = (els[i].id === 'about-avatar') ? 42 : 36;
      try { KiuAvatar.mount(els[i], { size: sz }); n++; } catch (e) { log('mini no montada', els[i].id || i, e.message); }
    }
    return n;
  }
  function mountAll() {
    if (typeof KiuAvatar === 'undefined') return false;
    mountMinis();
    var hosts = document.querySelectorAll('[data-avatar]'), n = 0;
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].getAttribute('data-kiu-mounted')) { n++; continue; }
      try { KiuAvatar.mount(hosts[i], {}); n++; } catch (e) { log('no pude montar en', hosts[i].id || i, e.message); }
    }
    if (n) log('bot montado en', n, 'hueco(s) [data-avatar]/[data-avatar-mini]');
    return n > 0;
  }

  /* Reajusta tamaños cuando el host cambia de dimensión (pantalla que se abre,
     giro del teléfono...). Barato: son 2-3 bots. */
  function refit() {
    if (typeof KiuAvatar === 'undefined' || !KiuAvatar.mounted) return;
    var ds = KiuAvatar.mounted();
    for (var i = 0; i < ds.length; i++) {
      var h = ds[i].host; if (!document.contains(h)) continue;
      var r = h.getBoundingClientRect();
      if (!(r && r.width >= 24 && r.height >= 24)) continue;
      var s = Math.round(Math.min(r.width, r.height) * 0.95);
      if (s >= 40 && Math.abs(s - (h.__kiuSize || 0)) > 6) ds[i].av.resize(s);
    }
  }

  /* ---------- 2) estados según lo que hace la app (puente) ---------- */
  var genOn = 0, lastPoll = 0, lastKey = '';
  function once(key, s, ms) { if (lastKey !== key) { lastKey = key; flash(s, ms); } }
  function parse(r) { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { return null; } }
  function finishGen() { genOn = 0; hold('Inactivo'); flash('Respuesta lista', 2500); }
  setInterval(function () { if (genOn && Date.now() - lastPoll > 2500) finishGen(); }, 500);
  var ACTIONS = /^(dial|sms|waChat|email|maps|ytSearch|webSearch|camera|torch|share|openUrl|openApp|openSettings|setAlarmDevice|setTimerDevice)$/;

  function onCall(p, a, r) {
    if (ACTIONS.test(p)) return flash('Acción del dispositivo', 2200);
    switch (p) {
      case 'listen': return flash('Escuchando', 9000);
      case 'cancelListen': case 'stopSpeak': return reset();
      case 'speak': return flash('Hablando', Math.max(1800, Math.min(25000, String(a[0] || '').length * 65)));
      case 'startWake': return hold('Palabra de activación');
      case 'stopWake': return reset();
      case 'setHandsFree': return (a[0] === true || a[0] === 'true') ? hold('Manos libres') : reset();
      case 'kiuGen': genOn = 1; lastPoll = Date.now(); return hold('Generando');
      case 'kiuGenStatus':
        if (genOn) { lastPoll = Date.now(); var o = parse(r);
          if (o && (o.done || o.finished || o.st === 'done' || o.st === 'idle' || o.running === false)) finishGen(); }
        return;
      case 'kiuGenStop': genOn = 0; hold('Inactivo'); return flash('Detenido', 1500);
      case 'kiuResetBusy': return flash('Ocupado', 2000);
      case 'kiuLoad': var lt = setTimeout(function () { hold('Inactivo'); }, 90000); return hold('Cargando');
      case 'kiuLoadProgress': { var q = parse(r); var pr = q && typeof q === 'object' ? (q.p || q.progress || q.pct) : q;
        if (Number(pr) >= 100 || (q && q.done)) { hold('Inactivo'); flash('Cargado', 2500); } return; }
      case 'kiuIsLoaded': if (r === true || r === 'true') { hold('Inactivo'); flash('Cargado', 2500); } return;
      case 'kiuFree': return flash('Liberado', 2200);
      case 'kiuAvailable': if (r === false || r === 'false') hold('Motor no soportado'); return;
      case 'dlStart': lastKey = ''; return hold('Descargando');
      case 'dlStatus': { var d = parse(r), st = d && String(d.st || '');
        if (d && d.err) return once('dle', 'Error de descarga', 3500);
        if (/err|fail/i.test(st)) return once('dle', 'Error de descarga', 3500);
        if (/done|ok|complete|finish/i.test(st)) return once('dld', 'Descargado', 3000);
        return; }
      case 'dlCancel': return reset();
      case 'importModel': lastKey = ''; return hold('Importando');
      case 'impStatus': { var m = parse(r), s = m && m.st;
        if (s === 'done') return once('imd', 'Descargado', 3000);
        if (s === 'err') return once('ime', 'Error de descarga', 3500);
        return; }
      case 'setReminder': return flash('Programado', 2500);
      case 'cancelReminder': case 'cancelTimerNative': return flash('Cancelado', 2200);
      case 'startTimerNative': return flash('Temporizador nativo', 4000);
      case 'canExactAlarms': if (r === false || r === 'false') flash('Sin permiso de alarma exacta', 3500); return;
    }
  }
  function wire() {
    var B = window.KiuBridge; if (!B || B.__kiuWired) return !!(B && B.__kiuWired);
    try {
      var P = new Proxy(B, { get: function (t, p) { var v = t[p]; if (p === '__kiuWired') return true; if (typeof v !== 'function') return v;
        return function () { var r = v.apply(t, arguments); try { onCall(String(p), arguments, r); } catch (e) { } return r; }; } });
      window.KiuBridge = P; log('KiuBridge enganchado'); return true;
    } catch (e) { log('no pude envolver KiuBridge:', e.message); return false; }
  }
  /* escribir en el cuadro de texto */
  document.addEventListener('input', function (e) { var t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search|)$/i.test(t.type)))) flash('Entrada', 1800); }, true);

  /* ---------- 3) arranque ---------- */
  function start() {
    mountAll();
    setTimeout(mountAll, 800);   /* por si algún módulo tardó en pintar su hueco */
    setTimeout(refit, 900); setTimeout(refit, 2500);
    window.addEventListener('resize', function () { clearTimeout(start._r); start._r = setTimeout(refit, 250); }, { passive: true });
    setInterval(refit, 1500);
    var n = 0, iv = setInterval(function () { if (wire() || ++n > 20) clearInterval(iv); }, 500); wire();
  }
  window.KiuAvatarBoot = {
    set: function (n) { set(n); },
    hold: hold, flash: flash, reset: reset,
    get avatar() { return null; } /* compat: ya no hay bot de reemplazo */
  };
  start();
})();
