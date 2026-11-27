/* ============================================================================
 * CatNear — near-field skinned cats for Steam Walker.
 *
 * The corridor keeps drawing every cat with the existing InstancedMesh
 * (static pose + breathing bob).  The cats closest to the camera are swapped
 * for a real rigged cat: CatRig's 594-triangle / 25-bone skeleton driven by
 * the procedural actions.  Skinning is done by hand in the material with
 * `mat4 uBones[25]`, so nothing depends on three's skinning internals.
 *
 * The swap is seamless: the skinned cat's outer matrix is built from exactly
 * the same numbers as the instanced matrix (position, heading, scale, and the
 * 0.8 % breathing scale on Y), so there is no jump on the frame it appears.
 *
 *   var near = CatNear(THREE, window.CAT_MESH, {
 *     scene: scene,
 *     max: 8, enter: 7.0, exit: 9.0,
 *     onAttach: function (f) { ... },   // hide per-cat extras (eye spheres)
 *     onDetach: function (f) { ... },   // put them back
 *     onCat:    function (f, t) {}      // per-frame hook (groom chance)
 *   });
 *   near.update(dt, t, camera, figures, actionOf, poseOf);
 * ==========================================================================*/
window.CatNear = function (THREE, M, opts) {
  'use strict';

  opts = opts || {};
  var MAX = opts.max || 8;
  var ENTER = opts.enter || 7.0, EXIT = opts.exit || 9.0;
  var ENTER2 = ENTER * ENTER, EXIT2 = EXIT * EXIT;
  var scene = opts.scene;
  if (!scene || !window.CatRig || !window.CAT_MESH || !M) return null;

  var BB = M.bbox, H = BB[4] - BB[1];
  var UNIT = 1.46 / H;
  var CX = (BB[0] + BB[3]) / 2, CZ = (BB[2] + BB[5]) / 2, Y0 = BB[1];

  /* ----------------------------------------------------------- shaders ---- */
  var NOISE = [
    'float h3(vec3 p) {',
    '  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));',
    '  p *= 17.0;',
    '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    'float vn(vec3 x) {',
    '  vec3 i = floor(x); vec3 f = fract(x);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x),',
    '                 mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),',
    '             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x),',
    '                 mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);',
    '}'
  ].join('\n');

  var FUR_FS = [
    '#include <common>',
    '#include <fog_pars_fragment>',
    'varying float vFur;',
    'varying float vAge;',
    'varying float vCoat;',
    'varying vec3 vLoc;',
    'varying vec3 vWPos;',
    'varying vec3 vNrm;',
    'varying vec3 vViewDir;',
    'varying vec3 vCol;',
    NOISE,
    'void main() {',
    '  float fres = pow(1.0 - max(dot(normalize(vNrm), normalize(vViewDir)), 0.0), 2.2);',
    '  // strands are sampled in rest space (vLoc = pre-skin position), so they',
    '  // stay glued to the skin instead of swimming over the moving mesh',
    '  float s1 = vn(vec3(vLoc.x * 72.0, vLoc.y * 2.6, vLoc.z * 72.0));',
    '  float s2 = vn(vec3(vLoc.x * 155.0, vLoc.y * 6.5, vLoc.z * 155.0));',
    '  float strand = s1 * 0.68 + s2 * 0.32;',
    '  float edge = 1.0 - vFur * 0.92;',
    '  float cover = smoothstep(edge, edge + 0.05, strand);',
    '  float detail = smoothstep(34.0, 5.0, length(vViewDir));',
    '  cover = mix(mix(0.40, 1.0, vFur), cover, detail);',
    '  vec3 fur = vCol * (0.78 + 0.42 * vFur) * (0.90 + 0.20 * strand);',
    '  if (vCoat > 1.5 && vCoat < 2.5) fur = mix(fur, vec3(0.26, 0.22, 0.21), 0.50);',
    '  else if (vCoat > 2.5 && vCoat < 3.5) fur = mix(fur, vec3(0.66, 0.55, 0.48), 0.50);',
    '  else if (vCoat > 3.5) fur = mix(fur, vec3(0.88, 0.82, 0.72), 0.60);',
    '  vec3 coat = fur;',
    '  if (vCoat > 0.5 && vCoat < 1.5) {',
    '    float t = abs(fract(vLoc.z * 7.0) - 0.5) * 2.0;',
    '    coat = mix(fur, fur * 0.45, smoothstep(0.30, 0.72, t) * 0.85);',
    '  } else if (vCoat > 1.5 && vCoat < 2.5) {',
    '    float belly = smoothstep(0.62, 0.34, vLoc.y);',
    '    float chest = smoothstep(0.62, 0.40, vLoc.y) * smoothstep(0.10, 0.45, vLoc.z);',
    '    coat = mix(vec3(0.22, 0.20, 0.19), vec3(0.93, 0.91, 0.87), clamp(max(belly * 0.9, chest), 0.0, 1.0));',
    '  } else if (vCoat > 2.5 && vCoat < 3.5) {',
    '    float p = vn(vLoc * 3.0 + 5.0);',
    '    coat = vec3(0.93, 0.90, 0.86);',
    '    coat = mix(coat, vec3(0.85, 0.47, 0.18), smoothstep(0.52, 0.62, p));',
    '    coat = mix(coat, vec3(0.22, 0.19, 0.18), smoothstep(0.40, 0.32, p));',
    '  } else if (vCoat > 3.5) {',
    '    float legs = smoothstep(0.52, 0.33, vLoc.y);',
    '    float ends = smoothstep(0.55, 0.72, abs(vLoc.z));',
    '    float ears = smoothstep(0.92, 1.05, vLoc.y);',
    '    float m = clamp(max(max(legs, ends), ears), 0.0, 1.0);',
    '    coat = mix(fur, vec3(0.18, 0.15, 0.14), m * 0.92);',
    '  }',
    '  vec3 skin = coat * (0.42 + 0.32 * vFur) * (0.88 + 0.24 * vn(vLoc * 9.0));',
    '  vec3 base = mix(skin, coat, cover);',
    '  base *= 0.90 + 0.18 * clamp(vNrm.y, 0.0, 1.0);',
    '  base += coat * fres * (0.12 + 0.55 * vFur);',
    '  base *= (0.55 + 0.45 * vAge);',
    '  gl_FragColor = vec4(base, 1.0);',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  // The model ships its own eye islands (material group 1).  Near cats use
  // those instead of the game's separate eye spheres, so the eyes follow the
  // skinned head through fight / curl / groom.
  var EYE_FS = [
    '#include <common>',
    '#include <fog_pars_fragment>',
    'varying vec3 vNrm;',
    'varying vec3 vViewDir;',
    'void main() {',
    '  float f = pow(1.0 - max(dot(normalize(vNrm), normalize(vViewDir)), 0.0), 1.7);',
    '  vec3 col = vec3(0.030, 0.027, 0.038) + vec3(0.95, 0.80, 0.42) * f * 0.16;',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------ helpers ---- */
  function makeVertexShader(nbones, fur) {
    var decl = [
      '#include <common>',
      '#include <fog_pars_vertex>',
      'attribute vec4 skinIndex;',
      'attribute vec4 skinWeight;',
      'attribute vec3 aLoc;',
      'attribute vec3 aCol;',
      'uniform mat4 uBones[' + nbones + '];',
      'uniform vec3 uSeed;',
      'varying vec3 vLoc;',
      'varying vec3 vCol;',
      'varying vec3 vWPos;',
      'varying vec3 vNrm;',
      'varying vec3 vViewDir;'
    ];
    if (fur) {
      decl.push('uniform float uFur;', 'uniform float uAge;', 'uniform float uCoat;', 'uniform vec3 uColor;');
      decl.push('varying float vFur;', 'varying float vAge;', 'varying float vCoat;');
    }
    decl.push(NOISE);
    decl.push('void main() {');
    if (fur) decl.push('  vFur = uFur; vAge = uAge; vCoat = uCoat;');
    decl.push(
      '  mat4 sm = uBones[int(skinIndex.x)] * skinWeight.x;',
      '  sm += uBones[int(skinIndex.y)] * skinWeight.y;',
      '  sm += uBones[int(skinIndex.z)] * skinWeight.z;',
      '  sm += uBones[int(skinIndex.w)] * skinWeight.w;',
      '  vec3 p = (sm * vec4(position, 1.0)).xyz;',
      '  vec3 nrm = mat3(sm) * normal;',
      fur ? '  vLoc = aLoc; vCol = aCol * uColor;' : '  vLoc = aLoc; vCol = aCol;'
    );
    if (fur) {
      // same fuzz displacement as the instanced material, sampled in rest space
      decl.push('  float fuzz = vn(aLoc * 11.0 + uSeed * 3.0) - 0.5;');
      decl.push('  p += normalize(nrm) * fuzz * 0.05 * uFur;');
    }
    decl.push(
      '  vWPos = p;',
      '  vNrm = normalize(normalMatrix * nrm);',
      '  vec3 transformed = p;',
      '  #include <project_vertex>',
      '  vViewDir = normalize(-mvPosition.xyz);',
      '  #include <fog_vertex>',
      '}'
    );
    return decl.join('\n');
  }

  function furMaterial(nbones) {
    var u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uBones: { value: [] },
      uSeed: { value: new THREE.Vector3() },
      uFur: { value: 0.8 },
      uAge: { value: 1 },
      uCoat: { value: 0 },
      uColor: { value: new THREE.Color(0xffffff) }
    }]);
    return new THREE.ShaderMaterial({
      uniforms: u, vertexShader: makeVertexShader(nbones, true),
      fragmentShader: FUR_FS, fog: true
    });
  }

  function eyeMaterial(nbones) {
    var u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uBones: { value: [] }
    }]);
    return new THREE.ShaderMaterial({
      uniforms: u, vertexShader: makeVertexShader(nbones, false),
      fragmentShader: EYE_FS, fog: true
    });
  }

  // Both extra attributes are built in the same normalised space as the
  // instanced geometry, so the fur gradient and coat markings line up.
  function decorate(geo) {
    var pos = geo.attributes.position, n = pos.count;
    var aLoc = new Float32Array(n * 3), aCol = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var x = (pos.getX(i) - CX) * UNIT;
      var y = (pos.getY(i) - Y0) * UNIT;
      var z = (pos.getZ(i) - CZ) * UNIT;
      aLoc[i * 3] = x; aLoc[i * 3 + 1] = y; aLoc[i * 3 + 2] = z;
      var t = y / 1.46; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var v = 0.66 + 0.34 * Math.pow(t, 0.75);
      aCol[i * 3] = v; aCol[i * 3 + 1] = v; aCol[i * 3 + 2] = v;
    }
    geo.setAttribute('aLoc', new THREE.BufferAttribute(aLoc, 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3));
  }

  /* -------------------------------------------------------------- slots ---- */
  var slots = [];
  var tmpPose = { x: 0, y: 0, z: 0, ang: 0, sx: 1, sy: 1, sz: 1 };
  var NBONES = 0;

  function buildSlot() {
    var rig = window.CatRig(THREE, M);
    if (!NBONES) NBONES = rig.skeleton.bones.length;
    rig.group.remove(rig.mesh);            // it renders at identity, outside the bone group

    var geo = rig.mesh.geometry;
    decorate(geo);

    var fur = furMaterial(NBONES), eye = eyeMaterial(NBONES);
    var mats = [];
    for (var i = 0; i < NBONES; i++) mats.push(new THREE.Matrix4());
    fur.uniforms.uBones.value = mats;
    eye.uniforms.uBones.value = mats;

    // A real SkinnedMesh (skeleton bound, 594 tris) whose material does the
    // skinning by hand: no three version can change how the bones are read.
    var mesh = rig.mesh;
    mesh.material = [fur, eye];
    mesh.matrixAutoUpdate = false;         // skinned vertices are already world-space
    mesh.matrix.identity();
    mesh.visible = false;
    scene.add(mesh);

    var wrap = new THREE.Group();
    wrap.visible = false;
    wrap.add(rig.group);
    scene.add(wrap);

    return {
      rig: rig, wrap: wrap, mesh: mesh, fur: fur, eye: eye,
      bones: rig.skeleton.bones, inv: rig.skeleton.boneInverses, mats: mats,
      f: null, needsSnap: false
    };
  }

  function bind(slot, f) {
    slot.f = f;
    f._nearSlot = slot;
    slot.needsSnap = true;
    var u = slot.fur.uniforms;
    if (f._color) u.uColor.value.copy(f._color);
    u.uFur.value = f._fur != null ? f._fur : 0.8;
    u.uAge.value = f._age != null ? f._age : 1;
    u.uCoat.value = f._coat != null ? f._coat : 0;
    u.uSeed.value.set(f.homeX != null ? f.homeX : f.x, 0, f.homeZ != null ? f.homeZ : f.z);
    slot.mesh.visible = true;
    slot.wrap.visible = true;
    if (opts.onAttach) opts.onAttach(f);
  }

  function unbind(slot) {
    var f = slot.f;
    if (!f) return;
    f._nearSlot = null;
    slot.f = null;
    slot.mesh.visible = false;
    slot.wrap.visible = false;
    if (opts.onDetach) opts.onDetach(f);
  }

  var cand = [];

  for (var si = 0; si < MAX; si++) slots.push(buildSlot());

  function update(dt, t, camera, figures, actionOf, poseOf) {
    var cx = camera.position.x, cz = camera.position.z;
    var i, s, f, dx, dz, d2;

    // --- pick the closest cats (hysteresis: stay until `exit`) -----------
    cand.length = 0;
    for (i = 0; i < figures.length; i++) {
      f = figures[i];
      dx = f.x - cx; dz = f.z - cz;
      d2 = dx * dx + dz * dz;
      f._lodD2 = d2;
      if (d2 < (f._nearSlot ? EXIT2 : ENTER2)) cand.push(f);
    }
    cand.sort(function (a, b) { return a._lodD2 - b._lodD2; });
    if (cand.length > MAX) cand.length = MAX;

    for (s = 0; s < slots.length; s++) {
      if (slots[s].f && cand.indexOf(slots[s].f) < 0) unbind(slots[s]);
    }
    for (i = 0; i < cand.length; i++) {
      f = cand[i];
      if (f._nearSlot) continue;
      var free = null;
      for (s = 0; s < slots.length; s++) if (!slots[s].f) { free = slots[s]; break; }
      if (!free) break;
      bind(free, f);
    }

    // --- drive the active rigs -------------------------------------------
    for (s = 0; s < slots.length; s++) {
      var slot = slots[s];
      f = slot.f;
      if (!f) continue;

      if (opts.onCat) opts.onCat(f, t);

      var act = actionOf(f, t);

      poseOf(f, t, tmpPose);                 // same numbers as the instance matrix
      slot.wrap.position.set(tmpPose.x, tmpPose.y, tmpPose.z);
      slot.wrap.rotation.set(0, tmpPose.ang, 0);
      slot.wrap.scale.set(tmpPose.sx, tmpPose.sy, tmpPose.sz);
      slot.wrap.updateMatrixWorld(true);

      if (slot.needsSnap) {
        // freshly bound cat: start on its own pose, not the previous cat's.
        // The transform is already in place, so the IK solves at the right size.
        slot.rig.setAction(act);
        slot.rig.snap();
        slot.needsSnap = false;
      } else if (slot.rig.action() !== act) {
        slot.rig.setAction(act);            // CatRig eases between actions
      }

      slot.rig.update(dt);
      slot.rig.group.updateMatrixWorld(true); // legs are posed after the root update

      var bones = slot.bones, inv = slot.inv, mats = slot.mats;
      for (i = 0; i < bones.length; i++) {
        mats[i].multiplyMatrices(bones[i].matrixWorld, inv[i]);
      }
    }
  }

  return {
    max: MAX,
    update: update,
    boneCount: function () { return NBONES; },
    // Debug: skinned world AABB of every active rig, computed on the CPU with
    // the same bone matrices the shader gets.  Used to prove the near cat sits
    // exactly where the instanced cat would (position, scale, floor contact).
    bounds: function () {
      var out = [];
      var v = new THREE.Vector3(), acc = new THREE.Vector3();
      for (var k = 0; k < slots.length; k++) {
        var sl = slots[k];
        if (!sl.f) continue;
        var geo = sl.mesh.geometry;
        var pos = geo.attributes.position;
        var si = geo.attributes.skinIndex.array, sw = geo.attributes.skinWeight.array;
        var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (var i = 0; i < pos.count; i++) {
          acc.set(0, 0, 0);
          for (var q = 0; q < 4; q++) {
            var w = sw[i * 4 + q];
            if (!w) continue;
            v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
              .applyMatrix4(sl.mats[si[i * 4 + q]])
              .multiplyScalar(w);
            acc.add(v);
          }
          if (acc.x < mn[0]) mn[0] = acc.x;
          if (acc.y < mn[1]) mn[1] = acc.y;
          if (acc.z < mn[2]) mn[2] = acc.z;
          if (acc.x > mx[0]) mx[0] = acc.x;
          if (acc.y > mx[1]) mx[1] = acc.y;
          if (acc.z > mx[2]) mx[2] = acc.z;
        }
        out.push({
          index: sl.f._i, action: sl.rig.action(),
          f: { x: sl.f.x, z: sl.f.z, s: sl.f.s, ang: sl.f.ang },
          min: mn, max: mx,
          mat: sl.wrap.matrixWorld.elements.slice(0)
        });
      }
      return out;
    },
    active: function () {
      var out = [];
      for (var k = 0; k < slots.length; k++) {
        var sl = slots[k];
        if (!sl.f) continue;
        out.push({
          index: sl.f._i,
          name: sl.f.g && sl.f.g.n,
          action: sl.rig.action(),
          d: Math.sqrt(sl.f._lodD2 || 0)
        });
      }
      return out;
    }
  };
};
