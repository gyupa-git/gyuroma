import type { MeshModel, RGB } from "@core/types";
import type { FaceAdjacency } from "@core/meshAdjacency";
import { facesInSphere, type FaceGeometry } from "./mesh";

/**
 * A 2D "colour map" of a face-coloured mesh: every face gets a place in a
 * square atlas (Smart-UV style: faces are grouped by dominant normal axis into
 * connected charts, each chart is projected onto its axis plane and the charts
 * are shelf-packed). Pixels map back to faces through `idMap`, so the map can
 * be clicked and painted like the 3D view.
 */
export interface FaceAtlas {
  size: number;
  /** Face index per pixel (row-major), -1 where empty. */
  idMap: Int32Array;
  /** CSR: pixels covered by each face. */
  pixelOffsets: Int32Array;
  pixelIndices: Int32Array;
  /** Atlas-pixel coordinates of the three corners of each face (6 floats per face). */
  faceUv: Float32Array;
  /** Atlas pixels per model unit. */
  scale: number;
  chartCount: number;
  /** Chart id of each face. */
  chartOf: Int32Array;
  /** Unit direction each chart faces (its area-weighted normal, 3 floats per chart): the map looks at a chart along it. */
  chartDir: Float32Array;
  /** Fraction of atlas pixels covered by faces, and the layout's extent in pixels (diagnostics). */
  filledRatio: number;
  extent: [number, number];
  /** Scratch marks for circle queries. */
  marks: Uint8Array;
  /** A patch laid flat on its own (buildPatchAtlas): the map is the surface itself, nothing off it is painted from it. */
  unfolded?: boolean;
  /** Faces round the pick left off the map because they came out over it or over nearer ones (layOutCharts). */
  dropped?: number;
  /** The model's face neighbours, for a patch laid flat: the brush keeps to the surface joined to its middle. */
  adjacency?: FaceAdjacency;
  /** Faces on the map too small to own a pixel, by the grid cell of their centre (facesUnderFlatBrush, built once). */
  pixelless?: { cell: number; cols: number; start: Int32Array; faces: Int32Array };
}

/** Per-chart projection basis: charts are projected onto the plane facing their average normal, kept upright. */
function chartBasis(d: [number, number, number]): { right: [number, number, number]; up: [number, number, number] } {
  let up0: [number, number, number] = Math.abs(d[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  // right = up0 × d, up = d × right
  let rx = up0[1] * d[2] - up0[2] * d[1];
  let ry = up0[2] * d[0] - up0[0] * d[2];
  let rz = up0[0] * d[1] - up0[1] * d[0];
  let len = Math.hypot(rx, ry, rz);
  if (len < 1e-9) {
    up0 = [1, 0, 0];
    rx = up0[1] * d[2] - up0[2] * d[1];
    ry = up0[2] * d[0] - up0[0] * d[2];
    rz = up0[0] * d[1] - up0[1] * d[0];
    len = Math.hypot(rx, ry, rz) || 1;
  }
  rx /= len;
  ry /= len;
  rz /= len;
  const ux = d[1] * rz - d[2] * ry;
  const uy = d[2] * rx - d[0] * rz;
  const uz = d[0] * ry - d[1] * rx;
  const ulen = Math.hypot(ux, uy, uz) || 1;
  return { right: [rx, ry, rz], up: [ux / ulen, uy / ulen, uz / ulen] };
}

/** Maximum angle between a face normal and its chart's seed normal. */
const CHART_CONE_DEGREES = 70;
/** Charts with fewer faces are absorbed by their best-connected neighbour chart. */
const MIN_CHART_FACES = 24;

export function buildFaceAtlas(
  model: MeshModel,
  adjacency: FaceAdjacency,
  geometry: FaceGeometry,
  areas: ArrayLike<number>,
  size: number,
): FaceAtlas {
  const n = model.triangles.length;
  const { normals, centroids } = geometry;
  const { offsets, neighbours } = adjacency;

  // 1. Smoothed normals (face + neighbours) so noisy faces do not break charts apart.
  const smooth = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = normals[i * 3] * 2;
    let y = normals[i * 3 + 1] * 2;
    let z = normals[i * 3 + 2] * 2;
    for (let k = offsets[i]; k < offsets[i + 1]; k++) {
      const g = neighbours[k];
      x += normals[g * 3];
      y += normals[g * 3 + 1];
      z += normals[g * 3 + 2];
    }
    const len = Math.hypot(x, y, z);
    if (len > 0) {
      x /= len;
      y /= len;
      z /= len;
    } else {
      x = normals[i * 3];
      y = normals[i * 3 + 1];
      z = normals[i * 3 + 2];
    }
    smooth[i * 3] = x;
    smooth[i * 3 + 1] = y;
    smooth[i * 3 + 2] = z;
  }

  // 2. Region growing: seeds in order of face area, faces join while their normal stays within the cone.
  const cosLimit = Math.cos((CHART_CONE_DEGREES * Math.PI) / 180);
  const seeds = Array.from({ length: n }, (_v, i) => i).sort((a, b) => areas[b] - areas[a]);
  const chartOf = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let chartCount = 0;
  for (const seed of seeds) {
    if (chartOf[seed] !== -1) continue;
    const chart = chartCount++;
    const dx = smooth[seed * 3];
    const dy = smooth[seed * 3 + 1];
    const dz = smooth[seed * 3 + 2];
    let top = 0;
    stack[top++] = seed;
    chartOf[seed] = chart;
    while (top > 0) {
      const f = stack[--top];
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        if (chartOf[g] !== -1) continue;
        if (smooth[g * 3] * dx + smooth[g * 3 + 1] * dy + smooth[g * 3 + 2] * dz < cosLimit) continue;
        chartOf[g] = chart;
        stack[top++] = g;
      }
    }
  }

  // 3. Absorb tiny charts into the neighbouring chart they touch most (prefer a large one).
  for (let pass = 0; pass < 3; pass++) {
    const sizes = new Int32Array(chartCount);
    for (let i = 0; i < n; i++) sizes[chartOf[i]]++;
    const contacts: Array<Map<number, number> | null> = new Array(chartCount).fill(null);
    for (let i = 0; i < n; i++) {
      const c = chartOf[i];
      if (sizes[c] >= MIN_CHART_FACES) continue;
      let map = contacts[c];
      if (!map) {
        map = new Map();
        contacts[c] = map;
      }
      for (let k = offsets[i]; k < offsets[i + 1]; k++) {
        const other = chartOf[neighbours[k]];
        if (other !== c) map.set(other, (map.get(other) ?? 0) + 1);
      }
    }
    const remap = new Int32Array(chartCount);
    let changed = 0;
    for (let c = 0; c < chartCount; c++) {
      remap[c] = c;
      const map = contacts[c];
      if (!map) continue;
      let best = -1;
      let bestScore = -1;
      for (const [other, count] of map) {
        const score = count + (sizes[other] >= MIN_CHART_FACES ? 1e9 : sizes[other]);
        if (score > bestScore) {
          best = other;
          bestScore = score;
        }
      }
      if (best >= 0) {
        remap[c] = best;
        changed++;
      }
    }
    if (changed === 0) break;
    // Resolve chains (a small chart absorbed into another small chart that was itself absorbed).
    for (let c = 0; c < chartCount; c++) {
      let target = remap[c];
      for (let hop = 0; hop < 8 && remap[target] !== target; hop++) target = remap[target];
      remap[c] = target;
    }
    for (let i = 0; i < n; i++) chartOf[i] = remap[chartOf[i]];
  }
  // Compact chart ids.
  {
    const used = new Int32Array(chartCount).fill(-1);
    let next = 0;
    for (let i = 0; i < n; i++) {
      const c = chartOf[i];
      if (used[c] === -1) used[c] = next++;
      chartOf[i] = used[c];
    }
    chartCount = next;
  }

  // 4. Chart direction (area-weighted normal), basis and bounds; chart centre z for the layout order.
  const dirX = new Float64Array(chartCount);
  const dirY = new Float64Array(chartCount);
  const dirZ = new Float64Array(chartCount);
  const centreZ = new Float64Array(chartCount);
  const weight = new Float64Array(chartCount);
  for (let i = 0; i < n; i++) {
    const c = chartOf[i];
    const a = Math.max(1e-12, areas[i]);
    dirX[c] += normals[i * 3] * a;
    dirY[c] += normals[i * 3 + 1] * a;
    dirZ[c] += normals[i * 3 + 2] * a;
    centreZ[c] += centroids[i * 3 + 2] * a;
    weight[c] += a;
  }
  const bases: Array<{ right: [number, number, number]; up: [number, number, number] }> = new Array(chartCount);
  const chartDir = new Float32Array(chartCount * 3);
  for (let c = 0; c < chartCount; c++) {
    const len = Math.hypot(dirX[c], dirY[c], dirZ[c]);
    const d: [number, number, number] = len > 0 ? [dirX[c] / len, dirY[c] / len, dirZ[c] / len] : [0, 0, 1];
    bases[c] = chartBasis(d);
    chartDir.set(d, c * 3);
    centreZ[c] /= weight[c] || 1;
  }
  const uv = new Float32Array(n * 6);
  for (let f = 0; f < n; f++) {
    const c = chartOf[f];
    const { right, up } = bases[c];
    const tri = model.triangles[f];
    for (let corner = 0; corner < 3; corner++) {
      const v = model.vertices[tri[corner]];
      uv[f * 6 + corner * 2] = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
      uv[f * 6 + corner * 2 + 1] = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
    }
  }
  return layOutCharts(n, uv, chartOf, chartCount, chartDir, centreZ, size, null);
}

