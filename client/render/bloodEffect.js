import * as THREE from 'three';

const PARTICLE_COUNT = 12;
const PARTICLE_LIFETIME_MS = 550;
const PARTICLE_SPEED_MIN = 1.4;
const PARTICLE_SPEED_MAX = 3;
const PARTICLE_GRAVITY = 9; // m/s^2, independent of the game's own gravity

// Shared across every burst — geometry is never mutated, just referenced by
// many short-lived meshes, so one instance is enough for the whole app.
// (0.09 radius — the original 0.035 was so small at normal combat distance
// it was effectively invisible.)
const sharedGeo = new THREE.SphereGeometry(0.09, 5, 4);

// A light hit-confirmation cue for living targets (players/dummies) — a
// handful of small red particles popping outward from the impact point and
// fading quickly. Not gore, just enough to clearly read as "that was a
// person, not a wall" alongside the hitmarker.
export function spawnBloodEffect(scene, position) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xd21f1f, transparent: true, depthWrite: false });
  const group = new THREE.Group();
  group.position.set(position.x, position.y + 1.0, position.z); // roughly torso height

  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const mesh = new THREE.Mesh(sharedGeo, mat);
    const theta = Math.random() * Math.PI * 2;
    const speed = PARTICLE_SPEED_MIN + Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
    particles.push({
      mesh,
      velocity: {
        x: Math.cos(theta) * speed * 0.6,
        y: Math.random() * speed * 0.8 + 0.5,
        z: Math.sin(theta) * speed * 0.6,
      },
    });
    group.add(mesh);
  }
  scene.add(group);

  const startTime = performance.now();
  let lastTime = startTime;

  function tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    for (const p of particles) {
      p.velocity.y -= PARTICLE_GRAVITY * dt;
      p.mesh.position.x += p.velocity.x * dt;
      p.mesh.position.y += p.velocity.y * dt;
      p.mesh.position.z += p.velocity.z * dt;
    }

    const t = (now - startTime) / PARTICLE_LIFETIME_MS;
    mat.opacity = Math.max(0, 1 - t);

    if (t >= 1) {
      scene.remove(group);
      mat.dispose();
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
