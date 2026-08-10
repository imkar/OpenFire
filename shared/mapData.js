// Single source of truth for the arena: used by client (render + collision),
// and by the server (authoritative collision + spawn logic).
// A walled 80x80 yard with varied cover — crates, long low barriers, tall
// thin pillars (wall-runnable), and big container structures — instead of
// just one repeated box shape.

const HALF = 40; // arena half-size (80x80)
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 0.5;

export const colliders = [
  // floor (top surface at y = 0)
  { type: 'floor', pos: { x: 0, y: -0.1, z: 0 }, halfExtents: { x: HALF, y: 0.1, z: HALF } },

  // outer walls — wall-runnable
  { type: 'wall', wallRunnable: true, pos: { x: 0, y: WALL_HEIGHT / 2, z: -HALF - WALL_THICKNESS / 2 }, halfExtents: { x: HALF + WALL_THICKNESS, y: WALL_HEIGHT / 2, z: WALL_THICKNESS / 2 } },
  { type: 'wall', wallRunnable: true, pos: { x: 0, y: WALL_HEIGHT / 2, z: HALF + WALL_THICKNESS / 2 }, halfExtents: { x: HALF + WALL_THICKNESS, y: WALL_HEIGHT / 2, z: WALL_THICKNESS / 2 } },
  { type: 'wall', wallRunnable: true, pos: { x: -HALF - WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: 0 }, halfExtents: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: HALF } },
  { type: 'wall', wallRunnable: true, pos: { x: HALF + WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: 0 }, halfExtents: { x: WALL_THICKNESS / 2, y: WALL_HEIGHT / 2, z: HALF } },

  // crates — low + tall variants, plain blocking geometry
  { type: 'crate', pos: { x: -14, y: 0.75, z: -8 }, halfExtents: { x: 1, y: 0.75, z: 1 } },
  { type: 'crate', pos: { x: 14, y: 0.75, z: 8 }, halfExtents: { x: 1, y: 0.75, z: 1 } },
  { type: 'crate', pos: { x: 0, y: 0.75, z: -12 }, halfExtents: { x: 1, y: 0.75, z: 1 } },
  { type: 'crate', pos: { x: 0, y: 0.75, z: 12 }, halfExtents: { x: 1, y: 0.75, z: 1 } },
  { type: 'crate', pos: { x: -9, y: 0.75, z: 3 }, halfExtents: { x: 1, y: 0.75, z: 1 } },
  { type: 'crate', pos: { x: 9, y: 0.75, z: -3 }, halfExtents: { x: 1, y: 0.75, z: 1 } },
  { type: 'crate', pos: { x: -22, y: 1.5, z: 20 }, halfExtents: { x: 1, y: 1.5, z: 1 } },
  { type: 'crate', pos: { x: 22, y: 1.5, z: -20 }, halfExtents: { x: 1, y: 1.5, z: 1 } },

  // barriers — long low walls for directional cover along lanes
  { type: 'barrier', pos: { x: -20, y: 0.6, z: -6 }, halfExtents: { x: 3, y: 0.6, z: 0.3 } },
  { type: 'barrier', pos: { x: 20, y: 0.6, z: 6 }, halfExtents: { x: 3, y: 0.6, z: 0.3 } },
  { type: 'barrier', pos: { x: 6, y: 0.6, z: -22 }, halfExtents: { x: 0.3, y: 0.6, z: 3 } },
  { type: 'barrier', pos: { x: -6, y: 0.6, z: 22 }, halfExtents: { x: 0.3, y: 0.6, z: 3 } },
  { type: 'barrier', pos: { x: -30, y: 0.6, z: 12 }, halfExtents: { x: 3, y: 0.6, z: 0.3 } },
  { type: 'barrier', pos: { x: 30, y: 0.6, z: -12 }, halfExtents: { x: 3, y: 0.6, z: 0.3 } },
  { type: 'barrier', pos: { x: 12, y: 0.6, z: 30 }, halfExtents: { x: 0.3, y: 0.6, z: 3 } },
  { type: 'barrier', pos: { x: -12, y: 0.6, z: -30 }, halfExtents: { x: 0.3, y: 0.6, z: 3 } },

  // pillars — thin tall columns, also wall-runnable for extra parkour lines
  { type: 'pillar', wallRunnable: true, pos: { x: -16, y: 3, z: 16 }, halfExtents: { x: 0.4, y: 3, z: 0.4 } },
  { type: 'pillar', wallRunnable: true, pos: { x: 16, y: 3, z: -16 }, halfExtents: { x: 0.4, y: 3, z: 0.4 } },
  { type: 'pillar', wallRunnable: true, pos: { x: -27, y: 3, z: 0 }, halfExtents: { x: 0.4, y: 3, z: 0.4 } },
  { type: 'pillar', wallRunnable: true, pos: { x: 27, y: 3, z: 0 }, halfExtents: { x: 0.4, y: 3, z: 0.4 } },
  { type: 'pillar', wallRunnable: true, pos: { x: 0, y: 3, z: 27 }, halfExtents: { x: 0.4, y: 3, z: 0.4 } },
  { type: 'pillar', wallRunnable: true, pos: { x: 0, y: 3, z: -27 }, halfExtents: { x: 0.4, y: 3, z: 0.4 } },

  // containers — big structures for heavy cover
  { type: 'container', pos: { x: -31, y: 1.5, z: -21 }, halfExtents: { x: 1.25, y: 1.5, z: 3 } },
  { type: 'container', pos: { x: 31, y: 1.5, z: 21 }, halfExtents: { x: 1.25, y: 1.5, z: 3 } },
  { type: 'container', pos: { x: -21, y: 1.5, z: 31 }, halfExtents: { x: 3, y: 1.5, z: 1.25 } },
  { type: 'container', pos: { x: 21, y: 1.5, z: -31 }, halfExtents: { x: 3, y: 1.5, z: 1.25 } },
];

export const spawnPoints = {
  A: [
    { x: -34, y: 0, z: -34, yaw: Math.PI / 4 },
    { x: -34, y: 0, z: -30, yaw: Math.PI / 4 },
  ],
  B: [
    { x: 34, y: 0, z: 34, yaw: -3 * Math.PI / 4 },
    { x: 34, y: 0, z: 30, yaw: -3 * Math.PI / 4 },
  ],
};
