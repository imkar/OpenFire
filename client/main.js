import { createScene } from './render/scene.js';
import { buildArena } from './render/arena.js';
import { createViewModel } from './render/player.js';
import { createControls } from './input/controls.js';
import { createLocalPlayer } from './game/localPlayer.js';
import { createRemotePlayers } from './game/remotePlayers.js';
import { createRemoteDummies } from './game/remoteDummies.js';
import { startLoop } from './game/loop.js';
import { createSocket } from './net/socket.js';
import { createPrediction } from './net/prediction.js';
import * as hud from './render/hud.js';
import * as menu from './ui/menu.js';
import * as pauseMenu from './ui/pauseMenu.js';
import { spawnBloodEffect } from './render/bloodEffect.js';
import { playFire, playReload } from './audio/sfx.js';
import { FIXED_DT, RESPAWN_DELAY_MS, MAGAZINE_SIZE, RESERVE_AMMO_SIZE, MIN_PLAYERS_TO_FORCE_START } from '../shared/constants.js';

const { scene, camera, renderer } = createScene();
buildArena(scene);
const { gun, muzzleFlash } = createViewModel(camera);

const controls = createControls(renderer.domElement);
const localPlayer = createLocalPlayer(camera, scene, undefined, gun, muzzleFlash);
const remotePlayers = createRemotePlayers(scene);
const remoteDummies = createRemoteDummies(scene);

let myTeam = null;
let myAlive = true;
let wasAlive = true;
let myAmmo = MAGAZINE_SIZE;
let myReserveAmmo = RESERVE_AMMO_SIZE;
let myReloading = false;
let wasReloading = false;
let matchPhase = 'waiting';
let deathOverlayTimer = null;
let myRoomCode = null;
let myHostId = null;
// True from the moment a private room's Lobby view is shown until the match
// actually goes live — gates the per-snapshot roster refresh and the
// Lobby -> "Hazır, tıkla" hand-off so neither runs during quickplay (which
// never shows a lobby at all) or once already past it.
let awaitingLiveTransition = false;

function startDeathCountdown() {
  let remainingMs = RESPAWN_DELAY_MS;
  hud.showOverlay('Öldün', `${Math.ceil(remainingMs / 1000)} saniye sonra yeniden doğuyorsun`);
  deathOverlayTimer = setInterval(() => {
    remainingMs -= 1000;
    hud.setOverlayMessage(
      remainingMs > 0 ? `${Math.ceil(remainingMs / 1000)} saniye sonra yeniden doğuyorsun` : 'Yeniden doğuyor...'
    );
  }, 1000);
}

function stopDeathCountdown() {
  if (deathOverlayTimer) {
    clearInterval(deathOverlayTimer);
    deathOverlayTimer = null;
    hud.hideOverlay();
  }
}

