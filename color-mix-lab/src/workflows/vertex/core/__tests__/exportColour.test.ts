import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { MeshModel, RGB, Tri, Vec3 } from "../types";
import { buildColourFile, placeVertices } from "../exportColour";

function cube(): MeshModel {
  const vertices: Vec3[] = [];
  for (const z of [0, 1]) for (const y of [0, 1]) for (const x of [0, 1]) vertices.push([x * 10 - 5, y * 10 - 5, z * 10 + 40]);
  const triangles: Tri[] = [
    [0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4],
    [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5],
  ];
  const red: RGB = [227, 74, 147];
  const navy: RGB = [27, 24, 137];
  const triangleColors = triangles.map((_t, i) => (i < 4 ? red : navy));
  return {
    name: "cube.obj",
    vertices,
    triangles,
    triangleColors,
    stats: { vertexCount: 8, triangleCount: 12, coloredVertexCount: 0, uniqueFaceColors: 2, objectFaceCounts: {} },
  };
}

const identity = "1 0 0 0 1 0 0 0 1 0 0 0";
const input = (model: MeshModel) => ({
  model,
  faceColours: model.triangleColors,
  transform: identity,
  putOnBed: true,
  bedCentre: { x: 128, y: 128 },
  baseName: "cube",
});

describe("placeVertices", () => {
  it("reads the transform the 3MF way and lands the mesh on the bed centre", () => {
    // Y-up to Z-up as the slicer export writes it: x' = x, y' = -z, z' = y.
    const placed = placeVertices([[0, 0, 0], [0, 20, 0], [10, 0, 4]], "1 0 0 0 0 1 0 -1 0 0 0 0", true, { x: 100, y: 50 });
    const z = [placed[2], placed[5], placed[8]];
    expect(Math.min(...z)).toBe(0);
    expect(z[1]).toBe(20); // the old +Y end is the top
    expect((placed[0] + placed[6]) / 2).toBe(100);
    expect((Math.min(placed[1], placed[4], placed[7]) + Math.max(placed[1], placed[4], placed[7])) / 2).toBe(50);
  });
});

describe("buildColourFile", () => {
  it("3MF: one colour group, every triangle points at its colour", async () => {
    const result = await buildColourFile("3mf", input(cube()));
    expect(result.fileName).toBe("cube.3mf");
    expect(result.colourCount).toBe(2);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const xml = await zip.file("3D/3dmodel.model")!.async("string");
    expect(xml).toContain('requiredextensions="m"');
    expect(xml.match(/<m:color /g)).toHaveLength(2);
    expect(xml).toContain('color="#E34A93FF"');
    expect(xml.match(/pid="1" p1="0"/g)).toHaveLength(4);
    expect(xml.match(/pid="1" p1="1"/g)).toHaveLength(8);
    expect(xml).toMatch(/<vertex x="123" y="123" z="0"\/>/);
  });

  it("OBJ: a zip with the MTL, faces grouped under one material per colour", async () => {
    const result = await buildColourFile("obj", input(cube()));
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const obj = await zip.file("cube.obj")!.async("string");
    const mtl = await zip.file("cube.mtl")!.async("string");
    expect(obj).toContain("mtllib cube.mtl");
    expect(obj.match(/^usemtl /gm)).toHaveLength(2);
    expect(obj.match(/^f /gm)).toHaveLength(12);
    expect(mtl).toContain("newmtl c1_E34A93");
    expect(mtl).toMatch(/Kd 0\.890196 0\.290196 0\.576471/);
  });

  it("VRML: colour per face, one index per triangle", async () => {
    const result = await buildColourFile("wrl", input(cube()));
    const text = await result.blob.text();
    expect(text.startsWith("#VRML V2.0 utf8")).toBe(true);
    expect(text).toContain("colorPerVertex FALSE");
    const indices = text.split("colorIndex [")[1].split("]")[0].match(/\d+/g);
    expect(indices).toEqual(["0", "0", "0", "0", "1", "1", "1", "1", "1", "1", "1", "1"]);
  });

  it("PLY: three own vertices per triangle, coloured, so boundaries stay sharp", async () => {
    const result = await buildColourFile("ply", input(cube()));
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const headerEnd = new TextDecoder().decode(bytes).indexOf("end_header\n") + "end_header\n".length;
    const header = new TextDecoder().decode(bytes.slice(0, headerEnd));
    expect(header).toContain("element vertex 36");
    expect(header).toContain("element face 12");
    expect(bytes.length).toBe(headerEnd + 36 * 15 + 12 * 13);
    // First vertex colour = the first triangle's colour.
    expect([...bytes.slice(headerEnd + 12, headerEnd + 15)]).toEqual([227, 74, 147]);
  });

  it("refuses colours that do not cover every triangle", async () => {
    const model = cube();
    await expect(buildColourFile("3mf", { ...input(model), faceColours: model.triangleColors.slice(1) })).rejects.toThrow(/incomplete/);
  });
});
