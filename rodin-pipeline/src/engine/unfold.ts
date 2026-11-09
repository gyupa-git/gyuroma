/**
 * One patch laid flat in one piece (11-05, the owner: "이 한 조각을 눌렀을 때 그 한 조각이 그대로 펼쳐진 느낌으로 —
 * 유명 툴에서 하는 방식 그대로 쓰는 게 좋으려나? 선배님들이 다 고심해서 만든 펴는 방식일 거 아니냐"): least squares
 * conformal maps (Lévy, Petitjean, Ray, Maillot 2002 — Blender's Unwrap "Conformal"). Each connected piece of the
 * patch is flattened keeping its angles as well as it can; a piece with no edge of its own (closed, like a ball)
 * is cut in two first, as a seam would.
 *
 * Per triangle with corners z0, z1, z2 (complex, in its own plane), the map U is conformal when
 * (z2 − z1)·U0 + (z0 − z2)·U1 + (z1 − z0)·U2 = 0; the sum of these squared over the triangles (each weighted by
 * 1/√(2·area)) is made as small as it goes, two far points pinned. Solved by conjugate gradients from the patch
 * seen straight on (the old colour map's view), so it starts near and comes out the same way up.
 *
 * The conformal layout is then made as rigid as possible (rigid): keeping angles alone shrinks whatever lies behind
 * a narrow neck (Tkc's face below its eye came out a worm, 11-05), and the owner's word was "로딩 천천히 해도 되니까
 * 잘못되는 걸로 하지 말고" — so each triangle is given back its own size and shape, as the piece is on the model.
 *
 * With the faces round a pick (`core`), the pick is laid flat on its own and held there while the faces round it
 * are laid out about it (conformalAround): flattened together, the band that wraps round to the back of the pick
 * made the whole nearly closed, and the pick took the squeeze (Tkc's ribbon, 11-05: a quarter of its area).
 */

export interface UnfoldResult {
  /** UV of each triangle's three corners (6 numbers a triangle), in model units. */
  uv: Float32Array;
  /** Island of each triangle (0-based; a piece cut where it would lie over itself, islandsOf), −1 for a face round the pick left off. */
  piece: Int32Array;
  pieces: number;
  /** Whether its long solves ran on the graphics card (gpuSolve.ts). */
  onCard?: boolean;
}

/**
 * What does the long solves: the conformal error made small (`level`) and the layout made rigid (`rigid`), each in
 * place on `x`.  Here on the processor (cpuSolver); gpuSolve.ts hands the big ones to the graphics card (11-05, the
 * owner on 70 s for Tkc's hair: "아무리 줄었다고 하지만 조각하나 펴는데 70초면 누가 사용하겠어").
 */
export interface Solver {
  level(P: Float64Array, F: Int32Array, m: number, x: Float64Array, maxIterations: number, tolerance: number, onProgress?: (done: number, total: number) => void, held?: Uint8Array): Promise<void>;
  rigid(P: Float64Array, F: Int32Array, m: number, x: Float64Array, rounds: number, steps: number, onProgress?: (share: number) => void, held?: Uint8Array): Promise<void>;
}

export const cpuSolver: Solver = {
  async level(P, F, m, x, maxIterations, tolerance, onProgress, held) {
    solveLevel(P, F, m, x, maxIterations, tolerance, onProgress, held);
  },
  async rigid(P, F, m, x, rounds, steps, onProgress, held) {
    rigid(P, F, m, x, rounds, steps, onProgress, held);
  },
};

export interface UnfoldOptions {
  /** Most solver steps per piece. */
  maxIterations?: number;
  /** Stop when the remaining error falls to this share of the first. */
  tolerance?: number;
  onProgress?: (done: number, total: number) => void;
  /** How many of the triangles, from the first, are the pick; the rest are faces round it (conformalAround). */
  core?: number;
  /** Centres (xyz) of faces near the pick that are not laid out but may lie over it (coveredFaces). */
  occluders?: Float64Array;
  /** Who does the long solves (cpuSolver when not given). */
  solver?: Solver;
}

/**
 * Triangles (local vertex ids, 3 a triangle) grouped into pieces joined where they share a corner — a patch
 * of a speckled colour touches itself at single points all over (11-05 Bvc's body: 1,209 pieces by edges);
 * the solver takes a shared corner as it takes a shared edge.
 */