/**
 * A patch unfolded on its own (unfold.ts) as a colour map: its pieces are the charts, the rest of the model is
 * off the map (11-05, the owner: "이 한 조각을 눌렀을 때 그 한 조각이 그대로 펼쳐진 느낌으로").  The first `core`
 * of `faces` are the pick; the rest, when there are more, are the faces round it nearest first (surround.ts).
 */
export function buildPatchAtlas(model: MeshModel, geometry: FaceGeometry, adjacency: FaceAdjacency, faces: Int32Array, unfolded: { uv: Float32Array; piece: Int32Array; pieces: number }, size: number, core = faces.length): FaceAtlas {
  const n = model.triangles.length;
  // The layout's islands (unfold.ts islandsOf): faces round the pick left off it are −1.
  const { piece: island, pieces: islands } = unfolded;
  const chartOf = new Int32Array(n).fill(-1);
  const uv = new Float32Array(n * 6);
  const chartDir = new Float32Array(islands * 3);
  const centreZ = new Float64Array(islands);
  const weight = new Float64Array(islands);
  const shown: number[] = [];
  let pickShown = 0;
  for (let i = 0; i < faces.length; i++) {
    const c = island[i];
    if (c < 0) continue;
    const f = faces[i];
    shown.push(f);
    if (i < core) pickShown++;
    chartOf[f] = c;
    uv.set(unfolded.uv.subarray(i * 6, i * 6 + 6), f * 6);
    for (let d = 0; d < 3; d++) chartDir[c * 3 + d] += geometry.normals[f * 3 + d];
    centreZ[c] += geometry.centroids[f * 3 + 2];
    weight[c]++;
  }
  for (let c = 0; c < islands; c++) {
    const len = Math.hypot(chartDir[c * 3], chartDir[c * 3 + 1], chartDir[c * 3 + 2]) || 1;
    for (let d = 0; d < 3; d++) chartDir[c * 3 + d] /= len;
    centreZ[c] /= weight[c] || 1;
  }
  const atlas = layOutCharts(n, uv, chartOf, islands, chartDir, centreZ, size, Int32Array.from(shown), true, pickShown);
  atlas.unfolded = true;
  atlas.adjacency = adjacency;
  atlas.dropped = (atlas.dropped ?? 0) + faces.length - shown.length;
  return atlas;
}

/**
 * Charts with their UV (model units, 6 numbers a face) laid side by side in the square and drawn as face ids:
 * shared by the whole-model map and a patch unfolded on its own (`members` = the faces shown; the rest are not on
 * the map, `chartOf` −1).
 */
