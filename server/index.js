import http from 'node:http';
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
} from '../shared/constants.js';
import { createMatch, addPlayer, removePlayer, respawnPlayer, resetMatch } from './match.js';
import { relocateDummy } from './dummies.js';
import { updateDummyAI } from './dummyAI.js';
import { simulateTick } from './simulation.js';
import { performHitscan, getShotOrigin } from './lagCompensation.js';
import { broadcast, sendTo } from './net.js';

const match = createMatch();
const FIRE_INTERVAL_MS = 1000 / WEAPON_FIRE_RATE;
const MATCH_END_DISPLAY_MS = 8000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('COD 2v2 WebSocket server running.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const player = addPlayer(match, ws);
  console.log(`[net] player ${player.id} joined team ${player.team} (${match.players.size}/4)`);

  sendTo(player, {
    type: MessageType.WELCOME,
    playerId: player.id,
    team: player.team,
    position: player.position,
    yaw: player.yaw,
    mapVersion: 1,
  });

  broadcastScoreUpdate();

  ws.on('message', (raw) => {
    const msg = decode(raw.toString());
    if (!msg) return;

    if (msg.type === MessageType.INPUT) {
      if (!player.alive || match.phase === 'ended') return;
      player.pendingInputs.push({ seq: msg.seq, input: msg.input });
    } else if (msg.type === MessageType.FIRE) {
      handleFire(player, msg);
    } else if (msg.type === MessageType.RELOAD) {
      handleReload(player);
    } else if (msg.type === MessageType.PING) {
      // Echo the client's own timestamp back unmodified — RTT is computed
      // client-side (now - t) using its own monotonic clock, so the server
      // doesn't need to interpret or clock-sync anything here.
      sendTo(player, { type: MessageType.PONG, t: msg.t });
    }
  });

  ws.on('close', () => {
    console.log(`[net] player ${player.id} left`);
    removePlayer(match, player.id);
    broadcastScoreUpdate();
  });
});

function broadcastScoreUpdate(lastKill) {
  broadcast(match, {
    type: MessageType.SCORE_UPDATE,
    phase: match.phase,
    scores: match.scores,
    playerCount: match.players.size,
    lastKill: lastKill ?? null,
  });
}

function handleFire(player, msg) {
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
    killPlayer(player, target);
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
function processReloads() {
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

function killPlayer(shooter, target) {
  target.alive = false;
  target.deaths += 1;
  target.respawnAt = Date.now() + RESPAWN_DELAY_MS;
  shooter.kills += 1;
  match.scores[shooter.team] += 1;

  broadcastScoreUpdate({ shooterId: shooter.id, targetId: target.id });
  checkMatchEnd();
}

function checkMatchEnd() {
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
      broadcastScoreUpdate();
    }, MATCH_END_DISPLAY_MS);
  }
}

function processRespawns() {
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

function broadcastSnapshot() {
  const players = [];
  for (const p of match.players.values()) {
    players.push({
      id: p.id,
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
  simulateTick(match, FIXED_DT);
  for (const dummy of match.dummies) updateDummyAI(dummy, FIXED_DT);
  processRespawns();
  processReloads();
  broadcastSnapshot();
}, 1000 / TICK_RATE);

server.listen(WS_PORT, () => {
  console.log(`COD 2v2 server listening on ws://localhost:${WS_PORT}`);
});
