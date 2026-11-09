import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import type { MeshModel, RGB } from "@core/types";
import { buildFaceAtlas, buildPatchAtlas, faceAtAtlasPixel, faceAtlasCentre, faceAtlasPoint, facesInAtlasCircle, facesUnderMapBrush, mapIslandAt, type FaceAtlas } from "./atlas";
import { faceGeometry, triangleAreaWeights, type FaceGeometry } from "./mesh";

/** A small deterministic generator (mulberry32), so the meshes are the same on every run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function model(name: string, vertices: [number, number, number][], triangles: [number, number, number][]): MeshModel {
  const colour: RGB = [200, 150, 90];
  return {
    name,
    vertices,
    triangles,
    triangleColors: triangles.map(() => colour),
    stats: { vertexCount: vertices.length, triangleCount: triangles.length, coloredVertexCount: 0, uniqueFaceColors: 1, objectFaceCounts: {} },
  };
}

/**
 * A sculpt-like surface: a sphere of `rows` × `columns` cells with every vertex pushed in or
 * out at random, so faces lean every way, fold over their neighbours in a projection and
 * come out thinner than a pixel on a small atlas — the map's brush then misses them.
 */
function noisySphere(rows: number, columns: number, radius: number, jitter: number): MeshModel {
  const rnd = random(11);
  const vertices: [number, number, number][] = [];
  for (let i = 0; i <= rows; i++) {
    const lat = (-80 + (160 * i) / rows) * (Math.PI / 180);
    for (let j = 0; j < columns; j++) {
      const lon = (2 * Math.PI * j) / columns;
      const r = radius + (rnd() * 2 - 1) * jitter;
      vertices.push([r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)]);
    }
  }
  const at = (i: number, j: number) => i * columns + (j % columns);
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) {
      // Outward winding: (lat up, lon around) with the right hand.
      triangles.push([at(i, j), at(i, j + 1), at(i + 1, j)]);
      triangles.push([at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)]);
    }
  }
  return model("noisy sphere", vertices, triangles);
}

/** A flat square: every face shows whole on the map, so the map's brush has nothing to add. */
function flatPlane(n: number, size: number): MeshModel {
  const vertices: [number, number, number][] = [];
  const cell = size / n;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) vertices.push([i * cell - size / 2, 0, j * cell - size / 2]);
  const triangles: [number, number, number][] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      triangles.push([a, a + n + 1, a + 1]);
      triangles.push([a + 1, a + n + 1, a + n + 2]);
    }
  }
  return model("flat plane", vertices, triangles);
}

/** Two flat squares one over the other, `gap` apart and facing the same way: a ribbon and the arm behind it. */
function stackedPlanes(n: number, size: number, gap: number): MeshModel {
  const top = flatPlane(n, size);
  const under = flatPlane(n, size);
  const offset = top.vertices.length;
  return model(
    "stacked planes",
    [...top.vertices, ...under.vertices.map(([x, y, z]): [number, number, number] => [x, y - gap, z])],
    [...top.triangles, ...under.triangles.map(([a, b, c]): [number, number, number] => [a + offset, b + offset, c + offset])],
  );
}

/**
 * What unfold.ts gives for faces that already lie flat at y = 0: each corner at its own x, z, one piece.
 * `moved` puts a face somewhere else on the sheet (as a band folded over when flattened).
 */
function flatUnfold(mesh: MeshModel, faces: Int32Array, moved?: (face: number, x: number, z: number) => [number, number] | null): { uv: Float32Array; piece: Int32Array; pieces: number } {
  const uv = new Float32Array(faces.length * 6);
  faces.forEach((f, i) => {
    mesh.triangles[f].forEach((v, k) => {
      const [x, , z] = mesh.vertices[v];
      const [u, w] = moved?.(f, x, z) ?? [x, z];
      uv[i * 6 + k * 2] = u;
      uv[i * 6 + k * 2 + 1] = w;
    });
  });
  return { uv, piece: new Int32Array(faces.length), pieces: 1 };
}

const range = (from: number, to: number) => Int32Array.from({ length: to - from }, (_v, i) => from + i);

/** Map pixels whose centres lie strictly inside a face's triangle on the map. */
function pixelsInside(atlas: FaceAtlas, f: number): number[] {
  const uv = atlas.faceUv;
  const [x0, y0, x1, y1, x2, y2] = Array.from(uv.subarray(f * 6, f * 6 + 6));
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const out: number[] = [];
  for (let py = Math.floor(Math.min(y0, y1, y2)); py <= Math.ceil(Math.max(y0, y1, y2)); py++) {
    for (let px = Math.floor(Math.min(x0, x1, x2)); px <= Math.ceil(Math.max(x0, x1, x2)); px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) / area;
      const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 > 0.01 && w1 > 0.01 && w2 > 0.01) out.push(py * atlas.size + px);
    }
  }
  return out;
}

