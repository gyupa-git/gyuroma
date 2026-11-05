import type { FaceAdjacency } from "@core/meshAdjacency";
import type { Tri, Vec3 } from "@core/types";

/**
 * Borders where the sculpt says they are (11-04, the owner: "색이 다른 파츠가 붙어있는데 가장 쏙
 * 들어간 데를 기점으로 색을 나눠야지"): where two parts of different colour meet — icing on a
 * head, a hand round a candy cane — the border belongs in the groove between them, not
 * where a rough cut or a blurred texture put it.
 *
 * Near every border (`band` rings of faces on each side) the labels are worked out again:
 * each side spreads from the faces it surely has (further from the border than the band,
 * or the middle of a patch thinner than that) over the surface, and stepping over a fold
 * that bends inwards (a groove) costs a lot, as does stepping across a change in the model's
 * own colour.  The two sides meet at the bottom of the groove, or at the colour change where
 * there is none.  Frozen labels (protected colours) keep their faces and do not spread.
 */
export interface CreaseGeometry {
  centroids: Float32Array;
  normals: Float32Array;
}

export function creaseGeometry(vertices: ArrayLike<Vec3>, triangles: ArrayLike<Tri>): CreaseGeometry {
  const n = triangles.length;
  const centroids = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let f = 0; f < n; f++) {
    const [a, b, c] = triangles[f];
    const p = vertices[a], q = vertices[b], r = vertices[c];
    centroids[f * 3] = (p[0] + q[0] + r[0]) / 3;
    centroids[f * 3 + 1] = (p[1] + q[1] + r[1]) / 3;
    centroids[f * 3 + 2] = (p[2] + q[2] + r[2]) / 3;
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    normals[f * 3] = nx;
    normals[f * 3 + 1] = ny;
    normals[f * 3 + 2] = nz;
  }
  return { centroids, normals };
}

export interface CreaseOptions {
  /** Rings of faces on each side of a border that may change side. */
  band: number;
  /** Labels whose faces stay as they are and do not spread (protected colours). */
  frozen?: Uint8Array | null;
  /** Each face's own colour as Lab (3 a face), for the cost of crossing a colour change; null = groove only. */
  lab?: Float32Array | null;
  /** Only these faces may change (a part looked at up close); null = any. */
  only?: Uint8Array | null;
  /** How much a groove costs to cross (default 60) and a colour change (per ΔE 10, default 1). */
  grooveCost?: number;
  colourCost?: number;
}

/** A min-heap of faces by cost (typed arrays: millions of faces). */
class FaceHeap {
  faces: Int32Array;
  costs: Float32Array;
  size = 0;
  constructor(capacity: number) {
    this.faces = new Int32Array(Math.max(16, capacity));
    this.costs = new Float32Array(Math.max(16, capacity));
  }
  push(face: number, cost: number): void {
    if (this.size === this.faces.length) {
      const faces = new Int32Array(this.faces.length * 2);
      faces.set(this.faces);
      const costs = new Float32Array(this.costs.length * 2);
      costs.set(this.costs);
      this.faces = faces;
      this.costs = costs;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= cost) break;
      this.faces[i] = this.faces[parent];
      this.costs[i] = this.costs[parent];
      i = parent;
    }
    this.faces[i] = face;
    this.costs[i] = cost;
  }
  pop(): number {
    const top = this.faces[0];
    const lastFace = this.faces[--this.size];
    const lastCost = this.costs[this.size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const c = r < this.size && this.costs[r] < this.costs[l] ? r : l;
      if (this.costs[c] >= lastCost) break;
      this.faces[i] = this.faces[c];
      this.costs[i] = this.costs[c];
      i = c;
    }
    this.faces[i] = lastFace;
    this.costs[i] = lastCost;
    return top;
  }
}

