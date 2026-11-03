import type { FaceAdjacency } from "@core/meshAdjacency";

/**
 * The model as parts the AI can point at: each patch (faces of one palette
 * colour joined to each other) big enough to matter gets a number, biggest
 * first, the same number that is drawn on its pictures.  What is left — the
 * specks — is only counted, per colour: the speck clean-up handles those, not
 * a region at a time.
 */
export interface Region {
  /** 1-based number shown on the pictures (biggest first). */
  id: number;
  /** Palette position. */
  label: number;
  faces: number;
  /** Share of the surface, 0..100. */
  areaPct: number;
  /** The palette positions it borders, with their share of its border (0..1), biggest first. */
  borders: Array<{ label: number; share: number }>;
}

export interface UnlistedPatches {
  label: number;
  patches: number;
  faces: number;
  /** Patches of at most 20 faces (specks). */
  tiny: number;
}

export interface RegionMap {
  regions: Region[];
  /** Face → index into `regions`, -1 for a face of a patch not listed. */
  regionOf: Int32Array;
  /** Patches not listed, per palette position (biggest total first). */
  unlisted: UnlistedPatches[];
  patchCount: number;
}

export interface RegionOptions {
  /** A patch is listed from this share of the surface (0..100). Default 0.02. */
  minPct?: number;
  /** At most this many regions. Default 40. */
  max?: number;
}

const TINY = 20;

export function findRegions(labels: Int32Array, adjacency: FaceAdjacency, area: ArrayLike<number>, options: RegionOptions = {}): RegionMap {
  const n = labels.length;
  const minPct = options.minPct ?? 0.02;
  const max = options.max ?? 40;
  const { offsets, neighbours } = adjacency;
  let total = 0;
  for (let f = 0; f < n; f++) total += area[f];
  if (!(total > 0)) total = 1;

  // Patches: faces of one label joined through shared corners (as the rest of the app joins them).
  const patch = new Int32Array(n).fill(-1);
  const patchFaces: number[] = [];
  const patchArea: number[] = [];
  const patchLabel: number[] = [];
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (patch[s] >= 0) continue;
    const id = patchFaces.length;
    const label = labels[s];
    let size = 0;
    let sum = 0;
    let top = 0;
    patch[s] = id;
    stack[top++] = s;
    while (top > 0) {
      const a = stack[--top];
      size++;
      sum += area[a];
      for (let i = offsets[a]; i < offsets[a + 1]; i++) {
        const b = neighbours[i];
        if (patch[b] < 0 && labels[b] === label) {
          patch[b] = id;
          stack[top++] = b;
        }
      }
    }
    patchFaces.push(size);
    patchArea.push(sum);
    patchLabel.push(label);
  }

  const order = patchFaces.map((_, i) => i).sort((a, b) => patchArea[b] - patchArea[a] || a - b);
  const listed = order.filter((p) => (patchArea[p] / total) * 100 >= minPct).slice(0, max);
  const indexOfPatch = new Int32Array(patchFaces.length).fill(-1);
  listed.forEach((p, i) => {
    indexOfPatch[p] = i;
  });

  const regionOf = new Int32Array(n);
  const borderCounts = listed.map(() => new Map<number, number>());
  const borderTotal = new Float64Array(listed.length);
  for (let f = 0; f < n; f++) {
    const r = indexOfPatch[patch[f]];
    regionOf[f] = r;
    if (r < 0) continue;
    const label = labels[f];
    for (let i = offsets[f]; i < offsets[f + 1]; i++) {
      const other = labels[neighbours[i]];
      if (other === label) continue;
      const counts = borderCounts[r];
      counts.set(other, (counts.get(other) ?? 0) + 1);
      borderTotal[r]++;
    }
  }

  const regions: Region[] = listed.map((p, i) => ({
    id: i + 1,
    label: patchLabel[p],
    faces: patchFaces[p],
    areaPct: (patchArea[p] / total) * 100,
    borders: [...borderCounts[i].entries()]
      .map(([label, count]) => ({ label, share: borderTotal[i] > 0 ? count / borderTotal[i] : 0 }))
      .sort((a, b) => b.share - a.share),
  }));

  const byLabel = new Map<number, UnlistedPatches>();
  const unlistedArea = new Map<number, number>();
  for (let p = 0; p < patchFaces.length; p++) {
    if (indexOfPatch[p] >= 0) continue;
    const label = patchLabel[p];
    const row = byLabel.get(label) ?? { label, patches: 0, faces: 0, tiny: 0 };
    row.patches++;
    row.faces += patchFaces[p];
    if (patchFaces[p] <= TINY) row.tiny++;
    byLabel.set(label, row);
    unlistedArea.set(label, (unlistedArea.get(label) ?? 0) + patchArea[p]);
  }
  const unlisted = [...byLabel.values()].sort((a, b) => (unlistedArea.get(b.label) ?? 0) - (unlistedArea.get(a.label) ?? 0));
  return { regions, regionOf, unlisted, patchCount: patchFaces.length };
}

/** The faces of the listed regions with these numbers. */
export function regionFaces(map: RegionMap, ids: Iterable<number>): Int32Array {
  const wanted = new Uint8Array(map.regions.length + 1);
  for (const id of ids) if (id >= 1 && id <= map.regions.length) wanted[id] = 1;
  const out: number[] = [];
  const { regionOf } = map;
  for (let f = 0; f < regionOf.length; f++) {
    const r = regionOf[f];
    if (r >= 0 && wanted[r + 1]) out.push(f);
  }
  return Int32Array.from(out);
}
