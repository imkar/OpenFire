// Small persisted settings store (mouse sensitivity, master volume, invert Y)
// backing the pause menu's Settings panel. Plain localStorage + a listener
// set — no external state library needed for three values.
const STORAGE_KEY = 'openfire.settings.v1';

const defaults = {
  sensitivity: 1.0, // multiplier applied on top of the base mouse sensitivity
  volume: 0.8, // 0..1 master gain for all synthesized sfx
  invertY: false,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

let current = load();
const listeners = new Set();

export function getSettings() {
  return current;
}

export function setSetting(key, value) {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private browsing / storage disabled — settings just won't persist across reloads.
  }
  for (const fn of listeners) fn(current);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
