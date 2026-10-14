/* app/motor.js — módulo de app.js (tanda 4 · sección 3-a). motor llama.cpp en el teléfono: carga, generación, contexto, router, orquestador y conocimiento.
 * Cargado como script clásico en orden por index.html; los símbolos
 * compartidos viven en window para que los módulos se lean entre sí
 * igual que dentro del app.js original. */
(function () {
  'use strict';

  /* v2.8.0: el motor es el que sabe cuándo empieza y termina cada cosa, así que
     es el que emite los eventos de estado. Nada de adivinar mirando el puente:
     KiuState.set('job', …) mientras dura, KiuState.clear + flash al terminar. */
  function KS() { return window.KiuState || null; }
  function jobOn(state) { var k = KS(); if (k) k.set('job', state); }
  function jobOff(flashState, ms) {
    var k = KS(); if (!k) return;
    k.clear('job');
    if (flashState) k.flash('flash', flashState, ms || 2200);
  }
  function jobErr(state, ms) { var k = KS(); if (!k) return; k.clear('job'); k.warn(state, ms || 2800); }

  /* ================= v1.7.0: MOTOR INTERNO (llama.cpp en el teléfono) ================= */
  var Kiu = {
    avail: null,
    busyG: false,
    pending: null,
    available: function () {
      /* v2.1: si la primera consulta dio false (puente aún no listo), se vuelve
         a preguntar cada 15 s en vez de cachear el false para siempre */
      if (this.avail !== true && this._availAt && Date.now() - this._availAt < 15000) return this.avail;
      this.avail = !!rawBridge('kiuAvailable');
      this._availAt = Date.now();
      return this.avail;
    },
    best: function () {
      var cands = [];
      for (var k in S.dl.done) {
        if (!Object.prototype.hasOwnProperty.call(S.dl.done, k)) continue;
        var c = modCatByFile(k);
        if (c && c.eng === 'kiu' && modKind(k) === 'text') cands.push(c);
      }
      if (!cands.length) return '';
      var ram = (Sys.d && Sys.d.ramTotal) ? Sys.d.ramTotal / 1073741824 : 6;
      var ok = cands.filter(function (c) { return c.r <= ram - 1; });
      ok.sort(function (a, b) { return b.gb - a.gb; });
      return (ok[0] || cands.sort(function (a, b) { return a.gb - b.gb; })[0]).f;
    },
    resolvePath: function (name) {
      if (!name) return '';
      // 1) Si ya tenemos path guardado y coincide
      if (S.kiu.path && S.kiu.path.indexOf(name) >= 0) return S.kiu.path;
      // 2) Buscar en la lista real de archivos del disco
      try {
        Mod.sync();
        for (var i = 0; i < Mod.files.length; i++) {
          if (Mod.files[i].n === name && Mod.files[i].path) return Mod.files[i].path;
        }
      } catch (e0) {}
      // 3) Preguntar al puente nativo (dlStart con url vacía = resolver path)
      var r = jparse(rawBridge('dlStart', ['', name, '']) || '{}', {});
      if (r.path) {
        if (r.path.indexOf('/') >= 0) S.dl.dir = r.path.slice(0, r.path.lastIndexOf('/'));
        return r.path;
      }
      // 4) Fallback por directorio conocido
      if (S.dl.dir) return S.dl.dir + '/' + name;
      return '';
    },
    load: function (name, cb, quiet) {
      var self = this;
      if (!this.available()) { if (!quiet) App.toast('El motor interno no está disponible en este teléfono'); if (cb) cb(false); return; }
      if (this.busyG) { if (!quiet) App.toast('Motor ocupado. Tocá «Liberar motor» y reintentá'); if (cb) cb(false); return; }
      // Aviso de modelos grandes (v1.9.0: con mmap + GPU el 8B ya es viable)
      var cat = modCatByFile(name);
      var gb = cat ? cat.gb : ((S.dl.done[name] && S.dl.done[name].b) ? S.dl.done[name].b / 1073741824 : 0);
      var ramG = (Sys.d && Sys.d.ramTotal) ? Sys.d.ramTotal / 1073741824 : 0;
      if (!quiet && gb >= 3.5) {
        var moe = cat && cat.moe;
        var bigMsg = moe
          ? 'Modelo MoE de ' + gb.toFixed(1) + ' GB (30B totales, 3B activos). Con mmap se sirve desde el almacenamiento, pero necesita ~22 GB de RAM libre: solo teléfonos tope de gama. ¿Seguro que querés cargarlo?'
          : 'Modelo grande (' + gb.toFixed(1) + ' GB). Necesita ' + Math.max(3, Math.ceil(gb * 1.5)) + ' GB de RAM libre. Con mmap + GPU (si tu teléfono tiene Vulkan) va mucho mejor. ¿Cargarlo igual?';
        App.confirm('Modelo grande (' + gb.toFixed(1) + ' GB)', bigMsg, function () {
          self.load(name, cb, true);
        }, { okLabel: 'Cargar igual', danger: false });
        return;
      }
      var path = this.resolvePath(name);
      bcrumb('path: ' + (path || 'VACIO') + ' | ' + name);
      if (!path) {
        if (!quiet) App.toast('No encontré el archivo del modelo en el teléfono. Probá «Importar GGUF» o volvé a descargarlo.');
        if (cb) cb(false);
        return;
      }
      this.busyG = true;
      bcrumb('cargando modelo: ' + name + ' @ ' + path);
      if (!quiet) App.toast('Cargando ' + (name.replace(/\.gguf$/i, '').slice(0, 28)) + '…');
      jobOn('Cargando');
      this.pending = { op: 'load', cb: cb, quiet: !!quiet, name: name, path: path, t0: Date.now() };
      // Contexto según tamaño: modelos chicos tienen más margen para historial
      var ctx = (gb >= 12) ? 256 : (gb < 1.2 ? 1024 : 512);
      var ok = rawBridge('kiuLoad', [path, ctx, 0]);
      if (!ok) {
        this.busyG = false;
        this.pending = null;
        jobErr('Error', 2600);
        try { rawBridge('kiuResetBusy'); } catch (e) {}
        if (!quiet) App.toast('No se pudo iniciar la carga. Tocá «Liberar motor» y reintentá.');
        if (cb) cb(false);
        return;
      }
      /* v1.8.0: progreso REAL del motor (llama.cpp lo reporta por el puente).
         Ya no hay timeout que mate la carga: sigue hasta terminar o fallar. */
      self._loadPct = 3;
      self._loadSec = 0;
      var lastPct = -1, lastPctAt = Date.now();
      if (this._loadProg) clearInterval(this._loadProg);
      this._loadProg = setInterval(function () {
        if (!self.pending || self.pending.op !== 'load') {
          clearInterval(self._loadProg); self._loadProg = null; return;
        }
        var sec = Math.round((Date.now() - self.pending.t0) / 1000);
        self._loadSec = sec;
        var st = jparse(rawBridge('kiuLoadProgress') || '{}', {});
        /* Motor terminó sin que llegara el callback (app en segundo plano, etc.) */
        if (st && st.ready && !st.loading) {
          clearInterval(self._loadProg); self._loadProg = null;
          var pend = self.pending;
          self.pending = null;
          self.busyG = false;
          S.kiu.ok = true;
          S.kiu.name = pend.name || S.kiu.name;
          S.kiu.path = pend.path || S.kiu.path;
          saveS();
          jobOff('Cargado', 2500);
          App.renderModels(); App.renderStatus();
          App.toast('Motor interno listo: ' + S.kiu.name.replace('.gguf', ''));
          if (pend.cb) pend.cb(true);
          return;
        }
        /* Detección de cuelgue real: motor sin progreso y sin cargar por mucho rato */
        var pct = (st && typeof st.pct === 'number' && st.loading) ? Math.min(99, Math.max(3, Math.round(st.pct))) : 0;
        if (pct !== lastPct) { lastPct = pct; lastPctAt = Date.now(); }
        if (!st.loading && !st.ready && pct === 0 && Date.now() - lastPctAt > 15000) {
          /* la carga nativa no arrancó (hilo muerto): liberar y avisar */
          clearInterval(self._loadProg); self._loadProg = null;
          var q = self.pending ? self.pending.quiet : false;
          var cbf = self.pending ? self.pending.cb : null;
          self.busyG = false; self.pending = null;
          try { rawBridge('kiuResetBusy'); } catch (e) {}
          try { rawBridge('kiuFree'); } catch (e) {}
          jobErr('Error', 2600);
          App.renderModels(); App.renderStatus();
          if (!q) App.toast('El motor no arrancó la carga. Tocá «Cargar modelo» de nuevo.');
          if (cbf) cbf(false);
          return;
        }
        if (!pct) {
          /* sin dato del puente: estimación suave solo para la animación */
          var est = Math.max(30, Math.round((gb || 1) * 45));
          pct = Math.min(92, Math.round(sec / est * 100));
        }
        self._loadPct = pct;
        App.renderModels();
        if (sec === 20 || sec === 60 || sec === 120) {
          if (!self.pending.quiet) App.toast('Cargando en memoria… ' + pct + '% (' + sec + 's) · sigue aunque cambies de pantalla');
        }
      }, 800);
      /* Nota: ya no hay timeout destructivo. La carga termina sola (o el usuario
         usa «Liberar motor», que ahora sí corta de verdad). */
    },
    autoload: function () {
      if (!S.kiu.auto || !this.available() || S.kiu.ok || this.busyG) return;
      var name = (S.kiu.name && S.dl.done[S.kiu.name]) ? S.kiu.name : this.best();
      if (name) this.load(name, null, true);
    },
    /* v2.1.2: ¿el nativo TIENE el modelo cargado de verdad? Antes S.kiu.ok
       quedaba pegado en true tras morir el proceso y el motor decía "cargado"
       pero generaba vacío al instante ("el motor no arrancó"). */
    isLoaded: function () {
      try {
        var v = rawBridge('kiuIsLoaded');
        return (v === null || v === undefined) ? this._isLoadedGuess : !!v;
      } catch (e) { return true; }
    },
    /* v2.1.2: verifica y recarga sola el último modelo si el proceso se reinició.
       Devuelve 'ok' | 'recargando' | 'sin-modelo' | 'fallo'. */
    ensureLoaded: function (quiet) {
      if (!S.kiu.ok) { this.autoload(); return 'sin-modelo'; }
      this._isLoadedGuess = true;
      if (this.isLoaded()) { this._isLoadedGuess = true; return 'ok'; }
      this._isLoadedGuess = false;
      S.kiu.ok = false;
      saveS();
      var name = (S.kiu.name && S.dl.done[S.kiu.name]) ? S.kiu.name : this.best();
      if (name && this.available() && !this.busyG) {
        if (!quiet) App.toast('El motor se descargó al cerrar la app · recargando ' + name.replace(/\.gguf$/i, '') + '…');
        this.load(name, function (ok) {
          if (ok) App.toast('Motor interno listo otra vez');
          else App.renderStatus();
        }, true);
        return 'recargando';
      }
      App.renderModels();
      App.renderStatus();
      return 'fallo';
    },
    /* v2.4.0 (sección 3-c): PROTECCIÓN TÉRMICA — la temperatura de batería ya
       viene en sysInfo().temp. Mientras hay una generación en curso, cada 10 s
       se mide: a 46 °C o más se corta la generación (entregando el parcial como
       respuesta recuperada) y se avisa. Se reanuda solo en el próximo intento.
       El chequeo se autolimpia: si no hay pending de generación, suelta el timer.
       S.thermal=false la apaga desde Ajustes · Motor local. */
    _thermArm: function () {
      var self = this;
      if (this._thermT) { clearInterval(this._thermT); this._thermT = null; }
      this._thermT = setInterval(function () {
        if (!self.pending || self.pending.op !== 'gen') {
          if (self._thermT) { clearInterval(self._thermT); self._thermT = null; }
          return;
        }
        if (S.thermal === false) return;
        var d = null;
        try { d = jparse(rawBridge('sysInfo') || '{}', {}); } catch (e) { }
        var t = (d && typeof d.temp === 'number') ? d.temp : 0;
        if (!t || t < 46) return;
        /* calor crítico: cortar y entregar el parcial (si hay) */
        if (self._thermT) { clearInterval(self._thermT); self._thermT = null; }
        if (self._genPoll) { clearInterval(self._genPoll); self._genPoll = null; }
        var partial = '';
        try { partial = String(jparse(rawBridge('kiuGenStatus') || '{}', {}).text || ''); } catch (e2) { }
        try { rawBridge('kiuGenStop'); } catch (e3) { }
        try { rawBridge('kiuResetBusy'); } catch (e4) { }
        self.busyG = false;
        var cbT = self.pending.cb;
        self.pending = null;
        var kSt = KS(); if (kSt) { kSt.clear('job'); kSt.flash('flash', 'Proveedor en pausa', 3500); }
        try { App.toast('Motor en pausa por calor (' + Math.round(t) + '°). Esperá un poco y volvé a intentar.'); } catch (e5) { }
        var clean = partial.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
        cbT({ ok: !!clean, text: clean, tps: 0, recovered: true, thermal: Math.round(t) });
      }, 10000);
    },
    /* v2.7.4: el tokenizador nativo parsea tokens especiales (parse_special=true). Texto del usuario,
       de documentos del RAG o de la web con "<|im_start|>system..." se convertia en tokens de control
       reales (inyeccion de prompt). Se parte cada marcador con un caracter invisible: sigue legible,
       pero ya no es un token especial. Solo se toca el CONTENIDO, nunca las plantillas de fmt(). */
    defang: function (t) {
      return String(t == null ? '' : t)
        .replace(/<\|/g, '<\u200b|').replace(/\|>/g, '|\u200b>')
        .replace(/<(\/?)(s|bos|eos|start_of_turn|end_of_turn|unk|pad)>/gi, '<\u200b$1$2>')
        .replace(/\[(\/?)(INST|SYS)\]/gi, '[\u200b$1$2]');
    },
    fmt: function (msgs) {
      var self0 = this;
      msgs = (msgs || []).map(function (m) { return { role: m.role, content: self0.defang(m.content) }; });
      var fam = 'qwen';
      var c = modCatByFile(S.kiu.name);
      if (c) fam = c.fam;
      var sys = '';
      for (var i = 0; i < msgs.length; i++) if (msgs[i].role === 'system') sys += msgs[i].content + '\n';
      var out = '';
      if (fam === 'llama') {
        out = '<|begin_of_text|>';
        if (sys) out += '<|start_header_id|>system<|end_header_id|>\n\n' + sys.trim() + '<|eot_id|>\n';
        for (var j = 0; j < msgs.length; j++) {
          if (msgs[j].role === 'user') out += '<|start_header_id|>user<|end_header_id|>\n\n' + msgs[j].content + '<|eot_id|>\n';
          else if (msgs[j].role === 'assistant') out += '<|start_header_id|>assistant<|end_header_id|>\n\n' + msgs[j].content + '<|eot_id|>\n';
        }
        out += '<|start_header_id|>assistant<|end_header_id|>\n\n';
      } else if (fam === 'gemma') {
        out = '<bos>';
        var first = true;
        for (var g = 0; g < msgs.length; g++) {
          if (msgs[g].role === 'user') {
            out += '<start_of_turn>user\n' + (first && sys ? sys.trim() + '\n\n' : '') + msgs[g].content + '<end_of_turn>\n';
            first = false;
          } else if (msgs[g].role === 'assistant') out += '<start_of_turn>model\n' + msgs[g].content + '<end_of_turn>\n';
        }
        out += '<start_of_turn>model\n';
      } else {
        if (sys) out += '<|im_start|>system\n' + sys.trim() + '<|im_end|>\n';
        for (var k = 0; k < msgs.length; k++) {
          if (msgs[k].role === 'user') out += '<|im_start|>user\n' + msgs[k].content + '<|im_end|>\n';
          else if (msgs[k].role === 'assistant') out += '<|im_start|>assistant\n' + msgs[k].content + '<|im_end|>\n';
        }
        out += '<|im_start|>assistant\n';
      }
      return out;
    },
    ask: function (msgs, maxT, cb, onTok) {
      var self = this;
      /* v2.3.0 (sección 2): estado del streaming por push — el nativo manda
         parciales via window.kiuPush y el sondeo queda como respaldo. */
      this._onTok = onTok || null;
      this._pushT = 0;
      this._pushLen = -1;
      this._thermArm();
      /* v2.1: si un generate anterior murió sin callback, busyG quedaba pegado y el
         motor "cargado" nunca respondía. Sin pending = estado huérfano: se libera. */
      if (this.busyG && !this.pending) { this.busyG = false; try { rawBridge('kiuResetBusy'); } catch (e) { } }
      if (!S.kiu.ok) { jobOff(); cb({ ok: false, err: 'sin modelo cargado' }); return; }
      if (this.busyG) { jobOff(); cb({ ok: false, err: 'motor ocupado' }); return; }
      this.busyG = true;
      this.pending = { op: 'gen', cb: cb };
      jobOn('Generando');
      var genPrompt = this.fmt(msgs);
      var genMaxT = Math.min(maxT || 350, 512);
      var genTemp = (typeof S.temp === 'number' ? S.temp : 0.7);
      /* v2.1.1: si el job nativo anterior murió mal, KiuGenJob.busy quedaba pegado,
         kiuGen devolvía false y fallábamos AL INSTANTE con "motor ocupado" para
         siempre (el lado nativo jamás se recuperaba solo). Ahora: stop + reset
         del busy + reintento hasta 4 veces cada 900 ms. */
      var attempt = 0;
      var startGen = function () {
        if (!self.pending || self.pending.op !== 'gen') return;
        var launched = false;
        try { launched = rawBridge('kiuGen', [genPrompt, genMaxT, genTemp]); } catch (eG) { launched = false; }
        if (launched) { afterGen(); return; }
        attempt++;
        if (attempt <= 4) {
          try { rawBridge('kiuGenStop'); } catch (e1) { }
          try { rawBridge('kiuResetBusy'); } catch (e2) { }
          setTimeout(startGen, 900);
          return;
        }
        self.busyG = false;
        self.pending = null;
        if (self._genPoll) { clearInterval(self._genPoll); self._genPoll = null; }
        jobErr('Error', 2600);
        cb({ ok: false, err: 'motor ocupado' });
      };
      var afterGen = function () {
      /* v1.9.0: STREAMING — consulta el buffer nativo cada 130 ms y va pintando
         la respuesta palabra por palabra mientras el modelo genera. */
      if (self._genPoll) clearInterval(self._genPoll);
      var lastLen = -1, lastTokN = -1, t0 = Date.now(), lastProg = Date.now();
      self._genPoll = setInterval(function () {
        if (!self.pending || self.pending.op !== 'gen') {
          if (self._genPoll) clearInterval(self._genPoll);
          self._genPoll = null;
          return;
        }
        /* v2.3.0: push vivo (<1,3 s desde el último parcial) = no golpear el puente;
           si el nativo se cuelga de verdad, el push se corta, el sondeo vuelve y
           el watchdog de abajo actúa como siempre. */
        if (self._pushT && Date.now() - self._pushT < 1300) { lastProg = Date.now(); return; }
        var st = null;
        try { st = jparse(rawBridge('kiuGenStatus') || '{}', {}); } catch (e) { }
        if (!st) return;
        var partial = String(st.text || '');
        var nTok = (typeof st.toks === 'number') ? st.toks : -1;
        if (partial.length !== lastLen || nTok !== lastTokN) { lastProg = Date.now(); }
        if (onTok && partial.length !== lastLen) {
          lastLen = partial.length;
          var vis = partial.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').replace(/<\/?think>/gi, '').replace(/^\s+/, '');
          try { onTok(vis, st); } catch (e2) { }
        }
        lastTokN = nTok;
        /* v2.1.1: DETECTOR DE GENERACIÓN COLGADA — antes el "Pensando…" podía
           durar los 10 minutos completos de la red de seguridad. Ahora:
           a) el nativo terminó (done) pero el callback se perdió en el puente →
              se entrega el texto recuperado como si nada;
           b) el nativo no arrancó (done + 0 tokens + 6 s) → stop/reset/reintento;
           c) sin NINGÚN progreso 180 s antes del primer token o 75 s entre
              tokens → stop/reset + fallo con "stuck" para reintentar liviano. */
        var gap = Date.now() - lastProg;
        if (st.done && lastTokN > 0) {
          if (self._genPoll) { clearInterval(self._genPoll); self._genPoll = null; }
          self.busyG = false;
          var cbR = self.pending.cb;
          self.pending = null;
          try { rawBridge('kiuGenStop'); } catch (e3) { }
          try { rawBridge('kiuResetBusy'); } catch (e4) { }
          jobOff('Respuesta lista', 2200);
          cbR({ ok: !!partial.trim(), text: partial.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim(), tps: st.tps || 0, recovered: true });
          return;
        }
        if ((st.done && lastTokN <= 0 && (Date.now() - t0) > 6000) || (lastTokN > 0 && gap > 75000) || gap > 180000) {
          if (self._genPoll) { clearInterval(self._genPoll); self._genPoll = null; }
          try { rawBridge('kiuGenStop'); } catch (e5) { }
          try { rawBridge('kiuResetBusy'); } catch (e6) { }
          self.busyG = false;
          var cbf = self.pending.cb;
          self.pending = null;
          jobErr('Error', 2600);
          cbf({ ok: false, err: (lastTokN > 0 ? 'el motor se quedó sin responder' : 'el motor no arrancó'), stuck: true });
        }
      }, 130);
      /* Red de seguridad: 10 minutos (el watchdog de arriba actúa mucho antes). */
      setTimeout(function () {
        if (self.pending && self.pending.op === 'gen') {
          if (self._genPoll) { clearInterval(self._genPoll); self._genPoll = null; }
          self.busyG = false;
          var cbf2 = self.pending.cb;
          self.pending = null;
          rawBridge('kiuGenStop');
          jobErr('Error', 2600);
          cbf2({ ok: false, err: 'tardó demasiado', stuck: true });
        }
      }, 600000);
      };
      startGen();
    },
    handle: function (o) {
      var p = this.pending;
      if (!o) return;
      if (o.op === 'free') {
        this.busyG = false;
        if (!p || p.op !== 'gen') { S.kiu.ok = false; saveS(); App.renderModels(); App.renderStatus(); }
        return;
      }
      if (!p || p.op !== o.op) {
        if (o.op === 'load') this.busyG = false;
        return;
      }
      if (o.op === 'load') {
        this.busyG = false;
        this.pending = null;
        if (this._loadProg) { clearInterval(this._loadProg); this._loadProg = null; }
        if (o.ok) {
          jobOff('Cargado', 2500);
          S.kiu.ok = true;
          S.kiu.name = p.name || S.kiu.name;
          S.kiu.path = this.resolvePath(S.kiu.name) || S.kiu.path;
          saveS();
          App.renderModels();
          App.renderStatus();
          App.toast('Motor interno listo: ' + S.kiu.name.replace('.gguf', ''));
          if (p.cb) p.cb(true);
        } else {
          S.kiu.ok = false;
          saveS();
          App.renderModels();
          App.renderStatus();
          jobErr('Error', 2800);
          var err = String(o.err || 'error desconocido');
          var hint = '';
          if (/RAM|memory|oom|out of memory|alloc/i.test(err)) hint = ' · el modelo es demasiado grande, usá uno ≤1.5B';
          else if (/not found|no such|path|file|open/i.test(err)) hint = ' · archivo no encontrado, reimportá el GGUF';
          else if (/unsupported|unknown|arch|format/i.test(err)) hint = ' · formato no soportado por este motor';
          else hint = ' · probá «Liberar motor» y un modelo más chico';
          App.toast('Falló la carga: ' + err.slice(0, 80) + hint);
          if (p.cb) p.cb(false);
        }
      } else if (o.op === 'gen') {
        this.busyG = false;
        this.pending = null;
        if (this._genPoll) { clearInterval(this._genPoll); this._genPoll = null; }
        jobOff(o.ok ? 'Respuesta lista' : 'Error', 2200);
        if (o.ok) {
          var txt = String(o.text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
          p.cb({ ok: true, text: txt, tps: o.tps || 0, ms: o.ms || 0 });
        } else {
          p.cb({ ok: false, err: o.err || 'error' });
        }
      }
    },
    unload: function () {
      S.kiu.ok = false;
      this.busyG = false;
      this.pending = null;
      if (this._genPoll) { clearInterval(this._genPoll); this._genPoll = null; }
      saveS();
      try { rawBridge('kiuGenStop'); } catch(e){}
      try { rawBridge('kiuResetBusy'); } catch(e){}
      try { rawBridge('kiuFree'); } catch(e){}
      jobOff('Liberado', 2000);
      App.renderModels();
      App.renderStatus();
    },
    /* v2.1.1: botón «Detener» para el motor local — antes solo existía cuando
       llegaba el primer token (y con el prefill lento había que esperar a ciegas) */
    cancelGen: function () {
      if (!this.pending) return false;
      this.pending = null;
      this.busyG = false;
      if (this._genPoll) { clearInterval(this._genPoll); this._genPoll = null; }
      try { rawBridge('kiuGenStop'); } catch (e) { }
      try { rawBridge('kiuResetBusy'); } catch (e2) { }
      jobOff('Detenido', 1500);
      return true;
    },
    forceReset: function () {
      this.busyG = false;
      this.pending = null;
      if (this._genPoll) { clearInterval(this._genPoll); this._genPoll = null; }
      try { rawBridge('kiuResetBusy'); } catch(e){}
      try { rawBridge('kiuGenStop'); } catch(e){}
      jobOff('Liberado', 2000);
      App.toast('Motor liberado. Ya podés cargar un modelo.');
      App.renderModels();
      App.renderStatus();
    }
  };
  window.kiuNativeDone = function (o) { try { Kiu.handle(o); } catch (e) { } };
  /* v2.3.0 (sección 2): PUSH de tokens en vivo — el wrapper JNI (build desde
     fuente) llama a KiuStream.onToken en Java y acá llega el parcial. Con el
     push vivo, el sondeo de kiuGenStatus se suspende y el reloj de progreso
     corre solo: menos tráfico por el puente, misma pantalla. */
  window.kiuPush = function (ev, o) {
    try {
      if (ev !== 'gen' || !o || typeof o.so !== 'string') return;
      if (!Kiu.pending || Kiu.pending.op !== 'gen') return;
      Kiu._pushT = Date.now();
      var so = String(o.so);
      if (so.length === Kiu._pushLen) return; /* sin novedades */
      Kiu._pushLen = so.length;
      if (Kiu._onTok) {
        var vis = so.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').replace(/<\/?think>/gi, '').replace(/^\s+/, '');
        try { Kiu._onTok(vis, { toks: -1, pushed: true }); } catch (e2) { }
      }
    } catch (e) { }
  };

  /* ================= v1.9.0: COMPRESIÓN DE CONTEXTO =================
     Con chats largos: guarda un resumen (hecho por el propio modelo cuando
     el motor está libre) y manda al prompt el resumen + los últimos mensajes. */
  var Comp = {
    lim: 3200,
    cache: store('nexo_comp') || {},
    busy: false,
    apply: function (hist) {
      try {
        var msgs = hist || [];
        var total = 0, i;
        for (i = 0; i < msgs.length; i++) total += (msgs[i].text || '').length;
        if (total <= this.lim || msgs.length <= 8) return msgs;
        var keep = 6;
        var cut = Math.max(0, msgs.length - keep);
        var old = msgs.slice(0, cut);
        if (!old.length) return msgs;
        var key = 'k' + old.length + '_' + String(old[0].ts || 0);
        var sum = this.cache[key];
        if (!sum) { this.summarize(old, key); return msgs.slice(-keep); }
        var out = [{ role: 'assistant', text: '[Resumen de lo hablado antes] ' + sum }];
        return out.concat(msgs.slice(-keep));
      } catch (e) { return hist; }
    },
    summarize: function (old, key) {
      if (this.busy || Kiu.busyG || !S.kiu.ok) return;
      var self = this;
      this.busy = true;
      var conv = old.slice(-12).map(function (m) {
        return (m.role === 'user' ? 'Usuario: ' : 'Kiu: ') + String(m.text || '').replace(/\s+/g, ' ').slice(0, 260);
      }).join('\n').slice(0, 3200);
      var msgs = [
        { role: 'system', content: 'Sos un compresor de conversaciones. Resumí lo esencial (datos, nombres, decisiones, pendientes) en máximo 5 líneas, en español, sin saludos ni adornos.' },
        { role: 'user', content: conv }
      ];
      Kiu.ask(msgs, 140, function (out) {
        self.busy = false;
        if (out && out.ok && out.text) {
          self.cache[key] = String(out.text).trim().slice(0, 600);
          try { store('nexo_comp', self.cache); } catch (e) { }
        }
      });
    }
  };
  window.Comp = Comp;

  /* ================= v1.7.0: ROUTER POR TAREA (modelo según lo que pidas) ================= */
  var Rtr = {
    cool: {},
    classify: function (text, hasImg, fromVoice) {
      if (hasImg) return 'vision';
      var t = (text || '').toLowerCase();
      if (/(```|\bfunction\b|\bclass\b|\bimport\b|\bhtml\b|\bcss\b|javascript|python|\bjava\b|\bsql\b|regex|program|c[oó]digo|script|api\b|\bbug\b)/.test(t)) return 'code';
      if (/(razona|paso a paso|por qu[eé]|explic[aá]|analiz|compar|deduce|matem[áa]|demostrar|l[oó]gica|escrib|redact|ensayo|cuento|resum|traduc|carta)/.test(t) || t.length > 240) return 'reason';
      if (/(busca|busc[áa]|averigu|noticias|[uú]ltima hora|qu[eé] es |qui[eé]n es|precio de|clima|hoja|investig)/.test(t)) return 'search';
      if (fromVoice) return 'voice';
      return 'chat';
    },
    score: function (def, st, task) {
      var cap = def.cap || [];
      var s = 0;
      if (cap.indexOf(task) >= 0) s += 4;
      if (cap.indexOf('fast') >= 0 && (task === 'voice' || task === 'search')) s += 2;
      if (def.local) s += (task === 'vision') ? -2 : 1;
      if (st.latency && st.latency < 900) s += 1;
      if (st.ok) s += 1;
      return s;
    },
    order: function (task) {
      var now = Date.now();
      var list = [];
      var act = App.activeProvs();
      for (var i = 0; i < act.length; i++) {
        var pv = act[i];
        if (this.cool[pv.def.id] && this.cool[pv.def.id] > now) continue;
        list.push({ pv: pv, s: this.score(pv.def, pv.st, task) });
      }
      list.sort(function (a, b) { return b.s - a.s; });
      return list.map(function (x) { return x.pv; });
    },
    fail: function (pid, hard) {
      this.cool[pid] = Date.now() + (hard ? 90000 : 30000);
    },
    fine: function (pid) { if (this.cool[pid]) delete this.cool[pid]; },
    label: function (task) {
      return { vision: 'con visión', code: 'para código', reason: 'para razonar', search: 'con búsqueda web', voice: 'rápido por voz', chat: 'para conversar' }[task] || '';
    }
  };

  /* ================= v1.8.0: ORQUESTADOR MULTI-MODELO =================
     Decide qué modelo atiende cada tarea: motor interno (GGUF del teléfono),
     servidor en tu red (Ollama / LM Studio) o APIs. Con orden de relevo. */
  var Orch = {
    roleOf: function (task) {
      if (task === 'vision') return 'vision';
      if (task === 'reason' || task === 'code') return 'brain';
      return 'fast';
    },
    /* v1.9.1: el mejor modelo INSTALADO para el rol (la preferencia del usuario
       manda; si no hay, cerebro = el más grande que entra en la RAM, rápido = el más chico)
       v2.1: el rol visión también tiene preferencia propia (kiuVis) */
    pickModel: function (role) {
      var pref = role === 'brain' ? (S.router.kiuBrain || '') : role === 'vision' ? (S.router.kiuVis || '') : (S.router.kiuFast || '');
      if (pref && S.dl.done[pref]) {
        var pc = modCatByFile(pref);
        if (pc && pc.eng === 'kiu' && modKind(pref) === 'text') return pref;
      }
      var ram = (Sys.d && Sys.d.ramTotal) ? Sys.d.ramTotal / 1073741824 : 0;
      var cands = [];
      for (var k in S.dl.done) {
        if (!Object.prototype.hasOwnProperty.call(S.dl.done, k)) continue;
        var c = modCatByFile(k);
        if (!c || c.eng !== 'kiu' || modKind(k) !== 'text') continue;
        if (ram && c.r > ram - 1) continue;
        cands.push(c);
      }
      if (!cands.length) return '';
      cands.sort(function (a, b) { return a.gb - b.gb; });
      if (role !== 'brain') return cands[0].f;
      return cands[cands.length - 1].f;
    },
    /* v1.9.1: ¿vale la pena cambiar el modelo cargado por el que pide la tarea?
       Evita el golpeteo: solo cambia si hay mejora real (cerebro) o ahorro claro (rápido) */
    wantsSwap: function (role) {
      if (!S.router || !S.router.on || Kiu.busyG || !S.kiu.ok) return false;
      var want = this.pickModel(role);
      if (!want || want === S.kiu.name) return false;
      var cw = modCatByFile(want), cc = modCatByFile(S.kiu.name);
      if (!cw) return false;
      if (!cc) return true;
      if (role === 'brain') return cw.gb >= cc.gb * 1.3;
      return cc.gb > Math.max(1.5, cw.gb * 2.2);
    },
    targets: function (task) {
      var role = this.roleOf(task);
      var pref = (S.router && S.router.on) ? (S.router[role] || 'auto') : 'auto';
      var provs = (S.mode !== 'local') ? Rtr.order(task) : [];
      /* v2.1: el motor del teléfono también atiende fotos (texto + nota honesta);
         antes quedaba excluido por completo y no había forma de usar modelos locales en visión */
      var kiu = Kiu.available() ? [{ t: 'kiu' }] : [];
      var srv = provs.filter(function (pv) { return pv.def.local; });
      var cloud = provs.filter(function (pv) { return !pv.def.local; });
      var loaded = !!S.kiu.ok;
      var out = [];
      if (pref === 'auto') {
        /* v2.1 orden Auto: servidor conectado → TELÉFONO si ya tiene modelo cargado
           → APIs → teléfono (autocarga). Antes las APIs iban primero aunque hubiera
           un modelo cargado en memoria: parecía que "el modelo cargado no hace las tareas". */
        var first = (role === 'vision') ? cloud : srv;
        var second = (role === 'vision') ? srv : cloud;
        if (first.length) out.push({ t: 'prov', pvs: first });
        if (loaded) out = out.concat(kiu);
        if (second.length) out.push({ t: 'prov', pvs: second });
        if (!loaded) out = out.concat(kiu);
      } else if (pref === 'kiu') {
        out = out.concat(kiu);
        if (srv.length) out.push({ t: 'prov', pvs: srv });
        if (cloud.length) out.push({ t: 'prov', pvs: cloud });
      } else if (pref === 'loc') {
        if (srv.length) out.push({ t: 'prov', pvs: srv });
        if (loaded) out = out.concat(kiu);
        if (cloud.length) out.push({ t: 'prov', pvs: cloud });
        if (!loaded) out = out.concat(kiu);
      } else if (pref.indexOf('prov:') === 0) {
        var pid = pref.slice(5);
        var mine = provs.filter(function (pv) { return pv.def.id === pid; });
        var others = provs.filter(function (pv) { return pv.def.id !== pid; });
        if (mine.length) out.push({ t: 'prov', pvs: mine });
        if (loaded) out = out.concat(kiu);
        if (others.length) out.push({ t: 'prov', pvs: others });
        if (!loaded) out = out.concat(kiu);
      }
      if (!out.length) out = kiu;
      return out;
    },
    /* cambia el modelo del motor interno según el rol (fast/brain) */
    swapAndReply: function (role, text) {
      if (!S.router || !S.router.on) return false;
      var want = this.pickModel(role);
      if (!want) return false;
      if (want === S.kiu.name && S.kiu.ok) return false;
      if (!S.dl.done[want] || Kiu.busyG) return false;
      var c = modCatByFile(want);
      if (c && c.eng !== 'kiu') return false;
      App.toast('Auto: cambio a ' + want.replace(/\.gguf$/i, '').slice(0, 24) + ' ' + (role === 'brain' ? '(cerebro)' : role === 'vision' ? '(visión)' : '(rápido)') + '…');
      Orch._lastDecision = { role: role, name: want };
      Kiu.unload();
      Kiu.load(want, function (ok) {
        if (ok) App.kiuReply(text, null);
        else App.brainFallbackReply(text);
      }, false);
      return true;
    },
    chip: function (role) {
      var v = S.router[role] || 'auto';
      if (v === 'auto') return 'Auto';
      if (v === 'kiu') return 'Motor interno';
      if (v === 'loc') return 'Servidor en red';
      var d = provDef(v.slice(5));
      return d ? d.name : 'Auto';
    }
  };

  /* ================= v1.7.0: CONOCIMIENTO PROGRESIVO + AUTOCORRECCIÓN ================= */
  var KB = {
    data: store('nexo_kb') || { facts: [], lessons: [], chats: 0 },
    save: function () { store('nexo_kb', this.data); },
    count: function () { return (this.data.facts || []).length + (this.data.lessons || []).length; },
    chats: function () { return this.data.chats || 0; },
    add: function (txt) {
      var list = this.data.facts;
      for (var i = 0; i < list.length; i++) {
        if (list[i].t.toLowerCase() === txt.toLowerCase()) { list[i].ts = Date.now(); list[i].score = (list[i].score || 0) + 1; this.save(); return; }
      }
      list.unshift({ t: txt, ts: Date.now(), score: 0 });
      if (list.length > 150) list.pop();
      this.save();
    },
    extract: function (text) {
      var t = (text || '').trim();
      if (t.length < 6 || t.length > 160) return false;
      var pats = [
        [/^(?:record[aá]|recuerda que|recordá que)\s+(.{4,140})$/i],
        [/^(?:me llamo|mi nombre es|soy)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ .]{2,30})$/i],
        [/^(?:prefiero|me gusta|amo)\s+(.{3,120})$/i],
        [/^(?:no me gusta|odio|detesto)\s+(.{3,120})$/i],
        [/^(?:trabajo (?:en|como|de)|estudio|vivo en|mi cumplea[ñn]os es|mi direcci[oó]n es)\s*(.{2,120})$/i]
      ];
      for (var i = 0; i < pats.length; i++) {
        var m = t.match(pats[i][0]);
        if (m) { this.add(m[1].trim()); return true; }
      }
      return false;
    },
    correct: function (text) {
      var t = (text || '').trim();
      if (t.length < 3 || t.length > 220) return false;
      if (!/^(no[,.\s]|est[áa] (mal|equivocado)|incorrecto|te equivocas|no es as[ií]|est[áa]s errado|mejor (di|dec[ií]|es)|correcci[oó]n|falso)/i.test(t)) return false;
      for (var i = 0; i < this.data.lessons.length; i++) {
        if (this.data.lessons[i].t === t) { this.data.lessons[i].hits = (this.data.lessons[i].hits || 0) + 1; this.save(); return true; }
      }
      this.data.lessons.unshift({ t: t, ts: Date.now(), hits: 0 });
      if (this.data.lessons.length > 60) this.data.lessons.pop();
      this.save();
      return true;
    },
    reinforce: function (text) {
      var t = (text || '').toLowerCase();
      for (var i = 0; i < this.data.facts.length; i++) {
        var words = this.data.facts[i].t.toLowerCase().split(/\s+/);
        for (var j = 0; j < words.length; j++) {
          if (words[j].length > 3 && t.indexOf(words[j]) >= 0) { this.data.facts[i].score = (this.data.facts[i].score || 0) + 1; break; }
        }
      }
      this.data.chats = (this.data.chats || 0) + 1;
      this.save();
    },
    context: function () {
      var out = '';
      var fs = (this.data.facts || []).slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0) || b.ts - a.ts; }).slice(0, 12);
      if (fs.length) out += '\n\nLo que ya sabés del usuario (memoria de largo plazo, usalo si aporta): ' + fs.map(function (f) { return '- ' + f.t; }).join('; ') + '.';
      var ls = (this.data.lessons || []).slice(0, 6);
      if (ls.length) out += '\n\nCorrecciones que el usuario te hizo antes (no repitas esos errores): ' + ls.map(function (l) { return '- ' + l.t; }).join('; ') + '.';
      if (out) out += '\n\nAprendés de cada conversación: si te corrigen, agradecelo y ajustate sin repetir el error.';
      return out;
    },
    wipe: function () { this.data = { facts: [], lessons: [], chats: 0 }; this.save(); }
  };

  /* exports del módulo (cross-módulo vía window) */
  window.Kiu = Kiu;
  window.Comp = Comp;
  window.Rtr = Rtr;
  window.Orch = Orch;
  window.KB = KB;
})();