function build(mesh: MeshModel, size: number): { atlas: FaceAtlas; geometry: FaceGeometry; adjacency: ReturnType<typeof buildFaceAdjacency> } {
  const adjacency = buildFaceAdjacency(mesh.triangles, mesh.vertices.length);
  const geometry = faceGeometry(mesh);
  const atlas = buildFaceAtlas(mesh, adjacency, geometry, triangleAreaWeights(mesh), size);
  return { atlas, geometry, adjacency };
}

/** Faces the brush left out although every neighbour was painted: the stipple a painted area shows in 3D. */
function holes(painted: Int32Array, adjacency: ReturnType<typeof buildFaceAdjacency>, faceCount: number): number {
  const inside = new Uint8Array(faceCount);
  for (const f of painted) inside[f] = 1;
  let count = 0;
  for (let f = 0; f < faceCount; f++) {
    if (inside[f]) continue;
    const from = adjacency.offsets[f];
    const to = adjacency.offsets[f + 1];
    if (to - from < 3) continue;
    let surrounded = true;
    for (let k = from; k < to && surrounded; k++) if (!inside[adjacency.neighbours[k]]) surrounded = false;
    if (surrounded) count++;
  }
  return count;
}

/** Faces that own the pixel under their own centroid: places a brush can be put down on the map. */
function brushSpots(atlas: FaceAtlas, faceCount: number, want: number): number[] {
  const spots: number[] = [];
  const step = Math.max(1, Math.floor(faceCount / (want * 7)));
  for (let f = 0; f < faceCount && spots.length < want; f += step) {
    const [cx, cy] = faceAtlasCentre(atlas, f);
    if (faceAtAtlasPixel(atlas, cx, cy) === f) spots.push(f);
  }
  return spots;
}

describe("faceAtlasPoint", () => {
  it("gives the centroid for even weights and a corner for a unit weight", () => {
    const { atlas } = build(flatPlane(4, 8), 64);
    for (const f of [0, 5, 31]) {
      const centre = faceAtlasCentre(atlas, f);
      const even = faceAtlasPoint(atlas, f, [1 / 3, 1 / 3, 1 / 3]);
      expect(even[0]).toBeCloseTo(centre[0], 3);
      expect(even[1]).toBeCloseTo(centre[1], 3);
      const corner = faceAtlasPoint(atlas, f, [0, 1, 0]);
      expect(corner[0]).toBeCloseTo(atlas.faceUv[f * 6 + 2], 5);
      expect(corner[1]).toBeCloseTo(atlas.faceUv[f * 6 + 3], 5);
    }
  });
});

describe("facesUnderMapBrush", () => {
  it("paints a sculpt-like surface without the stipple a circle of pixels leaves", () => {
    const mesh = noisySphere(60, 120, 20, 0.5);
    const { atlas, geometry, adjacency } = build(mesh, 256);
    const radius = 2.5;
    const spots = brushSpots(atlas, mesh.triangles.length, 10);
    expect(spots.length).toBeGreaterThanOrEqual(6);
    let flatHoles = 0;
    let fullHoles = 0;
    let due = 0;
    let flatMissed = 0;
    let fullMissed = 0;
    for (const f of spots) {
      const [cx, cy] = faceAtlasCentre(atlas, f);
      const flat = facesInAtlasCircle(atlas, cx, cy, radius * atlas.scale);
      const full = facesUnderMapBrush(atlas, mesh, geometry, cx, cy, radius);
      // Everything the circle of pixels paints is still painted, and nothing far from the spot joins.
      const inFlat = new Set(flat);
      const inFull = new Set(full);
      for (const p of flat) expect(inFull.has(p)).toBe(true);
      const c = f * 3;
      const centre = [geometry.centroids[c], geometry.centroids[c + 1], geometry.centroids[c + 2]];
      const chart = atlas.chartOf[f] * 3;
      for (let p = 0; p < mesh.triangles.length; p++) {
        const d = Math.hypot(geometry.centroids[p * 3] - centre[0], geometry.centroids[p * 3 + 1] - centre[1], geometry.centroids[p * 3 + 2] - centre[2]);
        if (inFull.has(p) && !inFlat.has(p)) {
          // The ball is centred on the point under the cursor, at most a face away from the centroid.
          expect(d).toBeLessThan(radius * 1.6);
        }
        // A face of the surface within the radius that faces the map's side of the chart is due a coat.
        const facing = geometry.normals[p * 3] * atlas.chartDir[chart] + geometry.normals[p * 3 + 1] * atlas.chartDir[chart + 1] + geometry.normals[p * 3 + 2] * atlas.chartDir[chart + 2];
        if (d <= radius * 0.9 && facing > 0.1) {
          due++;
          if (!inFlat.has(p)) flatMissed++;
          if (!inFull.has(p)) fullMissed++;
        }
      }
      flatHoles += holes(flat, adjacency, mesh.triangles.length);
      fullHoles += holes(full, adjacency, mesh.triangles.length);
    }
    // The circle of pixels leaves out a good part of the faces due a coat (the stipple); the ball leaves out none.
    expect(due).toBeGreaterThan(50);
    expect(flatMissed / due).toBeGreaterThan(0.1);
    expect(fullMissed).toBe(0);
    expect(fullHoles).toBeLessThanOrEqual(flatHoles);
  });

  it("adds little on a flat surface, where every face shows whole on the map", () => {
    const mesh = flatPlane(40, 40);
    const { atlas, geometry } = build(mesh, 256);
    const radius = 3;
    let flatTotal = 0;
    let fullTotal = 0;
    for (const f of brushSpots(atlas, mesh.triangles.length, 8)) {
      const [cx, cy] = faceAtlasCentre(atlas, f);
      flatTotal += facesInAtlasCircle(atlas, cx, cy, radius * atlas.scale).length;
      fullTotal += facesUnderMapBrush(atlas, mesh, geometry, cx, cy, radius).length;
    }
    expect(fullTotal).toBeGreaterThanOrEqual(flatTotal);
    expect(fullTotal).toBeLessThanOrEqual(flatTotal * 1.25 + 8);
  });
});

