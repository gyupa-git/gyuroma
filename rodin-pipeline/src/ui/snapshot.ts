import * as THREE from "three";
import type { ViewName } from "../engine/types";
import { VIEW_DIRECTIONS, type CameraPose } from "./MeshViewer";

export interface ViewShot {
  /** "now" = from a viewer's camera as it is (what the user is looking at). */
  view: ViewName | "now";
  /** JPEG data URL. */
  dataUrl: string;
}

/**
 * Pictures of the model from several sides, drawn off screen with the same
 * lights as the viewers, for the AI to look at.  A context of its own,
 * released afterwards: the viewers' cameras and highlights are left alone.
 * `colours` is the viewers' linear colour buffer (3 corners per face).
 */
export function renderViews(positions: Float32Array, colours: Float32Array, views: Array<ViewName | CameraPose>, size = 560): ViewShot[] {
  // A camera pose keeps its view's proportions (the longer side `size`).
  const pose = views.find((v): v is CameraPose => typeof v !== "string");
  const width = pose && pose.aspect > 1 ? size : Math.round(size * (pose?.aspect ?? 1));
  const height = pose && pose.aspect > 1 ? Math.round(size / pose.aspect) : size;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  // A plain mid grey: no checkerboard to mistake for colour, light and dark parts both read.
  renderer.setClearColor(0x7c7c7c, 1);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-1.2, -2.0, 2.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(2.0, 1.5, -1.0);
  scene.add(fill);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(geometry, material));

  const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1);
  const radius = Math.max(1e-3, sphere.radius);
  const camera = new THREE.PerspectiveCamera(38, 1, radius * 0.01, radius * 10);
  camera.up.set(0, 0, 1);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fov / 2)) * 1.05;
  camera.near = Math.max(radius * 0.002, distance - radius * 2);
  camera.far = distance + radius * 2;
  camera.updateProjectionMatrix();

  const shots: ViewShot[] = [];
  try {
    for (const view of views) {
      if (typeof view !== "string") {
        const target = new THREE.Vector3(...view.target);
        camera.position.set(...view.position);
        camera.up.set(...view.up);
        camera.fov = view.fov;
        camera.aspect = width / height;
        const d = camera.position.distanceTo(target);
        camera.near = Math.max(radius * 0.002, d - radius * 2);
        camera.far = d + radius * 2;
        camera.updateProjectionMatrix();
        camera.lookAt(target);
        renderer.render(scene, camera);
        shots.push({ view: "now", dataUrl: canvas.toDataURL("image/jpeg", 0.88) });
        continue;
      }
      const dir = new THREE.Vector3(...VIEW_DIRECTIONS[view]);
      // Straight down along the up axis cannot use that axis as "up".
      camera.up.set(0, 0, 1);
      if (view === "top") camera.up.set(0, 1, 0);
      dir.normalize();
      camera.fov = 38;
      camera.aspect = width / height;
      camera.near = Math.max(radius * 0.002, distance - radius * 2);
      camera.far = distance + radius * 2;
      camera.updateProjectionMatrix();
      camera.position.copy(sphere.center).addScaledVector(dir, distance);
      camera.lookAt(sphere.center);
      renderer.render(scene, camera);
      shots.push({ view, dataUrl: canvas.toDataURL("image/jpeg", 0.85) });
    }
  } finally {
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return shots;
}
