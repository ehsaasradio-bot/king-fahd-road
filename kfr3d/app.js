/* King Fahd Road · Riyadh — interactive line-art 3D map.
   Data: OpenStreetMap (ODbL). Style: white ground, indigo line art, lime accents. */
(function () {
'use strict';

var DATA = window.SCENE_DATA;

/* ---------- palette ---------- */
var C = {
  ink:      0x2E3192,  inkSoft: 0x5A5EB5,
  navy:     0x1B1E63,
  green:    0x8CC63F,  greenDk: 0x6FA82F,
  white:    0xFFFFFF,
  wallA:    0xF7F8FD,  wallB:   0xE7EAF7,   // lit / shaded walls
  lmWallA:  0xE4F2C8,  lmWallB: 0xC9E29B,   // landmark glass tint
  mqWallA:  0xE7F4D2,  mqWallB: 0xD3E9B4,  mqRoof: 0xC9E3A6,
  roadKF:   0xD2D8F0,  roadMj:  0xE0E3F4,  roadMn: 0xECEEF8,
  ground:   0xFFFFFF
};

var CAT_INFO = {
  lm: 'Landmark tower', md: 'High-rise', cm: 'Commercial',
  rs: 'Residential',    mq: 'Mosque',    cv: 'Civic'
};

/* ---------- renderer / scene ---------- */
var canvas = document.getElementById('gl');
var renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
} catch (e) {
  document.getElementById('nogl').style.display = 'flex';
  return;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
var scene = new THREE.Scene();
scene.background = new THREE.Color(C.ground);

var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 60000);

/* ---------- camera state ---------- */
var view = {
  tx: 0, tz: 0,            // ground target
  azim: -0.65, elev: 0.63, // radians
  size: 2600               // world units visible vertically
};
var DIST = 18000;
var fly = null;            // active tween

function applyCamera() {
  var a = view.azim, e = view.elev;
  var cx = view.tx + DIST * Math.sin(a) * Math.cos(e);
  var cy =           DIST * Math.sin(e);
  var cz = view.tz + DIST * Math.cos(a) * Math.cos(e);
  camera.position.set(cx, cy, cz);
  camera.up.set(0, 1, 0);
  camera.lookAt(view.tx, 0, view.tz);
  var asp = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  camera.left = -view.size * asp / 2; camera.right = view.size * asp / 2;
  camera.top = view.size / 2;         camera.bottom = -view.size / 2;
  camera.updateProjectionMatrix();
}

function flyTo(t, ms) {
  fly = {
    t0: performance.now(), ms: ms || 900,
    from: { tx: view.tx, tz: view.tz, azim: view.azim, elev: view.elev, size: view.size },
    to: t
  };
}
function stepFly(now) {
  if (!fly) return;
  var k = Math.min(1, (now - fly.t0) / fly.ms);
  k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  for (var key in fly.to) view[key] = fly.from[key] + (fly.to[key] - fly.from[key]) * k;
  if (k >= 1) fly = null;
}

/* ---------- geometry builders ---------- */
var V2 = THREE.Vector2;

function ringFromFlat(f) {
  var out = [];
  for (var i = 0; i < f.length; i += 2) out.push(new V2(f[i], f[i + 1]));
  return out;
}

// light direction for flat wall shading (x, z)
var LX = 0.62, LZ = -0.78;

var fillPos = [], fillCol = [];      // merged building mesh
var edgeMain = [], edgeSoft = [];    // strong / faint line segments
var gridLines = [];                  // fine facade grid on landmark towers (zoom-faded)
var meta = [];                       // per-building info incl. vertex range

function pushTri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
  fillPos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  for (var i = 0; i < 3; i++) fillCol.push(col.r, col.g, col.b);
}

var _c = new THREE.Color();
function shade(hexA, hexB, nx, nz) {
  var d = 0.5 + 0.5 * (nx * LX + nz * LZ);
  _c.setHex(hexB).lerp(new THREE.Color(hexA), d);
  return _c;
}

/* build-on-load: a global uniform + per-vertex delay lets the whole merged city
   rise from the ground on the GPU. Default 2.0 = fully built (plain embeds).
   uNight cross-fades every material into the night palette on the GPU. */
var buildUniform = { value: 2.0 };
var nightUniform = { value: 0.0 };

/* night palette per material class (GLSL vec3 expressions) */
var N_FILL  = 'mix(vec3(0.05,0.055,0.20), vec3(0.11,0.12,0.40), smoothstep(0.75,1.0,dot(diffuseColor.rgb,vec3(0.3333))))';
var N_EDGE  = 'vec3(0.56,0.60,1.00)';
var N_SOFT  = 'vec3(0.36,0.40,0.82)';
var N_GRID  = 'vec3(0.58,0.83,0.25)';    // the windows light up lime
var N_ROAD  = 'vec3(0.10,0.11,0.33)';
var N_DASH  = 'vec3(0.55,0.80,0.24)';
var N_BORD  = 'vec3(0.34,0.37,0.78)';
var N_TREE1 = 'vec3(0.17,0.31,0.10)';
var N_TREE2 = 'vec3(0.13,0.26,0.08)';
var N_PANEL = 'vec3(0.50,0.72,0.20)';
var N_CAP   = 'vec3(0.66,0.88,0.30)';

function patchMat(mat, o) {
  mat.onBeforeCompile = function (sh) {
    sh.uniforms.uBuild = buildUniform;
    sh.uniforms.uNight = nightUniform;
    var v = '';
    if (o.riseY) {
      v = 'float bp = clamp((uBuild - aRise) * 3.0, 0.0, 1.0); bp = bp*bp*(3.0-2.0*bp); transformed.y *= bp;';
    } else if (o.pop != null) {
      v = 'float bp = clamp((uBuild - ' + o.pop.toFixed(2) + ') * 4.0, 0.0, 1.0); bp = bp*bp*(3.0-2.0*bp); transformed *= bp;';
    }
    sh.vertexShader = (o.riseY ? 'attribute float aRise;\n' : '') + 'uniform float uBuild;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + v);
    if (o.night) {
      sh.fragmentShader = 'uniform float uNight;\n' +
        sh.fragmentShader.replace('#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, ' + o.night + ', uNight);');
    }
  };
  // distinct cache key per patch combination — closures stringify identically otherwise
  mat.customProgramCacheKey = function () {
    return 'kfr' + (o.riseY ? 'R' : '') + (o.pop != null ? 'P' + o.pop : '') + '|' + (o.night || '');
  };
}

function injectRiseY(mat, nightExpr) { patchMat(mat, { riseY: true, night: nightExpr }); }
function injectPopFixed(mat, delay, nightExpr) { patchMat(mat, { pop: delay, night: nightExpr }); }
function injectNight(mat, nightExpr) { patchMat(mat, { night: nightExpr }); }

var WHITE = new THREE.Color(C.white);
var MQ_ROOF = new THREE.Color(C.mqRoof);
var GREEN_C = new THREE.Color(C.green);

function pushTriN(ax, ay, az, bx, by, bz, cx2, cy2, cz2, wallA, wallB, roofC) {
  var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  var e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
  var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  var col = (Math.abs(ny / l) > 0.62) ? roofC : shade(wallA, wallB, nx / l, nz / l);
  pushTri(ax, ay, az, bx, by, bz, cx2, cy2, cz2, col);
}

function obbOf(flat) {
  var n = flat.length / 2, best = 0, bl = -1, i;
  for (i = 0; i < n; i++) {
    var x1 = flat[2 * i], z1 = flat[2 * i + 1];
    var x2 = flat[2 * ((i + 1) % n)], z2 = flat[2 * ((i + 1) % n) + 1];
    var dx = x2 - x1, dz = z2 - z1, l = dx * dx + dz * dz;
    if (l > bl) { bl = l; best = Math.atan2(dz, dx); }
  }
  var ux = Math.cos(best), uz = Math.sin(best), vx = -uz, vz = ux;
  var minu = 1e9, maxu = -1e9, minv = 1e9, maxv = -1e9;
  for (i = 0; i < n; i++) {
    var u = flat[2 * i] * ux + flat[2 * i + 1] * uz;
    var v = flat[2 * i] * vx + flat[2 * i + 1] * vz;
    if (u < minu) minu = u; if (u > maxu) maxu = u;
    if (v < minv) minv = v; if (v > maxv) maxv = v;
  }
  var cu = (minu + maxu) / 2, cv = (minv + maxv) / 2;
  return { cx: cu * ux + cv * vx, cz: cu * uz + cv * vz,
           ux: ux, uz: uz, vx: vx, vz: vz,
           hu: (maxu - minu) / 2, hv: (maxv - minv) / 2 };
}

/* bake an arbitrary Three geometry (in local space) into the merged buffers */
function bakeGeo(geo, M, wallA, wallB, roofC, edgeAngle) {
  if (edgeAngle) {
    var eg = new THREE.EdgesGeometry(geo, edgeAngle);
    eg.applyMatrix4(M);
    var E = eg.getAttribute('position').array;
    for (var i = 0; i < E.length; i++) edgeMain.push(E[i]);
  }
  var g2 = geo.index ? geo.toNonIndexed() : geo;
  g2.applyMatrix4(M);
  var P = g2.getAttribute('position').array;
  for (var j = 0; j < P.length; j += 9) {
    pushTriN(P[j], P[j + 1], P[j + 2], P[j + 3], P[j + 4], P[j + 5],
             P[j + 6], P[j + 7], P[j + 8], wallA, wallB, roofC);
  }
}

