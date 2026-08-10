// Shared WebSocket message-type constants and JSON (de)serialization helpers.
// Keeping this in one file means client and server can never drift on shape.
export const MessageType = {
  WELCOME: 'welcome',
  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  FIRE: 'fire',
  RELOAD: 'reload',
  HIT: 'hit',
  DUMMY_HIT: 'dummy_hit',
  RESPAWN: 'respawn',
  SCORE_UPDATE: 'score_update',
  MATCH_END: 'match_end',
  PING: 'ping',
  PONG: 'pong',
};

export function encode(message) {
  return JSON.stringify(message);
}

export function decode(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
