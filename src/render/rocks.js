// Photo-scanned rocks, cliffs, stumps and dead trunks (Poly Haven, CC0) as instanced meshes.
import * as THREE from 'three';

// glTF meshes come quantized (meshopt): convert to plain floats before baking node transforms
function floatAttr(a) {
  const n = a.count;
  const k = a.itemSize;
  const out = new Float32Array(n * k);
  const get = [a.getX, a.getY, a.getZ, a.getW];
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = get[c].call(a, i);
  return new THREE.BufferAttribute(out, k);
}

// every mesh of a glTF scene → {geo, mat, size}, sitting on y = 0 and centred on its footprint
export function rockParts(gltf, tint, maps = null) {
  const parts = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) if (src.attributes[name]) g.setAttribute(name, floatAttr(src.attributes[name]));
    if (src.index) g.setIndex(Array.from(src.index.array));
    g.applyMatrix4(o.matrixWorld);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const c = bb.getCenter(new THREE.Vector3());
    g.translate(-c.x, -bb.min.y, -c.z);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mat = o.material.clone();
    mat.side = THREE.FrontSide;
    mat.vertexColors = false; // some scans carry a COLOR_0 mask we don't copy: the textures hold the look
    if (maps) {
      if (maps.d) mat.map = maps.d;
      if (maps.n) mat.normalMap = maps.n;
      if (maps.mr) mat.roughnessMap = mat.metalnessMap = maps.mr;
      mat.roughness = 1;
      mat.metalness = 0;
      mat.needsUpdate = true;
    }
    if (tint) mat.color.multiply(tint);
    parts.push({ name: o.name, geo: g, mat, size: g.boundingBox.getSize(new THREE.Vector3()) });
  });
  return parts;
}

// items: [{part, x, y, z, yaw, s, tiltX, tiltZ}]
export function rockMeshes(items) {
  const byPart = new Map();
  for (const it of items) {
    if (!byPart.has(it.part)) byPart.set(it.part, []);
    byPart.get(it.part).push(it);
  }
  const group = new THREE.Group();
  group.name = 'rocks';
  const dummy = new THREE.Object3D();
  for (const [part, list] of byPart) {
    const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
    list.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(it.tiltX || 0, it.yaw, it.tiltZ || 0, 'YXZ');
      dummy.scale.setScalar(it.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.name = 'rock-' + part.name;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}