function emitPrism(b) {
  var outer = ringFromFlat(b.o);
  var holes = (b.i || []).map(ringFromFlat);
  var h = b.h, cat = b.c;
  var wallA = C.wallA, wallB = C.wallB, roofC = WHITE;
  if (cat === 'lm') { wallA = C.lmWallA; wallB = C.lmWallB; }
  if (cat === 'mq') { wallA = C.mqWallA; wallB = C.mqWallB; roofC = MQ_ROOF; }
  var edges = (cat === 'rs') ? edgeSoft : edgeMain;

  var tris;
  try { tris = THREE.ShapeUtils.triangulateShape(outer, holes); }
  catch (e) { tris = []; }
  var all = outer.concat.apply(outer, holes);
  for (var t = 0; t < tris.length; t++) {
    var a = all[tris[t][0]], b2 = all[tris[t][1]], c2 = all[tris[t][2]];
    pushTri(a.x, h, a.y, b2.x, h, b2.y, c2.x, h, c2.y, roofC);
  }

  var rings = [outer].concat(holes);
  for (var r = 0; r < rings.length; r++) {
    var ring = rings[r], n = ring.length;
    for (var i2 = 0; i2 < n; i2++) {
      var p = ring[i2], q = ring[(i2 + 1) % n];
      var dx = q.x - p.x, dz = q.y - p.y;
      var len = Math.sqrt(dx * dx + dz * dz) || 1;
      var nx = dz / len, nz = -dx / len;
      var col = shade(wallA, wallB, nx, nz).clone();
      pushTri(p.x, 0, p.y, q.x, 0, q.y, q.x, h, q.y, col);
      pushTri(p.x, 0, p.y, q.x, h, q.y, p.x, h, p.y, col);
      edges.push(p.x, h, p.y, q.x, h, q.y);
      var o = ring[(i2 - 1 + n) % n];
      var v1x = p.x - o.x, v1z = p.y - o.y, v2x = q.x - p.x, v2z = q.y - p.y;
      var l1 = Math.sqrt(v1x * v1x + v1z * v1z) || 1, l2 = Math.sqrt(v2x * v2x + v2z * v2z) || 1;
      var dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
      if (dot < 0.88) edges.push(p.x, 0, p.y, p.x, h, p.y);
    }
  }

  // fine facade grid on landmark prisms: floor rings + mullions
  if (cat === 'lm' && h >= 60) {
    for (var yy = 7; yy < h - 2; yy += 7) {
      for (var rg = 0; rg < rings.length; rg++) {
        var rr = rings[rg], nn = rr.length;
        for (var ii = 0; ii < nn; ii++) {
          var pp = rr[ii], qq = rr[(ii + 1) % nn];
          gridLines.push(pp.x, yy, pp.y, qq.x, yy, qq.y);
        }
      }
    }
    for (var rg2 = 0; rg2 < rings.length; rg2++) {
      var rr2 = rings[rg2], nn2 = rr2.length;
      for (var ii2 = 0; ii2 < nn2; ii2++) {
        var pA = rr2[ii2], pB = rr2[(ii2 + 1) % nn2];
        var ddx = pB.x - pA.x, ddz = pB.y - pA.y;
        var LL = Math.sqrt(ddx * ddx + ddz * ddz);
        for (var dd = 8; dd < LL - 2; dd += 8) {
          var mx = pA.x + ddx / LL * dd, mz = pA.y + ddz / LL * dd;
          gridLines.push(mx, 0, mz, mx, h, mz);
        }
      }
    }
  }
}

/* ---- signature landmark shapes ---- */

/* Kingdom Centre: tapering slab with the inverted parabolic void + skybridge */
function emitKingdom(b) {
  var o = obbOf(b.o), H = b.h;
  var a = Math.max(30, o.hu);
  var depth = Math.max(16, o.hv * 1.4);
  function uw(y) { return a * (1 - 0.26 * Math.pow(y / H, 1.7)); }
  var pts = [], k, y;
  for (k = 0; k <= 8; k++) { y = H * 0.93 * k / 8; pts.push(new THREE.Vector2(-uw(y), y)); }
  var uw93 = uw(H * 0.93);
  for (k = 1; k < 10; k++) {
    var ang = Math.PI * (1 - k / 10);
    pts.push(new THREE.Vector2(Math.cos(ang) * uw93, H * 0.93 + Math.sin(ang) * H * 0.07));
  }
  for (k = 8; k >= 0; k--) { y = H * 0.93 * k / 8; pts.push(new THREE.Vector2(uw(y), y)); }

  var y0 = H * 0.52, y1 = H * 0.915, gm = uw(y1) * 0.66;
  var hole = [];
  for (k = 0; k <= 14; k++) {          // right rim, down into the rounded U
    y = y1 - (y1 - y0) * k / 14;
    hole.push(new THREE.Vector2(gm * Math.pow((y - y0) / (y1 - y0), 0.55), y));
  }
  for (k = 13; k >= 0; k--) {          // left rim, back up
    y = y1 - (y1 - y0) * k / 14;
    hole.push(new THREE.Vector2(-gm * Math.pow((y - y0) / (y1 - y0), 0.55), y));
  }
  var shape = new THREE.Shape(pts);
  shape.holes.push(new THREE.Path(hole));
  var geo = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  var M = new THREE.Matrix4().set(
    o.ux, 0, o.vx, o.cx,
    0, 1, 0, 0,
    o.uz, 0, o.vz, o.cz,
    0, 0, 0, 1);
  bakeGeo(geo, M, C.lmWallA, C.lmWallB, WHITE, 20);

  // facade grid on both broad faces, wrapped around the void
  var zf = depth / 2 + 0.35;
  function gSeg(u1, ya, u2, yb, zl) {
    gridLines.push(o.ux * u1 + o.vx * zl + o.cx, ya, o.uz * u1 + o.vz * zl + o.cz,
                   o.ux * u2 + o.vx * zl + o.cx, yb, o.uz * u2 + o.vz * zl + o.cz);
  }
  function wAt(yy) {
    if (yy <= H * 0.93) return uw(yy);
    var q = (yy - H * 0.93) / (H * 0.07);
    return uw93 * Math.sqrt(Math.max(0, 1 - q * q));
  }
  function gAt(yy) {
    return (yy > y0 && yy < y1) ? gm * Math.pow((yy - y0) / (y1 - y0), 0.55) : 0;
  }
  var sides = [zf, -zf], si, yy2, uu;
  for (si = 0; si < 2; si++) {
    for (yy2 = 7; yy2 < H * 0.99; yy2 += 7) {
      var w = wAt(yy2) * 0.99;
      if (w < 3) continue;
      var g = gAt(yy2);
      if (g > 0.5) { gSeg(-w, yy2, -g, yy2, sides[si]); gSeg(g, yy2, w, yy2, sides[si]); }
      else gSeg(-w, yy2, w, yy2, sides[si]);
    }
    for (uu = 0; uu < a * 0.98; uu += 7) {
      var us = (uu === 0) ? [0] : [-uu, uu];
      for (var uk = 0; uk < us.length; uk++) {
        var u = us[uk], ut = Math.abs(u), yTop;
        if (ut < uw93) yTop = H * 0.93 + H * 0.07 * Math.sqrt(1 - (ut / uw93) * (ut / uw93));
        else if (ut < a * 0.995) yTop = H * Math.pow((1 - ut / a) / 0.26, 1 / 1.7);
        else continue;
        if (ut < gm) {
          var yEdge = y0 + (y1 - y0) * Math.pow(ut / gm || 0, 1 / 0.55);
          gSeg(u, 0, u, Math.min(yEdge, yTop), sides[si]);
          if (yTop > y1) gSeg(u, y1, u, yTop, sides[si]);
        } else {
          gSeg(u, 0, u, yTop, sides[si]);
        }
      }
    }
  }
}

/* Al Faisaliyah: four-sided tapering spire with the sphere near the top */
function emitFaisaliyah(b) {
  var o = obbOf(b.o), H = b.h;
  var s0 = Math.max(18, Math.min(o.hu, o.hv)) * 0.98;
  var N = 12, rings = [], i, k;
  for (i = 0; i <= N; i++) {
    var t = i / N;
    var s = Math.max(1.1, s0 * (1 - 0.985 * Math.pow(t, 0.9)));
    var loc = [[s, s], [s, -s], [-s, -s], [-s, s]], cs = [];
    for (k = 0; k < 4; k++) {
      cs.push([o.cx + loc[k][0] * o.ux + loc[k][1] * o.vx, t * H,
               o.cz + loc[k][0] * o.uz + loc[k][1] * o.vz]);
    }
    rings.push(cs);
  }
  for (i = 0; i < N; i++) {
    for (k = 0; k < 4; k++) {
      var p1 = rings[i][k], p2 = rings[i][(k + 1) % 4];
      var q2 = rings[i + 1][(k + 1) % 4], q1 = rings[i + 1][k];
      pushTriN(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], q2[0], q2[1], q2[2], C.lmWallA, C.lmWallB, WHITE);
      pushTriN(p1[0], p1[1], p1[2], q2[0], q2[1], q2[2], q1[0], q1[1], q1[2], C.lmWallA, C.lmWallB, WHITE);
    }
  }
  for (k = 0; k < 4; k++) {
    for (i = 0; i < N; i++) {
      edgeMain.push(rings[i][k][0], rings[i][k][1], rings[i][k][2],
                    rings[i + 1][k][0], rings[i + 1][k][1], rings[i + 1][k][2]);
    }
    var b1 = rings[0][k], b2 = rings[0][(k + 1) % 4];
    edgeMain.push(b1[0], 0, b1[2], b2[0], 0, b2[2]);
  }
  // truss band rings, like the real facade
  var bands = [0.27, 0.5, 0.7];
  for (var bnd = 0; bnd < bands.length; bnd++) {
    var tb = bands[bnd];
    var sb = Math.max(1.1, s0 * (1 - 0.985 * Math.pow(tb, 0.9)));
    var lb = [[sb, sb], [sb, -sb], [-sb, -sb], [-sb, sb]];
    for (k = 0; k < 4; k++) {
      var a1 = lb[k], a2 = lb[(k + 1) % 4];
      edgeMain.push(o.cx + a1[0] * o.ux + a1[1] * o.vx, tb * H, o.cz + a1[0] * o.uz + a1[1] * o.vz,
                    o.cx + a2[0] * o.ux + a2[1] * o.vx, tb * H, o.cz + a2[0] * o.uz + a2[1] * o.vz);
    }
  }
  var r = Math.min(12, Math.max(8, s0 * 0.34));
  bakeGeo(new THREE.IcosahedronGeometry(r, 1),
          new THREE.Matrix4().makeTranslation(o.cx, H * 0.72, o.cz),
          C.green, C.greenDk, GREEN_C, 0);
  // fine floor banding up the pyramid
  for (var yy = 7; yy < H * 0.88; yy += 7) {
    var tg = yy / H;
    var sg = Math.max(1.1, s0 * (1 - 0.985 * Math.pow(tg, 0.9)));
    if (sg < 2.5) break;
    var lg = [[sg, sg], [sg, -sg], [-sg, -sg], [-sg, sg]];
    for (k = 0; k < 4; k++) {
      var g1 = lg[k], g2 = lg[(k + 1) % 4];
      gridLines.push(o.cx + g1[0] * o.ux + g1[1] * o.vx, yy, o.cz + g1[0] * o.uz + g1[1] * o.vz,
                     o.cx + g2[0] * o.ux + g2[1] * o.vx, yy, o.cz + g2[0] * o.uz + g2[1] * o.vz);
    }
  }
}

