import type { FaceAdjacency } from "@core/meshAdjacency";

export interface SpeckOptions {
  /**
   * The colour (a palette position) the specks lie in — or -1: each patch takes whichever colour
   * holds most of its border (the healing brush: no colour to choose, a speck goes to what is around it).
   */
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
  /**
   * The brush's tip (its inner circle, inside `within`): only patches under it are looked at, and
   * only their faces under it are taken — what runs on past the tip stays for the next dab.
   * Null: every face in reach.
   */
  tip?: Int32Array | null;
  /** Faces turned already in this stroke (into = -1): the colour each took, so later dabs see it. Filled in for the faces found. */
  relabel?: Map<number, number> | null;
  /** Filled in: the colour each face returned takes (one per face, same order). */
  targets?: number[];
}

/**
 * The specks in a colour: the patches of other colours that lie inside it —
 * enclosed by it along most of their border — and small enough.  Within a
 * brush's reach a patch is judged inside the reach only: where it runs on
 * past the reach it is cut, and that stretch of its border counts as open
 * — a neck to a body of the same colour outside is a short stretch (the
 * blotch goes), a body's own edge a long one (it stays), so the brush never
 * crosses the colour's own outline.  Within a reach a speck with a soft edge
 * — a core and a ring of in-between shades, the core enclosed by the ring and
 * the ring only half by the colour around — is one speck: everything but the
 * colour around joins it (11-03: dots on a ball would not go).  A speck inside
 * a speck is found on a later pass, once the outer one is taken.  Returns the
 * faces to recolour.
 */
export function specksIn(labels: Int32Array, adjacency: FaceAdjacency, options: SpeckOptions): Int32Array {
  const n = labels.length;
  const { offsets, neighbours } = adjacency;
  const { into, maxFaces, enclosed, protectedLabels } = options;
  const auto = into < 0;
  const relabel = options.relabel ?? null;
  const targets = options.targets ?? null;
  const taken = options.taken ?? new Uint8Array(n);
  const reach = options.within ? new Set<number>(options.within) : null;
  // 0 unseen · 1 looked at and left (this pass) · 2 taken.  A dab looks at a few hundred faces of a
  // model of millions: its marks live in a map, a whole-model pass in an array.
  const marks = reach ? null : new Uint8Array(n);
  const map = reach ? new Map<number, number>() : null;
  const mark = (f: number): number => (marks ? marks[f] : (map!.get(f) ?? 0));
  const setMark = (f: number, v: number): void => {
    if (marks) marks[f] = v;
    else map!.set(f, v);
  };
  const isProtected = (l: number): boolean => Boolean(protectedLabels?.[l]);
  const out: number[] = [];
  const tip = options.tip ? new Set<number>(options.tip) : null;
  const seeds = options.tip ?? options.within;
  const seedCount = seeds ? seeds.length : n;

  // The colours of the reach, widest first: the colour a soft-edged speck lies in is tried from these.
  const reachOrder: number[] = [];
  if (options.within) {
    const area = new Map<number, number>();
    for (let i = 0; i < options.within.length; i++) {
      const l = labels[options.within[i]];
      area.set(l, (area.get(l) ?? 0) + 1);
    }
    reachOrder.push(...[...area.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l));
  }

  /** The region grown from `start` through faces that `joins` lets in (inside the reach); null if too big or met one left already. */
  const grow = (start: number[], joins: (g: number) => boolean, strict: boolean): { faces: number[]; inside: Set<number> } | null => {
    const faces = start.slice();
    const inside = new Set<number>(faces);
    for (let q = 0; q < faces.length; q++) {
      if (maxFaces > 0 && faces.length > maxFaces) return null;
      const a = faces[q];
      for (let k = offsets[a]; k < offsets[a + 1]; k++) {
        const g = neighbours[k];
        if (inside.has(g) || taken[g] || !joins(g) || (reach && !reach.has(g))) continue;
        // The same patch, looked at and left already this pass.
        if (strict && mark(g) === 1) return null;
        inside.add(g);
        faces.push(g);
      }
    }
    return { faces, inside };
  };

  /** The colour around the region if it holds enough of the border (auto: whichever holds most), else -1. */
  const judge = (region: { faces: number[]; inside: Set<number> }, joins: (g: number) => boolean, want: number, notThis: number): number => {
    let border = 0;
    const counts = new Map<number, number>();
    const add = (l: number) => counts.set(l, (counts.get(l) ?? 0) + 1);
    for (const a of region.faces)
      for (let k = offsets[a]; k < offsets[a + 1]; k++) {
        const g = neighbours[k];
        if (region.inside.has(g)) continue;
        border++;
        if (taken[g]) add(relabel?.get(g) ?? into);
        // Past the reach, the region's own way on is open (it is cut here).
        else if (!(reach && !reach.has(g) && joins(g))) add(labels[g]);
      }
    if (border === 0) return -1;
    let target = want;
    if (target < 0) {
      let best = 0;
      for (const [l, c] of counts)
        if (l >= 0 && l !== notThis && c > best) {
          best = c;
          target = l;
        }
    }
    return target >= 0 && (counts.get(target) ?? 0) >= enclosed * border ? target : -1;
  };

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
      if (taken[seed] || mark(seed) !== 0 || (!auto && labels[seed] === into) || (reach && !reach.has(seed))) continue;
      const label = labels[seed];
      if (isProtected(label)) {
        setMark(seed, 1);
        continue;
      }
      // The seed's own patch, in one colour.
      const same = (g: number) => labels[g] === label;
      const own = grow([seed], same, true);
      if (!own) {
        setMark(seed, 1);
        continue;
      }
      let region = own;
      // Auto: the whole speck, soft edge and all, into the colour it lies in comes first — judged on
      // its core alone, the core would take its ring's colour and leave the ring as a dot.
      let target = auto ? -1 : judge(own, same, into, label);
      if (target < 0 && reach) {
        // A soft-edged speck: everything but the colour around joins, tried with the reach's widest colours.
        const tries = auto ? reachOrder.filter((l) => l !== label && !isProtected(l)).slice(0, 2) : [into];
        for (const around of tries) {
          const other = (g: number) => labels[g] !== around && !isProtected(labels[g]);
          const grown = grow(own.faces, other, false);
          if (!grown) continue;
          const got = judge(grown, other, around, -1);
          if (got >= 0) {
            region = grown;
            target = got;
            break;
          }
        }
      }
      if (target < 0 && auto) target = judge(own, same, -1, label);
      if (target < 0) {
        for (const a of own.faces) setMark(a, 1);
        continue;
      }
      for (const a of region.faces) {
        if (tip && !tip.has(a)) {
          // Past the tip: left for the next dab (the part taken counts as the colour for it).
          setMark(a, 1);
          continue;
        }
        setMark(a, 2);
        taken[a] = 1;
        out.push(a);
        targets?.push(target);
        relabel?.set(a, target);
        found++;
      }
    }
    if (found === 0) break;
  }
  return Int32Array.from(out);
}
