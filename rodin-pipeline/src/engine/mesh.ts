import type { MeshModel, PaletteEntry, RGB, AccentProtectionMode } from "@core/types";
import { nearestPaletteIndex } from "@core/quantize";

export function colourKey(rgb: RGB): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

export function keyToRgb(key: number): RGB {
  return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
}

export function triangleAreaWeights(model: MeshModel): Float32Array {
  const weights = new Float32Array(model.triangles.length);
  for (let i = 0; i < model.triangles.length; i++) {
    const tri = model.triangles[i];
    const a = model.vertices[tri[0]];
    const b = model.vertices[tri[1]];
    const c = model.vertices[tri[2]];
    if (!a || !b || !c) {
      weights[i] = 1;
      continue;
    }
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const area = 0.5 * Math.hypot(cx, cy, cz);
    weights[i] = Number.isFinite(area) && area > 0 ? area : 1;
  }
  return weights;
}

/** Non-indexed position buffer (3 corners per face) for the viewer. */
export function buildPositions(model: MeshModel): Float32Array {
  const out = new Float32Array(model.triangles.length * 9);
  let p = 0;
  for (const tri of model.triangles) {
    for (let k = 0; k < 3; k++) {
      const v = model.vertices[tri[k]];
      out[p++] = v[0];
      out[p++] = v[1];
      out[p++] = v[2];
    }
  }
  return out;
}

export function srgbToLinear(v: number): number {
  const c = Math.max(0, Math.min(1, v / 255));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Non-indexed linear colour buffer for the viewer (3 corners per face). */
export function buildColourBuffer(faceCount: number, colourOfFace: (index: number) => RGB): Float32Array {
  const out = new Float32Array(faceCount * 9);
  const cache = new Map<number, [number, number, number]>();
  let p = 0;
  for (let i = 0; i < faceCount; i++) {
    const rgb = colourOfFace(i);
    const key = colourKey(rgb);
    let lin = cache.get(key);
    if (!lin) {
      lin = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
      cache.set(key, lin);
    }
    for (let k = 0; k < 3; k++) {
      out[p++] = lin[0];
      out[p++] = lin[1];
      out[p++] = lin[2];
    }
  }
  return out;
}

/** Palette position (0-based) per face, with an exact-colour cache. */
export function paletteLabels(
  colours: ArrayLike<RGB>,
  palette: PaletteEntry[],
  accentProtection: AccentProtectionMode,
): Int32Array {
  const labels = new Int32Array(colours.length);
  if (palette.length === 0) return labels;
  const cache = new Map<number, number>();
  for (let i = 0; i < colours.length; i++) {
    const rgb = colours[i];
    const key = colourKey(rgb);
    let label = cache.get(key);
    if (label === undefined) {
      label = nearestPaletteIndex(rgb, palette, accentProtection);
      cache.set(key, label);
    }
    labels[i] = label;
  }
  return labels;
}

export function areaFractionByPosition(
  labels: Int32Array,
  positionCount: number,
  weights: Float32Array,
): Float64Array {
  const sums = new Float64Array(positionCount);
  let total = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label < 0 || label >= positionCount) continue;
    const w = weights[i] ?? 1;
    sums[label] += w;
    total += w;
  }
  if (total > 0) for (let k = 0; k < positionCount; k++) sums[k] /= total;
  return sums;
}