/* Tadawul Tower: waisted shaft, X-braced faces, flared four-point crown, spire */
function emitTadawul(b) {
  var o = obbOf(b.o), H = b.h;
  var su = Math.min(o.hu * 0.8, 28), sv = Math.min(o.hv * 0.8, 28);
  function prof(t) { return 0.74 + 1.04 * (t - 0.5) * (t - 0.5); }
  function ringAt(t, f) {
    var loc = [[su * f, sv * f], [su * f, -sv * f], [-su * f, -sv * f], [-su * f, sv * f]], cs = [];
    for (var k = 0; k < 4; k++) {
      cs.push([o.cx + loc[k][0] * o.ux + loc[k][1] * o.vx, t * H,
               o.cz + loc[k][0] * o.uz + loc[k][1] * o.vz]);
    }
    return cs;
  }
  var N = 14, rings = [], i, k;
  for (i = 0; i <= N; i++) {
    var t = 0.94 * i / N;
    rings.push(ringAt(t, prof(t)));
  }
  rings.push(ringAt(1.0, prof(0.94) * 1.18));   // flared crown ring
  for (i = 0; i < rings.length - 1; i++) {
    for (k = 0; k < 4; k++) {
      var p1 = rings[i][k], p2 = rings[i][(k + 1) % 4];
      var q2 = rings[i + 1][(k + 1) % 4], q1 = rings[i + 1][k];
      pushTriN(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], q2[0], q2[1], q2[2], C.lmWallA, C.lmWallB, WHITE);
      pushTriN(p1[0], p1[1], p1[2], q2[0], q2[1], q2[2], q1[0], q1[1], q1[2], C.lmWallA, C.lmWallB, WHITE);
    }
  }
  // roof deck below the crown so it is not see-through
  var R = rings[N];
  pushTriN(R[0][0], R[0][1], R[0][2], R[1][0], R[1][1], R[1][2], R[2][0], R[2][1], R[2][2], C.lmWallA, C.lmWallB, WHITE);
  pushTriN(R[0][0], R[0][1], R[0][2], R[2][0], R[2][1], R[2][2], R[3][0], R[3][1], R[3][2], C.lmWallA, C.lmWallB, WHITE);
  var T = rings[rings.length - 1];
  for (k = 0; k < 4; k++) {
    for (i = 0; i < rings.length - 1; i++) {
      edgeMain.push(rings[i][k][0], rings[i][k][1], rings[i][k][2],
                    rings[i + 1][k][0], rings[i + 1][k][1], rings[i + 1][k][2]);
    }
    edgeMain.push(T[k][0], T[k][1], T[k][2], T[(k + 1) % 4][0], T[(k + 1) % 4][1], T[(k + 1) % 4][2]);
    var b1 = rings[0][k], b2 = rings[0][(k + 1) % 4];
    edgeMain.push(b1[0], 0, b1[2], b2[0], 0, b2[2]);
  }
  // one X brace per face, standing proud like the real diagrid
  var lo = ringAt(0.12, prof(0.12)), hi = ringAt(0.86, prof(0.86));
  for (k = 0; k < 4; k++) {
    var k2 = (k + 1) % 4;
    edgeMain.push(lo[k][0], lo[k][1], lo[k][2], hi[k2][0], hi[k2][1], hi[k2][2]);
    edgeMain.push(lo[k2][0], lo[k2][1], lo[k2][2], hi[k][0], hi[k][1], hi[k][2]);
  }
  // centre spire
  edgeMain.push(o.cx, H * 0.96, o.cz, o.cx, H * 1.09, o.cz);
  // floor bands following the waisted profile
  for (var yy = 7; yy < H * 0.93; yy += 7) {
    var tg = yy / H;
    var rg = ringAt(tg, prof(tg));
    for (k = 0; k < 4; k++) {
      gridLines.push(rg[k][0], yy, rg[k][2], rg[(k + 1) % 4][0], yy, rg[(k + 1) % 4][2]);
    }
  }
}

/* KAFD estimated parcels: faceted crystal tops */
function emitCrystal(b) {
  var o = obbOf(b.o), H = b.h;
  var hu = o.hu * 0.94, hv = o.hv * 0.94, h1 = H * 0.86;
  function W(u, v, y) { return [o.cx + u * o.ux + v * o.vx, y, o.cz + u * o.uz + v * o.vz]; }
  var B0 = [W(hu, hv, 0), W(hu, -hv, 0), W(-hu, -hv, 0), W(-hu, hv, 0)];
  var B1 = [W(hu, hv, h1), W(hu, -hv, h1), W(-hu, -hv, h1), W(-hu, hv, h1)];
  var T = [W(hu * 0.42, hv * 0.42, H), W(hu * 0.42, -hv * 0.42, H),
           W(-hu * 0.42, -hv * 0.42, H), W(-hu * 0.42, hv * 0.42, H)];
  for (var k = 0; k < 4; k++) {
    var k2 = (k + 1) % 4;
    pushTriN(B0[k][0], 0, B0[k][2], B0[k2][0], 0, B0[k2][2], B1[k2][0], h1, B1[k2][2], C.wallA, C.wallB, WHITE);
    pushTriN(B0[k][0], 0, B0[k][2], B1[k2][0], h1, B1[k2][2], B1[k][0], h1, B1[k][2], C.wallA, C.wallB, WHITE);
    pushTriN(B1[k][0], h1, B1[k][2], B1[k2][0], h1, B1[k2][2], T[k2][0], H, T[k2][2], C.wallA, C.wallB, WHITE);
    pushTriN(B1[k][0], h1, B1[k][2], T[k2][0], H, T[k2][2], T[k][0], H, T[k][2], C.wallA, C.wallB, WHITE);
    edgeMain.push(B0[k][0], 0, B0[k][2], B1[k][0], h1, B1[k][2]);
    edgeMain.push(B1[k][0], h1, B1[k][2], B1[k2][0], h1, B1[k2][2]);
    edgeMain.push(B1[k][0], h1, B1[k][2], T[k][0], H, T[k][2]);
    edgeMain.push(T[k][0], H, T[k][2], T[k2][0], H, T[k2][2]);
  }
  pushTriN(T[0][0], H, T[0][2], T[1][0], H, T[1][2], T[2][0], H, T[2][2], C.wallA, C.wallB, WHITE);
  pushTriN(T[0][0], H, T[0][2], T[2][0], H, T[2][2], T[3][0], H, T[3][2], C.wallA, C.wallB, WHITE);
}

/* Al Majdoul: the twisting square tower */
function emitMajdoul(b) {
  var o = obbOf(b.o), H = b.h;
  var s0 = Math.max(14, Math.min(o.hu, o.hv)) * 0.95;
  var N = 16, TW = 1.05, rings = [], i, k;
  for (i = 0; i <= N; i++) {
    var t = i / N, s = s0 * (1 - 0.10 * t);
    var cp = Math.cos(TW * t), sp = Math.sin(TW * t);
    var loc = [[s, s], [s, -s], [-s, -s], [-s, s]], cs = [];
    for (k = 0; k < 4; k++) {
      var u = loc[k][0] * cp - loc[k][1] * sp, v = loc[k][0] * sp + loc[k][1] * cp;
      cs.push([o.cx + u * o.ux + v * o.vx, t * H, o.cz + u * o.uz + v * o.vz]);
    }
    rings.push(cs);
  }
  for (i = 0; i < N; i++) {
    for (k = 0; k < 4; k++) {
      var p1 = rings[i][k], p2 = rings[i][(k + 1) % 4];
      var q2 = rings[i + 1][(k + 1) % 4], q1 = rings[i + 1][k];
      pushTriN(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], q2[0], q2[1], q2[2], C.lmWallA, C.lmWallB, WHITE);
      pushTriN(p1[0], p1[1], p1[2], q2[0], q2[1], q2[2], q1[0], q1[1], q1[2], C.lmWallA, C.lmWallB, WHITE);
    }
  }
  var T = rings[N];
  pushTriN(T[0][0], T[0][1], T[0][2], T[1][0], T[1][1], T[1][2], T[2][0], T[2][1], T[2][2], C.lmWallA, C.lmWallB, WHITE);
  pushTriN(T[0][0], T[0][1], T[0][2], T[2][0], T[2][1], T[2][2], T[3][0], T[3][1], T[3][2], C.lmWallA, C.lmWallB, WHITE);
  for (k = 0; k < 4; k++) {
    for (i = 0; i < N; i++) {
      edgeMain.push(rings[i][k][0], rings[i][k][1], rings[i][k][2],
                    rings[i + 1][k][0], rings[i + 1][k][1], rings[i + 1][k][2]);
    }
    edgeMain.push(T[k][0], T[k][1], T[k][2], T[(k + 1) % 4][0], T[(k + 1) % 4][1], T[(k + 1) % 4][2]);
    var b1 = rings[0][k], b2 = rings[0][(k + 1) % 4];
    edgeMain.push(b1[0], 0, b1[2], b2[0], 0, b2[2]);
  }
  // twisting floor bands
  for (var yy = 7; yy < H - 3; yy += 7) {
    var tg = yy / H, sg = s0 * (1 - 0.10 * tg);
    var cg = Math.cos(TW * tg), sng = Math.sin(TW * tg);
    var lg = [[sg, sg], [sg, -sg], [-sg, -sg], [-sg, sg]], wpts = [];
    for (k = 0; k < 4; k++) {
      var ug = lg[k][0] * cg - lg[k][1] * sng, vg = lg[k][0] * sng + lg[k][1] * cg;
      wpts.push([o.cx + ug * o.ux + vg * o.vx, o.cz + ug * o.uz + vg * o.vz]);
    }
    for (k = 0; k < 4; k++) {
      gridLines.push(wpts[k][0], yy, wpts[k][1], wpts[(k + 1) % 4][0], yy, wpts[(k + 1) % 4][1]);
    }
  }
}

/* PIF Tower: real footprint shaft with the chiselled crown */
function emitPIF(b) {
  var H = b.h;
  emitPrism({ o: b.o, i: b.i, h: H * 0.86, c: 'lm', n: b.n });
  var o = obbOf(b.o);
  var hu = o.hu * 0.96, hv = o.hv * 0.9, h1 = H * 0.86;
  var tc = -o.hu * 0.30, tw = o.hu * 0.42, tv = hv * 0.85;
  function W(u, v, y) { return [o.cx + u * o.ux + v * o.vx, y, o.cz + u * o.uz + v * o.vz]; }
  var B = [W(hu, hv, h1), W(hu, -hv, h1), W(-hu, -hv, h1), W(-hu, hv, h1)];
  var T = [W(tc + tw, tv, H), W(tc + tw, -tv, H), W(tc - tw, -tv, H), W(tc - tw, tv, H)];
  for (var k = 0; k < 4; k++) {
    var p1 = B[k], p2 = B[(k + 1) % 4], q2 = T[(k + 1) % 4], q1 = T[k];
    pushTriN(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], q2[0], q2[1], q2[2], C.lmWallA, C.lmWallB, WHITE);
    pushTriN(p1[0], p1[1], p1[2], q2[0], q2[1], q2[2], q1[0], q1[1], q1[2], C.lmWallA, C.lmWallB, WHITE);
    edgeMain.push(p1[0], p1[1], p1[2], q1[0], q1[1], q1[2]);
    edgeMain.push(q1[0], q1[1], q1[2], q2[0], q2[1], q2[2]);
  }
  pushTriN(T[0][0], T[0][1], T[0][2], T[1][0], T[1][1], T[1][2], T[2][0], T[2][1], T[2][2], C.lmWallA, C.lmWallB, WHITE);
  pushTriN(T[0][0], T[0][1], T[0][2], T[2][0], T[2][1], T[2][2], T[3][0], T[3][1], T[3][2], C.lmWallA, C.lmWallB, WHITE);
}