function piecesOf(triangles: Int32Array, vertexCount: number, members: Int32Array): Int32Array[] {
  const owner = new Int32Array(vertexCount).fill(-1);
  const parent = new Int32Array(members.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < members.length; i++) {
    const t = members[i];
    for (let k = 0; k < 3; k++) {
      const a = triangles[t * 3 + k];
      const other = owner[a];
      if (other < 0) owner[a] = i;
      else {
        const ra = find(i), rb = find(other);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < members.length; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(members[i]);
  }
  return [...groups.values()].map((g) => Int32Array.from(g));
}

/** Edges used by one triangle of the piece only: its border. */
function borderVertices(triangles: Int32Array, vertexCount: number, piece: Int32Array): Set<number> {
  const count = new Map<number, number>();
  for (const t of piece)
    for (let k = 0; k < 3; k++) {
      const a = triangles[t * 3 + k];
      const b = triangles[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  const out = new Set<number>();
  for (const [key, n] of count)
    if (n === 1) {
      out.add(Math.floor(key / vertexCount));
      out.add(key % vertexCount);
    }
  return out;
}

/** A closed piece cut in two across its longest side (where the cut lies matters less than that there is one). */
function cutInTwo(positions: Float64Array, triangles: Int32Array, piece: Int32Array): [Int32Array, Int32Array] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const centre = new Float64Array(piece.length * 3);
  piece.forEach((t, i) => {
    for (let d = 0; d < 3; d++) {
      const c = (positions[triangles[t * 3] * 3 + d] + positions[triangles[t * 3 + 1] * 3 + d] + positions[triangles[t * 3 + 2] * 3 + d]) / 3;
      centre[i * 3 + d] = c;
      if (c < lo[d]) lo[d] = c;
      if (c > hi[d]) hi[d] = c;
    }
  });
  let axis = 0;
  for (let d = 1; d < 3; d++) if (hi[d] - lo[d] > hi[axis] - lo[axis]) axis = d;
  const middle = (lo[axis] + hi[axis]) / 2;
  const a: number[] = [];
  const b: number[] = [];
  piece.forEach((t, i) => (centre[i * 3 + axis] < middle ? a : b).push(t));
  return [Int32Array.from(a), Int32Array.from(b)];
}

/** The piece seen straight on: the plane facing its area-weighted normal (or, a tube, across its thinnest side). */
function straightOn(positions: Float64Array, triangles: Int32Array, piece: Int32Array): { right: number[]; up: number[] } {
  let nx = 0, ny = 0, nz = 0, area = 0;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of piece) {
    const i0 = triangles[t * 3] * 3, i1 = triangles[t * 3 + 1] * 3, i2 = triangles[t * 3 + 2] * 3;
    const ux = positions[i1] - positions[i0], uy = positions[i1 + 1] - positions[i0 + 1], uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0], vy = positions[i2 + 1] - positions[i0 + 1], vz = positions[i2 + 2] - positions[i0 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    nx += cx;
    ny += cy;
    nz += cz;
    area += Math.hypot(cx, cy, cz);
    for (const i of [i0, i1, i2]) for (let d = 0; d < 3; d++) {
      if (positions[i + d] < lo[d]) lo[d] = positions[i + d];
      if (positions[i + d] > hi[d]) hi[d] = positions[i + d];
    }
  }
  let len = Math.hypot(nx, ny, nz);
  let d: number[];
  if (len > 0.25 * area) d = [nx / len, ny / len, nz / len];
  else {
    // A tube or a band round something: look across its thinnest side.
    let thin = 0;
    for (let k = 1; k < 3; k++) if (hi[k] - lo[k] < hi[thin] - lo[thin]) thin = k;
    d = [0, 0, 0];
    d[thin] = 1;
  }
  // As the colour map does: Z up where it can.
  let up0 = Math.abs(d[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  let right = [up0[1] * d[2] - up0[2] * d[1], up0[2] * d[0] - up0[0] * d[2], up0[0] * d[1] - up0[1] * d[0]];
  len = Math.hypot(right[0], right[1], right[2]);
  if (len < 1e-9) {
    up0 = [1, 0, 0];
    right = [up0[1] * d[2] - up0[2] * d[1], up0[2] * d[0] - up0[0] * d[2], up0[0] * d[1] - up0[1] * d[0]];
    len = Math.hypot(right[0], right[1], right[2]) || 1;
  }
  right = right.map((v) => v / len);
  const up = [d[1] * right[2] - d[2] * right[1], d[2] * right[0] - d[0] * right[2], d[0] * right[1] - d[1] * right[0]];
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  return { right, up: up.map((v) => v / ul) };
}

/** Below this many triangles a piece is solved as it is; above, a coarser copy of it is solved first (multilevel). */
const COARSE_ABOVE = 30_000;
/** Solver steps on a level that starts from the coarser level's answer (most of the work is done there). */
const REFINE_STEPS = 250;
/**
 * Rounds of making the conformal layout rigid, and solver steps in each (rigid).  Measured on Tkc's face (112 k
 * faces, 11-05): 4 × 400 left 1 triangle turned over and areas within 21 % (rms of the log) in 3.3 s; 16 × 200
 * took twice as long for no better, 24 × 60 left 82 turned over — the steps matter more than the rounds.
 */
const RIGID_ROUNDS = 4;
const RIGID_STEPS = 400;

/** The border vertices of a piece given as local triangles. */
function borderOf(F: Int32Array, m: number): number[] {
  const count = new Map<number, number>();
  for (let t = 0; t < F.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = F[t + k], b = F[t + ((k + 1) % 3)];
      const key = a < b ? a * m + b : b * m + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  const out = new Set<number>();
  for (const [key, n] of count)
    if (n === 1) {
      out.add(Math.floor(key / m));
      out.add(key % m);
    }
  return [...out];
}

/**
 * A coarser copy of a piece: each vertex gathered with its untaken neighbours (the mesh's own edges decide, so
 * two sides of a thin wall never merge), the triangles whose three corners fall in three different groups kept.
 * Solving this first and starting the full piece from its answer is how big parametrisations are done fast —
 * the smooth, far-reaching part of the solution is cheap on the coarse copy and slow to reach on the full one.
 */
function coarsen(P: Float64Array, F: Int32Array, m: number): { P: Float64Array; F: Int32Array; m: number; of: Int32Array } {
  const deg = new Int32Array(m + 1);
  for (let t = 0; t < F.length; t += 3) for (let k = 0; k < 3; k++) deg[F[t + k] + 1] += 2;
  for (let i = 0; i < m; i++) deg[i + 1] += deg[i];
  const nb = new Int32Array(deg[m]);
  const fill = deg.slice(0, m);
  for (let t = 0; t < F.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = F[t + k], b = F[t + ((k + 1) % 3)], c = F[t + ((k + 2) % 3)];
      nb[fill[a]++] = b;
      nb[fill[a]++] = c;
    }
  const of = new Int32Array(m).fill(-1);
  let n = 0;
  for (let v = 0; v < m; v++) {
    if (of[v] >= 0) continue;
    const a = n++;
    of[v] = a;
    for (let i = deg[v]; i < deg[v + 1]; i++) if (of[nb[i]] < 0) of[nb[i]] = a;
  }
  const cP = new Float64Array(n * 3);
  const cnt = new Float64Array(n);
  for (let v = 0; v < m; v++) {
    const a = of[v];
    cP[a * 3] += P[v * 3];
    cP[a * 3 + 1] += P[v * 3 + 1];
    cP[a * 3 + 2] += P[v * 3 + 2];
    cnt[a]++;
  }
  for (let a = 0; a < n; a++) for (let d = 0; d < 3; d++) cP[a * 3 + d] /= cnt[a];
  const seen = new Set<number>();
  const cF: number[] = [];
  for (let t = 0; t < F.length; t += 3) {
    const a = of[F[t]], b = of[F[t + 1]], c = of[F[t + 2]];
    if (a === b || b === c || a === c) continue;
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), md = a + b + c - lo - hi;
    const key = (lo * n + md) * n + hi;
    if (seen.has(key)) continue;
    seen.add(key);
    cF.push(a, b, c);
  }
  return { P: cP, F: Int32Array.from(cF), m: n, of };
}

/** Two far points of a piece's border (all its vertices, when it has no border) in the layout `x`. */
function twoFarPoints(F: Int32Array, m: number, x: Float64Array): [number, number] {
  const border = borderOf(F, m);
  const pool = border.length >= 2 ? border : Array.from({ length: m }, (_, i) => i);
  let cxs = 0, cys = 0;
  for (const i of pool) {
    cxs += x[i];
    cys += x[m + i];
  }
  cxs /= pool.length;
  cys /= pool.length;
  let pa = pool[0], best = -1;
  for (const i of pool) {
    const d = (x[i] - cxs) ** 2 + (x[m + i] - cys) ** 2;
    if (d > best) {
      best = d;
      pa = i;
    }
  }
  let pb = pool[0];
  best = -1;
  for (const i of pool) {
    const d = (x[i] - x[pa]) ** 2 + (x[m + i] - x[m + pa]) ** 2;
    if (d > best) {
      best = d;
      pb = i;
    }
  }
  return [pa, pb];
}

/**
 * The conformal error's terms over local triangles F (vertices P): each triangle's coefficients (1/√(2·area) taken
 * in), the diagonal, and which of the 2m entries (u then v) are free — not held, nor one of the two far border points
 * pinned when nothing is held.  Shared by the solve here and the graphics card's (gpuSolve.ts).
 */
export function lscmSystem(P: Float64Array, F: Int32Array, m: number, x: Float64Array, held?: Uint8Array): { ca: Float64Array; cb: Float64Array; diag: Float64Array; free: Uint8Array } {
  const T = F.length / 3;
  // Each triangle's coefficients, 1/√(2·area) taken in.
  const ca = new Float64Array(T * 3);
  const cb = new Float64Array(T * 3);
  const diag = new Float64Array(m);
  for (let i = 0; i < T; i++) {
    const g0 = F[i * 3], g1 = F[i * 3 + 1], g2 = F[i * 3 + 2];
    const e1x = P[g1 * 3] - P[g0 * 3], e1y = P[g1 * 3 + 1] - P[g0 * 3 + 1], e1z = P[g1 * 3 + 2] - P[g0 * 3 + 2];
    const e2x = P[g2 * 3] - P[g0 * 3], e2y = P[g2 * 3 + 1] - P[g0 * 3 + 1], e2z = P[g2 * 3 + 2] - P[g0 * 3 + 2];
    const l1 = Math.hypot(e1x, e1y, e1z);
    if (l1 < 1e-12) continue;
    const x1 = l1;
    const x2 = (e1x * e2x + e1y * e2y + e1z * e2z) / l1;
    const y2 = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / l1;
    const twice = x1 * y2;
    if (twice < 1e-14) continue;
    const s = 1 / Math.sqrt(twice);
    // W0 = z2 − z1, W1 = z0 − z2, W2 = z1 − z0, with z0 = 0, z1 = x1, z2 = x2 + i·y2.
    const wa = [x2 - x1, -x2, x1];
    const wb = [y2, -y2, 0];
    for (let k = 0; k < 3; k++) {
      ca[i * 3 + k] = wa[k] * s;
      cb[i * 3 + k] = wb[k] * s;
      diag[F[i * 3 + k]] += (wa[k] * wa[k] + wb[k] * wb[k]) * s * s;
    }
  }
  const free = new Uint8Array(2 * m).fill(1);
  // Vertices held where they are (the pick, with the faces round it laid out about it); else two far points of its
  // border pinned where they are now (scale and turn fixed).
  if (held) {
    for (let i = 0; i < m; i++) if (held[i]) free[i] = free[m + i] = 0;
  } else for (const i of twoFarPoints(F, m, x)) free[i] = free[m + i] = 0;
  return { ca, cb, diag, free };
}

/** The conformal error made as small as it goes for local triangles F over vertices P, from `x` (u then v), in place. */
function solveLevel(P: Float64Array, F: Int32Array, m: number, x: Float64Array, maxIterations: number, tolerance: number, onProgress?: (done: number, total: number) => void, held?: Uint8Array): void {
  const T = F.length / 3;
  const { ca, cb, diag, free } = lscmSystem(P, F, m, x, held);
  // N·p = Aᵀ(A·p): the conformal error's gradient, free entries only.
  const r1 = new Float64Array(T);
  const r2 = new Float64Array(T);
  const apply = (p: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let i = 0, o = 0; i < T; i++, o += 3) {
      const j0 = F[o], j1 = F[o + 1], j2 = F[o + 2];
      const a0 = ca[o], a1 = ca[o + 1], a2 = ca[o + 2];
      const b0 = cb[o], b1 = cb[o + 1], b2 = cb[o + 2];
      r1[i] = a0 * p[j0] - b0 * p[m + j0] + a1 * p[j1] - b1 * p[m + j1] + a2 * p[j2] - b2 * p[m + j2];
      r2[i] = b0 * p[j0] + a0 * p[m + j0] + b1 * p[j1] + a1 * p[m + j1] + b2 * p[j2] + a2 * p[m + j2];
    }
    for (let i = 0, o = 0; i < T; i++, o += 3) {
      const s1 = r1[i], s2 = r2[i];
      for (let k = 0; k < 3; k++) {
        const j = F[o + k];
        const a = ca[o + k], b = cb[o + k];
        out[j] += a * s1 + b * s2;
        out[m + j] += -b * s1 + a * s2;
      }
    }
    for (let i = 0; i < 2 * m; i++) if (!free[i]) out[i] = 0;
  };
  // Conjugate gradients (Jacobi preconditioned) on the free entries.
  const r = new Float64Array(2 * m);
  apply(x, r);
  for (let i = 0; i < 2 * m; i++) r[i] = -r[i];
  const pre = new Float64Array(2 * m);
  for (let i = 0; i < 2 * m; i++) pre[i] = free[i] && diag[i % m] > 0 ? 1 / diag[i % m] : 0;
  const z = new Float64Array(2 * m);
  for (let i = 0; i < 2 * m; i++) z[i] = r[i] * pre[i];
  const p = z.slice();
  const q = new Float64Array(2 * m);
  let rz = 0;
  for (let i = 0; i < 2 * m; i++) rz += r[i] * z[i];
  const first = Math.sqrt(rz) || 1;
  for (let it = 0; it < maxIterations && Math.sqrt(Math.abs(rz)) > tolerance * first; it++) {
    apply(p, q);
    let pq = 0;
    for (let i = 0; i < 2 * m; i++) pq += p[i] * q[i];
    if (!(pq > 0)) break;
    const alpha = rz / pq;
    let next = 0;
    for (let i = 0; i < 2 * m; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * q[i];
      z[i] = r[i] * pre[i];
      next += r[i] * z[i];
    }
    const beta = next / rz;
    rz = next;
    for (let i = 0; i < 2 * m; i++) p[i] = z[i] + beta * p[i];
    if (it % 25 === 0) onProgress?.(it, maxIterations);
  }
}

/**
 * Whether local triangles F over m vertices hang together through shared corners.  A vertex no triangle uses is
 * let be (a coarse group left with no triangle of its own: it keeps its start, and the full piece's solve puts it
 * right); a part cut off is not.
 */
function onePiece(F: Int32Array, m: number): boolean {
  const parent = new Int32Array(m);
  for (let i = 0; i < m; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const used = new Uint8Array(m);
  for (let t = 0; t < F.length; t += 3) {
    used[F[t]] = used[F[t + 1]] = used[F[t + 2]] = 1;
    const a = find(F[t]);
    const b = find(F[t + 1]);
    if (a !== b) parent[a] = b;
    const c = find(F[t + 2]);
    const d = find(F[t]);
    if (c !== d) parent[c] = d;
  }
  let roots = 0;
  for (let i = 0; i < m; i++) if (used[i] && find(i) === i) roots++;
  return roots === 1;
}

/**
 * The as-rigid-as-possible terms over local triangles F (vertices P): each triangle flat in its own plane (qx, qy a
 * corner), the cotangent weight of the edge across each corner (w), the Jacobi preconditioner (0 for held vertices)
 * and the edges once each with their weights summed.  Shared by the solve here and the graphics card's (gpuSolve.ts).
 */
export function arapSystem(P: Float64Array, F: Int32Array, m: number, held?: Uint8Array): { qx: Float64Array; qy: Float64Array; w: Float64Array; pre: Float64Array; eA: Int32Array; eB: Int32Array; eW: Float64Array } {
  const T = F.length / 3;
  // Each triangle flat in its own plane, corners (0,0), (x1,0), (x2,y2); half the cotangent of each corner's angle
  // weighs the edge across from it.
  const qx = new Float64Array(T * 3);
  const qy = new Float64Array(T * 3);
  const w = new Float64Array(T * 3);
  const diag = new Float64Array(m);
  for (let i = 0; i < T; i++) {
    const g0 = F[i * 3], g1 = F[i * 3 + 1], g2 = F[i * 3 + 2];
    const e1x = P[g1 * 3] - P[g0 * 3], e1y = P[g1 * 3 + 1] - P[g0 * 3 + 1], e1z = P[g1 * 3 + 2] - P[g0 * 3 + 2];
    const e2x = P[g2 * 3] - P[g0 * 3], e2y = P[g2 * 3 + 1] - P[g0 * 3 + 1], e2z = P[g2 * 3 + 2] - P[g0 * 3 + 2];
    const x1 = Math.hypot(e1x, e1y, e1z);
    if (x1 < 1e-12) continue;
    const x2 = (e1x * e2x + e1y * e2y + e1z * e2z) / x1;
    const y2 = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / x1;
    if (x1 * y2 < 1e-14) continue;
    qx[i * 3 + 1] = x1;
    qx[i * 3 + 2] = x2;
    qy[i * 3 + 2] = y2;
    const cot = [x2 / y2, (x1 - x2) / y2, (y2 * y2 - x2 * (x1 - x2)) / (x1 * y2)];
    for (let k = 0; k < 3; k++) {
      const wk = cot[k] / 2;
      w[i * 3 + k] = wk;
      diag[F[i * 3 + ((k + 1) % 3)]] += wk;
      diag[F[i * 3 + ((k + 2) % 3)]] += wk;
    }
  }
  // Nothing held: the layout may slide as a whole, which the solve leaves as it was (holding one corner made the
  // solve crawl next to it and turned triangles over there — 99 on a 500 k-face tube, 0 without, 11-05).
  const pre = new Float64Array(2 * m);
  // A held vertex (held) has no step: the solve moves the others round it.
  for (let i = 0; i < 2 * m; i++) pre[i] = diag[i % m] > 0 && !held?.[i % m] ? 1 / diag[i % m] : 0;
  // The edges once each, the two triangles' weights summed (half the work of going round the triangles).
  const slot = new Map<number, number>();
  const ea: number[] = [];
  const eb: number[] = [];
  const ewl: number[] = [];
  for (let o = 0; o < T * 3; o += 3)
    for (let k = 0; k < 3; k++) {
      const wk = w[o + k];
      if (wk === 0) continue;
      const a = F[o + ((k + 1) % 3)], b = F[o + ((k + 2) % 3)];
      const key = a < b ? a * m + b : b * m + a;
      const at = slot.get(key);
      if (at === undefined) {
        slot.set(key, ea.length);
        ea.push(a);
        eb.push(b);
        ewl.push(wk);
      } else ewl[at] += wk;
    }
  slot.clear();
  return { qx, qy, w, pre, eA: Int32Array.from(ea), eB: Int32Array.from(eb), eW: Float64Array.from(ewl) };
}

/**
 * As rigid as possible (Liu, Zhang, Xu, Gotsman, Gortler 2008, "A Local/Global Approach to Mesh
 * Parameterization" — libigl's ARAP; Blender's "Minimum Stretch" refines the same idea): from the conformal
 * layout, each round turns every triangle to the best fit of its own flat shape (local), then lays all of them
 * out again as close to those as they go together (global, a cotangent Poisson solve).  The conformal layout
 * keeps angles but can shrink a part behind a narrow neck to nothing (Tkc's face below its eye, 11-05); this
 * gives it back its size, so the piece looks as it does on the model.
 */
function rigid(P: Float64Array, F: Int32Array, m: number, x: Float64Array, rounds: number, steps: number, onProgress?: (share: number) => void, held?: Uint8Array): void {
  const T = F.length / 3;
  const { qx, qy, w, pre, eA, eB, eW } = arapSystem(P, F, m, held);
  const E = eA.length;
  const apply = (p: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let e = 0; e < E; e++) {
      const a = eA[e], b = eB[e], we = eW[e];
      const du = we * (p[a] - p[b]), dv = we * (p[m + a] - p[m + b]);
      out[a] += du;
      out[b] -= du;
      out[m + a] += dv;
      out[m + b] -= dv;
    }
  };
  const rhs = new Float64Array(2 * m);
  const r = new Float64Array(2 * m);
  const z = new Float64Array(2 * m);
  const p = new Float64Array(2 * m);
  const q = new Float64Array(2 * m);
  for (let round = 0; round < rounds; round++) {
    // Local: each triangle's best turn.  Global: the Poisson right-hand side from the turned triangles.
    rhs.fill(0);
    for (let i = 0, o = 0; i < T; i++, o += 3) {
      let s00 = 0, s01 = 0, s10 = 0, s11 = 0;
      for (let k = 0; k < 3; k++) {
        const wk = w[o + k];
        if (wk === 0) continue;
        const ka = (k + 1) % 3, kb = (k + 2) % 3;
        const a = F[o + ka], b = F[o + kb];
        const du = x[a] - x[b], dv = x[m + a] - x[m + b];
        const ex = qx[o + ka] - qx[o + kb], ey = qy[o + ka] - qy[o + kb];
        s00 += wk * du * ex;
        s01 += wk * du * ey;
        s10 += wk * dv * ex;
        s11 += wk * dv * ey;
      }
      const angle = Math.atan2(s10 - s01, s00 + s11);
      const c = Math.cos(angle), s = Math.sin(angle);
      for (let k = 0; k < 3; k++) {
        const wk = w[o + k];
        if (wk === 0) continue;
        const ka = (k + 1) % 3, kb = (k + 2) % 3;
        const a = F[o + ka], b = F[o + kb];
        const ex = qx[o + ka] - qx[o + kb], ey = qy[o + ka] - qy[o + kb];
        const ru = wk * (c * ex - s * ey), rv = wk * (s * ex + c * ey);
        rhs[a] += ru;
        rhs[b] -= ru;
        rhs[m + a] += rv;
        rhs[m + b] -= rv;
      }
    }
    let bb = 0;
    for (let i = 0; i < 2 * m; i++) bb += rhs[i] * rhs[i] * pre[i];
    // Conjugate gradients from where the layout is now.
    apply(x, q);
    let rz = 0;
    for (let i = 0; i < 2 * m; i++) {
      r[i] = rhs[i] - q[i];
      z[i] = r[i] * pre[i];
      p[i] = z[i];
      rz += r[i] * z[i];
    }
    for (let it = 0; it < steps && rz > 1e-10 * bb; it++) {
      apply(p, q);
      let pq = 0;
      for (let i = 0; i < 2 * m; i++) pq += p[i] * q[i];
      if (!(pq > 0)) break;
      const alpha = rz / pq;
      let next = 0;
      for (let i = 0; i < 2 * m; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * q[i];
        z[i] = r[i] * pre[i];
        next += r[i] * z[i];
      }
      const beta = next / rz;
      rz = next;
      for (let i = 0; i < 2 * m; i++) p[i] = z[i] + beta * p[i];
    }
    onProgress?.((round + 1) / rounds);
  }
}

/** Multilevel: a big piece's coarser copy solved first (recursively), its answer carried up as the start. */
async function solveMultilevel(P: Float64Array, F: Int32Array, m: number, x: Float64Array, options: UnfoldOptions, depth: number): Promise<void> {
  const solver = options.solver ?? cpuSolver;
  const T = F.length / 3;
  if (T > COARSE_ABOVE && depth < 10) {
    const c = coarsen(P, F, m);
    // Only a coarse copy in one piece: a narrow neck (between an eye and the nose) can come apart on it, and the
    // part cut off then floats anywhere — what came out as a worm for Tkc's face (11-05).
    if (c.m < m * 0.75 && c.F.length >= 3 && onePiece(c.F, c.m)) {
      // The coarse start: the mean of its vertices' starts.
      const cx = new Float64Array(2 * c.m);
      const cnt = new Float64Array(c.m);
      for (let v = 0; v < m; v++) {
        cx[c.of[v]] += x[v];
        cx[c.m + c.of[v]] += x[m + v];
        cnt[c.of[v]]++;
      }
      for (let a = 0; a < c.m; a++) {
        cx[a] /= cnt[a];
        cx[c.m + a] /= cnt[a];
      }
      const mean = cx.slice();
      await solveMultilevel(c.P, c.F, c.m, cx, depth === 0 ? { ...options, onProgress: undefined } : options, depth + 1);
      // Carried up: each vertex at its group's answer, plus where it sat in its group at the start.
      for (let v = 0; v < m; v++) {
        const a = c.of[v];
        x[v] = cx[a] + (x[v] - mean[a]);
        x[m + v] = cx[c.m + a] + (x[m + v] - mean[c.m + a]);
      }
      await solver.level(P, F, m, x, REFINE_STEPS, options.tolerance ?? 1e-6, depth === 0 ? options.onProgress : undefined);
      return;
    }
  }
  await solver.level(P, F, m, x, options.maxIterations ?? 4000, options.tolerance ?? 1e-6, depth === 0 ? options.onProgress : undefined);
}

/** A piece's own vertices numbered 0..m-1 (`ids`: their numbers in `positions`), and its triangles in those numbers. */
function localPiece(positions: Float64Array, triangles: Int32Array, piece: Int32Array): { ids: number[]; F: Int32Array; m: number; P: Float64Array } {
  const local = new Map<number, number>();
  const ids: number[] = [];
  const T = piece.length;
  const F = new Int32Array(T * 3);
  for (let i = 0; i < T; i++)
    for (let k = 0; k < 3; k++) {
      const g = triangles[piece[i] * 3 + k];
      let l = local.get(g);
      if (l === undefined) {
        l = ids.length;
        local.set(g, l);
        ids.push(g);
      }
      F[i * 3 + k] = l;
    }
  const m = ids.length;
  const P = new Float64Array(m * 3);
  ids.forEach((g, i) => P.set(positions.subarray(g * 3, g * 3 + 3), i * 3));
  return { ids, F, m, P };
}

/**
 * LSCM of one open piece: UV of its vertices (by local id), written into `u`/`v`; then made rigid, unless `rigidToo`
 * is false (a start for something else, conformalAround's whole piece).
 */
async function conformal(positions: Float64Array, triangles: Int32Array, piece: Int32Array, u: Float64Array, v: Float64Array, options: UnfoldOptions, rigidToo = true): Promise<void> {
  const T = piece.length;
  const { ids, F, m, P } = localPiece(positions, triangles, piece);
  // Start: seen straight on.
  const { right, up } = straightOn(positions, triangles, piece);
  const x = new Float64Array(2 * m);
  for (let i = 0; i < m; i++) {
    x[i] = P[i * 3] * right[0] + P[i * 3 + 1] * right[1] + P[i * 3 + 2] * right[2];
    x[m + i] = P[i * 3] * up[0] + P[i * 3 + 1] * up[1] + P[i * 3 + 2] * up[2];
  }
  const start = x.slice();
  const report = options.onProgress;
  // A third of the time on the conformal start, the rest on making it rigid.
  await solveMultilevel(P, F, m, x, { ...options, onProgress: report ? (done, total) => report(0.3 * Math.min(1, done / total), 1) : undefined }, 0);
  if (rigidToo) await (options.solver ?? cpuSolver).rigid(P, F, m, x, RIGID_ROUNDS, RIGID_STEPS, report ? (share) => report(0.3 + 0.7 * share, 1) : undefined);
  const tv = F;
  // Same way round and the same way up as seen straight on: mirrored if the faces turned over, then turned to fit.
  let areaNow = 0, areaStart = 0;
  for (let i = 0; i < T; i++) {
    const a = tv[i * 3], b = tv[i * 3 + 1], c = tv[i * 3 + 2];
    areaNow += (x[b] - x[a]) * (x[m + c] - x[m + a]) - (x[c] - x[a]) * (x[m + b] - x[m + a]);
    areaStart += (start[b] - start[a]) * (start[m + c] - start[m + a]) - (start[c] - start[a]) * (start[m + b] - start[m + a]);
  }
  if (areaNow * areaStart < 0) for (let i = 0; i < m; i++) x[i] = -x[i];
  let mx = 0, my = 0, sx = 0, sy = 0;
  for (let i = 0; i < m; i++) {
    mx += x[i];
    my += x[m + i];
    sx += start[i];
    sy += start[m + i];
  }
  mx /= m;
  my /= m;
  sx /= m;
  sy /= m;
  let dot = 0, crs = 0;
  for (let i = 0; i < m; i++) {
    const ax = x[i] - mx, ay = x[m + i] - my;
    const bx = start[i] - sx, by = start[m + i] - sy;
    dot += ax * bx + ay * by;
    crs += ax * by - ay * bx;
  }
  const angle = Math.atan2(crs, dot);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let i = 0; i < m; i++) {
    const ax = x[i] - mx, ay = x[m + i] - my;
    u[ids[i]] = ax * cos - ay * sin;
    v[ids[i]] = ax * sin + ay * cos;
  }
}

/** Options whose progress (0..1 of this step) is reported as `lo`..`hi` of the whole. */
function phase(options: UnfoldOptions, lo: number, hi: number): UnfoldOptions {
  const report = options.onProgress;
  return { ...options, onProgress: report ? (done, total) => report(lo + ((hi - lo) * done) / (total || 1), 1) : undefined };
}

/** Twice the signed area of a set of triangles in a layout (u, v by vertex number): which way round it lies. */
function turnOf(triangles: Int32Array, part: Int32Array, u: Float64Array, v: Float64Array): number {
  let sum = 0;
  for (const t of part) {
    const a = triangles[t * 3], b = triangles[t * 3 + 1], c = triangles[t * 3 + 2];
    sum += (u[b] - u[a]) * (v[c] - v[a]) - (u[c] - u[a]) * (v[b] - v[a]);
  }
  return sum;
}

/**
 * The best a·(p − p̄) + q̄ (a complex: turn and scale) taking points p to points q, with `unit` the turn alone.
 * Returns [a re, a im, p̄x, p̄y, q̄x, q̄y].
 */
function fitMotion(px: number[], py: number[], qx: number[], qy: number[], unit: boolean): number[] {
  const n = px.length;
  let pmx = 0, pmy = 0, qmx = 0, qmy = 0;
  for (let i = 0; i < n; i++) {
    pmx += px[i] / n;
    pmy += py[i] / n;
    qmx += qx[i] / n;
    qmy += qy[i] / n;
  }
  let re = 0, im = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    const ax = px[i] - pmx, ay = py[i] - pmy, bx = qx[i] - qmx, by = qy[i] - qmy;
    re += ax * bx + ay * by;
    im += ax * by - ay * bx;
    norm += ax * ax + ay * ay;
  }
  if (unit) norm = Math.hypot(re, im);
  return norm > 0 ? [re / norm, im / norm, pmx, pmy, qmx, qmy] : [1, 0, pmx, pmy, qmx, qmy];
}

/**
 * A piece that is part pick (triangles below `core`), part faces round it: the pick laid flat on its own, each part
 * of it at its own size, and held; the faces round it then laid out about it — angles, then sizes — starting from
 * where the piece laid flat whole put them.  Flattened together, the band that wraps round to the back of the pick
 * made the whole nearly closed and the pick took the squeeze (Tkc's ribbon, 11-05: a quarter of its area, 30 k
 * triangles turned over; on its own: its size, 81).  The faces round it that cannot lie flat about it come out
 * over it or over one another, and the map leaves those off (atlas.ts layOutCharts).
 */
async function conformalAround(positions: Float64Array, triangles: Int32Array, vertexCount: number, piece: Int32Array, core: number, u: Float64Array, v: Float64Array, options: UnfoldOptions): Promise<void> {
  const solver = options.solver ?? cpuSolver;
  // The whole piece by its angles only: just where the faces round the pick start from (made rigid it took 25 s more
  // of Tkc's hair's 3 minutes, 11-05).
  await conformal(positions, triangles, piece, u, v, phase(options, 0, 0.2), false);
  const { ids, F, m, P } = localPiece(positions, triangles, piece);
  const x = new Float64Array(2 * m);
  const localOf = new Map<number, number>();
  ids.forEach((g, i) => {
    x[i] = u[g];
    x[m + i] = v[g];
    localOf.set(g, i);
  });
  const parts = piecesOf(triangles, vertexCount, piece.filter((t) => t < core)).sort((a, b) => b.length - a.length);
  const pickFaces = parts.reduce((n, part) => n + part.length, 0);
  const pu = new Float64Array(vertexCount);
  const pv = new Float64Array(vertexCount);
  const held = new Uint8Array(m);
  let laid = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    await conformal(positions, triangles, part, pu, pv, phase(options, 0.2 + (0.5 * laid) / pickFaces, 0.2 + (0.5 * (laid + part.length)) / pickFaces));
    laid += part.length;
    const verts = [...new Set(Array.from(part, (t) => [triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]]).flat())];
    // The same way round as the whole layout (each was laid the way the piece faces, which may differ).
    if (turnOf(triangles, part, pu, pv) * turnOf(triangles, part, u, v) < 0) for (const g of verts) pu[g] = -pu[g];
    const own = [verts.map((g) => pu[g]), verts.map((g) => pv[g])];
    const whole = [verts.map((g) => x[localOf.get(g)!]), verts.map((g) => x[m + localOf.get(g)!])];
    if (index === 0) {
      // The whole layout brought to the biggest part's own size and place.
      const [re, im, wx, wy, ox, oy] = fitMotion(whole[0], whole[1], own[0], own[1], false);
      for (let i = 0; i < m; i++) {
        const dx = x[i] - wx, dy = x[m + i] - wy;
        x[i] = ox + re * dx - im * dy;
        x[m + i] = oy + im * dx + re * dy;
      }
      for (let k = 0; k < verts.length; k++) {
        whole[0][k] = x[localOf.get(verts[k])!];
        whole[1][k] = x[m + localOf.get(verts[k])!];
      }
    }
    // This part at its own size, turned and moved onto where the whole layout has it, and held there.
    const [re, im, ox, oy, wx, wy] = fitMotion(own[0], own[1], whole[0], whole[1], true);
    verts.forEach((g, k) => {
      const i = localOf.get(g)!;
      const dx = own[0][k] - ox, dy = own[1][k] - oy;
      x[i] = wx + re * dx - im * dy;
      x[m + i] = wy + im * dx + re * dy;
      held[i] = 1;
    });
  }
  // Only triangles with a corner free to move take part (the pick's own, all corners held, change nothing): the same
  // answer for a fraction of the work — the solve over the whole piece was 83 s of Tkc's hair's 3 minutes (11-05).
  const subF: number[] = [];
  for (let t = 0; t < F.length; t += 3) if (!held[F[t]] || !held[F[t + 1]] || !held[F[t + 2]]) subF.push(F[t], F[t + 1], F[t + 2]);
  const subOf = new Int32Array(m).fill(-1);
  const subIds: number[] = [];
  for (const g of subF) if (subOf[g] < 0) subOf[g] = subIds.push(g) - 1;
  const sm = subIds.length;
  const sF = Int32Array.from(subF, (g) => subOf[g]);
  const sP = new Float64Array(sm * 3);
  const sx = new Float64Array(2 * sm);
  const sHeld = new Uint8Array(sm);
  subIds.forEach((g, i) => {
    sP[i * 3] = P[g * 3];
    sP[i * 3 + 1] = P[g * 3 + 1];
    sP[i * 3 + 2] = P[g * 3 + 2];
    sx[i] = x[g];
    sx[sm + i] = x[m + g];
    sHeld[i] = held[g];
  });
  await solver.level(sP, sF, sm, sx, options.maxIterations ?? 4000, options.tolerance ?? 1e-6, phase(options, 0.7, 0.8).onProgress, sHeld);
  const report = phase(options, 0.8, 1).onProgress;
  await solver.rigid(sP, sF, sm, sx, RIGID_ROUNDS, RIGID_STEPS, report ? (share) => report(share, 1) : undefined, sHeld);
  subIds.forEach((g, i) => {
    x[g] = sx[i];
    x[m + g] = sx[sm + i];
  });
  ids.forEach((g, i) => {
    u[g] = x[i];
    v[g] = x[m + i];
  });
}

