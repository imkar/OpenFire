import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MessageType, decode } from '../shared/protocol.js';
import {
  FIXED_DT,
  TICK_RATE,
  WS_PORT,
  WEAPON_DAMAGE,
  WEAPON_FIRE_RATE,
  RESPAWN_DELAY_MS,
  SCORE_LIMIT,
  TEAM_A,
  TEAM_B,
  MAGAZINE_SIZE,
  RELOAD_DURATION_MS,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  MIN_PLAYERS_TO_FORCE_START,
} from '../shared/constants.js';
import { addPlayer, removePlayer, respawnPlayer, resetMatch, startMatch } from './match.js';
import {
  createRoom,
  findOrCreateQuickplayRoom,
  findRoomByCode,
  registerPlayerSession,
  findSession,
  unregisterSession,
  removeRoomIfEmpty,
  getActiveRooms,
} from './rooms.js';
import { relocateDummy } from './dummies.js';
import { updateDummyAI } from './dummyAI.js';
import { simulateTick } from './simulation.js';
import { performHitscan, getShotOrigin } from './lagCompensation.js';
import { broadcast, sendTo, sendRaw } from './net.js';

const FIRE_INTERVAL_MS = 1000 / WEAPON_FIRE_RATE;
const MATCH_END_DISPLAY_MS = 8000;

// Serves the Vite-built client (dist/) from the same port as the WebSocket
// server so production deploys avoid mixed-content issues (single origin,
// single protocol). Falls back to a plain status response when dist/
// hasn't been built yet (e.g. local `npm run dev:server`).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SERVE_STATIC = fs.existsSync(DIST_DIR);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStaticFile(req, res) {
  const requestPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(DIST_DIR, requestPath === '/' ? 'index.html' : requestPath);

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST_DIR, 'index.html'), (fallbackErr, fallbackData) => {
        if (fallbackErr) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(fallbackData);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (SERVE_STATIC) {
    serveStaticFile(req, res);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OpenFire WebSocket server running.\n');
});

// perMessageDeflate off: compressing every small, frequent (60Hz) JSON
// snapshot costs more CPU/latency than the bandwidth savings are worth for
// a real-time game.
const wss = new WebSocketServer({ server, perMessageDeflate: false });

wss.on('connection', (ws) => {
  // Disable Nagle's algorithm — without this, small frequent packets sit
  // buffered waiting to coalesce or for the peer's delayed ACK, adding up
  // to ~200ms of avoidable round-trip latency (exactly the symptom this
  // fixes: real-time snapshots are latency-sensitive, not bandwidth-bound).
  ws._socket.setNoDelay(true);

  // Per-connection state — null until the client sends a room-assignment
  // intent (QUICKPLAY/CREATE_ROOM/JOIN_ROOM/RESUME). Connecting no longer
  // auto-joins anything, so multiple rooms can coexist on one process.
  let player = null;
  let currentRoom = null;

  function sendWelcome() {
    sendTo(player, {
      type: MessageType.WELCOME,
      playerId: player.id,
      team: player.team,
      position: player.position,
      yaw: player.yaw,
      mapVersion: 1,
      roomId: currentRoom.id,
      isPrivate: currentRoom.isPrivate,
      code: currentRoom.code,
      hostId: currentRoom.hostId,
      sessionToken: player.sessionToken,
    });
  }

  function joinRoom(room, nickname) {
    currentRoom = room;
    player = addPlayer(currentRoom, ws, nickname);
    registerPlayerSession(currentRoom, player);
    console.log(
      `[net] player ${player.id} joined room ${currentRoom.id}${currentRoom.isPrivate ? ` (${currentRoom.code})` : ''} team ${player.team} (${currentRoom.players.size}/${MAX_PLAYERS})`
    );
    sendWelcome();
    broadcastScoreUpdate(currentRoom);
  }

  ws.on('message', (raw) => {
    const msg = decode(raw.toString());
    if (!msg) return;

    if (!player) {
      // Not in a room yet — only room-assignment intents are meaningful.
      if (msg.type === MessageType.QUICKPLAY) {
        joinRoom(findOrCreateQuickplayRoom(), msg.nickname);
      } else if (msg.type === MessageType.CREATE_ROOM) {
        joinRoom(createRoom({ isPrivate: true }), msg.nickname);
      } else if (msg.type === MessageType.JOIN_ROOM) {
        const code = typeof msg.code === 'string' ? msg.code.toUpperCase() : '';
        const room = findRoomByCode(code);
        if (!room) {
          sendRaw(ws, { type: MessageType.ROOM_ERROR, message: 'Oda bulunamadı.' });
        } else if (room.players.size >= MAX_PLAYERS) {
          sendRaw(ws, { type: MessageType.ROOM_ERROR, message: 'Oda dolu.' });
        } else if (room.phase !== 'waiting') {
          sendRaw(ws, { type: MessageType.ROOM_ERROR, message: 'Maç zaten başladı.' });
        } else {
          joinRoom(room, msg.nickname);
        }
      } else if (msg.type === MessageType.RESUME) {
        const session = findSession(msg.sessionToken);
        if (!session || session.player.disconnectedAt === null) {
          sendRaw(ws, { type: MessageType.RESUME_FAILED });
          return;
        }
        currentRoom = session.match;
        player = session.player;
        player.ws = ws;
        player.disconnectedAt = null;
        console.log(`[net] player ${player.id} resumed room ${currentRoom.id}`);
        sendWelcome();
      }
      return;
    }

    if (msg.type === MessageType.INPUT) {
      if (!player.alive || currentRoom.phase === 'ended') return;
      player.pendingInputs.push({ seq: msg.seq, input: msg.input });
    } else if (msg.type === MessageType.FIRE) {
      handleFire(currentRoom, player, msg);
    } else if (msg.type === MessageType.RELOAD) {
      handleReload(player);
    } else if (msg.type === MessageType.LEAVE_ROOM) {
      // Only meaningful pre-match — leaving a live match still just means
      // closing the connection, same as today.
      if (currentRoom.phase !== 'waiting') return;
      console.log(`[net] player ${player.id} left room ${currentRoom.id} (lobby)`);
      removePlayer(currentRoom, player.id);
      unregisterSession(player.sessionToken);
      removeRoomIfEmpty(currentRoom);
      broadcastScoreUpdate(currentRoom);
      player = null;
      currentRoom = null;
    } else if (msg.type === MessageType.START_MATCH) {
      if (
        currentRoom.phase === 'waiting' &&
        player.id === currentRoom.hostId &&
        currentRoom.players.size >= MIN_PLAYERS_TO_FORCE_START
      ) {
        startMatch(currentRoom);
        broadcastScoreUpdate(currentRoom);
      }
    } else if (msg.type === MessageType.PING) {
      // Echo the client's own timestamp back unmodified — RTT is computed
      // client-side (now - t) using its own monotonic clock, so the server
      // doesn't need to interpret or clock-sync anything here.
      sendTo(player, { type: MessageType.PONG, t: msg.t });
    }
  });

  ws.on('close', () => {
    if (!player) return; // never joined a room — nothing to clean up
    console.log(`[net] player ${player.id} disconnected, grace period started`);
    player.disconnectedAt = Date.now();
  });
});

