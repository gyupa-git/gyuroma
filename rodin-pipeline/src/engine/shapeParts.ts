import type { FaceAdjacency } from "@core/meshAdjacency";
import type { Tri, Vec3 } from "@core/types";

/**
 * Shape first, colour after (11-04, the owner: "일단 형태를 파악하고 그게 뭔지 얼굴인지
 * 뭔지 팔은 어디서부터 어디까지인지"): the model cut into cells of about the same size
 * whatever their colour, numbered on its pictures, so the AI can say which cells make
 * the face, an arm, a sleeve — the part map.  A colour tidy then works part by part:
 * each part one main colour, its small details kept.
 *
 * Cells: seeds spread evenly over the surface (each next seed the point farthest from
 * the ones taken), every face going to the seed it reaches first walking over the
 * surface — so a hand resting on a hip does not share a cell with it.
 */
export interface ShapeCells {
  /** Face → cell, 0..count-1. */
  cellOf: Int32Array;
  count: number;
  /** For each cell, the cells it touches and how many face contacts they share. */
  touching: Array<Map<number, number>>;
  /** Share of the surface per cell, 0..100. */
  areaPct: Float64Array;
}

export function faceCentroids(vertices: ArrayLike<Vec3>, triangles: ArrayLike<Tri>): Float32Array {
  const out = new Float32Array(triangles.length * 3);
  for (let f = 0; f < triangles.length; f++) {
    const [a, b, c] = triangles[f];
    const p = vertices[a], q = vertices[b], r = vertices[c];
    out[f * 3] = (p[0] + q[0] + r[0]) / 3;
    out[f * 3 + 1] = (p[1] + q[1] + r[1]) / 3;
    out[f * 3 + 2] = (p[2] + q[2] + r[2]) / 3;
  }
  return out;
}

export function shapeCells(centroids: Float32Array, adjacency: FaceAdjacency, area: ArrayLike<number>, count = 72): ShapeCells {
  const n = centroids.length / 3;
  const { offsets, neighbours } = adjacency;
  const cellOf = new Int32Array(n).fill(-1);
  if (n === 0) return { cellOf, count: 0, touching: [], areaPct: new Float64Array(0) };

  // Seeds on a sample of the faces (every face of a small model), farthest point first.
  const stride = Math.max(1, Math.ceil(n / 150_000));
  const candidates: number[] = [];
  for (let f = 0; f < n; f += stride) candidates.push(f);
  const m = candidates.length;
  const want = Math.max(1, Math.min(count, m));
  const nearest = new Float32Array(m).fill(Infinity);
  // Start at the top of the model, so the seeds come out the same every time.
  let first = 0;
  for (let i = 1; i < m; i++) if (centroids[candidates[i] * 3 + 2] > centroids[candidates[first] * 3 + 2]) first = i;
  const seeds: number[] = [];
  let next = first;
  for (let k = 0; k < want; k++) {
    const s = candidates[next];
    seeds.push(s);
    const sx = centroids[s * 3], sy = centroids[s * 3 + 1], sz = centroids[s * 3 + 2];
    let far = -1;
    let farD = -1;
    for (let i = 0; i < m; i++) {
      const f = candidates[i];
      const dx = centroids[f * 3] - sx, dy = centroids[f * 3 + 1] - sy, dz = centroids[f * 3 + 2] - sz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < nearest[i]) nearest[i] = d;
      if (nearest[i] > farD) {
        farD = nearest[i];
        far = i;
      }
    }
    if (farD <= 0) break;
    next = far;
  }

  // Every face to the seed it reaches first over the surface (rings of neighbours, all seeds at once).
  let frontier = new Int32Array(n);
  let size = 0;
  seeds.forEach((s, cell) => {
    if (cellOf[s] >= 0) return;
    cellOf[s] = cell;
    frontier[size++] = s;
  });
  let ring = new Int32Array(n);
  while (size > 0) {
    let ringSize = 0;
    for (let i = 0; i < size; i++) {
      const a = frontier[i];
      const cell = cellOf[a];
      for (let j = offsets[a]; j < offsets[a + 1]; j++) {
        const b = neighbours[j];
        if (cellOf[b] < 0) {
          cellOf[b] = cell;
          ring[ringSize++] = b;
        }
      }
    }
    const swap = frontier;
    frontier = ring;
    ring = swap;
    size = ringSize;
  }
  // A loose piece no seed is on goes to the seed nearest in space (the whole piece at once).
  for (let s = 0; s < n; s++) {
    if (cellOf[s] >= 0) continue;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < seeds.length; k++) {
      const f = seeds[k];
      const dx = centroids[f * 3] - centroids[s * 3], dy = centroids[f * 3 + 1] - centroids[s * 3 + 1], dz = centroids[f * 3 + 2] - centroids[s * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    const stack = [s];
    cellOf[s] = best;
    while (stack.length) {
      const a = stack.pop() as number;
      for (let j = offsets[a]; j < offsets[a + 1]; j++) {
        const b = neighbours[j];
        if (cellOf[b] < 0) {
          cellOf[b] = best;
          stack.push(b);
        }
      }
    }
  }

  const cells = seeds.length;
  const touching = Array.from({ length: cells }, () => new Map<number, number>());
  const areaPct = new Float64Array(cells);
  let total = 0;
  for (let f = 0; f < n; f++) {
    const c = cellOf[f];
    areaPct[c] += area[f];
    total += area[f];
    for (let j = offsets[f]; j < offsets[f + 1]; j++) {
      const d = cellOf[neighbours[j]];
      if (d !== c) touching[c].set(d, (touching[c].get(d) ?? 0) + 1);
    }
  }
  if (total > 0) for (let c = 0; c < cells; c++) areaPct[c] = (areaPct[c] / total) * 100;
  return { cellOf, count: cells, touching, areaPct };
}

