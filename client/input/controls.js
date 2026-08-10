import { ADS_SENSITIVITY_SCALE, WEAPON_FIRE_RATE } from '../../shared/constants.js';
import { unlockAudio } from '../audio/sfx.js';

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

  const overlay = document.getElementById('overlay');

  // The overlay sits visually on top of the canvas (z-index) while visible,
  // so a click there never reaches domElement's own listener — listen on
  // document instead so both the overlay and the bare canvas trigger lock.
  document.addEventListener('click', () => {
    unlockAudio(); // must happen synchronously inside a user-gesture handler
    if (document.pointerLockElement !== domElement) {
      domElement.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === domElement;
    if (overlay) overlay.classList.toggle('hidden', locked);
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== domElement) return;
    const sensitivity = aiming ? MOUSE_SENSITIVITY * ADS_SENSITIVITY_SCALE : MOUSE_SENSITIVITY;
    yaw -= e.movementX * sensitivity;
    pitch -= e.movementY * sensitivity;
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

  window.addEventListener('keydown', (e) => setKey(e.code, true));
  window.addEventListener('keyup', (e) => setKey(e.code, false));

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