function broadcastScoreUpdate(match, lastKill) {
  broadcast(match, {
    type: MessageType.SCORE_UPDATE,
    phase: match.phase,
    scores: match.scores,
    playerCount: match.players.size,
    lastKill: lastKill ?? null,
  });
}

function handleFire(match, player, msg) {
  // Dummy target practice works regardless of match phase (something to
  // shoot while waiting for more players) — only real player damage/scoring
  // stays gated to a 'live' match, checked further below.
  if (!player.alive) return;
  if (player.reloading || player.ammo <= 0) return; // authoritative — client can only request, not force a shot

  const now = Date.now();
  if (now - player.lastFireAt < FIRE_INTERVAL_MS) return; // fire-rate limit
  player.lastFireAt = now;

  if (!msg.direction || typeof msg.direction.x !== 'number') return;

  player.ammo -= 1; // spent regardless of whether the shot actually hits anything
  if (player.ammo <= 0 && player.reserveAmmo > 0) {
    // Auto-reload the instant the magazine empties — no need to press R.
    player.reloading = true;
    player.reloadEndsAt = Date.now() + RELOAD_DURATION_MS;
  }

  const origin = getShotOrigin(player);
  const result = performHitscan({
    shooter: player,
    origin,
    direction: msg.direction,
    timestamp: msg.timestamp ?? now,
    players: match.players,
    dummies: match.dummies,
  });

  if (!result) return;

  if (result.hitDummyId !== null) {
    const dummy = match.dummies.find((d) => d.id === result.hitDummyId);
    if (dummy) {
      // Capture where it actually got hit BEFORE any relocation — a killing
      // blow moves the dummy immediately, and broadcasting the NEW position
      // as the "hit position" would show impact/blood effects at the spot it
      // teleported to instead of where it was actually shot.
      const hitPosition = { ...dummy.state.position };
      dummy.health -= WEAPON_DAMAGE;
      const killed = dummy.health <= 0;
      if (killed) relocateDummy(dummy); // also restores full health at the new spot
      broadcast(match, {
        type: MessageType.DUMMY_HIT,
        shooterId: player.id,
        dummyId: dummy.id,
        position: hitPosition,
        health: dummy.health,
        killed,
      });
    }
    return;
  }

  if (match.phase !== 'live') return;
  const target = match.players.get(result.hitPlayerId);
  if (!target || !target.alive) return;

  target.health -= WEAPON_DAMAGE;
  broadcast(match, {
    type: MessageType.HIT,
    shooterId: player.id,
    targetId: target.id,
    position: target.position,
    damage: WEAPON_DAMAGE,
    targetHealth: Math.max(target.health, 0),
  });

  if (target.health <= 0) {
    killPlayer(match, player, target);
  }
}