export function layOutCharts(
  n: number,
  uv: Float32Array,
  chartOf: Int32Array,
  chartCount: number,
  chartDir: Float32Array,
  centreZ: Float64Array,
  size: number,
  members: Int32Array | null,
  /** Biggest first, in one band (a patch's pieces: the one clicked is the big one, its crumbs go to the side). */
  bySize = false,
  /** How many of `members` are the pick, the rest the faces round it nearest first (step 6). */
  core = members ? members.length : n,
): FaceAtlas {
  const count = members ? members.length : n;
  const faceAt = (i: number) => (members ? members[i] : i);
  const minU = new Float64Array(chartCount).fill(Infinity);
  const minV = new Float64Array(chartCount).fill(Infinity);
  const maxU = new Float64Array(chartCount).fill(-Infinity);
  const maxV = new Float64Array(chartCount).fill(-Infinity);
  for (let i = 0; i < count; i++) {
    const f = faceAt(i);
    const c = chartOf[f];
    for (let corner = 0; corner < 3; corner++) {
      const u = uv[f * 6 + corner * 2];
      const w = uv[f * 6 + corner * 2 + 1];
      if (u < minU[c]) minU[c] = u;
      if (u > maxU[c]) maxU[c] = u;
      if (w < minV[c]) minV[c] = w;
      if (w > maxV[c]) maxV[c] = w;
    }
  }
  // 5. Scale + shelf packing. Charts are laid out top-to-bottom following the model (bands by
  //    chart height in the model); inside a band, taller charts first. Retry smaller until it fits.
  // A patch's islands with room between them, so pieces apart on the model show apart (11-05); the whole-model map
  // packs tight.
  const pad = bySize ? Math.max(2, Math.round(size / 160)) : 1;
  let area = 0;
  for (let c = 0; c < chartCount; c++) area += Math.max(1e-9, (maxU[c] - minU[c]) * (maxV[c] - minV[c]));
  let scale = Math.sqrt((0.55 * size * size) / Math.max(area, 1e-9));
  const chartArea = (c: number) => (maxU[c] - minU[c]) * (maxV[c] - minV[c]);
  const byZ = Array.from({ length: chartCount }, (_v, c) => c).sort(bySize ? (a, b) => chartArea(b) - chartArea(a) : (a, b) => centreZ[b] - centreZ[a]);
  const bandCount = bySize ? 1 : Math.max(1, Math.min(12, Math.round(Math.sqrt(chartCount / 8))));
  const bandSize = Math.ceil(chartCount / bandCount);
  const chartX = new Float64Array(chartCount);
  const chartY = new Float64Array(chartCount);
  const widths = new Float64Array(chartCount);
  const heights = new Float64Array(chartCount);
  const layoutAt = (s: number): boolean => {
    for (let c = 0; c < chartCount; c++) {
      widths[c] = Math.ceil((maxU[c] - minU[c]) * s) + 2 * pad + 1;
      heights[c] = Math.ceil((maxV[c] - minV[c]) * s) + 2 * pad + 1;
    }
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (let b = 0; b < bandCount; b++) {
      const band = byZ.slice(b * bandSize, (b + 1) * bandSize).sort((p, q) => heights[q] - heights[p] || widths[q] - widths[p]);
      if (band.length === 0) continue;
      // A band always starts a new shelf so the vertical order follows the model.
      if (x > 0) {
        y += shelf;
        x = 0;
        shelf = 0;
      }
      for (const c of band) {
        const w = widths[c];
        const h = heights[c];
        if (w > size) return false;
        if (x + w > size) {
          y += shelf;
          x = 0;
          shelf = 0;
        }
        if (y + h > size) return false;
        chartX[c] = x;
        chartY[c] = y;
        x += w;
        if (h > shelf) shelf = h;
      }
    }
    return true;
  };
  let fits = false;
  for (let attempt = 0; attempt < 20 && !fits; attempt++) {
    fits = layoutAt(scale);
    if (!fits) scale *= 0.85;
  }
  if (fits) {
    // Grow back up while it still fits so the square is actually used.
    let good = scale;
    let step = 1.12;
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = good * step;
      if (layoutAt(candidate)) good = candidate;
      else step = 1 + (step - 1) / 2;
      if (step < 1.01) break;
    }
    scale = good;
    layoutAt(scale);
  }
  if (!fits) throw new Error("Colour map layout did not fit; the mesh is too fragmented for this atlas size.");

  // 5. Face corner pixel coordinates (v axis flipped so "up" is up).
  const faceUv = new Float32Array(n * 6);
  for (let i = 0; i < count; i++) {
    const f = faceAt(i);
    const c = chartOf[f];
    for (let corner = 0; corner < 3; corner++) {
      faceUv[f * 6 + corner * 2] = chartX[c] + pad + 0.5 + (uv[f * 6 + corner * 2] - minU[c]) * scale;
      faceUv[f * 6 + corner * 2 + 1] = chartY[c] + pad + 0.5 + (maxV[c] - uv[f * 6 + corner * 2 + 1]) * scale;
    }
  }

  // 6. Rasterise face ids.  With faces round the pick (members past `core`, nearest first) the map stays one flat
  //    sheet: the pick is drawn whole, then each neighbour only where nothing is yet, and a neighbour more than half
  //    under what is drawn already is left off the map (chartOf −1).  Flattened with the pick, the band round a hole
  //    folds into it and over the pick; drawn under it, those faces were painted unseen (11-05, the owner: "색지도가
  //    입체적으로 겹쳐서 배치되어 있으면 안 되고 평면으로 펼쳐져 있어야 되는 거 아니냐").
  const layered = members !== null && core < count;
  const shownChart = layered ? chartOf.slice() : chartOf;
  let dropped = 0;
  const idMap = new Int32Array(size * size).fill(-1);
  for (let i = 0; i < count; i++) {
    const f = faceAt(i);
    const x0 = faceUv[f * 6], y0 = faceUv[f * 6 + 1];
    const x1 = faceUv[f * 6 + 2], y1 = faceUv[f * 6 + 3];
    const x2 = faceUv[f * 6 + 4], y2 = faceUv[f * 6 + 5];
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    const areaSign = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const eps = Math.abs(areaSign) * 1e-4;
    const sign = areaSign > 0 ? 1 : -1;
    const around = layered && i >= core;
    if (around) {
      // How much of it lies under what is drawn, by the pixel centres strictly inside it (faces side by side share
      // none); one too small to hold a centre, by whether its own centre lies inside the face drawn there.
      let inside = 0;
      let under = 0;
      if (areaSign !== 0) {
        for (let py = minY; py <= maxY; py++) {
          const cy = py + 0.5;
          for (let px = minX; px <= maxX; px++) {
            const cx = px + 0.5;
            if (((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * sign <= eps) continue;
            if (((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * sign <= eps) continue;
            if (((x0 - cx) * (y1 - cy) - (x1 - cx) * (y0 - cy)) * sign <= eps) continue;
            inside++;
            if (idMap[py * size + px] >= 0) under++;
          }
        }
      }
      let covered: boolean;
      if (inside > 0) covered = under * 2 > inside;
      else {
        const cx = (x0 + x1 + x2) / 3;
        const cy = (y0 + y1 + y2) / 3;
        const g = idMap[Math.min(size - 1, Math.max(0, Math.floor(cy))) * size + Math.min(size - 1, Math.max(0, Math.floor(cx)))];
        covered = g >= 0 && insideFaceUv(faceUv, g, cx, cy);
      }
      if (covered) {
        shownChart[f] = -1;
        dropped++;
        continue;
      }
    }
    let written = false;
    if (areaSign !== 0) {
      for (let py = minY; py <= maxY; py++) {
        const cy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const cx = px + 0.5;
          const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * sign;
          if (w0 < -eps) continue;
          const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * sign;
          if (w1 < -eps) continue;
          const w2 = ((x0 - cx) * (y1 - cy) - (x1 - cx) * (y0 - cy)) * sign;
          if (w2 < -eps) continue;
          const at = py * size + px;
          if (around && idMap[at] >= 0) continue;
          idMap[at] = f;
          written = true;
        }
      }
    }
    if (!written) {
      // Sub-pixel face: claim the pixel under its centroid so it stays reachable.
      const cx = Math.min(size - 1, Math.max(0, Math.floor((x0 + x1 + x2) / 3)));
      const cy = Math.min(size - 1, Math.max(0, Math.floor((y0 + y1 + y2) / 3)));
      if (!around || idMap[cy * size + cx] < 0) idMap[cy * size + cx] = f;
    }
  }

  // 7. CSR of pixels per face.
  const counts = new Int32Array(n + 1);
  for (let i = 0; i < idMap.length; i++) if (idMap[i] >= 0) counts[idMap[i] + 1]++;
  for (let f = 0; f < n; f++) counts[f + 1] += counts[f];
  const pixelOffsets = counts;
  const fill = new Int32Array(n);
  const pixelIndices = new Int32Array(pixelOffsets[n]);
  for (let i = 0; i < idMap.length; i++) {
    const f = idMap[i];
    if (f < 0) continue;
    pixelIndices[pixelOffsets[f] + fill[f]++] = i;
  }

  let extentX = 0;
  let extentY = 0;
  for (let c = 0; c < chartCount; c++) {
    if (chartX[c] + widths[c] > extentX) extentX = chartX[c] + widths[c];
    if (chartY[c] + heights[c] > extentY) extentY = chartY[c] + heights[c];
  }
  return {
    size,
    idMap,
    pixelOffsets,
    pixelIndices,
    faceUv,
    scale,
    chartCount,
    chartOf: shownChart,
    chartDir,
    filledRatio: pixelOffsets[n] / (size * size),
    extent: [extentX, extentY],
    marks: new Uint8Array(n),
    dropped,
  };
}

/** Whether an atlas point lies strictly inside a face's triangle on the map. */
function insideFaceUv(faceUv: Float32Array, face: number, x: number, y: number): boolean {
  const o = face * 6;
  const x0 = faceUv[o], y0 = faceUv[o + 1], x1 = faceUv[o + 2], y1 = faceUv[o + 3], x2 = faceUv[o + 4], y2 = faceUv[o + 5];
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area === 0) return false;
  const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
  const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
  return w0 > 1e-4 && w1 > 1e-4 && 1 - w0 - w1 > 1e-4;
}

/** Writes face colours into an RGBA buffer (all faces, or only `faces`). Returns the dirty rectangle. */
export function paintAtlasImage(
  atlas: FaceAtlas,
  colourOf: (face: number) => RGB,
  data: Uint8ClampedArray,
  faces?: ArrayLike<number>,
): { x: number; y: number; w: number; h: number } {
  const { idMap, size, pixelOffsets, pixelIndices } = atlas;
  if (!faces) {
    let last = -2;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < idMap.length; i++) {
      const f = idMap[i];
      if (f < 0) {
        data[i * 4 + 3] = 0;
        continue;
      }
      if (f !== last) {
        const rgb = colourOf(f);
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        last = f;
      }
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    return { x: 0, y: 0, w: size, h: size };
  }
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let k = 0; k < faces.length; k++) {
    const f = faces[k];
    const rgb = colourOf(f);
    for (let p = pixelOffsets[f]; p < pixelOffsets[f + 1]; p++) {
      const i = pixelIndices[p];
      data[i * 4] = rgb[0];
      data[i * 4 + 1] = rgb[1];
      data[i * 4 + 2] = rgb[2];
      data[i * 4 + 3] = 255;
      const x = i % size;
      const y = (i - x) / size;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export interface AtlasMasks {
  hover: Uint8Array | null;
  selected: Uint8Array | null;
  picked: Uint8Array | null;
}

/** Writes the selection overlay (white picked and selected, iris hover) into an RGBA buffer. */
export function paintAtlasOverlay(atlas: FaceAtlas, masks: AtlasMasks, data: Uint8ClampedArray): boolean {
  const { idMap } = atlas;
  const { hover, selected, picked } = masks;
  if (!hover && !selected && !picked) {
    data.fill(0);
    return false;
  }
  let any = false;
  for (let i = 0; i < idMap.length; i++) {
    const f = idMap[i];
    if (f < 0) {
      data[i * 4 + 3] = 0;
      continue;
    }
    if (picked && picked[f]) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 120;
      any = true;
    } else if (selected && selected[f]) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 90;
      any = true;
    } else if (hover && hover[f]) {
      data[i * 4] = 154;
      data[i * 4 + 1] = 160;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 130;
      any = true;
    } else {
      data[i * 4 + 3] = 0;
    }
  }
  return any;
}

/**
 * Spreads each classed pixel `w` pixels along one axis (rows when `alongX`,
 * else columns); a pixel takes the class of the nearest classed pixel in
 * reach.  Two passes, one per direction, so it is linear in the pixel count.
 */
function spreadClass(src: Uint8Array, dst: Uint8Array, size: number, w: number, alongX: boolean): void {
  for (let line = 0; line < size; line++) {
    let last = 0;
    let lastAt = -1e9;
    for (let i = 0; i < size; i++) {
      const idx = alongX ? line * size + i : i * size + line;
      const c = src[idx];
      if (c) {
        last = c;
        lastAt = i;
      }
      dst[idx] = c ? c : i - lastAt <= w ? last : 0;
    }
    last = 0;
    lastAt = 1e9;
    for (let i = size - 1; i >= 0; i--) {
      const idx = alongX ? line * size + i : i * size + line;
      const c = src[idx];
      if (c) {
        last = c;
        lastAt = i;
      } else if (dst[idx] === 0 && lastAt - i <= w) dst[idx] = last;
    }
  }
}

/** Selection on a colour is a white line (with a dark rim so it reads on white too); hover is iris. */
const OUTLINE_RGB: Record<number, [number, number, number]> = {
  // picked and selected: the app's iris; hover: the stronger blue the 3D view hovers in
  3: [154, 160, 255],
  2: [154, 160, 255],
  1: [82, 90, 255],
};

/**
 * Outline of the highlighted regions, `width` atlas pixels wide and drawn
 * just outside them, so the shape is marked while the colour inside stays
 * visible.  Where regions touch, picked wins over selected over hover.
 */
export function paintAtlasOutline(atlas: FaceAtlas, masks: AtlasMasks, data: Uint8ClampedArray, width: number): boolean {
  const { idMap, size } = atlas;
  const { hover, selected, picked } = masks;
  data.fill(0);
  if (!hover && !selected && !picked) return false;
  const cls = new Uint8Array(idMap.length);
  let any = false;
  for (let i = 0; i < idMap.length; i++) {
    const f = idMap[i];
    if (f < 0) continue;
    const c = picked && picked[f] ? 3 : selected && selected[f] ? 2 : hover && hover[f] ? 1 : 0;
    if (c) {
      cls[i] = c;
      any = true;
    }
  }
  if (!any) return false;
  const w = Math.max(1, Math.min(32, Math.round(width)));
  const rows = new Uint8Array(idMap.length);
  const grown = new Uint8Array(idMap.length);
  spreadClass(cls, rows, size, w, true);
  spreadClass(rows, grown, size, w, false);
  for (let i = 0; i < idMap.length; i++) {
    if (cls[i]) continue;
    const c = grown[i];
    if (!c) continue;
    const rgb = OUTLINE_RGB[c];
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return true;
}

/** What the highlight overlay and outline were last painted for (repaintAtlasMasks keeps it). */
export interface AtlasMaskPaint {
  atlas: FaceAtlas;
  /** Outline width the outline was drawn at. */
  width: number;
  /** Each face's class: 3 picked, 2 selected, 1 hover, 0 none (picked wins over selected over hover). */
  faceClass: Uint8Array;
  /** Each pixel's class (its face's), the outline's input. */
  cls: Uint8Array;
  /** Pixels with a class: something is drawn while there are any. */
  classed: number;
  /** The masks it was painted for: the very same arrays again mean nothing changed. */
  masks: AtlasMasks;
}

/** A pixel rectangle (inclusive x0..x1, y0..y1). */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const OVERLAY_RGBA: Record<number, [number, number, number, number]> = {
  3: [255, 255, 255, 120],
  2: [255, 255, 255, 90],
  1: [154, 160, 255, 130],
};

/** Each face's class under the masks (plain scans: this runs over millions of faces after every stroke). */
function faceClassesOf(n: number, masks: AtlasMasks): Uint8Array {
  const out = new Uint8Array(n);
  const { hover, selected, picked } = masks;
  if (hover) for (let f = 0; f < n; f++) if (hover[f]) out[f] = 1;
  if (selected) for (let f = 0; f < n; f++) if (selected[f]) out[f] = 2;
  if (picked) for (let f = 0; f < n; f++) if (picked[f]) out[f] = 3;
  return out;
}

/**
 * The highlight overlay and its outline painted for new masks — only around the faces whose class changed, when it
 * can: a stroke inside a picked patch changes a few thousand faces, and painting all 9.4M pixels of a 3072 map and
 * sending both 37.7MB images took ~150 ms and more on 4.6M faces (11-09). The result is byte for byte what
 * paintAtlasOverlay + paintAtlasOutline give (atlas.test: random masks against them).
 *
 * `rect`: the pixels to send again — one box or several (the dirty tiles' runs), "full" = all of them, null = nothing.
 */
export function repaintAtlasMasks(
  last: AtlasMaskPaint | null,
  atlas: FaceAtlas,
  masks: AtlasMasks,
  overlay: Uint8ClampedArray,
  outline: Uint8ClampedArray,
  width: number,
): { paint: AtlasMaskPaint; rect: PixelRect | PixelRect[] | "full" | null; any: boolean } {
  const { idMap, size, pixelOffsets, pixelIndices } = atlas;
  const n = pixelOffsets.length - 1;
  const w = Math.max(1, Math.min(32, Math.round(width)));
  // The same mask arrays as last time: nothing to paint.
  if (last && last.atlas === atlas && last.width === w && last.masks.hover === masks.hover && last.masks.selected === masks.selected && last.masks.picked === masks.picked)
    return { paint: last, rect: null, any: last.classed > 0 };
  const faceClass = faceClassesOf(n, masks);

  // All of it, in one pass over the pixels for the classes and the overlay, then the outline from those classes —
  // what paintAtlasOverlay and paintAtlasOutline write (each made its own pass over the pixels).
  const full = (): { paint: AtlasMaskPaint; rect: "full"; any: boolean } => {
    const cls = new Uint8Array(idMap.length);
    let classed = 0;
    for (let i = 0; i < idMap.length; i++) {
      const f = idMap[i];
      const c = f >= 0 ? faceClass[f] : 0;
      const rgba = OVERLAY_RGBA[c];
      if (rgba) {
        cls[i] = c;
        classed++;
        overlay[i * 4] = rgba[0];
        overlay[i * 4 + 1] = rgba[1];
        overlay[i * 4 + 2] = rgba[2];
        overlay[i * 4 + 3] = rgba[3];
      } else overlay[i * 4 + 3] = 0;
    }
    outline.fill(0);
    if (classed > 0) {
      const rows = new Uint8Array(idMap.length);
      const grown = new Uint8Array(idMap.length);
      spreadClass(cls, rows, size, w, true);
      spreadClass(rows, grown, size, w, false);
      for (let i = 0; i < idMap.length; i++) {
        if (cls[i]) continue;
        const g = grown[i];
        if (!g) continue;
        const rgb = OUTLINE_RGB[g];
        outline[i * 4] = rgb[0];
        outline[i * 4 + 1] = rgb[1];
        outline[i * 4 + 2] = rgb[2];
        outline[i * 4 + 3] = 255;
      }
    }
    return { paint: { atlas, width: w, faceClass, cls, classed, masks }, rect: "full", any: classed > 0 };
  };
  if (!last || last.atlas !== atlas || last.width !== w || last.faceClass.length !== n) return full();

  // The faces whose class changed, and how many pixels they hold.
  const changed: number[] = [];
  let changedPixels = 0;
  for (let f = 0; f < n; f++) {
    if (faceClass[f] === last.faceClass[f]) continue;
    changed.push(f);
    changedPixels += pixelOffsets[f + 1] - pixelOffsets[f];
  }
  if (changed.length === 0) return { paint: { ...last, faceClass, masks }, rect: null, any: last.classed > 0 };
  // Most of the map anyway (a whole colour hovered): all of it, in one go.
  if (changedPixels > idMap.length / 4) return full();

  const { cls } = last;
  let classed = last.classed;
  // The map in tiles: only the tiles holding a changed pixel are painted again (a pick's pixels lie scattered over
  // the charts — one rectangle round them all was most of the map).
  const tiles = Math.ceil(size / MASK_TILE);
  const dirty = new Uint8Array(tiles * tiles);
  let dirtyCount = 0;
  for (const f of changed) {
    const c = faceClass[f];
    const rgba = OVERLAY_RGBA[c];
    for (let p = pixelOffsets[f]; p < pixelOffsets[f + 1]; p++) {
      const i = pixelIndices[p];
      if (cls[i] && !c) classed--;
      else if (!cls[i] && c) classed++;
      cls[i] = c;
      if (rgba) {
        overlay[i * 4] = rgba[0];
        overlay[i * 4 + 1] = rgba[1];
        overlay[i * 4 + 2] = rgba[2];
        overlay[i * 4 + 3] = rgba[3];
      } else overlay[i * 4 + 3] = 0;
      const x = i % size;
      const t = ((((i - x) / size) / MASK_TILE) | 0) * tiles + ((x / MASK_TILE) | 0);
      if (!dirty[t]) {
        dirty[t] = 1;
        dirtyCount++;
      }
    }
  }
  const paint: AtlasMaskPaint = { atlas, width: w, faceClass, cls, classed, masks };
  // The changed faces held no pixels (off the map): only their class was kept.
  if (dirtyCount === 0) return { paint, rect: null, any: classed > 0 };
  if (classed === 0) {
    // Nothing highlighted any more: as paintAtlasOutline leaves it, all clear.
    outline.fill(0);
    return { paint, rect: "full", any: false };
  }
  // Runs of dirty tiles along each tile row, each painted as a region (its outline needs w pixels round it).
  const regions: PixelRect[] = [];
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      if (!dirty[ty * tiles + tx]) continue;
      let end = tx;
      while (end + 1 < tiles && dirty[ty * tiles + end + 1]) end++;
      const x0 = tx * MASK_TILE;
      const y0 = ty * MASK_TILE;
      const x1 = Math.min(size - 1, (end + 1) * MASK_TILE - 1);
      const y1 = Math.min(size - 1, (ty + 1) * MASK_TILE - 1);
      regions.push(paintOutlineAround(cls, outline, size, w, x0, y0, x1, y1));
      tx = end;
    }
  }
  return { paint, rect: regions.length === 1 ? regions[0] : regions, any: true };
}

