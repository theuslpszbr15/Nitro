/*
 * Nitro host tests. Run inside After Effects:
 *   AfterFX.exe -r tests\host\host-tests.jsx
 * Requires an empty project. Writes tests\host\results.json.
 */
#include "../../host/nitro.jsx"

var NX_TEST_RESULTS = (function () {
    var here = new File($.fileName).parent;
    var media = new Folder(here.fsName + "/media");
    var results = [];

    function call(fn, args) { return eval("(" + NX.run(fn, args) + ")"); }
    function ok(name, cond, info) { results.push({ name: name, pass: !!cond, info: info === undefined ? "" : String(info) }); }
    function near(a, b, eps) { return Math.abs(a - b) <= (eps || 0.01); }
    function nearArr(a, b, eps) { for (var i = 0; i < b.length; i++) if (!near(a[i], b[i], eps)) return false; return true; }
    function tryCase(name, fn) {
        try { fn(); } catch (e) { ok(name + " (exception)", false, e.toString() + " line " + e.line); }
    }
    function select(comp, layers) {
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        for (var j = 0; j < layers.length; j++) layers[j].selected = true;
    }
    function T(l) { return l.property("ADBE Transform Group"); }

    if (app.project.numItems > 0) {
        if (app.project.dirty || app.project.file) {
            ok("empty project required (File > New Project before running)", false, app.project.numItems + " items");
            return writeResults();
        }
        app.newProject();
    }
    var comp = app.project.items.addComp("NX_TEST", 1920, 1080, 1, 10, 30);
    comp.openInViewer();
    comp.time = 0;

    tryCase("ping", function () {
        var r = call("ping");
        ok("ping returns version", r.ok && r.data.version === "1.0.0", r.data && r.data.ae);
    });

    tryCase("context", function () {
        var r = call("context");
        ok("context sees active comp", r.ok && r.data.comp && r.data.comp.name === "NX_TEST", stringifyRes(r));
    });

    tryCase("anchor top-left keeps solid still", function () {
        var s = comp.layers.addSolid([1, 0, 0], "A", 400, 200, 1);
        select(comp, [s]);
        var r = call("anchor", { x: 0, y: 0 });
        ok("anchor -> [0,0]", r.ok && nearArr(T(s).property("ADBE Anchor Point").value, [0, 0]), stringifyRes(r));
        ok("position compensated", nearArr(T(s).property("ADBE Position").value, [760, 440]), T(s).property("ADBE Position").value);
        s.remove();
    });

    tryCase("anchor with scale+rotation", function () {
        var s = comp.layers.addSolid([0, 1, 0], "B", 400, 200, 1);
        T(s).property("ADBE Scale").setValue([50, 150]);
        T(s).property("ADBE Rotate Z").setValue(33);
        var before = NX._visualCenter(s, 0);
        select(comp, [s]);
        call("anchor", { x: 1, y: 1 });
        var after = NX._visualCenter(s, 0);
        ok("visual center unchanged (rot/scale)", nearArr(after, before, 0.05), before.join(",") + " vs " + after.join(","));
        ok("anchor bottom-right", nearArr(T(s).property("ADBE Anchor Point").value, [400, 200]));
        s.remove();
    });

    tryCase("anchor with keyframed + separated position + parent", function () {
        var nul = comp.layers.addNull();
        T(nul).property("ADBE Scale").setValue([200, 200]);
        var s = comp.layers.addSolid([0, 0, 1], "C", 300, 300, 1);
        s.parent = nul;
        var pos = T(s).property("ADBE Position");
        pos.dimensionsSeparated = true;
        T(s).property("ADBE Position_0").setValueAtTime(0, 100);
        T(s).property("ADBE Position_0").setValueAtTime(1, 300);
        var before = NX._visualCenter(s, 0);
        select(comp, [s]);
        var r = call("anchor", { x: 0, y: 0.5 });
        ok("anchor separated/parented ok", r.ok, stringifyRes(r));
        ok("visual center unchanged (separated)", nearArr(NX._visualCenter(s, 0), before, 0.05));
        ok("all X keys shifted", near(T(s).property("ADBE Position_0").keyValue(2) - T(s).property("ADBE Position_0").keyValue(1), 200));
        s.remove(); nul.remove();
    });

    tryCase("text anchor center + align", function () {
        var t = comp.layers.addText("VIRAL");
        T(t).property("ADBE Position").setValue([200, 150]);
        select(comp, [t]);
        call("anchor", { x: 0.5, y: 0.5 });
        var r = t.sourceRectAtTime(0, false), ap = T(t).property("ADBE Anchor Point").value;
        ok("text anchor at rect center", nearArr(ap, [r.left + r.width / 2, r.top + r.height / 2], 0.05));
        var res = call("align", { h: true, v: true });
        ok("align centered text", res.ok && nearArr(NX._visualCenter(t, 0), [960, 540], 0.05), NX._visualCenter(t, 0));
        t.remove();
    });

    tryCase("align horizontal only", function () {
        var s = comp.layers.addSolid([1, 1, 0], "D", 100, 100, 1);
        T(s).property("ADBE Position").setValue([100, 100]);
        select(comp, [s]);
        call("align", { h: true, v: false });
        ok("only X centered", nearArr(T(s).property("ADBE Position").value, [960, 100]));
        s.remove();
    });

    tryCase("fit modes", function () {
        var s = comp.layers.addSolid([1, 0, 1], "E", 400, 200, 1);
        select(comp, [s]);
        call("fit", { mode: "fill" });
        ok("fill scale 540", near(T(s).property("ADBE Scale").value[0], 540));
        call("fit", { mode: "fit" });
        ok("fit scale 480", near(T(s).property("ADBE Scale").value[0], 480));
        ok("fit centered", nearArr(NX._visualCenter(s, 0), [960, 540], 0.05));
        s.remove();
    });

    tryCase("presets", function () {
        var names = ["zoomPunch", "popIn", "shake", "slideUp", "slideLeft", "fadeIn", "fadeOut", "kenBurns", "bounce"];
        for (var i = 0; i < names.length; i++) {
            var s = comp.layers.addSolid([0.5, 0.5, 0.5], "P_" + names[i], 200, 200, 1);
            comp.time = 1;
            select(comp, [s]);
            if (names[i] === "bounce") call("preset", { name: "popIn" });
            var r = call("preset", { name: names[i] });
            ok("preset " + names[i], r.ok, stringifyRes(r));
            s.remove();
        }
        comp.time = 0;
        var s2 = comp.layers.addSolid([0.5, 0.5, 0.5], "PZ", 200, 200, 1);
        select(comp, [s2]);
        call("preset", { name: "zoomPunch" });
        var sc = T(s2).property("ADBE Scale");
        ok("zoomPunch 3 keys peak 115", sc.numKeys === 3 && near(sc.keyValue(2)[0], 115));
        call("preset", { name: "shake" });
        ok("shake expression set", T(s2).property("ADBE Position").expressionEnabled && T(s2).property("ADBE Position").expressionError === "", T(s2).property("ADBE Position").expressionError);
        s2.remove();
        var s3 = comp.layers.addSolid([0.5, 0.5, 0.5], "PN", 200, 200, 1);
        select(comp, [s3]);
        var rb = call("preset", { name: "bounce" });
        ok("bounce without keys fails nicely", !rb.ok && rb.error.indexOf("keyframes") >= 0, rb.error);
        s3.remove();
    });

    tryCase("text block + words", function () {
        comp.time = 2;
        var r = call("text", { text: "isso mudou tudo", mode: "single", dur: 2, style: { font: "Arial-Black", size: 100, strokeWidth: 10, upper: true } });
        ok("text single created", r.ok && r.data.count === 1, stringifyRes(r));
        var l = comp.layer(1);
        ok("text uppercased", l.property("ADBE Text Properties").property("ADBE Text Document").value.text === "ISSO MUDOU TUDO");
        ok("text timing", near(l.inPoint, 2) && near(l.outPoint, 4));
        ok("text pop expr no error", T(l).property("ADBE Scale").expressionError === "", T(l).property("ADBE Scale").expressionError);
        l.remove();
        var r2 = call("text", { text: "um dois tres quatro cinco", mode: "words", perCard: 2, dur: 0.5, style: { font: "NaoExisteFont-XYZ" } });
        ok("words -> 3 cards", r2.ok && r2.data.count === 3, stringifyRes(r2));
        ok("bad font falls back", r2.ok && r2.data.font !== "NaoExisteFont-XYZ", r2.data && r2.data.font);
        for (var i = 0; i < 3; i++) comp.layer(1).remove();
        comp.time = 0;
    });

    var video = new File(media.fsName + "/speech.mp4");
    var image = new File(media.fsName + "/logo.png");

    tryCase("importFiles", function () {
        var r = call("importFiles", { paths: [video.fsName, image.fsName], addToComp: true, fit: "fit" });
        ok("import 2 files into comp", r.ok && r.data.imported.length === 2 && r.data.comp === "NX_TEST", stringifyRes(r));
        var img = comp.layer(1);
        ok("image spans to comp end", near(img.outPoint, comp.duration));
        img.remove();
    });

    tryCase("layerSource + jumpCut + captions", function () {
        var v = comp.layer(1);
        v.startTime = 1;
        select(comp, [v]);
        var src = call("layerSource");
        ok("layerSource path", src.ok && src.data.path.indexOf("speech.mp4") > 0 && src.data.hasAudio, stringifyRes(src));
        ok("layerSource range", src.ok && near(src.data.srcIn, 0) && near(src.data.srcOut, 6, 0.05), stringifyRes(src));
        var cap = call("captions", { items: [{ start: 0.1, end: 0.9, text: "ola" }, { start: 2.6, end: 4.4, text: "mundo viral" }], startTime: src.data.startTime, stretch: 100, style: {} });
        ok("captions created", cap.ok && cap.data.count === 2, stringifyRes(cap));
        ok("caption timing offset by layer start", near(comp.layer(1).inPoint, 3.6, 0.04) && near(comp.layer(2).inPoint, 1.1, 0.04), comp.layer(1).inPoint + "," + comp.layer(2).inPoint);
        comp.layer(1).remove(); comp.layer(1).remove();
        select(comp, [v]);
        var jc = call("jumpCut", { keep: [[0, 1.1], [2.4, 4.6], [5.4, 6]] });
        ok("jumpCut 3 parts", jc.ok && jc.data.parts === 3, stringifyRes(jc));
        ok("jumpCut removed 2.1s", jc.ok && near(jc.data.removed, 2.1, 0.05), jc.data && jc.data.removed);
        var ends = [];
        for (var i = 1; i <= comp.numLayers; i++) ends.push(comp.layer(i).inPoint.toFixed(2) + "-" + comp.layer(i).outPoint.toFixed(2));
        ok("jumpCut contiguous", ends.join(" ").indexOf("1.00-2.10") >= 0 && ends.join(" ").indexOf("2.10-4.30") >= 0 && ends.join(" ").indexOf("4.30-4.90") >= 0, ends.join(" "));
        while (comp.numLayers > 1) comp.layer(1).remove();
    });

    tryCase("toVertical", function () {
        var r = call("toVertical", { blurBg: true });
        ok("vertical comp created", r.ok, stringifyRes(r));
        var vc = app.project.activeItem;
        ok("vertical is 1080x1920 with 2 layers", vc && vc.width === 1080 && vc.height === 1920 && vc.numLayers === 2, vc && (vc.width + "x" + vc.height + " " + vc.numLayers));
        var fg = vc.layer(1);
        ok("fg fits width", near(fg.property("ADBE Transform Group").property("ADBE Scale").value[0], 56.25));
        vc.remove();
        comp.openInViewer();
    });

    tryCase("renderLossless", function () {
        var small = app.project.items.addComp("NX_RENDER", 320, 240, 1, 1, 30);
        small.layers.addSolid([1, 0.2, 0.4], "bg", 320, 240, 1);
        small.layers.addText("NX");
        small.openInViewer();
        var out = here.fsName + "/media/nx_render_" + new Date().getTime() + ".avi";
        var r = call("renderLossless", { outPath: out });
        ok("render done", r.ok, stringifyRes(r));
        ok("render file exists", r.ok && new File(r.data.path).exists, r.data && r.data.path);
        if (r.ok) results.push({ name: "renderPath", pass: true, info: r.data.path });
        small.remove();
        comp.openInViewer();
    });

    tryCase("organize", function () {
        var r = call("organize");
        ok("organize moved items", r.ok && r.data.moved >= 1, stringifyRes(r));
    });

    tryCase("undo groups", function () {
        var r = call("nope");
        ok("unknown fn returns error json", !r.ok && r.error.indexOf("desconhecida") >= 0);
    });

    function stringifyRes(r) { return NX.stringify(r); }

    return writeResults();

    function writeResults() {
        var json = NX.stringify(results);
        if (typeof NX_TEST_WRITE_FILE !== "undefined" && NX_TEST_WRITE_FILE) {
            var f = new File(here.fsName + "/results.json");
            f.encoding = "UTF-8";
            f.open("w");
            f.write(json);
            f.close();
        }
        return json;
    }
})();
NX_TEST_RESULTS;
