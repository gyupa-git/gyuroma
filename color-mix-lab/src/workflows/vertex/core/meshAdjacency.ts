import type { Tri } from "./types";

/**
 * Compressed sparse row (CSR) face adjacency.  Two faces are adjacent when
 * they share at least one vertex (the same definition as the reference
 * numpy implementation `A = M @ M.T`).
 */
export interface FaceAdjacency {
  faceCount: number;
  /** offsets[f] .. offsets[f + 1] index into `neighbours`. */
  offsets: Int32Array;
  neighbours: Int32Array;
}

export interface VertexFaceIncidence {
  offsets: Int32Array;
  faces: Int32Array;
}

export function buildVertexFaceIncidence(
  triangles: ArrayLike<Tri>,
  vertexCount: number,
): VertexFaceIncidence {
  const counts = new Int32Array(vertexCount + 1);
  for (let f = 0; f < triangles.length; f++) {
    const tri = triangles[f];
    counts[tri[0] + 1]++;
    counts[tri[1] + 1]++;
    counts[tri[2] + 1]++;
  }
  for (let v = 0; v < vertexCount; v++) counts[v + 1] += counts[v];
  const offsets = counts;
  const fill = new Int32Array(vertexCount);
  const faces = new Int32Array(offsets[vertexCount]);
  for (let f = 0; f < triangles.length; f++) {
    const tri = triangles[f];
    for (let k = 0; k < 3; k++) {
      const v = tri[k];
      faces[offsets[v] + fill[v]] = f;
      fill[v]++;
    }
  }
  return { offsets, faces };
}

export function buildFaceAdjacency(
  triangles: ArrayLike<Tri>,
  vertexCount: number,
): FaceAdjacency {
  const faceCount = triangles.length;
  const incidence = buildVertexFaceIncidence(triangles, vertexCount);
  const stamp = new Int32Array(faceCount);
  const offsets = new Int32Array(faceCount + 1);

  // Pass 1: count unique neighbours per face.
  for (let f = 0; f < faceCount; f++) {
    const tri = triangles[f];
    let count = 0;
    const mark = f + 1;
    stamp[f] = mark;
    for (let k = 0; k < 3; k++) {
      const v = tri[k];
      const end = incidence.offsets[v + 1];
      for (let i = incidence.offsets[v]; i < end; i++) {
        const other = incidence.faces[i];
        if (stamp[other] === mark) continue;
        stamp[other] = mark;
        count++;
      }
    }
    offsets[f + 1] = offsets[f] + count;
  }

  // Pass 2: fill.
  stamp.fill(0);
  const neighbours = new Int32Array(offsets[faceCount]);
  for (let f = 0; f < faceCount; f++) {
    const tri = triangles[f];
    let cursor = offsets[f];
    const mark = f + 1;
    stamp[f] = mark;
    for (let k = 0; k < 3; k++) {
      const v = tri[k];
      const end = incidence.offsets[v + 1];
      for (let i = incidence.offsets[v]; i < end; i++) {
        const other = incidence.faces[i];
        if (stamp[other] === mark) continue;
        stamp[other] = mark;
        neighbours[cursor++] = other;
      }
    }
  }
  return { faceCount, offsets, neighbours };
}

/**
 * Per-vertex majority label over the incident faces.  Labels are 0-based;
 * faces with a negative label do not vote.  Ties resolve to the lowest label
 * (same as `votes.argmax(0)` in the reference implementation).  Vertices
 * without any voting face receive -1.
 */
