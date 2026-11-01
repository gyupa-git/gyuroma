import type { FaceAdjacency } from "@core/meshAdjacency";
import type { RGB, Tri, Vec3 } from "@core/types";

/**
 * Gap clean: faces of another colour wedged a face or two deep between two
 * colours — the dark teeth left between a white dot and a mint stripe.
 *
 * The border smoothing of 02 cannot take them: it is a neighbour vote with a
 * bonus for the face's own colour, and a face between white and mint has its
 * other neighbours split two ways, so neither beats it.  The island cleanup
 * cannot either: a tooth touching its big region at a corner counts as part
 * of it.  Here a wedged face goes to the side it is joined to more strongly —
 * the longest shared border, then the most faces around it.
 *
 * - between: the picked patches' colours are the ones kept.  First every
 *   face of another colour touching two of the picked patches goes — a gap a
 *   face or two wide, thin lines of a third colour included, is taken whole.
 *   Then, twice, what is left sticking out (meeting its own colour along one
 *   side at most) between two kept colours.  Only that: where the gap opens
 *   into a wide region, the region's faces meet their own colour along two
 *   sides or more, so the clean does not eat its way in row by row.
 * - all: anywhere on the model, a face that meets its own colour along one
 *   side at most and touches two other colours goes, two rounds (a tooth two
 *   faces deep).  A line one face wide keeps its middle, which meets its own
 *   colour along two sides; its ends wear a face or two.
 *
 * Protected colours are never changed.  A changed face takes the colour of
 * the neighbour it borders most, as that neighbour has it (not a palette
 * average), so it joins that neighbour's group exactly.
 */

export type GapCleanScope =
  /** The picked patches (faces), whose colours are kept. */
  | { kind: "between"; patches: Int32Array[] }
  | { kind: "all" };

export interface GapCleanInput {
  /** Faces sharing a vertex (the app's usual adjacency). */
  adjacency: FaceAdjacency;
  triangles: ArrayLike<Tri>;
  vertices: ArrayLike<Vec3>;
  /** Palette position of each face. */
  labels: Int32Array;
  colours: RGB[];
  /** 1 for palette positions that must not change. */
  protectedLabels: Uint8Array;
}

export interface GapCleanResult {
  colours: RGB[];
  /** Faces that changed, in the order they did. */
  changed: Int32Array;
  /** Palette position a changed face went to -> how many went there. */
  into: Map<number, number>;
  rounds: number;
}

/** "between": the gap itself, then two rounds of what sticks out of it. */
export const GAP_BETWEEN_ROUNDS = 3;
/** "all": a tooth one or two faces deep. */
export const GAP_ALL_ROUNDS = 2;