/** One part of the part map: a name and the cells it is made of. */
export interface ShapePart {
  name: string;
  cells: number[];
}

/**
 * Cell → part for every cell: the ones named take their part, the others the part
 * they touch the most (spreading out from the named ones), so hidden cells (under an
 * arm, between the legs) still belong somewhere.  -1 only when no part is named.
 */
export function cellParts(cells: ShapeCells, parts: ShapePart[]): Int32Array {
  const partOfCell = new Int32Array(cells.count).fill(-1);
  parts.forEach((part, p) => {
    for (const c of part.cells) if (c >= 0 && c < cells.count && partOfCell[c] < 0) partOfCell[c] = p;
  });
  for (let round = 0; round < cells.count; round++) {
    let changed = false;
    const next = partOfCell.slice();
    for (let c = 0; c < cells.count; c++) {
      if (partOfCell[c] >= 0) continue;
      const votes = new Map<number, number>();
      for (const [d, w] of cells.touching[c]) if (partOfCell[d] >= 0) votes.set(partOfCell[d], (votes.get(partOfCell[d]) ?? 0) + w);
      let best = -1;
      let bestW = 0;
      for (const [p, w] of votes) if (w > bestW || (w === bestW && p < best)) {
        best = p;
        bestW = w;
      }
      if (best >= 0) {
        next[c] = best;
        changed = true;
      }
    }
    partOfCell.set(next);
    if (!changed) break;
  }
  return partOfCell;
}

export function facePartsOf(cells: ShapeCells, partOfCell: Int32Array): Int32Array {
  const out = new Int32Array(cells.cellOf.length);
  for (let f = 0; f < out.length; f++) out[f] = partOfCell[cells.cellOf[f]];
  return out;
}

export interface PartSummary {
  areaPct: number;
  /** Palette positions inside the part with their share of the part (0..100), biggest first. */
  colours: Array<{ label: number; pct: number }>;
}

export function summariseParts(partOfFace: Int32Array, partCount: number, labels: Int32Array, labelCount: number, area: ArrayLike<number>): PartSummary[] {
  const sums = Array.from({ length: partCount }, () => new Float64Array(labelCount));
  const totals = new Float64Array(partCount);
  let all = 0;
  for (let f = 0; f < partOfFace.length; f++) {
    all += area[f];
    const p = partOfFace[f];
    if (p < 0) continue;
    sums[p][labels[f]] += area[f];
    totals[p] += area[f];
  }
  return sums.map((row, p) => ({
    areaPct: all > 0 ? (totals[p] / all) * 100 : 0,
    colours: [...row]
      .map((v, label) => ({ label, pct: totals[p] > 0 ? (v / totals[p]) * 100 : 0 }))
      .filter((c) => c.pct > 0)
      .sort((a, b) => b.pct - a.pct),
  }));
}

/** A part's colour rule: its main colour, and the colours of its details that stay. */
export interface PartRule {
  part: number;
  /** Palette position, or -1 when the main colour is a new one (`mainNew`). */
  main: number;
  keep: number[];
}