/** Tile side for repaintAtlasMasks (pixels). */
const MASK_TILE = 128;

/**
 * The outline for the pixels within w of the box x0..x1 × y0..y1, worked out from the classes the way
 * paintAtlasOutline does for the whole map (a row spread of w, then a column spread of w; a pixel there reads the
 * classes within w along each), written into `outline`. Returns the box painted.
 */
function paintOutlineAround(cls: Uint8Array, outline: Uint8ClampedArray, size: number, w: number, x0: number, y0: number, x1: number, y1: number): PixelRect {
  const ox0 = Math.max(0, x0 - w);
  const ox1 = Math.min(size - 1, x1 + w);
  const oy0 = Math.max(0, y0 - w);
  const oy1 = Math.min(size - 1, y1 + w);
  const ry0 = Math.max(0, oy0 - w);
  const ry1 = Math.min(size - 1, oy1 + w);
  const cx0 = Math.max(0, ox0 - w);
  const cx1 = Math.min(size - 1, ox1 + w);
  const ow = ox1 - ox0 + 1;
  // Row spread over [cx0, cx1] for the rows ry0..ry1, kept for x in [ox0, ox1] — as spreadClass does a whole row.
  const rows = new Uint8Array(ow * (ry1 - ry0 + 1));
  for (let y = ry0; y <= ry1; y++) {
    const line = y * size;
    const out = (y - ry0) * ow;
    let last = 0;
    let lastAt = -1e9;
    for (let x = cx0; x <= cx1; x++) {
      const c = cls[line + x];
      if (c) {
        last = c;
        lastAt = x;
      }
      if (x >= ox0 && x <= ox1) rows[out + x - ox0] = c ? c : x - lastAt <= w ? last : 0;
    }
    last = 0;
    lastAt = 1e9;
    for (let x = cx1; x >= cx0; x--) {
      const c = cls[line + x];
      if (c) {
        last = c;
        lastAt = x;
      } else if (x >= ox0 && x <= ox1 && rows[out + x - ox0] === 0 && lastAt - x <= w) rows[out + x - ox0] = last;
    }
  }
  // Column spread of those rows for oy0..oy1, and the outline written there.
  const grown = new Uint8Array(oy1 - oy0 + 1);
  for (let x = ox0; x <= ox1; x++) {
    const col = x - ox0;
    let last = 0;
    let lastAt = -1e9;
    for (let y = ry0; y <= ry1; y++) {
      const c = rows[(y - ry0) * ow + col];
      if (c) {
        last = c;
        lastAt = y;
      }
      if (y >= oy0 && y <= oy1) grown[y - oy0] = c ? c : y - lastAt <= w ? last : 0;
    }
    last = 0;
    lastAt = 1e9;
    for (let y = ry1; y >= ry0; y--) {
      const c = rows[(y - ry0) * ow + col];
      if (c) {
        last = c;
        lastAt = y;
      } else if (y >= oy0 && y <= oy1 && grown[y - oy0] === 0 && lastAt - y <= w) grown[y - oy0] = last;
    }
    for (let y = oy0; y <= oy1; y++) {
      const i = y * size + x;
      const g = grown[y - oy0];
      if (cls[i] || !g) {
        outline[i * 4] = 0;
        outline[i * 4 + 1] = 0;
        outline[i * 4 + 2] = 0;
        outline[i * 4 + 3] = 0;
      } else {
        const rgb = OUTLINE_RGB[g];
        outline[i * 4] = rgb[0];
        outline[i * 4 + 1] = rgb[1];
        outline[i * 4 + 2] = rgb[2];
        outline[i * 4 + 3] = 255;
      }
    }
  }
  return { x: ox0, y: oy0, w: ox1 - ox0 + 1, h: oy1 - oy0 + 1 };
}

