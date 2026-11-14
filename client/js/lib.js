/* Nitro - pure helpers shared by the panel and the Node tests. Keep ES2018 (CEP 9/10 = Chromium 61-74). */
(function (root, factory) {
  var lib = factory();
  // CEP --mixed-context exposes both `window` and Node's `module`, so register on both.
  if (typeof window !== 'undefined') window.NXLib = lib;
  else if (root) root.NXLib = lib;
  if (typeof module === 'object' && module.exports) module.exports = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isUrl(text) {
    if (!text) return false;
    try {
      var u = new URL(String(text).trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function extractUrl(text) {
    var m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
    return m ? m[0] : null;
  }

  // yt-dlp "--newline" progress line -> 0..100 or null
  function parseYtDlpProgress(line) {
    var m = /^\[download\]\s+([\d.]+)%/.exec(String(line).trim());
    return m ? Math.min(100, parseFloat(m[1])) : null;
  }

  // ffmpeg "-progress pipe:1" / stderr "time=00:00:12.34" -> seconds or null
  function parseFfmpegTime(line) {
    var m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(line));
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    m = /out_time_ms=(\d+)/.exec(String(line));
    return m ? parseInt(m[1], 10) / 1e6 : null;
  }

  // ffmpeg silencedetect stderr -> [{start, end}]
  function parseSilences(stderr, mediaEnd) {
    var out = [], cur = null, re = /silence_(start|end):\s*(-?[\d.]+)/g, m;
    while ((m = re.exec(String(stderr)))) {
      var v = Math.max(0, parseFloat(m[2]));
      if (m[1] === 'start') cur = { start: v, end: null };
      else if (cur) { cur.end = v; out.push(cur); cur = null; }
    }
    if (cur) { cur.end = mediaEnd != null ? mediaEnd : Infinity; out.push(cur); }
    return out;
  }

  // Inverts silences inside [from, to] into ranges to keep, with padding around speech.
  function keepRanges(silences, from, to, opts) {
    opts = opts || {};
    var pad = opts.padding != null ? opts.padding : 0.08;
    var minKeep = opts.minKeep != null ? opts.minKeep : 0.15;
    var ranges = [], cursor = from;
    var sorted = silences.slice().sort(function (a, b) { return a.start - b.start; });
    sorted.forEach(function (s) {
      var sStart = Math.max(from, s.start + pad), sEnd = Math.min(to, s.end - pad);
      if (sEnd <= sStart) return;
      if (sStart > cursor) ranges.push([cursor, sStart]);
      cursor = Math.max(cursor, sEnd);
    });
    if (cursor < to) ranges.push([cursor, to]);
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] - last[1] < 0.02) last[1] = r[1];
      else merged.push([r[0], r[1]]);
    });
    return merged.filter(function (r) { return r[1] - r[0] >= minKeep; });
  }

  // Whisper words [{start,end,word}] -> caption cards [{start,end,text}]
  function groupWords(words, opts) {
    opts = opts || {};
    var maxWords = opts.maxWords || 3, maxChars = opts.maxChars || 18, maxGap = opts.maxGap != null ? opts.maxGap : 0.6;
    var hold = opts.hold != null ? opts.hold : 0.25;
    var cards = [], cur = null;
    (words || []).forEach(function (w) {
      var text = String(w.word || w.text || '').trim();
      if (!text) return;
      var gap = cur ? w.start - cur.end : 0;
      var nextText = cur ? cur.text + ' ' + text : text;
      var endsSentence = cur && (/[.!?]$/.test(cur.text) || (cur.n >= 2 && /[,;:]$/.test(cur.text)));
      if (!cur || cur.n >= maxWords || nextText.length > maxChars || gap > maxGap || endsSentence) {
        if (cur) cards.push(cur);
        cur = { start: w.start, end: w.end, text: text, n: 1 };
      } else {
        cur.text = nextText;
        cur.end = w.end;
        cur.n++;
      }
    });
    if (cur) cards.push(cur);
    for (var i = 0; i < cards.length; i++) {
      var next = cards[i + 1];
      var held = cards[i].end + hold;
      cards[i].end = next ? Math.max(cards[i].start + 0.05, Math.min(held, next.start)) : held;
      delete cards[i].n;
    }
    return cards;
  }

  function hexToRgb01(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return [1, 1, 1];
    var n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function safeFileName(name) {
    return String(name || 'arquivo').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'arquivo';
  }

  function timestamp(d) {
    d = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  return {
    isUrl: isUrl,
    extractUrl: extractUrl,
    parseYtDlpProgress: parseYtDlpProgress,
    parseFfmpegTime: parseFfmpegTime,
    parseSilences: parseSilences,
    keepRanges: keepRanges,
    groupWords: groupWords,
    hexToRgb01: hexToRgb01,
    safeFileName: safeFileName,
    timestamp: timestamp
  };
});
