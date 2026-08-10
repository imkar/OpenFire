import { step } from '../shared/movement.js';
import { colliders } from '../shared/mapData.js';
import { randomPosition } from './dummies.js';

const WAYPOINT_REACHED_DIST = 1.2; // meters
const TURN_RATE = 4; // radians/sec — how fast a dummy turns to face its movement direction
const JUMP_MIN_INTERVAL_MS = 2500;
const JUMP_MAX_INTERVAL_MS = 6000;

function scheduleNextJump(dummy) {
  dummy.nextJumpAt = Date.now() + JUMP_MIN_INTERVAL_MS + Math.random() * (JUMP_MAX_INTERVAL_MS - JUMP_MIN_INTERVAL_MS);
}

function shortestAngleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Simple wandering "bot" — picks a random point in the arena, turns to face
// it, walks there (occasionally jumping), then picks a new one. Driven
// through the exact same shared/movement.js step() used for real players, so
// dummies collide with walls/crates, fall under gravity, and jump identically
// — no separate AI-only physics needed.
export function updateDummyAI(dummy, dt) {
  if (!dummy.aiTarget) {
    dummy.aiTarget = randomPosition();
    dummy.currentYaw = dummy.state.yaw;
    scheduleNextJump(dummy);
  }

  const dx = dummy.aiTarget.x - dummy.state.position.x;
  const dz = dummy.aiTarget.z - dummy.state.position.z;
  if (Math.hypot(dx, dz) < WAYPOINT_REACHED_DIST) {
    dummy.aiTarget = randomPosition();
  }

  // Face the (possibly just-updated) target, easing the turn rather than
  // snapping instantly so movement reads as natural instead of robotic.
  const tx = dummy.aiTarget.x - dummy.state.position.x;
  const tz = dummy.aiTarget.z - dummy.state.position.z;
  const desiredYaw = Math.atan2(-tx, -tz); // matches shared/movement.js's forward convention
  const maxTurn = TURN_RATE * dt;
  const yawDelta = shortestAngleDelta(dummy.currentYaw, desiredYaw);
  dummy.currentYaw += Math.max(-maxTurn, Math.min(maxTurn, yawDelta));

  const now = Date.now();
  const jumpPressed = dummy.state.onGround && now >= dummy.nextJumpAt;
  if (jumpPressed) scheduleNextJump(dummy);

  const input = {
    forward: true,
    backward: false,
    left: false,
    right: false,
    jumpPressed,
    sprint: false,
    aiming: false,
    leanLeft: false,
    leanRight: false,
    yaw: dummy.currentYaw,
    pitch: 0,
  };

  dummy.state = step(dummy.state, input, dt, colliders);
}
