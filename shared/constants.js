// Simulation
export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;

// Movement
export const MOVE_SPEED = 6; // m/s
export const SPRINT_SPEED = 9.5; // m/s
export const GRAVITY = 20; // m/s^2
export const JUMP_VELOCITY = 7.2; // m/s

// Player dimensions (AABB, position = feet center)
export const PLAYER_HALF_EXTENTS = { x: 0.35, z: 0.35 };
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.6;
export const PLAYER_MAX_HEALTH = 100;

// Lean/peek (Q = left, E = right) — eases toward -1..0..1, then offsets the
// eye position sideways (clamped against collision) so you can peek around
// cover without exposing your full body.
export const LEAN_DISTANCE = 0.5; // meters, sideways eye offset at full lean
export const LEAN_EASE_RATE = 10; // higher = snappier lean in/out
export const LEAN_ROLL = 0.18; // radians, camera roll tilt at full lean

// Double jump / boost jump — a second mid-air jump, noticeably higher than
// the ground jump, with a brief reduced-gravity float window (BO3-style).
export const MAX_AIR_JUMPS = 1; // ground jump + 1 air jump = "double jump"
export const AIR_JUMP_VELOCITY = 8.5; // higher than JUMP_VELOCITY (7.2) — boost feel
export const AIR_JUMP_GRAVITY_SCALE = 0.5; // reduced gravity right after an air jump
export const AIR_JUMP_FLOAT_DURATION = 0.3; // seconds the reduced gravity applies

// Wall-run — auto-triggered by approaching a wallRunnable collider from the
// side with enough tangential speed, whether airborne OR sprinting on the
// ground (BO3-style: no manual jump required, the game boosts you onto the
// wall automatically). Running speed exceeds sprint for a genuine "boost".
export const WALL_RUN_MIN_TANGENT_SPEED = 2.2; // m/s along the wall, gates head-on hits
export const WALL_RUN_DURATION = 2; // seconds before auto-detach
export const WALL_RUN_GRAVITY_SCALE = 0.1; // near-suspended gravity while running
export const WALL_RUN_SPEED = 11; // m/s along the wall tangent — faster than SPRINT_SPEED (9.5)
export const WALL_RUN_ENTRY_LIFT = 4; // m/s upward assist kick when entering from the ground
export const WALL_JUMP_UP_VELOCITY = 8;
export const WALL_JUMP_PUSH_SPEED = 6; // outward push away from the wall
export const WALL_RUN_ROLL = 0.16; // radians, camera tilt while wall-running

// Aim down sights (right mouse button, held) — classic zoom + slower move +
// steadier turn speed. Purely input-driven (no persistent state field
// needed, same as sprint): the server just re-checks input.aiming each tick.
export const ADS_SPEED = 3.2; // m/s while aiming — slower than MOVE_SPEED (6)
export const ADS_FOV = 55; // degrees, zoomed in from the base FOV (90)
export const ADS_SENSITIVITY_SCALE = 0.45; // mouse sensitivity multiplier while aiming
export const ADS_EASE_RATE = 12; // FOV/viewmodel ease speed in/out of ADS

// Weapon
export const WEAPON_DAMAGE = 25;
export const WEAPON_FIRE_RATE = 8; // shots per second
export const WEAPON_RANGE = 130; // meters — must exceed the 80x80 arena's diagonal (~113m)
export const LAG_COMPENSATION_WINDOW_MS = 300;
export const MAGAZINE_SIZE = 24;
export const RESERVE_AMMO_SIZE = 120; // spare rounds carried outside the magazine, refilled on respawn
export const RELOAD_DURATION_MS = 1600;

// Networking
export const WS_PORT = 8080;
export const INTERP_DELAY_MS = 100;
export const RECONCILE_BLEND = 0.2; // fraction of positional error corrected per frame
export const RECONCILE_SNAP_DISTANCE_M = 1.5; // corrections larger than this hard-snap instead of smoothing — a multi-frame slide reads worse than a single pop once the error is this big (e.g. after a lag spike)

// Match
export const MAX_PLAYERS = 4;
export const TEAM_A = 'A';
export const TEAM_B = 'B';
export const SCORE_LIMIT = 30;
export const TIME_LIMIT_MS = 10 * 60 * 1000;
export const RESPAWN_DELAY_MS = 3000;

// Rooms / matchmaking
export const RECONNECT_GRACE_MS = 15000; // window to RESUME after a dropped connection before the seat is given up
export const MIN_PLAYERS_TO_FORCE_START = 2; // private-room host can START_MATCH early once both teams have someone

// Practice target dummies — stationary shootable targets that take damage
// like a player and relocate to a new random spot (full health) once
// "killed", instead of teleporting on the very first hit. Not part of
// scoring/match flow, always shootable regardless of match phase, so
// there's something to shoot at while waiting for more players.
export const DUMMY_COUNT = 4;
export const DUMMY_HEALTH = 100;