/* ---- Jeddah signatures ---- */

/* Aqua Tower: slender glass shaft whose crown sweeps out like a sail */
function emitAqua(b) {
  var o = obbOf(b.o), H = b.h;
  var su = Math.max(11, o.hu), sv = Math.max(8, o.hv);
  var N = 18, rings = [], i, k;
  for (i = 0; i <= N; i++) {
    var t = i / N;
    var taper = 1 - 0.16 * t;
    var crown = t > 0.80 ? Math.pow((t - 0.80) / 0.20, 1.5) : 0;
    var fu = taper * (1 - 0.72 * crown);
    var fv = taper * (1 - 0.40 * crown);
    var lean = crown * su * 0.6;                 // the sail leans seaward
    var loc = [[su * fu + lean, sv * fv], [su * fu + lean, -sv * fv],
               [-su * fu + lean, -sv * fv], [-su * fu + lean, sv * fv]];
    var cs = [];
    for (k = 0; k < 4; k++) {
      cs.push([o.cx + loc[k][0] * o.ux + loc[k][1] * o.vx, t * H,
               o.cz + loc[k][0] * o.uz + loc[k][1] * o.vz]);
    }
    rings.push(cs);
  }
  for (i = 0; i < N; i++) {
    for (k = 0; k < 4; k++) {
      var p1 = rings[i][k], p2 = rings[i][(k + 1) % 4];
      var q2 = rings[i + 1][(k + 1) % 4], q1 = rings[i + 1][k];
      pushTriN(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], q2[0], q2[1], q2[2], C.lmWallA, C.lmWallB, WHITE);
      pushTriN(p1[0], p1[1], p1[2], q2[0], q2[1], q2[2], q1[0], q1[1], q1[2], C.lmWallA, C.lmWallB, WHITE);
    }
  }
  var T = rings[N];
  pushTriN(T[0][0], T[0][1], T[0][2], T[1][0], T[1][1], T[1][2], T[2][0], T[2][1], T[2][2], C.lmWallA, C.lmWallB, WHITE);
  pushTriN(T[0][0], T[0][1], T[0][2], T[2][0], T[2][1], T[2][2], T[3][0], T[3][1], T[3][2], C.lmWallA, C.lmWallB, WHITE);
  for (k = 0; k < 4; k++) {
    for (i = 0; i < N; i++) {
      edgeMain.push(rings[i][k][0], rings[i][k][1], rings[i][k][2],
                    rings[i + 1][k][0], rings[i + 1][k][1], rings[i + 1][k][2]);
    }
    edgeMain.push(T[k][0], T[k][1], T[k][2], T[(k + 1) % 4][0], T[(k + 1) % 4][1], T[(k + 1) % 4][2]);
    var b1 = rings[0][k], b2 = rings[0][(k + 1) % 4];
    edgeMain.push(b1[0], 0, b1[2], b2[0], 0, b2[2]);
  }
  for (var yy = 7; yy < H * 0.98; yy += 7) {     // floor banding follows the sweep
    var tg = yy / H;
    var idx = Math.min(N, Math.round(tg * N));
    var rg = rings[idx];
    for (k = 0; k < 4; k++) {
      gridLines.push(rg[k][0], yy, rg[k][2], rg[(k + 1) % 4][0], yy, rg[(k + 1) % 4][2]);
    }
  }
}

/* Al-Rahmah / Island Mosque: arcaded base on the water, dome + minaret */
function emitFloatingMosque(b) {
  var o = obbOf(b.o);
  var base = 10;
  emitPrism({ o: b.o, i: b.i, h: base, c: 'mq', n: b.n });
  var r = Math.max(7, Math.min(o.hu, o.hv) * 0.8);
  var M = new THREE.Matrix4();

  // main dome
  M.makeTranslation(o.cx, base, o.cz);
  bakeGeo(new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2),
          M, C.mqWallA, C.mqWallB, MQ_ROOF, 24);
  // finial
  edgeMain.push(o.cx, base + r, o.cz, o.cx, base + r * 1.35, o.cz);

  // minaret at one corner, with its own cap
  var mu = o.hu * 0.72, mv = o.hv * 0.62;
  var mx = o.cx + mu * o.ux + mv * o.vx, mz = o.cz + mu * o.uz + mv * o.vz;
  var mh = Math.max(34, r * 4.2);
  M.makeTranslation(mx, mh / 2, mz);
  bakeGeo(new THREE.CylinderGeometry(1.5, 2.2, mh, 10), M, C.mqWallA, C.mqWallB, MQ_ROOF, 30);
  M.makeTranslation(mx, mh, mz);
  bakeGeo(new THREE.SphereGeometry(2.6, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
          M, C.mqWallA, C.mqWallB, MQ_ROOF, 0);
  edgeMain.push(mx, mh + 2.6, mz, mx, mh + 6, mz);
}

/* ---- Makkah signatures ---- */

/* walk a ring, calling back every `step` metres along it */
function alongRing(ring, step, phase, cb) {
  var n = ring.length, acc = phase || 0;
  for (var i = 0; i < n; i++) {
    var p = ring[i], q = ring[(i + 1) % n];
    var dx = q.x - p.x, dz = q.y - p.y;
    var L = Math.sqrt(dx * dx + dz * dz);
    if (L < 1e-6) continue;
    for (var d = step - acc; d < L; d += step) {
      cb(p.x + dx * (d / L), p.y + dz * (d / L), dx / L, dz / L);
    }
    acc = (acc + L) % step;
  }
}

function ringCentroid(ring) {
  var sx = 0, sz = 0;
  for (var i = 0; i < ring.length; i++) { sx += ring[i].x; sz += ring[i].y; }
  return [sx / ring.length, sz / ring.length];
}

function pushCircle(out, cx, cz, r, y, seg) {
  seg = seg || 64;
  for (var i = 0; i < seg; i++) {
    var a = i / seg * Math.PI * 2, b2 = (i + 1) / seg * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r,
             cx + Math.cos(b2) * r, y, cz + Math.sin(b2) * r);
  }
}

/* one minaret: stepped base, shaft, balcony, tapered crown, finial */
function emitMinaret(x, z, H) {
  var M = new THREE.Matrix4();
  var wa = C.mqWallA, wb = C.mqWallB;
  var hBase = H * 0.21, hShaft = H * 0.47, hCrown = H * 0.19;
  M.makeTranslation(x, hBase / 2, z);
  bakeGeo(new THREE.BoxGeometry(7.4, hBase, 7.4), M, wa, wb, MQ_ROOF, 20);
  M.makeTranslation(x, hBase + hShaft / 2, z);
  bakeGeo(new THREE.CylinderGeometry(2.5, 3.3, hShaft, 8), M, wa, wb, MQ_ROOF, 24);
  M.makeTranslation(x, hBase + hShaft, z);           // balcony
  bakeGeo(new THREE.CylinderGeometry(4.4, 4.4, 2.4, 12), M, wa, wb, MQ_ROOF, 24);
  M.makeTranslation(x, hBase + hShaft + 2.4 + hCrown / 2, z);
  bakeGeo(new THREE.CylinderGeometry(1.7, 2.4, hCrown, 8), M, wa, wb, MQ_ROOF, 24);
  var yc = hBase + hShaft + 2.4 + hCrown;
  M.makeTranslation(x, yc + H * 0.07, z);
  bakeGeo(new THREE.ConeGeometry(2.2, H * 0.14, 8), M, wa, wb, MQ_ROOF, 24);
  edgeMain.push(x, yc + H * 0.14, z, x, H, z);       // finial
}

/* Al-Masjid al-Haram: the arcaded gallery ring, its roof domes and minarets.
   The mosque arrives from OSM as three disjoint parts, so this runs per part
   and sizes everything off that part's own perimeter. */