/** Most frequent real face colour per palette position. */
export function representativeColoursByPosition(
  colours: ArrayLike<RGB>,
  labels: Int32Array,
  palette: PaletteEntry[],
): RGB[] {
  const counts: Array<Map<number, number>> = palette.map(() => new Map());
  for (let i = 0; i < labels.length; i++) {
    const bucket = counts[labels[i]];
    if (!bucket) continue;
    const key = colourKey(colours[i]);
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  return palette.map((entry, position) => {
    let bestKey = -1;
    let bestCount = 0;
    for (const [key, count] of counts[position]) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    return bestKey < 0 ? entry.rgb : keyToRgb(bestKey);
  });
}

export function countUniqueColours(colours: ArrayLike<RGB>): number {
  const keys = new Set<number>();
  for (let i = 0; i < colours.length; i++) keys.add(colourKey(colours[i]));
  return keys.size;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Highlighting and region picking
// ---------------------------------------------------------------------------

/** 1 for every face whose palette position is in `positions`. */
export function maskFromLabels(labels: Int32Array, positions: Iterable<number>): Uint8Array {
  const wanted = new Set(positions);
  const mask = new Uint8Array(labels.length);
  if (wanted.size === 0) return mask;
  for (let i = 0; i < labels.length; i++) if (wanted.has(labels[i])) mask[i] = 1;
  return mask;
}

export function maskFromFaces(faceCount: number, faces: ArrayLike<number>): Uint8Array {
  const mask = new Uint8Array(faceCount);
  for (let i = 0; i < faces.length; i++) mask[faces[i]] = 1;
  return mask;
}

export interface HighlightGeometry {
  /** Non-indexed positions of the highlighted faces (3 corners each). */
  fill: Float32Array;
  /** Smooth vertex normals in the same layout as `fill`. */
  fillNormals: Float32Array;
  /** Boundary edges of the highlighted region as line segments (2 points each). */
  edges: Float32Array;
  /** Smooth vertex normals in the same layout as `edges`. */
  edgeNormals: Float32Array;
  /** For each boundary edge, the third corner of its highlighted face (one point each): which side is inside. */
  edgeInside: Float32Array;
  faceCount: number;
}

/**
 * Area-weighted vertex normals, one per model vertex.  Used to push an
 * outline shell off the surface by a fixed number of pixels; the smoothness
 * is what keeps that shell in one piece across the mesh.
 */
export function smoothVertexNormals(model: MeshModel): Float32Array {
  const normals = new Float32Array(model.vertices.length * 3);
  for (const tri of model.triangles) {
    const a = model.vertices[tri[0]];
    const b = model.vertices[tri[1]];
    const c = model.vertices[tri[2]];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) {
      const o = tri[k] * 3;
      normals[o] += nx;
      normals[o + 1] += ny;
      normals[o + 2] += nz;
    }
  }
  for (let o = 0; o < normals.length; o += 3) {
    const len = Math.hypot(normals[o], normals[o + 1], normals[o + 2]);
    if (len > 0) {
      normals[o] /= len;
      normals[o + 1] /= len;
      normals[o + 2] /= len;
    }
  }
  return normals;
}

/** The faces around every vertex (offsets into `faces`), and the triangles and vertex positions as flat arrays. */
interface VertexFaces {
  offsets: Int32Array;
  faces: Int32Array;
  triangles: Int32Array;
  positions: Float32Array;
}

const vertexFacesCache = new WeakMap<MeshModel["triangles"], VertexFaces>();

/** Built once per model (a few tens of ms for a million faces) and kept with it. */
function vertexFaces(model: MeshModel): VertexFaces {
  const cached = vertexFacesCache.get(model.triangles);
  if (cached) return cached;
  const faceCount = model.triangles.length;
  const triangles = new Int32Array(faceCount * 3);
  const offsets = new Int32Array(model.vertices.length + 1);
  for (let f = 0; f < faceCount; f++) {
    const tri = model.triangles[f];
    for (let k = 0; k < 3; k++) {
      triangles[f * 3 + k] = tri[k];
      offsets[tri[k] + 1]++;
    }
  }
  for (let v = 0; v < model.vertices.length; v++) offsets[v + 1] += offsets[v];
  const faces = new Int32Array(faceCount * 3);
  const next = offsets.slice(0, -1);
  for (let i = 0; i < triangles.length; i++) faces[next[triangles[i]]++] = Math.floor(i / 3);
  const positions = new Float32Array(model.vertices.length * 3);
  for (let v = 0; v < model.vertices.length; v++) {
    const vertex = model.vertices[v];
    positions[v * 3] = vertex[0];
    positions[v * 3 + 1] = vertex[1];
    positions[v * 3 + 2] = vertex[2];
  }
  const out = { offsets, faces, triangles, positions };
  vertexFacesCache.set(model.triangles, out);
  return out;
}

/**
 * Geometry for a region highlight: the faces themselves (with their smooth
 * normals, for the outline shell) plus the seam where a highlighted face
 * meets a non-highlighted one.
 */
export function highlightGeometry(model: MeshModel, mask: Uint8Array, normals?: Float32Array): HighlightGeometry {
  const { offsets, faces, triangles, positions } = vertexFaces(model);
  let faceCount = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) faceCount++;
  const fill = new Float32Array(faceCount * 9);
  const fillNormals = new Float32Array(faceCount * 9);
  const normalOf = (vertex: number, out: Float32Array, at: number) => {
    if (normals) {
      out[at] = normals[vertex * 3];
      out[at + 1] = normals[vertex * 3 + 1];
      out[at + 2] = normals[vertex * 3 + 2];
    }
  };
  // An edge of a highlighted face is on the boundary when no other highlighted
  // face has it too.  Looking only at the few faces around one of its corners
  // makes this a walk over the highlighted faces; sorting all their edges took
  // a tenth of a second or more on a big colour, on every hover.
  const boundary = new Int32Array(faceCount * 9);
  let edgeCount = 0;
  let p = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    for (let k = 0; k < 3; k++) {
      const a = triangles[i * 3 + k];
      normalOf(a, fillNormals, p);
      fill[p++] = positions[a * 3];
      fill[p++] = positions[a * 3 + 1];
      fill[p++] = positions[a * 3 + 2];
      const b = triangles[i * 3 + ((k + 1) % 3)];
      if (a === b) continue;
      let shared = false;
      for (let j = offsets[a]; j < offsets[a + 1]; j++) {
        const g = faces[j];
        if (g === i || !mask[g]) continue;
        if (triangles[g * 3] === b || triangles[g * 3 + 1] === b || triangles[g * 3 + 2] === b) {
          shared = true;
          break;
        }
      }
      if (shared) continue;
      boundary[edgeCount * 3] = a;
      boundary[edgeCount * 3 + 1] = b;
      boundary[edgeCount * 3 + 2] = triangles[i * 3 + ((k + 2) % 3)];
      edgeCount++;
    }
  }
  const edges = new Float32Array(edgeCount * 6);
  const edgeNormals = new Float32Array(edgeCount * 6);
  const edgeInside = new Float32Array(edgeCount * 3);
  let e = 0;
  for (let n = 0; n < edgeCount; n++) {
    const a = boundary[n * 3];
    const b = boundary[n * 3 + 1];
    const c = boundary[n * 3 + 2];
    edgeInside[n * 3] = positions[c * 3];
    edgeInside[n * 3 + 1] = positions[c * 3 + 1];
    edgeInside[n * 3 + 2] = positions[c * 3 + 2];
    normalOf(a, edgeNormals, e);
    edges[e++] = positions[a * 3];
    edges[e++] = positions[a * 3 + 1];
    edges[e++] = positions[a * 3 + 2];
    normalOf(b, edgeNormals, e);
    edges[e++] = positions[b * 3];
    edges[e++] = positions[b * 3 + 1];
    edges[e++] = positions[b * 3 + 2];
  }
  return { fill, fillNormals, edges, edgeNormals, edgeInside, faceCount };
}

