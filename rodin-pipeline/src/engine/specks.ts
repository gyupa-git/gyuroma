import type { FaceAdjacency } from "@core/meshAdjacency";

export interface SpeckOptions {
  /** The colour (a palette position) the specks lie in. */
  into: number;
  /** The faces in reach (a brush dab); a patch that runs past them is left alone. Null = the whole model. */
  within: Int32Array | null;
  /** A patch of more faces than this is not a speck (0 = no limit). */
  maxFaces: number;
  /** The share of a patch's border that must be `into` (or faces already taken), 0..1. */
  enclosed: number;
  /** Colours (palette positions) whose patches are never taken. */
  protectedLabels: Uint8Array | null;
  /** Faces already turned to `into` (an earlier dab of the same stroke): they count as it and are not taken again; marked for the faces found. */
  taken: Uint8Array | null;
  /** A last word on a patch (its size, say): false leaves it. */
  fits?: (faces: number[]) => boolean;
}

/**
 * The specks in a colour: the patches of other colours that lie inside it —
 * enclosed by it along most of their border — small enough, and, within a
 * brush's reach, wholly inside that reach, so the brush never crosses the
 * colour's own outline.  A speck inside a speck is found on a later pass, once
 * the outer one is taken.  Returns the faces to recolour.
 */
export function specksIn(labels: Int32Array, adjacency: FaceAdjacency, options: SpeckOptions): Int32Array {
  const n = labels.length;
  const { offsets, neighbours } = adjacency;
  const { into, maxFaces, enclosed, protectedLabels } = options;
  const taken = options.taken ?? new Uint8Array(n);
  const reach = options.within ? new Set<number>(options.within) : null;
  // 0 unseen · 1 looked at and left (this pass) · 2 taken · 3 being looked at.  A dab looks at a
  // few hundred faces of a model of millions: its marks live in a map, a whole-model pass in an array.
  const marks = reach ? null : new Uint8Array(n);
  const map = reach ? new Map<number, number>() : null;
  const mark = (f: number): number => (marks ? marks[f] : (map!.get(f) ?? 0));
  const setMark = (f: number, v: number): void => {
    if (marks) marks[f] = v;
    else map!.set(f, v);
  };
  const out: number[] = [];
  const seeds = options.within;
  const seedCount = seeds ? seeds.length : n;
  for (let pass = 0; pass < 3; pass++) {
    // What was left last pass may be enclosed now that the patch around it is taken.
    if (marks) {
      for (let i = 0; i < n; i++) if (marks[i] === 1) marks[i] = 0;
    } else {
      for (const [f, v] of map!) if (v === 1) map!.delete(f);
    }
    let found = 0;
    for (let s = 0; s < seedCount; s++) {
      const seed = seeds ? seeds[s] : s;
      if (taken[seed] || mark(seed) !== 0 || labels[seed] === into) continue;
      const label = labels[seed];
      if (protectedLabels?.[label]) {
        setMark(seed, 1);
        continue;
      }
      const faces: number[] = [seed];
      setMark(seed, 3);
      let ok = true;
      let border = 0;
      let good = 0;
      for (let q = 0; q < faces.length && ok; q++) {
        const a = faces[q];
        if (reach && !reach.has(a)) {
          ok = false;
          break;
        }
        if (maxFaces > 0 && faces.length > maxFaces) {
          ok = false;
          break;
        }
        for (let k = offsets[a]; k < offsets[a + 1]; k++) {
          const g = neighbours[k];
          if (taken[g]) {
            border++;
            good++;
            continue;
          }
          if (labels[g] === label) {
            const m = mark(g);
            if (m === 0) {
              setMark(g, 3);
              faces.push(g);
            } else if (m === 1) {
              // The same patch, looked at and left already.
              ok = false;
              break;
            }
          } else {
            border++;
            if (labels[g] === into) good++;
          }
        }
      }
      if (ok && border > 0 && good >= enclosed * border && (!options.fits || options.fits(faces))) {
        for (const a of faces) {
          setMark(a, 2);
          taken[a] = 1;
          out.push(a);
        }
        found += faces.length;
      } else {
        for (const a of faces) setMark(a, 1);
      }
    }
    if (found === 0) break;
  }
  return Int32Array.from(out);
}