/** Grid cells over a pick's area when its layout is cut into islands (about as fine as the map's own pixels). */
const ISLAND_CELLS = 4_000_000;

/**
 * A patch laid flat cut into islands that each lie flat in one layer, as a UV tool cuts seams (11-05, the owner:
 * "색지도가 입체적으로 겹쳐서 배치되어 있으면 안 되고 평면으로 펼쳐져 있어야").  A pick in the round (a bow: its
 * front, its back and its loops all one colour) cannot lie flat in one piece: laid out whole it folds over itself,
 * two and three layers deep, and a brush there painted the layers under the one it showed — the back of Tkc's
 * ribbon, and the arm past it.
 *
 * Each piece of the layout is gone through from the pick's face that looks most the way the pick looks (its front),
 * out over the surface: a face goes on the island if the place it lies on is still free there, else it waits for
 * the next island, which starts from the best-facing pick face left.  Every pick face ends on an island; a face
 * round the pick (the triangles from `core` on, nearest first) joins the island of the faces it touches where there
 * is room, else it is left off (−1).  Islands keep the layout's own places; the colour map sets them side by side.
 *
 * The first island of a piece keeps to the pick's faces in the open (coveredFaces): what lies under something goes
 * on the next (11-05, the owner chose "따로 떼어 놓기": Tkc's face runs on under the chin to the neck below the
 * ribbon, one brown, and a stroke down the face came out on the chest past the ribbon).  So the face is one sheet
 * that ends at the ribbon, and the neck another.
 *
 * Few pieces, never crumbs (11-05, the owner on a map in two dozen bits: "이러면 기존 색지도랑 다를게없잖아"): an
 * island with fewer than PIECE_LEAST of the pick's faces is not set apart but joins the island it touches most.
 */
