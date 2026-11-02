import JSZip from "jszip";
import type { Filament, PhysicalSlot, RGB, Tri, Vec3 } from "../types";
import { encodePaintCode } from "../paintCodes";

export interface GridMesh {
  vertices: Vec3[];
  triangles: Tri[];
  nx: number;
  ny: number;
  /** Cell column/row of every face (two faces per cell). */
  cellOfFace: Array<[number, number]>;
}

/** Flat grid in the XY plane (Z = 0), two triangles per cell. */
export function gridMesh(nx: number, ny: number, size = 1): GridMesh {
  const vertices: Vec3[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) vertices.push([i * size, j * size, 0]);
  }
  const triangles: Tri[] = [];
  const cellOfFace: Array<[number, number]> = [];
  const idx = (i: number, j: number) => j * (nx + 1) + i;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      triangles.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
      triangles.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
      cellOfFace.push([i, j], [i, j]);
    }
  }
  return { vertices, triangles, nx, ny, cellOfFace };
}

export interface FoldedGrid {
  vertices: Vec3[];
  triangles: Tri[];
  /** Cell column and row of every face; rows below `crease` lie on the floor, the rest up the wall. */
  cellOfFace: Array<[number, number]>;
  /** Group 1 on the wall, 0 on the floor, spilled over the crease (see foldedGrid). */
  groups: Int32Array;
  nx: number;
  crease: number;
}

/**
 * A part standing on another: a grid folded along a crease into a floor (z = 0)
 * and a wall rising from y = 0, leaning `lean` radians away from upright (less
 * than 0: over the floor, as the underside of a round part meets what it lies
 * on).  The colour spills over the crease as a texture's does: every 4th column
 * runs two rows of faces down onto the floor, and the ones between leave a
 * notch a row up the wall.  The points are moved by up to `jitter` and the
 * faces come in a shuffled order, as in a real mesh (so which face of a border
 * edge comes first says nothing about its side).
 */
export function foldedGrid(options: { lean?: number; jitter?: number; seed?: number; flip?: boolean } = {}): FoldedGrid {
  const nx = 24;
  const crease = 10;
  const grid = gridMesh(nx, crease * 2);
  let seed = options.seed ?? 1;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const lean = options.lean ?? 0;
  const jitter = options.jitter ?? 0;
  const vertices: Vec3[] = grid.vertices.map(([x, j]) => {
    const p: Vec3 = j <= crease ? [x, crease - j, 0] : [x, -(j - crease) * Math.sin(lean), (j - crease) * Math.cos(lean)];
    if (jitter > 0 && j !== crease) for (let c = 0; c < 3; c++) p[c] += (rand() - 0.5) * 2 * jitter * (c === 0 ? 1 : 0.5);
    return p;
  });
  const order = grid.triangles.map((_, f) => f);
  for (let i = order.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [order[i], order[k]] = [order[k], order[i]];
  }
  const triangles: Tri[] = order.map((f) => {
    const [a, b, c] = grid.triangles[f];
    return options.flip ? [a, c, b] : [a, b, c];
  });
  const cellOfFace = order.map((f) => grid.cellOfFace[f]);
  const inner = (i: number) => i > 1 && i < nx - 2;
  const groups = Int32Array.from(
    cellOfFace.map(([i, j]) => (j >= crease ? (inner(i) && i % 4 === 2 && j === crease ? 0 : 1) : inner(i) && i % 4 === 0 && j >= crease - 2 ? 1 : 0)),
  );
  return { vertices, triangles, cellOfFace, groups, nx, crease };
}

export interface PaintedGrid {
  vertices: Vec3[];
  triangles: Tri[];
  /** Group 0 the ground, 1 the dots, 2 the band. */
  groups: Int32Array;
  /** The dots: centre x, y and radius each. */
  dots: Array<[number, number, number]>;
  /** The grid's own random numbers, going on from where it left off (to paint it over the same way each run). */
  rand: () => number;
}

/**
 * A bumpy grid painted as a model is: round dots (group 1) and a wavy band
 * (group 2) on a ground (group 0), every border ragged — a face beside another
 * group took that group now and then, as a brush leaves it.  The points are
 * jittered and the grid bends up and down, so the surface turns under the borders.
 */
