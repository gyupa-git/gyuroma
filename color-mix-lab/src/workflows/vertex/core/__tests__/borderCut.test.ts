import { describe, expect, it } from "vitest";
import { buildEdgeAdjacency, buildFaceAdjacency } from "../meshAdjacency";
import { flatCorners } from "../borderLines";
import { cutAlongBorderLines, meshWithCut, type BorderCut } from "../borderCut";
import { foldedGrid, gridMesh, paintedGrid } from "./fixtures";
import type { Tri, Vec3 } from "../types";

// Two triangles per cell: face (i, j, k) = (j·nx + i)·2 + k.
// By shared vertex (as the merge has it) or by shared side (the lighter one the app's worker keeps).
const mesh = (nx: number, ny: number, sides = false) => {
  const grid = gridMesh(nx, ny);
  const adjacency = sides ? buildEdgeAdjacency(flatCorners(grid.triangles), grid.vertices.length) : buildFaceAdjacency(grid.triangles, grid.vertices.length);
  return { ...grid, adjacency };
};
const groupsOf = (nx: number, ny: number, of: (x: number, y: number) => number) => {
  // By the centre of each face.
  const out: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) out.push(of(i + 2 / 3, j + 1 / 3), of(i + 1 / 3, j + 2 / 3));
  return Int32Array.from(out);
};

/** The mesh after the cut: the faces not replaced, then the pieces. */
function refined(triangles: Tri[], vertices: Vec3[], groups: Int32Array, cut: BorderCut) {
  const points: Vec3[] = [...vertices];
  for (let k = 0; k < cut.addedVertices.length; k += 3)
    points.push([cut.addedVertices[k], cut.addedVertices[k + 1], cut.addedVertices[k + 2]]);
  const gone = new Set(cut.replaced);
  const tris: Tri[] = [];
  const g: number[] = [];
  triangles.forEach((t, f) => {
    if (gone.has(f)) return;
    tris.push(t);
    g.push(groups[f]);
  });
  for (let p = 0; p < cut.pieceGroups.length; p++) {
    tris.push([cut.pieces[p * 3], cut.pieces[p * 3 + 1], cut.pieces[p * 3 + 2]]);
    g.push(cut.pieceGroups[p]);
  }
  return { points, tris, groups: g };
}
const area = (points: Vec3[], t: Tri) => {
  const [a, b, c] = t.map((v) => points[v]);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
};
/** How long the edges used by one triangle only are: the grid's rim, and any crack on top (a cut point on the rim splits it, same length). */
const openLength = (points: Vec3[], tris: Tri[]) => {
  const used = new Map<string, number>();
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      used.set(key, (used.get(key) ?? 0) + 1);
    }
  let length = 0;
  for (const [key, n] of used) {
    if (n !== 1) continue;
    const [a, b] = key.split(",").map((v) => points[Number(v)]);
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return length;
};
/** The patches of a colour made only of pieces that went to it: joined to nothing that was that colour. */
function crumbs(vertices: Vec3[], triangles: Tri[], groups: Int32Array, cut: BorderCut) {
  const made = meshWithCut(vertices, triangles, cut);
  const group = Int32Array.from(made.originalFace, (f, i) => (made.piece[i] >= 0 ? cut.pieceGroups[made.piece[i]] : groups[f]));
  const parent = Int32Array.from(group, (_, i) => i);
  const find = (x: number) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const firstOnSide = new Map<string, number>();
  made.triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const j = firstOnSide.get(key);
      if (j === undefined) firstOnSide.set(key, i);
      else if (group[j] === group[i]) parent[find(i)] = find(j);
    }
  });
  const onlyChanged = new Map<number, boolean>();
  for (let i = 0; i < group.length; i++) {
    const changed = made.piece[i] >= 0 && group[i] !== groups[made.originalFace[i]];
    onlyChanged.set(find(i), (onlyChanged.get(find(i)) ?? true) && changed);
  }
  return [...onlyChanged.values()].filter(Boolean).length;
}
const run = (nx: number, ny: number, groups: Int32Array, span: number, protectedGroups: number[] = [], sides = false) => {
  const { triangles, vertices, adjacency } = mesh(nx, ny, sides);
  const protectedGroup = new Uint8Array(3);
  for (const g of protectedGroups) protectedGroup[g] = 1;
  const cut = cutAlongBorderLines(adjacency, triangles, vertices, groups, { span, protectedGroup });
  return { cut, triangles, vertices, ...refined(triangles, vertices, groups, cut) };
};

