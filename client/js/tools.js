/* Nitro - Node.js side of the panel (CEP --enable-nodejs --mixed-context). */
(function (g) {
  'use strict';
  var req = g.require || (typeof require !== 'undefined' ? require : null);
  if (!req) { g.NXTools = null; return; }

  var fs = req('fs');
  var path = req('path');
  var os = req('os');
  var cp = req('child_process');
  var https = req('https');
  var Lib = g.NXLib;

  var IS_WIN = process.platform === 'win32';
  var EXE = IS_WIN ? '.exe' : '';
  var HOME = os.homedir();
  var DATA_DIR = IS_WIN
    ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Nitro')
    : path.join(HOME, 'Library', 'Application Support', 'Nitro');
  var BIN_DIR = path.join(DATA_DIR, 'bin');

  function mkdirp(dir) {
    if (fs.existsSync(dir)) return dir;
    mkdirp(path.dirname(dir));
    try { fs.mkdirSync(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    return dir;
  }

  function extensionDir() {
    var p = g.NXHost && g.NXHost.systemPath('extension');
    return p || path.resolve(__dirname, '..');
  }

  function candidateDirs() {
    var dirs = [BIN_DIR];
    (process.env.PATH || '').split(path.delimiter).forEach(function (d) { if (d) dirs.push(d); });
    if (IS_WIN) {
      var la = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
      dirs.push(path.join(la, 'Microsoft', 'WinGet', 'Links'), 'C:\\ffmpeg\\bin', path.join(HOME, 'scoop', 'shims'), 'C:\\ProgramData\\chocolatey\\bin');
      var pyRoot = path.join(la, 'Programs', 'Python');
      try {
        fs.readdirSync(pyRoot).forEach(function (v) { dirs.push(path.join(pyRoot, v), path.join(pyRoot, v, 'Scripts')); });
      } catch (e) {}
      var wingetPkgs = path.join(la, 'Microsoft', 'WinGet', 'Packages');
      try {
        fs.readdirSync(wingetPkgs).filter(function (d) { return /ffmpeg/i.test(d); }).forEach(function (d) {
          var base = path.join(wingetPkgs, d);
          fs.readdirSync(base).forEach(function (sub) { dirs.push(path.join(base, sub, 'bin')); });
        });
      } catch (e) {}
    } else {
      dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
    }
    return dirs;
  }

  var cache = {};
  function findTool(name) {
    var custom = localStorage.getItem('nitro.path.' + name);
    if (custom && fs.existsSync(custom)) return custom;
    if (cache[name] && fs.existsSync(cache[name])) return cache[name];
    var names = name === 'python' ? (IS_WIN ? ['python.exe', 'py.exe'] : ['python3', 'python']) : [name + EXE];
    var dirs = candidateDirs();
    for (var i = 0; i < dirs.length; i++) {
      for (var j = 0; j < names.length; j++) {
        var p = path.join(dirs[i], names[j]);
        if (/WindowsApps/i.test(p)) continue; // Store python stubs
        try { if (fs.statSync(p).isFile()) { cache[name] = p; return p; } } catch (e) {}
      }
    }
    return null;
  }

  function need(name) {
    var p = findTool(name);
    if (!p) {
      var e = new Error(name + ' não encontrado. Abra ⚙ Ajustes para instalar.');
      e.missing = name;
      throw e;
    }
    return p;
  }

  // Spawns a process; onLine gets every stdout/stderr line.
  function run(bin, args, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var child = cp.spawn(bin, args, { cwd: opts.cwd, windowsHide: true, env: Object.assign({}, process.env, opts.env || {}) });
      var out = '', err = '', buf = { o: '', e: '' };
      if (opts.onSpawn) opts.onSpawn(child);
      function feed(kind, chunk) {
        var s = chunk.toString('utf8');
        if (kind === 'o') out += s; else err += s;
        if (!opts.onLine) return;
        buf[kind] += s;
        var lines = buf[kind].split(/\r?\n|\r/);
        buf[kind] = lines.pop();
        lines.forEach(function (l) { if (l) opts.onLine(l, kind); });
      }
      child.stdout.on('data', function (c) { feed('o', c); });
      child.stderr.on('data', function (c) { feed('e', c); });
      child.on('error', reject);
      child.on('close', function (code) {
        if (opts.onLine) { if (buf.o) opts.onLine(buf.o, 'o'); if (buf.e) opts.onLine(buf.e, 'e'); }
        if (code === 0 || opts.allowFail) resolve({ code: code, stdout: out, stderr: err });
        else {
          var tail = (err || out).trim().split(/\r?\n/).slice(-4).join(' | ');
          reject(new Error(path.basename(bin) + ' falhou (código ' + code + '): ' + tail));
        }
      });
    });
  }

  function probe(file) {
    var ffprobe = findTool('ffprobe');
    if (!ffprobe) return Promise.resolve(null);
    return run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).then(function (r) {
      var j = JSON.parse(r.stdout);
      var v = (j.streams || []).filter(function (s) { return s.codec_type === 'video'; })[0];
      return { vcodec: v ? v.codec_name : null, duration: parseFloat((j.format || {}).duration) || 0, pixFmt: v ? v.pix_fmt : null };
    }).catch(function () { return null; });
  }

  // ---------- download ----------
  function download(url, dir, opts) {
    opts = opts || {};
    var ytdlp = need('yt-dlp');
    var ffmpeg = findTool('ffmpeg');
    mkdirp(dir);
    var args = [url, '--no-playlist', '--newline', '--progress', '--no-mtime', '--windows-filenames',
      '-o', path.join(dir, '%(title).70B [%(id)s].%(ext)s'), '--print', 'after_move:filepath'];
    if (ffmpeg) args.push('--ffmpeg-location', path.dirname(ffmpeg));
    if (opts.audioOnly) args.push('-x', '--audio-format', 'mp3');
    else args.push('-f', 'bv*[vcodec^=avc1]+ba[ext=m4a]/b[vcodec^=avc1]/bv*+ba/b', '--merge-output-format', 'mp4');
    var finalPath = null;
    return run(ytdlp, args, {
      onSpawn: opts.onSpawn,
      onLine: function (line, kind) {
        var p = Lib.parseYtDlpProgress(line);
        if (p != null && opts.onProgress) opts.onProgress(p * (opts.audioOnly ? 1 : 0.9), 'Baixando…');
        else if (kind === 'o' && !/^\[/.test(line) && fs.existsSync(line.trim())) finalPath = line.trim();
        else if (/^\[(Merger|ExtractAudio)\]/.test(line) && opts.onProgress) opts.onProgress(90, 'Juntando áudio e vídeo…');
      }
    }).then(function () {
      if (!finalPath) throw new Error('Download terminou mas o arquivo não foi encontrado.');
      if (opts.audioOnly || opts.convert === false) return finalPath;
      return ensureEditable(finalPath, opts.onProgress);
    });
  }

  // AE 2021 struggles with VP9/AV1/HEVC: transcode anything that is not H.264.
  function ensureEditable(file, onProgress) {
    return probe(file).then(function (info) {
      if (!info || !info.vcodec || info.vcodec === 'h264') return file;
      var ffmpeg = need('ffmpeg');
      var out = file.replace(/\.[^.]+$/, '') + ' (h264).mp4';
      if (onProgress) onProgress(92, 'Convertendo ' + info.vcodec + ' → H.264…');
      return run(ffmpeg, ['-y', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', out], {
        onLine: function (l) {
          var t = Lib.parseFfmpegTime(l);
          if (t != null && info.duration && onProgress) onProgress(92 + 8 * Math.min(1, t / info.duration), 'Convertendo para H.264…');
        }
      }).then(function () { try { fs.unlinkSync(file); } catch (e) {} return out; });
    });
  }

  // ---------- clipboard ----------
  function readClipboard(dir) {
    mkdirp(dir);
    var target = path.join(dir, 'clipboard-' + Lib.timestamp() + '.png');
    if (IS_WIN) {
      var ps1 = path.join(extensionDir(), 'scripts', 'clipboard.ps1');
      return run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-OutPath', target]).then(function (r) {
        var line = r.stdout.trim().split(/\r?\n/).pop();
        var res = JSON.parse(line);
        if (res.files && !Array.isArray(res.files)) res.files = [res.files];
        return res;
      });
    }
    var script = 'try\n set f to open for access (POSIX file "' + target + '") with write permission\n write (the clipboard as «class PNGf») to f\n close access f\n return "image"\non error\n try\n close access f\n end try\n return the clipboard as text\nend try';
    return run('osascript', ['-e', script]).then(function (r) {
      var out = r.stdout.trim();
      if (out === 'image' && fs.existsSync(target)) return { type: 'image', files: [target] };
      return out ? { type: 'text', text: out } : { type: 'none' };
    });
  }

  function saveBlob(blob, dir) {
    mkdirp(dir);
    var ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    var file = path.join(dir, 'clipboard-' + Lib.timestamp() + '.' + ext);
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { fs.writeFileSync(file, Buffer.from(r.result)); resolve(file); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(blob);
    });
  }

  // ---------- audio analysis ----------
  function detectSilences(file, from, to, opts) {
    opts = opts || {};
    var ffmpeg = need('ffmpeg');
    var noise = opts.noise != null ? opts.noise : -35;
    var minSil = opts.minSilence != null ? opts.minSilence : 0.35;
    return run(ffmpeg, ['-hide_banner', '-nostats', '-ss', String(from), '-to', String(to), '-i', file, '-vn',
      '-af', 'silencedetect=noise=' + noise + 'dB:d=' + minSil, '-f', 'null', '-'], { allowFail: true }).then(function (r) {
      var sil = Lib.parseSilences(r.stderr, to - from).map(function (s) { return { start: s.start + from, end: s.end + from }; });
      return Lib.keepRanges(sil, from, to, { padding: opts.padding, minKeep: opts.minKeep });
    });
  }

  function transcribe(file, from, to, opts) {
    opts = opts || {};
    var ffmpeg = need('ffmpeg'), python = need('python');
    var tmp = path.join(mkdirp(path.join(DATA_DIR, 'tmp')), 'captions-' + Lib.timestamp() + '.wav');
    var onProgress = opts.onProgress || function () {};
    onProgress(3, 'Extraindo áudio…');
    var cleanup = function () { try { fs.unlinkSync(tmp); } catch (e) {} };
    return run(ffmpeg, ['-y', '-hide_banner', '-ss', String(from), '-to', String(to), '-i', file, '-vn', '-ac', '1', '-ar', '16000', tmp]).then(function () {
      onProgress(8, 'Carregando Whisper (' + (opts.model || 'base') + ')…');
      var words = null, pyError = null;
      var args = [path.join(extensionDir(), 'scripts', 'captions.py'), '--input', tmp, '--model', opts.model || 'base'];
      if (opts.language && opts.language !== 'auto') args.push('--language', opts.language);
      return run(python, args, {
        env: { PYTHONIOENCODING: 'utf-8' },
        onSpawn: opts.onSpawn,
        onLine: function (line, kind) {
          if (kind !== 'o' || line.charAt(0) !== '{') return;
          var msg; try { msg = JSON.parse(line); } catch (e) { return; }
          if (msg.type === 'progress') onProgress(10 + 85 * msg.p, 'Transcrevendo… ' + Math.round(msg.p * 100) + '%');
          else if (msg.type === 'status') onProgress(9, msg.message);
          else if (msg.type === 'result') words = msg.words;
          else if (msg.type === 'error') pyError = msg.message;
        }
      }).then(function () {
        if (pyError) throw new Error(pyError);
        if (!words) throw new Error('Whisper não retornou palavras.');
        return words.map(function (w) { return { start: w.start + from, end: w.end + from, word: w.word }; });
      }, function (e) { throw new Error(pyError || e.message); });
    }).then(function (r) { cleanup(); return r; }, function (e) { cleanup(); throw e; });
  }

  function hasFasterWhisper() {
    var python = findTool('python');
    if (!python) return Promise.resolve(false);
    return run(python, ['-c', 'import faster_whisper'], { allowFail: true }).then(function (r) { return r.code === 0; });
  }

  // ---------- export ----------
  function encodeMp4(input, output, duration, onProgress) {
    var ffmpeg = need('ffmpeg');
    return run(ffmpeg, ['-y', '-hide_banner', '-i', input, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output], {
      onLine: function (l) {
        var t = Lib.parseFfmpegTime(l);
        if (t != null && duration && onProgress) onProgress(50 + 50 * Math.min(1, t / duration), 'Codificando MP4…');
      }
    }).then(function () { try { fs.unlinkSync(input); } catch (e) {} return output; });
  }

  // ---------- installers ----------
  function fetchToFile(url, dest, onProgress, hops) {
    hops = hops || 0;
    return new Promise(function (resolve, reject) {
      https.get(url, { headers: { 'User-Agent': 'Nitro' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
          res.resume();
          resolve(fetchToFile(res.headers.location, dest, onProgress, hops + 1));
          return;
        }
        if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
        var total = parseInt(res.headers['content-length'], 10) || 0, got = 0;
        var tmp = dest + '.part', f = fs.createWriteStream(tmp);
        res.on('data', function (c) { got += c.length; if (total && onProgress) onProgress(100 * got / total); });
        res.pipe(f);
        f.on('finish', function () { f.close(function () { fs.renameSync(tmp, dest); resolve(dest); }); });
        f.on('error', reject);
      }).on('error', reject);
    });
  }

  function installYtDlp(onProgress) {
    mkdirp(BIN_DIR);
    var name = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp_macos';
    var dest = path.join(BIN_DIR, 'yt-dlp' + EXE);
    return fetchToFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + name, dest, onProgress).then(function (p) {
      if (!IS_WIN) fs.chmodSync(p, 0o755);
      cache['yt-dlp'] = p;
      return p;
    });
  }

  function openTerminalInstall(kind) {
    var cmds = {
      ffmpeg: IS_WIN ? 'winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements' : 'brew install ffmpeg',
      whisper: (IS_WIN ? 'python' : 'python3') + ' -m pip install -U faster-whisper',
      ytdlp: IS_WIN ? 'winget install -e --id yt-dlp.yt-dlp' : 'brew install yt-dlp'
    };
    var cmd = cmds[kind];
    if (IS_WIN) cp.spawn('cmd.exe', ['/c', 'start', 'Nitro - instalando ' + kind, 'cmd', '/k', cmd], { detached: true, windowsHide: false });
    else cp.spawn('osascript', ['-e', 'tell application "Terminal" to do script "' + cmd + '"'], { detached: true });
    return cmd;
  }

  function revealFile(p) {
    if (IS_WIN) cp.spawn('explorer.exe', ['/select,', p], { detached: true });
    else cp.spawn('open', ['-R', p], { detached: true });
  }

  function defaultDir(projectFolder, sub) {
    var base = projectFolder || path.join(HOME, 'Documents', 'Nitro');
    return path.join(base, sub);
  }

  g.NXTools = {
    IS_WIN: IS_WIN, DATA_DIR: DATA_DIR, BIN_DIR: BIN_DIR,
    path: path, fs: fs, mkdirp: mkdirp,
    findTool: findTool, run: run, probe: probe,
    download: download, ensureEditable: ensureEditable,
    readClipboard: readClipboard, saveBlob: saveBlob,
    detectSilences: detectSilences, transcribe: transcribe, hasFasterWhisper: hasFasterWhisper,
    encodeMp4: encodeMp4, installYtDlp: installYtDlp, openTerminalInstall: openTerminalInstall,
    revealFile: revealFile, defaultDir: defaultDir
  };
})(window);
