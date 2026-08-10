import { MessageType, encode, decode } from '../../shared/protocol.js';
import { WS_PORT } from '../../shared/constants.js';

// Thin WebSocket wrapper: connects (with auto-reconnect), dispatches
// incoming messages by type, and exposes typed send helpers.
const PING_INTERVAL_MS = 1000;
const SESSION_STORAGE_KEY = 'openfire.session';

function loadStoredToken() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw).token ?? null;
  } catch {
    return null;
  }
}

function storeToken(token) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token }));
  } catch {
    // Private browsing / storage disabled — reconnect just won't auto-resume.
  }
}

function clearStoredToken() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function createSocket(handlers) {
  let ws = null;
  let playerId = null;
  let lastPingMs = null; // RTT of the most recent ping, or null before the first reply
  // True from the moment a RESUME is sent until its WELCOME/RESUME_FAILED
  // reply arrives — lets the WELCOME handler tell a resume apart from a
  // fresh room join (they share the same message shape/type on purpose).
  let awaitingResume = false;

  function connect() {
    const host = window.location.hostname || 'localhost';
    ws = new WebSocket(`ws://${host}:${WS_PORT}`);

    ws.addEventListener('open', () => {
      console.log('[net] connected');
      const storedToken = loadStoredToken();
      if (storedToken) {
        awaitingResume = true;
        ws.send(encode({ type: MessageType.RESUME, sessionToken: storedToken }));
      }
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
        case MessageType.WELCOME: {
          playerId = msg.playerId;
          storeToken(msg.sessionToken);
          if (awaitingResume) {
            awaitingResume = false;
            handlers.onResumed?.(msg);
          } else {
            handlers.onWelcome?.(msg);
          }
          break;
        }
        case MessageType.RESUME_FAILED:
          awaitingResume = false;
          clearStoredToken();
          handlers.onResumeFailed?.();
          break;
        case MessageType.ROOM_ERROR:
          handlers.onRoomError?.(msg);
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

  function sendIfOpen(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(encode(message));
    }
  }

  return {
    getPlayerId: () => playerId,
    isOpen: () => ws !== null && ws.readyState === WebSocket.OPEN,
    getPing: () => lastPingMs,
    sendInput(seq, input) {
      sendIfOpen({ type: MessageType.INPUT, seq, input });
    },
    sendFire(direction, timestamp) {
      sendIfOpen({ type: MessageType.FIRE, direction, timestamp });
    },
    sendReload() {
      sendIfOpen({ type: MessageType.RELOAD });
    },
    sendQuickplay() {
      sendIfOpen({ type: MessageType.QUICKPLAY });
    },
    sendCreateRoom() {
      sendIfOpen({ type: MessageType.CREATE_ROOM });
    },
    sendJoinRoom(code) {
      sendIfOpen({ type: MessageType.JOIN_ROOM, code });
    },
    sendLeaveRoom() {
      clearStoredToken(); // a deliberate lobby exit shouldn't auto-resume back into the room
      sendIfOpen({ type: MessageType.LEAVE_ROOM });
    },
    sendStartMatch() {
      sendIfOpen({ type: MessageType.START_MATCH });
    },
  };
}