export function paintedGrid(seed: number): PaintedGrid {
  const nx = 60;
  const ny = 44;
  const grid = gridMesh(nx, ny);
  let state = seed * 7919;
  const rand = () => (state = (state * 1103515245 + 12345) >>> 0) / 4294967296;
  const vertices: Vec3[] = grid.vertices.map(([x, y]) => {
    const jx = x + (rand() - 0.5) * 0.5;
    const jy = y + (rand() - 0.5) * 0.5;
    return [jx, jy, 3 * Math.sin(jx / 6) * Math.cos(jy / 8)];
  });
  const dots = Array.from({ length: 6 }, (): [number, number, number] => [5 + rand() * (nx - 10), 5 + rand() * (ny - 10), 1.5 + rand() * 2.5]);
  const groupAt = (x: number, y: number) => {
    for (const [cx, cy, r] of dots) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return 1;
    return Math.abs(y - 22 - 4 * Math.sin(x / 7)) < 3 ? 2 : 0;
  };
  const clean = grid.triangles.map((t) => groupAt((grid.vertices[t[0]][0] + grid.vertices[t[1]][0] + grid.vertices[t[2]][0]) / 3, (grid.vertices[t[0]][1] + grid.vertices[t[1]][1] + grid.vertices[t[2]][1]) / 3));
  const facesOfSide = new Map<string, number[]>();
  grid.triangles.forEach((t, f) => {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      facesOfSide.set(key, [...(facesOfSide.get(key) ?? []), f]);
    }
  });
  const groups = Int32Array.from(clean);
  grid.triangles.forEach((t, f) => {
    const others: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      for (const g of facesOfSide.get(a < b ? `${a},${b}` : `${b},${a}`) ?? []) if (clean[g] !== clean[f]) others.push(clean[g]);
    }
    if (others.length > 0 && rand() < 0.25) groups[f] = others[Math.floor(rand() * others.length)];
  });
  return { vertices, triangles: grid.triangles, groups, dots, rand };
}

export function makeSlots(hexes: string[]): PhysicalSlot[] {
  return hexes.map((hex, index) => {
    const rgb: RGB = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const filament: Filament = {
      name: `F${index + 1}`,
      type: "PLA",
      rgb,
      effectiveRgb: rgb,
      sourceLine: hex,
    };
    return { slot: index + 1, filament, role: "" };
  });
}

export interface Rodin3mfFixtureOptions {
  vertices: Vec3[];
  triangles: Tri[];
  /** 1-based extruder per face; 0 = unpainted. */
  extruders: number[];
  paletteHex?: string[];
  includeSettings?: boolean;
  settingsAsPlainText?: boolean;
  /** "both" writes paint_color + mmu_segmentation, "bambu" paint_color only, "texture" pid only. */
  attributeMode?: "both" | "bambu" | "prusa" | "texture";
  buildTransform?: string;
  /** Put the mesh into 3D/Objects/part.model and reference it via a component. */
  splitIntoObjectFile?: boolean;
}

function meshXml(options: Rodin3mfFixtureOptions): string {
  const mode = options.attributeMode ?? "both";
  const lines: string[] = ["<mesh>", "<vertices>"];
  for (const [x, y, z] of options.vertices) lines.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
  lines.push("</vertices>", "<triangles>");
  options.triangles.forEach((tri, i) => {
    const code = options.extruders[i] > 0 ? encodePaintCode(options.extruders[i]) : "";
    let attrs = "";
    if (mode === "both") attrs = ` paint_color="${code}" slic3rpe:mmu_segmentation="${code}"`;
    else if (mode === "bambu") attrs = ` paint_color="${code}"`;
    else if (mode === "prusa") attrs = ` slic3rpe:mmu_segmentation="${code}"`;
    else attrs = ` pid="1" p1="${i}"`;
    lines.push(`<triangle v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}"${attrs}/>`);
  });
  lines.push("</triangles>", "</mesh>");
  return lines.join("\n");
}

export async function buildRodin3mf(options: Rodin3mfFixtureOptions): Promise<Uint8Array> {
  const zip = new JSZip();
  const transform = options.buildTransform ? ` transform="${options.buildTransform}"` : "";
  const head =
    '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">';
  if (options.splitIntoObjectFile) {
    zip.file(
      "3D/3dmodel.model",
      `${head}\n<resources>\n<object id="2" type="model"><components><component objectid="1" p:path="/3D/Objects/part.model"/></components></object>\n</resources>\n<build><item objectid="2"${transform} printable="1"/></build>\n</model>`,
    );
    zip.file(
      "3D/Objects/part.model",
      `${head}\n<resources>\n<object id="1" name="part" type="model">${meshXml(options)}</object>\n</resources>\n</model>`,
    );
  } else {
    zip.file(
      "3D/3dmodel.model",
      `${head}\n<resources>\n<object id="1" name="typhoeus" type="model">${meshXml(options)}</object>\n</resources>\n<build><item objectid="1"${transform} printable="1"/></build>\n</model>`,
    );
  }
  if (options.includeSettings !== false) {
    const palette = options.paletteHex ?? [];
    if (options.settingsAsPlainText) {
      zip.file(
        "Metadata/project_settings.config",
        `{\n  "other": 1,\n  "filament_colour": [\n${palette.map((hex) => `    "${hex}"`).join(",\n")}\n  ],\n  "filament_type": ["PLA"]\n}`,
      );
    } else {
      zip.file(
        "Metadata/project_settings.config",
        JSON.stringify({ filament_colour: palette, filament_type: palette.map(() => "PLA") }, null, 2),
      );
    }
  }
  zip.file("[Content_Types].xml", "<Types/>");
  return zip.generateAsync({ type: "uint8array" });
}

export const THIRTEEN_PALETTE = [
  "#FFFFFF", "#F2C9A8", "#C9A0DC", "#5B2C83", "#111111", "#D62828", "#A4919E",
  "#595159", "#D6C0C3", "#7D727A", "#E8E1D9", "#3A2A45", "#B08D78",
];
