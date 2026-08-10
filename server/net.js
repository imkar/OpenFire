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
