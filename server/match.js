import { randomUUID } from 'node:crypto';
import { spawnPoints } from '../shared/mapData.js';
import { TEAM_A, TEAM_B, MAX_PLAYERS, PLAYER_MAX_HEALTH, TIME_LIMIT_MS, MAGAZINE_SIZE, RESERVE_AMMO_SIZE } from '../shared/constants.js';
import { createDummies } from './dummies.js';

let nextPlayerId = 1;
let spawnCursor = { [TEAM_A]: 0, [TEAM_B]: 0 };

// `id`/`isPrivate`/`code` are assigned by server/rooms.js right after
// creation (it owns the room registry/code index) — match.js itself just
// carries them, and reserves a null slot for `code` on public rooms.
export function createMatch({ id, isPrivate, code = null } = {}) {
  return {
    id,
    isPrivate: !!isPrivate,
    code,
    hostId: null, // first player to join a private room; null for public/quickplay rooms
    phase: 'waiting', // waiting | live | ended
    players: new Map(),
    dummies: createDummies(), // practice targets — independent of match phase/scoring
    scores: { [TEAM_A]: 0, [TEAM_B]: 0 },
    startedAt: null,
    endsAt: null,
    winner: null,
  };
}

// Flips a room live — called both when a room fills to capacity and when a
// private room's host force-starts early (see MIN_PLAYERS_TO_FORCE_START).
export function startMatch(match) {
  match.phase = 'live';
  match.startedAt = Date.now();
  match.endsAt = Date.now() + TIME_LIMIT_MS;
}

function pickSpawn(team) {
  const points = spawnPoints[team];
  const idx = spawnCursor[team]++;
  return points[idx % points.length];
}

export function addPlayer(match, ws) {
  const id = nextPlayerId++;
  let countA = 0;
  let countB = 0;
  for (const p of match.players.values()) {
    if (p.team === TEAM_A) countA++;
    else countB++;
  }
  const team = countA <= countB ? TEAM_A : TEAM_B;
  const spawn = pickSpawn(team);

  const player = {
    id,
    ws,
    team,
    position: { x: spawn.x, y: spawn.y, z: spawn.z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    onGround: false,
    lean: 0,
    airJumpsUsed: 0,
    airFloatTimeLeft: 0,
    wallRun: { active: false, timeLeft: 0, normal: { x: 0, z: 0 }, tangentSign: 1 },
    health: PLAYER_MAX_HEALTH,
    alive: true,
    kills: 0,
    deaths: 0,
    lastProcessedSeq: 0,
    pendingInputs: [],
    lastFireAt: 0,
    respawnAt: null,
    history: [],
    ammo: MAGAZINE_SIZE,
    reserveAmmo: RESERVE_AMMO_SIZE,
    reloading: false,
    reloadEndsAt: null,
    sessionToken: randomUUID(),
    disconnectedAt: null, // set on ws close; cleared on a successful RESUME within the grace window
  };

  match.players.set(id, player);
  if (match.isPrivate && match.hostId === null) match.hostId = id;

  if (match.phase === 'waiting' && match.players.size >= MAX_PLAYERS) {
    startMatch(match);
  }

  return player;
}

export function removePlayer(match, id) {
  match.players.delete(id);
  // Known v1 limitation: if a team drops to 0 mid-match we just continue at
  // reduced count rather than pausing or backfilling.
}

export function respawnPlayer(match, player) {
  const spawn = pickSpawn(player.team);
  player.position = { x: spawn.x, y: spawn.y, z: spawn.z };
  player.velocity = { x: 0, y: 0, z: 0 };
  player.yaw = spawn.yaw ?? 0;
  player.pitch = 0;
  player.lean = 0;
  player.airJumpsUsed = 0;
  player.airFloatTimeLeft = 0;
  player.wallRun = { active: false, timeLeft: 0, normal: { x: 0, z: 0 }, tangentSign: 1 };
  player.health = PLAYER_MAX_HEALTH;
  player.alive = true;
  player.respawnAt = null;
  player.pendingInputs = [];
  player.ammo = MAGAZINE_SIZE;
  player.reserveAmmo = RESERVE_AMMO_SIZE;
  player.reloading = false;
  player.reloadEndsAt = null;
}

// Resets scores/phase in place so a new match can start without restarting
// the process — no persistence needed for v1's single in-memory room.
export function resetMatch(match) {
  match.phase = match.players.size >= MAX_PLAYERS ? 'live' : 'waiting';
  match.scores = { [TEAM_A]: 0, [TEAM_B]: 0 };
  match.winner = null;
  match.startedAt = match.phase === 'live' ? Date.now() : null;
  match.endsAt = match.phase === 'live' ? Date.now() + TIME_LIMIT_MS : null;

  for (const player of match.players.values()) {
    respawnPlayer(match, player);
    player.kills = 0;
    player.deaths = 0;
  }
}