/** The faces cut along the border lines, as the result view shows them (@core/borderCut's BorderCut). */
export interface HighlightCut {
  addedVertices: Float64Array;
  pieces: Int32Array;
  pieceGroups: Int32Array;
  pieceFaces: Int32Array;
  replaced: Int32Array;
}

/** Per cut: which faces it replaces, and a normal for each added vertex (one of its piece's own corners). */
const cutLookup = new WeakMap<HighlightCut, { replaced: Uint8Array; addedNormalFrom: Int32Array }>();
function lookupOf(cut: HighlightCut, faceCount: number, vertexCount: number) {
  const known = cutLookup.get(cut);
  if (known && known.replaced.length === faceCount) return known;
  const replaced = new Uint8Array(faceCount);
  for (const f of cut.replaced) replaced[f] = 1;
  const addedNormalFrom = new Int32Array(cut.addedVertices.length / 3).fill(-1);
  for (let p = 0; p < cut.pieceGroups.length; p++) {
    let own = -1;
    for (let k = 0; k < 3; k++) if (cut.pieces[p * 3 + k] < vertexCount) own = cut.pieces[p * 3 + k];
    if (own < 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = cut.pieces[p * 3 + k] - vertexCount;
      if (v >= 0 && addedNormalFrom[v] < 0) addedNormalFrom[v] = own;
    }
  }
  const out = { replaced, addedNormalFrom };
  cutLookup.set(cut, out);
  return out;
}

