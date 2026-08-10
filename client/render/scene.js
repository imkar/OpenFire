import * as THREE from 'three';
import { EYE_HEIGHT } from '../../shared/constants.js';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc7e8);
  // Arena is now 80x80 (diagonal ~113m) — pushed out again so far
  // walls/corners fade naturally instead of vanishing into fog well before
  // you can actually see them.
  scene.fog = new THREE.Fog(0x8fc7e8, 35, 120);

  const camera = new THREE.PerspectiveCamera(
    90,
    window.innerWidth / window.innerHeight,
    0.1,
    180
  );
  camera.rotation.order = 'YXZ';
  camera.position.set(0, EYE_HEIGHT, 5);
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  document.body.appendChild(renderer.domElement);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445566, 1.2);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = false;
  scene.add(dirLight);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer };
}
