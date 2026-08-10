import { MessageType, encode, decode } from '../../shared/protocol.js';
import { WS_PORT } from '../../shared/constants.js';

// Thin WebSocket wrapper: connects (with auto-reconnect), dispatches
// incoming messages by type, and exposes typed send helpers.
const PING_INTERVAL_MS = 1000;

export function createSocket(handlers) {
  let ws = null;
  let playerId = null;
  let lastPingMs = null; // RTT of the most recent ping, or null before the first reply

  function connect() {
    const host = window.location.hostname || 'localhost';
    ws = new WebSocket(`ws://${host}:${WS_PORT}`);

    ws.addEventListener('open', () => {
      console.log('[net] connected');
    });

    ws.addEventListener('close', () => {
      console.log('[net] disconnected, retrying in 1s');
      setTimeout(connect, 1000);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });

    ws.addEventListener('message', (event) => {
      const msg = decode(event.data);
      if (!msg) return;

      switch (msg.type) {
        case MessageType.WELCOME:
          playerId = msg.playerId;
          handlers.onWelcome?.(msg);
          break;
        case MessageType.SNAPSHOT:
          handlers.onSnapshot?.(msg);
          break;
        case MessageType.HIT:
          handlers.onHit?.(msg);
          break;
        case MessageType.DUMMY_HIT:
          handlers.onDummyHit?.(msg);
          break;
        case MessageType.RESPAWN:
          handlers.onRespawn?.(msg);
          break;
        case MessageType.SCORE_UPDATE:
          handlers.onScoreUpdate?.(msg);
          break;
        case MessageType.MATCH_END:
          handlers.onMatchEnd?.(msg);
          break;
        case MessageType.PONG:
          lastPingMs = performance.now() - msg.t;
          break;
        default:
          break;
      }
    });
  }

  connect();

  // Started once (not inside connect()) so reconnects never spawn a second
  // overlapping interval — the send itself is a no-op while disconnected.
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(encode({ type: MessageType.PING, t: performance.now() }));
    }
  }, PING_INTERVAL_MS);

  return {
    getPlayerId: () => playerId,
    isOpen: () => ws !== null && ws.readyState === WebSocket.OPEN,
    getPing: () => lastPingMs,
    sendInput(seq, input) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encode({ type: MessageType.INPUT, seq, input }));
      }
    },
    sendFire(direction, timestamp) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encode({ type: MessageType.FIRE, direction, timestamp }));
      }
    },
    sendReload() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encode({ type: MessageType.RELOAD }));
      }
    },
  };
}