function emitHaram(b) {
  var H = b.h;
  emitPrism({ o: b.o, i: b.i, h: H, c: 'mq', n: b.n });

  var ring = ringFromFlat(b.o), n = ring.length, i;
  var per = 0;
  for (i = 0; i < n; i++) {
    var p0 = ring[i], q0 = ring[(i + 1) % n];
    per += Math.sqrt((q0.x - p0.x) * (q0.x - p0.x) + (q0.y - p0.y) * (q0.y - p0.y));
  }
  var cen = ringCentroid(ring);

  // arcade: two storey bands and a bay rhythm, so the wall reads as galleries
  for (var k = 1; k <= 2; k++) {
    var y = H * k / 3;
    for (i = 0; i < n; i++) {
      var p1 = ring[i], q1 = ring[(i + 1) % n];
      gridLines.push(p1.x, y, p1.y, q1.x, y, q1.y);
    }
  }
  alongRing(ring, 11, 0, function (x, z) { gridLines.push(x, 0, z, x, H, z); });

  // pull a point in off the wall, toward the middle of this part
  function inset(x, z, by) {
    var dx = cen[0] - x, dz = cen[1] - z;
    var L = Math.sqrt(dx * dx + dz * dz) || 1;
    return [x + dx / L * by, z + dz / L * by];
  }

  var M = new THREE.Matrix4();
  alongRing(ring, 62, 31, function (x, z) {
    var q = inset(x, z, 11);
    M.makeTranslation(q[0], H, q[1]);
    bakeGeo(new THREE.SphereGeometry(5.4, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
            M, C.mqWallA, C.mqWallB, MQ_ROOF, 26);
    edgeMain.push(q[0], H + 5.4, q[1], q[0], H + 7.8, q[1]);
  });

  // minarets, spaced so even the smallest part carries a pair
  var step = Math.max(240, per / Math.max(3, Math.round(per / 330)));
  alongRing(ring, step, step * 0.5, function (x, z) {
    var q = inset(x, z, 7);
    emitMinaret(q[0], q[1], 89);
  });
}

/* The Kaaba: the cube on its plinth, ringed by the mataf. */
function emitKaaba(b) {
  var ring = ringFromFlat(b.o), cen = ringCentroid(ring), H = b.h;
  var M = new THREE.Matrix4();

  // the mataf — concentric circles of tawaf worn into the marble
  for (var r = 24; r <= 116; r += 23) pushCircle(edgeSoft, cen[0], cen[1], r, 0.2, 72);

  // shadharwan: the sloped marble base the cube stands on
  M.makeTranslation(cen[0], 1.1, cen[1]);
  bakeGeo(new THREE.CylinderGeometry(13.5, 15.5, 2.2, 40), M, C.wallA, C.wallB, WHITE, 30);

  // the cube itself, in its own dark tone so it holds the centre of the frame
  var KA = 0x4A4E9E, KB = 0x272B70, KR = new THREE.Color(0x1B1E63);
  var n = ring.length, i;
  for (i = 0; i < n; i++) {
    var p = ring[i], q = ring[(i + 1) % n];
    var dx = q.x - p.x, dz = q.y - p.y, L = Math.sqrt(dx * dx + dz * dz) || 1;
    var col = shade(KA, KB, dz / L, -dx / L);
    pushTri(p.x, 2.2, p.y, q.x, 2.2, q.y, q.x, 2.2 + H, q.y, col);
    pushTri(p.x, 2.2, p.y, q.x, 2.2 + H, q.y, p.x, 2.2 + H, p.y, col);
    edgeMain.push(p.x, 2.2, p.y, q.x, 2.2, q.y);
    edgeMain.push(p.x, 2.2 + H, p.y, q.x, 2.2 + H, q.y);
    edgeMain.push(p.x, 2.2, p.y, p.x, 2.2 + H, p.y);
    // the kiswah's band of gold, two thirds of the way up
    edgeMain.push(p.x, 2.2 + H * 0.70, p.y, q.x, 2.2 + H * 0.70, q.y);
    edgeMain.push(p.x, 2.2 + H * 0.78, p.y, q.x, 2.2 + H * 0.78, q.y);
  }
  var tris;
  try { tris = THREE.ShapeUtils.triangulateShape(ring, []); } catch (e) { tris = []; }
  for (var t = 0; t < tris.length; t++) {
    var a = ring[tris[t][0]], b2 = ring[tris[t][1]], c2 = ring[tris[t][2]];
    pushTri(a.x, 2.2 + H, a.y, b2.x, 2.2 + H, b2.y, c2.x, 2.2 + H, c2.y, KR);
  }
}

var CUSTOM = {
  'Kingdom Centre': emitKingdom,
  'Al Faisaliyah Tower': emitFaisaliyah,
  'Al Majdoul Tower': emitMajdoul,
  'PIF Tower': emitPIF,
  'Tadawul Tower': emitTadawul,
  'Aqua Tower': emitAqua,
  'Island Mosque': emitFloatingMosque,
  'Al-Rahmah Mosque': emitFloatingMosque,
  'Al Rahmah Mosque': emitFloatingMosque,
  'Al-Masjid al-Haram': emitHaram,
  'Great Mosque of Mecca': emitHaram,
  'Kaaba': emitKaaba
};

function flatCentroid(flat) {
  var sx = 0, sz = 0, n = flat.length / 2;
  for (var j = 0; j < flat.length; j += 2) { sx += flat[j]; sz += flat[j + 1]; }
  return [sx / n, sz / n];
}

var pifCenter = (function () {
  for (var i = 0; i < DATA.buildings.length; i++) {
    var bb = DATA.buildings[i];
    if (bb.n === 'PIF Tower') return flatCentroid(bb.o);
  }
  return null;
})();

function isKafdCrystal(b) {
  if (!pifCenter || b.n || b.h < 30) return false;
  if (b.c !== 'md' && b.c !== 'lm') return false;
  var c = flatCentroid(b.o);
  var dx = c[0] - pifCenter[0], dz = c[1] - pifCenter[1];
  return dx * dx + dz * dz < 650 * 650;
}

/* landmarks that are short by nature — the height gate must not skip them */
var CUSTOM_ANY_HEIGHT = {
  'Island Mosque': 1, 'Al-Rahmah Mosque': 1, 'Al Rahmah Mosque': 1,
  'Al-Masjid al-Haram': 1, 'Great Mosque of Mecca': 1, 'Kaaba': 1
};

function buildBuilding(b, idx) {
  var vStart = fillPos.length;
  var eS = edgeMain.length, sS = edgeSoft.length, gS = gridLines.length;
  var custom = null;
  if (b.n && CUSTOM[b.n] && (b.h > 80 || CUSTOM_ANY_HEIGHT[b.n])) custom = CUSTOM[b.n];
  var crystal = !custom && isKafdCrystal(b);
  if (custom) custom(b);
  else if (crystal) emitCrystal(b);
  else emitPrism(b);
  var outer = ringFromFlat(b.o), cx = 0, cz = 0;
  for (var i = 0; i < outer.length; i++) { cx += outer[i].x; cz += outer[i].y; }
  cx /= outer.length; cz /= outer.length;
  meta.push({
    i: idx, n: b.n || null, h: b.h, c: b.c, x: cx, z: cz,
    vStart: vStart, vCount: fillPos.length - vStart, lb: b.lb === 1, custom: !!custom || crystal,
    eS: eS, eC: edgeMain.length - eS,
    sS: sS, sC: edgeSoft.length - sS,
    gS: gS, gC: gridLines.length - gS
  });
}

for (var bi = 0; bi < DATA.buildings.length; bi++) buildBuilding(DATA.buildings[bi], bi);

/* merged fill mesh */
var fillGeo = new THREE.BufferGeometry();
var fillArr = new Float32Array(fillPos);
fillGeo.setAttribute('position', new THREE.BufferAttribute(fillArr, 3));
fillGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fillCol), 3));
var fillMesh = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
}));
fillMesh.frustumCulled = false;
scene.add(fillMesh);

/* prefix ranges for raycast → building lookup (triangle index space) */
var triPrefix = new Uint32Array(meta.length);
(function () {
  var acc = 0;
  for (var i = 0; i < meta.length; i++) { acc += meta[i].vCount / 9; triPrefix[i] = acc; }
})();
function buildingFromFace(fi) {
  var lo = 0, hi = triPrefix.length - 1;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (fi < triPrefix[mid]) hi = mid; else lo = mid + 1; }
  return meta[lo];
}

function lineSeg(arr, hex, op) {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
  var m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: op }));
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
var edgeMainMesh = lineSeg(edgeMain, C.ink, 1.0);
var edgeSoftMesh = lineSeg(edgeSoft, C.inkSoft, 0.52);

/* fine facade grid — fades out as you zoom away */
var gridMat = new THREE.LineBasicMaterial({ color: C.inkSoft, transparent: true, opacity: 0.24 });
var gridGeo = new THREE.BufferGeometry();
gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gridLines), 3));
var gridMesh = new THREE.LineSegments(gridGeo, gridMat);
gridMesh.frustumCulled = false;
scene.add(gridMesh);

/* ---------- roads ---------- */
var ROAD_STYLE = { kf: [19, C.roadKF, 0.5], mj: [11, C.roadMj, 0.32], lk: [7, C.roadMn, 0.22], mn: [6.5, C.roadMn, 0.14] };
var roadPos = [], roadCol = [];
var roadBorder = [];   // ink outlines along ribbon borders
var kfPolylines = [];

function ribbon(pts, w, y, colHex, pos, col, borders) {
  var c = new THREE.Color(colHex);
  for (var i = 0; i < pts.length - 1; i++) {
    var p = pts[i], q = pts[i + 1];
    var dx = q[0] - p[0], dz = q[1] - p[1];
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var nx = -dz / len * w / 2, nz = dx / len * w / 2;
    var ax = p[0] + nx, az = p[1] + nz, bx = p[0] - nx, bz = p[1] - nz;
    var cx2 = q[0] - nx, cz2 = q[1] - nz, dx2 = q[0] + nx, dz2 = q[1] + nz;
    pos.push(ax, y, az, bx, y, bz, cx2, y, cz2, ax, y, az, cx2, y, cz2, dx2, y, dz2);
    for (var k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    if (borders) {
      borders.push(ax, y + 0.05, az, dx2, y + 0.05, dz2);
      borders.push(bx, y + 0.05, bz, cx2, y + 0.05, cz2);
    }
  }
}

for (var ri = 0; ri < DATA.roads.length; ri++) {
  var rd = DATA.roads[ri];
  var st = ROAD_STYLE[rd.c] || ROAD_STYLE.mn;
  var pts = [];
  for (var pi = 0; pi < rd.p.length; pi += 2) pts.push([rd.p[pi], rd.p[pi + 1]]);
  ribbon(pts, st[0], st[2], st[1], roadPos, roadCol,
         (rd.c === 'kf' || rd.c === 'mj') ? roadBorder : null);
  if (rd.c === 'kf') kfPolylines.push(pts);
}
var roadBorderMesh = lineSeg(roadBorder, C.ink, 0.22);
var roadGeo = new THREE.BufferGeometry();
roadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(roadPos), 3));
roadGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(roadCol), 3));
var roadMesh = new THREE.Mesh(roadGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }));
roadMesh.frustumCulled = false;
scene.add(roadMesh);

