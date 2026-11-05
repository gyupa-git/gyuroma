import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import type { RGB, Tri, Vec3 } from "@core/types";
import { creaseGeometry } from "./creases";
import { markRegion, wandRegion } from "./wand";

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function labOf(colours: RGB[]): Float32Array {
  const out = new Float32Array(colours.length * 3);
  colours.forEach((c, f) => {
    const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    out[f * 3] = 116 * t(y) - 16;
    out[f * 3 + 1] = 500 * (t(x) - t(y));
    out[f * 3 + 2] = 200 * (t(y) - t(z));
  });
  return out;
}

function surface(w: number, h: number, height: (x: number) => number, colourOf: (x: number, y: number) => RGB) {
  const vertices: Vec3[] = [];
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) vertices.push([x, y, height(x)]);
  const triangles: Tri[] = [];
  const xy: Array<[number, number]> = [];
  const colours: RGB[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = y * (w + 1) + x;
      triangles.push([a, a + 1, a + w + 1], [a + 1, a + w + 2, a + w + 1]);
      xy.push([x, y], [x, y]);
      colours.push(colourOf(x, y), colourOf(x, y));
    }
  return { xy, lab: labOf(colours), adjacency: buildFaceAdjacency(triangles, vertices.length), geometry: creaseGeometry(vertices, triangles) };
}

describe("wandRegion", () => {
  it("takes a shaded tan stripe on a black bag, and nothing of the bag", () => {
    const s = surface(30, 20, () => 0, (x) => (x >= 10 && x < 14 ? [Math.round(150 + x * 3), Math.round(120 + x * 2), 80] : [12, 12, 14]));
    const seed = s.xy.findIndex(([x, y]) => x === 11 && y === 10);
    const got = new Set(wandRegion(seed, s.lab, s.adjacency, s.geometry));
    s.xy.forEach(([x], f) => expect(got.has(f)).toBe(x >= 10 && x < 14));
  });

  it("stops at an inward fold even where the colour runs on", () => {
    // One tan all over; a sunk lens from x = 11 (a steep wall down at x = 10..11).
    const s = surface(24, 8, (x) => (x <= 10 ? 0 : -3), () => [186, 151, 97]);
    const seed = s.xy.findIndex(([x, y]) => x === 18 && y === 4);
    const got = new Set(wandRegion(seed, s.lab, s.adjacency, s.geometry));
    s.xy.forEach(([x], f) => {
      if (x >= 12) expect(got.has(f)).toBe(true);
      if (x <= 9) expect(got.has(f)).toBe(false);
    });
  });

  it("keeps to a thin dark line whose edges fade into the skin, not the whole face", () => {
    // A mouth line two faces wide (x = 20, 21) in skin, its edges fading over ten faces each side in small steps.
    const shade = (x: number): RGB => {
      const d = x < 20 ? 20 - x : x > 21 ? x - 21 : 0;
      const v = Math.round(60 + Math.min(10, d) * 12);
      return [v, Math.round(v * 0.78), Math.round(v * 0.62)];
    };
    const s = surface(42, 10, () => 0, (x) => shade(x));
    const seed = s.xy.findIndex(([x, y]) => x === 20 && y === 5);
    const got = new Set(wandRegion(seed, s.lab, s.adjacency, s.geometry));
    // The line and a little of its dark edge — never the skin far off.
    s.xy.forEach(([x], f) => {
      if (x === 20 || x === 21) expect(got.has(f)).toBe(true);
      if (x <= 14 || x >= 27) expect(got.has(f)).toBe(false);
    });
  });

  it("keeps to the faces it may take and to its size", () => {
    const s = surface(20, 20, () => 0, () => [200, 200, 200]);
    const within = new Uint8Array(s.xy.length);
    s.xy.forEach(([x], f) => (within[f] = x < 5 ? 1 : 0));
    const seed = s.xy.findIndex(([x, y]) => x === 2 && y === 2);
    const got = wandRegion(seed, s.lab, s.adjacency, s.geometry, { within });
    expect([...got].every((f) => s.xy[f][0] < 5)).toBe(true);
    expect(wandRegion(seed, s.lab, s.adjacency, s.geometry, { maxFaces: 30 }).length).toBe(30);
  });
});

