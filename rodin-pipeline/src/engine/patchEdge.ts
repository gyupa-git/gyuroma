import type { FaceAdjacency } from "@core/meshAdjacency";
import { rgbToLab } from "@core/prusaFdmMixer";
import type { RGB } from "@core/types";

/**
 * Moving the edge of a patch through the blend around it.
 *
 * An AI texture blurs the line between two colours: the faces around a patch
 * go from its colour to its neighbour's a little at a time.  Every face in a
 * band around the patch gets a score from its *original* colour (so it still
 * works after a tidy has flattened the blend): 1 like the heart of the patch,
 * 0 like the colour just beyond the band.  A threshold then decides which side
 * each face goes to — and every face ends up on one side or the other, so the
 * edge comes out sharp wherever it is put.
 *
 * Thicker: faces join through faces that join (nothing further away is pulled
 * in, however alike), the nearest rings first.  Thinner: the palest faces of
 * the patch go first — the ones most like what lies beyond — from its edge
 * inwards (no holes open), up to 70 % of it; the deepest colour stays.  At
 * the middle of the slider nothing changes.
 */
export interface PatchEdge {
  /** The patch's faces. */
  inside: Uint8Array;
  /** Faces within reach of the edge, inside and outside. */
  band: Int32Array;
  /** Per face: its position in `band`, or -1. */
  slot: Int32Array;
  /** Per band face: 1 like the patch's heart, 0 like what lies beyond. */
  score: Float32Array;
  /** Per band face: the nearest face beyond the band (outside the patch), whose colour a leaving face takes; -1 if none. */
  outer: Int32Array;
  /** Per band face: rings from the edge, outside positive (1 = touching the patch), inside negative. */
  ring: Int8Array;
  /** The threshold at which the patch stays as it is. */
  start: number;
  /** How many rings deep the patch goes (capped at the reach). */
  depth: number;
  /** The patch's own band faces (positions in `band`) in the order the thin side takes them: palest first, the edge first among equals. */
  peel: Int32Array;
  /** A face deep inside the patch (it stays when the edge moves). */
  heart: number;
}

const REACH = 14;

export function measurePatchEdge(adjacency: FaceAdjacency, insideFaces: ArrayLike<number>, original: ArrayLike<RGB>, reach = REACH): PatchEdge | null {
  const { offsets, neighbours, faceCount } = adjacency;
  if (insideFaces.length === 0) return null;
  const inside = new Uint8Array(faceCount);
  for (let i = 0; i < insideFaces.length; i++) inside[insideFaces[i]] = 1;

  // Rings from the edge: outside up to reach + 1 (the faces just beyond the band), inside up to reach.
  const rings = new Int16Array(faceCount);
  let outerFrontier: number[] = [];
  let innerFrontier: number[] = [];
  for (let i = 0; i < insideFaces.length; i++) {
    const f = insideFaces[i];
    for (let k = offsets[f]; k < offsets[f + 1]; k++) {
      const g = neighbours[k];
      if (inside[g]) continue;
      if (rings[f] === 0) {
        rings[f] = -1;
        innerFrontier.push(f);
      }
      if (rings[g] === 0) {
        rings[g] = 1;
        outerFrontier.push(g);
      }
    }
  }
  if (innerFrontier.length === 0) return null;
  for (let r = 2; r <= reach + 1 && outerFrontier.length > 0; r++) {
    const next: number[] = [];
    for (const f of outerFrontier)
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        if (inside[g] || rings[g] !== 0) continue;
        rings[g] = r;
        next.push(g);
      }
    outerFrontier = next;
  }
  let deepest = 1;
  for (let r = 2; r <= reach && innerFrontier.length > 0; r++) {
    const next: number[] = [];
    for (const f of innerFrontier)
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        if (!inside[g] || rings[g] !== 0) continue;
        rings[g] = -r;
        next.push(g);
      }
    if (next.length > 0) deepest = r;
    innerFrontier = next;
  }

  // The band, and the faces just beyond it (where a leaving face looks for its colour).
  const band: number[] = [];
  const seeds: number[] = [];
  let farthest = 0;
  for (let f = 0; f < faceCount; f++) {
    const r = rings[f];
    if (r !== 0 && Math.abs(r) <= reach) band.push(f);
    if (r > farthest) farthest = r;
  }
  for (let f = 0; f < faceCount; f++) if (rings[f] > 0 && rings[f] === farthest) seeds.push(f);
  const slot = new Int32Array(faceCount).fill(-1);
  band.forEach((f, i) => (slot[f] = i));

  // Each band face's nearest seed, spreading through the band from beyond it.
  const outer = new Int32Array(band.length).fill(-1);
  let frontier = seeds.slice();
  const owner = new Int32Array(faceCount).fill(-1);
  for (const s of seeds) owner[s] = s;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const f of frontier)
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        if (owner[g] >= 0 || slot[g] < 0) continue;
        owner[g] = owner[f];
        outer[slot[g]] = owner[f];
        next.push(g);
      }
    frontier = next;
  }

  // The heart of the patch: its deepest faces (and any beyond reach).
  const heartFaces: number[] = [];
  for (let i = 0; i < insideFaces.length; i++) {
    const f = insideFaces[i];
    if (rings[f] === 0 || rings[f] === -deepest) heartFaces.push(f);
  }
  const heartLab = meanLab(heartFaces, original);
  const score = new Float32Array(band.length);
  const ring = new Int8Array(band.length);
  for (let i = 0; i < band.length; i++) {
    const f = band[i];
    ring[i] = rings[f];
    const beyond = outer[i] >= 0 ? labOf(original[outer[i]]) : null;
    if (!beyond) {
      score[i] = inside[f] ? 1 : 0;
      continue;
    }
    const lab = labOf(original[f]);
    const ax = heartLab[0] - beyond[0];
    const ay = heartLab[1] - beyond[1];
    const az = heartLab[2] - beyond[2];
    const length = ax * ax + ay * ay + az * az;
    // Hardly any difference between the two sides: nothing to move.
    score[i] = length < 4 ? (inside[f] ? 1 : 0) : Math.max(-1, Math.min(2, ((lab[0] - beyond[0]) * ax + (lab[1] - beyond[1]) * ay + (lab[2] - beyond[2]) * az) / length));
  }

  // The threshold that splits the band most like the patch is now.
  let start = 0.5;
  let fewest = Infinity;
  for (let step = 2; step <= 98; step++) {
    const threshold = step / 100;
    let wrong = 0;
    for (let i = 0; i < band.length; i++) if ((score[i] >= threshold) !== (inside[band[i]] === 1)) wrong++;
    if (wrong < fewest || (wrong === fewest && Math.abs(threshold - 0.5) < Math.abs(start - 0.5))) {
      fewest = wrong;
      start = threshold;
    }
  }

  const own: number[] = [];
  for (let i = 0; i < band.length; i++) if (inside[band[i]] && outer[i] >= 0 && band[i] !== heartFaces[0]) own.push(i);
  own.sort((a, b) => score[a] - score[b] || ring[b] - ring[a]);
  return { inside, band: Int32Array.from(band), slot, score, outer, ring, start, depth: deepest, peel: Int32Array.from(own), heart: heartFaces[0] ?? insideFaces[0] };
}

