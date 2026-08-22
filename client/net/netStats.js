const RTT_WINDOW_MS = 10000; // time-windowed, not count-windowed — a count cap would let stale samples from a since-changed netSim profile linger for tens of seconds before a low-traffic period (e.g. dev-only PING at 1/sec) displaces them, making profile switches look laggy to react
const HISTORY_SECONDS = 60;

function pruneOlderThan(samples, now, windowMs) {
  while (samples.length > 0 && now - samples[0].t > windowMs) samples.shift();
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

// Dev-only network/perf telemetry aggregator feeding the expanded debug HUD
// and its CSV export. Nothing here talks to the network itself — callers
// (socket.js, prediction.js) push samples in as they happen; tick() rolls
// them into per-second stats once a second.
export function createNetStats() {
  const rttSamples = [];
  const reconcileMagnitudes = [];
  let reconcileCount = 0;
  let bytesInAccum = 0;
  let bytesOutAccum = 0;
  let lastSnapshotAt = null;
  let lastSnapshotIntervalMs = null;
  const history = [];

  function recordRtt(ms) {
    rttSamples.push({ t: Date.now(), ms });
  }

  function recordBytesIn(n) {
    bytesInAccum += n;
  }

  function recordBytesOut(n) {
    bytesOutAccum += n;
  }

  function recordSnapshot(now) {
    if (lastSnapshotAt !== null) lastSnapshotIntervalMs = now - lastSnapshotAt;
    lastSnapshotAt = now;
  }

  function recordReconcile(magnitudeMeters) {
    reconcileCount += 1;
    reconcileMagnitudes.push(magnitudeMeters);
  }

  // Called once a second: rolls the byte accumulators into a per-second
  // rate, computes RTT percentiles/jitter over the trailing RTT_WINDOW_MS,
  // and appends one history sample.
  function tick() {
    const bytesInPerSec = bytesInAccum;
    const bytesOutPerSec = bytesOutAccum;
    bytesInAccum = 0;
    bytesOutAccum = 0;

    const now = Date.now();
    pruneOlderThan(rttSamples, now, RTT_WINDOW_MS);
    const values = rttSamples.map((s) => s.ms);
    const sorted = [...values].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const jitter =
      values.length > 1
        ? Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)
        : null;
    const reconcileAvgMag = reconcileMagnitudes.length
      ? reconcileMagnitudes.reduce((a, b) => a + b, 0) / reconcileMagnitudes.length
      : null;

    const sample = {
      t: Date.now(),
      p50,
      p95,
      jitter,
      reconcileCount,
      reconcileAvgMag,
      bytesInPerSec,
      bytesOutPerSec,
      snapshotIntervalMs: lastSnapshotIntervalMs,
    };
    history.push(sample);
    if (history.length > HISTORY_SECONDS) history.shift();
    reconcileCount = 0;
    reconcileMagnitudes.length = 0;

    return sample;
  }

  function exportCsv() {
    const cols = [
      't', 'p50', 'p95', 'jitter', 'reconcileCount', 'reconcileAvgMag', 'bytesInPerSec', 'bytesOutPerSec', 'snapshotIntervalMs',
    ];
    const rows = history.map((h) => cols.map((c) => h[c] ?? '').join(','));
    return [cols.join(','), ...rows].join('\n');
  }

  return { recordRtt, recordBytesIn, recordBytesOut, recordSnapshot, recordReconcile, tick, exportCsv };
}