/** Faces under a circle (atlas pixels). */
export function facesInAtlasCircle(atlas: FaceAtlas, cx: number, cy: number, radius: number): Int32Array {
  const { idMap, size, marks } = atlas;
  const r = Math.max(0.5, radius);
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(size - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(size - 1, Math.ceil(cy + r));
  const r2 = r * r;
  const out: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy > r2) continue;
      const f = idMap[y * size + x];
      if (f < 0 || marks[f]) continue;
      marks[f] = 1;
      out.push(f);
    }
  }
  for (const f of out) marks[f] = 0;
  return Int32Array.from(out);
}

/** Face under an atlas pixel, or -1. */
export function faceAtAtlasPixel(atlas: FaceAtlas, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= atlas.size || py >= atlas.size) return -1;
  return atlas.idMap[py * atlas.size + px];
}

/** Atlas-pixel centroid of a face. */
export function faceAtlasCentre(atlas: FaceAtlas, face: number): [number, number] {
  const o = face * 6;
  return [(atlas.faceUv[o] + atlas.faceUv[o + 2] + atlas.faceUv[o + 4]) / 3, (atlas.faceUv[o + 1] + atlas.faceUv[o + 3] + atlas.faceUv[o + 5]) / 3];
}

/** Atlas-pixel position of a point on a face, from its barycentric weights (in the face's corner order). */
export function faceAtlasPoint(atlas: FaceAtlas, face: number, bary: [number, number, number]): [number, number] {
  const uv = atlas.faceUv;
  const o = face * 6;
  return [uv[o] * bary[0] + uv[o + 2] * bary[1] + uv[o + 4] * bary[2], uv[o + 1] * bary[0] + uv[o + 3] * bary[1] + uv[o + 5] * bary[2]];
}

