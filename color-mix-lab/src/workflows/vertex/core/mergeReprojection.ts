import type { RGB, Tri } from "./types";
import {
  buildFaceAdjacency,
  connectedComponentsOfSubset,
  type FaceAdjacency,
} from "./meshAdjacency";

/**
 * Feature B of the Rodin work order: "merge with shade re-judgement and
 * cleanup".
 *
 * A plain palette merge ("put #D6C0C3 into skin") recolours every face of the
 * merged colour, including the faces where that colour was only a shadow or an
 * anti-aliased boundary of a completely different surface.  This module keeps
 * the user's merge for the "certain" colours, clears the "ambiguous" ones and
 * lets them follow the surface they are connected to, then removes boundary
 * jaggies and tiny islands.
 *
 * The algorithm mirrors the verified numpy reference (merge_with_reprojection)
 * step by step; the only deliberate difference is that a small island without
 * any foreign neighbour keeps its group instead of falling back to group 0.
 */

export const DEFAULT_MIN_BLOB = 150;
export const DEFAULT_MIN_BLOB_SKIN = 60;
export const DEFAULT_MIN_BLOB_DARK = 120;

export interface MergeReprojectionOptions {
  /** Per-face source label (0-based palette position). */
  faceLabels: Int32Array;
  /** Palette position -> merge group (0-based, dense). */
  labelToGroup: Int32Array;
  groupCount: number;
  /** Palette positions treated as shade / boundary ("ambiguous") colours. */
  ambiguousLabels?: Iterable<number>;
  /** Groups the cleanup must not touch (small but important accents). */
  protectGroups?: Iterable<number>;
  /** Minimum island size per group; islands below it are absorbed. */
  minBlob?: Map<number, number> | number;
  maxPropagationRounds?: number;
  smoothingRounds?: number;
  /**
   * Protected groups (eyes, mouth lines, small accents) are evened out too:
   * a face sticking out of one goes to the colour around it, but never one
   * whose removal would cut the shape in two, and never a dot standing on its
   * own — so a line one face wide stays whole.  Only in the first
   * PROTECTED_SMOOTHING_ROUNDS rounds: teeth are a face or two deep, and the
   * ends of a line lose at most that much.  Still never absorbed as islands.
   * Off, protected groups are frozen as they are, teeth included.
   */
  smoothProtected?: boolean;
}

/** How strongly a protected face keeps its group in the smoothing (see smoothProtected). */
export const PROTECTED_SMOOTHING_BIAS = 4;
export const PROTECTED_SMOOTHING_ROUNDS = 2;

/**
 * True when the faces of `group` around f fall apart into more than one
 * piece without f: f holds them together (the middle of a thin line).
 */
function holdsTogether(adjacency: FaceAdjacency, g: Int32Array, f: number, group: number, seen: Int32Array, stamp: number): boolean {
  const start = adjacency.offsets[f];
  const end = adjacency.offsets[f + 1];
  const around: number[] = [];
  for (let i = start; i < end; i++) {
    const n = adjacency.neighbours[i];
    if (g[n] === group) around.push(n);
  }
  if (around.length <= 1) return false;
  // Mark the ring, then flood from its first face through ring faces only.
  for (const n of around) seen[n] = stamp;
  const queue = [around[0]];
  seen[around[0]] = -stamp;
  let reached = 1;
  while (queue.length > 0) {
    const a = queue.pop() as number;
    const aEnd = adjacency.offsets[a + 1];
    for (let i = adjacency.offsets[a]; i < aEnd; i++) {
      const b = adjacency.neighbours[i];
      if (seen[b] !== stamp) continue;
      seen[b] = -stamp;
      reached++;
      queue.push(b);
    }
  }
  return reached < around.length;
}

export interface MergeReprojectionStats {
  ambiguousFaceCount: number;
  propagationRounds: number;
  filledByPropagation: number;
  isolatedFallback: number;
  smoothedFaceChanges: number;
  absorbedIslands: number;
  absorbedFaces: number;
}

export interface MergeReprojectionResult {
  /** Final group per face. */
  groups: Int32Array;
  /** Plain palette merge without re-judgement, for comparison. */
  naiveGroups: Int32Array;
  stats: MergeReprojectionStats;
}

