// Runs tests/host/host-tests.jsx through the open Nitro panel (CEP debug port from .debug),
// so no "allow scripts to write files" preference is needed. Usage: node tests/host/run-via-panel.js
const path = require('path');

const PORT = process.env.NITRO_DEBUG_PORT || 8099;
const jsx = path.join(__dirname, 'host-tests.jsx').replace(/\\/g, '/');

(async () => {
  let list;
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  } catch (e) {
    console.error(`Panel debug port ${PORT} not reachable. Open Window > Extensions > Nitro first.`);
    process.exit(2);
  }
  const page = list.find(p => p.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  const script = `$.evalFile(new File(${JSON.stringify(jsx)}))`;
  const expression = `NXHost.evalScript(${JSON.stringify(script)})`;
  const raw = await new Promise((resolve, reject) => {
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id !== 1) return;
      if (d.result.exceptionDetails) reject(new Error(JSON.stringify(d.result.exceptionDetails)));
      else resolve(d.result.result.value);
    };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  let results;
  try { results = JSON.parse(raw); } catch (e) {
    console.error('Unexpected answer from After Effects:', String(raw).slice(0, 400));
    process.exit(1);
  }
  const failed = results.filter(r => !r.pass);
  for (const r of results) console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name}${r.pass ? '' : ' ' + r.info}`);
  console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
