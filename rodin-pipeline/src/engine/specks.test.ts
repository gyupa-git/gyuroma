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
    // A dab that covers only half of the blotch leaves it: cut at the reach, the blotch is open along its whole far side.
    const half = Int32Array.from(faces(["5,5", "6,5", "5,6", "6,6", "5,7", "6,7"]));
    expect(specksIn(labels, adjacency, { into: PINK, within: half, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken: null }).length).toBe(0);
  });

  it("judges a patch inside the reach only — a blotch joined by a neck goes, a body's edge stays — and paints under the tip", () => {
    // A black 2×2 blotch (x 5–6, y 11–12) joined by a one-cell neck (x 7–9, y 12) to the big black region (x 10–14, y 10–14).
    const joined = (x: number, y: number): number =>
      (x >= 10 && x <= 14 && y >= 10 && y <= 14) || (x >= 5 && x <= 6 && y >= 11 && y <= 12) || (y === 12 && x >= 7 && x <= 9) ? BLACK : PINK;
    const g = grid(20, joined);
    const cells = (x0: number, x1: number, y0: number, y1: number): string[] => {
      const out: string[] = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`);
      return out;
    };
    const f = (list: string[]) => Int32Array.from(list.flatMap((c) => g.cellFaces.get(c) as number[]));
    const rules = { into: PINK, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken: null };
    // The reach x 3–9, y 9–15 holds the blotch and the neck, not the region: the whole of it goes (the neck's
    // end is one open edge of fourteen), nothing outside the reach.
    const within = f(cells(3, 9, 9, 15));
    const all = new Set(specksIn(g.labels, g.adjacency, { ...rules, within }));
    expect(all.size).toBe((4 + 3) * 2);
    for (const face of g.cellFaces.get("10,12") as number[]) expect(all.has(face)).toBe(false);
    // The tip over the blotch only (x 4–6, y 10–13): the blotch goes, the neck stays for the next dab.
    const tip = f(cells(4, 6, 10, 13));
    const got = new Set(specksIn(g.labels, g.adjacency, { ...rules, within, tip }));
    expect(got.size).toBe(4 * 2);
    for (const face of g.cellFaces.get("7,12") as number[]) expect(got.has(face)).toBe(false);
    for (const face of g.cellFaces.get("5,11") as number[]) expect(got.has(face)).toBe(true);
    // A body's edge: the reach x 7–11, y 8–16 takes in a two-cell-deep strip of the region (and the neck,
    // joined to it), open along the whole of x = 11: left alone.
    const edge = f(cells(7, 11, 8, 16));
    expect(specksIn(g.labels, g.adjacency, { ...rules, within: edge, tip: edge }).length).toBe(0);
  });

  it("auto (into = -1): each speck takes the colour around it, with no colour chosen", () => {
    // Left half pink, right half gold; a black dot in each half, and a black blotch on the line between them.
    const two = (x: number, y: number): number => {
      if (x === 4 && y === 5) return BLACK;
      if (x === 15 && y === 5) return BLACK;
      if (x >= 9 && x <= 10 && y >= 12 && y <= 13) return BLACK; // half in pink, half in gold: enclosed by neither
      return x < 10 ? PINK : GOLD;
    };
    const g = grid(20, two);
    const targets: number[] = [];
    const relabel = new Map<number, number>();
    const got = specksIn(g.labels, g.adjacency, { into: -1, within: null, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken: null, relabel, targets });
    const to = new Map<number, number>();
    got.forEach((face, i) => to.set(face, targets[i]));
    for (const face of g.cellFaces.get("4,5") as number[]) expect(to.get(face)).toBe(PINK);
    for (const face of g.cellFaces.get("15,5") as number[]) expect(to.get(face)).toBe(GOLD);
    for (const face of g.cellFaces.get("9,12") as number[]) expect(to.has(face)).toBe(false);
    expect(got.length).toBe(4);
    expect(relabel.size).toBe(4);
    // The big halves are never a speck of each other.
    for (const face of g.cellFaces.get("0,0") as number[]) expect(to.has(face)).toBe(false);
  });

  it("within a reach, a speck with a soft edge (a core and a ring of another shade) goes whole", () => {
    // Pink ground; a gold 2×2 core (x 6–7, y 6–7) in a one-cell black ring (x 5–8, y 5–8).
    const soft = (x: number, y: number): number => (x >= 6 && x <= 7 && y >= 6 && y <= 7 ? GOLD : x >= 5 && x <= 8 && y >= 5 && y <= 8 ? BLACK : PINK);
    const g = grid(14, soft);
    const cells: string[] = [];
    for (let y = 2; y <= 11; y++) for (let x = 2; x <= 11; x++) cells.push(`${x},${y}`);
    const within = Int32Array.from(cells.flatMap((c) => g.cellFaces.get(c) as number[]));
    for (const into of [-1, PINK]) {
      const targets: number[] = [];
      const got = specksIn(g.labels, g.adjacency, { into, within, tip: within, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken: null, relabel: new Map(), targets });
      expect(got.length).toBe(16 * 2);
      expect(new Set(targets)).toEqual(new Set([PINK]));
    }
    // The whole-model pass keeps the old rule: the core is enclosed by the ring, not by pink, and the ring by both.
    expect(specksIn(g.labels, g.adjacency, { into: PINK, within: null, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken: null }).length).toBe(0);
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
