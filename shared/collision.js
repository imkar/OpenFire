// Hand-rolled AABB vs AABB collision — no physics engine.
// Player collider is an AABB with position = feet center (x,z at center, y at feet).

export function getAabbMinMax(pos, halfExtents, height) {
  return {
    min: { x: pos.x - halfExtents.x, y: pos.y, z: pos.z - halfExtents.z },
    max: { x: pos.x + halfExtents.x, y: pos.y + height, z: pos.z + halfExtents.z },
  };
}

function getColliderMinMax(collider) {
  const { pos, halfExtents } = collider;
  return {
    min: { x: pos.x - halfExtents.x, y: pos.y - halfExtents.y, z: pos.z - halfExtents.z },
    max: { x: pos.x + halfExtents.x, y: pos.y + halfExtents.y, z: pos.z + halfExtents.z },
  };
}

function overlaps(a, b) {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

// Resolves penetration along a single axis after `pos` has already been
// integrated forward on that axis. Mutates `pos` and `vel` in place.
// Returns { landedOnGround, hitCollider }: landedOnGround is true when the
// resolution was landing on top of something (axis 'y', moving downward —
// used for ground detection); hitCollider is the last collider actually
// collided with on this axis (or null), used by wall-run entry detection.
export function resolveAxis(axis, pos, vel, halfExtents, height, colliders) {
  let landedOnGround = false;
  let hitCollider = null;

  for (const collider of colliders) {
    const playerBox = getAabbMinMax(pos, halfExtents, height);
    const colliderBox = getColliderMinMax(collider);
    if (!overlaps(playerBox, colliderBox)) continue;

    if (axis === 'x') {
      if (vel.x > 0) pos.x = colliderBox.min.x - halfExtents.x;
      else if (vel.x < 0) pos.x = colliderBox.max.x + halfExtents.x;
      vel.x = 0;
      hitCollider = collider;
    } else if (axis === 'z') {
      if (vel.z > 0) pos.z = colliderBox.min.z - halfExtents.z;
      else if (vel.z < 0) pos.z = colliderBox.max.z + halfExtents.z;
      vel.z = 0;
      hitCollider = collider;
    } else if (axis === 'y') {
      if (vel.y > 0) {
        pos.y = colliderBox.min.y - height;
      } else if (vel.y < 0) {
        pos.y = colliderBox.max.y;
        landedOnGround = true;
      }
      vel.y = 0;
      hitCollider = collider;
    }
  }

  return { landedOnGround, hitCollider };
}

function isPointInsideAnyCollider(point, colliders) {
  for (const c of colliders) {
    if (
      point.x > c.pos.x - c.halfExtents.x && point.x < c.pos.x + c.halfExtents.x &&
      point.y > c.pos.y - c.halfExtents.y && point.y < c.pos.y + c.halfExtents.y &&
      point.z > c.pos.z - c.halfExtents.z && point.z < c.pos.z + c.halfExtents.z
    ) {
      return true;
    }
  }
  return false;
}

// Computes the sideways eye offset for leaning (peeking), clamped so the eye
// point never ends up inside world geometry — shrinks the offset in 10%
// steps until it clears, so leaning smoothly stops at a wall/crate surface
// instead of poking the camera through it. Pure/deterministic given the same
// inputs, so client prediction and the server always agree.
export function resolveLeanOffset(eyePos, yaw, leanAmount, maxDistance, colliders) {
  if (!leanAmount) return { x: 0, y: 0, z: 0 };

  const rightDir = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const desired = { x: rightDir.x * leanAmount * maxDistance, z: rightDir.z * leanAmount * maxDistance };

  for (let f = 1; f >= 0; f -= 0.1) {
    const p = { x: eyePos.x + desired.x * f, y: eyePos.y, z: eyePos.z + desired.z * f };
    if (!isPointInsideAnyCollider(p, colliders)) {
      return { x: desired.x * f, y: 0, z: desired.z * f };
    }
  }
  return { x: 0, y: 0, z: 0 };
}
