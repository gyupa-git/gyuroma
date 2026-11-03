import type { Tri, Vec3 } from "./types";

/**
 * Small holes in a mesh, closed for printing: a slicer drops a shell that is
 * not closed from every layer that crosses its hole (11-04: two hair locks of
 * a figure, open at the top where they tuck into the head, came out cut flat
 * 3 mm short).  Each boundary loop up to `maxPerimeterRatio` of the model's
 * largest extent is filled with a fan around its centre, wound so the new
 * faces face the same way as the faces around them.  A bigger opening — a
 * cloth's hem left open on purpose — is left alone.
 */
export interface HoleFill {
  /** Vertices to add after the mesh's own (one per filled loop with more than three edges). */
  vertices: Vec3[];
  /** Triangles to add after the mesh's own, indexing the mesh's vertices and the added ones. */
  triangles: Tri[];
  /** For each added triangle, the existing face it borders (to take its colour). */
  borders: Int32Array;
  /** Loops filled, and loops seen but left (too big, or not a clean loop). */
  filled: number;
  left: number;
}

export interface HoleFillOptions {
  /** A loop is filled when its length is at most this share of the model's largest extent. Default 0.35. */
  maxPerimeterRatio?: number;
}

export function fillSmallHoles(vertices: ArrayLike<Vec3>, triangles: ArrayLike<Tri>, options: HoleFillOptions = {}): HoleFill {
  const nv = vertices.length;
  const nt = triangles.length;
  const empty: HoleFill = { vertices: [], triangles: [], borders: new Int32Array(0), filled: 0, left: 0 };
  if (nv === 0 || nt === 0) return empty;

  // Triangles around each vertex (compressed rows).
  const start = new Int32Array(nv + 1);
  for (let t = 0; t < nt; t++) {
    const tri = triangles[t];
    start[tri[0] + 1]++;
    start[tri[1] + 1]++;
    start[tri[2] + 1]++;
  }
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const around = new Int32Array(start[nv]);
  const fill = start.slice(0, nv);
  for (let t = 0; t < nt; t++) {
    const tri = triangles[t];
    around[fill[tri[0]]++] = t;
    around[fill[tri[1]]++] = t;
    around[fill[tri[2]]++] = t;
  }
  const has = (t: number, v: number) => {
    const tri = triangles[t];
    return tri[0] === v || tri[1] === v || tri[2] === v;
  };

  // Boundary half-edges: an edge a→b of one triangle that no other triangle shares.  The face that
  // closes it runs b→a; `next` follows those, so each hole comes out as a loop.
  const next = new Map<number, Array<{ to: number; face: number }>>();
  let boundary = 0;
  for (let t = 0; t < nt; t++) {
    const tri = triangles[t];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      let shared = false;
      for (let i = start[a]; i < start[a + 1] && !shared; i++) {
        const s = around[i];
        if (s !== t && has(s, b)) shared = true;
      }
      if (shared) continue;
      boundary++;
      const list = next.get(b) ?? [];
      list.push({ to: a, face: t });
      next.set(b, list);
    }
  }
  if (boundary === 0) return empty;

  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) {
    const p = vertices[v];
    for (let d = 0; d < 3; d++) {
      if (p[d] < lo[d]) lo[d] = p[d];
      if (p[d] > hi[d]) hi[d] = p[d];
    }
  }
  const limit = (options.maxPerimeterRatio ?? 0.35) * Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const dist = (a: number, b: number) => {
    const p = vertices[a];
    const q = vertices[b];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };

  const out: HoleFill = { vertices: [], triangles: [], borders: new Int32Array(0), filled: 0, left: 0 };
  const borders: number[] = [];
  for (const [from] of next) {
    // Walk one loop from here, taking the unused boundary edges.
    while ((next.get(from)?.length ?? 0) > 0) {
      const loop: number[] = [from];
      const faces: number[] = [];
      let at = from;
      let ok = false;
      for (let guard = 0; guard <= boundary; guard++) {
        const list = next.get(at);
        const step = list?.pop();
        if (!step) break;
        faces.push(step.face);
        at = step.to;
        if (at === from) {
          ok = true;
          break;
        }
        loop.push(at);
      }
      if (!ok || loop.length < 3) {
        out.left++;
        continue;
      }
      let length = 0;
      for (let i = 0; i < loop.length; i++) length += dist(loop[i], loop[(i + 1) % loop.length]);
      if (length > limit) {
        out.left++;
        continue;
      }
      out.filled++;
      if (loop.length === 3) {
        out.triangles.push([loop[0], loop[1], loop[2]]);
        borders.push(faces[0]);
        continue;
      }
      const centre: Vec3 = [0, 0, 0];
      for (const v of loop) for (let d = 0; d < 3; d++) centre[d] += vertices[v][d] / loop.length;
      const c = nv + out.vertices.length;
      out.vertices.push(centre);
      for (let i = 0; i < loop.length; i++) {
        out.triangles.push([loop[i], loop[(i + 1) % loop.length], c]);
        borders.push(faces[i]);
      }
    }
  }
  out.borders = Int32Array.from(borders);
  return out;
}
