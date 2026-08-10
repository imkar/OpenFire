import { step } from '../shared/movement.js';
import { colliders } from '../shared/mapData.js';
import { LAG_COMPENSATION_WINDOW_MS } from '../shared/constants.js';

const HISTORY_MARGIN_MS = 100;

// Authoritative per-tick simulation: drains each player's queued inputs
// through the exact same shared/movement.js used by the client's prediction,
// then records a position-history sample for lag-compensated hit detection.
export function simulateTick(match, dt) {
  // Players can move freely during warm-up ('waiting'); only a fully
  // 'ended' match (between rounds) freezes simulation entirely.
  if (match.phase === 'ended') return;
  const now = Date.now();

  for (const player of match.players.values()) {
    if (!player.alive) continue;

    while (player.pendingInputs.length > 0) {
      const { seq, input } = player.pendingInputs.shift();
      const result = step(
        {
          position: player.position,
          velocity: player.velocity,
          yaw: player.yaw,
          pitch: player.pitch,
          onGround: player.onGround,
          lean: player.lean,
          airJumpsUsed: player.airJumpsUsed,
          airFloatTimeLeft: player.airFloatTimeLeft,
          wallRun: player.wallRun,
        },
        input,
        dt,
        colliders
      );
      player.position = result.position;
      player.velocity = result.velocity;
      player.yaw = result.yaw;
      player.pitch = result.pitch;
      player.onGround = result.onGround;
      player.lean = result.lean;
      player.airJumpsUsed = result.airJumpsUsed;
      player.airFloatTimeLeft = result.airFloatTimeLeft;
      player.wallRun = result.wallRun;
      player.lastProcessedSeq = seq;
    }

    player.history.push({ t: now, position: { ...player.position } });
    const cutoff = now - LAG_COMPENSATION_WINDOW_MS - HISTORY_MARGIN_MS;
    while (player.history.length > 0 && player.history[0].t < cutoff) {
      player.history.shift();
    }
  }
}