const socket = createSocket({
  onWelcome(msg) {
    myTeam = msg.team;
    myRoomCode = msg.code;
    myHostId = msg.hostId;
    localPlayer.snapTo({ position: msg.position, velocity: { x: 0, y: 0, z: 0 }, yaw: msg.yaw, onGround: false });
    hud.updateHealth(100, myTeam);
    hud.updateAmmo(myAmmo, myReserveAmmo, myReloading);

    if (msg.isPrivate) {
      // Roster isn't known yet from WELCOME alone — the very next snapshot
      // (within ~16ms at 60Hz) fills it in via the awaitingLiveTransition
      // branch below, so an empty-looking roster here is never visible.
      awaitingLiveTransition = true;
      menu.showLobby({ code: myRoomCode, players: [], myId: msg.playerId, hostId: myHostId, minPlayersToStart: MIN_PLAYERS_TO_FORCE_START });
    }
    // Public quickplay rooms skip the lobby entirely — the menu was already
    // hidden and pointer lock already requested synchronously on click.
  },

  onResumed(msg) {
    myTeam = msg.team;
    myRoomCode = msg.code;
    myHostId = msg.hostId;
    localPlayer.snapTo({ position: msg.position, velocity: { x: 0, y: 0, z: 0 }, yaw: msg.yaw, onGround: false });
    // Health/ammo/etc are corrected by the very next snapshot — pointer lock
    // can't be re-acquired from this async reply (no fresh user gesture), so
    // the pause menu's existing "Devam Et" button is reused to get it back.
    menu.hide();
    pauseMenu.show();
  },

  onResumeFailed() {
    menu.showHome();
  },

  onRoomError(msg) {
    menu.setError(msg.message);
  },

  onSnapshot(msg) {
    matchPhase = msg.phase;
    hud.updateScoreboard(msg.scores, msg.phase, msg.players.length);

    if (awaitingLiveTransition) {
      if (msg.phase === 'live') {
        awaitingLiveTransition = false;
        menu.showReady();
      } else {
        menu.showLobby({ code: myRoomCode, players: msg.players, myId: socket.getPlayerId(), hostId: myHostId, minPlayersToStart: MIN_PLAYERS_TO_FORCE_START });
      }
    }

    const myId = socket.getPlayerId();
    const me = msg.players.find((p) => p.id === myId);

    if (me) {
      myAlive = me.alive;
      myAmmo = me.ammo;
      myReserveAmmo = me.reserveAmmo;
      myReloading = me.reloading;
      hud.updateHealth(me.health, myTeam);
      hud.updateAmmo(myAmmo, myReserveAmmo, myReloading);

      // Single trigger point for the reload animation + sound — covers both
      // a manual R press and the server's own auto-reload-on-empty, so
      // there's no risk of double-triggering a manual reload.
      if (me.reloading && !wasReloading) {
        localPlayer.reload();
        playReload();
      }
      wasReloading = me.reloading;

      if (me.alive) {
        const justRespawned = !wasAlive;
        if (justRespawned) {
          localPlayer.snapTo({ position: me.position, velocity: me.velocity, yaw: me.yaw, onGround: me.onGround });
          stopDeathCountdown();
        } else {
          prediction.reconcile(me);
        }
      } else {
        localPlayer.snapTo({ position: me.position, velocity: me.velocity, yaw: me.yaw, onGround: me.onGround });
        if (!deathOverlayTimer) startDeathCountdown();
      }
      wasAlive = me.alive;
    }

    remotePlayers.ingestSnapshot(msg, myId);
    remoteDummies.ingestSnapshot(msg.dummies ?? [], msg.t);
  },

  onHit(msg) {
    spawnBloodEffect(scene, msg.position);
    if (msg.shooterId === socket.getPlayerId()) {
      hud.flashHitmarker();
      hud.flashHitmarkerX();
    }
  },

  onDummyHit(msg) {
    spawnBloodEffect(scene, msg.position);
    if (!msg.killed) remoteDummies.flashHit(msg.dummyId);
    if (msg.shooterId === socket.getPlayerId()) {
      hud.flashHitmarker();
      hud.flashHitmarkerX();
    }
  },

  onScoreUpdate(msg) {
    hud.updateScoreboard(msg.scores, msg.phase, msg.playerCount);
    if (msg.lastKill) {
      const myId = socket.getPlayerId();
      const shooterTeam = msg.lastKill.shooterId === myId ? myTeam : remotePlayers.getTeam(msg.lastKill.shooterId);
      const targetTeam = msg.lastKill.targetId === myId ? myTeam : remotePlayers.getTeam(msg.lastKill.targetId);
      hud.pushKillfeed(`Oyuncu ${msg.lastKill.shooterId} (${shooterTeam ?? '?'}) → Oyuncu ${msg.lastKill.targetId} (${targetTeam ?? '?'})`);
    }
  },

  onMatchEnd(msg) {
    stopDeathCountdown();
    const winnerText = msg.winner ? `Takım ${msg.winner} kazandı!` : 'Berabere!';
    hud.showOverlay('Maç Bitti', `${winnerText}  Skor: A ${msg.scores.A} — ${msg.scores.B} B`);
  },
});