/* KF centre dashes */
var dashPos = [], dashCol = [];
(function () {
  for (var li = 0; li < kfPolylines.length; li++) {
    var pts = kfPolylines[li], acc = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var p = pts[i], q = pts[i + 1];
      var dx = q[0] - p[0], dz = q[1] - p[1];
      var len = Math.sqrt(dx * dx + dz * dz);
      var ux = dx / len, uz = dz / len;
      var d = (13 - acc % 13) % 13;
      while (d + 5 < len) {
        var sx = p[0] + ux * d, sz = p[1] + uz * d;
        ribbon([[sx, sz], [sx + ux * 5, sz + uz * 5]], 1.7, 0.9, C.ink, dashPos, dashCol);
        d += 13;
      }
      acc += len;
    }
  }
})();
var dashGeo = new THREE.BufferGeometry();
dashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dashPos), 3));
dashGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(dashCol), 3));
var dashMesh = new THREE.Mesh(dashGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
dashMesh.frustumCulled = false;
scene.add(dashMesh);

/* ---------- water: sea and lagoons (coastal scenes) ---------- */
var waterMat = null;
(function () {
  if (!DATA.water || !DATA.water.length) return;
  var pos = [], outline = [];
  for (var w = 0; w < DATA.water.length; w++) {
    var flat = DATA.water[w], pts = [];
    for (var i = 0; i < flat.length; i += 2) pts.push(new V2(flat[i], flat[i + 1]));
    if (pts.length < 3) continue;
    var tris;
    try { tris = THREE.ShapeUtils.triangulateShape(pts, []); }
    catch (e) { tris = []; }
    for (var t = 0; t < tris.length; t++) {
      var a = pts[tris[t][0]], b = pts[tris[t][1]], c = pts[tris[t][2]];
      pos.push(a.x, -0.25, a.y, b.x, -0.25, b.y, c.x, -0.25, c.y);
    }
    for (var k = 0; k < pts.length; k++) {
      var p = pts[k], q = pts[(k + 1) % pts.length];
      outline.push(p.x, -0.2, p.y, q.x, -0.2, q.y);
    }
  }
  if (!pos.length) return;
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  /* DoubleSide: the shore ring's winding depends on the source data, so half the
     polygons would otherwise be back-facing and cull away */
  waterMat = new THREE.MeshBasicMaterial({ color: 0xC2DEEC, side: THREE.DoubleSide });
  injectNight(waterMat, 'vec3(0.035,0.065,0.20)');
  var mesh = new THREE.Mesh(g, waterMat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  scene.add(mesh);
  lineSeg(outline, C.inkSoft, 0.5);   // inked shoreline
})();

/* ---------- point features: King Fahd's Fountain ---------- */
(function () {
  if (!DATA.features || !DATA.features.length) return;
  var jetMat = new THREE.MeshBasicMaterial({ color: 0xEAF3F8, transparent: true, opacity: 0.9 });
  injectNight(jetMat, 'vec3(0.72,0.86,0.42)');          // the jet is floodlit at night
  var plumeMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.95 });
  injectNight(plumeMat, 'vec3(0.80,0.92,0.52)');
  var M = new THREE.Matrix4();

  for (var i = 0; i < DATA.features.length; i++) {
    var f = DATA.features[i];
    if (f.t !== 'fountain') continue;
    var H = f.h || 260;

    // basin ring sitting on the water
    M.makeTranslation(f.x, 1.2, f.z);
    bakeGeo(new THREE.CylinderGeometry(30, 34, 2.4, 24), M,
            C.wallA, C.wallB, WHITE, 0);

    // the column of water, narrow at the nozzle and spreading as it rises
    var col = new THREE.CylinderGeometry(11, 3.2, H * 0.9, 14, 1, true);
    M.makeTranslation(f.x, 2.4 + H * 0.45, f.z);
    var g2 = col.toNonIndexed();
    g2.applyMatrix4(M);
    var P = g2.getAttribute('position').array;
    var jpos = [];
    for (var j = 0; j < P.length; j++) jpos.push(P[j]);
    var jg = new THREE.BufferGeometry();
    jg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(jpos), 3));
    var jet = new THREE.Mesh(jg, jetMat);
    jet.frustumCulled = false;
    scene.add(jet);

    // plume at the crest
    var pg = new THREE.IcosahedronGeometry(15, 1);
    M.makeScale(1, 0.62, 1);
    M.setPosition(f.x, 2.4 + H * 0.93, f.z);
    var pgeo = pg.toNonIndexed();
    pgeo.applyMatrix4(M);
    var plume = new THREE.Mesh(pgeo, plumeMat);
    plume.frustumCulled = false;
    scene.add(plume);

    // falling spray, drawn as line art
    for (var s = 0; s < 14; s++) {
      var a = s / 14 * Math.PI * 2;
      var rr = 16 + (s % 3) * 7;
      edgeSoft.push(f.x + Math.cos(a) * 4, 2.4 + H * 0.9, f.z + Math.sin(a) * 4,
                    f.x + Math.cos(a) * rr, 2.4 + H * 0.42, f.z + Math.sin(a) * rr);
    }
    // the mast line, so it reads at any zoom
    edgeMain.push(f.x, 2.4, f.z, f.x, 2.4 + H * 0.9, f.z);
  }
})();

/* ---------- trees along King Fahd Rd ---------- */
(function () {
  var spots = [];
  for (var li = 0; li < kfPolylines.length; li++) {
    var pts = kfPolylines[li], carry = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var p = pts[i], q = pts[i + 1];
      var dx = q[0] - p[0], dz = q[1] - p[1];
      var len = Math.sqrt(dx * dx + dz * dz);
      var ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
      var d = (42 - carry % 42) % 42;
      while (d < len) {
        var j = spots.length;
        var side = (j % 2 === 0) ? 1 : -1;
        var jit = Math.sin(j * 12.9898) * 2.5;
        spots.push([p[0] + ux * d + nx * (14 + jit) * side,
                    p[1] + uz * d + nz * (14 + jit) * side,
                    0.8 + 0.45 * Math.abs(Math.sin(j * 4.77))]);
        d += 42;
      }
      carry += len;
    }
  }
  var geo = new THREE.IcosahedronGeometry(4.1, 1);
  var m1 = new THREE.MeshBasicMaterial({ color: C.green });
  var m2 = new THREE.MeshBasicMaterial({ color: C.greenDk });
  injectPopFixed(m1, 0.85, N_TREE1);
  injectPopFixed(m2, 0.92, N_TREE2);
  var im1 = new THREE.InstancedMesh(geo, m1, Math.ceil(spots.length / 2));
  var im2 = new THREE.InstancedMesh(geo, m2, Math.floor(spots.length / 2));
  var M = new THREE.Matrix4(), k1 = 0, k2 = 0;
  for (var s = 0; s < spots.length; s++) {
    var sp = spots[s];
    M.makeScale(sp[2], sp[2] * 0.9, sp[2]);
    M.setPosition(sp[0], 3.4 * sp[2], sp[1]);
    if (s % 2 === 0) im1.setMatrixAt(k1++, M); else im2.setMatrixAt(k2++, M);
  }
  im1.count = k1; im2.count = k2;
  im1.frustumCulled = im2.frustumCulled = false;
  scene.add(im1); scene.add(im2);
})();

/* ---------- rooftop panels (navy slabs, reference motif) ---------- */
(function () {
  var slots = [];
  for (var i = 0; i < meta.length; i++) {
    var m = meta[i];
    if ((m.c === 'cm' || m.c === 'md' || m.c === 'cv') && m.h > 7 && m.h < 70) {
      var b = DATA.buildings[m.i];
      var area = 0, o = b.o;
      for (var j = 0; j < o.length - 2; j += 2) area += o[j] * o[j + 3] - o[j + 2] * o[j + 1];
      area = Math.abs(area / 2);
      if (area > 600 && (i % 3 !== 0)) slots.push(m);
    }
  }
  var geo = new THREE.BoxGeometry(7, 0.9, 4.6);
  var pmat = new THREE.MeshBasicMaterial({ color: C.navy });
  injectPopFixed(pmat, 0.8, N_PANEL);
  var im = new THREE.InstancedMesh(geo, pmat, slots.length);
  var M = new THREE.Matrix4(), E = new THREE.Euler();
  for (var s = 0; s < slots.length; s++) {
    var mm = slots[s];
    E.set(0, Math.sin(s * 7.31) * Math.PI, 0);
    M.makeRotationFromEuler(E);
    M.setPosition(mm.x + Math.sin(s * 3.7) * 4, mm.h + 0.5, mm.z + Math.cos(s * 5.1) * 4);
    im.setMatrixAt(s, M);
  }
  im.frustumCulled = false;
  scene.add(im);
})();

/* ---------- landmark green caps ---------- */
var lmCaps = [];
(function () {
  var caps = meta.filter(function (m) { return m.c === 'lm' && !m.custom; });
  var geo = new THREE.BoxGeometry(1, 1, 1);
  var cmat = new THREE.MeshBasicMaterial({ color: C.green });
  injectPopFixed(cmat, 0.95, N_CAP);
  var im = new THREE.InstancedMesh(geo, cmat, caps.length);
  var M = new THREE.Matrix4();
  for (var i = 0; i < caps.length; i++) {
    var m = caps[i];
    var s = Math.min(13, 5 + m.h / 40);
    M.makeScale(s, 1.4, s);
    M.setPosition(m.x, m.h + 0.9, m.z);
    im.setMatrixAt(i, M);
    lmCaps.push(m);
  }
  im.frustumCulled = false;
  scene.add(im);
})();

/* ---------- build-on-load rise staggers (distance from King Fahd Rd) ---------- */
(function () {
  var samples = [];
  for (var li = 0; li < kfPolylines.length; li++) {
    var pl = kfPolylines[li];
    for (var i = 0; i < pl.length; i += 3) samples.push(pl[i]);
  }
  /* A focus city has no spine to stagger from, and with no samples this whole
     block used to bail out — which left uBuild wired to nothing, so Makkah and
     Madinah stood fully built and never rose at all. They spread from their
     mosque instead. */
  var origin = null, spread = 480;
  if (!samples.length) {
    var o = (DATA.anchors && DATA.anchors.length && DATA.anchors[DATA.anchors.length - 1])
            || (DATA.presets && (DATA.presets.mosque || DATA.presets.overview));
    origin = o ? [o.tx, o.tz] : [0, 0];
    spread = 1500;
  }
  function delayFor(x, z, id) {
    var dm = 1e18, dx, dz;
    if (origin) {
      dx = origin[0] - x; dz = origin[1] - z;
      dm = dx * dx + dz * dz;
    } else {
      for (var i = 0; i < samples.length; i++) {
        dx = samples[i][0] - x; dz = samples[i][1] - z;
        var d = dx * dx + dz * dz;
        if (d < dm) dm = d;
      }
    }
    return Math.min(1, Math.sqrt(dm) / spread) * 0.8 + Math.abs(Math.sin(id * 12.9898)) * 0.2;
  }
  var fillR = new Float32Array(fillArr.length / 3);
  var mainR = new Float32Array(edgeMain.length / 3);
  var softR = new Float32Array(edgeSoft.length / 3);
  var gridR = new Float32Array(gridLines.length / 3);
  for (var mi = 0; mi < meta.length; mi++) {
    var m = meta[mi];
    var dl = delayFor(m.x, m.z, mi);
    fillR.fill(dl, m.vStart / 3, (m.vStart + m.vCount) / 3);
    mainR.fill(dl, m.eS / 3, (m.eS + m.eC) / 3);
    softR.fill(dl, m.sS / 3, (m.sS + m.sC) / 3);
    gridR.fill(dl, m.gS / 3, (m.gS + m.gC) / 3);
  }
  fillGeo.setAttribute('aRise', new THREE.BufferAttribute(fillR, 1));
  edgeMainMesh.geometry.setAttribute('aRise', new THREE.BufferAttribute(mainR, 1));
  edgeSoftMesh.geometry.setAttribute('aRise', new THREE.BufferAttribute(softR, 1));
  gridGeo.setAttribute('aRise', new THREE.BufferAttribute(gridR, 1));
  injectRiseY(fillMesh.material, N_FILL);
  injectRiseY(edgeMainMesh.material, N_EDGE);
  injectRiseY(edgeSoftMesh.material, N_SOFT);
  injectRiseY(gridMat, N_GRID);
  injectNight(roadMesh.material, N_ROAD);
  injectNight(dashMesh.material, N_DASH);
  injectNight(roadBorderMesh.material, N_BORD);
})();

