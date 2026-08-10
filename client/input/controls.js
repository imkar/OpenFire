import { ADS_SENSITIVITY_SCALE, WEAPON_FIRE_RATE } from '../../shared/constants.js';
import { unlockAudio } from '../audio/sfx.js';
import { getSettings } from '../settings.js';
import * as pauseMenu from '../ui/pauseMenu.js';

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const FIRE_INTERVAL_MS = 1000 / WEAPON_FIRE_RATE;

export function createControls(domElement) {
  const keys = {
    forward: false, backward: false, left: false, right: false,
    jump: false, sprint: false, leanLeft: false, leanRight: false, reload: false,
  };
  let yaw = 0;
  let pitch = 0;
  let fireRequested = false;
  let firing = false; // left button held down — full-auto while true
  let lastAutoFireAt = 0;
  let jumpQueued = false;
  let reloadQueued = false;
  let aiming = false;
  // True once pointer lock has been acquired at least once — distinguishes
  // "never joined yet" (losing lock re-shows the join overlay) from
  // "was playing, Escape was pressed" (losing lock opens the pause menu).
  let hasEngaged = false;

  const overlay = document.getElementById('overlay');

  // The overlay sits visually on top of the canvas (z-index) while visible,
  // so a click there never reaches domElement's own listener — listen on
  // document instead so both the overlay and the bare canvas trigger lock.
  document.addEventListener('click', () => {
    if (pauseMenu.isOpen()) return; // the menu's own buttons handle their clicks
    unlockAudio(); // must happen synchronously inside a user-gesture handler
    if (document.pointerLockElement !== domElement) {
      domElement.requestPointerLock();
    }
  });

  pauseMenu.onResume(() => {
    unlockAudio();
    domElement.requestPointerLock();
  });

  // Releases every held key/button — called whenever pointer lock is lost so
  // nothing stays "on" while the pause menu is up (otherwise a key still
  // physically held at the moment Escape is pressed would keep driving
  // movement/fire behind the menu, invisibly, since mouse-look is frozen).
  function releaseAllInputs() {
    keys.forward = keys.backward = keys.left = keys.right = false;
    keys.jump = keys.sprint = keys.leanLeft = keys.leanRight = keys.reload = false;
    jumpQueued = false;
    reloadQueued = false;
    fireRequested = false;
    firing = false;
    aiming = false;
  }

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === domElement;
    if (locked) {
      hasEngaged = true;
      pauseMenu.hide();
      if (overlay) overlay.classList.add('hidden');
    } else {
      releaseAllInputs();
      if (!hasEngaged) {
        if (overlay) overlay.classList.remove('hidden');
      } else if (overlay && overlay.classList.contains('hidden')) {
        // Mid-game Escape, no death/match-end message currently on screen.
        pauseMenu.show();
      }
      // Otherwise a death/match-end message is already showing on #overlay —
      // leave it alone, the existing click-anywhere-to-continue still works.
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== domElement) return;
    const { sensitivity: sensMultiplier, invertY } = getSettings();
    const sensitivity =
      (aiming ? MOUSE_SENSITIVITY * ADS_SENSITIVITY_SCALE : MOUSE_SENSITIVITY) * sensMultiplier;
    yaw -= e.movementX * sensitivity;
    pitch -= e.movementY * sensitivity * (invertY ? -1 : 1);
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  });

  document.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== domElement) return;
    if (e.button === 0) {
      firing = true;
      fireRequested = true; // fire immediately on the initial press too
      lastAutoFireAt = performance.now();
    }
    if (e.button === 2) aiming = true;
  });

  // Both buttons are held-to-act, not edge-triggered — release regardless of
  // pointer-lock state so nothing gets stuck "on" if lock is lost mid-hold
  // (e.g. pressing Escape while a button is still down).
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });

  // Suppress the browser's right-click context menu — it's the aim button now.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  function setKey(code, value) {
    switch (code) {
      case 'KeyW': keys.forward = value; break;
      case 'KeyS': keys.backward = value; break;
      case 'KeyA': keys.left = value; break;
      case 'KeyD': keys.right = value; break;
      case 'Space':
        // Edge-triggered: only the transition from released to pressed
        // queues a jump — guards against OS key-repeat and lets
        // ground/air/wall jumps each consume exactly one discrete press.
        if (value && !keys.jump) jumpQueued = true;
        keys.jump = value;
        break;
      case 'ShiftLeft': keys.sprint = value; break;
      case 'KeyQ': keys.leanLeft = value; break;
      case 'KeyE': keys.leanRight = value; break;
      case 'KeyR':
        // Edge-triggered, same guard style as Space's jump — one request
        // per real press, immune to OS key-repeat while held.
        if (value && !keys.reload) reloadQueued = true;
        keys.reload = value;
        break;
      default: break;
    }
  }

  // Gated on pointer lock so a key still physically held (and OS-repeating)
  // when Escape opens the pause menu can't keep feeding movement/actions.
  window.addEventListener('keydown', (e) => {
    if (document.pointerLockElement !== domElement) return;
    setKey(e.code, true);
  });
  window.addEventListener('keyup', (e) => {
    if (document.pointerLockElement !== domElement) return;
    setKey(e.code, false);
  });

  return {
    getInput() {
      // Full-auto: while the left button is held, re-request a shot at the
      // weapon's own fire rate — consumeFire()'s existing edge-consumption
      // below is untouched, this just keeps refilling it while held.
      if (firing) {
        const now = performance.now();
        if (now - lastAutoFireAt >= FIRE_INTERVAL_MS) {
          fireRequested = true;
          lastAutoFireAt = now;
        }
      }

      const jumpPressed = jumpQueued;
      jumpQueued = false;
      return {
        forward: keys.forward,
        backward: keys.backward,
        left: keys.left,
        right: keys.right,
        jumpPressed,
        sprint: keys.sprint,
        aiming,
        leanLeft: keys.leanLeft,
        leanRight: keys.leanRight,
        yaw,
        pitch,
      };
    },
    consumeFire() {
      if (fireRequested) {
        fireRequested = false;
        return true;
      }
      return false;
    },
    consumeReload() {
      if (reloadQueued) {
        reloadQueued = false;
        return true;
      }
      return false;
    },
    isLocked() {
      return document.pointerLockElement === domElement;
    },
  };
}
