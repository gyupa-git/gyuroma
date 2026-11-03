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

export interface NumberedShots {
  shots: ViewShot[];
  /** For each region (index into the region list): the views its number is drawn on ("now" for a camera pose). */
  seen: Array<Array<ViewName | "now">>;
}

/**
 * The model from several sides with each listed region's number drawn on it,
 * where that region shows the most (two views at most, so the pictures stay
 * readable).  Where a region shows is measured, not guessed: each view is drawn
 * once more off screen with every face in its region's own flat code colour,
 * and the pixels of each code are counted — a region behind another is not
 * numbered there.  A small region's number sits beside it with a thin line, so
 * an eye is not hidden under its own label.
 */
export function renderNumberedViews(
  positions: Float32Array,
  colours: Float32Array,
  regionOf: Int32Array,
  regionCount: number,
  views: Array<ViewName | CameraPose>,
  size = 640,
  /** Region → group (a cell's part): its borders drawn thick, the regions' own borders thin. */
  groupOf?: Int32Array,
): NumberedShots {
  const width = size;
  const height = size;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x7c7c7c, 1);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-1.2, -2.0, 2.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(2.0, 1.5, -1.0);
  scene.add(fill);

  const position = new THREE.BufferAttribute(positions, 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", position);
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(geometry, material));

  // The code pass: region index + 1 as three bytes (0 = a face of no listed region).
  const faceCount = regionOf.length;
  const codes = new Uint8Array(faceCount * 9);
  for (let f = 0; f < faceCount; f++) {
    const code = regionOf[f] + 1;
    const r = code & 255, g = (code >> 8) & 255, b = (code >> 16) & 255;
    for (let c = 0; c < 3; c++) {
      codes[f * 9 + c * 3] = r;
      codes[f * 9 + c * 3 + 1] = g;
      codes[f * 9 + c * 3 + 2] = b;
    }
  }
  const codeGeometry = new THREE.BufferGeometry();
  codeGeometry.setAttribute("position", position);
  codeGeometry.setAttribute("color", new THREE.BufferAttribute(codes, 3, true));
  const codeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const codeScene = new THREE.Scene();
  codeScene.add(new THREE.Mesh(codeGeometry, codeMaterial));
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
  target.texture.colorSpace = THREE.NoColorSpace;
  const pixels = new Uint8Array(width * height * 4);

  const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1);
  const radius = Math.max(1e-3, sphere.radius);
  const camera = new THREE.PerspectiveCamera(38, 1, radius * 0.01, radius * 10);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fov / 2)) * 1.05;
  const place = (view: ViewName | CameraPose) => {
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
      return;
    }
    const dir = new THREE.Vector3(...VIEW_DIRECTIONS[view]).normalize();
    camera.up.set(0, 0, 1);
    if (view === "top") camera.up.set(0, 1, 0);
    camera.fov = 38;
    camera.aspect = width / height;
    camera.near = Math.max(radius * 0.002, distance - radius * 2);
    camera.far = distance + radius * 2;
    camera.updateProjectionMatrix();
    camera.position.copy(sphere.center).addScaledVector(dir, distance);
    camera.lookAt(sphere.center);
  };

  // Where each region shows in each view: its pixel count and the pixel nearest the middle of them.
  const spots: Array<Array<{ count: number; x: number; y: number }>> = [];
  // Each view's codes, top row first (for the borders drawn on its picture).
  const codeViews: Int32Array[] = [];
  const seen: Array<Array<ViewName | "now">> = Array.from({ length: regionCount }, () => []);
  const shots: ViewShot[] = [];
  try {
    for (const view of views) {
      place(view);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(codeScene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x7c7c7c, 1);
      const count = new Float64Array(regionCount);
      const sx = new Float64Array(regionCount);
      const sy = new Float64Array(regionCount);
      const codeAt = (i: number) => pixels[i * 4] | (pixels[i * 4 + 1] << 8) | (pixels[i * 4 + 2] << 16);
      const flipped = new Int32Array(width * height);
      for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) flipped[(height - 1 - row) * width + x] = codeAt(row * width + x);
      codeViews.push(flipped);
      for (let i = 0; i < width * height; i++) {
        const r = codeAt(i) - 1;
        if (r < 0 || r >= regionCount) continue;
        count[r]++;
        sx[r] += i % width;
        sy[r] += Math.floor(i / width);
      }
      const best = new Float64Array(regionCount).fill(Infinity);
      const at = Array.from({ length: regionCount }, () => ({ count: 0, x: 0, y: 0 }));
      for (let i = 0; i < width * height; i++) {
        const r = codeAt(i) - 1;
        if (r < 0 || r >= regionCount) continue;
        const x = i % width;
        const y = Math.floor(i / width);
        const d = (x - sx[r] / count[r]) ** 2 + (y - sy[r] / count[r]) ** 2;
        if (d < best[r]) {
          best[r] = d;
          // Read bottom-up: the picture's rows run top-down.
          at[r] = { count: count[r], x, y: height - 1 - y };
        }
      }
      spots.push(at);
    }
    // Each region numbered where it shows the most (and in a second view if it shows well there too).
    const marks: Array<Array<{ id: number; x: number; y: number; small: boolean }>> = views.map(() => []);
    for (let r = 0; r < regionCount; r++) {
      const ranked = views.map((_, v) => v).filter((v) => spots[v][r].count >= 12).sort((a, b) => spots[b][r].count - spots[a][r].count);
      for (const v of ranked.slice(0, 2)) {
        if (v !== ranked[0] && spots[v][r].count < 200) continue;
        marks[v].push({ id: r + 1, x: spots[v][r].x, y: spots[v][r].y, small: spots[v][r].count < 900 });
        const view = views[v];
        seen[r].push(typeof view === "string" ? view : "now");
      }
    }
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    views.forEach((view, v) => {
      place(view);
      renderer.render(scene, camera);
      const shotView: ViewName | "now" = typeof view === "string" ? view : "now";
      if (!ctx) {
        shots.push({ view: shotView, dataUrl: canvas.toDataURL("image/jpeg", 0.88) });
        return;
      }
      ctx.drawImage(canvas, 0, 0);
      // Borders between regions (thin) and between their groups (thick), where both sides are model.
      const codesHere = codeViews[v];
      const image = ctx.getImageData(0, 0, width, height);
      const px = image.data;
      const darken = (i: number, k: number) => {
        px[i * 4] *= k;
        px[i * 4 + 1] *= k;
        px[i * 4 + 2] *= k;
      };
      const groupAt = (code: number) => (groupOf && code > 0 ? groupOf[code - 1] : -1);
      for (let y = 0; y < height - 1; y++)
        for (let x = 0; x < width - 1; x++) {
          const i = y * width + x;
          const c = codesHere[i];
          if (c === 0) continue;
          for (const j of [i + 1, i + width]) {
            const d = codesHere[j];
            if (d === 0 || d === c) continue;
            const thick = groupOf !== undefined && groupAt(c) !== groupAt(d);
            darken(i, thick ? 0.05 : 0.45);
            if (thick) {
              darken(j, 0.05);
              if (x > 0) darken(i - 1, 0.3);
              if (y > 0) darken(i - width, 0.3);
            }
          }
        }
      ctx.putImageData(image, 0, 0);
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      const overlaps = (b: { x: number; y: number; w: number; h: number }) =>
        placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
      for (const mark of marks[v].sort((a, b) => a.id - b.id)) {
        const text = String(mark.id);
        const w = ctx.measureText(text).width + 8;
        const h = 15;
        let cx = mark.x;
        let cy = mark.y;
        if (mark.small) {
          cx += 16;
          cy -= 16;
        }
        let box = { x: cx - w / 2, y: cy - h / 2, w, h };
        for (let tries = 0; tries < 6 && overlaps(box); tries++) {
          cy += h + 2;
          box = { x: cx - w / 2, y: cy - h / 2, w, h };
        }
        box.x = Math.max(1, Math.min(width - w - 1, box.x));
        box.y = Math.max(1, Math.min(height - h - 1, box.y));
        placed.push(box);
        if (mark.small || cy !== mark.y) {
          ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(mark.x, mark.y);
          ctx.lineTo(box.x + box.w / 2, box.y + box.h / 2);
          ctx.stroke();
          ctx.fillStyle = "#000";
          ctx.fillRect(mark.x - 1.5, mark.y - 1.5, 3, 3);
        }
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeStyle = "#000";
        ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
        ctx.fillStyle = "#000";
        ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2 + 0.5);
      }
      shots.push({ view: shotView, dataUrl: out.toDataURL("image/jpeg", 0.88) });
    });
  } finally {
    geometry.dispose();
    codeGeometry.dispose();
    material.dispose();
    codeMaterial.dispose();
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return { shots, seen };
}