function islandsOf(positions: Float64Array, triangles: Int32Array, vertexCount: number, uv: Float32Array, piece: Int32Array, pieces: number, core: number, occluders?: Float64Array): { island: Int32Array; islands: number } {
  const count = triangles.length / 3;
  const island = new Int32Array(count).fill(-1);
  let islands = 0;
  // Each triangle's unit normal and centre, and the triangles sharing a corner with it.
  const normal = new Float64Array(count * 3);
  const centre = new Float64Array(count * 3);
  for (let t = 0; t < count; t++) {
    const a = triangles[t * 3] * 3, b = triangles[t * 3 + 1] * 3, c = triangles[t * 3 + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    normal[t * 3] = nx / nl;
    normal[t * 3 + 1] = ny / nl;
    normal[t * 3 + 2] = nz / nl;
    for (let d = 0; d < 3; d++) centre[t * 3 + d] = (positions[a + d] + positions[b + d] + positions[c + d]) / 3;
  }
  const { offsets: nOff, neighbours: nAt } = cornerNeighbours(triangles, vertexCount);
  // The way each triangle faces, evened with its neighbours (a sculpted surface's single faces lean every way).
  const smooth = new Float64Array(count * 3);
  for (let t = 0; t < count; t++) {
    let x = normal[t * 3], y = normal[t * 3 + 1], z = normal[t * 3 + 2];
    for (let k = nOff[t]; k < nOff[t + 1]; k++) {
      const u = nAt[k];
      x += normal[u * 3];
      y += normal[u * 3 + 1];
      z += normal[u * 3 + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    smooth[t * 3] = x / l;
    smooth[t * 3 + 1] = y / l;
    smooth[t * 3 + 2] = z / l;
  }
  // The pick's look: its normal summed and middle.
  let mx = 0, my = 0, mz = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < core; i++) {
    mx += normal[i * 3];
    my += normal[i * 3 + 1];
    mz += normal[i * 3 + 2];
    cx += centre[i * 3] / core;
    cy += centre[i * 3 + 1] / core;
    cz += centre[i * 3 + 2] / core;
  }
  const ml = Math.hypot(mx, my, mz) || 1;
  const covered = coveredFaces(triangles, positions, centre, smooth, nOff, nAt, core, occluders);
  // Seeds best first: in the open, facing the pick's way, then near its middle.
  const score = new Float64Array(core);
  for (let i = 0; i < core; i++) {
    const facing = (normal[i * 3] * mx + normal[i * 3 + 1] * my + normal[i * 3 + 2] * mz) / ml;
    const off = Math.hypot(centre[i * 3] - cx, centre[i * 3 + 1] - cy, centre[i * 3 + 2] - cz);
    score[i] = (covered[i] ? 0 : 1e9) + Math.round(facing * 20) * 1e6 - off;
  }
  const seeds = Array.from({ length: core }, (_v, i) => i).sort((a, b) => score[b] - score[a]);

  for (let p = 0; p < pieces; p++) {
    // The piece's room: a grid over its layout, about ISLAND_CELLS cells for the pick's area.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pickArea = 0, any = false;
    for (let i = 0; i < count; i++) {
      if (piece[i] !== p) continue;
      for (let k = 0; k < 3; k++) {
        const u = uv[i * 6 + k * 2], w = uv[i * 6 + k * 2 + 1];
        if (u < x0) x0 = u;
        if (u > x1) x1 = u;
        if (w < y0) y0 = w;
        if (w > y1) y1 = w;
      }
      if (i < core) {
        any = true;
        const o = i * 6;
        pickArea += Math.abs((uv[o + 2] - uv[o]) * (uv[o + 5] - uv[o + 1]) - (uv[o + 4] - uv[o]) * (uv[o + 3] - uv[o + 1])) / 2;
      }
    }
    if (!any) continue;
    let cell = Math.sqrt(Math.max(pickArea, 1e-12) / ISLAND_CELLS);
    cell = Math.max(cell, Math.sqrt(((x1 - x0) * (y1 - y0)) / (4 * ISLAND_CELLS)));
    const W = Math.max(1, Math.ceil((x1 - x0) / cell) + 1);
    const H = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
    const stamp = new Int32Array(W * H).fill(-1);
    const owner = new Int32Array(W * H);
    // Corners of face i in grid units.
    const corner = (i: number, k: number): [number, number] => [(uv[i * 6 + k * 2] - x0) / cell, (uv[i * 6 + k * 2 + 1] - y0) / cell];
    const insideOf = (i: number, x: number, y: number): boolean => {
      const [ax, ay] = corner(i, 0), [bx, by] = corner(i, 1), [qx, qy] = corner(i, 2);
      const area = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay);
      if (area === 0) return false;
      const w0 = ((bx - x) * (qy - y) - (qx - x) * (by - y)) / area;
      const w1 = ((qx - x) * (ay - y) - (ax - x) * (qy - y)) / area;
      return w0 > 1e-4 && w1 > 1e-4 && 1 - w0 - w1 > 1e-4;
    };
    // Cells whose centres lie strictly inside face i (faces side by side share none); the cell under its centre
    // for one too small to hold a centre.
    const cellsOf = (i: number, out: number[]): void => {
      out.length = 0;
      const [ax, ay] = corner(i, 0), [bx, by] = corner(i, 1), [qx, qy] = corner(i, 2);
      for (let gy = Math.max(0, Math.floor(Math.min(ay, by, qy))); gy <= Math.min(H - 1, Math.ceil(Math.max(ay, by, qy))); gy++)
        for (let gx = Math.max(0, Math.floor(Math.min(ax, bx, qx))); gx <= Math.min(W - 1, Math.ceil(Math.max(ax, bx, qx))); gx++)
          if (insideOf(i, gx + 0.5, gy + 0.5)) out.push(gy * W + gx);
    };
    const scratch: number[] = [];
    // Whether the face at index j lies within two faces of face i on the model: lying over those is the layout
    // creasing where the surface bends (a sculpted crease, a bow's edge), not another layer — split off, they left
    // hairline gaps; another layer (the back of a bow under its front) is many faces away over the surface.
    const touches = (i: number, j: number): boolean => {
      for (let k = nOff[i]; k < nOff[i + 1]; k++) {
        const h = nAt[k];
        if (h === j) return true;
        for (let l = nOff[h]; l < nOff[h + 1]; l++) if (nAt[l] === j) return true;
      }
      return false;
    };
    /**
     * Puts face i on island `c` if its place there is free: a pick face unless nearly all of it is taken (one partly
     * over another along a crease left the rest of its place a hairline gap when it went to another island), a face
     * round the pick unless more than half; a speck by its centre.
     */
    // The piece's first island keeps to the faces in the open.
    let openOnly = false;
    const place = (i: number, c: number): boolean => {
      if (openOnly && covered[i]) return false;
      cellsOf(i, scratch);
      if (scratch.length > 0) {
        let taken = 0;
        for (const g of scratch) if (stamp[g] === c && !touches(i, owner[g])) taken++;
        if (i < core ? taken > 0.9 * scratch.length : taken * 2 > scratch.length) return false;
        for (const g of scratch) {
          if (stamp[g] === c) continue;
          stamp[g] = c;
          owner[g] = i;
        }
      } else {
        const [ax, ay] = corner(i, 0), [bx, by] = corner(i, 1), [qx, qy] = corner(i, 2);
        const sx = (ax + bx + qx) / 3, sy = (ay + by + qy) / 3;
        const g = Math.min(H - 1, Math.max(0, Math.floor(sy))) * W + Math.min(W - 1, Math.max(0, Math.floor(sx)));
        if (stamp[g] === c && insideOf(owner[g], sx, sy) && !touches(i, owner[g])) return false;
        if (stamp[g] !== c) {
          stamp[g] = c;
          owner[g] = i;
        }
      }
      island[i] = c;
      return true;
    };
    const queue: number[] = [];
    const firstOfPiece = islands;
    for (const seed of seeds) {
      if (piece[seed] !== p || island[seed] >= 0) continue;
      const c = islands++;
      openOnly = c === firstOfPiece && !covered[seed];
      // The pick, out from the seed over the surface.
      const tried = new Uint8Array(count);
      queue.length = 0;
      queue.push(seed);
      tried[seed] = 1;
      const grown: number[] = [];
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        if (!place(i, c)) continue;
        grown.push(i);
        for (let k = nOff[i]; k < nOff[i + 1]; k++) {
          const j = nAt[k];
          if (j >= core || tried[j] || island[j] >= 0 || piece[j] !== p) continue;
          tried[j] = 1;
          queue.push(j);
        }
      }
      // Then the faces round it, touching this island, nearest first.
      const around = new MinQueue();
      const pushAround = (i: number) => {
        for (let k = nOff[i]; k < nOff[i + 1]; k++) {
          const j = nAt[k];
          if (j < core || tried[j] || island[j] >= 0 || piece[j] !== p) continue;
          tried[j] = 1;
          around.push(j);
        }
      };
      for (const i of grown) pushAround(i);
      while (around.size > 0) {
        const j = around.pop();
        if (place(j, c)) pushAround(j);
      }
    }
    joinCrumbs(island, firstOfPiece, islands, core, nOff, nAt, Math.max(PIECE_LEAST_FACES, Math.round(core * PIECE_LEAST)));
  }
  // Numbered afresh without the islands emptied into others.
  const renumber = new Int32Array(islands).fill(-1);
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const c = island[i];
    if (c < 0) continue;
    if (renumber[c] < 0) renumber[c] = kept++;
    island[i] = renumber[c];
  }
  return { island, islands: kept };
}

