import { colliders } from '../shared/mapData.js';
import { DUMMY_COUNT, DUMMY_HEALTH } from '../shared/constants.js';

const ARENA_HALF = 39; // stay inside the outer walls (shared/mapData.js HALF=40) with a small margin
const COLLIDER_MARGIN = 0.6; // keep dummies from spawning embedded in a crate

function overlapsAnyCollider(x, z) {
  for (const c of colliders) {
    if (c.type === 'floor') continue;
    if (
      x > c.pos.x - c.halfExtents.x - COLLIDER_MARGIN && x < c.pos.x + c.halfExtents.x + COLLIDER_MARGIN &&
      z > c.pos.z - c.halfExtents.z - COLLIDER_MARGIN && z < c.pos.z + c.halfExtents.z + COLLIDER_MARGIN
    ) {
      return true;
    }
  }
  return false;
}

// Exported for reuse as the AI's wander-waypoint picker (server/dummyAI.js).
export function randomPosition() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = (Math.random() * 2 - 1) * ARENA_HALF;
    const z = (Math.random() * 2 - 1) * ARENA_HALF;
    if (!overlapsAnyCollider(x, z)) return { x, y: 0, z };
  }
  return { x: 0, y: 0, z: 0 }; // fallback if 20 random tries all failed (shouldn't happen)
}

// Same shape as a player's movement state — dummies are driven through the
// exact same shared/movement.js step() function (see dummyAI.js), so they
// collide with walls/crates and jump identically to a real player.
function freshMovementState(pos) {
  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: Math.random() * Math.PI * 2,
    pitch: 0,
    onGround: false,
    lean: 0,
    airJumpsUsed: 0,
    airFloatTimeLeft: 0,
    wallRun: { active: false, timeLeft: 0, normal: { x: 0, z: 0 }, tangentSign: 1 },
  };
}

export function createDummies() {
  const dummies = [];
  for (let i = 0; i < DUMMY_COUNT; i++) {
    const pos = randomPosition();
    dummies.push({
      id: i + 1,
      health: DUMMY_HEALTH,
      state: freshMovementState(pos),
      // AI wander state (see dummyAI.js) — initialized lazily on first tick.
      aiTarget: null,
      currentYaw: 0,
      nextJumpAt: 0,
    });
  }
  return dummies;
}

// Called once a dummy's health has been depleted — moves it to a fresh spot
// (full physics state reset, not just position) and restores full health,
// ready to be "killed" again.
export function relocateDummy(dummy) {
  dummy.state = freshMovementState(randomPosition());
  dummy.health = DUMMY_HEALTH;
  dummy.aiTarget = null; // pick a brand new wander target next AI tick
}
