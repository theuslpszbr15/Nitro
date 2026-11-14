/*
 * Nitro - host (ExtendScript, ES3).
 * Panel calls NX.run("fnName", argsObject) and always receives a JSON string:
 *   {"ok":true,"data":...}  or  {"ok":false,"error":"..."}
 * Keep this file ASCII-only; accents use \u escapes.
 */
var NX = (function () {
    var VERSION = "1.0.0";

    // ---------- JSON ----------
    function q(s) {
        s = String(s);
        var out = '"', c, code;
        for (var i = 0; i < s.length; i++) {
            c = s.charAt(i);
            code = s.charCodeAt(i);
            if (c === '"') out += '\\"';
            else if (c === "\\") out += "\\\\";
            else if (c === "\n") out += "\\n";
            else if (c === "\r") out += "\\r";
            else if (c === "\t") out += "\\t";
            else if (code < 32 || code > 126) {
                var h = code.toString(16);
                while (h.length < 4) h = "0" + h;
                out += "\\u" + h;
            } else out += c;
        }
        return out + '"';
    }

    function stringify(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return v ? "true" : "false";
        if (t === "string") return q(v);
        if (v instanceof Array) {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(stringify(v[i]));
            return "[" + a.join(",") + "]";
        }
        var parts = [];
        for (var k in v) {
            if (v.hasOwnProperty(k) && typeof v[k] !== "function") parts.push(q(k) + ":" + stringify(v[k]));
        }
        return "{" + parts.join(",") + "}";
    }

    // ---------- helpers ----------
    function fail(msg) { throw new Error(msg); }

    function activeComp() {
        var c = app.project.activeItem;
        if (c && c instanceof CompItem) return c;
        fail("Abra uma composi\u00e7\u00e3o na timeline primeiro.");
    }

    function selectedLayers(comp, required) {
        var out = [];
        for (var i = 0; i < comp.selectedLayers.length; i++) out.push(comp.selectedLayers[i]);
        if (required && out.length === 0) fail("Selecione pelo menos uma camada.");
        return out;
    }

    function hasTransform(l) {
        return !(l instanceof CameraLayer) && !(l instanceof LightLayer);
    }

    function layerRect(l, t) {
        if (l.sourceRectAtTime) {
            try {
                var r = l.sourceRectAtTime(t, false);
                if (r && r.width > 0 && r.height > 0) return r;
            } catch (e) {}
        }
        return { left: 0, top: 0, width: l.width || 100, height: l.height || 100 };
    }

    function tr(l) { return l.property("ADBE Transform Group"); }
    function P(l, match) { return tr(l).property(match); }

    function easeDims(prop) {
        var t = prop.propertyValueType;
        if (t === PropertyValueType.TwoD) return 2;
        if (t === PropertyValueType.ThreeD) return 3;
        return 1;
    }

    function easeKey(prop, idx, inflIn, inflOut) {
        var n = easeDims(prop), a = [], b = [];
        for (var i = 0; i < n; i++) {
            a.push(new KeyframeEase(0, Math.max(0.1, inflIn)));
            b.push(new KeyframeEase(0, Math.max(0.1, inflOut)));
        }
        try {
            prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            prop.setTemporalEaseAtKey(idx, a, b);
        } catch (e) {}
    }

    function addArr(a, d) {
        if (typeof a === "number") return a + d[0];
        var r = [];
        for (var i = 0; i < a.length; i++) r.push(a[i] + (i < d.length ? d[i] : 0));
        return r;
    }

    function mulArr(a, k) {
        if (typeof a === "number") return a * k;
        var r = [];
        for (var i = 0; i < a.length; i++) r.push(a[i] * k);
        return r;
    }

    // Shifts a property's static value or every keyframe by delta.
    function offsetProp(prop, delta) {
        if (prop.numKeys > 0) {
            for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtKey(k, addArr(prop.keyValue(k), delta));
        } else {
            prop.setValue(addArr(prop.value, delta));
        }
    }

    // Moves the layer in its parent space by [dx, dy], handling separated dimensions.
    function offsetPosition(l, dx, dy) {
        var pos = P(l, "ADBE Position");
        if (pos.dimensionsSeparated) {
            offsetProp(P(l, "ADBE Position_0"), [dx]);
            offsetProp(P(l, "ADBE Position_1"), [dy]);
        } else {
            offsetProp(pos, [dx, dy]);
        }
    }

    function positionAt(l, t) {
        var pos = P(l, "ADBE Position");
        if (pos.dimensionsSeparated) {
            return [P(l, "ADBE Position_0").valueAtTime(t, false), P(l, "ADBE Position_1").valueAtTime(t, false)];
        }
        return pos.valueAtTime(t, false);
    }

    // Layer-space vector -> parent-space vector (scale + Z rotation).
    function layerToParentVec(l, v, t) {
        var s = P(l, "ADBE Scale").valueAtTime(t, false);
        var rot = P(l, "ADBE Rotate Z").valueAtTime(t, false) * Math.PI / 180;
        var x = v[0] * s[0] / 100, y = v[1] * s[1] / 100;
        return [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
    }

    function withoutParent(l, fn) {
        var parent = l.parent;
        if (parent) l.parent = null;
        try { fn(); } finally { if (parent) l.parent = parent; }
    }

    // nx, ny in 0..1 over the layer's visible bounds. Keeps the layer visually still.
    function setAnchor(l, nx, ny, t) {
        var r = layerRect(l, t);
        var ap = P(l, "ADBE Anchor Point");
        var cur = ap.valueAtTime(t, false);
        var dx = r.left + r.width * nx - cur[0];
        var dy = r.top + r.height * ny - cur[1];
        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return false;
        var d = layerToParentVec(l, [dx, dy], t);
        offsetProp(ap, [dx, dy]);
        offsetPosition(l, d[0], d[1]);
        return true;
    }

    function visualCenter(l, t) {
        var r = layerRect(l, t);
        var ap = P(l, "ADBE Anchor Point").valueAtTime(t, false);
        var d = layerToParentVec(l, [r.left + r.width / 2 - ap[0], r.top + r.height / 2 - ap[1]], t);
        var p = positionAt(l, t);
        return [p[0] + d[0], p[1] + d[1]];
    }

    function centerLayer(l, comp, h, v) {
        var t = comp.time;
        withoutParent(l, function () {
            var c = visualCenter(l, t);
            offsetPosition(l, h ? comp.width / 2 - c[0] : 0, v ? comp.height / 2 - c[1] : 0);
        });
    }

    function fitLayer(l, comp, mode) {
        var t = comp.time;
        withoutParent(l, function () {
            var r = layerRect(l, t);
            var sx = comp.width / r.width * 100, sy = comp.height / r.height * 100, s;
            if (mode === "fill") s = Math.max(sx, sy);
            else if (mode === "width") s = sx;
            else if (mode === "height") s = sy;
            else s = Math.min(sx, sy);
            var sc = P(l, "ADBE Scale");
            var cur = sc.valueAtTime(t, false);
            var nv = [cur[0] < 0 ? -s : s, cur[1] < 0 ? -s : s];
            if (cur.length > 2) nv.push(cur[2]);
            if (sc.numKeys > 0) sc.setValueAtTime(t, nv); else sc.setValue(nv);
        });
        centerLayer(l, comp, true, true);
    }

    function setKeys(prop, times, values, inflIn, inflOut) {
        for (var i = 0; i < times.length; i++) prop.setValueAtTime(times[i], values[i]);
        for (var j = 0; j < times.length; j++) {
            var idx = prop.nearestKeyIndex(times[j]);
            easeKey(prop, idx, inflIn === undefined ? 75 : inflIn, inflOut === undefined ? 75 : inflOut);
        }
    }

    function getOrAddSlider(l, name) {
        var fx = l.property("ADBE Effect Parade");
        var e = fx.property(name);
        if (!e) {
            e = fx.addProperty("ADBE Slider Control");
            e.name = name;
        }
        return e.property(1);
    }

    function posProps(l) {
        var pos = P(l, "ADBE Position");
        if (pos.dimensionsSeparated) return [P(l, "ADBE Position_0"), P(l, "ADBE Position_1")];
        return [pos];
    }

    var BOUNCE_EXPR = [
        "// Nitro bounce",
        "var amp = 0.06, freq = 2.5, decay = 6;",
        "var n = 0;",
        "if (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; }",
        "var t = n > 0 ? time - key(n).time : 0;",
        "if (n > 0 && t < 1.5) {",
        "  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);",
        "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);",
        "} else { value; }"
    ].join("\n");

    var CAPTION_POP_EXPR = [
        "// Nitro caption pop",
        "var t = time - inPoint;",
        "var s = t < 0.08 ? linear(t, 0, 0.08, 75, 108) : ease(t, 0.08, 0.18, 108, 100);",
        "value * (s / 100);"
    ].join("\n");

    // ---------- presets ----------
    var PRESETS = {
        zoomPunch: function (l, t) {
            var sc = P(l, "ADBE Scale"), b = sc.valueAtTime(t, false);
            setKeys(sc, [t, t + 0.1, t + 0.35], [b, mulArr(b, 1.15), b], 80, 80);
        },
        popIn: function (l, t) {
            var sc = P(l, "ADBE Scale"), b = sc.valueAtTime(t, false);
            var op = P(l, "ADBE Opacity"), o = op.valueAtTime(t, false);
            setKeys(sc, [t, t + 0.2, t + 0.33], [mulArr(b, 0), mulArr(b, 1.1), b], 60, 80);
            setKeys(op, [t, t + 0.12], [0, o], 50, 50);
        },
        shake: function (l, t) {
            var amp = getOrAddSlider(l, "Nitro Shake");
            setKeys(amp, [t, t + 0.5], [40, 0], 10, 70);
            var props = posProps(l);
            for (var i = 0; i < props.length; i++) {
                props[i].expression = 'wiggle(18, effect("Nitro Shake")(1))';
            }
        },
        slideUp: function (l, t) { slide(l, t, 0, 350); },
        slideLeft: function (l, t) { slide(l, t, 450, 0); },
        fadeIn: function (l, t) {
            var op = P(l, "ADBE Opacity"), o = op.valueAtTime(t, false);
            setKeys(op, [t, t + 0.3], [0, o], 33, 33);
        },
        fadeOut: function (l, t) {
            var op = P(l, "ADBE Opacity"), o = op.valueAtTime(t, false);
            setKeys(op, [t, t + 0.3], [o, 0], 33, 33);
        },
        kenBurns: function (l, t) {
            var sc = P(l, "ADBE Scale"), b = sc.valueAtTime(l.inPoint, false);
            setKeys(sc, [l.inPoint, l.outPoint], [b, mulArr(b, 1.12)], 20, 20);
        },
        bounce: function (l) {
            var targets = [], sel = l.selectedProperties, i;
            for (i = 0; i < sel.length; i++) {
                if (sel[i].propertyType === PropertyType.PROPERTY && sel[i].canSetExpression && sel[i].numKeys > 0) targets.push(sel[i]);
            }
            if (targets.length === 0) {
                var cands = [P(l, "ADBE Scale"), P(l, "ADBE Rotate Z")].concat(posProps(l));
                for (i = 0; i < cands.length; i++) if (cands[i].numKeys > 0) targets.push(cands[i]);
            }
            if (targets.length === 0) fail("Bounce precisa de keyframes (ex.: use Pop In antes).");
            for (i = 0; i < targets.length; i++) targets[i].expression = BOUNCE_EXPR;
        },
        strongEase: function (l) {
            var sel = l.selectedProperties, n = 0;
            for (var i = 0; i < sel.length; i++) {
                var p = sel[i];
                if (p.propertyType !== PropertyType.PROPERTY || !p.selectedKeys) continue;
                var keys = p.selectedKeys;
                for (var k = 0; k < keys.length; k++) { easeKey(p, keys[k], 85, 85); n++; }
            }
            if (n === 0) fail("Selecione keyframes para aplicar o Ease Forte.");
        }
    };

    function slide(l, t, dx, dy) {
        var props = posProps(l);
        if (props.length === 2) {
            var x = props[0], y = props[1], bx = x.valueAtTime(t, false), by = y.valueAtTime(t, false);
            if (dx) setKeys(x, [t, t + 0.4], [bx + dx, bx], 0.1, 90);
            if (dy) setKeys(y, [t, t + 0.4], [by + dy, by], 0.1, 90);
        } else {
            var p = props[0], b = p.valueAtTime(t, false);
            setKeys(p, [t, t + 0.4], [addArr(b, [dx, dy]), b], 0.1, 90);
        }
    }

    // ---------- text ----------
    function styleText(layer, style) {
        var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var d = prop.value;
        d.fontSize = style.size || 90;
        d.applyFill = true;
        d.fillColor = style.fill || [1, 1, 1];
        d.applyStroke = style.strokeWidth > 0;
        if (d.applyStroke) {
            d.strokeColor = style.stroke || [0, 0, 0];
            d.strokeWidth = style.strokeWidth;
            d.strokeOverFill = false;
        }
        d.justification = ParagraphJustification.CENTER_JUSTIFY;
        d.tracking = style.tracking || 0;
        if (style.font) d.font = style.font;
        prop.setValue(d);
        if (style.font && prop.value.font !== style.font) {
            d = prop.value;
            d.font = "Arial-Black";
            prop.setValue(d);
        }
        return prop.value.font;
    }

    function createTextLayers(comp, items, style) {
        var created = [], usedFont = null;
        var y = comp.height * (style.posY === undefined ? 0.72 : style.posY);
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var txt = style.upper ? String(it.text).toUpperCase() : String(it.text);
            var l = comp.layers.addText(txt);
            usedFont = styleText(l, style);
            l.name = (style.prefix || "Nitro Texto") + " " + (i + 1);
            l.label = 11;
            l.startTime = 0;
            l.inPoint = Math.max(0, it.start);
            l.outPoint = Math.min(comp.duration, Math.max(it.end, it.start + comp.frameDuration));
            setAnchor(l, 0.5, 0.5, l.inPoint);
            var pos = P(l, "ADBE Position");
            if (pos.dimensionsSeparated) {
                P(l, "ADBE Position_0").setValue(comp.width / 2);
                P(l, "ADBE Position_1").setValue(y);
            } else {
                var pv = pos.value;
                pos.setValue(pv.length > 2 ? [comp.width / 2, y, pv[2]] : [comp.width / 2, y]);
            }
            if (style.animate !== false) P(l, "ADBE Scale").expression = CAPTION_POP_EXPR;
            created.push(l);
        }
        for (var j = 0; j < created.length; j++) created[j].selected = true;
        return { count: created.length, font: usedFont };
    }

    function chunkWords(text, perCard, dur, start) {
        var words = String(text).replace(/^\s+|\s+$/g, "").split(/\s+/), items = [], t = start;
        for (var i = 0; i < words.length; i += perCard) {
            items.push({ start: t, end: t + dur, text: words.slice(i, i + perCard).join(" ") });
            t += dur;
        }
        return items;
    }

    // ---------- project helpers ----------
    function getFolder(name) {
        var items = app.project.items;
        for (var i = 1; i <= items.length; i++) {
            if (items[i] instanceof FolderItem && items[i].name === name && items[i].parentFolder === app.project.rootFolder) return items[i];
        }
        return items.addFolder(name);
    }

    var IMG_EXT = /\.(png|jpe?g|gif|bmp|tiff?|psd|ai|eps|svg|webp|exr|tga)$/i;

    function selectedFootageLayer(comp) {
        var sel = selectedLayers(comp, true);
        var l = sel[0];
        if (!(l instanceof AVLayer) || !(l.source instanceof FootageItem) || !l.source.file) {
            fail("Selecione uma camada de v\u00eddeo/\u00e1udio (arquivo importado).");
        }
        return l;
    }

    // ---------- public API ----------
    var api = {
        ping: function () {
            return { version: VERSION, ae: app.version, build: app.buildName };
        },

        context: function () {
            var c = app.project.activeItem, comp = null;
            if (c && c instanceof CompItem) {
                comp = { name: c.name, width: c.width, height: c.height, fps: c.frameRate, duration: c.duration, time: c.time, selected: c.selectedLayers.length };
            }
            return {
                comp: comp,
                projectFolder: app.project.file ? app.project.file.parent.fsName : null,
                projectName: app.project.file ? app.project.file.name : null
            };
        },

        importFiles: function (a) {
            var paths = a.paths || [], imported = [], comp = null, folder = getFolder("Nitro");
            if (a.addToComp) {
                var c = app.project.activeItem;
                if (c && c instanceof CompItem) comp = c;
            }
            for (var i = 0; i < paths.length; i++) {
                var f = new File(paths[i]);
                if (!f.exists) fail("Arquivo n\u00e3o encontrado: " + paths[i]);
                var opts = new ImportOptions(f);
                if (opts.canImportAs(ImportAsType.FOOTAGE)) opts.importAs = ImportAsType.FOOTAGE;
                var item = app.project.importFile(opts);
                item.parentFolder = folder;
                var info = { name: item.name, layer: null };
                if (comp) {
                    var l = comp.layers.add(item);
                    l.startTime = comp.time;
                    if (IMG_EXT.test(f.name) || (item.mainSource && item.mainSource.isStill)) {
                        l.outPoint = comp.duration;
                    }
                    if (a.fit) fitLayer(l, comp, a.fit);
                    info.layer = l.name;
                }
                imported.push(info);
            }
            return { imported: imported, comp: comp ? comp.name : null };
        },

        anchor: function (a) {
            var comp = activeComp(), layers = selectedLayers(comp, true), n = 0;
            for (var i = 0; i < layers.length; i++) {
                if (!hasTransform(layers[i])) continue;
                if (setAnchor(layers[i], a.x, a.y, comp.time)) n++;
            }
            return { changed: n };
        },

        align: function (a) {
            var comp = activeComp(), layers = selectedLayers(comp, true);
            for (var i = 0; i < layers.length; i++) {
                if (hasTransform(layers[i])) centerLayer(layers[i], comp, !!a.h, !!a.v);
            }
            return { changed: layers.length };
        },

        fit: function (a) {
            var comp = activeComp(), layers = selectedLayers(comp, true);
            for (var i = 0; i < layers.length; i++) {
                if (hasTransform(layers[i])) fitLayer(layers[i], comp, a.mode);
            }
            return { changed: layers.length };
        },

        preset: function (a) {
            var fn = PRESETS[a.name];
            if (!fn) fail("Preset desconhecido: " + a.name);
            var comp = activeComp(), layers = selectedLayers(comp, true);
            for (var i = 0; i < layers.length; i++) {
                if (hasTransform(layers[i])) fn(layers[i], comp.time);
            }
            return { changed: layers.length };
        },

        text: function (a) {
            var comp = activeComp();
            if (!a.text || !String(a.text).replace(/\s/g, "")) fail("Digite um texto.");
            var items = a.mode === "words"
                ? chunkWords(a.text, Math.max(1, a.perCard || 2), Math.max(comp.frameDuration, a.dur || 0.5), comp.time)
                : [{ start: comp.time, end: Math.min(comp.duration, comp.time + (a.dur || 2)), text: a.text }];
            return createTextLayers(comp, items, a.style || {});
        },

        layerSource: function () {
            var comp = activeComp(), l = selectedFootageLayer(comp);
            var stretch = l.stretch;
            return {
                path: l.source.file.fsName,
                name: l.name,
                index: l.index,
                stretch: stretch,
                startTime: l.startTime,
                timeRemap: l.timeRemapEnabled,
                srcIn: (l.inPoint - l.startTime) * 100 / stretch,
                srcOut: (l.outPoint - l.startTime) * 100 / stretch,
                hasAudio: l.hasAudio,
                hasVideo: l.hasVideo
            };
        },

        captions: function (a) {
            var comp = activeComp(), items = [], k = (a.stretch || 100) / 100;
            for (var i = 0; i < a.items.length; i++) {
                var it = a.items[i];
                items.push({ start: a.startTime + it.start * k, end: a.startTime + it.end * k, text: it.text });
            }
            if (items.length === 0) fail("Nenhuma fala encontrada no \u00e1udio.");
            var style = a.style || {};
            style.prefix = "Nitro Legenda";
            return createTextLayers(comp, items, style);
        },

        // keep: [[srcStart, srcEnd], ...] in source seconds
        jumpCut: function (a) {
            var comp = activeComp(), l = selectedFootageLayer(comp);
            if (l.timeRemapEnabled || Math.abs(l.stretch - 100) > 0.001) fail("Desative Time Remap/Stretch da camada antes do corte.");
            var keep = a.keep;
            if (!keep || keep.length === 0) fail("Nenhum trecho com fala encontrado.");
            var originalLen = l.outPoint - l.inPoint;
            var parts = [l];
            for (var i = 1; i < keep.length; i++) parts.push(l.duplicate());
            var cur = l.inPoint;
            for (var j = 0; j < keep.length; j++) {
                var L = parts[j], s = keep[j][0], e = keep[j][1];
                L.startTime = cur - s;
                L.inPoint = cur;
                L.outPoint = cur + (e - s);
                L.name = l.source.name + " [corte " + (j + 1) + "]";
                cur += e - s;
            }
            return { parts: keep.length, removed: originalLen - (cur - parts[0].inPoint) };
        },

        toVertical: function (a) {
            var src = activeComp(), w = a.width || 1080, h = a.height || 1920;
            var nc = app.project.items.addComp(src.name + " 9x16", w, h, 1, src.duration, src.frameRate);
            nc.parentFolder = src.parentFolder;
            if (a.blurBg) {
                var bg = nc.layers.add(src);
                bg.name = "Nitro Fundo Blur";
                fitLayer(bg, nc, "fill");
                var blur = bg.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
                blur.property(1).setValue(a.blur || 60);
                try { blur.property(3).setValue(1); } catch (e) {}
                bg.property("ADBE Transform Group").property("ADBE Opacity").setValue(85);
                bg.audioEnabled = false;
            }
            var fg = nc.layers.add(src);
            fg.name = "Nitro Principal";
            fitLayer(fg, nc, a.blurBg ? "width" : "fill");
            nc.openInViewer();
            return { comp: nc.name };
        },

        // Renders the active comp losslessly; the panel converts it to MP4 with ffmpeg.
        renderLossless: function (a) {
            var comp = activeComp(), rq = app.project.renderQueue, disabled = [];
            for (var i = 1; i <= rq.numItems; i++) {
                var it = rq.item(i);
                if (it.status === RQItemStatus.QUEUED) { it.render = false; disabled.push(it); }
            }
            var item = rq.items.add(comp);
            var om = item.outputModule(1);
            var applied = false, templates = om.templates || [], wanted = [/^lossless$/i, /^sem perdas$/i, /lossless|sem perdas|sin p.rdidas|verlustfrei|sans perte/i, /high quality|alta qualidade/i];
            for (var w = 0; w < wanted.length && !applied; w++) {
                for (var t = 0; t < templates.length && !applied; t++) {
                    if (wanted[w].test(templates[t]) && !/alpha|alfa/i.test(templates[t])) {
                        try { om.applyTemplate(templates[t]); applied = true; } catch (e) {}
                    }
                }
            }
            om.file = new File(a.outPath);
            var outPath = om.file.fsName;
            try {
                rq.render();
            } finally {
                for (var d = 0; d < disabled.length; d++) {
                    try { disabled[d].render = true; } catch (e2) {}
                }
            }
            var status = item.status;
            try { item.remove(); } catch (e3) {}
            if (status !== RQItemStatus.DONE) fail("Render n\u00e3o terminou (status " + status + ").");
            return { path: outPath, comp: comp.name, duration: comp.workAreaDuration };
        },

        organize: function () {
            var items = app.project.items, root = app.project.rootFolder, moves = [], n = 0;
            for (var i = 1; i <= items.length; i++) {
                var it = items[i];
                if (it.parentFolder !== root || it instanceof FolderItem) continue;
                var target = null;
                if (it instanceof CompItem) target = "01 Comps";
                else if (it instanceof FootageItem) {
                    if (it.mainSource instanceof SolidSource) target = "05 Solids";
                    else if (it.mainSource.isStill || (it.file && IMG_EXT.test(it.file.name))) target = "03 Imagens";
                    else if (it.hasVideo) target = "02 V\u00eddeos";
                    else if (it.hasAudio) target = "04 \u00c1udio";
                    else target = "06 Outros";
                }
                if (target) moves.push([it, target]);
            }
            for (var m = 0; m < moves.length; m++) { moves[m][0].parentFolder = getFolder(moves[m][1]); n++; }
            return { moved: n };
        }
    };

    var NO_UNDO = { ping: 1, context: 1, layerSource: 1, renderLossless: 1 };

    function run(name, args) {
        var undo = false;
        try {
            if (!api[name]) fail("Fun\u00e7\u00e3o desconhecida: " + name);
            if (!NO_UNDO[name]) { app.beginUndoGroup("Nitro: " + name); undo = true; }
            var data = api[name](args || {});
            return stringify({ ok: true, data: data === undefined ? null : data });
        } catch (e) {
            return stringify({ ok: false, error: String(e.message || e) + (e.line ? " (linha " + e.line + ")" : "") });
        } finally {
            if (undo) app.endUndoGroup();
        }
    }

    return { run: run, api: api, stringify: stringify, _setAnchor: setAnchor, _visualCenter: visualCenter };
})();