/**
 * The faces a brush on the map paints at (cx, cy) with `radius` in model units: the faces
 * whose pixels lie under its circle, and the faces of the surface there within the radius
 * in 3D.  A chart is a projection: faces at an angle to it are squeezed thinner than a
 * pixel, and bumps fold faces over one another, so many faces own no pixel and a circle
 * of pixels alone leaves them out — an area painted on the map then shows in 3D as
 * stipple.  The ball takes them in, as the 3D brush does; faces turned away from the
 * chart's direction are left out, as the 3D brush leaves out faces turned from the camera.
 *
 * A patch unfolded on its own is the surface laid flat, each face its own size: there the
 * circle is all that is painted (facesUnderFlatBrush).  The ball would reach what is not on
 * that map — the arm behind a ribbon, through its hole (11-05, the owner: "포탈도 아니고").
 */
export function facesUnderMapBrush(atlas: FaceAtlas, model: MeshModel, geometry: FaceGeometry, cx: number, cy: number, radius: number, island?: number): Int32Array {
  if (atlas.unfolded) return facesUnderFlatBrush(atlas, cx, cy, radius * atlas.scale, island);
  const flat = facesInAtlasCircle(atlas, cx, cy, radius * atlas.scale);
  const centre = faceAtAtlasPixel(atlas, cx, cy);
  if (centre < 0) return flat;
  const c = atlas.chartOf[centre] * 3;
  const viewDir: [number, number, number] = [-atlas.chartDir[c], -atlas.chartDir[c + 1], -atlas.chartDir[c + 2]];
  const ball = facesInSphere(geometry, atlasPointOnFace(atlas, model, centre, cx, cy), radius, viewDir);
  if (ball.length === 0) return flat;
  const { marks } = atlas;
  const out: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    marks[flat[i]] = 1;
    out.push(flat[i]);
  }
  for (let i = 0; i < ball.length; i++) {
    const f = ball[i];
    if (marks[f]) continue;
    marks[f] = 1;
    out.push(f);
  }
  for (const f of out) marks[f] = 0;
  return Int32Array.from(out);
}

