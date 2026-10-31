import JSZip from "jszip";
import type { MeshModel, RGB, Vec3 } from "./types";
import { rgbToHex } from "./colour";

/**
 * Colour files for printers that print colour directly instead of switching
 * filaments: inkjet resin and PolyJet machines, full-colour binder jetting and
 * UV printers.  They take a coloured mesh, so there is no extruder painting:
 * every triangle carries its own colour, which after the app's cleanup is one
 * of a few flat palette colours.
 *
 * All formats write the same placed mesh (turned, scaled and put on the bed
 * the way the slicer export places it) and the same per-triangle colours.
 */
export type ColourFileFormat = "3mf" | "obj" | "wrl" | "ply";

export interface ColourExportInput {
  model: MeshModel;
  /** Colour of every triangle, in model order. */
  faceColours: RGB[];
  /**
   * The 3MF build transform the slicer export uses ("m00 m01 m02 m10 … m32"),
   * read with 3MF semantics: x' = x·m00 + y·m10 + z·m20 + m30.
   */
  transform: string;
  putOnBed: boolean;
  /** Bed centre to put the model on; null keeps the transformed position. */
  bedCentre: { x: number; y: number } | null;
  /** File name without extension. */
  baseName: string;
}

export interface ColourExportResult {
  blob: Blob;
  fileName: string;
  colourCount: number;
  triangleCount: number;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(6)).toString();
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Vertices after the build transform, moved onto the bed.  Only vertices a
 * triangle uses count for the bounds (meshes can carry stray points).
 */
