import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import type { MeshModel, RGB } from "@core/types";
import { buildFaceAtlas, faceAtAtlasPixel, faceAtlasCentre, faceAtlasPoint, facesInAtlasCircle, facesUnderMapBrush, type FaceAtlas } from "./atlas";
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