function argmaxRow(values: Float32Array | Float64Array | Int32Array, start: number, count: number): number {
  let best = 0;
  let bestValue = values[start];
  for (let k = 1; k < count; k++) {
    const value = values[start + k];
    if (value > bestValue) {
      bestValue = value;
      best = k;
    }
  }
  return best;
}

export function mergeWithReprojection(
  adjacency: FaceAdjacency,
  options: MergeReprojectionOptions,
): MergeReprojectionResult {
  const { faceLabels, labelToGroup, groupCount } = options;
  const faceCount = adjacency.faceCount;
  if (faceLabels.length !== faceCount)
    throw new Error("faceLabels length does not match the adjacency face count.");
  if (groupCount <= 0) throw new Error("groupCount must be positive.");
  const maxPropagationRounds = options.maxPropagationRounds ?? 80;
  const smoothingRounds = options.smoothingRounds ?? 3;

  const ambiguous = new Uint8Array(labelToGroup.length);
  for (const label of options.ambiguousLabels ?? []) {
    if (label >= 0 && label < ambiguous.length) ambiguous[label] = 1;
  }
  const protectedGroup = new Uint8Array(groupCount);
  for (const group of options.protectGroups ?? []) {
    if (group >= 0 && group < groupCount) protectedGroup[group] = 1;
  }
  const minBlob = new Int32Array(groupCount).fill(DEFAULT_MIN_BLOB);
  if (typeof options.minBlob === "number") {
    minBlob.fill(Math.max(0, Math.round(options.minBlob)));
  } else if (options.minBlob) {
    for (const [group, threshold] of options.minBlob) {
      if (group >= 0 && group < groupCount)
        minBlob[group] = Math.max(0, Math.round(threshold));
    }
  }

  const naive = new Int32Array(faceCount);
  const g = new Int32Array(faceCount);
  let ambiguousFaceCount = 0;
  for (let f = 0; f < faceCount; f++) {
    const label = faceLabels[f];
    const group = label >= 0 && label < labelToGroup.length ? labelToGroup[label] : 0;
    naive[f] = group;
    if (label >= 0 && label < ambiguous.length && ambiguous[label]) {
      g[f] = -1;
      ambiguousFaceCount++;
    } else {
      g[f] = group;
    }
  }

  const stats: MergeReprojectionStats = {
    ambiguousFaceCount,
    propagationRounds: 0,
    filledByPropagation: 0,
    isolatedFallback: 0,
    smoothedFaceChanges: 0,
    absorbedIslands: 0,
    absorbedFaces: 0,
  };

  // 1) Ambiguous faces follow the majority of their already-resolved
  //    neighbours; ties go to the user's merge (+0.5).  Jacobi style: all
  //    assignments of a round are computed from the previous round.
  const votes = new Float32Array(groupCount);
  let unresolved: number[] = [];
  for (let f = 0; f < faceCount; f++) if (g[f] < 0) unresolved.push(f);
  const pendingFace: number[] = [];
  const pendingGroup: number[] = [];
  for (let round = 0; round < maxPropagationRounds && unresolved.length > 0; round++) {
    stats.propagationRounds = round + 1;
    pendingFace.length = 0;
    pendingGroup.length = 0;
    for (const f of unresolved) {
      votes.fill(0);
      let total = 0;
      const end = adjacency.offsets[f + 1];
      for (let i = adjacency.offsets[f]; i < end; i++) {
        const ng = g[adjacency.neighbours[i]];
        if (ng < 0) continue;
        votes[ng] += 1;
        total += 1;
      }
      votes[naive[f]] += 0.5;
      total += 0.5;
      if (total > 0.5) {
        pendingFace.push(f);
        pendingGroup.push(argmaxRow(votes, 0, groupCount));
      }
    }
    if (pendingFace.length === 0) break;
    for (let i = 0; i < pendingFace.length; i++) g[pendingFace[i]] = pendingGroup[i];
    stats.filledByPropagation += pendingFace.length;
    unresolved = unresolved.filter((f) => g[f] < 0);
  }
  for (const f of unresolved) {
    g[f] = naive[f];
    stats.isolatedFallback++;
  }

  // 2) Boundary cleanup: a few rounds of neighbour majority with a bias of
  //    2 towards the current group.  Protected groups are frozen (see
  //    smoothProtected for evening them out as well).
  const smoothProtected = options.smoothProtected ?? false;
  const prot = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) if (protectedGroup[g[f]]) prot[f] = 1;
  const next = new Int32Array(faceCount);
  const seen = smoothProtected ? new Int32Array(faceCount) : null;
  let stamp = 0;
  for (let round = 0; round < smoothingRounds; round++) {
    for (let f = 0; f < faceCount; f++) {
      if (prot[f]) {
        next[f] = g[f];
        continue;
      }
      votes.fill(0);
      const end = adjacency.offsets[f + 1];
      for (let i = adjacency.offsets[f]; i < end; i++) votes[g[adjacency.neighbours[i]]] += 1;
      votes[g[f]] += 2;
      next[f] = argmaxRow(votes, 0, groupCount);
    }
    if (seen && round < PROTECTED_SMOOTHING_ROUNDS) {
      // Protected faces, decided from the same state as the rest (so nothing
      // cascades along a line within a round) but taken out one by one, each
      // only if it does not hold its shape together after the earlier ones.
      const candidates: number[] = [];
      for (let f = 0; f < faceCount; f++) {
        if (!prot[f]) continue;
        const own = g[f];
        votes.fill(0);
        const end = adjacency.offsets[f + 1];
        for (let i = adjacency.offsets[f]; i < end; i++) votes[g[adjacency.neighbours[i]]] += 1;
        if (votes[own] === 0) continue; // a dot of its own stays
        let best = -1;
        let bestVotes = votes[own] + PROTECTED_SMOOTHING_BIAS;
        for (let k = 0; k < groupCount; k++) {
          if (k !== own && votes[k] > bestVotes) {
            best = k;
            bestVotes = votes[k];
          }
        }
        if (best >= 0) {
          candidates.push(f);
          next[f] = best;
        }
      }
      for (let f = 0; f < faceCount; f++) {
        if (prot[f]) continue;
        if (next[f] !== g[f]) stats.smoothedFaceChanges++;
        g[f] = next[f];
      }
      for (const f of candidates) {
        if (holdsTogether(adjacency, g, f, g[f], seen, ++stamp)) continue;
        g[f] = next[f];
        stats.smoothedFaceChanges++;
      }
      // What is protected from here on is what the protected groups cover now.
      for (let f = 0; f < faceCount; f++) prot[f] = protectedGroup[g[f]];
      continue;
    }
    for (let f = 0; f < faceCount; f++) {
      if (next[f] !== g[f]) stats.smoothedFaceChanges++;
      g[f] = next[f];
    }
  }

  // 3) Absorb small islands into the surrounding groups.
  const insideSubset = new Int32Array(faceCount).fill(-1);
  for (let k = 0; k < groupCount; k++) {
    if (protectedGroup[k]) continue;
    const threshold = minBlob[k];
    if (threshold <= 0) continue;
    const ids: number[] = [];
    for (let f = 0; f < faceCount; f++) if (g[f] === k && !prot[f]) ids.push(f);
    if (ids.length === 0) continue;
    const subsetIds = Int32Array.from(ids);
    for (let i = 0; i < subsetIds.length; i++) insideSubset[subsetIds[i]] = i;
    const components = connectedComponentsOfSubset(adjacency, subsetIds, insideSubset);
    const smallComponent = new Uint8Array(components.count);
    let anySmall = false;
    for (let c = 0; c < components.count; c++) {
      if (components.componentSizes[c] < threshold) {
        smallComponent[c] = 1;
        anySmall = true;
      }
    }
    if (anySmall) {
      const aggregate = new Float32Array(components.count * groupCount);
      for (let i = 0; i < subsetIds.length; i++) {
        const c = components.componentOf[i];
        if (!smallComponent[c]) continue;
        const f = subsetIds[i];
        const end = adjacency.offsets[f + 1];
        for (let j = adjacency.offsets[f]; j < end; j++) {
          const ng = g[adjacency.neighbours[j]];
          if (ng === k) continue;
          aggregate[c * groupCount + ng] += 1;
        }
      }
      const targetOfComponent = new Int32Array(components.count).fill(-1);
      for (let c = 0; c < components.count; c++) {
        if (!smallComponent[c]) continue;
        let sum = 0;
        for (let q = 0; q < groupCount; q++) sum += aggregate[c * groupCount + q];
        if (sum <= 0) continue; // fully enclosed island: nothing to absorb into
        targetOfComponent[c] = argmaxRow(aggregate, c * groupCount, groupCount);
        stats.absorbedIslands++;
      }
      for (let i = 0; i < subsetIds.length; i++) {
        const target = targetOfComponent[components.componentOf[i]];
        if (target < 0) continue;
        g[subsetIds[i]] = target;
        stats.absorbedFaces++;
      }
    }
    for (let i = 0; i < subsetIds.length; i++) insideSubset[subsetIds[i]] = -1;
  }

  return { groups: g, naiveGroups: naive, stats };
}

