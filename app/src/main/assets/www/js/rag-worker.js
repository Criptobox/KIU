/* rag-worker.js — núcleo puro del RAG de Kiu (tanda 8 · v2.7.0).
 *
 * UN solo archivo con dos modos, como pdf.js + pdf.worker.min.js:
 *
 *  1) Hilo principal (script clásico en index.html, ANTES de rag.js):
 *     expone window.KiuRagCore = { tok, chunk, mkRows, score, ... }.
 *     rag.js delega acá la tokenización, la fragmentación y el BM25,
 *     así la matemática existe en UN solo lugar.
 *
 *  2) Web Worker (rag.js hace new Worker('js/rag-worker.js')):
 *     atiende {id, op, ...} por postMessage y devuelve {id, ok, ...}.
 *     Así la fragmentación de textos grandes y el cálculo de similitud
 *     NO congelan la interfaz ni las animaciones del avatar.
 *
 * Protocolo del worker:
 *   → {id, op:'sync',  rows:[{key,doc,ci,tf,len}]}   espeja el índice (sin textos)
 *   → {id, op:'drop',  docId}                        quita un doc del espejo
 *   → {id, op:'prep',  docId, text|chunks}           fragmenta + precalcula tf
 *   → {id, op:'search', q, k}                        BM25 → [{key, s}]
 *   ← {id, ok:true, rows?|hits?}  /  {id, ok:false, err}
 * node --check js/rag-worker.js
 */
(function (g) {
  'use strict';

  var CHUNK = 700;          // tamaño de fragmento
  var OVER = 90;            // solapamiento entre fragmentos
  var MAXC = 800;           // tope de fragmentos por documento
  var K1 = 1.4, B = 0.75;   // parámetros BM25

  var STOP = ('de la el los las un una unos unas y o a en que es por con para del al lo su sus como mas más pero este esta eso estas estos les ya se te le me nos ustedes the and for are you with not was have from this that will your about into their other which then').split(' ');

  /* ---------- tokenización (igual que v1, con ñ) ---------- */
  function tok(s) {
    var t = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var ws = t.split(/[^a-z0-9ñ_]+/);
    var out = [];
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (w.length < 3 || w.length > 24 || STOP.indexOf(w) >= 0) continue;
      if (/^\d+$/.test(w) && w.length < 4) continue;
      out.push(w);
    }
    return out;
  }

  /* ---------- texto → fragmentos (igual que v1) ---------- */
  function chunk(text) {
    var t = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (t.length < 12) return []; /* v2.7.4: antes 40: una nota corta se descartaba */
    var parts = [];
    var paras = t.split(/\n\n+/);
    var buf = '';
    for (var i = 0; i < paras.length; i++) {
      if ((buf + '\n\n' + paras[i]).length > CHUNK && buf) { parts.push(buf); buf = paras[i]; }
      else buf = buf ? (buf + '\n\n' + paras[i]) : paras[i];
      while (buf.length > CHUNK * 1.8) {
        parts.push(buf.slice(0, CHUNK));
        buf = buf.slice(CHUNK - OVER);
      }
    }
    if (buf.trim()) parts.push(buf);
    return parts.slice(0, MAXC);
  }

  /* ---------- filas desde fragmentos: tf precalculado una sola vez ---------- */
  function mkRows(docId, chunks) {
    var rows = [];
    for (var i = 0; i < chunks.length; i++) {
      var toks = tok(chunks[i]);
      var tf = {};
      for (var k = 0; k < toks.length; k++) tf[toks[k]] = (tf[toks[k]] || 0) + 1;
      rows.push({ key: docId + '#' + i, doc: docId, ci: i, text: String(chunks[i]), tf: tf, len: toks.length });
    }
    return rows;
  }

  /* ---------- df/N/len desde filas (para el BM25) ---------- */
  function dfOf(rows) {
    var df = {}, N = 0, len = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      N++; len += (r.len || 0);
      var tf = r.tf || {};
      for (var w in tf) if (Object.prototype.hasOwnProperty.call(tf, w)) df[w] = (df[w] || 0) + 1;
    }
    return { df: df, N: N, len: len };
  }

  /* ---------- búsqueda BM25 → top-k [{key, s}] (sin tocar textos) ---------- */
  function score(q, rows, df, N, lenSum, k) {
    var qs = tok(q);
    if (!qs.length || !N) return [];
    var avg = lenSum / N || 1;
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], sc = 0, hits = 0;
      var tf = r.tf || {};
      for (var j = 0; j < qs.length; j++) {
        var f = tf[qs[j]];
        if (f) {
          hits++;
          var idf = Math.log(1 + (N - (df[qs[j]] || 0) + 0.5) / ((df[qs[j]] || 0) + 0.5));
          sc += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * ((r.len || 0) / avg)));
        }
      }
      if (hits > 0) out.push({ key: r.key, s: sc });
    }
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, k || 3);
  }

  var api = {
    tok: tok, chunk: chunk, mkRows: mkRows, dfOf: dfOf, score: score,
    CHUNK: CHUNK, OVER: OVER, MAXC: MAXC, K1: K1, B: B
  };

  /* ================= modo Web Worker ================= */
  if (typeof importScripts === 'function') {
    var idx = { map: {}, rows: [], df: {}, N: 0, len: 0 };

    function rebuild() {
      var d = dfOf(idx.rows);
      idx.df = d.df; idx.N = d.N; idx.len = d.len;
    }
    function answer(msg, patch) {
      var out = { id: msg.id, ok: true };
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) out[k] = patch[k];
      self.postMessage(out);
    }

    self.onmessage = function (e) {
      var m = e.data || {};
      try {
        if (m.op === 'sync') {
          /* espeja el índice del hilo principal (filas SIN texto) */
          idx.rows = (m.rows || []).map(function (r) {
            return { key: r.key, doc: r.doc, ci: r.ci || 0, tf: r.tf || {}, len: r.len || 0 };
          });
          idx.map = {};
          for (var i = 0; i < idx.rows.length; i++) idx.map[idx.rows[i].key] = idx.rows[i];
          rebuild();
          answer(m, { n: idx.rows.length });
        } else if (m.op === 'drop') {
          var keep = [];
          for (var j = 0; j < idx.rows.length; j++) {
            if (idx.rows[j].doc === m.docId) delete idx.map[idx.rows[j].key];
            else keep.push(idx.rows[j]);
          }
          idx.rows = keep;
          rebuild();
          answer(m, { n: idx.rows.length });
        } else if (m.op === 'prep') {
          var chunks = (m.chunks && m.chunks.length) ? m.chunks : chunk(m.text || '');
          var rows = mkRows(m.docId || 'd', chunks);
          var bytes = 0;
          for (var b = 0; b < rows.length; b++) bytes += rows[b].text.length;
          answer(m, { rows: rows, chunks: chunks, bytes: bytes });
        } else if (m.op === 'search') {
          var hits = score(m.q || '', idx.rows, idx.df, idx.N, idx.len, m.k || 3);
          answer(m, { hits: hits });
        } else {
          self.postMessage({ id: m.id, ok: false, err: 'op desconocida: ' + m.op });
        }
      } catch (err) {
        self.postMessage({ id: m.id, ok: false, err: String(err && err.message || err) });
      }
    };
    return;
  }

  /* ================= modo hilo principal ================= */
  g.KiuRagCore = api;
})(typeof self !== 'undefined' ? self : this);
