import type { FaceAdjacency } from "@core/meshAdjacency";
import type { CreaseGeometry } from "./creases";

/**
 * A thing found from one point on it (11-04, the owner: "그 색깔의 영역을 정확히 파악하는 게 최우선 아니냐"):
 * the AI points at a bag's gold stripe on a picture, the app takes the face under the point and spreads
 * over the surface while the model's own colour stays that thing's — close to the colour found so far
 * and changing only a little from face to face — and stops at a fold that bends inwards, where one
 * thing meets another.  Like a magic wand on the 3D surface: the point need not be exact, the edge is.
 *
 * The colour is held to the seed's as well as to the mean so far (11-05 Tkc: a thin mouth line whose edge fades
 * into the skin let the mean creep, step by small step, over the whole face — which went the mouth's dark brown).
 */
export interface WandOptions {
  /** Lab ΔE from the region's mean colour so far a face may be (shading of one thing). */
  mean?: number;
  /** Lab ΔE from the face it is reached from (a soft texture edge is many small steps — they add up to `mean`). */
  step?: number;
  /** A fold sharper than this (1 − cos) is not crossed. */
  fold?: number;
  /** At most this many faces (a point on the wrong thing must not flood the model). */
  maxFaces?: number;
  /** Only these faces may be taken (a part and the cells round it), when given. */
  within?: Uint8Array | null;
  /** How much lightness counts in the colour distance (1 = plain ΔE; less = shading of one thing is let in). */
  lightness?: number;
}

export function wandRegion(seed: number, lab: Float32Array, adjacency: FaceAdjacency, geometry: CreaseGeometry | null, options: WandOptions = {}): Int32Array {
  const meanLimit = options.mean ?? 16;
  const stepLimit = options.step ?? 7;
  const foldLimit = options.fold ?? 0.3;
  const maxFaces = options.maxFaces ?? Infinity;
  const within = options.within ?? null;
  const lw = options.lightness ?? 1;
  const { offsets, neighbours } = adjacency;
  const n = offsets.length - 1;
  if (seed < 0 || seed >= n) return new Int32Array(0);
  const folded = (f: number, g: number): boolean => {
    if (!geometry) return false;
    const { centroids: c, normals: nm } = geometry;
    const dx = c[g * 3] - c[f * 3], dy = c[g * 3 + 1] - c[f * 3 + 1], dz = c[g * 3 + 2] - c[f * 3 + 2];
    const len = Math.hypot(dx, dy, dz) || 1e-9;
    const up = (dx * nm[f * 3] + dy * nm[f * 3 + 1] + dz * nm[f * 3 + 2]) / len;
    const down = (dx * nm[g * 3] + dy * nm[g * 3 + 1] + dz * nm[g * 3 + 2]) / len;
    if (!(up > 0.02 && down < -0.02)) return false;
    const cos = nm[f * 3] * nm[g * 3] + nm[f * 3 + 1] * nm[g * 3 + 1] + nm[f * 3 + 2] * nm[g * 3 + 2];
    return 1 - cos > foldLimit;
  };
  const de = (f: number, L: number, a: number, b: number) => Math.hypot((lab[f * 3] - L) * lw, lab[f * 3 + 1] - a, lab[f * 3 + 2] - b);
  // The mean starts from the seed and its ring (one odd face under the point does not set the colour).
  let sumL = lab[seed * 3], sumA = lab[seed * 3 + 1], sumB = lab[seed * 3 + 2], count = 1;
  for (let i = offsets[seed]; i < offsets[seed + 1]; i++) {
    const g = neighbours[i];
    if (within && !within[g]) continue;
    sumL += lab[g * 3];
    sumA += lab[g * 3 + 1];
    sumB += lab[g * 3 + 2];
    count++;
  }
  const taken = new Uint8Array(n);
  const out: number[] = [seed];
  taken[seed] = 1;
  let mL = sumL / count, mA = sumA / count, mB = sumB / count;
  const sL = mL, sA = mA, sB = mB;
  sumL = lab[seed * 3];
  sumA = lab[seed * 3 + 1];
  sumB = lab[seed * 3 + 2];
  count = 1;
  for (let head = 0; head < out.length && out.length < maxFaces; head++) {
    const f = out[head];
    for (let i = offsets[f]; i < offsets[f + 1]; i++) {
      const g = neighbours[i];
      if (taken[g] || (within && !within[g])) continue;
      if (de(g, lab[f * 3], lab[f * 3 + 1], lab[f * 3 + 2]) > stepLimit) continue;
      if (de(g, mL, mA, mB) > meanLimit || de(g, sL, sA, sB) > meanLimit) continue;
      if (folded(f, g)) continue;
      taken[g] = 1;
      out.push(g);
      sumL += lab[g * 3];
      sumA += lab[g * 3 + 1];
      sumB += lab[g * 3 + 2];
      count++;
      mL = sumL / count;
      mA = sumA / count;
      mB = sumB / count;
      if (out.length >= maxFaces) break;
    }
  }
  return Int32Array.from(out);
}

