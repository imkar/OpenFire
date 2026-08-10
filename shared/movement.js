import { resolveAxis } from './collision.js';
import {
  MOVE_SPEED,
  SPRINT_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_HALF_EXTENTS,
  PLAYER_HEIGHT,
  LEAN_EASE_RATE,
  MAX_AIR_JUMPS,
  AIR_JUMP_VELOCITY,
  AIR_JUMP_GRAVITY_SCALE,
  AIR_JUMP_FLOAT_DURATION,
  WALL_RUN_MIN_TANGENT_SPEED,
  WALL_RUN_DURATION,
  WALL_RUN_GRAVITY_SCALE,
  WALL_RUN_SPEED,
  WALL_RUN_ENTRY_LIFT,
  WALL_JUMP_UP_VELOCITY,
  WALL_JUMP_PUSH_SPEED,
  ADS_SPEED,
} from './constants.js';

// m/s pushed toward the wall each tick while wall-running, so the collision
// sweep re-detects contact every tick instead of relying on exact boundary
// contact carried over from the previous tick (which floating point can't
// guarantee). resolveAxis immediately clamps this back out, so it never
// causes any visible penetration — see shared/collision.js resolveAxis.
const WALL_RUN_STICK_SPEED = 2;
const NO_WALL_RUN = { active: false, timeLeft: 0, normal: { x: 0, z: 0 }, tangentSign: 1 };