/** An island with fewer pick faces than this share of the pick (or PIECE_LEAST_FACES) joins its neighbour. */
const PIECE_LEAST = 0.05;
const PIECE_LEAST_FACES = 300;

/**
 * Islands `from`..`to`−1 with fewer than `least` pick faces (index below `core`) emptied into the island they touch
 * most, smallest first, until none is left that touches another.  Their faces keep their places in the layout: where
 * they lie over the island they join, the map draws one over the other, a crumb's worth.
 */
function joinCrumbs(island: Int32Array, from: number, to: number, core: number, nOff: Int32Array, nAt: Int32Array, least: number): void {
  const span = to - from;
  if (span <= 1) return;
  const members: number[][] = Array.from({ length: span }, () => []);
  for (let i = 0; i < island.length; i++) if (island[i] >= from && island[i] < to) members[island[i] - from].push(i);
  const pickCount = (k: number) => members[k].reduce((n, i) => n + (i < core ? 1 : 0), 0);
  const count = Array.from({ length: span }, (_v, k) => pickCount(k));
  for (;;) {
    let small = -1;
    for (let k = 0; k < span; k++) if (members[k].length > 0 && count[k] < least && (small < 0 || count[k] < count[small])) small = k;
    if (small < 0) return;
    const touch = new Map<number, number>();
    for (const i of members[small])
      for (let q = nOff[i]; q < nOff[i + 1]; q++) {
        const c = island[nAt[q]];
        if (c >= from && c < to && c - from !== small) touch.set(c - from, (touch.get(c - from) ?? 0) + 1);
      }
    let into = -1;
    for (const [k, n] of touch) if (into < 0 || n > (touch.get(into) ?? 0)) into = k;
    if (into < 0) {
      // Touches no other island: stays as it is (a part apart on the model), not looked at again.
      count[small] = least;
      continue;
    }
    for (const i of members[small]) island[i] = from + into;
    // One by one: spread into push(), a big island's faces overflowed the call stack (Tkc's hair, 1.1 M faces).
    for (const i of members[small]) members[into].push(i);
    count[into] += count[small];
    members[small] = [];
  }
}

