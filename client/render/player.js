import * as THREE from 'three';

// First-person view-model: a simple box "gun" parented directly to the
// camera so it moves for free with camera rotation — no extra render pass.
// `muzzleFlash` is a small glowing sphere at the barrel tip, hidden by
// default and briefly shown on each shot (see localPlayer.js's fire()) — a
// flash right at the gun reads as "it fired" without needing a travelling
// tracer beam.
export function createViewModel(camera) {
  const geo = new THREE.BoxGeometry(0.15, 0.15, 0.6);
  const mat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  mat.depthTest = false;
  // Marked transparent (opacity stays 1, so it looks identical) purely to
  // move the gun into the same TRANSPARENT render queue as muzzleFlash —
  // Three.js always renders the entire opaque queue before any transparent
  // object, regardless of renderOrder, so as long as the gun stayed opaque
  // the flash (transparent) was guaranteed to paint over it no matter what
  // renderOrder said. Both being transparent is what lets renderOrder
  // actually decide who's in front.
  mat.transparent = true;

  const gun = new THREE.Mesh(geo, mat);
  gun.position.set(0.25, -0.25, -0.5);
  gun.renderOrder = 999;
  camera.add(gun);

  const flashGeo = new THREE.SphereGeometry(0.07, 6, 5);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfff2b0,
    transparent: true,
    opacity: 0,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
  // Initial/hip-fire default — localPlayer.js's syncCamera() overrides this
  // every frame, blending toward a separate ADS offset as aimAmount rises
  // (the flash's ideal spot shifts slightly once the narrower ADS FOV and
  // recentered gun change how it reads on screen).
  muzzleFlash.position.set(-0.045, 0.035, -0.34);
  // Lower renderOrder than the gun (998 < 999) — now that both are in the
  // same transparent queue, this reliably makes the gun draw after/on top.
  muzzleFlash.renderOrder = 998;
  muzzleFlash.visible = false;
  gun.add(muzzleFlash);

  return { gun, muzzleFlash };
}

const TEAM_COLORS = {
  A: 0xd9534f, // warm
  B: 0x428bca, // cool
};

// Remote/enemy player representation: a capsule body color-coded by team.
export function createPlayerMesh(team) {
  const geo = new THREE.CapsuleGeometry(0.35, 1.1, 4, 8);
  const mat = new THREE.MeshLambertMaterial({ color: TEAM_COLORS[team] ?? 0xffffff });
  const mesh = new THREE.Mesh(geo, mat);
  // CapsuleGeometry is centered on the origin; offset so mesh.position can
  // be set to the feet-center convention used by shared/movement.js.
  mesh.position.y = 0.9;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
