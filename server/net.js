import { encode } from '../shared/protocol.js';

export function broadcast(match, message) {
  const raw = encode(message);
  for (const player of match.players.values()) {
    if (player.ws.readyState === player.ws.OPEN) {
      player.ws.send(raw);
    }
  }
}

export function sendTo(player, message) {
  if (player.ws.readyState === player.ws.OPEN) {
    player.ws.send(encode(message));
  }
}

// For replies sent before a player object exists yet (room-join errors,
// failed resume) — same guard, just addressed directly by the raw socket.
export function sendRaw(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(encode(message));
  }
}
