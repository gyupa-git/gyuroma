import { describe, expect, it } from "vitest";
import { buildFaceAdjacency } from "@core/meshAdjacency";
import { buildColourStrip, initialCuts } from "@core/colourStrip";
import type { RGB } from "@core/types";
import { specksIn } from "./specks";

/** A square grid of cells, two triangles each, labelled by a function of the cell. */
function grid(n: number, labelOf: (x: number, y: number) => number) {
  const vertices: [number, number, number][] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) vertices.push([x, y, 0]);
  const triangles: [number, number, number][] = [];
  const labels: number[] = [];
  const cellFaces = new Map<string, number[]>();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      const faces = [triangles.length, triangles.length + 1];
      triangles.push([a, a + 1, a + n + 1], [a + 1, a + n + 2, a + n + 1]);
      labels.push(labelOf(x, y), labelOf(x, y));
      cellFaces.set(`${x},${y}`, faces);
    }
  }
  return { adjacency: buildFaceAdjacency(triangles, vertices.length), labels: Int32Array.from(labels), cellFaces, faceCount: triangles.length };
}

const PINK = 0, BLACK = 1, GOLD = 2;

describe("specksIn", () => {
  // A pink field with: a 1-cell black dot, a 2×2 black blotch, a 5×5 black region, a gold dot inside the
  // blotch's neighbourhood, and a black band along the right edge that is not enclosed.
  const labelOf = (x: number, y: number): number => {
    if (x >= 17) return BLACK; // the band: touches the edge of the field, enclosed only on one side
    if (x === 3 && y === 3) return BLACK; // dot
    if (x >= 6 && x <= 7 && y >= 6 && y <= 7) return BLACK; // blotch
    if (x >= 10 && x <= 14 && y >= 10 && y <= 14) return BLACK; // big region
    if (x === 12 && y === 12) return GOLD; // a dot inside the big region (enclosed by black, not pink)
    return PINK;
  };
  const { adjacency, labels, cellFaces } = grid(20, labelOf);
  const faces = (cells: string[]) => cells.flatMap((c) => cellFaces.get(c) as number[]);

  it("takes the small patches enclosed by the colour and leaves the big one and the band", () => {
    const got = new Set(specksIn(labels, adjacency, { into: PINK, within: null, maxFaces: 12, enclosed: 0.8, protectedLabels: null, taken: null }));
    for (const f of faces(["3,3", "6,6", "7,7"])) expect(got.has(f)).toBe(true);
    for (const f of faces(["10,10", "12,12", "17,5", "19,19"])) expect(got.has(f)).toBe(false);
    expect(got.size).toBe(2 + 8);
  });

  it("with no size limit still leaves what is not enclosed, and takes a speck inside a speck on a later pass", () => {
    // A black blotch with a gold dot in it: the dot is enclosed by black, not pink — until the blotch is taken.
    const nested = (x: number, y: number): number => (x >= 5 && x <= 8 && y >= 5 && y <= 8 ? (x === 6 && y === 6 ? GOLD : BLACK) : PINK);
    const g = grid(14, nested);
    const got = new Set(specksIn(g.labels, g.adjacency, { into: PINK, within: null, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken: null }));
    expect(got.size).toBe(16 * 2);
    for (const f of g.cellFaces.get("6,6") as number[]) expect(got.has(f)).toBe(true);
  });

  it("within a brush's reach takes only patches wholly inside it, and remembers what an earlier dab took", () => {
    const reachCells: string[] = [];
    for (let y = 2; y <= 8; y++) for (let x = 2; x <= 8; x++) reachCells.push(`${x},${y}`);
    const within = Int32Array.from(faces(reachCells));
    const taken = new Uint8Array(labels.length);
    const first = specksIn(labels, adjacency, { into: PINK, within, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken });
    expect(new Set(first).size).toBe(2 + 8);
    // A second dab over the same ground finds nothing new.
    const second = specksIn(labels, adjacency, { into: PINK, within, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken });
    expect(second.length).toBe(0);
    // A dab that covers only half of the blotch leaves it: the brush must not cross the colour's outline by halves.
    const half = Int32Array.from(faces(["5,5", "6,5", "5,6", "6,6", "5,7", "6,7"]));
    expect(specksIn(labels, adjacency, { into: PINK, within: half, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken: null }).length).toBe(0);
  });

  it("never takes a protected colour", () => {
    const protectedLabels = new Uint8Array(3);
    protectedLabels[BLACK] = 1;
    const got = specksIn(labels, adjacency, { into: PINK, within: null, maxFaces: 12, enclosed: 0.8, protectedLabels, taken: null });
    expect(got.length).toBe(0);
  });
});

describe("initialCuts: a family that runs from light to dark keeps two groups", () => {
  it("keeps white and black apart with few groups", () => {
    const white: RGB = [250, 250, 250], black: RGB = [20, 20, 20];
    const skin: RGB[] = [[230, 180, 140], [210, 160, 120], [190, 140, 100], [170, 120, 85]];
    const colours: RGB[] = [];
    const weights: number[] = [];
    const add = (rgb: RGB, w: number) => { colours.push(rgb); weights.push(w); };
    add(black, 12); add(white, 4);
    for (const s of skin) add(s, 15);
    add([60, 120, 200], 10);
    const strip = buildColourStrip(colours, weights);
    const cuts = initialCuts(strip, 6);
    const neutral = strip.families.find((f) => f.name === "neutral");
    expect(neutral).toBeDefined();
    const neutralCuts = cuts[neutral!.family] ?? [];
    expect(neutralCuts.length).toBe(1);
  });
});
