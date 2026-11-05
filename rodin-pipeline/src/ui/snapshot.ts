import * as THREE from "three";
import type { ViewName } from "../engine/types";
import { VIEW_DIRECTIONS, type CameraPose } from "./MeshViewer";
import type { ColourBuffer } from "../engine/mesh";
import { withSrgbColours } from "./colourShader";

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
export function renderViews(positions: Float32Array, colours: ColourBuffer, views: Array<ViewName | CameraPose>, size = 560): ViewShot[] {
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
  // The view's colour buffer (sRGB RGBA bytes, ui/colourShader.ts); each face lit by its own facing, as in the
  // viewer — no normals made per picture (on a 4.6 M-face model those were 166 MB each time).
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 4, true));
  geometry.computeBoundingSphere();
  const material = withSrgbColours(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, flatShading: true }));
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
  colours: ColourBuffer,
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
  // The view's colour buffer (sRGB RGBA bytes, ui/colourShader.ts); each face lit by its own facing, as in the
  // viewer — no normals made per picture (on a 4.6 M-face model those were 166 MB each time).
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 4, true));
  geometry.computeBoundingSphere();
  const material = withSrgbColours(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, flatShading: true }));
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
  const spots: Array<Array<{ count: number; x: number; y: number; depth: number }>> = [];
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
      // The number goes where the region is deepest — furthest from its edges (a chamfer distance in the
      // picture) — not at the pixel nearest its middle: a ring's middle is the plate it rings, and the number
      // landed on the plate (11-04 Tkc's collar: the gold trim read as the white plate).
      const depth = new Float32Array(width * height);
      const edge = (i: number, j: number, w: number) => (flipped[j] === flipped[i] ? depth[j] + w : w);
      for (let i = 0; i < width * height; i++) depth[i] = flipped[i] === 0 ? 0 : 1e9;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (flipped[i] === 0) continue;
          let d = depth[i];
          d = Math.min(d, x > 0 ? edge(i, i - 1, 1) : 1, y > 0 ? edge(i, i - width, 1) : 1);
          if (x > 0 && y > 0) d = Math.min(d, edge(i, i - width - 1, 1.4));
          if (x < width - 1 && y > 0) d = Math.min(d, edge(i, i - width + 1, 1.4));
          depth[i] = d;
        }
      for (let y = height - 1; y >= 0; y--)
        for (let x = width - 1; x >= 0; x--) {
          const i = y * width + x;
          if (flipped[i] === 0) continue;
          let d = depth[i];
          d = Math.min(d, x < width - 1 ? edge(i, i + 1, 1) : 1, y < height - 1 ? edge(i, i + width, 1) : 1);
          if (x < width - 1 && y < height - 1) d = Math.min(d, edge(i, i + width + 1, 1.4));
          if (x > 0 && y < height - 1) d = Math.min(d, edge(i, i + width - 1, 1.4));
          depth[i] = d;
        }
      const mid = Array.from({ length: regionCount }, (_, r) => ({ x: count[r] ? sx[r] / count[r] : 0, y: count[r] ? height - 1 - sy[r] / count[r] : 0 }));
      const at = Array.from({ length: regionCount }, () => ({ count: 0, x: 0, y: 0, depth: -1, off: Infinity }));
      for (let i = 0; i < width * height; i++) {
        const r = flipped[i] - 1;
        if (r < 0 || r >= regionCount) continue;
        const x = i % width;
        const y = Math.floor(i / width);
        const off = (x - mid[r].x) ** 2 + (y - mid[r].y) ** 2;
        // Deepest first; of the about-as-deep, the one nearest the middle.
        if (depth[i] > at[r].depth + 0.5 || (depth[i] > at[r].depth - 0.5 && off < at[r].off)) at[r] = { count: count[r], x, y, depth: Math.max(depth[i], at[r].depth), off };
      }
      spots.push(at);
    }
    // Each region numbered where it shows the most (and in a second view if it shows well there too).
    const marks: Array<Array<{ id: number; x: number; y: number; small: boolean }>> = views.map(() => []);
    for (let r = 0; r < regionCount; r++) {
      const ranked = views.map((_, v) => v).filter((v) => spots[v][r].count >= 12).sort((a, b) => spots[b][r].count - spots[a][r].count);
      for (const v of ranked.slice(0, 2)) {
        if (v !== ranked[0] && spots[v][r].count < 200) continue;
        // Too thin to hold its number inside (a trim, a strap): the number beside it, with a line to it.
        marks[v].push({ id: r + 1, x: spots[v][r].x, y: spots[v][r].y, small: spots[v][r].count < 900 || spots[v][r].depth < 9 });
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

/**
 * How many pixels of each region show from each camera pose (the region's faces drawn in a flat
 * code colour, everything else in front of them hiding them) — to pick the views a part shows best in.
 */
export function regionPixels(positions: Float32Array, regionOf: Int32Array, regionCount: number, poses: CameraPose[], size = 160): Float64Array[] {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(codes, 3, true));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
  target.texture.colorSpace = THREE.NoColorSpace;
  const pixels = new Uint8Array(size * size * 4);
  const radius = Math.max(1e-3, geometry.boundingSphere?.radius ?? 1);
  const camera = new THREE.PerspectiveCamera(38, 1, radius * 0.01, radius * 10);
  const out: Float64Array[] = [];
  try {
    for (const pose of poses) {
      const at = new THREE.Vector3(...pose.target);
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      camera.fov = pose.fov;
      camera.aspect = 1;
      const d = camera.position.distanceTo(at);
      camera.near = Math.max(radius * 0.002, d - radius * 2);
      camera.far = d + radius * 2;
      camera.updateProjectionMatrix();
      camera.lookAt(at);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      renderer.setRenderTarget(null);
      const count = new Float64Array(regionCount);
      for (let i = 0; i < size * size; i++) {
        const r = (pixels[i * 4] | (pixels[i * 4 + 1] << 8) | (pixels[i * 4 + 2] << 16)) - 1;
        if (r >= 0 && r < regionCount) count[r]++;
      }
      out.push(count);
    }
  } finally {
    geometry.dispose();
    material.dispose();
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}

/**
 * Which face shows at each pixel of a camera pose (face index, -1 for background), top row first —
 * a point the AI puts on a picture made with the same pose and size lands on the face under it.
 */
export function renderFaceIds(positions: Float32Array, pose: CameraPose, size: number): Int32Array {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  const faceCount = positions.length / 9;
  const codes = new Uint8Array(faceCount * 9);
  for (let f = 0; f < faceCount; f++) {
    const code = f + 1;
    const r = code & 255, g = (code >> 8) & 255, b = (code >> 16) & 255;
    for (let c = 0; c < 3; c++) {
      codes[f * 9 + c * 3] = r;
      codes[f * 9 + c * 3 + 1] = g;
      codes[f * 9 + c * 3 + 2] = b;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(codes, 3, true));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
  target.texture.colorSpace = THREE.NoColorSpace;
  const pixels = new Uint8Array(size * size * 4);
  const radius = Math.max(1e-3, geometry.boundingSphere?.radius ?? 1);
  const camera = new THREE.PerspectiveCamera(pose.fov, 1, radius * 0.01, radius * 10);
  const out = new Int32Array(size * size).fill(-1);
  try {
    const at = new THREE.Vector3(...pose.target);
    camera.position.set(...pose.position);
    camera.up.set(...pose.up);
    const d = camera.position.distanceTo(at);
    camera.near = Math.max(radius * 0.002, d - radius * 2);
    camera.far = d + radius * 2;
    camera.updateProjectionMatrix();
    camera.lookAt(at);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    renderer.setRenderTarget(null);
    for (let row = 0; row < size; row++)
      for (let x = 0; x < size; x++) {
        const i = row * size + x;
        const code = pixels[i * 4] | (pixels[i * 4 + 1] << 8) | (pixels[i * 4 + 2] << 16);
        // Read bottom-up: the picture's rows run top-down.
        out[(size - 1 - row) * size + x] = code - 1;
      }
  } finally {
    geometry.dispose();
    material.dispose();
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}

/** A picture with a light grid every `step` pixels and the pixel numbers along its edges (for pointing at things on it). */
export async function withGrid(dataUrl: string, step = 60): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.width || 1;
  canvas.height = img.height || 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 1;
  ctx.font = "10px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  for (let x = step; x < canvas.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.height);
    ctx.stroke();
    ctx.fillText(String(x), x + 2, 10);
  }
  for (let y = step; y < canvas.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(canvas.width, y + 0.5);
    ctx.stroke();
    ctx.fillText(String(y), 2, y - 2);
  }
  return canvas.toDataURL("image/jpeg", 0.9);
}
