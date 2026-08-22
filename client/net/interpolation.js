const BUFFER_MAX = 30;
const MAX_EXTRAPOLATION_MS = 250; // beyond this, freeze instead of extrapolating further — unbounded extrapolation reads as teleporting once it overshoots

const buffers = new Map(); // playerId -> [{ t, position, yaw }]

export function pushSnapshot(playerId, t, position, yaw) {
  let buf = buffers.get(playerId);
  if (!buf) {
    buf = [];
    buffers.set(playerId, buf);
  }
  // Drop snapshots that arrive out of temporal order (e.g. under simulated
  // reordering) — appending one would break the monotonic-t assumption the
  // bracket scan and extrapolation below both rely on.
  if (buf.length > 0 && t <= buf[buf.length - 1].t) return;
  buf.push({ t, position, yaw });
  if (buf.length > BUFFER_MAX) buf.shift();
}

export function removePlayerBuffer(playerId) {
  buffers.delete(playerId);
}

function shortestAngleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Interpolates a remote player's transform at `renderTime` between the two
// buffered snapshots that bracket it. Below the buffered range, clamps to
// the oldest sample (nothing earlier to show). Above it (the buffer ran dry
// — packet loss/gap), linearly extrapolates from the last known velocity
// (last two samples) for up to MAX_EXTRAPOLATION_MS, then freezes — a short
// coast reads better than a freeze on a brief gap, but unbounded
// extrapolation eventually looks like teleporting once it's wrong.
export function getInterpolated(playerId, renderTime) {
  const buf = buffers.get(playerId);
  if (!buf || buf.length === 0) return null;
  if (buf.length === 1) return { position: buf[0].position, yaw: buf[0].yaw };

  const first = buf[0];
  const last = buf[buf.length - 1];
  if (renderTime <= first.t) return { position: first.position, yaw: first.yaw };

  if (renderTime >= last.t) {
    const prev = buf[buf.length - 2];
    const stepMs = last.t - prev.t;
    const overshootMs = Math.min(renderTime - last.t, MAX_EXTRAPOLATION_MS);
    if (stepMs <= 0 || overshootMs <= 0) return { position: last.position, yaw: last.yaw };

    const alpha = overshootMs / stepMs; // how many prev->last steps to project forward
    return {
      position: {
        x: last.position.x + (last.position.x - prev.position.x) * alpha,
        y: last.position.y + (last.position.y - prev.position.y) * alpha,
        z: last.position.z + (last.position.z - prev.position.z) * alpha,
      },
      yaw: last.yaw + shortestAngleDelta(prev.yaw, last.yaw) * alpha,
    };
  }

  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1];
    const b = buf[i];
    if (renderTime >= a.t && renderTime <= b.t) {
      const alpha = (renderTime - a.t) / (b.t - a.t || 1);
      return {
        position: {
          x: a.position.x + (b.position.x - a.position.x) * alpha,
          y: a.position.y + (b.position.y - a.position.y) * alpha,
          z: a.position.z + (b.position.z - a.position.z) * alpha,
        },
        yaw: a.yaw + shortestAngleDelta(a.yaw, b.yaw) * alpha,
      };
    }
  }
  return { position: last.position, yaw: last.yaw };
}
