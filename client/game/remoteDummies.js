import { createPlayerMesh } from '../render/player.js';
import { pushSnapshot, getInterpolated, removePlayerBuffer } from '../net/interpolation.js';
import { INTERP_DELAY_MS } from '../../shared/constants.js';

// Dummies now wander/jump around the arena via server-side AI (same physics
// as players), so they need the same smoothing treatment as remote players:
// buffered interpolation instead of a hard per-snapshot snap. They share the
// interpolation module's buffer map with real players, so dummy ids are
// namespaced (`dummy-<id>`) to avoid colliding with real player ids (both
// start counting from 1).
function bufferKey(id) {
  return `dummy-${id}`;
}

export function createRemoteDummies(scene) {
  const meshes = new Map(); // id -> Group

  function ingestSnapshot(dummies, snapshotTime) {
    const seenIds = new Set();

    for (const d of dummies) {
      seenIds.add(d.id);
      pushSnapshot(bufferKey(d.id), snapshotTime, d.position, d.yaw ?? 0);

      if (!meshes.has(d.id)) {
        const mesh = createPlayerMesh('dummy'); // unrecognized team -> neutral white
        scene.add(mesh);
        meshes.set(d.id, mesh);
      }
    }

    for (const [id, mesh] of meshes) {
      if (!seenIds.has(id)) {
        scene.remove(mesh);
        meshes.delete(id);
        removePlayerBuffer(bufferKey(id));
      }
    }
  }

  function render() {
    const renderTime = Date.now() - INTERP_DELAY_MS;
    for (const [id, mesh] of meshes) {
      const t = getInterpolated(bufferKey(id), renderTime);
      if (!t) continue;
      mesh.position.set(t.position.x, t.position.y, t.position.z);
      mesh.rotation.y = t.yaw;
    }
  }

  // Brief red tint on a damaging (but not yet killing) hit — the dummy only
  // relocates once its health is fully depleted, so this is the feedback
  // that a shot actually landed in between.
  function flashHit(id) {
    const group = meshes.get(id);
    const mesh = group?.children[0];
    if (!mesh) return;
    mesh.material.color.setHex(0xff3b3b);
    setTimeout(() => {
      mesh.material.color.setHex(0xffffff);
    }, 100);
  }

  return { ingestSnapshot, render, flashHit };
}