/** A binary min-heap of indices (nearest first: the faces round the pick come in that order). */
class MinQueue {
  private items = new Int32Array(1024);
  size = 0;

  push(value: number): void {
    if (this.size === this.items.length) {
      const grown = new Int32Array(this.size * 2);
      grown.set(this.items);
      this.items = grown;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent] <= value) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = value;
  }

  pop(): number {
    const top = this.items[0];
    const value = this.items[--this.size];
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.items[child + 1] < this.items[child]) child++;
      if (this.items[child] >= value) break;
      this.items[i] = this.items[child];
      i = child;
    }
    this.items[i] = value;
    return top;
  }
}

/**
 * 1 for a face with something close in front of it — the neck under Tkc's ribbon, the ribbon a short way off along
 * its normal — 0 for one in the open (11-05).  Only the faces at hand (the pick and the faces round it) are looked
 * at (with `occluders` when the faces round it are not laid out), up to a fifth of the pick's size away: what
 * covers a pick lies on it, as a ribbon on a chest.  Each face's
 * normal is followed out in steps of about two face widths; a face centre within a step of it is something in front.
 * Single specks and slivers are evened out with their neighbours, and patches too small to stand as a piece of the
 * map (a crease, the foot of a raised line) go with what is round them.
 */
function coveredFaces(triangles: Int32Array, positions: Float64Array, own: Float64Array, smooth: Float64Array, nOff: Int32Array, nAt: Int32Array, core: number, occluders?: Float64Array): Uint8Array {
  const count = triangles.length / 3;
  // Every centre that can be in front: the faces laid out, then the others near.
  let centre = own;
  if (occluders && occluders.length) {
    centre = new Float64Array(own.length + occluders.length);
    centre.set(own);
    centre.set(occluders, own.length);
  }
  const all = centre.length / 3;
  const covered = new Uint8Array(count);
  if (core === 0) return covered;
  // Face width: the median edge; the pick's size: its centres' extent.
  const edges: number[] = [];
  for (let t = 0; t < count; t += Math.max(1, Math.floor(count / 20000))) {
    const a = triangles[t * 3] * 3, b = triangles[t * 3 + 1] * 3;
    edges.push(Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]));
  }
  edges.sort((p, q) => p - q);
  const width = edges[Math.floor(edges.length / 2)] || 1e-3;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let t = 0; t < all; t++) {
    const x = centre[t * 3], y = centre[t * 3 + 1], z = centre[t * 3 + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  let px0 = Infinity, py0 = Infinity, pz0 = Infinity, px1 = -Infinity, py1 = -Infinity, pz1 = -Infinity;
  for (let t = 0; t < core; t++) {
    const x = centre[t * 3], y = centre[t * 3 + 1], z = centre[t * 3 + 2];
    if (x < px0) px0 = x;
    if (x > px1) px1 = x;
    if (y < py0) py0 = y;
    if (y > py1) py1 = y;
    if (z < pz0) pz0 = z;
    if (z > pz1) pz1 = z;
  }
  const far = 0.2 * Math.hypot(px1 - px0, py1 - py0, pz1 - pz0);
  const step = 2 * width;
  // Face centres in a grid of cells a step wide (counting sort into CSR).
  const nx = Math.max(1, Math.ceil((x1 - x0) / step) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / step) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / step) + 1);
  if (nx * ny * nz > 40_000_000) return covered;
  const cellOf = (x: number, y: number, z: number) => {
    const i = Math.floor((x - x0) / step), j = Math.floor((y - y0) / step), k = Math.floor((z - z0) / step);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (k * ny + j) * nx + i;
  };
  const start = new Int32Array(nx * ny * nz + 1);
  for (let t = 0; t < all; t++) start[cellOf(centre[t * 3], centre[t * 3 + 1], centre[t * 3 + 2]) + 1]++;
  for (let c = 0; c < nx * ny * nz; c++) start[c + 1] += start[c];
  const fill = start.slice(0, nx * ny * nz);
  const inCell = new Int32Array(all);
  for (let t = 0; t < all; t++) inCell[fill[cellOf(centre[t * 3], centre[t * 3 + 1], centre[t * 3 + 2])]++] = t;
  const r2 = step * step;
  const raw = new Uint8Array(count);
  for (let t = 0; t < count; t++) {
    const ox = centre[t * 3], oy = centre[t * 3 + 1], oz = centre[t * 3 + 2];
    const dx = smooth[t * 3], dy = smooth[t * 3 + 1], dz = smooth[t * 3 + 2];
    // From two steps out (the face's own surface left behind) to `far`.
    for (let s = 2 * step; s <= far && !raw[t]; s += step) {
      const sx = ox + dx * s, sy = oy + dy * s, sz = oz + dz * s;
      const ci = Math.floor((sx - x0) / step), cj = Math.floor((sy - y0) / step), ck = Math.floor((sz - z0) / step);
      for (let k = ck - 1; k <= ck + 1 && !raw[t]; k++) {
        if (k < 0 || k >= nz) continue;
        for (let j = cj - 1; j <= cj + 1 && !raw[t]; j++) {
          if (j < 0 || j >= ny) continue;
          for (let i = ci - 1; i <= ci + 1; i++) {
            if (i < 0 || i >= nx) continue;
            const c = (k * ny + j) * nx + i;
            let hit = false;
            for (let q = start[c]; q < start[c + 1]; q++) {
              const u = inCell[q];
              const ex = centre[u * 3] - sx, ey = centre[u * 3 + 1] - sy, ez = centre[u * 3 + 2] - sz;
              if (ex * ex + ey * ey + ez * ez < r2) {
                hit = true;
                break;
              }
            }
            if (hit) {
              raw[t] = 1;
              break;
            }
          }
        }
      }
    }
  }
  // Evened out: each face takes what most of it and its neighbours say (twice).
  let now = raw;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(count);
    for (let t = 0; t < count; t++) {
      let yes = now[t], all = 1;
      for (let k = nOff[t]; k < nOff[t + 1]; k++) {
        yes += now[nAt[k]];
        all++;
      }
      next[t] = yes * 2 > all ? 1 : 0;
    }
    now = next;
  }
  // Patches of the pick too small to be a piece of their own go with what is round them.
  const least = Math.max(300, Math.round(core * 0.01));
  const seen = new Uint8Array(count);
  const list: number[] = [];
  for (let t = 0; t < core; t++) {
    if (seen[t]) continue;
    const value = now[t];
    list.length = 0;
    list.push(t);
    seen[t] = 1;
    for (let h = 0; h < list.length; h++) {
      const u = list[h];
      for (let k = nOff[u]; k < nOff[u + 1]; k++) {
        const w = nAt[k];
        if (w >= core || seen[w] || now[w] !== value) continue;
        seen[w] = 1;
        list.push(w);
      }
    }
    if (list.length < least) for (const u of list) covered[u] = value ? 0 : 1;
    else for (const u of list) covered[u] = value;
  }
  for (let t = core; t < count; t++) covered[t] = now[t];
  return covered;
}