/** The cost of stepping from one face to the next: 1, plus a lot over a groove, plus a little per colour change. */
function crossingCost(geometry: CreaseGeometry, lab: Float32Array | null, grooveCost: number, colourCost: number): (f: number, g: number) => number {
  const { centroids: c, normals: nm } = geometry;
  return (f, g) => {
    const dx = c[g * 3] - c[f * 3], dy = c[g * 3 + 1] - c[f * 3 + 1], dz = c[g * 3 + 2] - c[f * 3 + 2];
    const len = Math.hypot(dx, dy, dz) || 1e-9;
    const cos = nm[f * 3] * nm[g * 3] + nm[f * 3 + 1] * nm[g * 3 + 1] + nm[f * 3 + 2] * nm[g * 3 + 2];
    // Inwards: the next face lies above this one's surface (and this one above the next's) — a valley.
    const up = (dx * nm[f * 3] + dy * nm[f * 3 + 1] + dz * nm[f * 3 + 2]) / len;
    const down = (dx * nm[g * 3] + dy * nm[g * 3 + 1] + dz * nm[g * 3 + 2]) / len;
    const groove = up > 0.02 && down < -0.02 ? Math.max(0, 1 - cos) : 0;
    let cost = 1 + grooveCost * groove;
    if (lab) {
      const dl = lab[g * 3] - lab[f * 3], da = lab[g * 3 + 1] - lab[f * 3 + 1], db = lab[g * 3 + 2] - lab[f * 3 + 2];
      cost += (colourCost * Math.hypot(dl, da, db)) / 10;
    }
    return cost;
  };
}

/**
 * Faces with no label yet (-1: a blob the AI could not place, two things blurred into one) take the
 * label of the side cheapest to reach — spreading over the surface as the crease snap does, a groove
 * or a change in the model's own colour costing to cross — so the two sides meet where the sculpt
 * or the texture divides them.  Faces no labelled face can reach stay -1.
 */
export function fillUnlabelled(labels: Int32Array, adjacency: FaceAdjacency, geometry: CreaseGeometry, options: { lab?: Float32Array | null; grooveCost?: number; colourCost?: number } = {}): Int32Array {
  const n = labels.length;
  const out = labels.slice();
  const { offsets, neighbours } = adjacency;
  const step = crossingCost(geometry, options.lab ?? null, options.grooveCost ?? 60, options.colourCost ?? 1);
  const cost = new Float32Array(n).fill(Infinity);
  let open = 0;
  for (let f = 0; f < n; f++) if (labels[f] < 0) open++;
  if (open === 0) return out;
  const heap = new FaceHeap(open * 2);
  for (let f = 0; f < n; f++) {
    if (labels[f] < 0) continue;
    for (let i = offsets[f]; i < offsets[f + 1]; i++)
      if (labels[neighbours[i]] < 0) {
        cost[f] = 0;
        heap.push(f, 0);
        break;
      }
  }
  const done = new Uint8Array(n);
  while (heap.size > 0) {
    const a = heap.pop();
    if (done[a]) continue;
    done[a] = 1;
    for (let i = offsets[a]; i < offsets[a + 1]; i++) {
      const b = neighbours[i];
      if (labels[b] >= 0 || done[b]) continue;
      const next = cost[a] + step(a, b);
      if (next < cost[b]) {
        cost[b] = next;
        out[b] = out[a];
        heap.push(b, next);
      }
    }
  }
  return out;
}