// ---------------------------------------------------------------------------
// Heuristics for the UI defaults
// ---------------------------------------------------------------------------

export interface HsvColour {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv(rgb: RGB): HsvColour {
  const r = rgb[0] / 255;
  const gr = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, gr, b);
  const min = Math.min(r, gr, b);
  const d = max - min;
  const v = max;
  const s = max > 0 ? d / max : 0;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((gr - b) / d) % 6;
    else if (max === gr) h = (b - r) / d + 2;
    else h = (r - gr) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

export interface AmbiguousColourCriteria {
  maxSaturation: number;
  minValue: number;
  maxValue: number;
  minAreaFraction: number;
}

export const DEFAULT_AMBIGUOUS_CRITERIA: AmbiguousColourCriteria = {
  maxSaturation: 0.25,
  minValue: 0.3,
  maxValue: 0.85,
  minAreaFraction: 0.03,
};

/** Suggested "shade / boundary colour" flag for one palette colour. */
export function isLikelyAmbiguousColour(
  rgb: RGB,
  areaFraction: number,
  criteria: AmbiguousColourCriteria = DEFAULT_AMBIGUOUS_CRITERIA,
): boolean {
  const { s, v } = rgbToHsv(rgb);
  if (s < criteria.maxSaturation && v > criteria.minValue && v < criteria.maxValue) return true;
  return areaFraction < criteria.minAreaFraction;
}

export interface ProtectColourCriteria {
  maxAreaFraction: number;
  minSaturation: number;
}

export const DEFAULT_PROTECT_CRITERIA: ProtectColourCriteria = {
  maxAreaFraction: 0.01,
  minSaturation: 0.5,
};

/** Suggested "protect from cleanup" flag: tiny but saturated accents. */
export function isLikelyProtectedColour(
  rgb: RGB,
  areaFraction: number,
  criteria: ProtectColourCriteria = DEFAULT_PROTECT_CRITERIA,
): boolean {
  const { s } = rgbToHsv(rgb);
  return areaFraction < criteria.maxAreaFraction && s >= criteria.minSaturation;
}

export function isSkinLikeColour(rgb: RGB): boolean {
  const { h, s, v } = rgbToHsv(rgb);
  return h >= 5 && h <= 45 && s >= 0.12 && s <= 0.65 && v >= 0.5;
}

export function isDarkColour(rgb: RGB): boolean {
  return rgbToHsv(rgb).v < 0.35;
}

/** Recommended minimum island size for a palette colour (work order §3). */
export function defaultMinBlobForColour(rgb: RGB): number {
  if (isSkinLikeColour(rgb)) return DEFAULT_MIN_BLOB_SKIN;
  if (isDarkColour(rgb)) return DEFAULT_MIN_BLOB_DARK;
  return DEFAULT_MIN_BLOB;
}

/** Fraction of total weight (area or count) per group. */
export function groupWeightFractions(
  groups: ArrayLike<number>,
  groupCount: number,
  weights?: ArrayLike<number>,
): Float64Array {
  const sums = new Float64Array(groupCount);
  let total = 0;
  for (let f = 0; f < groups.length; f++) {
    const group = groups[f];
    if (group < 0 || group >= groupCount) continue;
    const w = weights ? weights[f] : 1;
    sums[group] += w;
    total += w;
  }
  if (total > 0) for (let k = 0; k < groupCount; k++) sums[k] /= total;
  return sums;
}

export function faceAdjacencyForMesh(triangles: ArrayLike<Tri>, vertexCount: number): FaceAdjacency {
  return buildFaceAdjacency(triangles, vertexCount);
}
