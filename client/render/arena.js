import * as THREE from 'three';
import { colliders } from '../../shared/mapData.js';

// Distinct color per cover type — the only "art" budget this project spends
// (no textures/models), but it's enough to tell crates/barriers/pillars/
// containers apart at a glance instead of everything being one brown box.
const TYPE_COLORS = {
  crate: 0xa0672c, // brown
  barrier: 0x8a7f6b, // sandbag tan
  pillar: 0x54595d, // concrete grey
  container: 0xa0522d, // rusty sienna
};

// Builds the arena meshes from the single source-of-truth collider list.
// Static floor/walls get one mesh each (cheap, only 5 of them). Every other
// collider type shares geometry via its own InstancedMesh (one draw call
// per type, regardless of how many instances) to keep draw calls low even
// as more variety gets added.
export function buildArena(scene) {
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x707070 });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x999999 });

  const staticColliders = colliders.filter((c) => c.type === 'floor' || c.type === 'wall');
  for (const c of staticColliders) {
    const geo = new THREE.BoxGeometry(c.halfExtents.x * 2, c.halfExtents.y * 2, c.halfExtents.z * 2);
    const mesh = new THREE.Mesh(geo, c.type === 'floor' ? floorMat : wallMat);
    mesh.position.set(c.pos.x, c.pos.y, c.pos.z);
    scene.add(mesh);
  }

  const instancedTypes = Object.keys(TYPE_COLORS);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (const type of instancedTypes) {
    const items = colliders.filter((c) => c.type === type);
    if (items.length === 0) continue;

    const unitGeo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: TYPE_COLORS[type] });
    const instanced = new THREE.InstancedMesh(unitGeo, mat, items.length);

    items.forEach((c, i) => {
      position.set(c.pos.x, c.pos.y, c.pos.z);
      scale.set(c.halfExtents.x * 2, c.halfExtents.y * 2, c.halfExtents.z * 2);
      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(i, matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    scene.add(instanced);
  }
}
