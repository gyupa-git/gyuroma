import type { MeshModel, Tri } from "./types";

export interface MeshComponent {
  /** Original triangle indices of this shell, ascending. */
  triangles: Int32Array;
}

/**
 * Connected shells of a mesh: two triangles belong to the same shell when they
 * share at least one vertex (the same rule PrusaSlicer's "split to objects"
 * uses).  Splitting in PrusaSlicer throws the multi-material painting away,
 * because painting is stored per triangle index and splitting renumbers the
 * triangles; exporting the shells as separate 3MF objects keeps the paint.
 *
 * Returned largest shell first.
 */
export function splitMeshComponents(model: MeshModel): MeshComponent[] {
  const triangles = model.triangles;
  const faceCount = triangles.length;
  const vertexCount = model.vertices.length;
  if (faceCount === 0) return [];

  // Union-find over vertices with path halving; a triangle merges its three.
  const parent = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) parent[v] = v;
  const find = (start: number): number => {
    let x = start;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let f = 0; f < faceCount; f++) {
    const [v1, v2, v3] = triangles[f] as Tri;
    union(v1, v2);
    union(v1, v3);
  }

  // Root -> component slot, then collect triangles per component.
  const slotByRoot = new Map<number, number>();
  const slotOfFace = new Int32Array(faceCount);
  const sizes: number[] = [];
  for (let f = 0; f < faceCount; f++) {
    const root = find((triangles[f] as Tri)[0]);
    let slot = slotByRoot.get(root);
    if (slot === undefined) {
      slot = sizes.length;
      slotByRoot.set(root, slot);
      sizes.push(0);
    }
    slotOfFace[f] = slot;
    sizes[slot]++;
  }

  const buffers = sizes.map((size) => new Int32Array(size));
  const fill = new Int32Array(sizes.length);
  for (let f = 0; f < faceCount; f++) {
    const slot = slotOfFace[f];
    buffers[slot][fill[slot]++] = f;
  }
  return buffers
    .map((tris) => ({ triangles: tris }))
    .sort((a, b) => b.triangles.length - a.triangles.length);
}
