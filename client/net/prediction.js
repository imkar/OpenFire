const PENDING_INPUT_LIMIT = 180; // ~3s at 60Hz, generous safety cap

// Orchestrates client-side prediction + server reconciliation for the local
// player: assigns sequence numbers, sends inputs, buffers them until the
// server acknowledges, and replays unacknowledged inputs on top of each
// authoritative snapshot.
export function createPrediction(localPlayer, socket) {
  let seq = 0;
  const pendingInputs = []; // { seq, input, dt }

  function predictAndSend(input, dt) {
    seq += 1;
    localPlayer.update(input, dt);
    pendingInputs.push({ seq, input, dt });
    if (pendingInputs.length > PENDING_INPUT_LIMIT) pendingInputs.shift();
    socket.sendInput(seq, input);
  }

  function reconcile(serverPlayerState) {
    while (pendingInputs.length > 0 && pendingInputs[0].seq <= serverPlayerState.lastProcessedSeq) {
      pendingInputs.shift();
    }

    localPlayer.reconcileWithServer(
      {
        position: serverPlayerState.position,
        velocity: serverPlayerState.velocity,
        yaw: serverPlayerState.yaw,
        onGround: serverPlayerState.onGround,
        lean: serverPlayerState.lean,
        airJumpsUsed: serverPlayerState.airJumpsUsed,
        airFloatTimeLeft: serverPlayerState.airFloatTimeLeft,
        wallRun: serverPlayerState.wallRun,
      },
      pendingInputs
    );
  }

  return { predictAndSend, reconcile };
}