describe("markRegion", () => {
  it("takes a white ruffle with grey shading in its folds, and stops at its cream trim", () => {
    // x < 16: white, greyer towards its folds (L* about 74 to 98); x 16..19: cream trim; beyond: skin.
    const s = surface(40, 10, () => 0, (x) => {
      if (x < 16) {
        const v = Math.round(250 - Math.abs(8 - x) * 9);
        return [v, v, v];
      }
      if (x < 20) return [240, 216, 144];
      return [186, 140, 110];
    });
    const seed = s.xy.findIndex(([x, y]) => x === 8 && y === 5);
    const got = markRegion(seed, s.lab, s.adjacency, s.geometry, null, s.xy.length, true);
    expect(got).not.toBeNull();
    const taken = new Set(got);
    s.xy.forEach(([x], f) => expect(taken.has(f)).toBe(x < 16));
    // Held to plain ΔE from the seed it would leave the shaded folds out (the blotches of 11-05).
    const plain = new Set(wandRegion(seed, s.lab, s.adjacency, s.geometry));
    expect(s.xy.some(([x], f) => x < 16 && !plain.has(f))).toBe(true);
  });

  it("keeps a thin line in the skin's own hue to the line (plain ΔE, not shaded)", () => {
    const shade = (x: number): RGB => {
      const d = x < 20 ? 20 - x : x > 21 ? x - 21 : 0;
      const v = Math.round(60 + Math.min(10, d) * 12);
      return [v, Math.round(v * 0.78), Math.round(v * 0.62)];
    };
    const s = surface(42, 10, () => 0, (x) => shade(x));
    const seed = s.xy.findIndex(([x, y]) => x === 20 && y === 5);
    const got = markRegion(seed, s.lab, s.adjacency, s.geometry, null, s.xy.length);
    expect(got).not.toBeNull();
    const taken = new Set(got);
    s.xy.forEach(([x], f) => {
      if (x === 20 || x === 21) expect(taken.has(f)).toBe(true);
      if (x <= 14 || x >= 27) expect(taken.has(f)).toBe(false);
    });
  });

  it("paints nothing where the thing has no colour of its own (it would paint its surroundings)", () => {
    const s = surface(40, 10, () => 0, () => [186, 140, 110]);
    const seed = s.xy.findIndex(([x, y]) => x === 20 && y === 5);
    expect(markRegion(seed, s.lab, s.adjacency, s.geometry, null, s.xy.length)).toBeNull();
  });
  it("puts a cream piping's edge in the middle of its fade into the white, straight", () => {
    // x < 12 cream, 12..20 a fade to white, beyond white; a little speckle in the white and in the fade.
    const cream: RGB = [240, 216, 144];
    const white: RGB = [245, 245, 245];
    const s = surface(40, 10, () => 0, (x, y) => {
      const t = Math.max(0, Math.min(1, (x - 12) / 8));
      const jitter = ((x * 7 + y * 13) % 5) - 2;
      return [0, 1, 2].map((k) => Math.round(cream[k] + (white[k] - cream[k]) * t + jitter)) as RGB;
    });
    const seed = s.xy.findIndex(([x, y]) => x === 5 && y === 5);
    const got = markRegion(seed, s.lab, s.adjacency, s.geometry, null, s.xy.length, false);
    expect(got).not.toBeNull();
    const taken = new Set(got);
    s.xy.forEach(([x], f) => {
      if (x <= 13) expect(taken.has(f)).toBe(true);
      if (x >= 19) expect(taken.has(f)).toBe(false);
    });
    // The same edge on every row (no waves into the white).
    const edgeOf = (row: number) => Math.max(...s.xy.map(([x, y], f) => (y === row && taken.has(f) ? x : -1)));
    const edges = new Set(Array.from({ length: 10 }, (_, row) => edgeOf(row)));
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1);
  });
});
