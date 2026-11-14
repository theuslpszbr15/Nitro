const test = require('node:test');
const assert = require('node:assert/strict');
const Lib = require('../client/js/lib.js');

test('extractUrl finds links inside shared text', () => {
  assert.equal(Lib.extractUrl('olha isso https://vm.tiktok.com/ZMabc123/ kkkk'), 'https://vm.tiktok.com/ZMabc123/');
  assert.equal(Lib.extractUrl('sem link'), null);
});

test('parseYtDlpProgress reads --newline progress lines', () => {
  assert.equal(Lib.parseYtDlpProgress('[download]  45.3% of   12.00MiB at  2.00MiB/s ETA 00:03'), 45.3);
  assert.equal(Lib.parseYtDlpProgress('[download] Destination: video.mp4'), null);
});

test('parseFfmpegTime handles stderr and -progress formats', () => {
  assert.equal(Lib.parseFfmpegTime('frame= 120 fps=60 time=00:01:02.50 bitrate=...'), 62.5);
  assert.equal(Lib.parseFfmpegTime('out_time_ms=1500000'), 1.5);
  assert.equal(Lib.parseFfmpegTime('nothing'), null);
});

test('parseSilences pairs start/end and closes a trailing silence', () => {
  const log = [
    '[silencedetect @ 0x1] silence_start: 1.2',
    '[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.3',
    '[silencedetect @ 0x1] silence_start: 9.1'
  ].join('\n');
  assert.deepEqual(Lib.parseSilences(log, 10), [{ start: 1.2, end: 2.5 }, { start: 9.1, end: 10 }]);
});

test('keepRanges inverts silences with padding and drops tiny pieces', () => {
  const sil = [{ start: 1, end: 2 }, { start: 2.1, end: 2.15 }, { start: 5, end: 6 }];
  const keep = Lib.keepRanges(sil, 0, 8, { padding: 0.1, minKeep: 0.15 });
  assert.deepEqual(keep.map(r => r.map(v => +v.toFixed(2))), [[0, 1.1], [1.9, 5.1], [5.9, 8]]);
});

test('keepRanges with leading silence starts after it', () => {
  const keep = Lib.keepRanges([{ start: 0, end: 1 }], 0, 3, { padding: 0 });
  assert.deepEqual(keep, [[1, 3]]);
});

test('groupWords builds caption cards respecting word, char and gap limits', () => {
  const words = [
    { start: 0, end: 0.3, word: 'isso' },
    { start: 0.3, end: 0.6, word: 'mudou' },
    { start: 0.6, end: 0.9, word: 'tudo.' },
    { start: 0.9, end: 1.2, word: 'Sério' },
    { start: 3.0, end: 3.3, word: 'olha' }
  ];
  const cards = Lib.groupWords(words, { maxWords: 3, hold: 0.25 });
  assert.deepEqual(cards.map(c => c.text), ['isso mudou tudo.', 'Sério', 'olha']);
  assert.equal(cards[0].end, 0.9);
  assert.equal(cards[1].end, 1.45);
  assert.ok(cards[2].end > cards[2].start);
});

test('groupWords breaks after a comma once the card has 2+ words', () => {
  const w = ['so', 'here', 'we', 'are,', 'one', 'of'].map((word, i) => ({ start: i * 0.3, end: i * 0.3 + 0.3, word }));
  assert.deepEqual(Lib.groupWords(w, { maxWords: 4, maxChars: 40 }).map(c => c.text), ['so here we are,', 'one of']);
  const w2 = ['Alright,', 'so', 'here'].map((word, i) => ({ start: i * 0.3, end: i * 0.3 + 0.3, word }));
  assert.deepEqual(Lib.groupWords(w2, { maxWords: 3, maxChars: 40 }).map(c => c.text), ['Alright, so here']);
});

test('hexToRgb01 converts hex to AE colors', () => {
  assert.deepEqual(Lib.hexToRgb01('#ff0000'), [1, 0, 0]);
  assert.deepEqual(Lib.hexToRgb01('bad'), [1, 1, 1]);
});

test('safeFileName strips characters Windows rejects', () => {
  assert.equal(Lib.safeFileName('Comp: 1/2?'), 'Comp_ 1_2_');
});