/* ---------- ground ---------- */
var groundMat = new THREE.MeshBasicMaterial({ color: C.ground });
(function () {
  var g = new THREE.PlaneGeometry(30000, 30000);
  var mesh = new THREE.Mesh(g, groundMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.5;
  scene.add(mesh);
})();

/* ---------- day / night ---------- */
var nightVal = 0, nightTarget = 0;
var DAY_BG = new THREE.Color(0xffffff), NIGHT_BG = new THREE.Color(0x0E1033);
var DAY_GROUND = new THREE.Color(C.ground), NIGHT_GROUND = new THREE.Color(0x121441);
var _bgc = new THREE.Color();

function applyNight(t) {
  nightUniform.value = t;
  scene.background = _bgc.copy(DAY_BG).lerp(NIGHT_BG, t);
  groundMat.color.copy(DAY_GROUND).lerp(NIGHT_GROUND, t);
  var uiRoot = (typeof root !== 'undefined' && root.host) ? root.host : document.body;
  uiRoot.classList.toggle('night', t > 0.5);
}

/* ---------- highlight ---------- */
var hiGeo = new THREE.BufferGeometry();
var hiMesh = new THREE.Mesh(hiGeo, new THREE.MeshBasicMaterial({
  color: C.green, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide
}));
hiMesh.visible = false; hiMesh.frustumCulled = false;
scene.add(hiMesh);
var hovered = null;

function setHighlight(m) {
  if (m === hovered) return;
  hovered = m;
  if (!m) { hiMesh.visible = false; canvas.style.cursor = ''; return; }
  var sub = fillArr.subarray(m.vStart, m.vStart + m.vCount);
  hiGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sub), 3));
  hiGeo.computeBoundingSphere();
  hiMesh.visible = true;
  canvas.style.cursor = 'pointer';
}

/* ---------- labels ---------- */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var labelWrap = document.getElementById('labels');
var labels = [];
var labeledNames = {};
meta.slice().sort(function (a, b) { return b.h - a.h; }).forEach(function (m) {
  if (!m.lb || labeledNames[m.n]) return;
  labeledNames[m.n] = true;
  var el = document.createElement('div');
  el.className = 'lbl';
  el.innerHTML = '<span class="dot"></span>' + esc(m.n) + '<em>' + Math.round(m.h) + ' m</em>';
  labelWrap.appendChild(el);
  labels.push({ m: m, el: el });
});

/* landmark quick-nav list in the sidebar */
var lmList = document.getElementById('lmlist');
labels.forEach(function (L) {
  var li = document.createElement('li');
  li.innerHTML = '<span>' + esc(L.m.n) + '</span><em>' + Math.round(L.m.h) + ' m</em>';
  li.addEventListener('click', function () {
    document.querySelectorAll('[data-view]').forEach(function (x) { x.classList.remove('on'); });
    document.querySelectorAll('#lmlist li').forEach(function (x) { x.classList.remove('on'); });
    li.classList.add('on');
    flyTo({ tx: L.m.x, tz: L.m.z, azim: view.azim, elev: 0.55, size: Math.max(650, L.m.h * 3.2) }, 950);
    idleT = 0;
  });
  lmList.appendChild(li);
});

var _v = new THREE.Vector3();
var placedRects = [];
function updateLabels() {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  var maxShown = view.size < 1800 ? 15 : view.size < 4200 ? 9 : view.size < 8000 ? 5 : 3;
  placedRects.length = 0;
  for (var i = 0; i < labels.length; i++) {
    var L = labels[i];
    if (i >= maxShown) { L.el.style.display = 'none'; continue; }
    _v.set(L.m.x, L.m.h + 6, L.m.z).project(camera);
    if (_v.x < -1.05 || _v.x > 1.05 || _v.y < -1.05 || _v.y > 1.05) { L.el.style.display = 'none'; continue; }
    var px = (_v.x * 0.5 + 0.5) * w, py = (-_v.y * 0.5 + 0.5) * h;
    if (!L.w) L.w = L.el.offsetWidth || 120;
    var rect = { x0: px - L.w / 2, x1: px + L.w / 2, y0: py - 24, y1: py };
    var clash = false;
    for (var r = 0; r < placedRects.length; r++) {
      var R = placedRects[r];
      if (rect.x0 < R.x1 && rect.x1 > R.x0 && rect.y0 < R.y1 && rect.y1 > R.y0) { clash = true; break; }
    }
    if (clash) { L.el.style.display = 'none'; continue; }
    placedRects.push(rect);
    L.el.style.display = 'block';
    L.el.style.transform = 'translate(-50%,-100%) translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
  }
}

/* ---------- tooltip + picking ---------- */
var tip = document.getElementById('tip');
var ray = new THREE.Raycaster();
var mouseNdc = new THREE.Vector2();
var mousePx = { x: 0, y: 0 };
var needPick = false;

function pick() {
  ray.setFromCamera(mouseNdc, camera);
  var hit = ray.intersectObject(fillMesh, false)[0];
  if (hit && hit.faceIndex != null) {
    var m = buildingFromFace(hit.faceIndex);
    setHighlight(m);
    var name = m.n ? esc(m.n) : (CAT_INFO[m.c] || 'Building');
    var sub = (m.n ? CAT_INFO[m.c] + ' · ' : '≈ ') + Math.round(m.h) + ' m';
    tip.innerHTML = '<b>' + name + '</b><span>' + sub + '</span>';
    tip.style.display = 'block';
    var tw = tip.offsetWidth;
    var x = Math.min(canvas.clientWidth - tw - 12, mousePx.x + 14);
    tip.style.transform = 'translate(' + x + 'px,' + (mousePx.y + 16) + 'px)';
  } else {
    setHighlight(null);
    tip.style.display = 'none';
  }
}

/* ---------- input ---------- */
var interactive = true;
var drag = null;
var pointers = {};
var pinch0 = 0, size0 = 0;

canvas.addEventListener('pointerdown', function (e) {
  if (!interactive) return;
  canvas.setPointerCapture(e.pointerId);
  pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var n = Object.keys(pointers).length;
  if (n === 2) {
    var ids = Object.keys(pointers);
    var a = pointers[ids[0]], b = pointers[ids[1]];
    pinch0 = Math.hypot(a.x - b.x, a.y - b.y); size0 = view.size;
    drag = { mode: 'pinch' };
  } else {
    var pan = e.button === 2 || e.ctrlKey || e.metaKey || e.shiftKey;
    drag = { mode: pan ? 'pan' : 'rot', x: e.clientX, y: e.clientY };
  }
  fly = null; idleT = 0;
});
window.addEventListener('pointerup', function (e) {
  delete pointers[e.pointerId];
  if (Object.keys(pointers).length === 0) drag = null;
});
canvas.addEventListener('pointermove', function (e) {
  if (!interactive) return;
  var rct = canvas.getBoundingClientRect();
  mousePx.x = e.clientX - rct.left; mousePx.y = e.clientY - rct.top;
  mouseNdc.x = (mousePx.x / rct.width) * 2 - 1;
  mouseNdc.y = -(mousePx.y / rct.height) * 2 + 1;
  if (pointers[e.pointerId]) { pointers[e.pointerId].x = e.clientX; pointers[e.pointerId].y = e.clientY; }
  if (!drag) { needPick = true; return; }
  idleT = 0;
  if (drag.mode === 'pinch') {
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0 && pinch0 > 0) view.size = clamp(size0 * pinch0 / d, 160, 15000);
    }
    return;
  }
  var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.mode === 'rot') {
    view.azim -= dx * 0.0052;
    view.elev = clamp(view.elev + dy * 0.0042, 0.16, 1.5);
  } else {
    var k = view.size / canvas.clientHeight;
    var ca = Math.cos(view.azim), sa = Math.sin(view.azim);
    // screen right in world: (cos a, 0, -sin a); screen up on ground: (-sin a/ , ...)
    view.tx -= (dx * ca - dy * sa / Math.max(0.25, Math.sin(view.elev))) * k;
    view.tz -= (-dx * sa - dy * ca / Math.max(0.25, Math.sin(view.elev))) * k;
  }
});
canvas.addEventListener('wheel', function (e) {
  if (!interactive) return;
  e.preventDefault();
  view.size = clamp(view.size * Math.exp(e.deltaY * 0.0012), 160, 15000);
  idleT = 0; fly = null;
}, { passive: false });
canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

canvas.addEventListener('dblclick', function (e) {
  if (!interactive) return;
  var rct = canvas.getBoundingClientRect();
  mouseNdc.x = ((e.clientX - rct.left) / rct.width) * 2 - 1;
  mouseNdc.y = -((e.clientY - rct.top) / rct.height) * 2 + 1;
  ray.setFromCamera(mouseNdc, camera);
  var t = -ray.ray.origin.y / ray.ray.direction.y;
  if (t > 0) {
    var px = ray.ray.origin.x + ray.ray.direction.x * t;
    var pz = ray.ray.origin.z + ray.ray.direction.z * t;
    flyTo({ tx: px, tz: pz, azim: view.azim, elev: view.elev, size: Math.max(500, view.size * 0.45) }, 800);
  }
});

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/* ---------- presets ---------- */
function findByName(n) {
  var best = null;
  meta.forEach(function (m) { if (m.n === n && (!best || m.h > best.h)) best = m; });
  return best;
}
var extent = (function () {
  var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  meta.forEach(function (m) {
    minx = Math.min(minx, m.x); maxx = Math.max(maxx, m.x);
    minz = Math.min(minz, m.z); maxz = Math.max(maxz, m.z);
  });
  return { cx: (minx + maxx) / 2, cz: (minz + maxz) / 2, h: maxz - minz };
})();

