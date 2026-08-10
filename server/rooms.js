import { createMatch } from './match.js';
import { MAX_PLAYERS } from '../shared/constants.js';

// Excludes visually-ambiguous characters (0/O, 1/I/L) so a room code is easy
// to read aloud or retype without mixing letters up.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

let nextRoomId = 1;
const rooms = new Map(); // roomId -> match
const roomsByCode = new Map(); // code -> match (private rooms only)
const sessionIndex = new Map(); // sessionToken -> { match, player }

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (roomsByCode.has(code));
  return code;
}

export function createRoom({ isPrivate }) {
  const id = nextRoomId++;
  const code = isPrivate ? generateRoomCode() : null;
  const match = createMatch({ id, isPrivate, code });
  rooms.set(id, match);
  if (isPrivate) roomsByCode.set(code, match);
  return match;
}

// Reuses any public room still accepting players before opening a new one —
// keeps the concurrent room count (and thus tick-loop work) minimal and
// maximizes the odds quickplay players actually land together.
export function findOrCreateQuickplayRoom() {
  for (const match of rooms.values()) {
    if (!match.isPrivate && match.phase === 'waiting' && match.players.size < MAX_PLAYERS) {
      return match;
    }
  }
  return createRoom({ isPrivate: false });
}

export function findRoomByCode(code) {
  return roomsByCode.get(code) ?? null;
}

export function registerPlayerSession(match, player) {
  sessionIndex.set(player.sessionToken, { match, player });
}

export function findSession(sessionToken) {
  return sessionIndex.get(sessionToken) ?? null;
}

export function unregisterSession(sessionToken) {
  sessionIndex.delete(sessionToken);
}

// Deletes a room once its last player has actually left (not just
// disconnected — a player in the reconnect grace window still counts as
// present) so abandoned lobbies don't leak memory or keep ticking forever.
export function removeRoomIfEmpty(match) {
  if (match.players.size > 0) return;
  rooms.delete(match.id);
  if (match.code) roomsByCode.delete(match.code);
}

export function getActiveRooms() {
  return rooms.values();
}