/**
 * highlightGeometry for a model shown cut along its border lines: the faces
 * the cut replaces are their pieces, so the outline runs along the line, as
 * the colours do.  A piece belongs to the region when its group is one of the
 * region's and its face is in the region or touches it (the line gave it a
 * piece of the face next door).
 */
export function highlightGeometryCut(model: MeshModel, mask: Uint8Array, cut: HighlightCut, labels: ArrayLike<number>, normals?: Float32Array): HighlightGeometry {
  const { offsets, faces, triangles, positions } = vertexFaces(model);
  const vertexCount = model.vertices.length;
  const faceCount = model.triangles.length;
  const { replaced, addedNormalFrom } = lookupOf(cut, faceCount, vertexCount);
  const added = cut.addedVertices;
  const groups = new Set<number>();
  for (let f = 0; f < mask.length; f++) if (mask[f]) groups.add(labels[f]);
  const touches = (face: number) => {
    for (let k = 0; k < 3; k++) {
      const v = triangles[face * 3 + k];
      for (let j = offsets[v]; j < offsets[v + 1]; j++) if (mask[faces[j]]) return true;
    }
    return false;
  };
  const kept: number[] = [];
  for (let p = 0; p < cut.pieceGroups.length; p++) {
    const parent = cut.pieceFaces[p];
    if (groups.has(cut.pieceGroups[p]) && (mask[parent] || touches(parent))) kept.push(p);
  }
  let whole = 0;
  for (let f = 0; f < mask.length; f++) if (mask[f] && !replaced[f]) whole++;
  const count = whole + kept.length;
  const fill = new Float32Array(count * 9);
  const fillNormals = new Float32Array(count * 9);
  const point = (v: number, out: Float32Array, at: number) => {
    if (v < vertexCount) {
      out[at] = positions[v * 3];
      out[at + 1] = positions[v * 3 + 1];
      out[at + 2] = positions[v * 3 + 2];
    } else {
      const a = (v - vertexCount) * 3;
      out[at] = added[a];
      out[at + 1] = added[a + 1];
      out[at + 2] = added[a + 2];
    }
  };
  const normalOf = (v: number, out: Float32Array, at: number) => {
    if (!normals) return;
    const from = v < vertexCount ? v : addedNormalFrom[v - vertexCount];
    if (from < 0) return;
    out[at] = normals[from * 3];
    out[at + 1] = normals[from * 3 + 1];
    out[at + 2] = normals[from * 3 + 2];
  };
  // Edges found once by the whole faces (their neighbour across was cut) or by a
  // piece: shared by two in the region = inside, found once = the outline.
  const total = vertexCount + added.length / 3;
  const near = new Map<number, number>(); // edge key → its entry in `pending`, -1 once seen twice
  const pending: number[] = []; // a, b, inside corner
  const boundary: number[] = [];
  const meet = (a: number, b: number, c: number) => {
    const key = a < b ? a * total + b : b * total + a;
    const at = near.get(key);
    if (at === undefined) {
      near.set(key, pending.length);
      pending.push(a, b, c);
    } else near.set(key, -1);
  };
  let p = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || replaced[i]) continue;
    for (let k = 0; k < 3; k++) {
      const a = triangles[i * 3 + k];
      normalOf(a, fillNormals, p);
      point(a, fill, p);
      p += 3;
      const b = triangles[i * 3 + ((k + 1) % 3)];
      const c = triangles[i * 3 + ((k + 2) % 3)];
      if (a === b) continue;
      let shared = false;
      let cutNext = false;
      for (let j = offsets[a]; j < offsets[a + 1]; j++) {
        const g = faces[j];
        if (g === i) continue;
        if (triangles[g * 3] !== b && triangles[g * 3 + 1] !== b && triangles[g * 3 + 2] !== b) continue;
        if (replaced[g]) cutNext = true;
        else if (mask[g]) shared = true;
      }
      if (shared) continue;
      if (cutNext) meet(a, b, c);
      else boundary.push(a, b, c);
    }
  }
  for (const q of kept) {
    for (let k = 0; k < 3; k++) {
      const a = cut.pieces[q * 3 + k];
      normalOf(a, fillNormals, p);
      point(a, fill, p);
      p += 3;
      meet(a, cut.pieces[q * 3 + ((k + 1) % 3)], cut.pieces[q * 3 + ((k + 2) % 3)]);
    }
  }
  for (const at of near.values()) if (at >= 0) boundary.push(pending[at], pending[at + 1], pending[at + 2]);
  const edgeCount = boundary.length / 3;
  const edges = new Float32Array(edgeCount * 6);
  const edgeNormals = new Float32Array(edgeCount * 6);
  const edgeInside = new Float32Array(edgeCount * 3);
  for (let n = 0; n < edgeCount; n++) {
    point(boundary[n * 3 + 2], edgeInside, n * 3);
    point(boundary[n * 3], edges, n * 6);
    point(boundary[n * 3 + 1], edges, n * 6 + 3);
    normalOf(boundary[n * 3], edgeNormals, n * 6);
    normalOf(boundary[n * 3 + 1], edgeNormals, n * 6 + 3);
  }
  return { fill, fillNormals, edges, edgeNormals, edgeInside, faceCount: count };
}