var PRESETS;
if (DATA.presets) {
  /* scene ships its own views (any city) — build the chips to match */
  PRESETS = {};
  var chipWrap = document.querySelector('.chips');
  if (chipWrap) chipWrap.innerHTML = '';
  Object.keys(DATA.presets).forEach(function (key, i) {
    var p = DATA.presets[key];
    PRESETS[key] = function () {
      return { tx: p.tx, tz: p.tz, azim: p.azim, elev: p.elev, size: p.size };
    };
    if (chipWrap) {
      var btn = document.createElement('button');
      btn.setAttribute('data-view', key);
      btn.textContent = p.label || key;
      if (i === 1 || (i === 0 && Object.keys(DATA.presets).length === 1)) btn.classList.add('on');
      chipWrap.appendChild(btn);
    }
  });
} else {
  PRESETS = {
    overview: function () { return { tx: extent.cx, tz: extent.cz, azim: -0.65, elev: 0.9, size: extent.h * 1.02 }; },
    kingdom: (function () { var m = findByName('Kingdom Centre'); return m && function () { return { tx: m.x, tz: m.z, azim: -0.75, elev: 0.5, size: 950 }; }; })(),
    kafd: (function () { var m = findByName('PIF Tower'); return m && function () { return { tx: m.x, tz: m.z - 150, azim: -0.45, elev: 0.52, size: 1750 }; }; })(),
    faisaliah: (function () { var m = findByName('Al Faisaliyah Tower'); return m && function () { return { tx: m.x, tz: m.z, azim: -0.85, elev: 0.5, size: 950 }; }; })()
  };
}
document.querySelectorAll('[data-view]').forEach(function (btn) {
  var fn = PRESETS[btn.getAttribute('data-view')];
  if (!fn) { btn.style.display = 'none'; return; }
  btn.addEventListener('click', function () {
    document.querySelectorAll('[data-view]').forEach(function (b) { b.classList.remove('on'); });
    document.querySelectorAll('#lmlist li').forEach(function (x) { x.classList.remove('on'); });
    btn.classList.add('on');
    flyTo(fn(), 1000);
    idleT = 0;
  });
});

/* orbit toggle */
var orbiting = false, idleT = 0;
var orbBtn = document.getElementById('orbit');
orbBtn.addEventListener('click', function () {
  orbiting = !orbiting;
  orbBtn.classList.toggle('on', orbiting);
});

/* night toggle */
var nightBtn = document.getElementById('nightBtn');
if (nightBtn) {
  nightBtn.addEventListener('click', function () {
    nightTarget = nightTarget > 0.5 ? 0 : 1;
    nightBtn.classList.toggle('on', nightTarget > 0.5);
    nightBtn.textContent = nightTarget > 0.5 ? 'Day' : 'Night';
  });
}
document.getElementById('compass').addEventListener('click', function () {
  flyTo({ tx: view.tx, tz: view.tz, azim: 0, elev: view.elev, size: view.size }, 700);
});

/* sidebar toggle */
var sideEl = document.getElementById('side');
var sideBtn = document.getElementById('sideBtn');
function setSide(open) {
  sideEl.classList.toggle('closed', !open);
  sideBtn.classList.toggle('open', open);
}
sideBtn.addEventListener('click', function () { setSide(sideEl.classList.contains('closed')); });
if (window.matchMedia('(max-width: 700px)').matches) setSide(false);

/* start view: the scene's signature stretch */
(function () {
  if (DATA.presets) {
    var keys = Object.keys(DATA.presets);
    var p = DATA.presets[keys[1]] || DATA.presets[keys[0]];
    view.tx = p.tx; view.tz = p.tz;
    view.azim = p.azim; view.elev = p.elev; view.size = p.size;
    return;
  }
  var k = findByName('Kingdom Centre');
  if (k) { view.tx = k.x; view.tz = k.z + 150; }
  view.size = 2100;
})();

/* ---------- camera path for scroll-scrubbing (south → north) ---------- */
var pathAnchors = (function () {
  if (DATA.anchors && DATA.anchors.length >= 2) return DATA.anchors;
  var stops = [
    ['Al Faisaliyah Tower', { azim: -0.85, elev: 0.5, size: 900, dz: 0 }],
    ['Kingdom Centre',      { azim: -0.6,  elev: 0.56, size: 1000, dz: 0 }],
    ['Al Majdoul Tower',    { azim: -0.35, elev: 0.62, size: 1600, dz: 0 }],
    ['PIF Tower',           { azim: -0.05, elev: 0.5, size: 1300, dz: -120 }]
  ];
  var A = [];
  for (var i = 0; i < stops.length; i++) {
    var m = findByName(stops[i][0]);
    if (m) {
      var s = stops[i][1];
      A.push({ tx: m.x, tz: m.z + (s.dz || 0), azim: s.azim, elev: s.elev, size: s.size });
    }
  }
  return A.length >= 2 ? A : null;
})();

function scrubPath(t) {
  if (!pathAnchors) return;
  t = Math.max(0, Math.min(1, t));
  fly = null;
  var n = pathAnchors.length - 1;
  var f = t * n, i = Math.min(n - 1, Math.floor(f));
  var k = f - i;
  k = k * k * (3 - 2 * k);   // smoothstep between anchors
  var A = pathAnchors[i], B = pathAnchors[i + 1];
  view.tx = A.tx + (B.tx - A.tx) * k;
  view.tz = A.tz + (B.tz - A.tz) * k;
  view.azim = A.azim + (B.azim - A.azim) * k;
  view.elev = A.elev + (B.elev - A.elev) * k;
  view.size = A.size + (B.size - A.size) * k;
}

/* ---------- route stroke: the road that draws itself ---------- */
var routeStroke = (function () {
  if (!pathAnchors) return null;
  var pts = pathAnchors.map(function (a) { return new THREE.Vector3(a.tx, 0, a.tz); });
  var ext0 = pts[0].clone().sub(pts[1]).setLength(900).add(pts[0]);
  var extN = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).setLength(900).add(pts[pts.length - 1]);
  pts.unshift(ext0); pts.push(extN);
  var curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  var cps = curve.getPoints(160).map(function (p) { return [p.x, p.z]; });
  var pos = [], col = [];
  ribbon(cps, 90, 1.8, C.ink, pos, col);   // bold ink stroke — sized for the 11 km plan zoom
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  // geometry is prebuilt; the mesh is created lazily on first setRoute call
  return { geo: g, segs: cps.length - 1, mesh: null };
})();

function armRouteStroke() {
  if (!routeStroke || routeStroke.mesh) return;
  var mesh = new THREE.Mesh(routeStroke.geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
    depthTest: false, depthWrite: false      // intro plays over a flat plan — draw on top
  }));
  mesh.renderOrder = 40;
  mesh.frustumCulled = false;
  scene.add(mesh);
  routeStroke.mesh = mesh;
}

/* ---------- public API (window.KFR / <kfr-map> element) ---------- */
function lookupTarget(name) {
  if (PRESETS[name]) return PRESETS[name]();
  var m = findByName(name);
  if (m) return { tx: m.x, tz: m.z, azim: view.azim, elev: 0.55, size: Math.max(650, m.h * 3.2) };
  return null;
}
var api = {
  scrub: scrubPath,
  flyTo: function (name, ms) {
    var t = lookupTarget(name);
    if (t) { flyTo(t, ms || 1000); idleT = 0; }
    return !!t;
  },
  jump: function (name) {
    var t = lookupTarget(name);
    if (t) { for (var k in t) view[k] = t[k]; fly = null; }
    return !!t;
  },
  setInteractive: function (b) {
    interactive = !!b;
    canvas.style.pointerEvents = b ? 'auto' : 'none';
    var tools = document.getElementById('tools');
    if (tools) tools.style.display = b ? '' : 'none';
    if (!b) { setHighlight(null); tip.style.display = 'none'; }
  },
  showSidebar: function (b) {
    sideEl.style.display = b ? '' : 'none';
    sideBtn.style.display = b ? '' : 'none';
    if (b) setSide(!window.matchMedia('(max-width: 700px)').matches);
  },
  setOrbit: function (b) { orbiting = !!b; orbBtn.classList.toggle('on', !!b); },
  landmarks: function () {
    return labels.map(function (L) { return { name: L.m.n, height: L.m.h }; });
  },
  setBuild: function (v) {
    buildUniform.value = v;
    labelWrap.style.opacity = v >= 1.3 ? '' : '0';
    if (routeStroke && routeStroke.mesh) {
      var op = 0.95 * Math.max(0, Math.min(1, 1 - (v - 1.05) / 0.35));
      routeStroke.mesh.material.opacity = op;
      routeStroke.mesh.visible = op >= 0.02;
    }
  },
  setRoute: function (t) {
    t = Math.max(0, Math.min(1, t));
    armRouteStroke();
    if (routeStroke && routeStroke.mesh) {
      routeStroke.geo.setDrawRange(0, Math.round(routeStroke.segs * t) * 6);
      routeStroke.mesh.visible = t > 0 && routeStroke.mesh.material.opacity > 0.02;
    }
    roadMesh.material.opacity = t;
    dashMesh.material.opacity = 0.8 * t;
    roadBorderMesh.material.opacity = 0.22 * t;
  },
  setNight: function (t) {
    nightTarget = nightVal = Math.max(0, Math.min(1, t));
    applyNight(nightVal);
    if (nightBtn) {
      nightBtn.classList.toggle('on', nightVal > 0.5);
      nightBtn.textContent = nightVal > 0.5 ? 'Day' : 'Night';
    }
  },
  targetOf: lookupTarget,
  renderOnce: function () { resize(); applyCamera(); renderer.render(scene, camera); },
  _rs: routeStroke,
  view: view
};
window.KFR = api;

/* ---------- resize / loop ---------- */
function resize() {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
    renderer.setSize(w, h, false);
  }
}
var compassNeedle = document.getElementById('needle');
var last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  var dt = (now - last) / 1000; last = now;
  stepFly(now);
  if (orbiting && !drag && !fly) view.azim += dt * 0.07;
  resize();
  applyCamera();
  if (Math.abs(nightTarget - nightVal) > 0.002) {
    nightVal += (nightTarget - nightVal) * Math.min(1, dt * 4);
    applyNight(nightVal);
  }
  var gop = view.size < 1400 ? 0.24 : view.size < 4200 ? 0.24 * (4200 - view.size) / 2800 : 0;
  gop = Math.max(gop, nightVal * 0.6);   // at night the windows glow from any distance
  gridMesh.visible = gop > 0.015;
  gridMat.opacity = gop;
  if (needPick && !drag) { needPick = false; pick(); }
  /* compass: project north (-z) to screen angle */
  _v.set(view.tx, 0, view.tz - 100).project(camera);
  var _o = new THREE.Vector3(view.tx, 0, view.tz).project(camera);
  var ang = Math.atan2(_v.x - _o.x, _v.y - _o.y) * 180 / Math.PI;
  compassNeedle.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)';
  updateLabels();
  renderer.render(scene, camera);
}
document.getElementById('loading').classList.add('done');
document.getElementById('stats').textContent =
  DATA.buildings.length.toLocaleString() + ' real building footprints · ' + labels.length + ' landmarks';
requestAnimationFrame(frame);
})();