/**
 * One colour per part: inside each part, a face of a colour that is neither the
 * part's main colour nor one of its kept details takes the main colour — the baked
 * shading of an AI-made model, a speck — or the kept colour it is a shade of (`near`
 * says which).  Left as they are: protected colours not named, and, in cells on the
 * edge of another part, the colours that part keeps (the cells do not follow the
 * colour border exactly: a sleeve's cell may hold a little of the hand).
 * Returns each face to change and what it becomes (palette position or -1 = main new colour of that part).
 */
export function tidyByParts(
  partOfFace: Int32Array,
  cells: ShapeCells,
  partOfCell: Int32Array,
  labels: Int32Array,
  rules: PartRule[],
  options: {
    protectedLabels: Uint8Array | null;
    near: (label: number, keep: number[]) => number | null;
    /**
     * A detail inside a detail stays: a patch held mostly (60 %+) by a kept colour, and far from it in
     * colour — the dark eye holes of a white skull button (11-04, "해골 단추 눈은 어디로 간거야") — is
     * not shading of the part.  Given the adjacency, `distinct(label, around)` says whether it is far enough.
     */
    adjacency?: { offsets: Int32Array; neighbours: Int32Array };
    distinct?: (label: number, around: number) => boolean;
  },
): { faces: Int32Array; to: Int32Array; parts: Int32Array } {
  const ruleOf = new Map(rules.map((rule) => [rule.part, rule]));
  // The colours each part allows, and for each cell the colours its neighbouring parts allow.
  const allowed = new Map<number, Set<number>>();
  for (const rule of rules) allowed.set(rule.part, new Set([rule.main, ...rule.keep].filter((l) => l >= 0)));
  const edgeAllowed: Array<Set<number> | null> = [];
  for (let c = 0; c < cells.count; c++) {
    const own = partOfCell[c];
    let set: Set<number> | null = null;
    for (const d of cells.touching[c].keys()) {
      const other = partOfCell[d];
      if (other === own || other < 0) continue;
      const theirs = allowed.get(other);
      if (!theirs) continue;
      set ??= new Set();
      for (const l of theirs) set.add(l);
    }
    edgeAllowed.push(set);
  }
  const nearCache = new Map<string, number | null>();
  const faces: number[] = [];
  const to: number[] = [];
  const parts: number[] = [];
  for (let f = 0; f < partOfFace.length; f++) {
    const p = partOfFace[f];
    const rule = ruleOf.get(p);
    if (!rule) continue;
    const label = labels[f];
    if (label === rule.main || rule.keep.includes(label)) continue;
    if (options.protectedLabels?.[label]) continue;
    if (edgeAllowed[cells.cellOf[f]]?.has(label)) continue;
    const key = `${p}:${label}`;
    let near = nearCache.get(key);
    if (near === undefined) {
      near = options.near(label, rule.keep);
      nearCache.set(key, near);
    }
    faces.push(f);
    to.push(near ?? rule.main);
    parts.push(p);
  }
  const { adjacency, distinct } = options;
  if (!adjacency || !distinct || faces.length === 0) return { faces: Int32Array.from(faces), to: Int32Array.from(to), parts: Int32Array.from(parts) };
  // Patches of the faces to change (one colour each); one held by a kept colour it differs from stays.
  const index = new Int32Array(partOfFace.length).fill(-1);
  faces.forEach((f, i) => {
    index[f] = i;
  });
  const stay = new Uint8Array(faces.length);
  const seen = new Uint8Array(faces.length);
  const { offsets, neighbours } = adjacency;
  for (let i0 = 0; i0 < faces.length; i0++) {
    if (seen[i0]) continue;
    const label = labels[faces[i0]];
    const members: number[] = [];
    const around = new Map<number, number>();
    let border = 0;
    const stack = [i0];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      members.push(i);
      const f = faces[i];
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        const j = index[g];
        if (j >= 0 && labels[g] === label) {
          if (!seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
          continue;
        }
        if (labels[g] === label) continue;
        border++;
        // A neighbour that changes too counts as what it becomes (a shade next to shades of the main colour sits in the main colour).
        const becomes = j >= 0 ? to[j] : labels[g];
        around.set(becomes, (around.get(becomes) ?? 0) + 1);
      }
    }
    let top = -1;
    let topCount = 0;
    for (const [l, count] of around) if (count > topCount) {
      top = l;
      topCount = count;
    }
    const rule = ruleOf.get(parts[i0]);
    if (top >= 0 && rule && rule.keep.includes(top) && topCount >= border * 0.6 && distinct(label, top)) {
      for (const i of members) stay[i] = 1;
      continue;
    }
    // A shade no part keeps takes the colour round it that this part (or the part next door, on the
    // edge) allows: the in-between band of a candy cane's stripes goes red or white, not the hand's brown.
    if (!rule || nearCache.get(`${parts[i0]}:${label}`) != null) continue;
    const here = new Set(allowed.get(parts[i0]) ?? []);
    for (const i of members) for (const l of edgeAllowed[cells.cellOf[faces[i]]] ?? []) here.add(l);
    let best = -1;
    let bestCount = 0;
    for (const [l, count] of around) if (here.has(l) && count > bestCount) {
      best = l;
      bestCount = count;
    }
    if (best >= 0 && best !== rule.main) for (const i of members) to[i] = best;
  }
  const keepIdx = [...faces.keys()].filter((i) => !stay[i]);
  return {
    faces: Int32Array.from(keepIdx.map((i) => faces[i])),
    to: Int32Array.from(keepIdx.map((i) => to[i])),
    parts: Int32Array.from(keepIdx.map((i) => parts[i])),
  };
}