export function majorityVertexLabels(
  triangles: ArrayLike<Tri>,
  faceLabels: ArrayLike<number>,
  vertexCount: number,
  labelCount: number,
): Int32Array {
  const result = new Int32Array(vertexCount).fill(-1);
  if (labelCount <= 0) return result;
  const incidence = buildVertexFaceIncidence(triangles, vertexCount);
  const votes = new Int32Array(labelCount);
  for (let v = 0; v < vertexCount; v++) {
    const start = incidence.offsets[v];
    const end = incidence.offsets[v + 1];
    if (end <= start) continue;
    votes.fill(0);
    let any = false;
    for (let i = start; i < end; i++) {
      const label = faceLabels[incidence.faces[i]];
      if (label < 0 || label >= labelCount) continue;
      votes[label]++;
      any = true;
    }
    if (!any) continue;
    let best = 0;
    for (let l = 1; l < labelCount; l++) if (votes[l] > votes[best]) best = l;
    result[v] = best;
  }
  return result;
}

export interface SubsetComponents {
  /** Component id for each entry of `subsetIds` (0-based, dense). */
  componentOf: Int32Array;
  componentSizes: Int32Array;
  count: number;
}

/**
 * Connected components of the sub-graph induced by `subsetIds`, using the
 * face adjacency.  `insideSubset` must be a lookup of length faceCount that
 * maps a face id to its position in `subsetIds` (or -1 when not included).
 */
export function connectedComponentsOfSubset(
  adjacency: FaceAdjacency,
  subsetIds: Int32Array,
  insideSubset: Int32Array,
): SubsetComponents {
  const n = subsetIds.length;
  const componentOf = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (componentOf[s] >= 0) continue;
    const id = count++;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    componentOf[s] = id;
    let size = 0;
    while (head < tail) {
      const pos = queue[head++];
      size++;
      const face = subsetIds[pos];
      const end = adjacency.offsets[face + 1];
      for (let i = adjacency.offsets[face]; i < end; i++) {
        const otherPos = insideSubset[adjacency.neighbours[i]];
        if (otherPos < 0 || componentOf[otherPos] >= 0) continue;
        componentOf[otherPos] = id;
        queue[tail++] = otherPos;
      }
    }
    sizes.push(size);
  }
  return { componentOf, componentSizes: Int32Array.from(sizes), count };
}

/**
 * Faces adjacent across a side (two shared vertices): at most three per face,
 * a fraction of the memory of `buildFaceAdjacency` on a large mesh.  Takes the
 * corners flat (3 vertex indices per face).
 */
export function buildEdgeAdjacency(corners: Int32Array, vertexCount: number): FaceAdjacency {
  const faceCount = corners.length / 3;
  // Faces at each vertex.
  const start = new Int32Array(vertexCount + 1);
  for (let c = 0; c < corners.length; c++) start[corners[c] + 1]++;
  for (let v = 0; v < vertexCount; v++) start[v + 1] += start[v];
  const fill = start.slice(0, vertexCount);
  const facesAt = new Int32Array(corners.length);
  for (let c = 0; c < corners.length; c++) facesAt[fill[corners[c]]++] = (c / 3) | 0;
  // Every face sharing a side, however many (a side three faces share — a fin, a face
  // doubled back — has them all, or a cut through it would leave one face uncut).
  const stamp = new Int32Array(faceCount).fill(-1);
  const each = (f: number, take: (n: number) => void) => {
    for (let k = 0; k < 3; k++) {
      const u = corners[f * 3 + k];
      const v = corners[f * 3 + ((k + 1) % 3)];
      for (let i = start[u]; i < start[u + 1]; i++) {
        const n = facesAt[i];
        if (n === f || stamp[n] === f) continue;
        const a = corners[n * 3], b = corners[n * 3 + 1], c = corners[n * 3 + 2];
        if (a !== v && b !== v && c !== v) continue;
        stamp[n] = f;
        take(n);
      }
    }
  };
  const offsets = new Int32Array(faceCount + 1);
  for (let f = 0; f < faceCount; f++) {
    let count = 0;
    each(f, () => count++);
    offsets[f + 1] = offsets[f] + count;
  }
  stamp.fill(-1);
  const neighbours = new Int32Array(offsets[faceCount]);
  for (let f = 0; f < faceCount; f++) {
    let at = offsets[f];
    each(f, (n) => (neighbours[at++] = n));
  }
  return { faceCount, offsets, neighbours };
}
