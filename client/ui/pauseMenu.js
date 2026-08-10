import { getSettings, setSetting } from '../settings.js';

const menuEl = document.getElementById('pause-menu');
const mainView = document.getElementById('pause-view-main');
const settingsView = document.getElementById('pause-view-settings');
const resumeBtn = document.getElementById('pause-resume-btn');
const settingsBtn = document.getElementById('pause-settings-btn');
const backBtn = document.getElementById('pause-back-btn');

const sensitivityInput = document.getElementById('setting-sensitivity');
const sensitivityValue = document.getElementById('setting-sensitivity-value');
const volumeInput = document.getElementById('setting-volume');
const volumeValue = document.getElementById('setting-volume-value');
const invertYInput = document.getElementById('setting-invert-y');

function refreshInputs() {
  const s = getSettings();
  sensitivityInput.value = s.sensitivity;
  sensitivityValue.textContent = s.sensitivity.toFixed(2);
  volumeInput.value = s.volume;
  volumeValue.textContent = `${Math.round(s.volume * 100)}%`;
  invertYInput.checked = s.invertY;
}

sensitivityInput.addEventListener('input', () => {
  const v = parseFloat(sensitivityInput.value);
  setSetting('sensitivity', v);
  sensitivityValue.textContent = v.toFixed(2);
});

volumeInput.addEventListener('input', () => {
  const v = parseFloat(volumeInput.value);
  setSetting('volume', v);
  volumeValue.textContent = `${Math.round(v * 100)}%`;
});

invertYInput.addEventListener('change', () => {
  setSetting('invertY', invertYInput.checked);
});

settingsBtn.addEventListener('click', () => {
  mainView.classList.add('hidden');
  settingsView.classList.remove('hidden');
});

backBtn.addEventListener('click', () => {
  settingsView.classList.add('hidden');
  mainView.classList.remove('hidden');
});

let resumeHandler = null;
resumeBtn.addEventListener('click', () => {
  if (resumeHandler) resumeHandler();
});

export function onResume(fn) {
  resumeHandler = fn;
}

export function show() {
  refreshInputs();
  mainView.classList.remove('hidden');
  settingsView.classList.add('hidden');
  menuEl.classList.remove('hidden');
}

export function hide() {
  menuEl.classList.add('hidden');
}

export function isOpen() {
  return !menuEl.classList.contains('hidden');
}
