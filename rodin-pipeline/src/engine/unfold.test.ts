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
  it("opens a half cylinder into one flat piece, its curve's length kept", async () => {
    // Radius 1 round half a turn (arc π), 2 high.
    const { positions, triangles } = sheet(24, 12, (s, t) => [Math.cos(Math.PI * s), Math.sin(Math.PI * s), 2 * t]);
    const out = await unfoldPatch(positions, triangles);
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

  it("cuts a closed ball in two and keeps every triangle the right way round", async () => {
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
    const out = await unfoldPatch(Float64Array.from(positions), Int32Array.from(triangles));
    expect(out.pieces).toBeGreaterThanOrEqual(2);
    for (let p = 0; p < out.pieces; p++) {
      const signs = new Set<number>();
      for (let t = 0; t < triangles.length / 3; t++) if (out.piece[t] === p) signs.add(Math.sign(signedArea(out.uv, t)));
      expect(signs.size).toBe(1);
    }
  });

  it("lays a dome flat keeping each triangle's size, not only its angles", async () => {
    // A cap of a ball, 70° from its top: kept to angles alone, its rim comes out far bigger than its middle (the
    // same as a part past a narrow neck shrinking to nothing — Tkc's face, 11-05).
    const { positions, triangles } = sheet(60, 60, (s, t) => {
      const x = 2 * s - 1, y = 2 * t - 1;
      const r = Math.hypot(x, y), cut = Math.min(r, 1);
      const th = (cut * 70 * Math.PI) / 180, ph = Math.atan2(y, x);
      return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    });
    // Only the round part (the grid's corners squashed onto the rim are left out).
    const keep: number[] = [];
    for (let t = 0; t < triangles.length / 3; t++) {
      const c = [0, 1, 2].map((k) => triangles[t * 3 + k]);
      const far = c.some((v) => {
        const i = v % 61, j = Math.floor(v / 61);
        return Math.hypot((2 * i) / 60 - 1, (2 * j) / 60 - 1) > 0.98;
      });
      if (!far) keep.push(...c);
    }
    const tri = Int32Array.from(keep);
    const out = await unfoldPatch(positions, tri);
    expect(out.pieces).toBe(1);
    const T = tri.length / 3;
    const ratios: number[] = [];
    let up = 0;
    for (let t = 0; t < T; t++) {
      const area = signedArea(out.uv, t);
      if (area > 0) up++;
      const p = [0, 1, 2].map((k) => positions.subarray(tri[t * 3 + k] * 3, tri[t * 3 + k] * 3 + 3));
      const e = [0, 1, 2].map((d) => p[1][d] - p[0][d]), f = [0, 1, 2].map((d) => p[2][d] - p[0][d]);
      const area3 = Math.hypot(e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]);
      ratios.push(Math.abs(area) / area3);
    }
    expect(Math.min(up, T - up)).toBe(0);
    const mean = ratios.reduce((a, b) => a + b, 0) / T;
    const spread = Math.sqrt(ratios.reduce((n, r) => n + Math.log(r / mean) ** 2, 0) / T);
    // Angles alone (the solve before 11-05): 0.21 here; now 0.10.
    expect(spread).toBeLessThan(0.15);
  });

  it("cuts a layout that would lie over itself into islands, each one layer", async () => {
    // A ribbon one and a half turns round a post, climbing as it goes (a spiral stair): it lies flat only as a ring
    // of 540°, half of it over the other half — as a bow's loops do (Tkc's ribbon, 11-05).
    const { positions, triangles } = sheet(150, 8, (s, t) => {
      const th = s * 3 * Math.PI, r = 1 + t;
      return [r * Math.cos(th), r * Math.sin(th), 0.15 * th];
    });
    const out = await unfoldPatch(positions, triangles);
    expect(out.pieces).toBeGreaterThanOrEqual(2);
    const T = triangles.length / 3;
    for (let t = 0; t < T; t++) expect(out.piece[t]).toBeGreaterThanOrEqual(0);
    // Within each island, a point of the plane lies under one triangle at most (sampled on a fine grid).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < out.uv.length; i += 2) {
      x0 = Math.min(x0, out.uv[i]);
      x1 = Math.max(x1, out.uv[i]);
      y0 = Math.min(y0, out.uv[i + 1]);
      y1 = Math.max(y1, out.uv[i + 1]);
    }
    const N = 400;
    const cell = Math.max(x1 - x0, y1 - y0) / N;
    let twice = 0, once = 0;
    for (let p = 0; p < out.pieces; p++) {
      const depth = new Uint8Array((N + 2) * (N + 2));
      for (let t = 0; t < T; t++) {
        if (out.piece[t] !== p) continue;
        const u = Array.from(out.uv.subarray(t * 6, t * 6 + 6)).map((v, k) => (v - (k % 2 ? y0 : x0)) / cell);
        const area = (u[2] - u[0]) * (u[5] - u[1]) - (u[4] - u[0]) * (u[3] - u[1]);
        for (let gy = Math.floor(Math.min(u[1], u[3], u[5])); gy <= Math.ceil(Math.max(u[1], u[3], u[5])); gy++)
          for (let gx = Math.floor(Math.min(u[0], u[2], u[4])); gx <= Math.ceil(Math.max(u[0], u[2], u[4])); gx++) {
            const cx = gx + 0.5, cy = gy + 0.5;
            const w0 = ((u[2] - cx) * (u[5] - cy) - (u[4] - cx) * (u[3] - cy)) / area;
            const w1 = ((u[4] - cx) * (u[1] - cy) - (u[0] - cx) * (u[5] - cy)) / area;
            if (w0 > 0.02 && w1 > 0.02 && 1 - w0 - w1 > 0.02 && gx >= 0 && gy >= 0 && gx <= N && gy <= N) depth[gy * (N + 2) + gx]++;
          }
      }
      for (const d of depth) {
        if (d === 1) once++;
        else if (d > 1) twice++;
      }
    }
    // Laid out whole it is half doubled; cut, next to none.
    expect(once).toBeGreaterThan(1000);
    expect(twice / once).toBeLessThan(0.01);
  });

  it("lays what lies under something on a sheet of its own, the open part on one sheet", async () => {
    // A flat pick with a plate just in front of its left third (a ribbon over the neck): the open two thirds come out
    // as one island, the covered third as another — two sheets, no crumbs (11-05, the owner: "따로 떼어 놓기").
    const { positions, triangles } = sheet(60, 40, (s, t) => [3 * s, 2 * t, 0]);
    const plate: number[] = [];
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 80; j++) plate.push((1 * i) / 60, (2 * j) / 80, 0.4);
    const out = await unfoldPatch(positions, triangles, { occluders: Float64Array.from(plate) });
    const T = triangles.length / 3;
    const centreX = (t: number) => [0, 1, 2].reduce((n, k) => n + positions[triangles[t * 3 + k] * 3], 0) / 3;
    const open = new Set<number>(), under = new Set<number>();
    for (let t = 0; t < T; t++) {
      const x = centreX(t);
      if (x > 1.3) open.add(out.piece[t]);
      else if (x < 0.8) under.add(out.piece[t]);
    }
    expect(out.pieces).toBe(2);
    expect(open.size).toBe(1);
    expect(under.size).toBe(1);
    expect([...open][0]).not.toBe([...under][0]);
  });

  it("keeps apart pieces that do not touch", async () => {
    const a = sheet(4, 4, (s, t) => [s, t, 0]);
    const b = sheet(4, 4, (s, t) => [s + 5, t, 0]);
    const positions = Float64Array.from([...a.positions, ...b.positions]);
    const offset = a.positions.length / 3;
    const triangles = Int32Array.from([...a.triangles, ...[...b.triangles].map((v) => v + offset)]);
    expect((await unfoldPatch(positions, triangles)).pieces).toBe(2);
  });
});
