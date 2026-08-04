#!/usr/bin/env python3
"""Bundle a scene into a single-file custom-element web component.

    python3 build_component.py                                  # <kfr-map>, Riyadh
    python3 build_component.py jeddah-map jeddah-scene.json \
            kfr3d/jeddah-map.js "Jeddah Corniche"               # <jeddah-map>
"""
import re, json, os, sys

TAG   = sys.argv[1] if len(sys.argv) > 1 else 'kfr-map'
SCENE = sys.argv[2] if len(sys.argv) > 2 else 'scene.json'
OUT   = sys.argv[3] if len(sys.argv) > 3 else 'kfr3d/kfr-map.js'
TITLE = sys.argv[4] if len(sys.argv) > 4 else 'King Fahd Road, Riyadh'

CLASS = ''.join(w.capitalize() for w in re.split(r'[-_]', TAG)) + 'Element'

html = open('kfr3d/index.html').read()
style = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script src="[^"]*"></script>\s*', '', body)

# shadow-DOM adaptations: :root -> :host, body rules -> :host
style = style.replace(':root {', ':host {')
style = style.replace('body.night', ':host(.night)')
style = style.replace('html, body { height: 100%; overflow: hidden; }', '')
style = re.sub(
    r'\n  body \{[^}]*\}',
    '\n  :host { display: block; position: relative; overflow: hidden;'
    ' font-family: var(--font); color: var(--ink-deep);'
    ' background: radial-gradient(120% 90% at 50% 0%, #ffffff 55%, #f3f4fb 100%); }',
    style)

template = '<style>' + style + '</style>' + body

app = open('kfr3d/app.js').read()
head_marker = "(function () {\n'use strict';"
assert head_marker in app, 'app.js header changed'
app = app.replace(head_marker, "var __kfrInit = function (root) {\n'use strict';", 1)
tail_marker = 'requestAnimationFrame(frame);\n})();'
assert tail_marker in app, 'app.js tail changed'
app = app.replace(tail_marker, 'requestAnimationFrame(frame);\nreturn api;\n};', 1)
# each bundle owns its scene: a shared window global would let two maps on the
# same page overwrite each other's data
assert 'var DATA = window.SCENE_DATA;' in app, 'app.js scene hook changed'
app = app.replace('var DATA = window.SCENE_DATA;', 'var DATA = __KFR_SCENE;', 1)
app = app.replace('document.getElementById(', 'root.getElementById(')
app = app.replace('document.querySelectorAll(', 'root.querySelectorAll(')
app = app.replace('document.querySelector(', 'root.querySelector(')

three = open('three.min.js').read()
scene = 'var __KFR_SCENE = ' + json.dumps(
    json.load(open(SCENE)), separators=(',', ':'), ensure_ascii=True) + ';'

element = '''
class %(cls)s extends HTMLElement {
  connectedCallback() {
    if (this.__started) return;
    this.__started = true;
    var root = this.attachShadow({ mode: 'open' });
    root.innerHTML = __KFR_TEMPLATE;
    this.api = __kfrInit(root);
    if ((this.getAttribute('sidebar') || '').toLowerCase() === 'off') this.api.showSidebar(false);
    if ((this.getAttribute('interactive') || '').toLowerCase() === 'off') this.api.setInteractive(false);
    var v = this.getAttribute('view');
    if (v) this.api.jump(v);
    if (this.hasAttribute('orbit')) this.api.setOrbit(true);
    if (this.hasAttribute('night')) this.api.setNight(1);
    var self = this;
    requestAnimationFrame(function () {
      self.dispatchEvent(new CustomEvent('kfr-ready', { detail: self.api, bubbles: true }));
    });
  }
  scrub(t) { if (this.api) this.api.scrub(t); }
  flyTo(name, ms) { return this.api ? this.api.flyTo(name, ms) : false; }
  jump(name) { return this.api ? this.api.jump(name) : false; }
  setInteractive(b) { if (this.api) this.api.setInteractive(b); }
  showSidebar(b) { if (this.api) this.api.showSidebar(b); }
  setOrbit(b) { if (this.api) this.api.setOrbit(b); }
  setBuild(v) { if (this.api) this.api.setBuild(v); }
  setRoute(t) { if (this.api) this.api.setRoute(t); }
  setNight(t) { if (this.api) this.api.setNight(t); }
  landmarks() { return this.api ? this.api.landmarks() : []; }
}
if (!customElements.get('%(tag)s')) customElements.define('%(tag)s', %(cls)s);
''' % {'cls': CLASS, 'tag': TAG}

out = ('/* <%s> — %s 3D line-art map as a web component.\n'
       '   Data (c) OpenStreetMap contributors (ODbL). Bundles three.js r160 (MIT).\n'
       '   Usage: load this file with a script tag, then place <%s style="height:80vh"> anywhere. */\n'
       '(function () {\n' % (TAG, TITLE, TAG)
       + three + '\n' + scene + '\n'
       + 'var __KFR_TEMPLATE = ' + json.dumps(template) + ';\n'
       + app + '\n' + element
       + '})();\n')
out = out.encode('ascii', 'backslashreplace').decode('ascii')
open(OUT, 'w').write(out)
print(OUT, round(os.path.getsize(OUT) / 1e6, 2), 'MB')