/**
 * The brush on a map that is the surface laid flat (`radius` in atlas pixels): the faces whose pixels lie under
 * the circle, and the faces on the map too small to own a pixel whose centre does — so a painted area has no
 * stipple, and nothing off the map is reached.
 */
function facesUnderFlatBrush(atlas: FaceAtlas, cx: number, cy: number, radius: number, lock?: number): Int32Array {
  const { marks, faceUv, chartOf } = atlas;
  // One island only: the stroke's (lock), else the one under the brush.  Islands lie side by side on the map but
  // apart on the model, and a brush at an island's edge reached into the next one.
  const shown = facesInAtlasCircle(atlas, cx, cy, radius);
  const under = faceAtAtlasPixel(atlas, cx, cy);
  const island = lock !== undefined && lock >= 0 ? lock : mapIslandAt(atlas, cx, cy, radius, shown);
  const out: number[] = [];
  for (const f of shown) {
    if (chartOf[f] !== island) continue;
    marks[f] = 1;
    out.push(f);
  }
  const grid = pixellessGrid(atlas);
  const r = Math.max(0.5, radius);
  const r2 = r * r;
  const lastCell = grid.cols - 1;
  const c0 = Math.max(0, Math.floor((cx - r) / grid.cell));
  const c1 = Math.min(lastCell, Math.floor((cx + r) / grid.cell));
  const r0 = Math.max(0, Math.floor((cy - r) / grid.cell));
  const r1 = Math.min(lastCell, Math.floor((cy + r) / grid.cell));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cellIndex = row * grid.cols + col;
      for (let k = grid.start[cellIndex]; k < grid.start[cellIndex + 1]; k++) {
        const f = grid.faces[k];
        if (marks[f] || chartOf[f] !== island) continue;
        const o = f * 6;
        const dx = (faceUv[o] + faceUv[o + 2] + faceUv[o + 4]) / 3 - cx;
        const dy = (faceUv[o + 1] + faceUv[o + 3] + faceUv[o + 5]) / 3 - cy;
        if (dx * dx + dy * dy > r2) continue;
        marks[f] = 1;
        out.push(f);
      }
    }
  }
  const joined = joinedToMiddle(atlas, out, under >= 0 && marks[under] ? under : nearestTo(atlas, out, cx, cy));
  for (const f of out) marks[f] = 0;
  return joined;
}