function handleReload(player) {
  if (!player.alive || player.reloading || player.ammo >= MAGAZINE_SIZE || player.reserveAmmo <= 0) return;
  player.reloading = true;
  player.reloadEndsAt = Date.now() + RELOAD_DURATION_MS;
}

// Completes any reload whose timer has elapsed, pulling only as many rounds
// as the (now finite) reserve actually has — a reload started with a
// half-empty reserve tops off with whatever's left instead of overdrawing it.
function processReloads(match) {
  const now = Date.now();
  for (const player of match.players.values()) {
    if (player.reloading && player.reloadEndsAt !== null && now >= player.reloadEndsAt) {
      const needed = MAGAZINE_SIZE - player.ammo;
      const taken = Math.min(needed, player.reserveAmmo);
      player.ammo += taken;
      player.reserveAmmo -= taken;
      player.reloading = false;
      player.reloadEndsAt = null;
    }
  }
}

function killPlayer(match, shooter, target) {
  target.alive = false;
  target.deaths += 1;
  target.respawnAt = Date.now() + RESPAWN_DELAY_MS;
  shooter.kills += 1;
  match.scores[shooter.team] += 1;

  broadcastScoreUpdate(match, { shooterId: shooter.id, targetId: target.id });
  checkMatchEnd(match);
}

function checkMatchEnd(match) {
  if (match.phase !== 'live') return;
  const a = match.scores[TEAM_A];
  const b = match.scores[TEAM_B];
  const timeUp = match.endsAt !== null && Date.now() >= match.endsAt;

  if (a >= SCORE_LIMIT || b >= SCORE_LIMIT || timeUp) {
    match.phase = 'ended';
    match.winner = a === b ? null : a > b ? TEAM_A : TEAM_B;
    broadcast(match, { type: MessageType.MATCH_END, winner: match.winner, scores: match.scores });
    setTimeout(() => {
      resetMatch(match);
      broadcastScoreUpdate(match);
    }, MATCH_END_DISPLAY_MS);
  }
}

function processRespawns(match) {
  const now = Date.now();
  for (const player of match.players.values()) {
    if (!player.alive && player.respawnAt !== null && now >= player.respawnAt) {
      respawnPlayer(match, player);
      broadcast(match, {
        type: MessageType.RESPAWN,
        playerId: player.id,
        position: player.position,
        yaw: player.yaw,
      });
    }
  }
}

// Finalizes players whose reconnect grace window has elapsed (see ws.on
// 'close' above) — until then they stay in `match.players`, frozen at their
// last known position (no pending inputs ever arrive for them, so
// simulateTick simply never moves them), so a short blip is invisible to
// everyone else. Deletes the room too once its last player is gone for good.
function sweepDisconnected(match, now) {
  for (const player of match.players.values()) {
    if (player.disconnectedAt !== null && now - player.disconnectedAt > RECONNECT_GRACE_MS) {
      console.log(`[net] player ${player.id} grace period expired, leaving room ${match.id}`);
      removePlayer(match, player.id);
      unregisterSession(player.sessionToken);
    }
  }
  removeRoomIfEmpty(match);
}

function broadcastSnapshot(match) {
  const players = [];
  for (const p of match.players.values()) {
    players.push({
      id: p.id,
      nickname: p.nickname,
      team: p.team,
      position: p.position,
      velocity: p.velocity,
      yaw: p.yaw,
      pitch: p.pitch,
      onGround: p.onGround,
      lean: p.lean,
      airJumpsUsed: p.airJumpsUsed,
      airFloatTimeLeft: p.airFloatTimeLeft,
      wallRun: p.wallRun,
      health: p.health,
      alive: p.alive,
      ammo: p.ammo,
      reserveAmmo: p.reserveAmmo,
      reloading: p.reloading,
      lastProcessedSeq: p.lastProcessedSeq,
    });
  }

  const dummies = match.dummies.map((d) => ({ id: d.id, position: d.state.position, yaw: d.state.yaw, health: d.health }));

  broadcast(match, {
    type: MessageType.SNAPSHOT,
    t: Date.now(),
    phase: match.phase,
    scores: match.scores,
    players,
    dummies,
  });
}

setInterval(() => {
  const now = Date.now();
  for (const match of getActiveRooms()) {
    simulateTick(match, FIXED_DT);
    for (const dummy of match.dummies) updateDummyAI(dummy, FIXED_DT);
    processRespawns(match);
    processReloads(match);
    sweepDisconnected(match, now);
    broadcastSnapshot(match);
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || WS_PORT;

server.listen(PORT, () => {
  console.log(`OpenFire server listening on ws://localhost:${PORT}`);
});
