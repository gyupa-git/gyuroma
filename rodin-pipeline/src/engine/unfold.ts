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
 */

export interface UnfoldResult {
  /** UV of each triangle's three corners (6 numbers a triangle), in model units. */
  uv: Float32Array;
  /** Piece of each triangle (0-based). */
  piece: Int32Array;
  pieces: number;
}

export interface UnfoldOptions {
  /** Most solver steps per piece. */
  maxIterations?: number;
  /** Stop when the remaining error falls to this share of the first. */
  tolerance?: number;
  onProgress?: (done: number, total: number) => void;
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

/** LSCM of one open piece: UV of its vertices (by local id), written into `u`/`v`. */
function conformal(positions: Float64Array, triangles: Int32Array, piece: Int32Array, vertexCount: number, u: Float64Array, v: Float64Array, options: UnfoldOptions): void {
  // The piece's own vertices, numbered 0..m-1.
  const local = new Map<number, number>();
  const ids: number[] = [];
  for (const t of piece)
    for (let k = 0; k < 3; k++) {
      const g = triangles[t * 3 + k];
      if (!local.has(g)) {
        local.set(g, ids.length);
        ids.push(g);
      }
    }
  const m = ids.length;
  // Start: seen straight on.
  const { right, up } = straightOn(positions, triangles, piece);
  const x = new Float64Array(2 * m);
  for (let i = 0; i < m; i++) {
    const p = ids[i] * 3;
    x[i] = positions[p] * right[0] + positions[p + 1] * right[1] + positions[p + 2] * right[2];
    x[m + i] = positions[p] * up[0] + positions[p + 1] * up[1] + positions[p + 2] * up[2];
  }
  const start = x.slice();
  // Each triangle's coefficients, 1/√(2·area) taken in.
  const T = piece.length;
  const tv = new Int32Array(T * 3);
  const ca = new Float64Array(T * 3);
  const cb = new Float64Array(T * 3);
  const diag = new Float64Array(m);
  for (let i = 0; i < T; i++) {
    const t = piece[i];
    const g0 = triangles[t * 3], g1 = triangles[t * 3 + 1], g2 = triangles[t * 3 + 2];
    tv[i * 3] = local.get(g0) as number;
    tv[i * 3 + 1] = local.get(g1) as number;
    tv[i * 3 + 2] = local.get(g2) as number;
    const e1 = [positions[g1 * 3] - positions[g0 * 3], positions[g1 * 3 + 1] - positions[g0 * 3 + 1], positions[g1 * 3 + 2] - positions[g0 * 3 + 2]];
    const e2 = [positions[g2 * 3] - positions[g0 * 3], positions[g2 * 3 + 1] - positions[g0 * 3 + 1], positions[g2 * 3 + 2] - positions[g0 * 3 + 2]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]);
    if (l1 < 1e-12) continue;
    const x1 = l1;
    const x2 = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / l1;
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const y2 = Math.hypot(cr[0], cr[1], cr[2]) / l1;
    const twice = x1 * y2;
    if (twice < 1e-14) continue;
    const s = 1 / Math.sqrt(twice);
    // W0 = z2 − z1, W1 = z0 − z2, W2 = z1 − z0, with z0 = 0, z1 = x1, z2 = x2 + i·y2.
    const w = [
      [x2 - x1, y2],
      [-x2, -y2],
      [x1, 0],
    ];
    for (let k = 0; k < 3; k++) {
      ca[i * 3 + k] = w[k][0] * s;
      cb[i * 3 + k] = w[k][1] * s;
      diag[tv[i * 3 + k]] += (w[k][0] * w[k][0] + w[k][1] * w[k][1]) * s * s;
    }
  }
  // Two far points of its border pinned where they are seen (scale and turn fixed).
  const border = [...borderVertices(triangles, vertexCount, piece)].map((g) => local.get(g) as number);
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
  const free = new Uint8Array(2 * m).fill(1);
  free[pa] = free[m + pa] = free[pb] = free[m + pb] = 0;
  // N·p = Aᵀ(A·p): the conformal error's gradient, free entries only.
  const r1 = new Float64Array(T);
  const r2 = new Float64Array(T);
  const apply = (p: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let i = 0; i < T; i++) {
      let s1 = 0, s2 = 0;
      for (let k = 0; k < 3; k++) {
        const j = tv[i * 3 + k];
        const a = ca[i * 3 + k], b = cb[i * 3 + k];
        s1 += a * p[j] - b * p[m + j];
        s2 += b * p[j] + a * p[m + j];
      }
      r1[i] = s1;
      r2[i] = s2;
    }
    for (let i = 0; i < T; i++) {
      const s1 = r1[i], s2 = r2[i];
      for (let k = 0; k < 3; k++) {
        const j = tv[i * 3 + k];
        const a = ca[i * 3 + k], b = cb[i * 3 + k];
        out[j] += a * s1 + b * s2;
        out[m + j] += -b * s1 + a * s2;
      }
    }
    for (let i = 0; i < 2 * m; i++) if (!free[i]) out[i] = 0;
  };
  // Conjugate gradients (Jacobi preconditioned) on the free entries, from the straight-on start.
  const r = new Float64Array(2 * m);
  apply(x, r);
  for (let i = 0; i < 2 * m; i++) r[i] = -r[i];
  const pre = (i: number) => (free[i] && diag[i % m] > 0 ? 1 / diag[i % m] : 0);
  const z = new Float64Array(2 * m);
  for (let i = 0; i < 2 * m; i++) z[i] = r[i] * pre(i);
  const p = z.slice();
  const q = new Float64Array(2 * m);
  let rz = 0;
  for (let i = 0; i < 2 * m; i++) rz += r[i] * z[i];
  const first = Math.sqrt(rz) || 1;
  const maxIterations = options.maxIterations ?? 4000;
  const tolerance = options.tolerance ?? 1e-6;
  for (let it = 0; it < maxIterations && Math.sqrt(Math.abs(rz)) > tolerance * first; it++) {
    apply(p, q);
    let pq = 0;
    for (let i = 0; i < 2 * m; i++) pq += p[i] * q[i];
    if (!(pq > 0)) break;
    const alpha = rz / pq;
    for (let i = 0; i < 2 * m; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * q[i];
    }
    let next = 0;
    for (let i = 0; i < 2 * m; i++) {
      z[i] = r[i] * pre(i);
      next += r[i] * z[i];
    }
    const beta = next / rz;
    rz = next;
    for (let i = 0; i < 2 * m; i++) p[i] = z[i] + beta * p[i];
    if (it % 50 === 0) options.onProgress?.(it, maxIterations);
  }
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

/**
 * The triangles (corners as local vertex ids into `positions`, xyz a vertex) laid flat, piece by piece.
 * Each piece's UV is centred on 0; the colour map lays the pieces side by side.
 */
export function unfoldPatch(positions: Float64Array, triangles: Int32Array, options: UnfoldOptions = {}): UnfoldResult {
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
  open.forEach((piece, index) => {
    conformal(positions, triangles, piece, vertexCount, u, v, {
      ...options,
      onProgress: options.onProgress ? (done, total) => options.onProgress?.(facesDone + (piece.length * done) / total, T) : undefined,
    });
    facesDone += piece.length;
    for (const t of piece) {
      pieceOf[t] = index;
      for (let k = 0; k < 3; k++) {
        const g = triangles[t * 3 + k];
        uv[t * 6 + k * 2] = u[g];
        uv[t * 6 + k * 2 + 1] = v[g];
      }
    }
  });
  return { uv, piece: pieceOf, pieces: open.length };
}