/** Faces connected to `start` (sharing vertices) that carry the same label. */
export function sameLabelComponent(
  adjacencyOffsets: Int32Array,
  adjacencyNeighbours: Int32Array,
  labels: Int32Array,
  start: number,
): Int32Array {
  const label = labels[start];
  const visited = new Uint8Array(labels.length);
  const queue: number[] = [start];
  visited[start] = 1;
  const out: number[] = [];
  while (queue.length > 0) {
    const f = queue.pop() as number;
    out.push(f);
    const end = adjacencyOffsets[f + 1];
    for (let i = adjacencyOffsets[f]; i < end; i++) {
      const n = adjacencyNeighbours[i];
      if (visited[n] || labels[n] !== label) continue;
      visited[n] = 1;
      queue.push(n);
    }
  }
  return Int32Array.from(out);
}

// ---------------------------------------------------------------------------
// Face geometry (centroids / normals) and brush queries
// ---------------------------------------------------------------------------

export interface FaceGeometry {
  /** 3 floats per face. */
  centroids: Float32Array;
  /** 3 floats per face, unit length (zero for degenerate faces). */
  normals: Float32Array;
  /** Half of the largest bounding-box extent: a size reference for brush radii. */
  radius: number;
}

export function faceGeometry(model: MeshModel): FaceGeometry {
  const n = model.triangles.length;
  const centroids = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of model.vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  for (let i = 0; i < n; i++) {
    const tri = model.triangles[i];
    const a = model.vertices[tri[0]];
    const b = model.vertices[tri[1]];
    const c = model.vertices[tri[2]];
    centroids[i * 3] = (a[0] + b[0] + c[0]) / 3;
    centroids[i * 3 + 1] = (a[1] + b[1] + c[1]) / 3;
    centroids[i * 3 + 2] = (a[2] + b[2] + c[2]) / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return { centroids, normals, radius: Number.isFinite(extent) ? extent / 2 : 1 };
}

/**
 * Faces whose centroid lies within `radius` of `point`. With `viewDir` (the
 * direction the camera looks along), back-facing faces are skipped so a brush
 * does not leak through thin parts.
 */
export function facesInSphere(
  geometry: FaceGeometry,
  point: [number, number, number],
  radius: number,
  viewDir: [number, number, number] | null,
): Int32Array {
  const { centroids, normals } = geometry;
  const n = centroids.length / 3;
  const r2 = radius * radius;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = centroids[i * 3] - point[0];
    if (dx > radius || dx < -radius) continue;
    const dy = centroids[i * 3 + 1] - point[1];
    if (dy > radius || dy < -radius) continue;
    const dz = centroids[i * 3 + 2] - point[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (viewDir) {
      const dot = normals[i * 3] * viewDir[0] + normals[i * 3 + 1] * viewDir[1] + normals[i * 3 + 2] * viewDir[2];
      if (dot > 0.25) continue;
    }
    out.push(i);
  }
  return Int32Array.from(out);
}
