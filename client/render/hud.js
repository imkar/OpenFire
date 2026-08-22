const hudEl = document.getElementById('hud');
const scoreboardEl = document.getElementById('scoreboard');
const killfeedEl = document.getElementById('killfeed');
const overlayEl = document.getElementById('overlay');
const overlayTitleEl = document.getElementById('overlay-title');
const overlayMessageEl = document.getElementById('overlay-message');
const crosshairEl = document.getElementById('crosshair');
const hitmarkerXEl = document.getElementById('hitmarker-x');
const ammoEl = document.getElementById('ammo');
const netstatsEl = document.getElementById('netstats');
const netstatsDebugEl = document.getElementById('netstats-debug');

const KILLFEED_MAX = 5;
const KILLFEED_TTL_MS = 5000;
const killfeedEntries = [];

export function updateHealth(health, team) {
  hudEl.textContent = `Can: ${Math.max(0, Math.round(health))}   Takım: ${team ?? '-'}`;
}

export function updateNetStats(fps, pingMs, connected) {
  const fpsClass = fps < 30 ? 'bad' : fps < 50 ? 'ok' : '';
  const pingText = pingMs === null ? '…' : `${Math.round(pingMs)}ms`;
  const pingClass = pingMs === null ? '' : pingMs > 150 ? 'bad' : pingMs > 80 ? 'ok' : '';
  const connText = connected ? 'Bağlı' : 'Bağlantı kesildi';
  const connClass = connected ? '' : 'bad';
  netstatsEl.innerHTML =
    `<span class="${fpsClass}">${fps} FPS</span><br/>` +
    `<span class="${pingClass}">Ping: ${pingText}</span><br/>` +
    `<span class="${connClass}">${connText}</span>`;
}

// Dev-only expanded debug panel (F3 to toggle, see main.js) — jitter,
// packet loss surrogate, reconciliation error, bandwidth, snapshot cadence,
// none of which fit in the always-on #netstats corner without cluttering it
// for regular players.
let debugVisible = false;

export function setDebugStatsVisible(visible) {
  debugVisible = visible;
  netstatsDebugEl?.classList.toggle('hidden', !visible);
}

export function toggleDebugStats() {
  setDebugStatsVisible(!debugVisible);
  return debugVisible;
}

export function isDebugStatsVisible() {
  return debugVisible;
}

const fmt = (v, unit = '', digits = 0) => (v === null || v === undefined ? '…' : `${v.toFixed(digits)}${unit}`);

export function updateDebugStats(stats) {
  if (!netstatsDebugEl || !debugVisible) return;
  netstatsDebugEl.innerHTML = [
    `RTT p50/p95: ${fmt(stats.p50, 'ms')} / ${fmt(stats.p95, 'ms')}`,
    `Jitter: ${fmt(stats.jitter, 'ms')}`,
    `Snapshot aralığı: ${fmt(stats.snapshotIntervalMs, 'ms')}`,
    `Mutabakat: ${stats.reconcileCount ?? 0}/s, ort. ${fmt(stats.reconcileAvgMag, 'm', 2)}`,
    `Bant: ↓${fmt(stats.bytesInPerSec / 1000, 'KB/s', 1)} ↑${fmt(stats.bytesOutPerSec / 1000, 'KB/s', 1)}`,
    `Ağ profili: ${stats.netProfile ?? 'temiz'}`,
    `[F3 kapat · 1-5 profil · C CSV indir]`,
  ].join('<br/>');
}

export function updateAmmo(ammo, reserveAmmo, reloading) {
  ammoEl.textContent = reloading
    ? 'Şarjör değiştiriliyor…'
    : `${Math.max(0, ammo)} / ${Math.max(0, reserveAmmo)}`;
  ammoEl.classList.toggle('reloading', reloading);
}

export function updateScoreboard(scores, phase, playerCount) {
  const a = scores?.A ?? 0;
  const b = scores?.B ?? 0;
  let status = '';
  if (phase === 'waiting') status = ` — ${playerCount}/4 oyuncu bekleniyor`;
  scoreboardEl.textContent = `Takım A ${a} — ${b} Takım B${status}`;
}

export function pushKillfeed(text) {
  killfeedEntries.push({ text, expiresAt: Date.now() + KILLFEED_TTL_MS });
  while (killfeedEntries.length > KILLFEED_MAX) killfeedEntries.shift();
  renderKillfeed();
  setTimeout(renderKillfeed, KILLFEED_TTL_MS + 50);
}

function renderKillfeed() {
  const now = Date.now();
  while (killfeedEntries.length && killfeedEntries[0].expiresAt < now) killfeedEntries.shift();
  killfeedEl.innerHTML = killfeedEntries.map((e) => e.text).join('<br/>');
}

// Fired on every trigger pull, independent of whether the shot hit anything
// or the server has confirmed a hit yet — guarantees the player always sees
// unambiguous feedback that a shot actually went out.
export function pulseMuzzle() {
  crosshairEl.style.transform = 'scale(1.8)';
  setTimeout(() => {
    crosshairEl.style.transform = 'scale(1)';
  }, 90);
}

export function flashHitmarker() {
  crosshairEl.style.setProperty('--reticle-color', '#ff4d4d');
  setTimeout(() => {
    crosshairEl.style.setProperty('--reticle-color', 'rgba(255, 255, 255, 0.9)');
  }, 120);
}

// Classic CoD-style "X" flash on any confirmed hit (real player or practice
// dummy) — layered on top of the color-pulse above for a richer confirm.
let hitmarkerXTimeout = null;
export function flashHitmarkerX() {
  hitmarkerXEl.classList.add('show');
  clearTimeout(hitmarkerXTimeout);
  hitmarkerXTimeout = setTimeout(() => hitmarkerXEl.classList.remove('show'), 140);
}

export function showOverlay(title, message) {
  overlayTitleEl.textContent = title;
  overlayMessageEl.textContent = message;
  overlayEl.classList.remove('hidden');
}

export function hideOverlay() {
  overlayEl.classList.add('hidden');
}

export function setOverlayMessage(message) {
  overlayMessageEl.textContent = message;
}
