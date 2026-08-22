import * as THREE from 'three';
import { step } from '../../shared/movement.js';
import { resolveLeanOffset } from '../../shared/collision.js';
import {
  EYE_HEIGHT, RECONCILE_BLEND, RECONCILE_SNAP_DISTANCE_M, LEAN_DISTANCE, LEAN_ROLL, WALL_RUN_ROLL,
  ADS_FOV, ADS_EASE_RATE, MAX_AIR_JUMPS, RELOAD_DURATION_MS,
} from '../../shared/constants.js';
import { colliders } from '../../shared/mapData.js';
import { playJump, playThrust, startWallRide, stopWallRide } from '../audio/sfx.js';

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();

const HIP_GUN_POS = { x: 0.25, y: -0.25, z: -0.5 };
const ADS_GUN_POS = { x: 0, y: -0.16, z: -0.32 };

// Muzzle flash's local offset (on the gun), blended by aimAmount same as the
// gun's own position — the hip-fire spot already looks right and is left
// alone; only the ADS spot shifts (further right/centered) to compensate
// for the narrower ADS FOV + recentered gun changing how it reads on screen.
const HIP_FLASH_POS = { x: -0.045, y: 0.035, z: -0.34 };
const ADS_FLASH_POS = { x: 0.02, y: 0.025, z: -0.34 };

// Muzzle flash right at the barrel is enough to read as "it fired" — no
// travelling tracer beam (see createViewModel() for the flash mesh itself).
const MUZZLE_FLASH_DURATION_MS = 55;

