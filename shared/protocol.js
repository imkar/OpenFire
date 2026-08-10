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

  // Room / matchmaking (client -> server intents, sent right after connecting)
  QUICKPLAY: 'quickplay',
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  START_MATCH: 'start_match',
  RESUME: 'resume',

  // Room / matchmaking (server -> client)
  ROOM_ERROR: 'room_error',
  RESUME_FAILED: 'resume_failed',
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