const prediction = createPrediction(localPlayer, socket);

// Quickplay essentially never fails, so it engages pointer lock immediately
// (synchronously, from the click itself — see controls.js's requestEngage)
// and hides the menu right away, matching the game's original instant-join
// feel. Private-room create/join defer pointer lock until the final
// Lobby -> "Hazır, tıkla" step (see onWelcome/onSnapshot above) since they
// can fail (full room, bad code) and clickable buttons need a real cursor.
menu.onQuickplay(() => {
  socket.sendQuickplay();
  controls.requestEngage();
  menu.hide();
});

menu.onCreateRoom(() => {
  socket.sendCreateRoom();
});

menu.onJoinRoom((code) => {
  socket.sendJoinRoom(code);
});

menu.onCancelLobby(() => {
  socket.sendLeaveRoom();
  awaitingLiveTransition = false;
  menu.showHome();
});

menu.onStartMatch(() => {
  socket.sendStartMatch();
});

menu.onReady(() => {
  controls.requestEngage();
  menu.hide();
});

menu.showHome();

// FPS is measured from actual render-callback timing (not the fixed 60Hz
// simulation tick) and averaged over a short window — updated a few times a
// second, not every frame, so the HUD text itself doesn't add render cost.
const NETSTATS_UPDATE_MS = 300;
let fpsFrameCount = 0;
let fpsAccumMs = 0;
let lastFrameTime = performance.now();
let lastNetstatsUpdate = 0;

startLoop({
  fixedDt: FIXED_DT,
  update(dt) {
    const input = controls.getInput();
    // Movement and (cosmetic) firing are allowed during warm-up ('waiting')
    // too — only a fully 'ended' match (between rounds) freezes players.
    // Damage/scoring stays gated to 'live' server-side regardless of what
    // the client sends, so firing during warm-up is a harmless no-op there.
    // `inRoom` additionally covers the whole main-menu/lobby period before a
    // room even exists yet — playerId is only ever set once WELCOME/resume
    // actually assigns one, so there's nothing to predict/send before then.
    const inRoom = socket.getPlayerId() !== null;
    const canAct = inRoom && myAlive && matchPhase !== 'ended';
    const canMove = canAct;
    const canFire = canAct && myAmmo > 0 && !myReloading;

    if (canMove) {
      prediction.predictAndSend(input, dt);
    } else {
      localPlayer.syncCamera();
    }

    // Always drain consumeFire()'s queued flag, even when canFire is false —
    // otherwise a shot requested while out of ammo/mid-reload stays queued
    // and fires the instant ammo becomes available, regardless of whether
    // the button is still actually held.
    const wantsFire = controls.consumeFire();
    if (canFire && wantsFire) {
      const { direction } = localPlayer.fire();
      hud.pulseMuzzle();
      playFire();
      socket.sendFire({ x: direction.x, y: direction.y, z: direction.z }, Date.now());
    }

    // The reload animation + sound trigger from the snapshot's reloading
    // transition (see onSnapshot) instead of firing immediately here — a
    // single source of truth that also covers the server's auto-reload
    // (empty magazine) without double-triggering a manual press.
    if (canAct && controls.consumeReload()) {
      socket.sendReload();
    }
  },
  render() {
    remotePlayers.render();
    remoteDummies.render();
    renderer.render(scene, camera);

    const now = performance.now();
    fpsFrameCount++;
    fpsAccumMs += now - lastFrameTime;
    lastFrameTime = now;

    if (now - lastNetstatsUpdate >= NETSTATS_UPDATE_MS) {
      const fps = fpsAccumMs > 0 ? Math.round((fpsFrameCount * 1000) / fpsAccumMs) : 0;
      fpsFrameCount = 0;
      fpsAccumMs = 0;
      lastNetstatsUpdate = now;
      hud.updateNetStats(fps, socket.getPing(), socket.isOpen());
    }
  },
});