function triggerMuzzleFlash(flash) {
  if (!flash) return;
  flash.visible = true;
  flash.material.opacity = 1;
  flash.scale.setScalar(0.7 + Math.random() * 0.6);
  const start = performance.now();
  function tick() {
    const t = (performance.now() - start) / MUZZLE_FLASH_DURATION_MS;
    if (t >= 1) {
      flash.visible = false;
      return;
    }
    flash.material.opacity = 1 - t;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Reload animation: the gun dips down and tilts, then comes back up — a
// single sine hump over RELOAD_DURATION_MS so it's naturally symmetric (down
// then up) without needing separate keyframes. Purely cosmetic and started
// immediately on the local request (like the rest of the fire feedback)
// rather than waiting for the server's confirmation — actually being able to
// fire again still stays gated by the server's authoritative `reloading`
// flag regardless of how this animation plays out.
const RELOAD_DIP_Y = -0.2; // meters, how far down the gun dips
const RELOAD_TILT = 0.4; // radians, how much it tilts while lowered
const RELOAD_SPIN = 0.5; // radians, slight twist for a "checking the mag" feel

// Weapon recoil is a proper mass-spring-damper simulation, not a flat
// exponential decay: each shot applies an IMPULSE to velocity, the spring
// pulls the offset back toward zero, damping bleeds off energy. This reads
// far more natural — a snappy kick out, then a settle with a touch of
// realistic overshoot/bounce — and rapid fire naturally stacks impulses on
// top of whatever motion is already in flight instead of just resetting.
const RECOIL_SPRING_STIFFNESS = 180;
const RECOIL_SPRING_DAMPING = 14; // below critical (~2*sqrt(stiffness)=26.8) for a slight natural bounce
const RECOIL_IMPULSE_BACK = 1.1; // gun kicks toward the camera (+local z)
const RECOIL_IMPULSE_UP = 0.55;
const RECOIL_IMPULSE_ROT = 0.9; // muzzle-rise tilt
const RECOIL_IMPULSE_SIDE = 0.35; // randomized left/right per shot, less robotic

// A subtle SEPARATE camera "view kick" layered on top of the real aim
// (state.pitch/state.yaw), same spring technique but smaller and a bit
// softer. This is real recoil, not just a prop animation: rapid-fire shots
// visibly climb and settle, same as an actual weapon — but the magnitude is
// kept small enough to never feel unfair, and it fully recovers in a
// fraction of a second.
const VIEW_KICK_STIFFNESS = 140;
const VIEW_KICK_DAMPING = 13;
const VIEW_KICK_PITCH_IMPULSE = 0.35; // rad/s, camera punches upward
const VIEW_KICK_YAW_IMPULSE = 0.12; // rad/s, randomized +/-

// Separate from the snappy per-shot view-kick spring above: a slow-building
// upward drift while the trigger stays down, like a real gun climbing out of
// control during sustained automatic fire. Each shot nudges it up a little;
// it drains steadily the whole time, so short taps barely climb at all but
// holding the trigger for a couple of seconds visibly walks the aim upward —
// and, since it's added straight into the real camera pitch (not just a
// cosmetic prop), you actually have to pull down to compensate, same as a
// real spray pattern. Releasing the trigger lets it drain back to zero.
const SUSTAINED_CLIMB_PER_SHOT = 0.014; // radians added on each shot while firing
const SUSTAINED_CLIMB_MAX = 0.16; // radians (~9°) cap
const SUSTAINED_CLIMB_DECAY = 0.045; // radians/sec continuous drain

// One step of a damped harmonic oscillator: accel = -stiffness*pos - damping*vel.
function springStep(pos, vel, stiffness, damping, dt) {
  const accel = -stiffness * pos - damping * vel;
  const nextVel = vel + accel * dt;
  return [pos + nextVel * dt, nextVel];
}

export function createLocalPlayer(camera, scene, spawn = { x: 0, y: 0, z: 5, yaw: 0 }, gun = null, muzzleFlash = null) {
  const hipFov = camera.fov;
  let aimAmount = 0; // 0 = hip-fire, 1 = fully aimed down sights

  let state = {
    position: { x: spawn.x, y: spawn.y, z: spawn.z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    onGround: false,
    lean: 0,
    airJumpsUsed: 0,
    airFloatTimeLeft: 0,
    wallRun: { active: false, timeLeft: 0, normal: { x: 0, z: 0 }, tangentSign: 1 },
  };

  // Visual-only offset used to smooth out server reconciliation corrections
  // (see reconcileWithServer) so the camera never visibly teleports.
  const visualOffset = { x: 0, y: 0, z: 0 };

  // Spring-damper recoil state — see springStep() and the RECOIL_/VIEW_KICK_
  // constants above. `recoil` is viewmodel-only (position+rotation); `viewKick`
  // is the small additive camera punch layered on top of real aim.
  const recoil = { x: 0, xVel: 0, y: 0, yVel: 0, z: 0, zVel: 0, rotX: 0, rotXVel: 0 };
  const viewKick = { pitch: 0, pitchVel: 0, yaw: 0, yawVel: 0 };
  let sustainedClimb = 0; // see SUSTAINED_CLIMB_ constants above
  let reloadAnim = { active: false, startTime: 0 }; // see RELOAD_ constants above

  function syncCamera() {
    visualOffset.x *= 1 - RECONCILE_BLEND;
    visualOffset.y *= 1 - RECONCILE_BLEND;
    visualOffset.z *= 1 - RECONCILE_BLEND;

    const eyePos = {
      x: state.position.x + visualOffset.x,
      y: state.position.y + visualOffset.y + EYE_HEIGHT,
      z: state.position.z + visualOffset.z,
    };
    const lean = state.lean ?? 0;
    const leanOffset = resolveLeanOffset(eyePos, state.yaw, lean, LEAN_DISTANCE, colliders);

    camera.position.set(eyePos.x + leanOffset.x, eyePos.y, eyePos.z + leanOffset.z);
    // View-kick layers a small additive punch on top of real aim (see the
    // VIEW_KICK_ constants) — genuine recoil, not just a viewmodel prop.
    camera.rotation.y = state.yaw + viewKick.yaw;
    // sustainedClimb is the slow "losing control during a long burst" drift
    // (see SUSTAINED_CLIMB_ constants) — added on top of the snappy per-shot
    // viewKick spring, both baked into the real aim.
    camera.rotation.x = state.pitch + viewKick.pitch + sustainedClimb;

    // Wall-run tilt takes over from lean roll while active (lean itself
    // eases back to 0 during a wall-run — see shared/movement.js step()).
    const wallRun = state.wallRun;
    if (wallRun?.active) {
      const rightDir = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };
      const side = wallRun.normal.x * rightDir.x + wallRun.normal.z * rightDir.z;
      camera.rotation.z = -Math.sign(side) * WALL_RUN_ROLL;
    } else {
      camera.rotation.z = -lean * LEAN_ROLL;
    }

    // Aim down sights: zoom the FOV and bring the viewmodel toward center.
    camera.fov = hipFov + (ADS_FOV - hipFov) * aimAmount;
    camera.updateProjectionMatrix();
    // Reload dip: a single sine hump over the reload duration (0 -> 1 -> 0),
    // naturally symmetric so the gun dips down/tilts then comes back up
    // without needing separate keyframes for each half.
    let reloadDip = 0;
    if (reloadAnim.active) {
      const t = (performance.now() - reloadAnim.startTime) / RELOAD_DURATION_MS;
      if (t >= 1) {
        reloadAnim.active = false;
      } else {
        reloadDip = Math.sin(Math.max(0, t) * Math.PI);
      }
    }

    if (gun) {
      gun.position.set(
        HIP_GUN_POS.x + (ADS_GUN_POS.x - HIP_GUN_POS.x) * aimAmount + recoil.x,
        HIP_GUN_POS.y + (ADS_GUN_POS.y - HIP_GUN_POS.y) * aimAmount + recoil.y + RELOAD_DIP_Y * reloadDip,
        HIP_GUN_POS.z + (ADS_GUN_POS.z - HIP_GUN_POS.z) * aimAmount + recoil.z
      );
      gun.rotation.x = -recoil.rotX + RELOAD_TILT * reloadDip;
      gun.rotation.z = RELOAD_SPIN * reloadDip;

      if (muzzleFlash) {
        muzzleFlash.position.set(
          HIP_FLASH_POS.x + (ADS_FLASH_POS.x - HIP_FLASH_POS.x) * aimAmount,
          HIP_FLASH_POS.y + (ADS_FLASH_POS.y - HIP_FLASH_POS.y) * aimAmount,
          HIP_FLASH_POS.z
        );
      }
    }
  }

  // Predicts one fixed tick locally and updates the camera immediately —
  // this is what makes movement feel instant regardless of RTT. Only real
  // (non-replayed) ticks reach here, so jump/wall-ride sounds only ever
  // fire once per actual event, never retriggered by reconciliation replay.
  function update(input, dt) {
    const prevState = state;
    state = step(state, input, dt, colliders);

    if (input.jumpPressed) {
      // Mirrors shared/movement.js step()'s own jump-branch order — used
      // only to pick a sound, so a jump that step() actually denies (e.g.
      // pressed mid-air with the air-jump charge already spent) stays silent.
      if (prevState.wallRun?.active) playThrust(); // wall-kick
      else if (prevState.onGround) playJump();
      else if ((prevState.airJumpsUsed ?? 0) < MAX_AIR_JUMPS) playThrust();
    }

    const wasWallRiding = prevState.wallRun?.active ?? false;
    const isWallRiding = state.wallRun?.active ?? false;
    if (isWallRiding && !wasWallRiding) startWallRide();
    else if (!isWallRiding && wasWallRiding) stopWallRide();

    const aimTarget = input.aiming ? 1 : 0;
    const aimRate = Math.min(1, ADS_EASE_RATE * dt);
    aimAmount += (aimTarget - aimAmount) * aimRate;

    [recoil.x, recoil.xVel] = springStep(recoil.x, recoil.xVel, RECOIL_SPRING_STIFFNESS, RECOIL_SPRING_DAMPING, dt);
    [recoil.y, recoil.yVel] = springStep(recoil.y, recoil.yVel, RECOIL_SPRING_STIFFNESS, RECOIL_SPRING_DAMPING, dt);
    [recoil.z, recoil.zVel] = springStep(recoil.z, recoil.zVel, RECOIL_SPRING_STIFFNESS, RECOIL_SPRING_DAMPING, dt);
    [recoil.rotX, recoil.rotXVel] = springStep(recoil.rotX, recoil.rotXVel, RECOIL_SPRING_STIFFNESS, RECOIL_SPRING_DAMPING, dt);
    [viewKick.pitch, viewKick.pitchVel] = springStep(viewKick.pitch, viewKick.pitchVel, VIEW_KICK_STIFFNESS, VIEW_KICK_DAMPING, dt);
    [viewKick.yaw, viewKick.yawVel] = springStep(viewKick.yaw, viewKick.yawVel, VIEW_KICK_STIFFNESS, VIEW_KICK_DAMPING, dt);
    sustainedClimb = Math.max(0, sustainedClimb - SUSTAINED_CLIMB_DECAY * dt);

    syncCamera();
  }

  // Advances state through a single buffered input without touching the
  // camera — used to replay pending inputs on top of an authoritative
  // server state during reconciliation.
  function replayInput(input, dt) {
    state = step(state, input, dt, colliders);
  }

  function setRawState(next) {
    state = {
      position: { ...next.position },
      velocity: { ...next.velocity },
      yaw: next.yaw,
      pitch: state.pitch, // pitch is purely local (mouse look), never server-driven
      onGround: next.onGround,
      lean: next.lean ?? 0,
      airJumpsUsed: next.airJumpsUsed ?? 0,
      airFloatTimeLeft: next.airFloatTimeLeft ?? 0,
      wallRun: next.wallRun ?? { active: false, timeLeft: 0, normal: { x: 0, z: 0 }, tangentSign: 1 },
    };
  }

  // Hard-snaps to an authoritative state with no visual smoothing — used for
  // large discontinuous teleports (initial spawn, respawn) where blending
  // would otherwise look like sliding across the map.
  function snapTo(nextState) {
    stopWallRide(); // teleports (spawn/respawn/death) never carry the loop over
    setRawState(nextState);
    visualOffset.x = 0;
    visualOffset.y = 0;
    visualOffset.z = 0;
    syncCamera();
  }

  // Snaps simulation state to the server's authoritative value, replays any
  // not-yet-acknowledged inputs to catch back up to "now", then records the
  // resulting visual pop as a decaying offset so the correction is invisible.
  // Returns the correction magnitude (meters) for netStats telemetry.
  function reconcileWithServer(serverState, pendingInputs) {
    const beforeRender = {
      x: state.position.x + visualOffset.x,
      y: state.position.y + visualOffset.y,
      z: state.position.z + visualOffset.z,
    };

    setRawState(serverState);
    for (const { input, dt } of pendingInputs) {
      replayInput(input, dt);
    }

    const dx = beforeRender.x - state.position.x;
    const dy = beforeRender.y - state.position.y;
    const dz = beforeRender.z - state.position.z;
    const magnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (magnitude > RECONCILE_SNAP_DISTANCE_M) {
      // Large correction (lag spike, desync) — smoothing this over several
      // frames at RECONCILE_BLEND would look like a slow slide across the
      // map; a single pop reads better once the error is this big.
      visualOffset.x = 0;
      visualOffset.y = 0;
      visualOffset.z = 0;
    } else {
      visualOffset.x = dx;
      visualOffset.y = dy;
      visualOffset.z = dz;
    }

    return magnitude;
  }

  // Starts the reload dip animation immediately (see the RELOAD_ constants
  // and syncCamera()). Guarded against re-triggering while already
  // animating, same as the server's own "already reloading" no-op.
  function reload() {
    if (reloadAnim.active) return;
    reloadAnim = { active: true, startTime: performance.now() };
  }

  // Local-only hitscan for instant cosmetic feedback (muzzle flash + impact
  // decal). The server performs the authoritative raycast and decides
  // damage independently. Aim itself stays camera-accurate (what you see is
  // what you hit) — no travelling tracer beam, just a flash at the barrel
  // (see createViewModel()) and a mark at the impact point.
  function fire() {
    // Recoil impulse — a velocity kick, not a direct position jump, so the
    // spring visibly compresses and releases over a few frames instead of
    // teleporting straight to peak displacement. This shot's own aim is
    // captured below from the camera's CURRENT rotation (before this
    // impulse has had a chance to move anything) — only later shots in a
    // rapid burst are affected by the resulting view-kick climb.
    recoil.zVel += RECOIL_IMPULSE_BACK;
    recoil.yVel += RECOIL_IMPULSE_UP;
    recoil.rotXVel += RECOIL_IMPULSE_ROT;
    recoil.xVel += (Math.random() * 2 - 1) * RECOIL_IMPULSE_SIDE;
    viewKick.pitchVel += VIEW_KICK_PITCH_IMPULSE;
    viewKick.yawVel += (Math.random() * 2 - 1) * VIEW_KICK_YAW_IMPULSE;
    sustainedClimb = Math.min(SUSTAINED_CLIMB_MAX, sustainedClimb + SUSTAINED_CLIMB_PER_SHOT);
    triggerMuzzleFlash(muzzleFlash);

    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_direction);
    _raycaster.set(_origin, _direction);

    const hits = _raycaster.intersectObjects(scene.children, true);

    // Leave a bullet mark if this shot struck actual world geometry (wall or
    // crate) — not a player/dummy, since spawnImpactDecal only matches
    // against shared/mapData.js colliders and silently no-ops otherwise.
    if (hits.length > 0) {
      spawnImpactDecal(scene, hits[0].point);
    }

    return { origin: _origin.clone(), direction: _direction.clone() };
  }

  return {
    update,
    fire,
    reload,
    syncCamera,
    reconcileWithServer,
    snapTo,
    getState: () => state,
    getYaw: () => state.yaw,
  };
}


const _decalUp = new THREE.Vector3(0, 0, 1); // CircleGeometry faces +Z by default
const _decalNormal = new THREE.Vector3();
const DECAL_LIFETIME_MS = 12000;
const DECAL_MAX_COUNT = 40; // bounds memory/draw calls even under sustained fire against one spot
const DECAL_SURFACE_OFFSET = 0.015; // pushed off the wall along its normal to avoid z-fighting
const activeDecals = []; // oldest first

// All world geometry is axis-aligned boxes (shared/mapData.js colliders), so
// the exact surface normal is found by locating which collider the point
// lies on and which of its 6 faces that is — simpler and more robust than
// extracting face normals from Three.js raycasts, which would need special
// handling for the crates (rendered via InstancedMesh). Returns null if the
// point doesn't sit on any known collider (e.g. it hit a player/dummy).
function findSurfaceNormal(point) {
  const EPS = 0.02;
  for (const c of colliders) {
    const minX = c.pos.x - c.halfExtents.x, maxX = c.pos.x + c.halfExtents.x;
    const minY = c.pos.y - c.halfExtents.y, maxY = c.pos.y + c.halfExtents.y;
    const minZ = c.pos.z - c.halfExtents.z, maxZ = c.pos.z + c.halfExtents.z;

    const withinX = point.x >= minX - EPS && point.x <= maxX + EPS;
    const withinY = point.y >= minY - EPS && point.y <= maxY + EPS;
    const withinZ = point.z >= minZ - EPS && point.z <= maxZ + EPS;
    if (!(withinX && withinY && withinZ)) continue;

    const onX = Math.abs(point.x - minX) < EPS || Math.abs(point.x - maxX) < EPS;
    const onY = Math.abs(point.y - minY) < EPS || Math.abs(point.y - maxY) < EPS;
    const onZ = Math.abs(point.z - minZ) < EPS || Math.abs(point.z - maxZ) < EPS;

    if (onX && withinY && withinZ) return { x: point.x < c.pos.x ? -1 : 1, y: 0, z: 0 };
    if (onY && withinX && withinZ) return { x: 0, y: point.y < c.pos.y ? -1 : 1, z: 0 };
    if (onZ && withinX && withinY) return { x: 0, y: 0, z: point.z < c.pos.z ? -1 : 1 };
  }
  return null;
}

// Leaves a small dark mark flush against the hit surface, cleaned up
// automatically after DECAL_LIFETIME_MS (or immediately if the pool is full
// — sustained fire against one spot shouldn't grow this unbounded).
function spawnImpactDecal(scene, point) {
  const normal = findSurfaceNormal(point);
  if (!normal) return; // hit a player/dummy, not world geometry — no decal

  while (activeDecals.length >= DECAL_MAX_COUNT) {
    const oldest = activeDecals.shift();
    clearTimeout(oldest.timeoutId);
    scene.remove(oldest.mesh);
    oldest.geo.dispose();
    oldest.mat.dispose();
  }

  const geo = new THREE.CircleGeometry(0.09, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a1712, transparent: true, opacity: 0.85, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;

  _decalNormal.set(normal.x, normal.y, normal.z);
  mesh.position.copy(point).addScaledVector(_decalNormal, DECAL_SURFACE_OFFSET);
  mesh.quaternion.setFromUnitVectors(_decalUp, _decalNormal);
  mesh.rotateZ(Math.random() * Math.PI * 2); // vary orientation so hits don't all look identical
  scene.add(mesh);

  const entry = { mesh, geo, mat, timeoutId: null };
  entry.timeoutId = setTimeout(() => {
    const idx = activeDecals.indexOf(entry);
    if (idx !== -1) activeDecals.splice(idx, 1);
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
  }, DECAL_LIFETIME_MS);
  activeDecals.push(entry);
}