/**
 * The island a brush at (cx, cy) is on: the one under it, else the one nearest it within its circle (−1 for none).
 * A stroke keeps to the island it starts on (App paintAtMap) — the owner chose "따로 떼어 놓기" for what lies under
 * something, and a stroke across the gap would carry on over there.
 */
export function mapIslandAt(atlas: FaceAtlas, cx: number, cy: number, radius: number, shown?: ArrayLike<number>): number {
  const under = faceAtAtlasPixel(atlas, cx, cy);
  if (under >= 0) return atlas.chartOf[under];
  const near = nearestTo(atlas, Array.from(shown ?? facesInAtlasCircle(atlas, cx, cy, radius)), cx, cy);
  return near >= 0 ? atlas.chartOf[near] : -1;
}

/** The face of `faces` whose centre on the map is nearest (cx, cy), or −1. */
function nearestTo(atlas: FaceAtlas, faces: number[], cx: number, cy: number): number {
  let best = Infinity;
  let at = -1;
  for (const f of faces) {
    const [x, y] = faceAtlasCentre(atlas, f);
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < best) {
      best = d;
      at = f;
    }
  }
  return at;
}

/**
 * The faces under the brush (marked 1 in `atlas.marks`) that the surface joins to the one in its middle without
 * leaving the brush.  An island laid flat can come round and lie against itself where it was not cut (a loop of a
 * bow unrolled, its two ends side by side): there the map shows two places of the model as neighbours, and a brush
 * across that seam painted both (Tkc's ribbon, 11-05: some dabs reached fifteen brush widths away).
 */
function joinedToMiddle(atlas: FaceAtlas, faces: number[], middle: number): Int32Array {
  const { marks, adjacency } = atlas;
  if (!adjacency || middle < 0) return Int32Array.from(faces);
  const { offsets, neighbours } = adjacency;
  const out: number[] = [middle];
  marks[middle] = 2;
  for (let head = 0; head < out.length; head++) {
    const f = out[head];
    for (let k = offsets[f]; k < offsets[f + 1]; k++) {
      const g = neighbours[k];
      if (marks[g] !== 1) continue;
      marks[g] = 2;
      out.push(g);
    }
  }
  return Int32Array.from(out);
}

/**
 * The faces on the map too small to own a pixel, filed by the grid cell their centre falls in (built once per atlas).
 * A face that owns no pixel because another lies over it is not one: a layout folds over itself (a bow's front over
 * its back, a loop over the knot), and the brush took the faces under the fold by their centres — a stroke on the
 * front of Tkc's ribbon painted its back and the arm four and more brush widths away (11-05).
 */
function pixellessGrid(atlas: FaceAtlas): NonNullable<FaceAtlas["pixelless"]> {
  if (atlas.pixelless) return atlas.pixelless;
  const { size, chartOf, pixelOffsets, faceUv, idMap } = atlas;
  // Hidden: its centre lies inside the face drawn there (over it); a face beside it may hold that pixel too.
  const tiny = (f: number): boolean => {
    const o = f * 6;
    const cx = (faceUv[o] + faceUv[o + 2] + faceUv[o + 4]) / 3;
    const cy = (faceUv[o + 1] + faceUv[o + 3] + faceUv[o + 5]) / 3;
    const g = idMap[Math.min(size - 1, Math.max(0, Math.floor(cy))) * size + Math.min(size - 1, Math.max(0, Math.floor(cx)))];
    return !(g >= 0 && g !== f && insideFaceUv(faceUv, g, cx, cy));
  };
  const cell = 16;
  const cols = Math.ceil(size / cell);
  const cellOf = (f: number): number => {
    const o = f * 6;
    const x = Math.min(size - 1, Math.max(0, (faceUv[o] + faceUv[o + 2] + faceUv[o + 4]) / 3));
    const y = Math.min(size - 1, Math.max(0, (faceUv[o + 1] + faceUv[o + 3] + faceUv[o + 5]) / 3));
    return Math.floor(y / cell) * cols + Math.floor(x / cell);
  };
  const start = new Int32Array(cols * cols + 1);
  const list: number[] = [];
  for (let f = 0; f < chartOf.length; f++) {
    if (chartOf[f] < 0 || pixelOffsets[f + 1] !== pixelOffsets[f] || !tiny(f)) continue;
    list.push(f);
    start[cellOf(f) + 1]++;
  }
  for (let c = 0; c < cols * cols; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cols * cols);
  const faces = new Int32Array(list.length);
  for (const f of list) faces[fill[cellOf(f)]++] = f;
  atlas.pixelless = { cell, cols, start, faces };
  return atlas.pixelless;
}

/**
 * The 3D point at an atlas position on a face: the position's barycentric weights in the
 * face's atlas triangle are its weights in 3D (a chart is an affine projection).  A face
 * squeezed too thin to tell gives its centroid.
 */
export function atlasPointOnFace(atlas: FaceAtlas, model: MeshModel, face: number, x: number, y: number): [number, number, number] {
  const uv = atlas.faceUv;
  const o = face * 6;
  const x0 = uv[o], y0 = uv[o + 1], x1 = uv[o + 2], y1 = uv[o + 3], x2 = uv[o + 4], y2 = uv[o + 5];
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  let w0 = 1 / 3, w1 = 1 / 3, w2 = 1 / 3;
  if (Math.abs(area) > 1e-6) {
    w1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / area;
    w2 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / area;
    w0 = 1 - w1 - w2;
    // A pixel centre just outside the triangle: clamped onto it.
    w0 = Math.max(0, w0);
    w1 = Math.max(0, w1);
    w2 = Math.max(0, w2);
    const sum = w0 + w1 + w2 || 1;
    w0 /= sum;
    w1 /= sum;
    w2 /= sum;
  }
  const tri = model.triangles[face];
  const a = model.vertices[tri[0]], b = model.vertices[tri[1]], c = model.vertices[tri[2]];
  return [a[0] * w0 + b[0] * w1 + c[0] * w2, a[1] * w0 + b[1] * w1 + c[1] * w2, a[2] * w0 + b[2] * w1 + c[2] * w2];
}
