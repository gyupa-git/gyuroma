import type { MeshModel, RGB, Tri, Vec3 } from "@core/types";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import { buildFaceAtlas, type FaceAtlas } from "../engine/atlas";
import { faceGeometry, triangleAreaWeights } from "../engine/mesh";

/**
 * The colour map for the AI (11-04, the owner: "네가 색칠할 때 색 지도를 잘 활용하면 쉽게 할 수 있을 거 같은데"):
 * the surface laid out flat, so nothing is behind anything and a bag's stripes are as big as they are —
 * next to the 3D close-ups, which show what the shapes are.
 */

/** Some faces of a model (a part and the cells round it) laid out flat on their own; `idMap` holds indices into `faces`. */
export function regionAtlas(model: MeshModel, faces: Int32Array, size: number): FaceAtlas {
  const vertexOf = new Map<number, number>();
  const vertices: Vec3[] = [];
  const triangles: Tri[] = new Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    const tri = model.triangles[faces[i]];
    const out: number[] = [];
    for (const v of tri) {
      let w = vertexOf.get(v);
      if (w === undefined) {
        w = vertices.length;
        vertexOf.set(v, w);
        vertices.push(model.vertices[v]);
      }
      out.push(w);
    }
    triangles[i] = out as unknown as Tri;
  }
  const sub: MeshModel = {
    name: model.name,
    vertices,
    triangles,
    triangleColors: Array.from(faces, (f) => model.triangleColors[f]),
    stats: { vertexCount: vertices.length, triangleCount: triangles.length, coloredVertexCount: 0, uniqueFaceColors: 0, objectFaceCounts: {} },
  };
  return buildFaceAtlas(sub, buildFaceAdjacency(triangles, vertices.length), faceGeometry(sub), triangleAreaWeights(sub), size);
}

/** The used part of the map (its extent), as a canvas of at most `out` pixels on the long side. */
function canvasOf(atlas: FaceAtlas, out: number, paint: (data: Uint8ClampedArray) => void): HTMLCanvasElement {
  const full = document.createElement("canvas");
  full.width = atlas.size;
  full.height = atlas.size;
  const fctx = full.getContext("2d");
  if (!fctx) return full;
  const image = fctx.createImageData(atlas.size, atlas.size);
  paint(image.data);
  fctx.putImageData(image, 0, 0);
  const w = Math.max(1, Math.min(atlas.size, Math.ceil(atlas.extent[0])));
  const h = Math.max(1, Math.min(atlas.size, Math.ceil(atlas.extent[1])));
  const k = out / Math.max(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#7c7c7c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(full, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The whole map in some colours (index = the map's face). */
export function mapPicture(atlas: FaceAtlas, colourOf: (face: number) => RGB, out = 1024): string {
  const canvas = canvasOf(atlas, out, (data) => {
    for (let i = 0; i < atlas.idMap.length; i++) {
      const f = atlas.idMap[i];
      if (f < 0) continue;
      const c = colourOf(f);
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = 255;
    }
  });
  return canvas.toDataURL("image/jpeg", 0.88);
}

/**
 * A region's map with its blobs outlined and numbered (1-based, where each blob is deepest — furthest from
 * its edges), faces with `dim` set darker (not the part's own).
 */
export function numberedMapPicture(atlas: FaceAtlas, colourOf: (face: number) => RGB, blobOf: ArrayLike<number>, blobCount: number, dim: (face: number) => boolean, out = 1000): string {
  const size = atlas.size;
  const code = new Int32Array(size * size);
  for (let i = 0; i < code.length; i++) code[i] = atlas.idMap[i] < 0 ? 0 : blobOf[atlas.idMap[i]] + 1;
  // Each blob's deepest pixel (chamfer distance to the nearest other code).
  const depth = new Float32Array(size * size);
  for (let i = 0; i < depth.length; i++) depth[i] = code[i] === 0 ? 0 : 1e9;
  const edge = (i: number, j: number, w: number) => (code[j] === code[i] ? depth[j] + w : w);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!code[i]) continue;
      depth[i] = Math.min(depth[i], x > 0 ? edge(i, i - 1, 1) : 1, y > 0 ? edge(i, i - size, 1) : 1);
    }
  for (let y = size - 1; y >= 0; y--)
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (!code[i]) continue;
      depth[i] = Math.min(depth[i], x < size - 1 ? edge(i, i + 1, 1) : 1, y < size - 1 ? edge(i, i + size, 1) : 1);
    }
  const best = Array.from({ length: blobCount }, () => ({ x: 0, y: 0, depth: -1, pixels: 0 }));
  for (let i = 0; i < code.length; i++) {
    const b = code[i] - 1;
    if (b < 0) continue;
    best[b].pixels++;
    if (depth[i] > best[b].depth) best[b] = { x: i % size, y: Math.floor(i / size), depth: depth[i], pixels: best[b].pixels };
  }
  const canvas = canvasOf(atlas, out, (data) => {
    for (let i = 0; i < atlas.idMap.length; i++) {
      const f = atlas.idMap[i];
      if (f < 0) continue;
      const c = colourOf(f);
      const k = dim(f) ? 0.55 : 1;
      // Blob borders darker.
      const x = i % size;
      const border = (x < size - 1 && code[i + 1] && code[i + 1] !== code[i]) || (i + size < code.length && code[i + size] && code[i + size] !== code[i]);
      const kk = border ? k * 0.35 : k;
      data[i * 4] = c[0] * kk;
      data[i * 4 + 1] = c[1] * kk;
      data[i * 4 + 2] = c[2] * kk;
      data[i * 4 + 3] = 255;
    }
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/jpeg", 0.88);
  const w = Math.max(1, Math.min(size, Math.ceil(atlas.extent[0])));
  const h = Math.max(1, Math.min(size, Math.ceil(atlas.extent[1])));
  const k = canvas.width / w;
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const overlaps = (b: { x: number; y: number; w: number; h: number }) => placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
  best.forEach((spot, b) => {
    if (spot.pixels < 3 || spot.x >= w || spot.y >= h) return;
    const px = spot.x * k, py = spot.y * k;
    const thin = spot.depth * k < 9;
    const text = String(b + 1);
    const bw = ctx.measureText(text).width + 8, bh = 15;
    let cx = thin ? px + 16 : px, cy = thin ? py - 16 : py;
    let box = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    for (let tries = 0; tries < 6 && overlaps(box); tries++) {
      cy += bh + 2;
      box = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    }
    box.x = Math.max(1, Math.min(canvas.width - bw - 1, box.x));
    box.y = Math.max(1, Math.min(canvas.height - bh - 1, box.y));
    cx = box.x + bw / 2;
    cy = box.y + bh / 2;
    placed.push(box);
    if (thin || Math.hypot(cx - px, cy - py) > 4) {
      ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = "#000";
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    ctx.fillStyle = "#000";
    ctx.fillText(text, cx, cy + 0.5);
  });
  return canvas.toDataURL("image/jpeg", 0.88);
}