/**
 * A part's own colour that spills over a rough part border goes back to its part: a patch
 * of one colour (faces joined) lying in two parts, where the colour is the other part's own
 * (12 %+ of it) and not this one's, is that other part's — the brown of a hand inside the
 * candy cane's cells is the hand's (11-04: "지팡이 잡은 손도 흰색이 왕창 묻어있고"), while the
 * hand's shadow on the cane (a minor shade of the hand) stays the cane's.
 */
export function partsBySpill(partOfFace: Int32Array, labels: Int32Array, adjacency: { offsets: Int32Array; neighbours: Int32Array }, summary: PartSummary[]): Int32Array {
  const n = labels.length;
  const out = partOfFace.slice();
  // 12 %: a part's own colours (a hand's browns, 20–35 % each), not a shadow it casts on its neighbour (6 %).
  const native = (part: number, label: number) => part >= 0 && (summary[part]?.colours.find((c) => c.label === label)?.pct ?? 0) >= 12;
  const { offsets, neighbours } = adjacency;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const label = labels[s];
    const members: number[] = [];
    const count = new Map<number, number>();
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const a = stack.pop() as number;
      members.push(a);
      count.set(partOfFace[a], (count.get(partOfFace[a]) ?? 0) + 1);
      for (let i = offsets[a]; i < offsets[a + 1]; i++) {
        const b = neighbours[i];
        if (!seen[b] && labels[b] === label) {
          seen[b] = 1;
          stack.push(b);
        }
      }
    }
    if (count.size < 2) continue;
    // The part this colour belongs to among those the patch lies in: the one where it is most at home and has the most of it.
    let home = -1;
    let homeCount = 0;
    for (const [part, k] of count) if (native(part, label) && k > homeCount) {
      home = part;
      homeCount = k;
    }
    if (home < 0) continue;
    for (const f of members) if (partOfFace[f] !== home && !native(partOfFace[f], label)) out[f] = home;
  }
  // Then a patch of a colour no part calls its own (the in-between shade along a candy cane's stripe)
  // goes with the part all round it: left in the hand's cells it would take the hand's brown.
  const seen2 = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen2[s]) continue;
    const label = labels[s];
    const members: number[] = [];
    const round = new Map<number, number>();
    seen2[s] = 1;
    stack.push(s);
    while (stack.length) {
      const a = stack.pop() as number;
      members.push(a);
      for (let i = offsets[a]; i < offsets[a + 1]; i++) {
        const b = neighbours[i];
        if (labels[b] === label) {
          if (!seen2[b]) {
            seen2[b] = 1;
            stack.push(b);
          }
        } else round.set(out[b], (round.get(out[b]) ?? 0) + 1);
      }
    }
    let around = -1;
    let aroundCount = 0;
    let all = 0;
    for (const [part, k] of round) {
      all += k;
      if (k > aroundCount) {
        around = part;
        aroundCount = k;
      }
    }
    if (around < 0 || aroundCount < all * 0.6) continue;
    for (const f of members) if (out[f] !== around && !native(out[f], label)) out[f] = around;
  }
  return out;
}
