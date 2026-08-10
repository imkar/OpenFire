import { colliders as mapColliders } from '../shared/mapData.js';
import { resolveLeanOffset } from '../shared/collision.js';
import {
  WEAPON_RANGE,
  LAG_COMPENSATION_WINDOW_MS,
  PLAYER_HALF_EXTENTS,
  PLAYER_HEIGHT,
  EYE_HEIGHT,
  LEAN_DISTANCE,
} from '../shared/constants.js';

// Shots must originate from where the shooter visually appears, including
// any lean/peek offset — otherwise a player leaning around a corner would
// have their shots blocked by the wall they just peeked past.
export function getShotOrigin(player) {
  const baseEye = { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z };
  const leanOffset = resolveLeanOffset(baseEye, player.yaw, player.lean ?? 0, LEAN_DISTANCE, mapColliders);
  return { x: baseEye.x + leanOffset.x, y: baseEye.y, z: baseEye.z + leanOffset.z };
}

// Hand-rolled ray-vs-AABB (slab method) — avoids pulling in three.js on the
// server just for raycasting against a handful of boxes.
function rayAabbIntersect(origin, dir, min, max) {
  let tmin = 0;
  let tmax = Infinity;

  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    const mn = min[axis];
    const mx = max[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
      continue;
    }
    let t1 = (mn - o) / d;
    let t2 = (mx - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

function playerAabbAt(pos) {
  return {
    min: { x: pos.x - PLAYER_HALF_EXTENTS.x, y: pos.y, z: pos.z - PLAYER_HALF_EXTENTS.z },
    max: { x: pos.x + PLAYER_HALF_EXTENTS.x, y: pos.y + PLAYER_HEIGHT, z: pos.z + PLAYER_HALF_EXTENTS.z },
  };
}

function colliderAabb(c) {
  return {
    min: { x: c.pos.x - c.halfExtents.x, y: c.pos.y - c.halfExtents.y, z: c.pos.z - c.halfExtents.z },
    max: { x: c.pos.x + c.halfExtents.x, y: c.pos.y + c.halfExtents.y, z: c.pos.z + c.halfExtents.z },
  };
}

function getHistoricalPosition(player, timestamp) {
  const history = player.history;
  if (history.length === 0) return player.position;
  if (timestamp >= history[history.length - 1].t) return history[history.length - 1].position;
  if (timestamp <= history[0].t) return history[0].position;

  for (let i = history.length - 1; i > 0; i--) {
    const a = history[i - 1];
    const b = history[i];
    if (timestamp >= a.t && timestamp <= b.t) {
      const alpha = (timestamp - a.t) / (b.t - a.t || 1);
      return {
        x: a.position.x + (b.position.x - a.position.x) * alpha,
        y: a.position.y + (b.position.y - a.position.y) * alpha,
        z: a.position.z + (b.position.z - a.position.z) * alpha,
      };
    }
  }
  return player.position;
}

// Server-authoritative hitscan: rewinds every other player to where they were
// at the shooter's claimed timestamp (clamped to LAG_COMPENSATION_WINDOW_MS)
// and raycasts against that historical state, plus static world geometry.
// Practice-target dummies are checked at their current position (no lag
// compensation) — they wander slowly and this is casual target practice,
// not competitive hit-reg, so the small discrepancy doesn't matter.
// Whichever of world/player/dummy is genuinely closest along the ray wins.
export function performHitscan({ shooter, origin, direction, timestamp, players, dummies = [] }) {
  const now = Date.now();
  const clampedTimestamp = Math.max(timestamp, now - LAG_COMPENSATION_WINDOW_MS);

  let closestT = WEAPON_RANGE;
  let hitPlayerId = null;
  let hitDummyId = null;

  for (const c of mapColliders) {
    const aabb = colliderAabb(c);
    const t = rayAabbIntersect(origin, direction, aabb.min, aabb.max);
    if (t !== null && t < closestT) {
      closestT = t;
      hitPlayerId = null; // world geometry blocks the shot
      hitDummyId = null;
    }
  }

  for (const [id, player] of players) {
    if (id === shooter.id || !player.alive) continue;
    const historicalPos = getHistoricalPosition(player, clampedTimestamp);
    const aabb = playerAabbAt(historicalPos);
    const t = rayAabbIntersect(origin, direction, aabb.min, aabb.max);
    if (t !== null && t < closestT) {
      closestT = t;
      hitPlayerId = id;
      hitDummyId = null;
    }
  }

  for (const dummy of dummies) {
    const aabb = playerAabbAt(dummy.state.position);
    const t = rayAabbIntersect(origin, direction, aabb.min, aabb.max);
    if (t !== null && t < closestT) {
      closestT = t;
      hitPlayerId = null;
      hitDummyId = dummy.id;
    }
  }

  if (hitPlayerId !== null) return { hitPlayerId, hitDummyId: null, distance: closestT };
  if (hitDummyId !== null) return { hitPlayerId: null, hitDummyId, distance: closestT };
  return null;
}
