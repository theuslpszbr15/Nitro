// Integration tests for client/js/tools.js using real ffmpeg / PowerShell (skipped when unavailable).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.window = { require, NXLib: require('../client/js/lib.js'), NXHost: { systemPath: () => root } };
require('../client/js/tools.js');
const T = global.window.NXTools;

const ffmpeg = T.findTool('ffmpeg');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-'));
const media = path.join(root, 'tests', 'host', 'media');

function makeSpeech(file) {
  cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=6',
    '-f', 'lavfi', '-i', "aevalsrc='(lt(t,1)+between(t,2.5,4.5)+gt(t,5.5))*0.5*sin(440*2*PI*t)':s=48000:d=6",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
}

test('detectSilences finds the speech ranges of a tone/silence clip', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
  const file = path.join(tmp, 'speech.mp4');
  makeSpeech(file);
  const keep = await T.detectSilences(file, 0, 6, { noise: -35, minSilence: 0.35, padding: 0.08 });
  assert.equal(keep.length, 3, JSON.stringify(keep));
  assert.ok(Math.abs(keep[0][0]) < 0.01 && Math.abs(keep[0][1] - 1.08) < 0.08, JSON.stringify(keep));
  assert.ok(Math.abs(keep[1][0] - 2.42) < 0.08 && Math.abs(keep[1][1] - 4.58) < 0.08, JSON.stringify(keep));
  assert.ok(Math.abs(keep[2][1] - 6) < 0.1, JSON.stringify(keep));
});

test('detectSilences respects a sub-range of the source', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
  const file = path.join(tmp, 'speech.mp4');
  if (!fs.existsSync(file)) makeSpeech(file);
  const keep = await T.detectSilences(file, 2, 6, { padding: 0 });
  assert.ok(keep[0][0] >= 2 && Math.abs(keep[0][0] - 2.5) < 0.08, JSON.stringify(keep));
});

test('ensureEditable converts VP9 to H.264 and keeps H.264 untouched', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
  const vp9 = path.join(tmp, 'clip.webm');
  cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=1', '-c:v', 'libvpx-vp9', '-b:v', '200k', vp9]);
  const out = await T.ensureEditable(vp9);
  assert.match(out, /\(h264\)\.mp4$/);
  assert.equal((await T.probe(out)).vcodec, 'h264');
  assert.equal(fs.existsSync(vp9), false);
  assert.equal(await T.ensureEditable(out), out);
});

test('encodeMp4 produces a faststart H.264 mp4 and removes the intermediate', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
  const avi = path.join(tmp, 'render.avi');
  cp.execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=1', '-c:v', 'rawvideo', '-pix_fmt', 'bgr24', avi]);
  let last = 0;
  const out = await T.encodeMp4(avi, path.join(tmp, 'final.mp4'), 1, p => { last = p; });
  const info = await T.probe(out);
  assert.equal(info.vcodec, 'h264');
  assert.equal(info.pixFmt, 'yuv420p');
  assert.equal(fs.existsSync(avi), false);
  assert.ok(last >= 50);
});

test('readClipboard saves a copied image as PNG (Windows)', { skip: !T.IS_WIN && 'windows only' }, async () => {
  const src = path.join(media, 'logo.png');
  if (!fs.existsSync(src)) return;
  const saved = cp.spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command',
    `Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $i=[System.Drawing.Image]::FromFile('${src}'); [System.Windows.Forms.Clipboard]::SetImage($i)`]);
  assert.equal(saved.status, 0, String(saved.stderr));
  const r = await T.readClipboard(tmp);
  assert.equal(r.type, 'image');
  assert.ok(fs.statSync(r.files[0]).size > 100);
});

test('readClipboard returns copied text (Windows)', { skip: !T.IS_WIN && 'windows only' }, async () => {
  cp.spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', "Set-Clipboard -Value 'olha https://www.tiktok.com/@x/video/1 ae'"]);
  const r = await T.readClipboard(tmp);
  assert.equal(r.type, 'text');
  assert.equal(global.window.NXLib.extractUrl(r.text), 'https://www.tiktok.com/@x/video/1');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
