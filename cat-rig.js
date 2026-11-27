/* ============================================================================
 * CatRig — hand-built skeleton, rule-based skinning and a small IK driver for
 * the Poly cat copy (rig-demo/model/cat-source.glb -> rig-demo/cat-mesh.js).
 *
 * Units are the model's own: y = -35.645 is the floor, +z is the nose.
 * Nothing here touches the game.
 *
 *   var cat = CatRig(THREE, window.CAT_MESH);
 *   scene.add(cat.group);
 *   cat.setAction('walk');   // walk | run | sit | fight | standoff
 *   cat.update(dt);
 *   cat.speed();             // m/s, for the scrolling floor
 *   cat.setBonesVisible(on);
 * ==========================================================================*/
window.CatRig = function (THREE, M) {
  'use strict';

  var TAU = Math.PI * 2;
  var UNIT = 1.46 / (M.bbox[4] - M.bbox[1]);   // mesh units -> metres
  var GROUND = -35.6;                           // paw plane, model units

  function c01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function sstep(a, b, x) { var t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }

  /* ---------------------------------------------------------------- 1. bones
   * Rest pose = the model's standing pose, every bone at identity rotation, so
   * each bone's local axes match the model axes.  .x = pitch, .y = yaw,
   * .z = roll. */
  var DEF = [
    ['root',    null,      0,      0,     0],
    ['hips',    'root',    0,     -4,   -18],
    ['spine',   'hips',    0,     -3,    -6],
    ['chest',   'spine',   0,     -2,     8],
    ['neck',    'chest',   0,      0,    16],
    ['head',    'neck',    0,      2,    21],
    ['earL',    'head',    3.1,    5.2,  31.0],
    ['earR',    'head',   -3.1,    5.2,  31.0],

    ['tail1',   'hips',    0,      0,   -25],
    ['tail2',   'tail1',   0,      3.5, -29],
    ['tail3',   'tail2',   0,      8,   -32.5],
    ['tail4',   'tail3',   0,     16,   -38],
    ['tail5',   'tail4',   0,     26,   -38.5],

    ['armL',    'chest',   5.6,  -15.5,  12.6],
    ['foreL',   'armL',    5.5,  -27.0,  10.1],
    ['pawL',    'foreL',   4.8,  -33.0,  12.0],
    ['armR',    'chest',  -5.6,  -15.5,  12.6],
    ['foreR',   'armR',   -5.5,  -27.0,  10.1],
    ['pawR',    'foreR',  -4.8,  -33.0,  12.0],

    ['thighL',  'hips',    5.45, -14.2, -14.2],
    ['shinL',   'thighL',  6.11, -18.2, -20.9],
    ['footL',   'shinL',   5.18, -26.0, -26.2],
    ['thighR',  'hips',   -5.45, -14.2, -14.2],
    ['shinR',   'thighR', -6.11, -18.2, -20.9],
    ['footR',   'shinR',  -5.18, -26.0, -26.2]
  ];

  var TIPS = {
    head:  [0, 3, 35],
    earL:  [4.8, 12.6, 34.5], earR: [-4.8, 12.6, 34.5],
    tail5: [0, 35.6, -41],
    pawL:  [4.8, -36.2, 13.4], pawR: [-4.8, -36.2, 13.4],
    footL: [4.66, -36.0, -18.3], footR: [-4.66, -36.0, -18.3]
  };

  var boneByName = {}, absOf = {}, order = [], bones = [];
  var SEG = {};

  (function buildBones() {
    var byName = {};
    DEF.forEach(function (d) { byName[d[0]] = d; });

    DEF.forEach(function (d) {
      var name = d[0], parent = d[1];
      var b = new THREE.Bone();
      b.name = name;
      var p = byName[parent];
      b.position.set(d[2] - (p ? p[2] : 0), d[3] - (p ? p[3] : 0), d[4] - (p ? p[4] : 0));
      absOf[name] = [d[2], d[3], d[4]];
      boneByName[name] = b;
      if (parent) boneByName[parent].add(b);
      order.push(name);
      bones.push(b);
    });

    order.forEach(function (name) {
      var tip = TIPS[name];
      if (!tip) {
        for (var i = 0; i < DEF.length; i++) {
          if (DEF[i][1] === name) { tip = absOf[DEF[i][0]]; break; }
        }
      }
      if (tip) SEG[name] = { a: absOf[name], b: tip };
    });
  })();

  var DEFORM = order.filter(function (n) { return n !== 'root'; });

  /* ------------------------------------------------------------- 2. the mesh
   * 1179 verts / 310 unique positions: the hard edges split every face.  Solve
   * weights once per welded position and copy to the split twins so a seam can
   * never crack. */
  var VCOUNT = M.pos.length / 3;
  var weldOf = new Int32Array(VCOUNT), weldPos = [], weldVerts = [];
  (function weld() {
    var map = {};
    for (var i = 0; i < VCOUNT; i++) {
      var k = M.pos[i * 3].toFixed(3) + '|' + M.pos[i * 3 + 1].toFixed(3) + '|' + M.pos[i * 3 + 2].toFixed(3);
      var w = map[k];
      if (w === undefined) {
        w = map[k] = weldPos.length;
        weldPos.push([M.pos[i * 3], M.pos[i * 3 + 1], M.pos[i * 3 + 2]]);
        weldVerts.push([]);
      }
      weldOf[i] = w;
      weldVerts[w].push(i);
    }
  })();

  var islandOf = new Int32Array(weldPos.length), islands = [];
  (function findIslands() {
    var n = weldPos.length, parent = new Int32Array(n);
    for (var i = 0; i < n; i++) parent[i] = i;
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    for (var t = 0; t < M.idx.length; t += 3) {
      var a = find(weldOf[M.idx[t]]), b = find(weldOf[M.idx[t + 1]]), c = find(weldOf[M.idx[t + 2]]);
      parent[a] = c; parent[find(b)] = c;
    }
    var byRoot = {};
    for (var w = 0; w < n; w++) {
      var r = find(w), id = byRoot[r];
      if (id === undefined) { id = byRoot[r] = islands.length; islands.push([]); }
      islandOf[w] = id;
      islands[id].push(w);
    }
  })();

  var islandKind = islands.map(function (list) {
    var cx = 0, cy = 0, cz = 0;
    list.forEach(function (w) { cx += weldPos[w][0]; cy += weldPos[w][1]; cz += weldPos[w][2]; });
    cx /= list.length; cy /= list.length; cz /= list.length;
    if (list.length > 100) return 'body';
    if (cz < -20) return 'tail';
    if (Math.abs(cx) > 2.5 && cz > 27) return 'ear';
    if (cz > 36) return 'eye';
    return 'body';
  });

  /* --------------------------------------------------------------- 3. weights */
  function distSeg(p, a, b) {
    var abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    var apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
    var d = abx * abx + aby * aby + abz * abz;
    var t = d > 1e-9 ? (apx * abx + apy * aby + apz * abz) / d : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  var TORSO = [
    ['hips',  -18, 9],
    ['spine',  -7, 8],
    ['chest',   6, 10],
    ['neck',   17, 5],
    ['head',   26, 11]
  ];

  function torsoWeights(p) {
    var z = p[2], out = [];
    for (var i = 0; i < TORSO.length; i++) {
      var c = TORSO[i][1], hw = TORSO[i][2];
      var w = 1 - Math.abs(z - c) / hw;
      // the kernels must cover the ends of the body: everything past the head
      // pivot is skull, everything behind the pelvis is rump.  Without this the
      // muzzle fell through to the fallback bone and the face tore apart.
      if (i === 0 && z < c) w = 1;
      if (i === TORSO.length - 1 && z > c) w = 1;
      if (w > 0.0001) out.push([TORSO[i][0], w]);
    }
    if (!out.length) out.push([(z > 0 ? 'head' : 'hips'), 1]);
    return out;
  }

  function chainWeights(y, names, joints) {
    var top = joints[0], j1 = joints[1], j2 = joints[2];
    if (y >= j1) {
      var t = sstep(top + 2.0, j1 - 1.5, y);
      return [[names[0], 1 - t * 0.35], [names[1], t * 0.35], [names[2], 0]];
    }
    if (y >= j2) {
      var u = (j1 - y) / (j1 - j2);
      var wp = c01(0.30 - u) / 0.30 * 0.5;
      var wn = c01(u - 0.70) / 0.30 * 0.5;
      return [[names[0], wp], [names[1], 1 - wp - wn], [names[2], wn]];
    }
    return [[names[0], 0], [names[1], 0.35], [names[2], 0.65]];
  }

  var LEGDEF = {
    front: { joints: [-15.5, -27.0, -33.0], zmin: 4, zmax: 20, gate: [-15.0, -19.5] },
    hind:  { joints: [-14.2, -18.2, -26.0], zmin: -34, zmax: -4, gate: [-13.5, -19.0] }
  };

  function legWeights(p, side, kind) {
    var names = kind === 'front'
      ? ['arm' + side, 'fore' + side, 'paw' + side]
      : ['thigh' + side, 'shin' + side, 'foot' + side];
    return chainWeights(p[1], names, LEGDEF[kind].joints);
  }

  function tailWeights(p) {
    var out = [];
    for (var i = 1; i <= 5; i++) {
      var s = SEG['tail' + i];
      var d = distSeg(p, s.a, s.b);
      out.push(['tail' + i, Math.exp(-(d / 3.4) * (d / 3.4))]);
    }
    out.sort(function (a, b) { return b[1] - a[1]; });
    return out.slice(0, 2);
  }

  function weightsAt(p, kind) {
    if (kind === 'tail') return normalize(tailWeights(p), 2);
    if (kind === 'eye') return [['head', 1]];

    var x = p[0], y = p[1], z = p[2];
    var side = x >= 0 ? 'L' : 'R';
    var best = null, bestW = 0;

    // A paw can be narrower than the torso, so the gate is "wide enough OR
    // clearly below the belly" — otherwise inner paw verts fall through to the
    // neck and the foot gets ripped across the body.
    var outreach = Math.abs(x) > 3.0 || y < -24;

    if (outreach) {
      for (var i = 0; i < 2; i++) {
        var k = i === 0 ? 'front' : 'hind';
        var d = LEGDEF[k];
        if (z < d.zmin || z > d.zmax) continue;
        var w = sstep(d.gate[0], d.gate[1], y);
        if (w > bestW) { bestW = w; best = k; }
      }
    }

    var body = torsoWeights(p);
    if (!best) return normalize(body, 4);

    var out = [];
    legWeights(p, side, best).forEach(function (e) {
      if (e[1] > 0 && bestW > 0.001) out.push([e[0], e[1] * bestW]);
    });
    body.forEach(function (e) {
      if (e[1] > 0 && bestW < 0.999) out.push([e[0], e[1] * (1 - bestW)]);
    });
    return normalize(out, 4);
  }

  function normalize(list, maxN) {
    var sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i][1];
    if (sum <= 0) return [['hips', 1]];
    list.sort(function (a, b) { return b[1] - a[1]; });
    if (list.length > maxN) list = list.slice(0, maxN);
    for (i = 0; i < list.length; i++) list[i][1] /= sum;
    return list;
  }

  var boneIndex = {};
  bones.forEach(function (b, i) { boneIndex[b.name] = i; });   // root included: skinIndex indexes the Skeleton array

  var skinIndex = new Uint16Array(VCOUNT * 4);
  var skinWeight = new Float32Array(VCOUNT * 4);

  (function solveSkin() {
    for (var w = 0; w < weldPos.length; w++) {
      var kind = islandKind[islandOf[w]];
      var p = weldPos[w];
      var list;
      if (kind === 'ear') list = [[(p[0] > 0 ? 'earL' : 'earR'), 1]];
      else list = weightsAt(p, kind);
      list = normalize(list, 4);

      var verts = weldVerts[w];
      for (var v = 0; v < verts.length; v++) {
        var o = verts[v] * 4;
        for (var s = 0; s < 4; s++) {
          var e = list[s];
          skinIndex[o + s] = e ? boneIndex[e[0]] : 0;
          skinWeight[o + s] = e ? e[1] : 0;
        }
      }
    }
  })();

  /* ------------------------------------------------------------- 4. geometry */
  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(M.pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(M.nrm, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  var furIdx = [], eyeIdx = [];
  for (var t0 = 0; t0 < M.idx.length; t0 += 3) {
    var k0 = islandKind[islandOf[weldOf[M.idx[t0]]]];
    (k0 === 'eye' ? eyeIdx : furIdx).push(M.idx[t0], M.idx[t0 + 1], M.idx[t0 + 2]);
  }
  geometry.setIndex(furIdx.concat(eyeIdx));
  geometry.addGroup(0, furIdx.length, 0);
  if (eyeIdx.length) geometry.addGroup(furIdx.length, eyeIdx.length, 1);

  var furMat = new THREE.MeshStandardMaterial({
    color: 0x090909, roughness: 0.62, metalness: 0.05, flatShading: true, skinning: true
  });
  var eyeMat = new THREE.MeshStandardMaterial({
    color: 0xffc21e, emissive: 0xffa000, emissiveIntensity: 1.9,
    roughness: 0.32, metalness: 0.0, flatShading: true, skinning: true
  });

  var group = new THREE.Group();
  var rootBone = boneByName.root;
  var mesh = new THREE.SkinnedMesh(geometry, [furMat, eyeMat]);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  group.add(rootBone);
  group.updateMatrixWorld(true);

  var skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);

  group.scale.setScalar(UNIT);
  group.position.y = -M.bbox[1] * UNIT;

  var bonesHelper = null;

  /* ---------------------------------------------------------- 5. legs + IK
   * Every leg is a 3-bone chain solved as 2-bone IK to an ankle target, plus a
   * foot aim at the toe target.  Stance angles come from the rest pose, so a
   * neutral stance reproduces the model exactly. */
  var LEGS = [
    { id: 'frontL', kind: 'front', root: 'armL',   mid: 'foreL', tip: 'pawL' },
    { id: 'frontR', kind: 'front', root: 'armR',   mid: 'foreR', tip: 'pawR' },
    { id: 'hindL',  kind: 'hind',  root: 'thighL', mid: 'shinL', tip: 'footL' },
    { id: 'hindR',  kind: 'hind',  root: 'thighR', mid: 'shinR', tip: 'footR' }
  ];

  LEGS.forEach(function (leg) {
    var p0 = absOf[leg.root], p1 = absOf[leg.mid], p2 = absOf[leg.tip], p3 = TIPS[leg.tip];
    leg.p0 = p0;
    leg.L1 = Math.hypot(p1[1] - p0[1], p1[2] - p0[2]);
    leg.L2 = Math.hypot(p2[1] - p1[1], p2[2] - p1[2]);
    leg.L3 = Math.hypot(p3[1] - p2[1], p3[2] - p2[2]);
    leg.a0 = [
      Math.atan2(p1[2] - p0[2], -(p1[1] - p0[1])),
      Math.atan2(p2[2] - p1[2], -(p2[1] - p1[1])),
      Math.atan2(p3[2] - p2[2], -(p3[1] - p2[1]))
    ];
    leg.bones = [boneByName[leg.root], boneByName[leg.mid], boneByName[leg.tip]];
    leg.bend = leg.kind === 'front' ? -1 : 1;
  });

  // neutral stance = the rest pose of the model
  var STANCE = {
    frontL: { x:  5.0, y: GROUND + 0.2, z: 13.2, a: 0.42 },
    frontR: { x: -5.0, y: GROUND + 0.2, z: 13.2, a: 0.42 },
    hindL:  { x:  4.9, y: GROUND + 0.2, z: -18.2, a: 0.72 },
    hindR:  { x: -4.9, y: GROUND + 0.2, z: -18.2, a: 0.72 }
  };

  var tmpV = new THREE.Vector3();
  var tmpQ = new THREE.Quaternion();

  function worldPitch(bone) {
    bone.getWorldQuaternion(tmpQ);
    return 2 * Math.atan2(tmpQ.x, tmpQ.w);
  }

  function meshPos(bone, out) {
    out.setFromMatrixPosition(bone.matrixWorld);
    group.worldToLocal(out);
    return out;
  }

  function solveLeg(leg, tgt) {
    var p = meshPos(leg.bones[0], tmpV);
    var ry = p.y, rz = p.z;

    // ankle sits one foot-length behind the toe
    var az = tgt.z - leg.L3 * Math.sin(tgt.a);
    var ay = tgt.y + leg.L3 * Math.cos(tgt.a);

    var dz = az - rz, dy = ay - ry;
    var d = Math.sqrt(dz * dz + dy * dy) || 1e-4;
    d = Math.max(Math.abs(leg.L1 - leg.L2) + 0.8, Math.min(leg.L1 + leg.L2 - 0.8, d));

    var cosA = (leg.L1 * leg.L1 + d * d - leg.L2 * leg.L2) / (2 * leg.L1 * d);
    cosA = Math.max(-1, Math.min(1, cosA));
    var alpha = Math.acos(cosA) * leg.bend;
    var uz = dz / d, uy = dy / d;
    var c = Math.cos(alpha), s = Math.sin(alpha);
    var jz = uz * c - uy * s, jy = uz * s + uy * c;
    var jZ = rz + leg.L1 * jz, jY = ry + leg.L1 * jy;

    var a1 = Math.atan2(jZ - rz, -(jY - ry));
    var a2 = Math.atan2(az - jZ, -(ay - jY));

    var parentPitch = worldPitch(leg.bones[0].parent);
    // a direction's angle shrinks as +X rotation grows, hence a0 - a
    var t1 = leg.a0[0] - a1 - parentPitch;
    var t2 = leg.a0[1] - a2 - (parentPitch + t1);
    var t3 = leg.a0[2] - tgt.a - (parentPitch + t1 + t2);

    leg.bones[0].rotation.set(t1, 0, 0);
    leg.bones[1].rotation.set(t2, 0, 0);
    leg.bones[2].rotation.set(t3, 0, 0);
  }

  /* ------------------------------------------------------------- 6. actions
   * The spine is authored as world elevations (radians above horizontal) per
   * segment, which is far more predictable than stacking local Euler angles.
   * Paws are pinned by IK, so only the body attitude + foot targets matter. */
  var BODY_AIM = [];
  (function buildAim() {
    var chain = [['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head']];
    chain.forEach(function (c) {
      var a = absOf[c[0]], b = absOf[c[1]];
      BODY_AIM.push({
        bone: c[0],
        a0: Math.atan2(b[2] - a[2], -(b[1] - a[1])),
        elev: Math.atan2(b[1] - a[1], b[2] - a[2])
      });
    });
    var h = absOf.head, t = TIPS.head;
    BODY_AIM.push({
      bone: 'head',
      a0: Math.atan2(t[2] - h[2], -(t[1] - h[1])),
      elev: Math.atan2(t[1] - h[1], t[2] - h[2])
    });
  })();

  var REST_ELEV = {};
  BODY_AIM.forEach(function (b) { REST_ELEV[b.bone] = b.elev; });

  var curElev = {}, curYaw = {}, curRoll = {};
  BODY_AIM.forEach(function (b) { curElev[b.bone] = b.elev; curYaw[b.bone] = 0; curRoll[b.bone] = 0; });

  function aimBody(elev, yaw, roll) {
    var pitch = 0;
    for (var i = 0; i < BODY_AIM.length; i++) {
      var b = BODY_AIM[i];
      var e = elev[b.bone];
      // direction angle shrinks as +X rotation grows
      var t = b.a0 - (Math.PI / 2 + e) - pitch;
      boneByName[b.bone].rotation.set(t, yaw[b.bone] || 0, roll[b.bone] || 0);
      pitch += t;
    }
  }

  function stance(over) {
    var f = {};
    for (var id in STANCE) {
      f[id] = { x: STANCE[id].x, y: STANCE[id].y, z: STANCE[id].z, a: STANCE[id].a };
      if (over && over[id]) {
        for (var k in over[id]) f[id][k] = over[id][k];
      }
    }
    return f;
  }

  function set(o, name, x, y, z) { o[name] = [x || 0, y || 0, z || 0]; }

  function elevOf(d) {
    var o = {};
    for (var k in REST_ELEV) o[k] = REST_ELEV[k] + (d[k] || 0);
    return o;
  }

  function gaitFoot(tgt, id, s, stride, lift, stanceFrac) {
    var front = id.indexOf('front') === 0;
    var zBase = front ? 13.2 : -18.2;
    var aBase = front ? 0.42 : 0.72;
    if (s < stanceFrac) {
      var u = s / stanceFrac;
      tgt.z = zBase + stride * (0.5 - u);
      tgt.y = GROUND + 0.2;
      tgt.a = aBase;
    } else {
      var v = (s - stanceFrac) / (1 - stanceFrac);
      var e = v * v * (3 - 2 * v);
      tgt.z = zBase + stride * (-0.5 + e);
      tgt.y = GROUND + 0.2 + lift * Math.sin(Math.PI * v);
      tgt.a = aBase * (1 - 0.55 * Math.sin(Math.PI * v));
    }
  }

  // ---- idle: standing still — breathing, weight shift, slow look-around,
  // tail hanging with a lazy sway
  function idle(t) {
    var br = Math.sin(t * 1.7);              // breathing
    var sway = Math.sin(t * 0.33);           // weight shift
    var elev = elevOf({
      hips: 0.006 * br,
      spine: 0.010 * br,
      chest: 0.008 * br,
      neck: 0.02 * Math.sin(t * 0.48),
      head: 0.035 * Math.sin(t * 0.40) - 0.01 * br
    });

    return {
      elev: elev,
      yaw: { head: 0.09 * Math.sin(t * 0.23), neck: 0.03 * Math.sin(t * 0.29) },
      roll: { hips: 0.012 * sway },
      rootY: 0.25 * br,
      feet: stance(),
      rot: {
        earL: [0.02 * Math.sin(t * 1.3), 0, 0.02 * Math.sin(t * 0.9)],
        earR: [0.02 * Math.sin(t * 1.1), 0, -0.02 * Math.sin(t * 0.8)],
        tail: [
          [-0.62, 0, 0.05 * Math.sin(t * 0.5)],
          [-0.60, 0, 0.10 * Math.sin(t * 0.5 + 0.3)],
          [-0.58, 0, 0.14 * Math.sin(t * 0.5 + 0.6)],
          [-0.54, 0, 0.18 * Math.sin(t * 0.5 + 0.9)],
          [-0.50 + 0.06 * Math.sin(t * 2.1), 0, 0.22 * Math.sin(t * 0.5 + 1.2)]
        ]
      }
    };
  }

  // ---- walk: lateral sequence, one foot at a time
  function walk(t) {
    var T = 0.94, ph = (t / T) % 1;
    var stride = 12.5, lift = 5.0, sf = 0.64;
    var feet = stance();
    var phases = { frontL: 0.00, hindR: 0.25, frontR: 0.50, hindL: 0.75 };

    for (var id in phases) {
      gaitFoot(feet[id], id, (ph + phases[id]) % 1, stride, lift, sf);
    }

    var w = ph * TAU;
    var elev = elevOf({
      hips: 0.02 * Math.sin(w * 2 + 0.4) - 0.01,
      spine: 0.02 * Math.sin(w * 2 + 1.1),
      chest: 0.015 * Math.sin(w * 2 + 1.6),
      neck: -0.02 * Math.sin(w * 2 + 0.2),
      head: -0.02 * Math.sin(w * 2 + 0.8)
    });
    return {
      elev: elev,
      yaw: { hips: 0.05 * Math.sin(w), spine: 0.04 * Math.sin(w + 0.3), chest: 0.03 * Math.sin(w), neck: -0.04 * Math.sin(w), head: -0.03 * Math.sin(w) },
      roll: { hips: 0.03 * Math.sin(w), spine: -0.02 * Math.sin(w) },
      rootY: 0.9 * Math.sin(w * 2 + 0.6),
      feet: feet,
      rot: { tail: tailWave(ph, 0.12, 0.20, 1.0) }
    };
  }

  // ---- run: transverse gallop — four-beat footfall LH, RH, LF, RF so the
  // left/right legs are always staggered and the same side never pairs up
  function run(t) {
    var T = 0.44, ph = (t / T) % 1;
    var stride = 20, lift = 9, sf = 0.32;
    var feet = stance();
    var phases = { hindL: 0.00, hindR: 0.12, frontL: 0.28, frontR: 0.40 };

    for (var id in phases) {
      gaitFoot(feet[id], id, (ph + phases[id]) % 1, stride, lift, sf);
    }

    var w = ph * TAU;
    var elev = elevOf({
      hips: 0.10 * Math.sin(w * 2 + 0.2),
      spine: 0.13 * Math.sin(w * 2 + 1.0),
      chest: 0.09 * Math.sin(w * 2 + 1.5),
      neck: -0.10 * Math.sin(w * 2 + 0.4),
      head: -0.05 * Math.sin(w * 2 + 1.0)
    });
    return {
      elev: elev,
      yaw: { hips: 0.06 * Math.sin(w), spine: 0.05 * Math.sin(w + 0.3) },
      roll: { hips: 0.05 * Math.sin(w), spine: -0.03 * Math.sin(w) },
      rootY: 2.2 * Math.sin(w * 2 + 0.4),
      feet: feet,
      rot: {
        tail: tailWave(ph, 0.08, 0.30, 1.6),
        earL: [-0.18, 0, 0], earR: [-0.18, 0, 0]
      }
    };
  }

  // ---- sit: haunches down, chest up, front legs straight, tail curled round
  function sit(t) {
    var br = Math.sin(t * 2.1) * 0.02;
    var elev = elevOf({
      hips: 0.44, spine: 0.52, chest: 0.58,
      neck: 0.92 + br * 0.5, head: 0.85 + br
    });

    var feet = stance({
      hindL: { z: -3.0, a: 1.32 }, hindR: { z: -3.0, a: 1.32 },
      frontL: { z: 14.2 }, frontR: { z: 14.2 }
    });

    return {
      elev: elev,
      yaw: {},
      roll: {},
      rootY: -18.0,
      feet: feet,
      rot: {
        tail: [
          [0.10, 0, 0.30], [0.05, 0, 0.30], [0.02, 0, 0.34],
          [0.06, 0, 0.34], [0.12 + 0.05 * Math.sin(t * 1.7), 0, 0.30]
        ]
      }
    };
  }

  // ---- fight: up on the hind legs, alternating paw swipes
  function fight(t) {
    var ph = (t / 1.15) * TAU;
    var s1 = Math.sin(ph * 2), s2 = Math.sin(ph * 2 + Math.PI);
    var e1 = c01(s1), e2 = c01(s2);

    var elev = elevOf({
      hips: 0.50, spine: 0.58, chest: 0.62,
      neck: 0.78, head: 0.70
    });

    var feet = stance({ hindL: { z: -15.0 }, hindR: { z: -15.0 } });
    feet.frontL.x = 5.8; feet.frontR.x = -5.8;
    feet.frontL.z = 22.0 + 4.5 * s1; feet.frontL.y = -11.0 + 4.5 * e1;
    feet.frontR.z = 22.0 + 4.5 * s2; feet.frontR.y = -11.0 + 4.5 * e2;
    feet.frontL.a = 0.80 + 0.5 * e1; feet.frontR.a = 0.80 + 0.5 * e2;

    return {
      elev: elev,
      yaw: { chest: 0.06 * s1, neck: 0.10 * s1, head: 0.14 * s1, hips: 0.05 * Math.sin(ph) },
      roll: { hips: 0.05 * Math.sin(ph * 2), chest: -0.05 * s1 },
      rootY: 1.2 + 0.4 * Math.sin(ph * 2),
      feet: feet,
      rot: {
        earL: [0.28, 0, -0.18], earR: [0.28, 0, 0.18],
        tail: [
          [-0.06, 0.12 * Math.sin(ph * 2 + 0.4), 0],
          [-0.10, 0.18 * Math.sin(ph * 2 + 0.9), 0],
          [-0.12, 0.24 * Math.sin(ph * 2 + 1.4), 0],
          [-0.10, 0.28 * Math.sin(ph * 2 + 1.9), 0],
          [-0.06, 0.32 * Math.sin(ph * 2 + 2.4), 0]
        ]
      }
    };
  }

  // ---- standoff: crouched, arch up, ears flat, tail stiff
  function standoff(t) {
    var q = Math.sin(t * 19) * 0.005;
    var sway = Math.sin(t * 1.05);
    var elev = elevOf({
      hips: 0.06, spine: 0.16, chest: 0.18,
      neck: -0.20 + q, head: -0.16
    });

    var feet = stance({
      frontL: { x: 5.4, z: 15.0 }, frontR: { x: -5.4, z: 15.0 },
      hindL: { x: 5.2, z: -21.0 }, hindR: { x: -5.2, z: -21.0 }
    });

    return {
      elev: elev,
      yaw: { head: 0.05 * Math.sin(t * 0.8) },
      roll: { hips: 0.02 * sway, spine: 0.01 * sway },
      rootY: -3.4,
      feet: feet,
      rot: {
        earL: [0.55, 0, -0.42], earR: [0.55, 0, 0.42],
        tail: (function () {
          var out = [];
          for (var i = 1; i <= 5; i++) {
            // negative X drops the tail off the vertical until it trails level
            out.push([-0.44 + 0.02 * Math.sin(t * 9 - i * 0.6), 0.05 * Math.sin(t * 1.3 - i * 0.5), 0]);
          }
          return out;
        })()
      }
    };
  }

  // ---- curl: loaf on the floor, paws tucked, tail wrapped around the flank
  function curl(t) {
    var br = 0.015 * Math.sin(t * 1.6);
    var elev = elevOf({
      hips: 0.02, spine: 0.03, chest: 0.01,
      neck: -0.22, head: -0.30 + br
    });

    return {
      elev: elev,
      yaw: { hips: 0.10, spine: 0.10, chest: 0.06, head: 0.12 },
      roll: { hips: 0.03 },
      rootY: -19.5,
      feet: stance({
        frontL: { x: 3.9, z: 11.5, a: 0.95 },
        frontR: { x: -3.9, z: 11.5, a: 0.95 },
        hindL: { x: 4.5, z: -12.5, a: 1.12 },
        hindR: { x: -4.5, z: -12.5, a: 1.12 }
      }),
      rot: {
        earL: [-0.10, 0, 0], earR: [-0.10, 0, 0],
        // tail curls up beside the rump and round the near flank
        tail: [
          [-0.45, 0, -1.00], [-0.30, 0, -1.00], [0.00, 0, -0.95],
          [0.10, 0, -0.90], [0.15 + 0.03 * Math.sin(t * 1.4), 0, -0.85]
        ]
      }
    };
  }

  // ---- groom: sitting, one front paw up to the muzzle, licking, tail wrapped
  function groom(t) {
    var lk = Math.sin(t * 3.4);
    var elev = elevOf({
      hips: 0.44, spine: 0.52, chest: 0.58,
      neck: -0.26 + 0.03 * lk, head: -0.42 + 0.05 * lk
    });

    return {
      elev: elev,
      yaw: { head: 0.30, neck: 0.12 },
      roll: { head: 0.24 },
      rootY: -18.4,
      feet: stance({
        frontR: { z: 14.2 },
        frontL: { x: 5.2, y: -8.0, z: 23.5, a: 1.65 },
        hindL: { z: -4.0, a: 1.34 }, hindR: { z: -4.0, a: 1.34 }
      }),
      rot: {
        tail: [
          [-0.42, 0, 0.40], [-0.38, 0, 0.44], [-0.30, 0, 0.48],
          [-0.22, 0, 0.48], [-0.16 + 0.05 * Math.sin(t * 1.5), 0, 0.44]
        ]
      }
    };
  }

  function tailWave(ph, ampX, ampZ, speed) {
    var out = [];
    for (var i = 1; i <= 5; i++) {
      var k = i * 0.55;
      out.push([
        ampX * Math.sin(ph * TAU * speed - k),
        0,
        ampZ * Math.sin(ph * TAU * speed * 0.6 - k * 1.1)
      ]);
    }
    return out;
  }

  var ACTIONS = {
    idle: idle, walk: walk, run: run, sit: sit, fight: fight,
    standoff: standoff, curl: curl, groom: groom
  };
  var SPEED = { idle: 0, walk: 12.5 / (0.64 * 0.94) * UNIT, run: 20 / (0.32 * 0.44) * UNIT, sit: 0, fight: 0, standoff: 0, curl: 0, groom: 0 };

  /* --------------------------------------------------------- 7. pose engine */
  var state = { action: 'walk', t: 0, rate: 11 };
  var qTmp = new THREE.Quaternion();
  var eTmp = new THREE.Euler();
  var curRootY = 0;
  var curFeet = {};
  for (var id0 in STANCE) curFeet[id0] = { x: STANCE[id0].x, y: STANCE[id0].y, z: STANCE[id0].z, a: STANCE[id0].a };

  function setAction(name) {
    if (!ACTIONS[name] || name === state.action) return;
    state.action = name;
    state.t = 0;
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    state.t += dt;

    var act = ACTIONS[state.action](state.t);
    var k = 1 - Math.exp(-dt * state.rate);

    // spine: smooth the world elevations, then aim each segment
    for (var i = 0; i < BODY_AIM.length; i++) {
      var n = BODY_AIM[i].bone;
      curElev[n] = mix(curElev[n], act.elev[n], k);
      curYaw[n] = mix(curYaw[n], (act.yaw && act.yaw[n]) || 0, k);
      curRoll[n] = mix(curRoll[n], (act.roll && act.roll[n]) || 0, k);
    }
    aimBody(curElev, curYaw, curRoll);

    // tail + ears (independent chains)
    var rot = act.rot || {};
    var tail = rot.tail || [];
    for (var j = 0; j < 5; j++) {
      var e = tail[j] || [0, 0, 0];
      eTmp.set(e[0], e[1], e[2], 'XYZ');
      qTmp.setFromEuler(eTmp);
      boneByName['tail' + (j + 1)].quaternion.slerp(qTmp, k);
    }
    for (var ei = 0; ei < 2; ei++) {
      var en = ei === 0 ? 'earL' : 'earR';
      var ee = rot[en] || [0, 0, 0];
      eTmp.set(ee[0], ee[1], ee[2], 'XYZ');
      qTmp.setFromEuler(eTmp);
      boneByName[en].quaternion.slerp(qTmp, k);
    }

    curRootY = mix(curRootY, act.rootY || 0, k);
    rootBone.position.y = curRootY;

    rootBone.updateMatrixWorld(true);

    // legs: smooth the targets, then pin
    var kf = 1 - Math.exp(-dt * 14);
    for (var l = 0; l < LEGS.length; l++) {
      var leg = LEGS[l];
      var tgt = act.feet[leg.id];
      var cur = curFeet[leg.id];
      cur.x = mix(cur.x, tgt.x, kf);
      cur.y = mix(cur.y, tgt.y, kf);
      cur.z = mix(cur.z, tgt.z, kf);
      cur.a = mix(cur.a, tgt.a, kf);
      solveLeg(leg, cur);
    }
  }

  // Jump straight to the pose the current action wants.  The near-field LOD
  // rebinds a rig from one cat to another; without this the new cat would
  // morph out of the previous cat's pose for the first ~0.2 s.
  function snap() {
    var act = ACTIONS[state.action](state.t);
    for (var i = 0; i < BODY_AIM.length; i++) {
      var n = BODY_AIM[i].bone;
      curElev[n] = act.elev[n];
      curYaw[n] = (act.yaw && act.yaw[n]) || 0;
      curRoll[n] = (act.roll && act.roll[n]) || 0;
    }
    var rot = act.rot || {};
    var tail = rot.tail || [];
    for (var j = 0; j < 5; j++) {
      var e = tail[j] || [0, 0, 0];
      eTmp.set(e[0], e[1], e[2], 'XYZ');
      boneByName['tail' + (j + 1)].quaternion.setFromEuler(eTmp);
    }
    for (var ei = 0; ei < 2; ei++) {
      var en = ei === 0 ? 'earL' : 'earR';
      var ee = rot[en] || [0, 0, 0];
      eTmp.set(ee[0], ee[1], ee[2], 'XYZ');
      boneByName[en].quaternion.setFromEuler(eTmp);
    }
    curRootY = act.rootY || 0;
    rootBone.position.y = curRootY;
    for (var l = 0; l < LEGS.length; l++) {
      var tgt = act.feet[LEGS[l].id], cur = curFeet[LEGS[l].id];
      cur.x = tgt.x; cur.y = tgt.y; cur.z = tgt.z; cur.a = tgt.a;
    }
    update(0);
  }

  function setBonesVisible(on) {
    if (!bonesHelper) {
      bonesHelper = new THREE.SkeletonHelper(group);
      bonesHelper.material.linewidth = 2;
      bonesHelper.material.depthTest = false;
    }
    if (on) group.add(bonesHelper);
    else if (bonesHelper.parent) bonesHelper.parent.remove(bonesHelper);
  }

  return {
    group: group,
    mesh: mesh,
    skeleton: skeleton,
    update: update,
    setAction: setAction,
    action: function () { return state.action; },
    speed: function () { return SPEED[state.action] || 0; },
    setBonesVisible: setBonesVisible,
    snap: snap,
    joints: SEG,
    unit: UNIT
  };
};
