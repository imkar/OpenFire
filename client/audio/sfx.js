// All sound effects are synthesized at runtime via the Web Audio API — no
// audio files, consistent with the rest of the project having zero external
// assets (procedural geometry, no downloaded models — this is the audio
// equivalent).

import { getSettings, onSettingsChange } from '../settings.js';

let ctx = null;
let masterGain = null;
let noiseBuffer = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = getSettings().volume;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  return ctx;
}

// The settings panel's volume slider fires 'input' events live, well before
// the AudioContext may even exist yet — masterGain is only set once
// getCtx() has run at least once (see unlockAudio()), guarded here.
onSettingsChange((s) => {
  if (masterGain) masterGain.gain.value = s.volume;
});

// Browsers block audio until a user gesture — call this synchronously from
// the same click handler that requests pointer lock so playback is unlocked
// before anything ever tries to play.
export function unlockAudio() {
  getCtx();
}

function getNoiseBuffer(context) {
  if (noiseBuffer) return noiseBuffer;
  const length = context.sampleRate; // 1s of white noise, reused/sliced by loop or stop()
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// Percussive noise "crack" + a low thump for body — classic synthesized
// gunshot without needing a sample.
export function playFire() {
  const context = getCtx();
  const now = context.currentTime;

  const noise = context.createBufferSource();
  noise.buffer = getNoiseBuffer(context);
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 1800;
  noiseFilter.Q.value = 0.7;
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.5, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.1);

  const osc = context.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);
  const oscGain = context.createGain();
  oscGain.gain.setValueAtTime(0.4, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  osc.connect(oscGain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.1);
}

// Quick upward pitch blip for a normal ground jump.
export function playJump() {
  const context = getCtx();
  const now = context.currentTime;
  const osc = context.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(560, now + 0.1);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.16);
}

// Bigger, energetic rising sweep + noise whoosh — used for the air jump
// (double/boost jump) and wall-kick, both of which should feel like a boost.
export function playThrust() {
  const context = getCtx();
  const now = context.currentTime;

  const osc = context.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(720, now + 0.22);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.32, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, now);
  osc.connect(filter).connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.3);

  const noise = context.createBufferSource();
  noise.buffer = getNoiseBuffer(context);
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1500;
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.15, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.26);
}

// Two mechanical clicks (magazine out, magazine in) scheduled up front in a
// single call — matches the reload dip animation's timing (see
// localPlayer.js's RELOAD_ constants): out near the start, in partway
// through, well before the full RELOAD_DURATION_MS.
export function playReload() {
  const context = getCtx();
  const now = context.currentTime;

  function click(time, freq) {
    const osc = context.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + 0.04);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.22, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain).connect(masterGain);
    osc.start(time);
    osc.stop(time + 0.06);

    const noise = context.createBufferSource();
    noise.buffer = getNoiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2200;
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.12, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    noise.connect(filter).connect(noiseGain).connect(masterGain);
    noise.start(time);
    noise.stop(time + 0.04);
  }

  click(now, 260); // magazine out
  click(now + 0.85, 320); // magazine in, slightly higher pitch
}

// Continuous filtered-noise "wind" loop for wall-running — faded in on
// start, faded out on stop, since it can last up to WALL_RUN_DURATION.
let rideNode = null;

export function startWallRide() {
  if (rideNode) return;
  const context = getCtx();
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.6;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, context.currentTime + 0.08);
  source.connect(filter).connect(gain).connect(masterGain);
  source.start();
  rideNode = { source, gain };
}

export function stopWallRide() {
  if (!rideNode) return;
  const context = getCtx();
  const { source, gain } = rideNode;
  gain.gain.cancelScheduledValues(context.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
  gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.1);
  source.stop(context.currentTime + 0.12);
  rideNode = null;
}
