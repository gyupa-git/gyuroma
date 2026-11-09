import { describe, expect, it } from "vitest";
import { facesInSphere, facesNearSegment, type FaceGeometry } from "./mesh";

/** Random face centres (and normals) in a box, as faceGeometry gives them. */
function cloud(n: number, seed: number): FaceGeometry {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const centroids = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    centroids[i * 3] = rand() * 4 - 2;
    centroids[i * 3 + 1] = rand() * 2 - 1;
    centroids[i * 3 + 2] = rand() * 0.5;
    const a = rand() * Math.PI * 2, b = rand() * Math.PI;
    normals[i * 3] = Math.sin(b) * Math.cos(a);
    normals[i * 3 + 1] = Math.sin(b) * Math.sin(a);
    normals[i * 3 + 2] = Math.cos(b);
  }
  return { centroids, normals, radius: 2 };
}

/** The same question answered by going through every face (what the brush did before 11-05). */
function byHand(g: FaceGeometry, a: number[], b: number[], r: number, view: number[] | null): number[] {
  const out: number[] = [];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  for (let i = 0; i < g.centroids.length / 3; i++) {
    const p = [g.centroids[i * 3] - a[0], g.centroids[i * 3 + 1] - a[1], g.centroids[i * 3 + 2] - a[2]];
    const t = len2 > 0 ? Math.max(0, Math.min(1, (p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / len2)) : 0;
    if ((p[0] - t * d[0]) ** 2 + (p[1] - t * d[1]) ** 2 + (p[2] - t * d[2]) ** 2 > r * r) continue;
    if (view && g.normals[i * 3] * view[0] + g.normals[i * 3 + 1] * view[1] + g.normals[i * 3 + 2] * view[2] > 0.25) continue;
    out.push(i);
  }
  return out;
}

describe("brush reach", () => {
  const g = cloud(20_000, 7);

  it("finds the same faces in a ball as going through them all", () => {
    for (const [p, r] of [[[0, 0, 0.2], 0.3], [[-1.9, 0.9, 0], 0.15], [[1, -0.5, 0.4], 1.2], [[5, 5, 5], 0.5]] as const) {
      expect([...facesInSphere(g, [...p] as [number, number, number], r, null)]).toEqual(byHand(g, [...p], [...p], r, null));
    }
    expect([...facesInSphere(g, [0.3, 0.1, 0.2], 0.4, [0, 0, -1])]).toEqual(byHand(g, [0.3, 0.1, 0.2], [0.3, 0.1, 0.2], 0.4, [0, 0, -1]));
  });

  it("paints the stretch between two dabs, not only the dabs", () => {
    const a: [number, number, number] = [-1.5, -0.6, 0.25], b: [number, number, number] = [1.5, 0.7, 0.25];
    const got = [...facesNearSegment(g, a, b, 0.1, null)];
    expect(got).toEqual(byHand(g, [...a], [...b], 0.1, null));
    // The middle, far from either dab, is in.
    const dabs = new Set([...facesInSphere(g, a, 0.1, null), ...facesInSphere(g, b, 0.1, null)]);
    expect(got.filter((f) => !dabs.has(f)).length).toBeGreaterThan(got.length / 2);
  });
});