export function snapToCreases(labels: Int32Array, adjacency: FaceAdjacency, geometry: CreaseGeometry, options: CreaseOptions): Int32Array {
  const n = labels.length;
  const band = Math.max(0, Math.floor(options.band));
  const out = labels.slice();
  if (band === 0 || n === 0) return out;
  const { offsets, neighbours } = adjacency;
  const frozen = options.frozen ?? null;
  const isFrozen = (label: number) => Boolean(frozen && label >= 0 && label < frozen.length && frozen[label]);

  // Rings from the nearest border, inside each side (border faces are ring 0).
  const ring = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let f = 0; f < n; f++) {
    for (let i = offsets[f]; i < offsets[f + 1]; i++) {
      if (labels[neighbours[i]] !== labels[f]) {
        ring[f] = 0;
        frontier.push(f);
        break;
      }
    }
  }
  if (frontier.length === 0) return out;
  // One ring further than the band, to know which faces lie beyond it.
  for (let d = 1; d <= band + 1 && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const a of frontier) {
      for (let i = offsets[a]; i < offsets[a + 1]; i++) {
        const b = neighbours[i];
        if (ring[b] < 0 && labels[b] === labels[a]) {
          ring[b] = d;
          next.push(b);
        }
      }
    }
    frontier = next;
  }
  // A patch thinner than the band keeps its middle: its deepest faces are sure of their side.
  const patch = new Int32Array(n).fill(-1);
  const deepest: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (patch[s] >= 0 || ring[s] < 0) continue;
    const id = deepest.length;
    let deep = 0;
    patch[s] = id;
    stack.push(s);
    while (stack.length) {
      const a = stack.pop() as number;
      if (ring[a] > deep) deep = ring[a];
      for (let i = offsets[a]; i < offsets[a + 1]; i++) {
        const b = neighbours[i];
        if (patch[b] < 0 && ring[b] >= 0 && labels[b] === labels[a]) {
          patch[b] = id;
          stack.push(b);
        }
      }
    }
    deepest.push(deep);
  }

  // Faces that may change: in the band, not frozen, not the middle of a thin patch.
  const open = new Uint8Array(n);
  let openCount = 0;
  const only = options.only ?? null;
  for (let f = 0; f < n; f++) {
    if (ring[f] < 0 || ring[f] > band || isFrozen(labels[f]) || (only && !only[f])) continue;
    const deep = deepest[patch[f]];
    if (deep <= band && ring[f] >= deep) continue;
    open[f] = 1;
    openCount++;
  }
  if (openCount === 0) return out;

  const step = crossingCost(geometry, options.lab ?? null, options.grooveCost ?? 60, options.colourCost ?? 1);

  // Every open face to the side it is cheapest to reach from (all sides spreading at once).
  const cost = new Float32Array(n).fill(Infinity);
  const heap = new FaceHeap(openCount * 2);
  for (let f = 0; f < n; f++) {
    if (open[f] || ring[f] < 0) continue;
    // A sure face next to an open one starts a front.
    let touches = false;
    for (let i = offsets[f]; i < offsets[f + 1] && !touches; i++) touches = open[neighbours[i]] === 1;
    if (!touches || isFrozen(labels[f])) continue;
    cost[f] = 0;
    heap.push(f, 0);
  }
  const done = new Uint8Array(n);
  while (heap.size > 0) {
    const a = heap.pop();
    if (done[a]) continue;
    done[a] = 1;
    const base = cost[a];
    for (let i = offsets[a]; i < offsets[a + 1]; i++) {
      const b = neighbours[i];
      if (!open[b] || done[b]) continue;
      const next = base + step(a, b);
      if (next < cost[b]) {
        cost[b] = next;
        out[b] = out[a];
        heap.push(b, next);
      }
    }
  }
  return out;
}

/**
 * How much each face sits in a dent: the mean over its neighbours of how far they rise
 * above its own surface (0 on a flat or bulging surface, more in a hole or a groove).
 */
export function faceConcavity(adjacency: FaceAdjacency, geometry: CreaseGeometry): Float32Array {
  const { offsets, neighbours } = adjacency;
  const { centroids: c, normals: nm } = geometry;
  const n = offsets.length - 1;
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    let count = 0;
    for (let i = offsets[f]; i < offsets[f + 1]; i++) {
      const g = neighbours[i];
      const dx = c[g * 3] - c[f * 3], dy = c[g * 3 + 1] - c[f * 3 + 1], dz = c[g * 3 + 2] - c[f * 3 + 2];
      const len = Math.hypot(dx, dy, dz) || 1e-9;
      sum += (dx * nm[f * 3] + dy * nm[f * 3 + 1] + dz * nm[f * 3 + 2]) / len;
      count++;
    }
    out[f] = count > 0 ? sum / count : 0;
  }
  return out;
}