export function placeVertices(
  vertices: Vec3[],
  transform: string,
  putOnBed: boolean,
  bedCentre: { x: number; y: number } | null,
  triangles?: ReadonlyArray<readonly [number, number, number]>,
): Float64Array {
  const m = transform.trim().split(/\s+/).map(Number);
  if (m.length !== 12 || m.some((v) => !Number.isFinite(v))) throw new Error(`Bad transform "${transform}".`);
  const out = new Float64Array(vertices.length * 3);
  vertices.forEach(([x, y, z], i) => {
    out[i * 3] = x * m[0] + y * m[3] + z * m[6] + m[9];
    out[i * 3 + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
    out[i * 3 + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
  });
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (v: number) => {
    for (let c = 0; c < 3; c++) {
      const p = out[v * 3 + c];
      if (p < min[c]) min[c] = p;
      if (p > max[c]) max[c] = p;
    }
  };
  if (triangles) {
    for (const [a, b, c] of triangles) {
      grow(a);
      grow(b);
      grow(c);
    }
  } else for (let v = 0; v < vertices.length; v++) grow(v);
  // The translation in the transform was worked out for the slicer, which
  // drops the model onto the bed anyway; a mesh file has to arrive there.
  const shift = [
    bedCentre ? bedCentre.x - (min[0] + max[0]) / 2 : 0,
    bedCentre ? bedCentre.y - (min[1] + max[1]) / 2 : 0,
    putOnBed ? -min[2] : 0,
  ];
  for (let i = 0; i < out.length; i++) out[i] += shift[i % 3];
  return out;
}

/** The distinct colours, in order of first use, and each triangle's index into them. */
function colourTable(faceColours: RGB[]): { colours: RGB[]; indexOf: Int32Array } {
  const byKey = new Map<number, number>();
  const colours: RGB[] = [];
  const indexOf = new Int32Array(faceColours.length);
  faceColours.forEach((rgb, i) => {
    const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    let index = byKey.get(key);
    if (index === undefined) {
      index = colours.length;
      byKey.set(key, index);
      colours.push([rgb[0], rgb[1], rgb[2]]);
    }
    indexOf[i] = index;
  });
  return { colours, indexOf };
}

/**
 * 3MF with the Materials extension: one colour group, every triangle pointing
 * at its colour (pid/p1).  The colour form of 3MF that full-colour printer
 * software (and Windows' own 3D viewer) reads.
 */
async function build3mf(input: ColourExportInput, positions: Float64Array, colours: RGB[], indexOf: Int32Array): Promise<Uint8Array> {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m">',
  );
  out.push(` <metadata name="Title">${xmlEscape(input.baseName)}</metadata>`);
  out.push(' <metadata name="Application">GYUROMA</metadata>');
  out.push(" <resources>");
  out.push('  <m:colorgroup id="1">');
  for (const rgb of colours) out.push(`   <m:color color="${rgbToHex(rgb)}FF"/>`);
  out.push("  </m:colorgroup>");
  out.push(`  <object id="2" type="model" name="${xmlEscape(input.baseName)}" pid="1" pindex="0">`);
  out.push("   <mesh>");
  out.push("    <vertices>");
  for (let i = 0; i < positions.length; i += 3) out.push(`     <vertex x="${fmt(positions[i])}" y="${fmt(positions[i + 1])}" z="${fmt(positions[i + 2])}"/>`);
  out.push("    </vertices>");
  out.push("    <triangles>");
  input.model.triangles.forEach(([a, b, c], i) => {
    out.push(`     <triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${indexOf[i]}"/>`);
  });
  out.push("    </triangles>");
  out.push("   </mesh>");
  out.push("  </object>");
  out.push(" </resources>");
  out.push(' <build>\n  <item objectid="2"/>\n </build>');
  out.push("</model>");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>\n',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n',
  );
  zip.file("3D/3dmodel.model", out.join("\n") + "\n");
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/**
 * OBJ + MTL, one flat material per colour (Kd), zipped together because an
 * OBJ without its MTL loses every colour.
 */
async function buildObj(input: ColourExportInput, positions: Float64Array, colours: RGB[], indexOf: Int32Array): Promise<Uint8Array> {
  // `mtllib` takes a space-separated list, so a name with spaces would lose the colours.
  const name = input.baseName.replace(/[^\p{L}\p{N}._-]+/gu, "_");
  const mtl: string[] = [`# ${name} colours (${colours.length})`];
  colours.forEach((rgb, k) => {
    mtl.push("", `newmtl c${k + 1}_${rgbToHex(rgb).slice(1)}`, `Kd ${fmt(rgb[0] / 255)} ${fmt(rgb[1] / 255)} ${fmt(rgb[2] / 255)}`, "Ka 0 0 0", "Ks 0 0 0", "d 1", "illum 1");
  });
  const obj: string[] = [`# ${name}`, `mtllib ${name}.mtl`, `o ${name}`];
  for (let i = 0; i < positions.length; i += 3) obj.push(`v ${fmt(positions[i])} ${fmt(positions[i + 1])} ${fmt(positions[i + 2])}`);
  // Faces grouped by colour, so each material is switched to once.
  const byColour: number[][] = colours.map(() => []);
  indexOf.forEach((k, i) => byColour[k].push(i));
  byColour.forEach((faces, k) => {
    if (faces.length === 0) return;
    obj.push(`usemtl c${k + 1}_${rgbToHex(colours[k]).slice(1)}`);
    for (const i of faces) {
      const [a, b, c] = input.model.triangles[i];
      obj.push(`f ${a + 1} ${b + 1} ${c + 1}`);
    }
  });
  const zip = new JSZip();
  zip.file(`${name}.obj`, obj.join("\n") + "\n");
  zip.file(`${name}.mtl`, mtl.join("\n") + "\n");
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** VRML 2.0 with one colour per face (colorPerVertex FALSE): what Mimaki, Stratasys and 3D Systems software read. */
function buildWrl(input: ColourExportInput, positions: Float64Array, colours: RGB[], indexOf: Int32Array): Uint8Array {
  const out: string[] = ["#VRML V2.0 utf8", `# ${input.baseName}`, "Shape {", " geometry IndexedFaceSet {", "  solid TRUE", "  colorPerVertex FALSE", "  coord Coordinate { point ["];
  for (let i = 0; i < positions.length; i += 3) out.push(`   ${fmt(positions[i])} ${fmt(positions[i + 1])} ${fmt(positions[i + 2])},`);
  out.push("  ] }", "  coordIndex [");
  for (const [a, b, c] of input.model.triangles) out.push(`   ${a}, ${b}, ${c}, -1,`);
  out.push("  ]", "  color Color { color [");
  for (const rgb of colours) out.push(`   ${fmt(rgb[0] / 255)} ${fmt(rgb[1] / 255)} ${fmt(rgb[2] / 255)},`);
  out.push("  ] }", "  colorIndex [");
  const row: string[] = [];
  indexOf.forEach((k) => {
    row.push(String(k));
    if (row.length === 32) out.push(`   ${row.splice(0).join(", ")},`);
  });
  if (row.length > 0) out.push(`   ${row.join(", ")}`);
  out.push("  ]", " }", "}");
  return new TextEncoder().encode(out.join("\n") + "\n");
}

/**
 * Binary PLY with vertex colours.  Most readers only take colours per vertex,
 * so every triangle gets its own three vertices: colour boundaries stay sharp.
 */
function buildPly(input: ColourExportInput, positions: Float64Array, faceColours: RGB[]): Uint8Array {
  const faces = input.model.triangles.length;
  const header = new TextEncoder().encode(
    [
      "ply",
      "format binary_little_endian 1.0",
      `comment ${input.baseName}`,
      `element vertex ${faces * 3}`,
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      `element face ${faces}`,
      "property list uchar int vertex_indices",
      "end_header",
      "",
    ].join("\n"),
  );
  const vertexBytes = 15;
  const faceBytes = 13;
  const bytes = new Uint8Array(header.length + faces * 3 * vertexBytes + faces * faceBytes);
  bytes.set(header, 0);
  const view = new DataView(bytes.buffer);
  let at = header.length;
  input.model.triangles.forEach((tri, i) => {
    const rgb = faceColours[i];
    for (const v of tri) {
      view.setFloat32(at, positions[v * 3], true);
      view.setFloat32(at + 4, positions[v * 3 + 1], true);
      view.setFloat32(at + 8, positions[v * 3 + 2], true);
      bytes[at + 12] = rgb[0];
      bytes[at + 13] = rgb[1];
      bytes[at + 14] = rgb[2];
      at += vertexBytes;
    }
  });
  for (let i = 0; i < faces; i++) {
    bytes[at] = 3;
    view.setInt32(at + 1, i * 3, true);
    view.setInt32(at + 5, i * 3 + 1, true);
    view.setInt32(at + 9, i * 3 + 2, true);
    at += faceBytes;
  }
  return bytes;
}

export async function buildColourFile(format: ColourFileFormat, input: ColourExportInput): Promise<ColourExportResult> {
  const { model, faceColours } = input;
  if (faceColours.length !== model.triangles.length) throw new Error("Colour data is incomplete.");
  const positions = placeVertices(model.vertices, input.transform, input.putOnBed, input.bedCentre, model.triangles);
  const { colours, indexOf } = colourTable(faceColours);
  const base = input.baseName.trim() || "model";
  const named = { ...input, baseName: base };
  let bytes: Uint8Array;
  let fileName: string;
  let type: string;
  if (format === "3mf") {
    bytes = await build3mf(named, positions, colours, indexOf);
    fileName = `${base}.3mf`;
    type = "model/3mf";
  } else if (format === "obj") {
    bytes = await buildObj(named, positions, colours, indexOf);
    fileName = `${base}_obj.zip`;
    type = "application/zip";
  } else if (format === "wrl") {
    bytes = buildWrl(named, positions, colours, indexOf);
    fileName = `${base}.wrl`;
    type = "model/vrml";
  } else {
    bytes = buildPly(named, positions, faceColours);
    fileName = `${base}.ply`;
    type = "application/octet-stream";
  }
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), fileName, colourCount: colours.length, triangleCount: model.triangles.length };
}