/** Triangles sharing a corner with each triangle (CSR), as the model's face adjacency is. */
function cornerNeighbours(triangles: Int32Array, vertexCount: number): { offsets: Int32Array; neighbours: Int32Array } {
  const count = triangles.length / 3;
  const vStart = new Int32Array(vertexCount + 1);
  for (let i = 0; i < triangles.length; i++) vStart[triangles[i] + 1]++;
  for (let v = 0; v < vertexCount; v++) vStart[v + 1] += vStart[v];
  const vFill = vStart.slice(0, vertexCount);
  const vTri = new Int32Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) vTri[vFill[triangles[i]]++] = (i / 3) | 0;
  const seen = new Int32Array(count).fill(-1);
  const offsets = new Int32Array(count + 1);
  const each = (t: number, visit: (u: number) => void) => {
    for (let k = 0; k < 3; k++) {
      const v = triangles[t * 3 + k];
      for (let q = vStart[v]; q < vStart[v + 1]; q++) {
        const u = vTri[q];
        if (u === t || seen[u] === t) continue;
        seen[u] = t;
        visit(u);
      }
    }
  };
  for (let t = 0; t < count; t++) each(t, () => offsets[t + 1]++);
  for (let t = 0; t < count; t++) offsets[t + 1] += offsets[t];
  seen.fill(-1);
  const neighbours = new Int32Array(offsets[count]);
  const fill = offsets.slice(0, count);
  for (let t = 0; t < count; t++) each(t, (u) => (neighbours[fill[t]++] = u));
  return { offsets, neighbours };
}

