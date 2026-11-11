/* markdown.js — v2.23.0: el renderizador de markdown del chat, fuera de app-ui.js.
 *
 * Convierte el texto de Kiu (o del modelo, o de una web) en HTML. Es la frontera de seguridad
 * del chat: TODO el texto pasa por esc() primero y recién después se agregan etiquetas propias,
 * así que ningún `<script>`, `<img onerror>` o `javascript:` llega al DOM. Los enlaces solo se
 * aceptan con http(s). Depende de esc() e icon() de env.js. */
(function () {
  'use strict';
  function render(txt) {
    var esc = window.esc, icon = window.icon;

      var t = esc(txt);
      var blocks = [];
      /* 1) Bloques de código ```...```: se apartan para que nada los toque */
      t = t.replace(/```[a-zA-Z0-9+#-]*\n?([\s\S]*?)```/g, function (_, code) {
        var c = code.replace(/\n$/, '');
        var raw = c.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); /* v2.7.1: copiar el codigo real, no las entidades HTML */
        blocks.push('<div class="codeblock"><button class="code-copy" data-code="' + encodeURIComponent(raw) + '">Copiar</button><pre><code>' + c + '</code></pre></div>');
        return '\u0000' + (blocks.length - 1) + '\u0000';
      });
      /* 1-bis) TARJETA DE ERROR (v2.14.7).
         Las líneas que empiezan con "!! " no son una respuesta del bot: son
         un problema de la app, y tienen que verse distinto, con su ícono y
         su acción. Sin esto, un fallo salía como un párrafo más mezclado con
         lo que Kiu dice, y la persona no sabía si Kiu había fallado.
         Formato:
           !! **Título**
           !! detalle
           !! → [Acción](kiu://accion) */
      t = t.replace(/(^|\n)((?:!! ?[^\n]*\n?)+)/g, function (_, pre, run) {
        var ls = run.split('\n').filter(function (x) { return x.indexOf('!!') === 0; });
        var acc = '';
        var mAcc = null;
        for (var ai = 0; ai < ls.length; ai++) {
          mAcc = ls[ai].match(/→\s*\[([^\]]+)\]\((kiu:\/\/[^)\s]+)\)/);
          if (mAcc) { ls[ai] = ls[ai].replace(/→\s*\[[^\]]+\]\([^)\s]+\)/, ''); break; }
        }
        var inner = ls.map(function (x) { return x.replace(/^!! ?/, '').trim(); }).filter(function (x) { return !!x; }).join('<br>');
        inner = inner.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        if (mAcc) {
          acc = '<button class="errcard-act" data-kiu-act="' + esc(mAcc[2]) + '">' + esc(mAcc[1]) + '</button>';
        }
        blocks.push('<div class="errcard"><span class="errcard-ic">' + icon('alert', 16) + '</span><div class="errcard-body">' + inner + acc + '</div></div>');
        return pre + '\u0000' + (blocks.length - 1) + '\u0000';
      });
      /* 2) Código en línea */
      t = t.replace(/`([^`\n]+)`/g, function (_, code) { /* v2.7.2: se aparta para que negrita y links no se procesen dentro */
        blocks.push('<code>' + code + '</code>');
        return '\u0000' + (blocks.length - 1) + '\u0000';
      });
      /* 3) Enlaces [texto](url) */
      t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" class="msg-link" data-href="$2">$1</a>');
      /* 4) Títulos markdown */
      t = t.replace(/^#{1,4}\s+(.+)$/gm, '<h4>$1</h4>');
      /* 5) Negrita y cursiva */
      t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      t = t.replace(/(^|[\s(«"\u00A0])\*([^*\n]{2,})\*(?=[\s).,:;!?»"\u00A0]|$)/g, '$1<i>$2</i>');
      /* 6) Listas: agrupa líneas consecutivas con - • * o 1. */
      var lines = t.split('\n'), out = [], kind = null, items = [];
      function flush() {
        if (!kind) return;
        out.push('<' + kind + '>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</' + kind + '>');
        kind = null; items = [];
      }
      for (var i = 0; i < lines.length; i++) {
        var L = lines[i];
        var mU = L.match(/^\s*(?:[-*•])\s+(.*)$/);
        var mO = L.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (mU) {
          if (kind === 'ol') flush();
          kind = 'ul'; items.push(mU[1]);
        } else if (mO) {
          if (kind === 'ul') flush();
          kind = 'ol'; items.push(mO[2]);
        } else { flush(); out.push(L); }
      }
      flush();
      t = out.join('\n');
      /* 7) Saltos de línea (fuera de bloques) */
      t = t.replace(/\n/g, '<br>');
      t = t.replace(/(<\/(?:ul|ol|h4)>)<br>/g, '$1').replace(/<br>(<(?:ul|ol|h4)[ >])/g, '$1');
      /* 8) Vuelven los bloques de código */
      t = t.replace(/\u0000(\d+)\u0000/g, function (_, ix) { return blocks[parseInt(ix, 10)] || ''; });
      return t;
  }
  window.KiuMd = { render: render };
})();