function labOf(rgb: RGB): [number, number, number] {
  const lab = rgbToLab(rgb);
  return [lab.L, lab.a, lab.b];
}

function meanLab(faces: number[], original: ArrayLike<RGB>): [number, number, number] {
  let l = 0;
  let a = 0;
  let b = 0;
  for (const f of faces) {
    const lab = labOf(original[f]);
    l += lab[0];
    a += lab[1];
    b += lab[2];
  }
  const n = Math.max(1, faces.length);
  return [l / n, a / n, b / n];
}

/** The most of a patch the thin side takes, palest first. */
const MOST_PEELED = 0.7;

/**
 * Which faces join the patch and which leave it with the slider at `value`
 * (0 thinnest … 50 as it is … 100 thickest).  Going thicker never takes faces
 * away, going thinner never adds any, and at 50 nothing changes.
 */
export function edgeChanges(edge: PatchEdge, adjacency: FaceAdjacency, value: number): { join: number[]; leave: number[] } {
  const { offsets, neighbours } = adjacency;
  const { band, slot, score, ring, inside, start, peel } = edge;
  const v = Math.max(0, Math.min(100, value));
  const join: number[] = [];
  const leave: number[] = [];
  if (v > 50) {
    // Thicker: outward from the patch, through faces at least this much like it, a few rings first.
    const threshold = start - ((start - 0.12) * (v - 50)) / 50;
    const rings = edgeRings(v);
    const joins = (i: number) => !inside[band[i]] && ring[i] <= rings && Math.min(score[i], start - 1e-6) >= threshold;
    const taken = new Uint8Array(band.length);
    const stack: number[] = [];
    for (let i = 0; i < band.length; i++)
      if (ring[i] === 1 && joins(i)) {
        taken[i] = 1;
        stack.push(band[i]);
      }
    while (stack.length > 0) {
      const f = stack.pop() as number;
      join.push(f);
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const i = slot[neighbours[k]];
        if (i < 0 || taken[i] || !joins(i)) continue;
        taken[i] = 1;
        stack.push(band[i]);
      }
    }
  } else if (v < 50 && peel.length > 0) {
    // Thinner: as many of the palest faces as the slider says, inward from the edge.
    const count = Math.floor(((50 - v) / 50) * MOST_PEELED * (peel.length + 1));
    const allowed = new Uint8Array(band.length);
    for (let k = 0; k < Math.min(count, peel.length); k++) allowed[peel[k]] = 1;
    const leaves = (i: number) => allowed[i] === 1;
    const taken = new Uint8Array(band.length);
    const stack: number[] = [];
    for (let i = 0; i < band.length; i++)
      if (ring[i] === -1 && leaves(i)) {
        taken[i] = 1;
        stack.push(band[i]);
      }
    while (stack.length > 0) {
      const f = stack.pop() as number;
      leave.push(f);
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const i = slot[neighbours[k]];
        if (i < 0 || taken[i] || !leaves(i)) continue;
        taken[i] = 1;
        stack.push(band[i]);
      }
    }
  }
  return { join, leave };
}

/**
 * How many rings from the edge the thick side reaches: a little way first, the
 * whole band only at the end — so the patch grows evenly and a line further
 * off joins only when pushed all the way.
 */
export function edgeRings(value: number, reach = REACH): number {
  const away = Math.abs(Math.max(0, Math.min(100, value)) - 50) / 50;
  return away === 0 ? 0 : Math.max(1, Math.round(away * reach));
}