/**
 * The triangles (corners as local vertex ids into `positions`, xyz a vertex) laid flat, piece by piece.
 * Each piece's UV is centred on 0; the colour map lays the pieces side by side.
 */
export async function unfoldPatch(positions: Float64Array, triangles: Int32Array, options: UnfoldOptions = {}): Promise<UnfoldResult> {
  const vertexCount = positions.length / 3;
  const T = triangles.length / 3;
  const all = Int32Array.from({ length: T }, (_, i) => i);
  // Open pieces: a closed one cut in two (and again, a few times at most).
  let queue: Array<{ piece: Int32Array; depth: number }> = piecesOf(triangles, vertexCount, all).map((piece) => ({ piece, depth: 0 }));
  const open: Int32Array[] = [];
  while (queue.length) {
    const next: typeof queue = [];
    for (const { piece, depth } of queue) {
      if (depth < 3 && piece.length > 1 && borderVertices(triangles, vertexCount, piece).size === 0) {
        for (const half of cutInTwo(positions, triangles, piece)) for (const part of piecesOf(triangles, vertexCount, half)) next.push({ piece: part, depth: depth + 1 });
      } else open.push(piece);
    }
    queue = next;
  }
  const u = new Float64Array(vertexCount);
  const v = new Float64Array(vertexCount);
  const uv = new Float32Array(T * 6);
  const pieceOf = new Int32Array(T);
  // Largest first: the piece the owner clicked is usually the big one.
  open.sort((a, b) => b.length - a.length);
  let facesDone = 0;
  const core = options.core ?? T;
  for (let index = 0; index < open.length; index++) {
    const piece = open[index];
    const pieceOptions: UnfoldOptions = {
      ...options,
      onProgress: options.onProgress ? (done, total) => options.onProgress?.(facesDone + (piece.length * done) / total, T) : undefined,
    };
    if (core < T && piece.some((t) => t < core) && piece.some((t) => t >= core)) await conformalAround(positions, triangles, vertexCount, piece, core, u, v, pieceOptions);
    else await conformal(positions, triangles, piece, u, v, pieceOptions);
    facesDone += piece.length;
    for (const t of piece) {
      pieceOf[t] = index;
      for (let k = 0; k < 3; k++) {
        const g = triangles[t * 3 + k];
        uv[t * 6 + k * 2] = u[g];
        uv[t * 6 + k * 2 + 1] = v[g];
      }
    }
  }
  const { island, islands } = islandsOf(positions, triangles, vertexCount, uv, pieceOf, open.length, core, options.occluders);
  return { uv, piece: island, pieces: islands };
}
