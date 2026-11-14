/* Nitro - panel controller. */
(function () {
  'use strict';
  var Host = window.NXHost, Tools = window.NXTools, Lib = window.NXLib;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = { ctx: null, busy: false, child: null };

  // ---------- ui helpers ----------
  function status(msg, kind) {
    var el = $('#status');
    el.className = 'status' + (kind ? ' ' + kind : '');
    $('#statusText').textContent = msg;
  }

  function errorMsg(e) { return (e && e.message) || String(e); }

  function seg(id) {
    var root = $('#' + id);
    $$('button', root).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('button', root).forEach(function (x) { x.classList.toggle('on', x === b); });
        root.dispatchEvent(new Event('change'));
      });
    });
    return { get value() { var on = $('button.on', root); return on ? on.getAttribute('data-v') : ''; }, el: root };
  }

  function progress(id) {
    var el = $('#' + id);
    return {
      show: function (pct, label) {
        el.classList.remove('hidden');
        el.classList.toggle('indeterminate', pct == null);
        $('i', el).style.width = (pct || 0) + '%';
        $('span', el).textContent = label || (pct != null ? Math.round(pct) + '%' : '');
      },
      hide: function () { el.classList.add('hidden'); }
    };
  }

  // Runs one job at a time; button shows busy state; errors go to the status bar.
  function job(btn, label, fn) {
    if (state.busy) { status('Aguarde a tarefa atual terminar…'); return Promise.resolve(); }
    state.busy = true;
    if (btn) btn.classList.add('busy');
    status(label + '…', 'busy');
    return Promise.resolve().then(fn).then(function (msg) {
      if (msg) status(msg, 'ok');
    }, function (e) {
      status(errorMsg(e), 'err');
      if (e && e.missing) showTab('settings');
    }).then(function () {
      state.busy = false;
      state.child = null;
      if (btn) btn.classList.remove('busy');
      refreshContext();
    });
  }

  function needTools() {
    if (!Tools) throw new Error('Node.js indisponível no painel (verifique o manifest).');
    return Tools;
  }

  function workDir(sub) {
    var custom = localStorage.getItem('nitro.dir');
    if (custom) return Tools.path.join(custom, sub);
    return Tools.defaultDir(state.ctx && state.ctx.projectFolder, 'Nitro ' + sub);
  }

  // ---------- tabs ----------
  function showTab(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-page') === name); });
    localStorage.setItem('nitro.tab', name);
    if (name === 'settings') checkDeps();
  }
  $$('.tab').forEach(function (t) { t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); }); });

  // ---------- context ----------
  function refreshContext() {
    if (state.busy) return Promise.resolve();
    return Host.call('context').then(function (c) {
      state.ctx = c;
      var el = $('#ctx');
      if (c.comp) {
        el.classList.add('on');
        $('#ctxText').textContent = c.comp.name + (c.comp.selected ? ' · ' + c.comp.selected + ' sel.' : '');
        el.title = c.comp.width + '×' + c.comp.height + ' · ' + (Math.round(c.comp.fps * 100) / 100) + ' fps';
      } else {
        el.classList.remove('on');
        $('#ctxText').textContent = 'Nenhuma comp ativa';
      }
    }, function () {
      $('#ctx').classList.remove('on');
      $('#ctxText').textContent = Host.inHost ? 'AE ocupado…' : 'Modo navegador';
    });
  }

  function importPaths(paths, opts) {
    opts = opts || {};
    return Host.call('importFiles', { paths: paths, addToComp: opts.addToComp !== false, fit: opts.fit || '' }).then(function (r) {
      var n = r.imported.length;
      return n + (n === 1 ? ' arquivo importado' : ' arquivos importados') + (r.comp ? ' em “' + r.comp + '”.' : ' no projeto.');
    });
  }

  // ---------- download ----------
  var dlMode = seg('dlMode');
  var dlProg = progress('dlProg');

  $('#dlPaste').addEventListener('click', function () {
    needTools().readClipboard(workDir('Colagens')).then(function (r) {
      var url = r.type === 'text' ? Lib.extractUrl(r.text) : null;
      if (url) { $('#dlUrl').value = url; status('Link colado.'); }
      else status('Não há link no clipboard.', 'err');
    }).catch(function (e) { status(errorMsg(e), 'err'); });
  });

  $('#dlGo').addEventListener('click', function () {
    var btn = this;
    var url = Lib.extractUrl($('#dlUrl').value);
    if (!url) { status('Cole um link válido (http/https).', 'err'); $('#dlUrl').focus(); return; }
    job(btn, 'Baixando', function () {
      var T = needTools();
      $('#dlCancel').classList.remove('hidden');
      dlProg.show(null, 'Conectando…');
      return T.download(url, workDir('Downloads'), {
        audioOnly: dlMode.value === 'audio',
        onSpawn: function (c) { state.child = c; },
        onProgress: function (p, label) { dlProg.show(p, label + ' ' + Math.round(p) + '%'); }
      }).then(function (file) {
        dlProg.show(100, 'Importando no After Effects…');
        return importPaths([file], { addToComp: $('#dlAdd').checked, fit: dlMode.value === 'video' ? 'fit' : '' });
      }).then(function (msg) {
        $('#dlUrl').value = '';
        return '✔ ' + msg;
      });
    }).then(function () {
      $('#dlCancel').classList.add('hidden');
      setTimeout(function () { dlProg.hide(); }, 1500);
    });
  });

  $('#dlCancel').addEventListener('click', function () {
    if (state.child) { try { state.child.kill(); } catch (e) {} status('Download cancelado.'); }
  });

  // ---------- paste ----------
  var pasteFit = seg('pasteFit');

  function pasteFromSystem(btn) {
    return job(btn, 'Lendo clipboard', function () {
      var T = needTools();
      return T.readClipboard(workDir('Colagens')).then(function (r) {
        if (r.type === 'image' || r.type === 'files') {
          flashDrop();
          return importPaths(r.files, { fit: pasteFit.value });
        }
        if (r.type === 'text' && Lib.extractUrl(r.text)) {
          $('#dlUrl').value = Lib.extractUrl(r.text);
          showTab('import');
          return 'Link detectado no clipboard, clique em “Baixar e importar”.';
        }
        throw new Error('O clipboard não tem imagem nem arquivos. Copie algo com Ctrl+C.');
      });
    });
  }

  function flashDrop() {
    var z = $('#pasteZone');
    z.classList.remove('flash'); void z.offsetWidth; z.classList.add('flash');
  }

  $('#pasteGo').addEventListener('click', function () { pasteFromSystem(this); });
  $('#pasteZone').addEventListener('click', function () { pasteFromSystem($('#pasteGo')); });

  document.addEventListener('paste', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    ev.preventDefault();
    var items = ev.clipboardData ? Array.prototype.slice.call(ev.clipboardData.items || []) : [];
    var img = items.filter(function (i) { return i.kind === 'file' && /^image\//.test(i.type); })[0];
    if (img && Tools) {
      var blob = img.getAsFile();
      job($('#pasteGo'), 'Colando imagem', function () {
        flashDrop();
        return Tools.saveBlob(blob, workDir('Colagens')).then(function (file) { return importPaths([file], { fit: pasteFit.value }); });
      });
    } else {
      pasteFromSystem($('#pasteGo'));
    }
  });

  ['dragover', 'dragenter'].forEach(function (n) {
    document.addEventListener(n, function (e) { e.preventDefault(); $('#pasteZone').classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (n) {
    document.addEventListener(n, function (e) { e.preventDefault(); $('#pasteZone').classList.remove('over'); });
  });
  document.addEventListener('drop', function (e) {
    var files = Array.prototype.slice.call(e.dataTransfer.files || []).map(function (f) { return f.path; }).filter(Boolean);
    if (files.length) job($('#pasteGo'), 'Importando', function () { return importPaths(files, { fit: pasteFit.value }); });
  });

  // ---------- layout ----------
  $$('#anchorGrid button').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('#anchorGrid button').forEach(function (x) { x.classList.remove('hit'); });
      b.classList.add('hit');
      job(null, 'Ajustando anchor point', function () {
        return Host.call('anchor', { x: +b.getAttribute('data-x'), y: +b.getAttribute('data-y') }).then(function (r) {
          return 'Anchor point ajustado em ' + r.changed + ' camada(s).';
        });
      });
    });
  });

  $$('[data-align]').forEach(function (b) {
    b.addEventListener('click', function () {
      var a = b.getAttribute('data-align');
      job(b, 'Alinhando', function () {
        return Host.call('align', { h: a.indexOf('h') >= 0, v: a.indexOf('v') >= 0 }).then(function (r) { return r.changed + ' camada(s) alinhada(s).'; });
      });
    });
  });

  $$('[data-fit]').forEach(function (b) {
    b.addEventListener('click', function () {
      job(b, 'Ajustando', function () {
        return Host.call('fit', { mode: b.getAttribute('data-fit') }).then(function (r) { return r.changed + ' camada(s) ajustada(s).'; });
      });
    });
  });

  $('#vertGo').addEventListener('click', function () {
    job(this, 'Criando versão 9:16', function () {
      return Host.call('toVertical', { blurBg: $('#vertBlur').checked }).then(function (r) { return 'Comp “' + r.comp + '” criada.'; });
    });
  });

  // ---------- presets ----------
  function cardName(b) { var t = b.querySelector('b'); return (t ? t.textContent : b.textContent).trim(); }

  $$('#presets button').forEach(function (b) {
    b.addEventListener('click', function () {
      var name = b.getAttribute('data-preset'), label = cardName(b);
      job(b, 'Aplicando ' + label, function () {
        return Host.call('preset', { name: name }).then(function (r) {
          b.classList.add('applied');
          setTimeout(function () { b.classList.remove('applied'); }, 900);
          return label + ' aplicado em ' + r.changed + ' camada(s).';
        });
      });
    });
  });

  $$('#presetFilter button').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var cat = chip.getAttribute('data-cat');
      $$('#presetFilter button').forEach(function (c) { c.classList.toggle('on', c === chip); });
      $$('#presets .pcard').forEach(function (card) {
        card.classList.toggle('hidden', cat !== 'all' && card.getAttribute('data-cat') !== cat);
      });
    });
  });

  // ---------- text ----------
  var TEXT_STYLES = {
    classic: { font: 'Arial-Black', size: 96, fill: '#ffffff', stroke: '#000000', strokeW: 12, upper: true },
    highlight: { font: 'Arial-Black', size: 100, fill: '#ffe600', stroke: '#000000', strokeW: 14, upper: true },
    nitro: { font: 'Arial-Black', size: 100, fill: '#ff5a1f', stroke: '#ffffff', strokeW: 10, upper: true },
    neon: { font: 'Arial-Black', size: 92, fill: '#25f4ee', stroke: '#08343a', strokeW: 8, upper: true },
    minimal: { font: 'Arial-BoldMT', size: 78, fill: '#ffffff', stroke: '#000000', strokeW: 0, upper: false }
  };

  $$('#textStyles .scard').forEach(function (card) {
    card.addEventListener('click', function () {
      var s = TEXT_STYLES[card.getAttribute('data-style')];
      $$('#textStyles .scard').forEach(function (c) { c.classList.toggle('on', c === card); });
      $('#stFont').value = s.font;
      $('#stSize').value = s.size;
      $('#stFill').value = s.fill;
      $('#stStroke').value = s.stroke;
      $('#stStrokeW').value = s.strokeW;
      $('#stUpper').checked = s.upper;
      localStorage.setItem('nitro.textStyle', card.getAttribute('data-style'));
      updatePreview();
      saveSettings();
      status('Estilo “' + cardName(card) + '” selecionado.');
    });
  });
  var txtMode = seg('txtMode');
  txtMode.el.addEventListener('change', function () {
    $$('.words-only').forEach(function (e) { e.classList.toggle('hidden', txtMode.value !== 'words'); });
    saveSettings();
  });

  function textStyle() {
    return {
      font: $('#stFont').value.trim(),
      size: +$('#stSize').value || 96,
      fill: Lib.hexToRgb01($('#stFill').value),
      stroke: Lib.hexToRgb01($('#stStroke').value),
      strokeWidth: +$('#stStrokeW').value || 0,
      upper: $('#stUpper').checked,
      animate: $('#stAnim').checked,
      posY: (+$('#stPosY').value || 72) / 100
    };
  }

  function updatePreview() {
    var s = $('#txtPreview span'), raw = $('#txtInput').value || 'Seu texto';
    if (txtMode.value === 'words') raw = raw.trim().split(/\s+/).slice(0, Math.max(1, +$('#txtPer').value || 2)).join(' ');
    s.textContent = $('#stUpper').checked ? raw.toUpperCase() : raw;
    s.style.color = $('#stFill').value;
    var w = Math.min(4, (+$('#stStrokeW').value || 0) / 4), c = $('#stStroke').value, sh = [];
    for (var a = 0; a < 16 && w > 0; a++) {
      var ang = a / 16 * Math.PI * 2;
      sh.push((Math.cos(ang) * w).toFixed(1) + 'px ' + (Math.sin(ang) * w).toFixed(1) + 'px 0 ' + c);
    }
    s.style.textShadow = sh.join(',');
    s.style.fontFamily = '"' + $('#stFont').value.replace(/-/g, ' ') + '", "Arial Black", Impact, sans-serif';
    $('#stPosYOut').textContent = $('#stPosY').value + '%';
  }

  ['#txtInput', '#txtPer', '#stFont', '#stFill', '#stStroke', '#stStrokeW', '#stUpper', '#stPosY', '#stSize', '#txtDur', '#stAnim'].forEach(function (s) {
    $(s).addEventListener('input', function () { updatePreview(); saveSettings(); });
    $(s).addEventListener('change', function () { updatePreview(); saveSettings(); });
  });
  txtMode.el.addEventListener('change', updatePreview);

  $('#txtGo').addEventListener('click', function () {
    var btn = this;
    job(btn, 'Criando texto', function () {
      return Host.call('text', {
        text: $('#txtInput').value, mode: txtMode.value,
        perCard: +$('#txtPer').value || 2, dur: +$('#txtDur').value || 0.45,
        style: textStyle()
      }).then(function (r) { return r.count + ' camada(s) de texto criada(s) · fonte ' + r.font + '.'; });
    });
  });

  // ---------- speech ----------
  var capProg = progress('capProg'), silProg = progress('silProg');

  $('#capGo').addEventListener('click', function () {
    var btn = this;
    job(btn, 'Gerando legendas', function () {
      var T = needTools(), src;
      capProg.show(null, 'Lendo camada…');
      return Host.call('layerSource').then(function (s) {
        src = s;
        if (!s.hasAudio) throw new Error('A camada selecionada não tem áudio.');
        return T.transcribe(s.path, s.srcIn, s.srcOut, {
          model: $('#capModel').value, language: $('#capLang').value,
          onSpawn: function (c) { state.child = c; },
          onProgress: function (p, label) { capProg.show(p, label); }
        });
      }).then(function (words) {
        var cards = Lib.groupWords(words, { maxWords: +$('#capWords').value || 3 });
        capProg.show(98, 'Criando ' + cards.length + ' legendas…');
        return Host.call('captions', {
          items: cards, startTime: src.startTime, stretch: src.stretch, style: textStyle()
        });
      }).then(function (r) {
        capProg.show(100, 'Pronto!');
        setTimeout(function () { capProg.hide(); }, 1500);
        return '✔ ' + r.count + ' legendas criadas.';
      }, function (e) { capProg.hide(); throw e; });
    });
  });

  $('#silDb').addEventListener('input', function () { $('#silDbOut').textContent = this.value + ' dB'; saveSettings(); });

  $('#silGo').addEventListener('click', function () {
    var btn = this;
    job(btn, 'Cortando silêncios', function () {
      var T = needTools();
      silProg.show(null, 'Analisando áudio…');
      var src;
      return Host.call('layerSource').then(function (s) {
        src = s;
        if (!s.hasAudio) throw new Error('A camada selecionada não tem áudio.');
        return T.detectSilences(s.path, s.srcIn, s.srcOut, {
          noise: +$('#silDb').value, minSilence: +$('#silMin').value || 0.35, padding: +$('#silPad').value || 0
        });
      }).then(function (keep) {
        var kept = keep.reduce(function (a, r) { return a + r[1] - r[0]; }, 0);
        if (keep.length <= 1 && kept > 0.98 * (src.srcOut - src.srcIn)) {
          throw new Error('Nenhuma pausa encontrada. Suba o limite (ex.: -25 dB) se o áudio tem ruído de fundo.');
        }
        silProg.show(80, 'Cortando ' + keep.length + ' trechos…');
        return Host.call('jumpCut', { keep: keep });
      }).then(function (r) {
        silProg.hide();
        return '✔ ' + r.parts + ' trechos · ' + r.removed.toFixed(1) + 's de silêncio removidos.';
      }, function (e) { silProg.hide(); throw e; });
    });
  });

  // ---------- export ----------
  var expProg = progress('expProg'), lastExport = null;
  $('#expGo').addEventListener('click', function () {
    var btn = this;
    job(btn, 'Exportando', function () {
      var T = needTools();
      T.findTool('ffmpeg') || (function () { var e = new Error('ffmpeg não encontrado. Abra ⚙ Ajustes para instalar.'); e.missing = 'ffmpeg'; throw e; })();
      var compName = state.ctx && state.ctx.comp ? state.ctx.comp.name : 'comp';
      var dir = T.mkdirp(workDir('Exports'));
      var base = Lib.safeFileName(compName) + ' ' + Lib.timestamp();
      var tmp = T.path.join(T.mkdirp(T.path.join(T.DATA_DIR, 'tmp')), base + '.avi');
      try { T.fs.unlinkSync(tmp); } catch (e) {}
      expProg.show(null, 'Renderizando no After Effects (o AE trava até terminar)…');
      return new Promise(function (r) { setTimeout(r, 120); }).then(function () {
        return Host.call('renderLossless', { outPath: tmp });
      }).then(function (r) {
        expProg.show(50, 'Codificando MP4…');
        return T.encodeMp4(r.path, T.path.join(dir, base + '.mp4'), r.duration, function (p, l) { expProg.show(p, l + ' ' + Math.round(p) + '%'); });
      }).then(function (out) {
        lastExport = out;
        expProg.show(100, 'Pronto!');
        $('#expOpen').classList.remove('hidden');
        return '✔ Exportado: ' + T.path.basename(out);
      }, function (e) { expProg.hide(); throw e; });
    });
  });
  $('#expOpen').addEventListener('click', function () { if (lastExport) Tools.revealFile(lastExport); });

  $('#orgGo').addEventListener('click', function () {
    job(this, 'Organizando', function () {
      return Host.call('organize').then(function (r) { return r.moved + ' item(ns) organizado(s) em pastas.'; });
    });
  });

  // ---------- settings / deps ----------
  function setDep(name, ok) {
    var el = $('.dep[data-dep="' + name + '"]');
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('miss', !ok);
    if (ok && typeof ok === 'string') $('small', el).title = ok;
  }

  function checkDeps() {
    if (!Tools) return;
    ['yt-dlp', 'ffmpeg', 'python'].forEach(function (n) { setDep(n, Tools.findTool(n)); });
    Tools.hasFasterWhisper().then(function (ok) { setDep('whisper', ok); });
  }

  $('#depsRefresh').addEventListener('click', checkDeps);

  $$('[data-install]').forEach(function (b) {
    b.addEventListener('click', function () {
      var kind = b.getAttribute('data-install');
      if (kind === 'ytdlp') {
        job(b, 'Baixando yt-dlp', function () {
          return Tools.installYtDlp(function (p) { status('Baixando yt-dlp… ' + Math.round(p) + '%'); }).then(function () {
            checkDeps();
            return 'yt-dlp instalado.';
          }, function () {
            Tools.openTerminalInstall('ytdlp');
            return 'Download direto falhou; abri o instalador no terminal.';
          });
        });
      } else {
        var cmd = Tools.openTerminalInstall(kind);
        status('Rodando no terminal: ' + cmd + ', depois clique “Verificar de novo”.');
      }
    });
  });

  $$('[data-link]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); Host.openUrl(a.getAttribute('data-link')); });
  });

  // ---------- persistence ----------
  var PERSIST = ['#txtInput', '#txtPer', '#txtDur', '#stFont', '#stSize', '#stFill', '#stStroke', '#stStrokeW', '#stUpper', '#stAnim', '#stPosY',
    '#capLang', '#capModel', '#capWords', '#silDb', '#silMin', '#silPad', '#vertBlur', '#dlAdd', '#setDir'];

  function saveSettings() {
    var o = {};
    PERSIST.forEach(function (s) { var el = $(s); o[s] = el.type === 'checkbox' ? el.checked : el.value; });
    o.txtMode = txtMode.value;
    localStorage.setItem('nitro.settings', JSON.stringify(o));
    var dir = $('#setDir').value.trim();
    if (dir) localStorage.setItem('nitro.dir', dir); else localStorage.removeItem('nitro.dir');
  }

  function loadSettings() {
    var o;
    try { o = JSON.parse(localStorage.getItem('nitro.settings') || '{}'); } catch (e) { o = {}; }
    PERSIST.forEach(function (s) {
      if (!(s in o)) return;
      var el = $(s);
      if (el.type === 'checkbox') el.checked = !!o[s]; else el.value = o[s];
    });
    if (o.txtMode) {
      $$('#txtMode button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === o.txtMode); });
      txtMode.el.dispatchEvent(new Event('change'));
    }
    $('#silDbOut').textContent = $('#silDb').value + ' dB';
  }

  PERSIST.forEach(function (s) { $(s).addEventListener('change', saveSettings); });

  // ---------- boot ----------
  loadSettings();
  var savedStyle = localStorage.getItem('nitro.textStyle');
  if (savedStyle) $$('#textStyles .scard').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-style') === savedStyle); });
  updatePreview();
  showTab(localStorage.getItem('nitro.tab') || 'import');
  Host.call('ping').then(function (r) {
    $('#ver').textContent = 'v' + r.version + ' · AE ' + r.ae;
    status('Conectado ao After Effects ' + r.ae + '.');
  }, function () {
    if (!Host.inHost) status('Aberto fora do After Effects (modo prévia).');
  });
  refreshContext();
  setInterval(function () { if (!document.hidden) refreshContext(); }, 1500);
  window.addEventListener('focus', refreshContext);
  if (Tools) setTimeout(checkDeps, 400);
})();