describe("cutAlongBorderLines", () => {
  it.each([false, true])("cuts a staircase along the line through it (by sides: %s)", (sides) => {
    // Group 0 below a staircase climbing a row every 4 columns: the line through
    // the middles of its risers is y = 1.5 + x / 4.
    const nx = 24;
    const ny = 10;
    const groups = groupsOf(nx, ny, (x, y) => (y < 2 + Math.floor(x / 4) ? 0 : 1));
    const { cut, points, tris, groups: g, triangles, vertices } = run(nx, ny, groups, 14, [], sides);
    expect(cut.replaced.length).toBeGreaterThan(0);
    // Every side between the two groups now lies on the line (away from the ends of the grid).
    let checked = 0;
    const used = new Map<string, number[]>();
    tris.forEach((t, p) => {
      for (let k = 0; k < 3; k++) {
        const a = t[k], b = t[(k + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const list = used.get(key) ?? [];
        list.push(p);
        used.set(key, list);
      }
    });
    for (const [key, faces] of used) {
      if (faces.length !== 2 || g[faces[0]] === g[faces[1]]) continue;
      for (const v of key.split(",").map(Number)) {
        const [x, y] = points[v];
        if (x < 4 || x > nx - 4) continue;
        checked++;
        expect(Math.abs(y - (1.5 + x / 4))).toBeLessThan(0.35);
      }
    }
    expect(checked).toBeGreaterThan(20);
    // Nothing lost or cracked; no sliver.
    const before = triangles.reduce((s, t) => s + area(vertices, t), 0);
    const after = tris.reduce((s, t) => s + area(points, t), 0);
    expect(after).toBeCloseTo(before, 9);
    expect(openLength(points, tris)).toBeCloseTo(openLength(vertices, triangles), 9);
    for (let p = 0; p < cut.pieceGroups.length; p++) {
      const t: Tri = [cut.pieces[p * 3], cut.pieces[p * 3 + 1], cut.pieces[p * 3 + 2]];
      expect(area(points, t)).toBeGreaterThan(0.002);
    }
    // Each piece on its side of the line.
    for (let p = 0; p < tris.length; p++) {
      const [a, b, c] = tris[p].map((v) => points[v]);
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cy = (a[1] + b[1] + c[1]) / 3;
      if (cx < 4 || cx > nx - 4 || Math.abs(cy - (1.5 + cx / 4)) < 0.4) continue;
      expect(g[p]).toBe(cy < 1.5 + cx / 4 ? 0 : 1);
    }
  });

  it("leaves a border along the grid, a protected border and nothing at 0", () => {
    const straight = groupsOf(12, 8, (_x, y) => (y < 4 ? 0 : 1));
    expect(run(12, 8, straight, 10).cut.replaced.length).toBe(0);
    const stairs = groupsOf(12, 8, (x, y) => (y < 2 + Math.floor(x / 4) ? 0 : 1));
    expect(run(12, 8, stairs, 10, [1]).cut.replaced.length).toBe(0);
    expect(run(12, 8, stairs, 0).cut.replaced.length).toBe(0);
  });

  it("keeps a third colour and where three groups meet whole, with no cracks", () => {
    // A staircase between 0 and 1, and a block of group 2 sitting across it.
    const nx = 48;
    const ny = 14;
    const groups = groupsOf(nx, ny, (x, y) => (x >= 22 && x < 26 && y >= 3 && y < 10 ? 2 : y < 2 + Math.floor(x / 6) ? 0 : 1));
    const { cut, tris, triangles, vertices, points, groups: g } = run(nx, ny, groups, 10);
    expect(cut.replaced.length).toBeGreaterThan(0);
    expect(openLength(points, tris)).toBeCloseTo(openLength(vertices, triangles), 9);
    // Group 2 keeps its faces: pieces of its faces stay 2, and no other face becomes 2.
    for (let p = 0; p < cut.pieceGroups.length; p++) {
      const was = groups[cut.pieceFaces[p]];
      if (was === 2) expect(cut.pieceGroups[p]).toBe(2);
      else expect(cut.pieceGroups[p]).not.toBe(2);
    }
    expect(g.filter((x) => x === 2).length).toBeGreaterThanOrEqual(groups.filter((x) => x === 2).length);
  });

  it("keeps a round part its size", () => {
    const n = 40;
    for (const r of [5, 10]) {
      const groups = groupsOf(n, n, (x, y) => ((x - 20) ** 2 + (y - 20) ** 2 <= r * r ? 1 : 0));
      const faces = groups.reduce((s, v) => s + v, 0) / 2;
      const { points, tris, groups: g } = run(n, n, groups, 16);
      let inside = 0;
      tris.forEach((t, p) => {
        if (g[p] === 1) inside += area(points, t);
      });
      // No further from the true circle than the faces were, give or take a few percent
      // (a small part: a tenth of an edge on its radius).
      const truth = Math.PI * r * r;
      expect(Math.abs(inside / truth - 1)).toBeLessThan(Math.abs(faces / truth - 1) + 0.05);
    }
  });

  it("cuts nothing again once confirmed, and only around faces changed since", () => {
    const nx = 24;
    const ny = 10;
    const groups = groupsOf(nx, ny, (x, y) => (y < 2 + Math.floor(x / 4) ? 0 : 1));
    const { triangles, vertices, adjacency } = mesh(nx, ny);
    const cut = cutAlongBorderLines(adjacency, triangles, vertices, groups, { span: 14, protectedGroup: new Uint8Array(2) });
    expect(cut.replaced.length).toBeGreaterThan(0);
    // Confirmed: the cut mesh, its groups, every face as it was cut.
    const after = meshWithCut(vertices, triangles, cut);
    const g = Int32Array.from(after.originalFace, (f, i) => (after.piece[i] >= 0 ? cut.pieceGroups[after.piece[i]] : groups[f]));
    const adjacency2 = buildFaceAdjacency(after.triangles, after.vertices.length);
    const settled = g.slice(); // each face's group as confirmed
    const again = cutAlongBorderLines(adjacency2, after.triangles, after.vertices, g, { span: 14, protectedGroup: new Uint8Array(2), settled });
    expect(again.replaced.length).toBe(0);
    // Faces repainted near the right end: only around them is cut again.
    const near = (i: number) => {
      const t = after.triangles[i];
      return t.reduce((s, v) => s + after.vertices[v][0], 0) / 3;
    };
    for (let i = 0; i < g.length; i++)
      if (near(i) > 19) {
        const t = after.triangles[i];
        const y = t.reduce((s, v) => s + after.vertices[v][1], 0) / 3;
        g[i] = y < 3 ? 0 : 1; // a different border there
      }
    const third = cutAlongBorderLines(adjacency2, after.triangles, after.vertices, g, { span: 14, protectedGroup: new Uint8Array(2), settled });
    for (const f of third.replaced) expect(near(f)).toBeGreaterThan(14);
  });

  it("keeps every face's number when the cut is made", () => {
    const nx = 24;
    const ny = 10;
    const groups = groupsOf(nx, ny, (x, y) => (y < 2 + Math.floor(x / 4) ? 0 : 1));
    const { triangles, vertices, adjacency } = mesh(nx, ny);
    const cut = cutAlongBorderLines(adjacency, triangles, vertices, groups, { span: 14, protectedGroup: new Uint8Array(2) });
    const after = meshWithCut(vertices, triangles, cut);
    const gone = new Set(cut.replaced);
    expect(after.triangles.length).toBe(triangles.length - cut.replaced.length + cut.pieceGroups.length);
    expect(after.vertices.length).toBe(vertices.length + cut.addedVertices.length / 3);
    for (let f = 0; f < triangles.length; f++) {
      expect(after.originalFace[f]).toBe(f);
      if (gone.has(f)) expect(cut.pieceFaces[after.piece[f]]).toBe(f);
      else {
        expect(after.triangles[f]).toBe(triangles[f]); // the very same triple
        expect(after.piece[f]).toBe(-1);
      }
    }
    // Every piece once.
    const seen = new Set<number>();
    for (let i = 0; i < after.triangles.length; i++) if (after.piece[i] >= 0) seen.add(after.piece[i]);
    expect(seen.size).toBe(cut.pieceGroups.length);
    for (let i = triangles.length; i < after.triangles.length; i++) expect(gone.has(after.originalFace[i])).toBe(true);
  });

  it("keeps a confirmed border when its colours are merged or changed later", () => {
    // Three groups: 0 below the staircase, 1 above; confirmed; then group 1 recoloured to 2.
    const nx = 24;
    const ny = 10;
    const groups = groupsOf(nx, ny, (x, y) => (y < 2 + Math.floor(x / 4) ? 0 : 1));
    const { triangles, vertices, adjacency } = mesh(nx, ny);
    const cut = cutAlongBorderLines(adjacency, triangles, vertices, groups, { span: 14, protectedGroup: new Uint8Array(3) });
    const after = meshWithCut(vertices, triangles, cut);
    const g = Int32Array.from(after.originalFace, (f, i) => (after.piece[i] >= 0 ? cut.pieceGroups[after.piece[i]] : groups[f]));
    const confirmed = g.slice();
    const recoloured = Int32Array.from(g, (x) => (x === 1 ? 2 : x));
    const adjacency2 = buildFaceAdjacency(after.triangles, after.vertices.length);
    const again = cutAlongBorderLines(adjacency2, after.triangles, after.vertices, recoloured, { span: 14, protectedGroup: new Uint8Array(3), settled: confirmed });
    expect(again.replaced.length).toBe(0);
  });

  it("cuts every face on a cut side, a fin as well, and leaves no speck of another group", () => {
    // A grid with a fin: a third face on one side of the staircase border.
    const nx = 24;
    const ny = 10;
    const grid = gridMesh(nx, ny);
    const groups = Array.from(groupsOf(nx, ny, (x, y) => (y < 2 + Math.floor(x / 4) ? 0 : 1)));
    const vertices: Vec3[] = [...grid.vertices];
    const triangles: Tri[] = [...grid.triangles];
    // fins on every side of row 3, standing up out of the plane
    for (let i = 0; i < nx; i++) {
      const a = 3 * (nx + 1) + i;
      const b = a + 1;
      vertices.push([i + 0.5, 3, 1]);
      triangles.push([a, b, vertices.length - 1]);
      groups.push(1);
    }
    const g = Int32Array.from(groups);
    const adjacency = buildEdgeAdjacency(flatCorners(triangles), vertices.length);
    const cut = cutAlongBorderLines(adjacency, triangles, vertices, g, { span: 14, protectedGroup: new Uint8Array(2) });
    const { points, tris, groups: out } = refined(triangles, vertices, g, cut);
    expect(openLength(points, tris)).toBeCloseTo(openLength(vertices, triangles), 9);
    // No piece of a group with no side on that group.
    const sides = new Map<string, number[]>();
    tris.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const a = t[k], b = t[(k + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const list = sides.get(key) ?? [];
        list.push(i);
        sides.set(key, list);
      }
    });
    const first = triangles.length - cut.replaced.length;
    for (let i = first; i < tris.length; i++) {
      const p = i - first;
      if (cut.pieceGroups[p] === g[cut.pieceFaces[p]]) continue;
      let touches = false;
      for (let k = 0; k < 3; k++) {
        const a = tris[i][k], b = tris[i][(k + 1) % 3];
        for (const j of sides.get(a < b ? `${a},${b}` : `${b},${a}`) ?? []) if (j !== i && out[j] === out[i]) touches = true;
      }
      expect(touches).toBe(true);
    }
  });
});

describe("cutAlongBorderLines — ragged paint (see paintedGrid)", () => {
  it("leaves no crumb, cut afresh or again after a repaint", () => {
    // A crumb: a patch of a colour made only of pieces that went to it, apart from all that
    // was that colour.  Off a line that hardly moved, the side a point lies on turns on the
    // line's ends and corners: points whole edges inside a part went across — and pieces
    // side by side passed for joined to their colour by touching each other.
    const options = { span: 16, protectedGroup: new Uint8Array(3) };
    for (let seed = 1; seed <= 30; seed++) {
      const painted = paintedGrid(seed);
      const sides = buildEdgeAdjacency(flatCorners(painted.triangles), painted.vertices.length);
      const cut = cutAlongBorderLines(sides, painted.triangles, painted.vertices, painted.groups, options);
      expect(crumbs(painted.vertices, painted.triangles, painted.groups, cut)).toBe(0);
      // Confirmed; then the dots painted over a little larger (raggedly) and cut again.
      const after = meshWithCut(painted.vertices, painted.triangles, cut);
      const settled = Int32Array.from(after.originalFace, (f, i) => (after.piece[i] >= 0 ? cut.pieceGroups[after.piece[i]] : painted.groups[f]));
      const repainted = settled.slice();
      after.triangles.forEach((t, i) => {
        const x = (after.vertices[t[0]][0] + after.vertices[t[1]][0] + after.vertices[t[2]][0]) / 3;
        const y = (after.vertices[t[0]][1] + after.vertices[t[1]][1] + after.vertices[t[2]][1]) / 3;
        for (const [cx, cy, r] of painted.dots) if ((x - cx) ** 2 + (y - cy) ** 2 <= (r + 1) ** 2 && painted.rand() < 0.7) repainted[i] = 1;
      });
      const sides2 = buildEdgeAdjacency(flatCorners(after.triangles), after.vertices.length);
      const again = cutAlongBorderLines(sides2, after.triangles, after.vertices, repainted, { ...options, settled });
      expect(crumbs(after.vertices, after.triangles, repainted, again)).toBe(0);
    }
  });
});

describe("cutAlongBorderLines — along a fold (a part standing on another)", () => {
  // The colour spilled over the crease (see foldedGrid).  Each point is measured in its own
  // surface: no piece takes a group further than it reached before — onto the floor past the
  // spills, up the wall past the notches.  Measured across the border edge's other face
  // (square to it, or leaning over), some did.
  for (const lean of [0, -0.3]) {
    it(`takes no colour further than it reached (wall leaning ${lean})`, () => {
      for (let seed = 1; seed <= 8; seed++) {
        const fold = foldedGrid({ lean, jitter: 0.2, seed });
        const sides = buildEdgeAdjacency(flatCorners(fold.triangles), fold.vertices.length);
        const cut = cutAlongBorderLines(sides, fold.triangles, fold.vertices, fold.groups, { span: 16, protectedGroup: new Uint8Array(2) });
        const made = meshWithCut(fold.vertices, fold.triangles, cut);
        let further = 0;
        for (let i = 0; i < made.triangles.length; i++) {
          const from = made.originalFace[i];
          const [ci, cj] = fold.cellOfFace[from];
          if (ci < 2 || ci >= fold.nx - 2) continue;
          const group = made.piece[i] >= 0 ? cut.pieceGroups[made.piece[i]] : fold.groups[from];
          if ((group === 1 && cj < fold.crease - 2) || (group === 0 && cj > fold.crease)) further += area(made.vertices, made.triangles[i]);
        }
        expect(further).toBe(0);
      }
    });
  }
});