/**
 * The faces a thing pointed at covers, or null when it has no colour edge of its own there (11-05).
 *
 * A border fades into what it borders over several faces (a cream piping into a white collar): any one limit on
 * the colour either stops short or runs into the gradient, and the edge comes out wavy ("노란 테두리를 제대로 못
 * 잡네"). So, as two-colour selections go: a generous region round the point that reaches into the neighbour's
 * colour too, its colours split into two (the thing's and the neighbour's — 2-means), each face to the nearer, the
 * piece holding the point kept, and its edge smoothed. The edge falls in the middle of the fade.
 *
 * `shaded` (as the AI said: a broad thing grey in its folds) counts lightness at 0.35 — shading is one thing; a
 * thin line, rim or dot counts it fully (a mouth line is the skin's own hue, a shade darker). A region running
 * over most of the room it had, all one colour (a groove in the skin's colour), is null: painting it would paint
 * its surroundings (11-05: "입을 만들어 달라니까 얼굴을 입색으로 검게").
 */
export function markRegion(seed: number, lab: Float32Array, adjacency: FaceAdjacency, geometry: CreaseGeometry | null, within: Uint8Array | null, faceCount: number, shaded = false): Int32Array | null {
  let room = faceCount;
  if (within) {
    room = 0;
    for (let f = 0; f < within.length; f++) room += within[f];
  }
  const cap = Math.max(400, Math.min(Math.round(faceCount * 0.05), Math.round(room * 0.3)));
  const lightness = shaded ? 0.35 : 1;
  // 1. Generous: into the neighbour's colour, still stopping at folds.
  const loose = wandRegion(seed, lab, adjacency, geometry, { within, maxFaces: Math.max(cap * 2, 800), lightness, mean: 40, step: 12 });
  if (loose.length === 0) return null;
  const w = [lightness, 1, 1];
  const dist = (f: number, c: number[]) => Math.hypot((lab[f * 3] - c[0]) * w[0], lab[f * 3 + 1] - c[1], lab[f * 3 + 2] - c[2]);
  // 2. Two colours: the point's (its face and ring) and the one farthest from it, refined.
  const { offsets, neighbours } = adjacency;
  const ring = [seed];
  for (let i = offsets[seed]; i < offsets[seed + 1]; i++) ring.push(neighbours[i]);
  const mine = [0, 0, 0];
  for (const f of ring) for (let k = 0; k < 3; k++) mine[k] += lab[f * 3 + k] / ring.length;
  let far = loose[0];
  let farD = -1;
  for (const f of loose) {
    const d = dist(f, mine);
    if (d > farD) {
      farD = d;
      far = f;
    }
  }
  const other = [lab[far * 3], lab[far * 3 + 1], lab[far * 3 + 2]];
  const side = new Uint8Array(loose.length);
  for (let it = 0; it < 10; it++) {
    const sum = [[0, 0, 0, 0], [0, 0, 0, 0]];
    loose.forEach((f, i) => {
      side[i] = dist(f, mine) <= dist(f, other) ? 0 : 1;
      const s2 = sum[side[i]];
      s2[0] += lab[f * 3];
      s2[1] += lab[f * 3 + 1];
      s2[2] += lab[f * 3 + 2];
      s2[3]++;
    });
    // The point's colour moves only a little (it is what was pointed at), the other freely.
    if (sum[0][3]) for (let k = 0; k < 3; k++) mine[k] = mine[k] * 0.5 + (sum[0][k] / sum[0][3]) * 0.5;
    if (sum[1][3]) for (let k = 0; k < 3; k++) other[k] = sum[1][k] / sum[1][3];
  }
  const apart = Math.hypot((mine[0] - other[0]) * w[0], mine[1] - other[1], mine[2] - other[2]);
  // One colour all over (no second colour in reach): the region as it is.
  const member = new Uint8Array(faceCount);
  if (apart < 10) for (const f of loose) member[f] = 1;
  else loose.forEach((f, i) => (member[f] = side[i] === 0 ? 1 : 0));
  // 3. The edge smoothed: a face goes with most of its neighbours (texture speckle out, the fade's middle kept).
  const inLoose = new Uint8Array(faceCount);
  for (const f of loose) inLoose[f] = 1;
  for (let round = 0; round < 3; round++) {
    const flip: number[] = [];
    for (const f of loose) {
      let n = 0, on = 0;
      for (let i = offsets[f]; i < offsets[f + 1]; i++) {
        const g = neighbours[i];
        if (!inLoose[g]) continue;
        n++;
        on += member[g];
      }
      if (n < 2) continue;
      if (member[f] && on * 3 < n) flip.push(f);
      else if (!member[f] && on * 3 > n * 2) flip.push(f);
    }
    if (flip.length === 0) break;
    for (const f of flip) member[f] ^= 1;
  }
  // 4. The piece holding the point (another patch of that colour elsewhere in reach is not it).
  if (!member[seed]) member[seed] = 1;
  const out: number[] = [seed];
  const seen = new Uint8Array(faceCount);
  seen[seed] = 1;
  for (let head = 0; head < out.length; head++) {
    const f = out[head];
    for (let i = offsets[f]; i < offsets[f + 1]; i++) {
      const g = neighbours[i];
      if (seen[g] || !member[g]) continue;
      seen[g] = 1;
      out.push(g);
    }
  }
  return out.length > cap ? null : Int32Array.from(out);
}
