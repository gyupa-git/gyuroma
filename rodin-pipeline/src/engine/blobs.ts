import type { FaceAdjacency } from "@core/meshAdjacency";
import type { CreaseGeometry } from "./creases";
import { buildColourStrip, colourKey, groupsFromCuts, initialCuts, stripLabels, stripPalette } from "@core/colourStrip";
import type { RGB } from "@core/types";

/**
 * One part up close (11-04, the owner on Tkc's goggles: "색 수량을 확 줄여서 계열색이나 그런 구분,
 * 또 늘려서 비교하며 그 덩어리의 구분선과 형태의 이해를 통해 그 덩어리를 묶어서 하나의 색으로"):
 * the model's own colours of a few faces laid out twice, in a few families (coarse) and in many
 * shades (fine).  The fine patches are the blobs; a speck goes into its neighbour, and two
 * neighbours of the same family with no groove between them are one blob (shading, not a
 * border).  What is left — a few dozen blobs — is numbered on a close-up for the AI, which
 * groups them into pieces by their shape (a rim, a lens, a strap) and gives each one colour.
 */
export interface Blob {
  /** 1-based number on the pictures (biggest first). */
  id: number;
  /** Indices into the region's faces. */
  members: Int32Array;
  /** Share of the region, 0..100. */
  areaPct: number;
  /** The model's own colour, area-weighted mean. */
  mean: RGB;
  /** Its colour family (orange, blue, neutral …: the strip's family number and name). */
  family: number;
  familyName: string;
}

export interface BlobMap {
  /** The faces looked at. */
  faces: Int32Array;
  blobs: Blob[];
  /** Region index → blob index (into `blobs`). */
  blobOf: Int32Array;
  /** The coarse layout's colours (a few, by family and lightness). */
  coarse: RGB[];
}

export interface BlobOptions {
  /** Colour groups of the coarse and the fine layout. */
  coarse?: number;
  fine?: number;
  /** At most this many blobs. */
  max?: number;
  /** A blob under this share of the region is a speck (0..1)… */
  speck?: number;
  /**
   * …and under this much area (the model's own scale, a big region's 0.15 % being an eye's highlight
   * — 11-04 Bvc's light blue glint in the eye went as a speck of the head and its cells round).
   */
  speckArea?: number;
  /**
   * Two neighbours of one family are shading of one blob when the colour changes only a little right
   * across their border (mean Lab ΔE of the faces facing each other under this) and no groove runs along it.
   * A real edge — rim against hat band — jumps there, however soft the texture is further in.
   */
  shade?: number;
  /** …and the two blobs' mean colours are closer than this (Lab ΔE), so shading does not creep across a soft edge. */
  spread?: number;
  /**
   * …and are one material: baked light makes a colour lighter or darker but keeps how colourful it is
   * for its lightness (chroma ÷ lightness) and its hue — a tan rim light and dark stays one, a gold trim
   * on a grey-white plate (11-04 Tkc's collar: both ~L65, chroma 24 against 7) does not.
   */
  saturation?: number;
  hue?: number;
  /**
   * Face centres and normals: a patch does not run on over a fold that bends inwards more than `fold`
   * (1 − cos of the angle, 0.3 ≈ 45°).  Two things of one colour meet in such a fold — a lens sunk in
   * its rim, the lip of a hat's brim on the hair (11-04 Tkc: both tan, one blob, and the hair took the brim).
   */
  geometry?: CreaseGeometry | null;
  fold?: number;
}

