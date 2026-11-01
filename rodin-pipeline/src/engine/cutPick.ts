/**
 * What a click on the smooth borders' preview means.  Before a cut is
 * confirmed its pieces are only drawn: the model still has the whole face
 * under them, of one group, while a piece may show the group across the line.
 * A click takes the colour it sees, not the face's.
 */

/**
 * Of a face's pieces — `count` triangles from `first` in `positions` (9
 * numbers each) — the one `point` lies in, or nearest to inside at a seam.
 * The pieces lie in their face's plane, as the point does.
 */
export function pieceAt(positions: ArrayLike<number>, first: number, count: number, point: readonly [number, number, number]): number {
  let best = first;
  let bestScore = -Infinity;
  for (let p = first; p < first + count; p++) {
    const score = insideness(positions, p * 9, point);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** The smallest barycentric coordinate of `point` in the triangle at `o` (≥ 0 inside). */
function insideness(t: ArrayLike<number>, o: number, point: readonly [number, number, number]): number {
  const v0 = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]];
  const v1 = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
  const v2 = [point[0] - t[o], point[1] - t[o + 1], point[2] - t[o + 2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01;
  if (!(Math.abs(den) > 0)) return -Infinity; // a sliver with no area
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  return Math.min(1 - v - w, v, w);
}

/**
 * A face of `group` near `face` (up to `rings` rings of neighbours out), so a
 * click on a piece of that group takes the patch the piece shows as part of;
 * `face` itself when it is of that group already, -1 when none is near: the
 * colour is in the preview only, the model has no face of it there yet.  The
 * line a cut follows may lie four border edges and more from the border, and
 * round a fold further still: 3 rings missed the outer pieces of a patch drawn
 * smooth, and a click there took the colour of the face under them.
 */
export function faceOfGroupNear(offsets: Int32Array, neighbours: Int32Array, labels: ArrayLike<number>, face: number, group: number, rings = 12): number {
  if (labels[face] === group) return face;
  const seen = new Set<number>([face]);
  let ring = [face];
  for (let depth = 0; depth < rings && ring.length > 0; depth++) {
    const next: number[] = [];
    for (const f of ring)
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        if (seen.has(g)) continue;
        if (labels[g] === group) return g;
        seen.add(g);
        next.push(g);
      }
    ring = next;
  }
  return -1;
}