describe("the brush on a patch unfolded on its own", () => {
  it("paints only faces on the map, never the surface behind the patch", () => {
    // 11-05, the owner: painting in the hole of the white ribbon, the arm behind it took the colour ("포탈도 아니고").
    const mesh = stackedPlanes(30, 30, 0.05);
    const ribbon = range(0, mesh.triangles.length / 2);
    const geometry = faceGeometry(mesh);
    const atlas = buildPatchAtlas(mesh, geometry, buildFaceAdjacency(mesh.triangles, mesh.vertices.length), ribbon, flatUnfold(mesh, ribbon), 128);
    const spots = brushSpots(atlas, ribbon.length, 8);
    expect(spots.length).toBeGreaterThanOrEqual(6);
    for (const f of spots) {
      const [cx, cy] = faceAtlasCentre(atlas, f);
      const painted = facesUnderMapBrush(atlas, mesh, geometry, cx, cy, 2);
      expect(painted.length).toBeGreaterThan(10);
      for (const p of painted) expect(atlas.chartOf[p]).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps to the surface joined to its middle where the map lays two places side by side", () => {
    // Two squares apart on the model laid edge to edge on the map (an island come round against itself).
    const mesh = stackedPlanes(20, 20, 3);
    const half = mesh.triangles.length / 2;
    const all = range(0, mesh.triangles.length);
    const geometry = faceGeometry(mesh);
    const adjacency = buildFaceAdjacency(mesh.triangles, mesh.vertices.length);
    const atlas = buildPatchAtlas(mesh, geometry, adjacency, all, flatUnfold(mesh, all, (f, x, z) => (f >= half ? [x + 20, z] : null)), 128);
    // Near the first square's edge that meets the second.
    let edge = -1;
    for (let f = 0; f < half; f++) if (geometry.centroids[f * 3] > 9 && Math.abs(geometry.centroids[f * 3 + 2]) < 1) edge = f;
    const [cx, cy] = faceAtlasCentre(atlas, edge);
    const painted = facesUnderMapBrush(atlas, mesh, geometry, cx, cy, 3);
    expect(painted.length).toBeGreaterThan(20);
    for (const f of painted) expect(f).toBeLessThan(half);
    // The circle does reach over the seam on the map.
    expect(facesInAtlasCircle(atlas, cx, cy, 3 * atlas.scale).some((f) => f >= half)).toBe(true);
  });

  it("keeps a stroke to the piece it started on", () => {
    // Two pieces of the map (islands) side by side: a stroke from the first over the second paints only the first.
    const mesh = stackedPlanes(20, 20, 3);
    const half = mesh.triangles.length / 2;
    const all = range(0, mesh.triangles.length);
    const geometry = faceGeometry(mesh);
    const adjacency = buildFaceAdjacency(mesh.triangles, mesh.vertices.length);
    const unfolded = flatUnfold(mesh, all);
    unfolded.pieces = 2;
    for (let i = half; i < all.length; i++) unfolded.piece[i] = 1;
    const atlas = buildPatchAtlas(mesh, geometry, adjacency, all, unfolded, 256);
    const [ax, ay] = faceAtlasCentre(atlas, 5);
    const first = mapIslandAt(atlas, ax, ay, 4);
    expect(first).toBe(atlas.chartOf[5]);
    // Dabs along the stroke, now over the second piece.
    const [bx, by] = faceAtlasCentre(atlas, half + 5);
    const there = facesUnderMapBrush(atlas, mesh, geometry, bx, by, 2, first);
    for (const f of there) expect(atlas.chartOf[f]).toBe(first);
    expect(facesUnderMapBrush(atlas, mesh, geometry, bx, by, 2).some((f) => f >= half)).toBe(true);
  });

  it("takes a face too small to own a pixel where its centre is, so a painted area has no stipple", () => {
    const mesh = flatPlane(120, 12);
    const all = range(0, mesh.triangles.length);
    const geometry = faceGeometry(mesh);
    const atlas = buildPatchAtlas(mesh, geometry, buildFaceAdjacency(mesh.triangles, mesh.vertices.length), all, flatUnfold(mesh, all), 64);
    let pixelless = 0;
    for (let f = 0; f < all.length; f++) if (atlas.pixelOffsets[f + 1] === atlas.pixelOffsets[f]) pixelless++;
    expect(pixelless).toBeGreaterThan(all.length / 4);
    const [cx, cy] = [atlas.extent[0] / 2, atlas.extent[1] / 2];
    const r = 2 * atlas.scale;
    const painted = facesUnderMapBrush(atlas, mesh, geometry, cx, cy, 2);
    const inside = new Set(painted);
    let due = 0;
    for (let f = 0; f < all.length; f++) {
      const [x, y] = faceAtlasCentre(atlas, f);
      const d = Math.hypot(x - cx, y - cy);
      // Every face whose centre is in the circle, a pixel of its own or not (none left out: no stipple); at the rim a
      // one-pixel face goes by its pixel's centre, up to a pixel off its own.
      if (d <= r - 1) {
        due++;
        expect(inside.has(f)).toBe(true);
      }
      // Nothing far off joins.
      if (inside.has(f)) expect(d).toBeLessThanOrEqual(r + 1.5);
    }
    expect(due).toBeGreaterThan(200);
  });
});

describe("a patch unfolded with the faces round it", () => {
  // A 20 × 20 square: the pick is its left half, the faces round it the right half, nearest first.  Laid flat
  // as they are, except a band folded over — the far columns over the pick, the next ones over nearer band.
  const mesh = flatPlane(20, 20);
  const geometry = faceGeometry(mesh);
  const adjacency = buildFaceAdjacency(mesh.triangles, mesh.vertices.length);
  const centreX = (f: number) => geometry.centroids[f * 3];
  const pick = Array.from(range(0, mesh.triangles.length)).filter((f) => centreX(f) < 0);
  const band = Array.from(range(0, mesh.triangles.length)).filter((f) => centreX(f) > 0).sort((a, b) => centreX(a) - centreX(b));
  const faces = Int32Array.from([...pick, ...band]);
  const overPick = (f: number) => centreX(f) > 8;
  const overBand = (f: number) => centreX(f) > 6 && centreX(f) < 8;
  const unfolded = flatUnfold(mesh, faces, (f, x, z) => (overPick(f) ? [-x, z] : overBand(f) ? [12 - x, z] : null));

  it("draws the pick whole and leaves off the map a band folded over it or over nearer band", () => {
    const atlas = buildPatchAtlas(mesh, geometry, adjacency, faces, unfolded, 128, pick.length);
    for (const f of pick) expect(atlas.chartOf[f]).toBeGreaterThanOrEqual(0);
    let gone = 0;
    for (const f of band) {
      const off = atlas.chartOf[f] < 0;
      // Folded over: off the map.  Lying flat beside the pick (touching it along an edge too): on it.
      expect(off).toBe(overPick(f) || overBand(f));
      if (off) gone++;
    }
    expect(gone).toBe(band.filter((f) => overPick(f) || overBand(f)).length);
    expect(atlas.dropped).toBe(gone);
    // Every pixel of the map belongs to a face on it, and the pick keeps every pixel inside it.
    for (let i = 0; i < atlas.idMap.length; i++) if (atlas.idMap[i] >= 0) expect(atlas.chartOf[atlas.idMap[i]]).toBeGreaterThanOrEqual(0);
    let checked = 0;
    for (const f of pick) {
      for (const p of pixelsInside(atlas, f)) {
        expect(atlas.idMap[p]).toBe(f);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("keeps everything when the faces are all the pick", () => {
    const atlas = buildPatchAtlas(mesh, geometry, adjacency, faces, unfolded, 128);
    for (const f of faces) expect(atlas.chartOf[f]).toBeGreaterThanOrEqual(0);
    expect(atlas.dropped ?? 0).toBe(0);
  });
});