export function regionBlobs(
  faces: Int32Array,
  own: ArrayLike<RGB>,
  area: ArrayLike<number>,
  adjacency: FaceAdjacency,
  concavity: Float32Array,
  options: BlobOptions = {},
): BlobMap {
  const n = faces.length;
  const coarseK = options.coarse ?? 6;
  const fineK = options.fine ?? 24;
  const max = options.max ?? 36;
  const speck = options.speck ?? 0.0015;
  const speckArea = options.speckArea ?? Infinity;
  const rgb: RGB[] = new Array(n);
  const weight: number[] = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    rgb[i] = own[faces[i]];
    weight[i] = area[faces[i]];
    total += weight[i];
  }
  if (!(total > 0)) total = 1;
  const strip = buildColourStrip(rgb, weight);
  const layout = (k: number) => {
    const built = stripPalette(groupsFromCuts(strip, initialCuts(strip, k)));
    return { labels: stripLabels(rgb, built.groupOfKey, built.palette), colours: built.palette.map((e) => e.rgb) };
  };
  const coarse = layout(coarseK);
  const fine = layout(fineK);
  const familyOfKey = new Map<number, number>();
  const familyName = new Map<number, string>();
  for (const family of strip.families) {
    familyName.set(family.family, family.name);
    for (const colour of family.colours) familyOfKey.set(colour.key, family.family);
  }
  const shadeLimit = options.shade ?? 9;
  const meanLimit = options.spread ?? 30;
  const saturationLimit = options.saturation ?? 0.12;
  const hueLimit = ((options.hue ?? 20) * Math.PI) / 180;

  // Face → its index in the region (a whole part of a big model is a million faces: no Map).
  const { offsets, neighbours } = adjacency;
  const index = new Int32Array(Math.max(0, offsets.length - 1)).fill(-1);
  faces.forEach((f, i) => {
    index[f] = i;
  });
  const each = (i: number, visit: (j: number) => void) => {
    const f = faces[i];
    for (let k = offsets[f]; k < offsets[f + 1]; k++) {
      const j = index[neighbours[k]];
      if (j >= 0) visit(j);
    }
  };

  // A fold between two faces: the next one lies above this one's surface and this one above the next's (a valley), sharply.
  const geometry = options.geometry ?? null;
  const foldLimit = options.fold ?? 0.3;
  const folded = (i: number, j: number): boolean => {
    if (!geometry) return false;
    const { centroids: c, normals: nm } = geometry;
    const f = faces[i], g = faces[j];
    const dx = c[g * 3] - c[f * 3], dy = c[g * 3 + 1] - c[f * 3 + 1], dz = c[g * 3 + 2] - c[f * 3 + 2];
    const len = Math.hypot(dx, dy, dz) || 1e-9;
    const up = (dx * nm[f * 3] + dy * nm[f * 3 + 1] + dz * nm[f * 3 + 2]) / len;
    const down = (dx * nm[g * 3] + dy * nm[g * 3 + 1] + dz * nm[g * 3 + 2]) / len;
    if (!(up > 0.02 && down < -0.02)) return false;
    const cos = nm[f * 3] * nm[g * 3] + nm[f * 3 + 1] * nm[g * 3 + 1] + nm[f * 3 + 2] * nm[g * 3 + 2];
    return 1 - cos > foldLimit;
  };

  // Fine patches (one colour, not over a fold).
  const patch = new Int32Array(n).fill(-1);
  let patches = 0;
  for (let s = 0; s < n; s++) {
    if (patch[s] >= 0) continue;
    const id = patches++;
    const stack = [s];
    patch[s] = id;
    while (stack.length) {
      const i = stack.pop() as number;
      each(i, (j) => {
        if (patch[j] < 0 && fine.labels[j] === fine.labels[i] && !folded(i, j)) {
          patch[j] = id;
          stack.push(j);
        }
      });
    }
  }
  const parent = Int32Array.from({ length: patches }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const areaOfPatch = new Float64Array(patches);
  const familyVotes = Array.from({ length: patches }, () => new Map<number, number>());
  // The mean colour of each blob as it grows (Lab, area-weighted sums).
  const labSum = new Float64Array(patches * 3);
  const lab = (c: RGB): [number, number, number] => {
    const lin = (v: number) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const faceLab = new Float32Array(n * 3);
  const labByKey = new Map<number, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const k = colourKey(rgb[i]);
    let l = labByKey.get(k);
    if (!l) labByKey.set(k, (l = lab(rgb[i])));
    faceLab[i * 3] = l[0];
    faceLab[i * 3 + 1] = l[1];
    faceLab[i * 3 + 2] = l[2];
    const p = patch[i];
    areaOfPatch[p] += weight[i];
    const fam = familyOfKey.get(k) ?? -1;
    familyVotes[p].set(fam, (familyVotes[p].get(fam) ?? 0) + weight[i]);
    labSum[p * 3] += l[0] * weight[i];
    labSum[p * 3 + 1] += l[1] * weight[i];
    labSum[p * 3 + 2] += l[2] * weight[i];
  }
  const meanDe = (a: number, b: number) => {
    const wa = areaOfPatch[a] || 1, wb = areaOfPatch[b] || 1;
    return Math.hypot(labSum[a * 3] / wa - labSum[b * 3] / wb, labSum[a * 3 + 1] / wa - labSum[b * 3 + 1] / wb, labSum[a * 3 + 2] / wa - labSum[b * 3 + 2] / wb);
  };
  /** One material lit differently: close in how colourful for their lightness, and in hue where both have colour. */
  const sameMaterial = (a: number, b: number) => {
    const wa = areaOfPatch[a] || 1, wb = areaOfPatch[b] || 1;
    const la = labSum[a * 3] / wa, aa = labSum[a * 3 + 1] / wa, ba = labSum[a * 3 + 2] / wa;
    const lb = labSum[b * 3] / wb, ab = labSum[b * 3 + 1] / wb, bb = labSum[b * 3 + 2] / wb;
    const ca = Math.hypot(aa, ba), cb = Math.hypot(ab, bb);
    if (Math.abs(ca / Math.max(la, 8) - cb / Math.max(lb, 8)) >= saturationLimit) return false;
    if (Math.min(ca, cb) < 8) return true;
    let dh = Math.abs(Math.atan2(ba, aa) - Math.atan2(bb, ab));
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    return dh < hueLimit;
  };
  const familyOf = (root: number): number => {
    let best = -1;
    let bestW = -1;
    for (const [family, w] of familyVotes[root]) if (w > bestW) {
      best = family;
      bestW = w;
    }
    return best;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // The bigger one stays the root.
    const [keep, gone] = areaOfPatch[ra] >= areaOfPatch[rb] ? [ra, rb] : [rb, ra];
    parent[gone] = keep;
    areaOfPatch[keep] += areaOfPatch[gone];
    for (let k = 0; k < 3; k++) labSum[keep * 3 + k] += labSum[gone * 3 + k];
    for (const [family, w] of familyVotes[gone]) familyVotes[keep].set(family, (familyVotes[keep].get(family) ?? 0) + w);
  };
  /** The borders between the blobs as they are: shared contacts and how deep the faces along them sit in a groove. */
  const borders = () => {
    const out = new Map<number, Map<number, { count: number; groove: number; jump: number; folds: number }>>();
    for (let i = 0; i < n; i++) {
      const a = find(patch[i]);
      each(i, (j) => {
        const b = find(patch[j]);
        if (a === b) return;
        let row = out.get(a);
        if (!row) out.set(a, (row = new Map()));
        const cell = row.get(b) ?? { count: 0, groove: 0, jump: 0, folds: 0 };
        cell.count++;
        if (folded(i, j)) cell.folds++;
        cell.groove += Math.max(0, concavity[faces[i]]);
        cell.jump += Math.hypot(faceLab[i * 3] - faceLab[j * 3], faceLab[i * 3 + 1] - faceLab[j * 3 + 1], faceLab[i * 3 + 2] - faceLab[j * 3 + 2]);
        row.set(b, cell);
      });
    }
    return out;
  };
  const roots = () => {
    const out = new Set<number>();
    for (let p = 0; p < patches; p++) out.add(find(p));
    return [...out];
  };
  let meanGroove = 0;
  for (let i = 0; i < n; i++) meanGroove += Math.max(0, concavity[faces[i]]);
  meanGroove /= n;

  // 1. Specks into the neighbour they share the most border with.
  for (let round = 0; round < 6; round++) {
    const bs = borders();
    let merged = 0;
    for (const r of roots()) {
      if (find(r) !== r || areaOfPatch[r] / total >= speck || areaOfPatch[r] >= speckArea) continue;
      const row = bs.get(r);
      if (!row) continue;
      let best = -1;
      let bestCount = 0;
      for (const [b, cell] of row) if (cell.count - cell.folds * 0.75 > bestCount) {
        best = b;
        bestCount = cell.count - cell.folds * 0.75;
      }
      if (best >= 0) {
        union(r, best);
        merged++;
      }
    }
    if (merged === 0) break;
  }
  // 2. Shading: neighbours with only a small colour step across their border and no groove along it.
  for (let round = 0; round < 8; round++) {
    const bs = borders();
    let merged = 0;
    for (const [a, row] of bs)
      for (const [b, cell] of row) {
        if (find(a) === find(b)) continue;
        // (Not the family: its hue line can run through one shaded rim.)
        // Both: a small step across the border, and blobs whose colours as a whole are still close — a soft
        // texture edge is a chain of small steps (white collar → tan trim → skin) that must not join up (11-04 Tkc).
        if (cell.jump / cell.count >= shadeLimit || meanDe(find(a), find(b)) >= meanLimit || !sameMaterial(find(a), find(b))) continue;
        if (cell.groove / cell.count > Math.max(meanGroove * 2.5, 1e-4) || cell.folds > cell.count * 0.3) continue;
        union(a, b);
        merged++;
      }
    if (merged === 0) break;
  }
  // 3. No more than `max`: the smallest into the neighbour it shares the most border with (its own family first).
  //    The border counts are carried along as blobs join (worked out again for every join, a whole hat took minutes).
  {
    // Per neighbour: the contacts, less most of those across a fold (a lens joins its rim's shade before the rim).
    const rows = new Map<number, Map<number, number>>();
    for (const [a, row] of borders()) rows.set(a, new Map([...row].map(([b, cell]) => [b, Math.max(0.1, cell.count - cell.folds * 0.9)])));
    const alive = new Set(roots());
    // A loose bit joined to nothing stays a blob of its own (it still counts).
    let loose = 0;
    while (alive.size + loose > max && alive.size > 0) {
      // The smallest goes first — counting a blob unlike all its neighbours (a glint, a button's dot) as bigger than it is.
      let smallest = -1;
      let least = Infinity;
      for (const r of alive) {
        let size = areaOfPatch[r];
        if (size >= least) continue;
        {
          let alike = false;
          for (const b of rows.get(r)?.keys() ?? []) if ((alike = sameMaterial(r, b))) break;
          if (!alike) size *= 4;
        }
        if (size < least) {
          least = size;
          smallest = r;
        }
      }
      const row = rows.get(smallest);
      if (!row || row.size === 0) {
        alive.delete(smallest);
        loose++;
        continue;
      }
      let best = -1;
      let bestScore = -1;
      // Into the same material first (a thin gold trim not into the white plate beside it), then its family.
      const fam = familyOf(smallest);
      for (const [b, count] of row) {
        const score = count * (sameMaterial(smallest, b) ? 8 : 1) * (familyOf(b) === fam ? 2 : 1);
        if (score > bestScore) {
          best = b;
          bestScore = score;
        }
      }
      union(smallest, best);
      const keep = find(smallest);
      const gone = keep === smallest ? best : smallest;
      const keepRow = rows.get(keep) ?? new Map<number, number>();
      for (const [c, count] of rows.get(gone) ?? []) {
        if (c === keep) continue;
        keepRow.set(c, (keepRow.get(c) ?? 0) + count);
        const other = rows.get(c);
        if (other) {
          other.delete(gone);
          other.set(keep, (other.get(keep) ?? 0) + count);
        }
      }
      keepRow.delete(gone);
      rows.set(keep, keepRow);
      rows.delete(gone);
      alive.delete(gone);
    }
  }

  // Number them, biggest first.
  const sums = new Map<number, { w: number; c: [number, number, number]; members: number[] }>();
  for (let i = 0; i < n; i++) {
    const r = find(patch[i]);
    let row = sums.get(r);
    if (!row) sums.set(r, (row = { w: 0, c: [0, 0, 0], members: [] }));
    row.w += weight[i];
    row.c[0] += rgb[i][0] * weight[i];
    row.c[1] += rgb[i][1] * weight[i];
    row.c[2] += rgb[i][2] * weight[i];
    row.members.push(i);
  }
  const ordered = [...sums].sort((a, b) => b[1].w - a[1].w);
  const blobOf = new Int32Array(n);
  const blobs: Blob[] = ordered.map(([root, row], k) => {
    for (const i of row.members) blobOf[i] = k;
    const w = row.w || 1;
    return {
      id: k + 1,
      members: Int32Array.from(row.members),
      areaPct: (row.w / total) * 100,
      mean: [Math.round(row.c[0] / w), Math.round(row.c[1] / w), Math.round(row.c[2] / w)],
      family: familyOf(root),
      familyName: familyName.get(familyOf(root)) ?? "?",
    };
  });
  return { faces, blobs, blobOf, coarse: coarse.colours };
}