/** Edge neighbours of f (faces sharing two of its vertices) with the length of the shared edge. */
function edgesOf(input: GapCleanInput, f: number, out: { faces: number[]; lengths: number[] }): void {
  out.faces.length = 0;
  out.lengths.length = 0;
  const { adjacency, triangles, vertices } = input;
  const [a, b, c] = triangles[f];
  const end = adjacency.offsets[f + 1];
  for (let i = adjacency.offsets[f]; i < end; i++) {
    const g = adjacency.neighbours[i];
    const t = triangles[g];
    let first = -1;
    let second = -1;
    for (let k = 0; k < 3; k++) {
      const v = t[k];
      if (v !== a && v !== b && v !== c) continue;
      if (first < 0) first = v;
      else second = v;
    }
    if (second < 0) continue;
    const p = vertices[first];
    const q = vertices[second];
    out.faces.push(g);
    out.lengths.push(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
}

export function cleanGaps(input: GapCleanInput, scope: GapCleanScope): GapCleanResult {
  const { adjacency, protectedLabels } = input;
  const faceCount = input.labels.length;
  const label = input.labels.slice();
  const colours = input.colours.slice();
  const changed: number[] = [];
  const into = new Map<number, number>();
  const edges = { faces: [] as number[], lengths: [] as number[] };
  const isProtected = (f: number) => protectedLabels[label[f]] === 1;

  // Border length and face count per colour around f, over the colours `counts` may take.
  const border = new Map<number, number>();
  const around = new Map<number, number>();
  /** The neighbour f borders most among faces `takes` accepts, or -1. */
  const strongest = (f: number, takes: (g: number) => boolean): number => {
    border.clear();
    around.clear();
    edgesOf(input, f, edges);
    for (let i = 0; i < edges.faces.length; i++) {
      const g = edges.faces[i];
      if (takes(g)) border.set(label[g], (border.get(label[g]) ?? 0) + edges.lengths[i]);
    }
    const end = adjacency.offsets[f + 1];
    for (let i = adjacency.offsets[f]; i < end; i++) {
      const g = adjacency.neighbours[i];
      if (takes(g)) around.set(label[g], (around.get(label[g]) ?? 0) + 1);
    }
    let best = -1;
    let bestBorder = -1;
    let bestAround = -1;
    for (const [l, count] of around) {
      const length = border.get(l) ?? 0;
      if (length > bestBorder || (length === bestBorder && count > bestAround)) {
        best = l;
        bestBorder = length;
        bestAround = count;
      }
    }
    if (best < 0) return -1;
    // The donor: the face of that colour sharing the longest edge, else any face of it around f.
    let donor = -1;
    let donorLength = -1;
    for (let i = 0; i < edges.faces.length; i++) {
      const g = edges.faces[i];
      if (label[g] === best && takes(g) && edges.lengths[i] > donorLength) {
        donor = g;
        donorLength = edges.lengths[i];
      }
    }
    if (donor >= 0) return donor;
    for (let i = adjacency.offsets[f]; i < end; i++) {
      const g = adjacency.neighbours[i];
      if (label[g] === best && takes(g)) return g;
    }
    return -1;
  };

  /** How many sides of f its own colour is on. */
  const ownSides = (f: number): number => {
    edgesOf(input, f, edges);
    let n = 0;
    for (const g of edges.faces) if (label[g] === label[f]) n++;
    return n;
  };

  const pendingFace: number[] = [];
  const pendingDonor: number[] = [];
  const apply = () => {
    // All of a round is decided from the state before it, then applied.
    const donorLabel = pendingDonor.map((d) => label[d]);
    const donorColour = pendingDonor.map((d) => colours[d]);
    for (let i = 0; i < pendingFace.length; i++) {
      const f = pendingFace[i];
      label[f] = donorLabel[i];
      colours[f] = donorColour[i];
      changed.push(f);
      into.set(donorLabel[i], (into.get(donorLabel[i]) ?? 0) + 1);
    }
  };

  let rounds = 0;
  if (scope.kind === "between") {
    // side[f] = 1 for the picked faces, 2 for the faces this clean turned:
    // the two sides of the gap.  Their colours are the kept ones.
    const side = new Uint8Array(faceCount);
    const kept = new Set<number>();
    for (const faces of scope.patches) {
      for (let i = 0; i < faces.length; i++) {
        side[faces[i]] = 1;
        kept.add(label[faces[i]]);
      }
    }
    if (kept.size < 2) return { colours: input.colours, changed: new Int32Array(0), into, rounds: 0 };
    const onSide = (g: number) => side[g] !== 0;
    // The faces to look at: around the sides, then around what changed.
    let look: number[] = [];
    const stamp = new Int32Array(faceCount);
    const gather = (from: Iterable<number>, mark: number) => {
      const out: number[] = [];
      for (const s of from) {
        const end = adjacency.offsets[s + 1];
        for (let i = adjacency.offsets[s]; i < end; i++) {
          const g = adjacency.neighbours[i];
          if (stamp[g] === mark || side[g] || kept.has(label[g]) || isProtected(g)) continue;
          stamp[g] = mark;
          out.push(g);
        }
      }
      return out;
    };
    const sideFaces: number[] = [];
    for (const faces of scope.patches) for (let i = 0; i < faces.length; i++) sideFaces.push(faces[i]);
    look = gather(sideFaces, 1);
    for (let round = 0; round < GAP_BETWEEN_ROUNDS && look.length > 0; round++) {
      pendingFace.length = 0;
      pendingDonor.length = 0;
      for (const f of look) {
        // Wedged: touches at least two of the kept colours on the sides (the
        // picked faces only, in the first round).
        let first = -1;
        let two = false;
        const end = adjacency.offsets[f + 1];
        for (let i = adjacency.offsets[f]; i < end && !two; i++) {
          const g = adjacency.neighbours[i];
          if (side[g] === 0 || (round === 0 && side[g] !== 1)) continue;
          if (first < 0) first = label[g];
          else if (label[g] !== first) two = true;
        }
        if (!two) continue;
        if (round > 0 && ownSides(f) > 1) continue;
        const donor = strongest(f, onSide);
        if (donor < 0) continue;
        pendingFace.push(f);
        pendingDonor.push(donor);
      }
      if (pendingFace.length === 0) break;
      rounds = round + 1;
      apply();
      for (const f of pendingFace) side[f] = 2;
      look = gather(pendingFace, round + 2);
    }
  } else {
    // Faces are changed one at a time, the most cut off first (fewest sides
    // on their own colour, then fewest faces of it around), each checked
    // again when its turn comes.  Changed all at once, a wedged face and the
    // neighbour it leaves short of its own colour would swap colours.
    const ownAround = (f: number): number => {
      let n = 0;
      const end = adjacency.offsets[f + 1];
      for (let i = adjacency.offsets[f]; i < end; i++) if (label[adjacency.neighbours[i]] === label[f]) n++;
      return n;
    };
    const wedged = (f: number): boolean => {
      if (isProtected(f)) return false;
      const own = label[f];
      // Two other colours around it (between two colours, not a tooth of a plain border).
      let first = -1;
      let two = false;
      const end = adjacency.offsets[f + 1];
      for (let i = adjacency.offsets[f]; i < end && !two; i++) {
        const l = label[adjacency.neighbours[i]];
        if (l === own) continue;
        if (first < 0) first = l;
        else if (l !== first) two = true;
      }
      // Meets its own colour along one side at most: a tip, not the middle of a line.
      return two && ownSides(f) <= 1;
    };
    for (let round = 0; round < GAP_ALL_ROUNDS; round++) {
      const candidates: number[] = [];
      const order: number[] = [];
      for (let f = 0; f < faceCount; f++) {
        if (!wedged(f)) continue;
        candidates.push(f);
        order.push(ownSides(f) * 1024 + ownAround(f));
      }
      const byOrder = candidates.map((_, i) => i).sort((a, b) => order[a] - order[b]);
      let any = false;
      for (const i of byOrder) {
        const f = candidates[i];
        if (!wedged(f)) continue;
        const own = label[f];
        const donor = strongest(f, (g) => label[g] !== own);
        if (donor < 0) continue;
        label[f] = label[donor];
        colours[f] = colours[donor];
        changed.push(f);
        into.set(label[f], (into.get(label[f]) ?? 0) + 1);
        any = true;
      }
      if (!any) break;
      rounds = round + 1;
    }
  }
  return { colours, changed: Int32Array.from(changed), into, rounds };
}
