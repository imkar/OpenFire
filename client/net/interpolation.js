const BUFFER_MAX = 30;

const buffers = new Map(); // playerId -> [{ t, position, yaw }]

export function pushSnapshot(playerId, t, position, yaw) {
  let buf = buffers.get(playerId);
  if (!buf) {
    buf = [];
    buffers.set(playerId, buf);
  }
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
// buffered snapshots that bracket it. Clamps to the nearest edge instead of
// extrapolating when renderTime falls outside the buffered range.
export function getInterpolated(playerId, renderTime) {
  const buf = buffers.get(playerId);
  if (!buf || buf.length === 0) return null;
  if (buf.length === 1) return { position: buf[0].position, yaw: buf[0].yaw };

  const first = buf[0];
  const last = buf[buf.length - 1];
  if (renderTime <= first.t) return { position: first.position, yaw: first.yaw };
  if (renderTime >= last.t) return { position: last.position, yaw: last.yaw };

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
