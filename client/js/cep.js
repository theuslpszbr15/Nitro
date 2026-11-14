/* Nitro - minimal bridge to the CEP host (no Adobe CSInterface dependency). */
(function (g) {
  'use strict';
  var cep = g.__adobe_cep__;

  function evalScript(script) {
    return new Promise(function (resolve) {
      if (cep) cep.evalScript(script, resolve);
      else if (g.__NX_MOCK__) Promise.resolve(g.__NX_MOCK__(script)).then(resolve);
      else resolve('EvalScript error.');
    });
  }

  function systemPath(type) {
    if (!cep) return '';
    var p = decodeURI(cep.getSystemPath(type));
    return navigator.platform.indexOf('Win') === 0 ? p.replace('file:///', '') : p.replace('file://', '');
  }

  var hostLoaded = null;
  function ensureHost() {
    if (hostLoaded) return hostLoaded;
    hostLoaded = evalScript('typeof NX').then(function (t) {
      if (t === 'object' || !cep) return;
      var jsx = (systemPath('extension') + '/host/nitro.jsx').replace(/\\/g, '/');
      return evalScript('$.evalFile(' + JSON.stringify(jsx) + ')');
    });
    return hostLoaded;
  }

  function call(fn, args) {
    var script = 'NX.run(' + JSON.stringify(fn) + ',' + JSON.stringify(args == null ? null : args) + ')';
    return ensureHost().then(function () { return evalScript(script); }).then(function (raw) {
      var res;
      try { res = JSON.parse(raw); } catch (e) {
        throw new Error('O After Effects não respondeu (' + String(raw).slice(0, 120) + ')');
      }
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
  }

  function openUrl(url) {
    if (cep && cep.invokeSync) {
      try { cep.invokeSync('openURLInDefaultBrowser', url); return; } catch (e) {}
    }
    g.open(url);
  }

  g.NXHost = { call: call, evalScript: evalScript, systemPath: systemPath, openUrl: openUrl, inHost: !!cep };
})(window);