// Pure function: identical byte-for-byte behavior on client (prediction) and
// server (authoritative simulation) because both import this file unmodified.
//
// state: { position: {x,y,z}, velocity: {x,y,z}, yaw, pitch, onGround, lean,
//          airJumpsUsed, airFloatTimeLeft, wallRun: {active,timeLeft,normal,tangentSign} }
// input: { forward, backward, left, right, jumpPressed, sprint, aiming,
//          leanLeft, leanRight, yaw, pitch }
export function step(state, input, dt, colliders) {
  const wasOnGround = state.onGround;
  const prevWallRun = state.wallRun ?? NO_WALL_RUN;
  let airJumpsUsed = state.airJumpsUsed ?? 0;
  let airFloatTimeLeft = Math.max(0, (state.airFloatTimeLeft ?? 0) - dt);

  // Aiming down sights overrides sprint (can't sprint while ADS) and is
  // purely input-driven — no persistent state field needed, the server
  // just re-checks input.aiming every tick, same as sprint already does.
  const speed = input.aiming ? ADS_SPEED : input.sprint ? SPRINT_SPEED : MOVE_SPEED;
  const sinYaw = Math.sin(input.yaw);
  const cosYaw = Math.cos(input.yaw);

  let moveX = 0;
  let moveZ = 0;
  if (input.forward) { moveX -= sinYaw; moveZ -= cosYaw; }
  if (input.backward) { moveX += sinYaw; moveZ += cosYaw; }
  if (input.left) { moveX -= cosYaw; moveZ += sinYaw; }
  if (input.right) { moveX += cosYaw; moveZ -= sinYaw; }

  const len = Math.hypot(moveX, moveZ);
  if (len > 0) {
    moveX /= len;
    moveZ /= len;
  }

  let vel;

  if (prevWallRun.active) {
    // Keep running along the wall tangent (direction locked in at entry —
    // no mid-run steering in v1) instead of free WASD movement.
    const tangent = { x: -prevWallRun.normal.z, z: prevWallRun.normal.x };
    const sign = prevWallRun.tangentSign;

    vel = {
      x: tangent.x * WALL_RUN_SPEED * sign - prevWallRun.normal.x * WALL_RUN_STICK_SPEED,
      y: state.velocity.y,
      z: tangent.z * WALL_RUN_SPEED * sign - prevWallRun.normal.z * WALL_RUN_STICK_SPEED,
    };
    vel.y -= GRAVITY * WALL_RUN_GRAVITY_SCALE * dt;
  } else {
    vel = { x: moveX * speed, y: state.velocity.y, z: moveZ * speed };
    const gravityScale = airFloatTimeLeft > 0 ? AIR_JUMP_GRAVITY_SCALE : 1;
    vel.y -= GRAVITY * gravityScale * dt;
  }

  let wallRun = prevWallRun.active ? prevWallRun : NO_WALL_RUN;

  // --- Jump handling: a single edge-triggered event drives ground jump,
  // air jump (double/boost jump), and wall-kick (wall-jump). ---
  if (input.jumpPressed) {
    if (wallRun.active) {
      vel.y = WALL_JUMP_UP_VELOCITY;
      vel.x += wallRun.normal.x * WALL_JUMP_PUSH_SPEED;
      vel.z += wallRun.normal.z * WALL_JUMP_PUSH_SPEED;
      wallRun = NO_WALL_RUN;
      airJumpsUsed = 0; // refresh air-jump so wall-run -> wall-jump -> double-jump can chain
    } else if (wasOnGround) {
      vel.y = JUMP_VELOCITY;
      airJumpsUsed = 0;
    } else if (airJumpsUsed < MAX_AIR_JUMPS) {
      vel.y = AIR_JUMP_VELOCITY;
      airJumpsUsed += 1;
      airFloatTimeLeft = AIR_JUMP_FLOAT_DURATION;
    }
  }

  const pos = { x: state.position.x, y: state.position.y, z: state.position.z };

  const preXVel = vel.x;
  const preZVel = vel.z;

  // Resolve one axis at a time (classic Quake-style sweep) — gives wall
  // sliding without a general constraint solver.
  pos.x += vel.x * dt;
  const xResult = resolveAxis('x', pos, vel, PLAYER_HALF_EXTENTS, PLAYER_HEIGHT, colliders);

  pos.z += vel.z * dt;
  const zResult = resolveAxis('z', pos, vel, PLAYER_HALF_EXTENTS, PLAYER_HEIGHT, colliders);

  if (wallRun.active) {
    // Stay attached only if the axis matching the wall's normal still hit a
    // wallRunnable collider this tick.
    const axisResult = wallRun.normal.x !== 0 ? xResult : zResult;
    const stillTouching = axisResult.hitCollider?.wallRunnable === true;
    wallRun = { ...wallRun, timeLeft: wallRun.timeLeft - dt };
    if (!stillTouching || wallRun.timeLeft <= 0) wallRun = NO_WALL_RUN;
  } else if (input.sprint) {
    // Try to enter a new wall-run: must be sprinting (classic CoD-style —
    // wall-run only triggers off a sprint, not a regular walk), and hit a
    // wallRunnable collider from the side (enough tangential speed gates out
    // head-on hits) — works whether airborne OR sprinting on the ground (no
    // manual jump required, the game boosts you up onto the wall automatically).
    const hitAxis = xResult.hitCollider?.wallRunnable ? 'x' : zResult.hitCollider?.wallRunnable ? 'z' : null;

    if (hitAxis) {
      const normal = hitAxis === 'x'
        ? { x: -Math.sign(preXVel), z: 0 }
        : { x: 0, z: -Math.sign(preZVel) };
      const tangent = { x: -normal.z, z: normal.x };
      const tangentSpeed = preXVel * tangent.x + preZVel * tangent.z;

      if (Math.abs(tangentSpeed) >= WALL_RUN_MIN_TANGENT_SPEED) {
        wallRun = { active: true, timeLeft: WALL_RUN_DURATION, normal, tangentSign: Math.sign(tangentSpeed) || 1 };
        if (wasOnGround) {
          // Assist kick: launches the player up onto the wall from a
          // grounded sprint instead of requiring a manual jump first.
          vel.y = WALL_RUN_ENTRY_LIFT;
        } else {
          // Catch the fall on entry — reduced gravity only slows FUTURE
          // acceleration, it doesn't undo downward speed already built up
          // before hitting the wall. Without this clamp, approaching from a
          // height would carry that speed straight through the "suppressed
          // gravity" window and barely feel any different from falling.
          vel.y = Math.max(vel.y, -1.5);
        }
      }
    }
  }

  pos.y += vel.y * dt;
  const yResult = resolveAxis('y', pos, vel, PLAYER_HALF_EXTENTS, PLAYER_HEIGHT, colliders);
  const onGround = yResult.landedOnGround;

  if (onGround) {
    airJumpsUsed = 0;
    wallRun = NO_WALL_RUN;
  }

  // Lean (Q/E peek) eases toward -1..0..1; suppressed while wall-running
  // (can't peek while stuck to a wall). The actual sideways eye offset is
  // derived on demand (see shared/collision.js resolveLeanOffset) by callers
  // that need it (camera sync, server shot origin).
  const prevLean = state.lean ?? 0;
  const leanTarget = wallRun.active ? 0
    : input.leanLeft && !input.leanRight ? -1
    : input.leanRight && !input.leanLeft ? 1
    : 0;
  const leanRate = Math.min(1, LEAN_EASE_RATE * dt);
  const lean = prevLean + (leanTarget - prevLean) * leanRate;

  return {
    position: pos,
    velocity: vel,
    yaw: input.yaw,
    pitch: input.pitch,
    onGround,
    lean,
    airJumpsUsed,
    airFloatTimeLeft,
    wallRun,
  };
}
