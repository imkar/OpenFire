// Dev-only artificial-network-condition injector. socket.js routes every
// outgoing send and every incoming message dispatch through schedule() when
// this is wired in, so profiles apply symmetrically in both directions.
// Deterministic (seeded PRNG) so a bug caught under a given profile
// reproduces exactly on the next run with the same seed.
const PROFILES = {
  temiz: { delayMs: 0, jitterMs: 0, lossPct: 0, reorderPct: 0 },
  iyi: { delayMs: 40, jitterMs: 5, lossPct: 0.001, reorderPct: 0 },
  tipikMobil: { delayMs: 120, jitterMs: 30, lossPct: 0.01, reorderPct: 0.01 },
  kotu: { delayMs: 250, jitterMs: 80, lossPct: 0.05, reorderPct: 0.05 },
  felaket: { delayMs: 400, jitterMs: 150, lossPct: 0.1, reorderPct: 0.1 },
};

const PROFILE_ORDER = ['temiz', 'iyi', 'tipikMobil', 'kotu', 'felaket'];

// mulberry32 — small, fast, seedable PRNG (Math.random() has no seed hook).
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNetSim(seed = 1) {
  let profileName = 'temiz';
  let profile = PROFILES.temiz;
  const rand = mulberry32(seed);

  function setProfile(name) {
    if (!PROFILES[name]) return;
    profileName = name;
    profile = PROFILES[name];
  }

  function getProfile() {
    return profileName;
  }

  // Wraps a "deliver this payload now" callback with delay/jitter/loss/
  // reorder. Used identically for outgoing sends and incoming dispatch —
  // including every 60Hz snapshot, so the "temiz" (all-zero) profile MUST
  // stay a true synchronous passthrough. Routing even a zero-delay message
  // through setTimeout still queues a real timer; at 60/sec that backlog
  // compounds (browsers clamp nested timeouts to a ~4ms floor) and starves
  // the main thread, which paradoxically makes ping look worse than doing
  // nothing at all.
  function schedule(deliver) {
    if (profile.delayMs === 0 && profile.jitterMs === 0 && profile.lossPct === 0 && profile.reorderPct === 0) {
      deliver();
      return;
    }
    if (profile.lossPct > 0 && rand() < profile.lossPct) return; // dropped, never delivered

    const jitter = profile.jitterMs > 0 ? (rand() * 2 - 1) * profile.jitterMs : 0;
    const delay = Math.max(0, profile.delayMs + jitter);

    if (profile.reorderPct > 0 && rand() < profile.reorderPct) {
      // Hold this one back an extra beat so a normally-scheduled message sent
      // shortly after can overtake it — simplest way to get genuine
      // reordering without a full priority queue.
      setTimeout(deliver, delay + profile.delayMs + 20);
      return;
    }
    setTimeout(deliver, delay);
  }

  return { setProfile, getProfile, schedule, profiles: PROFILE_ORDER };
}