/** A dark hole or dent (an eye hole of a button, a nostril, a seam): the sculpt says it is there and the texture is darker in it. */
export interface Pit {
  /** The palette position that holds the most of its rim. */
  inside: number;
  /** The palette positions round it, with their share of the rim. */
  around: Array<{ label: number; share: number }>;
  faces: Int32Array;
  areaPct: number;
  /** How much darker the model's own colour is in it than on its rim (lightness, 0..255). */
  darker: number;
  /** Its own colour (mean) and where it is (mean centre and normal of its faces). */
  own: [number, number, number];
  centre: [number, number, number];
  normal: [number, number, number];
}

/**
 * Dents deeper than nearly all of the model (its surface texture is not one), joined, of a
 * size between a speck and a part, and darker in the model's own colours than their rim —
 * where the sculpt and the texture agree there is a hole.
 */
export function findPits(
  labels: Int32Array,
  adjacency: FaceAdjacency,
  concavity: Float32Array,
  area: ArrayLike<number>,
  own: ArrayLike<readonly [number, number, number]>,
  geometry: CreaseGeometry,
  options: { percentile?: number; minFaces?: number; maxPct?: number; darker?: number } = {},
): Pit[] {
  const n = labels.length;
  const { offsets, neighbours } = adjacency;
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(n / 200_000));
  for (let f = 0; f < n; f += step) sample.push(concavity[f]);
  sample.sort((a, b) => a - b);
  // 0.98 and 20 found all four eye holes of the owner's skull buttons (Bvc, 11-04) and little else.
  const threshold = Math.max(1e-4, sample[Math.min(sample.length - 1, Math.floor(sample.length * (options.percentile ?? 0.98)))] ?? 0);
  const deep = new Uint8Array(n);
  for (let f = 0; f < n; f++) if (concavity[f] > threshold) deep[f] = 1;
  let total = 0;
  for (let f = 0; f < n; f++) total += area[f];
  const minFaces = options.minFaces ?? 20;
  const maxPct = options.maxPct ?? 1.5;
  const minDarker = options.darker ?? 20;
  const light = (f: number) => 0.2126 * own[f][0] + 0.7152 * own[f][1] + 0.0722 * own[f][2];
  const seen = new Uint8Array(n);
  const pits: Pit[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!deep[s] || seen[s]) continue;
    const members: number[] = [];
    const around = new Map<number, number>();
    let rim = 0;
    let rimLight = 0;
    let sum = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const a = stack.pop() as number;
      members.push(a);
      sum += area[a];
      for (let i = offsets[a]; i < offsets[a + 1]; i++) {
        const b = neighbours[i];
        if (deep[b]) {
          if (!seen[b]) {
            seen[b] = 1;
            stack.push(b);
          }
        } else {
          around.set(labels[b], (around.get(labels[b]) ?? 0) + 1);
          rim++;
          rimLight += light(b);
        }
      }
    }
    if (members.length < minFaces || (sum / total) * 100 > maxPct || rim === 0) continue;
    let inLight = 0;
    const mean: [number, number, number] = [0, 0, 0];
    const centre: [number, number, number] = [0, 0, 0];
    const normal: [number, number, number] = [0, 0, 0];
    for (const f of members) {
      inLight += light(f);
      for (let k = 0; k < 3; k++) {
        mean[k] += own[f][k];
        centre[k] += geometry.centroids[f * 3 + k];
        normal[k] += geometry.normals[f * 3 + k];
      }
    }
    const darker = rimLight / rim - inLight / members.length;
    if (darker < minDarker) continue;
    const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    const rows = [...around].map(([label, count]) => ({ label, share: count / rim })).sort((a, b) => b.share - a.share);
    pits.push({
      inside: rows[0].label,
      around: rows,
      faces: Int32Array.from(members),
      areaPct: (sum / total) * 100,
      darker,
      own: [Math.round(mean[0] / members.length), Math.round(mean[1] / members.length), Math.round(mean[2] / members.length)],
      centre: [centre[0] / members.length, centre[1] / members.length, centre[2] / members.length],
      normal: [normal[0] / len, normal[1] / len, normal[2] / len],
    });
  }
  return pits.sort((a, b) => b.areaPct - a.areaPct);
}
