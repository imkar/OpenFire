import { createPlayerMesh } from '../render/player.js';
import { pushSnapshot, getInterpolated, removePlayerBuffer } from '../net/interpolation.js';
import { INTERP_DELAY_MS } from '../../shared/constants.js';

export function createRemotePlayers(scene) {
  const meshes = new Map(); // id -> Group
  const teams = new Map(); // id -> 'A' | 'B'

  function ingestSnapshot(snapshot, localPlayerId) {
    const seenIds = new Set();

    for (const p of snapshot.players) {
      teams.set(p.id, p.team);
      if (p.id === localPlayerId) continue;

      seenIds.add(p.id);
      pushSnapshot(p.id, snapshot.t, p.position, p.yaw);

      if (!meshes.has(p.id)) {
        const mesh = createPlayerMesh(p.team, p.nickname);
        scene.add(mesh);
        meshes.set(p.id, mesh);
      }
      meshes.get(p.id).visible = p.alive;
    }

    for (const [id, mesh] of meshes) {
      if (!seenIds.has(id)) {
        scene.remove(mesh);
        meshes.delete(id);
        removePlayerBuffer(id);
      }
    }
  }

  function render() {
    const renderTime = Date.now() - INTERP_DELAY_MS;
    for (const [id, mesh] of meshes) {
      const t = getInterpolated(id, renderTime);
      if (!t) continue;
      mesh.position.set(t.position.x, t.position.y, t.position.z);
      mesh.rotation.y = t.yaw;
    }
  }

  return {
    ingestSnapshot,
    render,
    getTeam: (id) => teams.get(id),
  };
}
