const menuEl = document.getElementById('main-menu');
const viewHome = document.getElementById('menu-view-home');
const viewLobby = document.getElementById('menu-view-lobby');
const viewReady = document.getElementById('menu-view-ready');

const quickplayBtn = document.getElementById('menu-quickplay-btn');
const createRoomBtn = document.getElementById('menu-create-room-btn');
const joinCodeInput = document.getElementById('menu-join-code-input');
const joinRoomBtn = document.getElementById('menu-join-room-btn');
const errorEl = document.getElementById('menu-error');

const lobbyCodeEl = document.getElementById('lobby-code');
const lobbyRosterEl = document.getElementById('lobby-roster');
const lobbyStartBtn = document.getElementById('lobby-start-btn');
const lobbyCancelBtn = document.getElementById('lobby-cancel-btn');

const readyBtn = document.getElementById('menu-ready-btn');

function setView(view) {
  viewHome.classList.toggle('hidden', view !== 'home');
  viewLobby.classList.toggle('hidden', view !== 'lobby');
  viewReady.classList.toggle('hidden', view !== 'ready');
}

quickplayBtn.addEventListener('click', () => {
  setError('');
  quickplayHandler?.();
});

createRoomBtn.addEventListener('click', () => {
  setError('');
  createRoomHandler?.();
});

joinRoomBtn.addEventListener('click', () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code) return;
  setError('');
  joinRoomHandler?.(code);
});

// Enter in the code field acts like clicking "Katıl".
joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoomBtn.click();
});

lobbyCancelBtn.addEventListener('click', () => {
  cancelLobbyHandler?.();
});

lobbyStartBtn.addEventListener('click', () => {
  startMatchHandler?.();
});

readyBtn.addEventListener('click', () => {
  readyHandler?.(); // MUST synchronously request pointer lock — see controls.js's requestEngage()
});

let quickplayHandler = null;
let createRoomHandler = null;
let joinRoomHandler = null;
let cancelLobbyHandler = null;
let startMatchHandler = null;
let readyHandler = null;

export function onQuickplay(fn) { quickplayHandler = fn; }
export function onCreateRoom(fn) { createRoomHandler = fn; }
export function onJoinRoom(fn) { joinRoomHandler = fn; }
export function onCancelLobby(fn) { cancelLobbyHandler = fn; }
export function onStartMatch(fn) { startMatchHandler = fn; }
export function onReady(fn) { readyHandler = fn; }

export function showHome() {
  menuEl.classList.remove('hidden');
  setView('home');
}

export function showLobby({ code, players, myId, hostId, minPlayersToStart }) {
  menuEl.classList.remove('hidden');
  setView('lobby');
  lobbyCodeEl.textContent = code;

  let countA = 0;
  let countB = 0;
  for (const p of players) {
    if (p.team === 'A') countA++;
    else countB++;
  }
  lobbyRosterEl.textContent = `Takım A: ${countA} — Takım B: ${countB}  (${players.length}/4 oyuncu)`;

  const amHost = myId === hostId;
  lobbyStartBtn.classList.toggle('hidden', !(amHost && players.length >= minPlayersToStart));
}

export function showReady() {
  menuEl.classList.remove('hidden');
  setView('ready');
}

export function hide() {
  menuEl.classList.add('hidden');
}

export function isLobbyVisible() {
  return !menuEl.classList.contains('hidden') && !viewLobby.classList.contains('hidden');
}

export function setError(message) {
  errorEl.textContent = message ?? '';
}
