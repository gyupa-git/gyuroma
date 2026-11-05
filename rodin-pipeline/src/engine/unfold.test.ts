import { describe, expect, it } from "vitest";
import { unfoldPatch } from "./unfold";

/** A grid of quads over (s, t) ∈ [0,1]², each split in two, at the points `at` gives. */
function sheet(w: number, h: number, at: (s: number, t: number) => [number, number, number]) {
  const positions: number[] = [];
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) positions.push(...at(i / w, j / h));
  const triangles: number[] = [];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const a = j * (w + 1) + i;
      triangles.push(a, a + 1, a + w + 2, a, a + w + 2, a + w + 1);
    }
  return { positions: Float64Array.from(positions), triangles: Int32Array.from(triangles) };
}

const signedArea = (uv: Float32Array, t: number) =>
  (uv[t * 6 + 2] - uv[t * 6]) * (uv[t * 6 + 5] - uv[t * 6 + 1]) - (uv[t * 6 + 4] - uv[t * 6]) * (uv[t * 6 + 3] - uv[t * 6 + 1]);

describe("unfoldPatch", () => {
  it("opens a half cylinder into one flat piece, its curve's length kept", () => {
    // Radius 1 round half a turn (arc π), 2 high.
    const { positions, triangles } = sheet(24, 12, (s, t) => [Math.cos(Math.PI * s), Math.sin(Math.PI * s), 2 * t]);
    const out = unfoldPatch(positions, triangles);
    expect(out.pieces).toBe(1);
    const T = triangles.length / 3;
    const signs = new Set<number>();
    for (let t = 0; t < T; t++) signs.add(Math.sign(signedArea(out.uv, t)));
    // No triangle turned over.
    expect(signs.size).toBe(1);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < out.uv.length; i += 2) {
      minU = Math.min(minU, out.uv[i]);
      maxU = Math.max(maxU, out.uv[i]);
      minV = Math.min(minV, out.uv[i + 1]);
      maxV = Math.max(maxV, out.uv[i + 1]);
    }
    const long = Math.max(maxU - minU, maxV - minV), short = Math.min(maxU - minU, maxV - minV);
    // π : 2 — a projection straight on would give 2 : 2.
    expect(long / short).toBeGreaterThan((Math.PI / 2) * 0.93);
    expect(long / short).toBeLessThan((Math.PI / 2) * 1.07);
  });

  it("cuts a closed ball in two and keeps every triangle the right way round", () => {
    // A UV sphere, its poles closed by the grid's own rows (the top and bottom rows collapse to points).
    const w = 24, h = 12;
    const raw = sheet(w, h, (s, t) => {
      const th = Math.PI * t, ph = 2 * Math.PI * s;
      return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    });
    // Weld the seam (s = 1 onto s = 0) and the poles, so the ball has no border.
    const id = (i: number, j: number) => (j === 0 ? 0 : j === h ? 1 : 2 + (j - 1) * w + (i % w));
    const positions: number[] = [0, 0, 1, 0, 0, -1];
    for (let j = 1; j < h; j++) for (let i = 0; i < w; i++) positions.push(raw.positions[(j * (w + 1) + i) * 3], raw.positions[(j * (w + 1) + i) * 3 + 1], raw.positions[(j * (w + 1) + i) * 3 + 2]);
    const triangles: number[] = [];
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
        if (a !== b) triangles.push(a, b, c);
        if (c !== d) triangles.push(a, c, d);
      }
    const out = unfoldPatch(Float64Array.from(positions), Int32Array.from(triangles));
    expect(out.pieces).toBeGreaterThanOrEqual(2);
    for (let p = 0; p < out.pieces; p++) {
      const signs = new Set<number>();
      for (let t = 0; t < triangles.length / 3; t++) if (out.piece[t] === p) signs.add(Math.sign(signedArea(out.uv, t)));
      expect(signs.size).toBe(1);
    }
  });

  it("keeps apart pieces that do not touch", () => {
    const a = sheet(4, 4, (s, t) => [s, t, 0]);
    const b = sheet(4, 4, (s, t) => [s + 5, t, 0]);
    const positions = Float64Array.from([...a.positions, ...b.positions]);
    const offset = a.positions.length / 3;
    const triangles = Int32Array.from([...a.triangles, ...[...b.triangles].map((v) => v + offset)]);
    expect(unfoldPatch(positions, triangles).pieces).toBe(2);
  });
});
