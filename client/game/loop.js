const MAX_FRAME_DELTA = 0.25; // clamp spikes from tab-switch/stalls

// requestAnimationFrame render loop with a fixed-timestep accumulator for
// simulation/logic, decoupled from render rate.
export function startLoop({ update, render, fixedDt }) {
  let last = performance.now();
  let accumulator = 0;

  function frame(now) {
    let delta = (now - last) / 1000;
    last = now;
    if (delta > MAX_FRAME_DELTA) delta = MAX_FRAME_DELTA;
    accumulator += delta;

    while (accumulator >= fixedDt) {
      update(fixedDt);
      accumulator -= fixedDt;
    }

    render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
