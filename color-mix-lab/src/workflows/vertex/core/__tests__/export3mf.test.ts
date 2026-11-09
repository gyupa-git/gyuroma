import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { MeshModel, PaletteEntry, RGB } from "../types";
import type { VirtualBlendEntry, VirtualExtruderPlan } from "../virtualExtruders";
import {
  transformNoTranslation,
  buildExportAssignments,
  buildPrusa3mfBlob,
  validateExportAssignments,
  type Export3mfOptions,
} from "../export3mf";
import { decodePaintCode } from "../paintCodes";
import { renderModelThumbnail, type ThumbnailRaster } from "../modelThumbnail";
import { gridMesh, makeSlots } from "./fixtures";

const PHYSICAL = makeSlots(["#FFFFFF", "#000000", "#FF0000", "#0000FF", "#FFFF00"]);

function blend(virtualId: number, rgb: RGB, paletteIndices: number[]): VirtualBlendEntry {
  return {
    virtualId,
    displayRgb: rgb,
    layerAverageRgb: rgb,
    components: [
      { extruder: 1, ratio: 0.5, count: 1, rgb: [255, 255, 255] },
      { extruder: 3, ratio: 0.5, count: 1, rgb: [255, 0, 0] },
    ],
    sequence: [1, 3],
    sequenceKey: `${virtualId}:1-3`,
    targetPaletteIndices: paletteIndices,
    triangleCount: 10,
    linearRgbError: 0,
  };
}

function planWithGaps(): { plan: VirtualExtruderPlan; palette: PaletteEntry[] } {
  // Virtual ids 6, 7, 9, 13, 14, 15 (the gap pattern from the work order) plus
  // one physical-only palette colour on E2 and one unused virtual (id 8).
  const paletteColours: RGB[] = [
    [255, 200, 200], [200, 255, 200], [200, 200, 255], [255, 255, 200], [200, 255, 255], [255, 200, 255], [0, 0, 0],
  ];
  const palette: PaletteEntry[] = paletteColours.map((rgb, i) => ({ index: i + 1, rgb, count: 10 }));
  const plan: VirtualExtruderPlan = {
    virtualBlends: [
      blend(6, paletteColours[0], [1]),
      blend(7, paletteColours[1], [2]),
      blend(8, [1, 2, 3], []), // merged away: no palette colour left
      blend(9, paletteColours[2], [3]),
      blend(13, paletteColours[3], [4]),
      blend(14, paletteColours[4], [5]),
      blend(15, paletteColours[5], [6]),
    ],
    physicalOnly: [
      {
        paletteIndex: 7,
        targetPaletteIndices: [7],
        targetRgb: [0, 0, 0],
        physicalRgb: [0, 0, 0],
        physicalExtruder: 2,
        triangleCount: 10,
        linearRgbError: 0,
      },
    ],
    mappingDiagnostics: {
      targetPaletteCount: 7,
      averageError: 0,
      worstError: 0,
      poorMatchCount: 0,
      poorMatchThreshold: 8,
      collapsedTargetColours: 0,
    },
    paletteToAssignment: new Map(),
  };
  return { plan, palette };
}

function modelForPalette(palette: PaletteEntry[], cols = 7, rows = 2): MeshModel {
  const grid = gridMesh(cols, rows);
  const triangleColors: RGB[] = grid.triangles.map((_t, i) => palette[i % palette.length].rgb);
  return {
    name: "typhoeus.obj",
    vertices: grid.vertices,
    triangles: grid.triangles,
    triangleColors,
    stats: {
      vertexCount: grid.vertices.length,
      triangleCount: grid.triangles.length,
      coloredVertexCount: grid.vertices.length,
      uniqueFaceColors: palette.length,
      objectFaceCounts: { grid: grid.triangles.length },
    },
  };
}

const stubEncoder = async (raster: ThumbnailRaster) => new Uint8Array([raster.width, raster.height]);

function exportOptions(overrides: Partial<Export3mfOptions> = {}): Export3mfOptions {
  const { plan, palette } = planWithGaps();
  const model = modelForPalette(palette);
  return {
    fileName: "typhoeus_XL_ready",
    model,
    adjustedColors: model.triangleColors,
    palette,
    physicalSlots: PHYSICAL,
    virtualPlan: plan,
    placement: {
      coordinateMode: "keep",
      scale: 1,
      putOnBed: false,
      centerOnBed: false,
      bedSource: "custom",
      customBedSize: { x: 360, y: 360 },
      fallbackBedSize: { x: 250, y: 210 },
      defaultExtruder: 1,
    },
    accentProtection: "off",
    thumbnailEncoder: stubEncoder,
    ...overrides,
  };
}

async function readZip(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
}

describe("D-1 contiguous virtual extruder ids", () => {
  it("renumbers used virtual extruders from physical count + 1 and drops unused ones", () => {
    const { plan } = planWithGaps();
    const result = buildExportAssignments(plan, 5);
    expect(result.virtuals.map((v) => v.id)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(result.virtuals.map((v) => v.sourceId)).toEqual([6, 7, 9, 13, 14, 15]);
    expect(result.virtualIdRemap.get(9)).toBe(8);
    expect(result.virtualIdRemap.get(15)).toBe(11);
    expect(result.virtualIdRemap.has(8)).toBe(false);
    // Palette 3 was VE9 -> now VE8 -> paint code "5C".
    expect(result.paletteToPaintCode.get(3)).toBe("5C");
    expect(decodePaintCode(result.paletteToPaintCode.get(7)!)).toBe(2);
  });

  it("drops a virtual extruder whose palette colour no triangle maps to", async () => {
    // Palette #4 (VE13) is a real palette entry, but every triangle maps elsewhere.
    const { plan } = planWithGaps();
    const usedByTriangles = new Set([1, 2, 3, 5, 6, 7]);
    const assignments = buildExportAssignments(plan, 5, usedByTriangles);
    expect(assignments.droppedVirtuals).toEqual([13]);
    expect(assignments.virtuals.map((v) => v.sourceId)).toEqual([6, 7, 9, 14, 15]);
    expect(assignments.virtuals.map((v) => v.id)).toEqual([6, 7, 8, 9, 10]);
    expect(assignments.paletteToPaintCode.has(4)).toBe(false);

    // End to end: recolour the faces of palette #4 so nothing uses it; the export
    // must succeed instead of failing validation with an unused JSON entry.
    const base = exportOptions();
    const adjustedColors = base.adjustedColors.map((rgb) => (rgb.join(",") === base.palette[3].rgb.join(",") ? base.palette[0].rgb : rgb));
    const result = await buildPrusa3mfBlob({ ...base, adjustedColors });
    expect(result.summary.droppedVirtuals).toEqual([13]);
    expect(result.summary.virtualIds).toEqual([6, 7, 8, 9, 10]);
    const zip = await readZip(result.blob);
    const json = JSON.parse(await zip.file("Metadata/Prusa_Slicer_full_spectrum.json")!.async("text"));
    expect(json.virtual_extruders.map((v: { id: number }) => v.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it("writes the same ids into mmu_segmentation and full_spectrum.json", async () => {
    const result = await buildPrusa3mfBlob(exportOptions());
    expect(result.summary.virtualIds).toEqual([6, 7, 8, 9, 10, 11]);
    expect(result.summary.renumberedVirtuals).toEqual([
      { from: 9, to: 8 },
      { from: 13, to: 9 },
      { from: 14, to: 10 },
      { from: 15, to: 11 },
    ]);
    const zip = await readZip(result.blob);
    const json = JSON.parse(await zip.file("Metadata/Prusa_Slicer_full_spectrum.json")!.async("text"));
    const jsonIds = json.virtual_extruders.map((v: { id: number }) => v.id);
    expect(jsonIds).toEqual([6, 7, 8, 9, 10, 11]);
    expect(json.physical_extruders.map((p: { id: number }) => p.id)).toEqual([1, 2, 3, 4, 5]);

    const modelXml = await zip.file("3D/3dmodel.model")!.async("text");
    const codes = [...modelXml.matchAll(/slic3rpe:mmu_segmentation="([0-9A-F]*)"/g)].map((m) => m[1]);
    expect(codes.length).toBe(exportOptions().model.triangles.length);
    const states = new Set(codes.map((code) => decodePaintCode(code)));
    const virtualStates = [...states].filter((s) => s > 5).sort((a, b) => a - b);
    expect(virtualStates).toEqual(jsonIds);
    expect([...states].filter((s) => s <= 5)).toEqual([2]);
  });
});

describe("D-2 printer config", () => {
  it("does not write Metadata/Slic3r_PE.config by default", async () => {
    const result = await buildPrusa3mfBlob(exportOptions());
    const zip = await readZip(result.blob);
    expect(zip.file("Metadata/Slic3r_PE.config")).toBeNull();
    expect(result.summary.printerConfigIncluded).toBe(false);
    for (const path of [
      "3D/3dmodel.model",
      "Metadata/Slic3r_PE_model.config",
      "Metadata/Prusa_Slicer_full_spectrum.json",
      "Metadata/Prusa_Slicer_wipe_tower_information.xml",
      "Metadata/thumbnail.png",
      "[Content_Types].xml",
      "_rels/.rels",
    ]) {
      expect(zip.file(path), path).not.toBeNull();
    }
  });

  it("copies the template config only when explicitly requested", async () => {
    const template = new JSZip();
    template.file("Metadata/Slic3r_PE.config", "; extruders_count = 5\n; filament_colour = #FFFFFF;#000000;#FF0000;#0000FF;#FFFF00\n");
    const templateArrayBuffer = (await template.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;

    const withoutFlag = await buildPrusa3mfBlob(exportOptions({ templateArrayBuffer }));
    expect((await readZip(withoutFlag.blob)).file("Metadata/Slic3r_PE.config")).toBeNull();

    const withFlag = await buildPrusa3mfBlob(exportOptions({ templateArrayBuffer, includePrinterConfig: true }));
    const zip = await readZip(withFlag.blob);
    expect(withFlag.summary.printerConfigIncluded).toBe(true);
    const config = await zip.file("Metadata/Slic3r_PE.config")!.async("text");
    expect(config).toContain("extruders_count");
  });

  it("keeps the template's printer kind (tool changer vs MMU)", async () => {
    const configFor = async (semm: string) => {
      const template = new JSZip();
      template.file(
        "Metadata/Slic3r_PE.config",
        `; extruders_count = 5\n; single_extruder_multi_material = ${semm}\n; ooze_prevention = 1\n; wipe_tower = 1\n; filament_colour = #FFFFFF;#000000;#FF0000;#0000FF;#FFFF00\n`,
      );
      const templateArrayBuffer = (await template.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;
      const result = await buildPrusa3mfBlob(exportOptions({ templateArrayBuffer, includePrinterConfig: true }));
      return (await readZip(result.blob)).file("Metadata/Slic3r_PE.config")!.async("text");
    };
    // Prusa XL: ooze prevention + SEMM=1 is rejected by PrusaSlicer, so 0 must survive.
    expect(await configFor("0")).toMatch(/^; single_extruder_multi_material = 0$/m);
    expect(await configFor("1")).toMatch(/^; single_extruder_multi_material = 1$/m);
    // A template without the key gets none invented either.
    const bare = new JSZip();
    bare.file("Metadata/Slic3r_PE.config", "; extruders_count = 5\n");
    const bareBuffer = (await bare.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;
    const bareResult = await buildPrusa3mfBlob(exportOptions({ templateArrayBuffer: bareBuffer, includePrinterConfig: true }));
    expect(await (await readZip(bareResult.blob)).file("Metadata/Slic3r_PE.config")!.async("text")).not.toContain("single_extruder_multi_material");
  });

  it("never invents a config when no template is loaded", async () => {
    const result = await buildPrusa3mfBlob(exportOptions({ includePrinterConfig: true }));
    expect((await readZip(result.blob)).file("Metadata/Slic3r_PE.config")).toBeNull();
    expect(result.summary.printerConfigIncluded).toBe(false);
  });
});

describe("D-3 validation", () => {
  it("accepts a consistent export", () => {
    expect(
      validateExportAssignments({
        physicalExtruderCount: 5,
        virtuals: [{ id: 6 }, { id: 7 }],
        usedPaintStates: [1, 6, 7],
      }),
    ).toEqual([]);
  });

  it("reports gaps, missing JSON entries, unused virtuals, unpainted faces and the 255 limit", () => {
    const failures = validateExportAssignments({
      physicalExtruderCount: 5,
      virtuals: [{ id: 6 }, { id: 8 }],
      usedPaintStates: [0, 6, 9],
    });
    expect(failures.join("\n")).toMatch(/contiguous/);
    expect(failures.join("\n")).toMatch(/Painted virtual states 9/);
    expect(failures.join("\n")).toMatch(/Virtual extruders 8 are defined/);
    expect(failures.join("\n")).toMatch(/Unpainted triangles/);

    const justEnough = validateExportAssignments({
      physicalExtruderCount: 5,
      virtuals: Array.from({ length: 250 }, (_v, i) => ({ id: 6 + i })),
      usedPaintStates: Array.from({ length: 250 }, (_v, i) => 6 + i),
    });
    expect(justEnough).toEqual([]);
    const tooMany = validateExportAssignments({
      physicalExtruderCount: 5,
      virtuals: Array.from({ length: 251 }, (_v, i) => ({ id: 6 + i })),
      usedPaintStates: Array.from({ length: 251 }, (_v, i) => 6 + i),
    });
    expect(tooMany.join("\n")).toMatch(/at most 255/);
  });

  it("refuses to export more than 255 physical + virtual extruders", async () => {
    const { palette } = planWithGaps();
    const extraPalette: PaletteEntry[] = Array.from({ length: 251 }, (_v, i) => ({
      index: i + 1,
      rgb: [i % 256, (i * 7) % 256, (i * 13) % 256] as RGB,
      count: 5,
    }));
    const plan: VirtualExtruderPlan = {
      virtualBlends: extraPalette.map((entry, i) => blend(6 + i, entry.rgb, [entry.index])),
      physicalOnly: [],
      mappingDiagnostics: { targetPaletteCount: 251, averageError: 0, worstError: 0, poorMatchCount: 0, poorMatchThreshold: 8, collapsedTargetColours: 0 },
      paletteToAssignment: new Map(),
    };
    const model = modelForPalette(extraPalette, 126, 2);
    await expect(
      buildPrusa3mfBlob(exportOptions({ virtualPlan: plan, palette: extraPalette, model, adjustedColors: model.triangleColors })),
    ).rejects.toThrow(/at most 255|limit \(255\)/);
    expect(palette.length).toBe(7);
  });

  it("exports ids above 16 with the 14-bit paint codes and painting version 2", async () => {
    const { palette } = planWithGaps();
    const bigPalette: PaletteEntry[] = Array.from({ length: 20 }, (_v, i) => ({
      index: i + 1,
      rgb: [i * 12, 90, 220 - i * 9] as RGB,
      count: 5,
    }));
    const plan: VirtualExtruderPlan = {
      virtualBlends: bigPalette.map((entry, i) => blend(6 + i, entry.rgb, [entry.index])),
      physicalOnly: [],
      mappingDiagnostics: { targetPaletteCount: 20, averageError: 0, worstError: 0, poorMatchCount: 0, poorMatchThreshold: 8, collapsedTargetColours: 0 },
      paletteToAssignment: new Map(),
    };
    const model = modelForPalette(bigPalette);
    const result = await buildPrusa3mfBlob(exportOptions({ virtualPlan: plan, palette: bigPalette, model, adjustedColors: model.triangleColors }));
    expect(result.summary.virtualIds).toEqual(Array.from({ length: 20 }, (_v, i) => 6 + i));
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const xml = await zip.file("3D/3dmodel.model")!.async("text");
    expect(xml).toContain('<metadata name="slic3rpe:MmPaintingVersion">2</metadata>');
    expect(xml).toContain('slic3rpe:mmu_segmentation="DC"'); // id 16
    expect(xml).toContain('slic3rpe:mmu_segmentation="00EC"'); // id 17
    expect(xml).toContain('slic3rpe:mmu_segmentation="08EC"'); // id 25
    expect(palette.length).toBe(7);
  });

  it("refuses physical extruders outside 1..n_physical", async () => {
    const { plan } = planWithGaps();
    plan.physicalOnly[0].physicalExtruder = 7;
    await expect(buildPrusa3mfBlob(exportOptions({ virtualPlan: plan }))).rejects.toThrow(/outside 1\.\.5/);
  });
});

describe("D-4 thumbnail", () => {
  it("renders the effective (post-merge) colour of each palette index", () => {
    // One square facing the front camera exactly (normal along -Y).
    const vertices = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 10],
      [0, 0, 10],
    ] as MeshModel["vertices"];
    const triangles = [
      [0, 1, 2],
      [0, 2, 3],
    ] as MeshModel["triangles"];
    const effective: RGB = [10, 200, 30];
    const raster = renderModelThumbnail({ vertices, triangles }, () => effective, { width: 64, height: 64, view: "front" });
    const centre = (32 * 64 + 32) * 4;
    expect([raster.data[centre], raster.data[centre + 1], raster.data[centre + 2]]).toEqual([10, 200, 30]);
    // Corner stays background.
    expect(raster.data[0]).toBe(178);
  });

  it("passes the effective colour map into the export thumbnail", async () => {
    let seen: ThumbnailRaster | null = null;
    const effective = new Map<number, RGB>();
    for (let i = 1; i <= 7; i++) effective.set(i, [7, 7, 7]);
    await buildPrusa3mfBlob(
      exportOptions({
        effectiveRgbByPaletteIndex: effective,
        thumbnailEncoder: async (raster) => {
          seen = raster;
          return new Uint8Array(1);
        },
      }),
    );
    expect(seen).not.toBeNull();
    const raster = seen as unknown as ThumbnailRaster;
    expect(raster.width).toBe(768);
    // Every model pixel is a shade of the single effective grey (r == g == b),
    // never one of the pastel palette colours.
    let modelPixels = 0;
    for (let i = 0; i < raster.data.length; i += 4) {
      const [r, g, b] = [raster.data[i], raster.data[i + 1], raster.data[i + 2]];
      if (r === 178 && g === 178 && b === 178) continue;
      modelPixels++;
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
    expect(modelPixels).toBeGreaterThan(0);
  });
});

describe("split to objects", () => {
  /** Two identical grids that share no vertex: one model, two shells. */
  function twoShellOptions(splitObjects: boolean): Export3mfOptions {
    const base = exportOptions();
    const model = base.model as MeshModel;
    const shift = 100;
    const vertexCount = model.vertices.length;
    const doubled: MeshModel = {
      ...model,
      vertices: [
        ...model.vertices,
        ...model.vertices.map(([x, y, z]) => [x + shift, y, z] as [number, number, number]),
      ],
      triangles: [
        ...model.triangles,
        ...model.triangles.map(
          (tri) => [tri[0] + vertexCount, tri[1] + vertexCount, tri[2] + vertexCount] as [number, number, number],
        ),
      ],
      triangleColors: [...model.triangleColors, ...model.triangleColors],
    };
    return {
      ...base,
      model: doubled,
      adjustedColors: doubled.triangleColors,
      splitObjects,
    };
  }

  it("writes one object per shell and keeps every triangle's paint", async () => {
    const whole = await buildPrusa3mfBlob(twoShellOptions(false));
    const split = await buildPrusa3mfBlob(twoShellOptions(true));
    const wholeXml = await (await readZip(whole.blob)).file("3D/3dmodel.model")!.async("text");
    const splitXml = await (await readZip(split.blob)).file("3D/3dmodel.model")!.async("text");

    expect(whole.summary.objectCount).toBe(1);
    expect(split.summary.objectCount).toBe(2);
    expect((splitXml.match(/<object id="/g) ?? []).length).toBe(2);
    expect((splitXml.match(/<item objectid="/g) ?? []).length).toBe(2);
    // Both pieces keep the single shared placement, so nothing moves.
    expect([...splitXml.matchAll(/<item objectid="\d+" transform="([^"]+)"/g)].map((m) => m[1])).toEqual([
      whole.summary.transform,
      whole.summary.transform,
    ]);

    const paint = (xml: string) =>
      [...xml.matchAll(/mmu_segmentation="([^"]+)"/g)].map((m) => m[1]);
    // Same triangles, same paint codes, only regrouped and renumbered.
    expect(paint(splitXml).slice().sort()).toEqual(paint(wholeXml).slice().sort());
    expect(paint(splitXml).length).toBe((twoShellOptions(true).model as MeshModel).triangles.length);
  });

  it("renumbers each object's triangles into its own vertex list", async () => {
    const split = await buildPrusa3mfBlob(twoShellOptions(true));
    const xml = await (await readZip(split.blob)).file("3D/3dmodel.model")!.async("text");
    for (const object of xml.split('<object id="').slice(1)) {
      const vertexCount = (object.match(/<vertex /g) ?? []).length;
      const indices = [...object.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].flatMap((m) =>
        [Number(m[1]), Number(m[2]), Number(m[3])],
      );
      expect(Math.min(...indices)).toBe(0);
      expect(Math.max(...indices)).toBe(vertexCount - 1);
    }
  });

  it("as parts: one object, a volume per shell over its own triangles, every triangle's paint kept", async () => {
    const whole = await buildPrusa3mfBlob(twoShellOptions(false));
    const parts = await buildPrusa3mfBlob({ ...twoShellOptions(true), splitAsParts: true });
    const zip = await readZip(parts.blob);
    const xml = await zip.file("3D/3dmodel.model")!.async("text");
    const config = await zip.file("Metadata/Slic3r_PE_model.config")!.async("text");
    const wholeXml = await (await readZip(whole.blob)).file("3D/3dmodel.model")!.async("text");
    expect(parts.summary.objectCount).toBe(1);
    expect(parts.summary.partCount).toBe(2);
    expect((xml.match(/<object id="/g) ?? []).length).toBe(1);
    expect((xml.match(/<item objectid="/g) ?? []).length).toBe(1);
    expect((config.match(/<object id="/g) ?? []).length).toBe(1);
    // Two volumes, back to back over the one mesh's triangles.
    const ranges = [...config.matchAll(/<volume firstid="(\d+)" lastid="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const triangles = (xml.match(/<triangle /g) ?? []).length;
    expect(ranges.length).toBe(2);
    expect(ranges[0][0]).toBe(0);
    expect(ranges[1][0]).toBe(ranges[0][1] + 1);
    expect(ranges[1][1]).toBe(triangles - 1);
    expect(ranges[0][1] + 1).toBe(triangles / 2);
    const paint = (text: string) => [...text.matchAll(/mmu_segmentation="([^"]+)"/g)].map((m) => m[1]);
    expect(paint(xml).slice().sort()).toEqual(paint(wholeXml).slice().sort());
    // Every vertex the triangles use is written once, numbered from 0.
    const vertexCount = (xml.match(/<vertex /g) ?? []).length;
    const indices = [...xml.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(Math.max(...indices)).toBe(vertexCount - 1);
  });

  it("as parts does nothing without the split: one object, one part", async () => {
    const whole = await buildPrusa3mfBlob({ ...twoShellOptions(false), splitAsParts: true });
    const config = await (await readZip(whole.blob)).file("Metadata/Slic3r_PE_model.config")!.async("text");
    expect(whole.summary.objectCount).toBe(1);
    expect(whole.summary.partCount).toBe(1);
    expect((config.match(/<volume /g) ?? []).length).toBe(1);
  });

  it("gives every object its own entry in Slic3r_PE_model.config", async () => {
    const split = await buildPrusa3mfBlob(twoShellOptions(true));
    const zip = await readZip(split.blob);
    const config = await zip.file("Metadata/Slic3r_PE_model.config")!.async("text");
    const xml = await zip.file("3D/3dmodel.model")!.async("text");
    expect((config.match(/<object id="/g) ?? []).length).toBe(2);
    // Each volume covers its own object's triangles, counted from 0.
    const lastIds = [...config.matchAll(/lastid="(\d+)"/g)].map((m) => Number(m[1]));
    const faceCounts = xml
      .split('<object id="')
      .slice(1)
      .map((object) => (object.match(/<triangle /g) ?? []).length);
    expect(lastIds).toEqual(faceCounts.map((count) => count - 1));
  });
});

describe("orientation", () => {
  /** A mesh that is long along X and flat in Z: a figure lying on its side. */
  function lyingDownOptions(coordinateMode: Export3mfOptions["placement"]["coordinateMode"]): Export3mfOptions {
    const base = exportOptions();
    const model = base.model as MeshModel;
    const stretched: MeshModel = {
      ...model,
      vertices: model.vertices.map(([x, y, z]) => [x * 4, y * 2, z] as [number, number, number]),
    };
    return {
      ...base,
      model: stretched,
      placement: { ...base.placement, coordinateMode, targetHeight: 40 },
    };
  }

  it("stands the longest axis up and scales to the target height on it", async () => {
    const result = await buildPrusa3mfBlob(lyingDownOptions("stand-up"));
    const xml = await (await readZip(result.blob)).file("3D/3dmodel.model")!.async("text");
    const transform = /<item objectid="1" transform="([^"]+)"/.exec(xml)![1].split(" ").map(Number);
    // Read as the 3MF spec does, the first three numbers are where the mesh's X
    // goes: it becomes the printed height (the figure stands on its +X end).
    // The written matrix is rounded for the file; compare to that precision.
    const scale = Number(result.summary.scale.toFixed(9));
    expect(transform.slice(0, 3)).toEqual([0, 0, -scale]);
    expect(transform.slice(6, 9)).toEqual([scale, 0, 0]);
    expect(result.summary.coordinateMode).toBe("x-up");
  });

  it("leaves a mesh alone when told to keep it", async () => {
    const result = await buildPrusa3mfBlob(lyingDownOptions("keep"));
    const xml = await (await readZip(result.blob)).file("3D/3dmodel.model")!.async("text");
    const transform = /<item objectid="1" transform="([^"]+)"/.exec(xml)![1].split(" ").map(Number);
    const scale = Number(result.summary.scale.toFixed(9));
    expect(transform.slice(0, 9)).toEqual([scale, 0, 0, 0, scale, 0, 0, 0, scale]);
  });
});

describe("putting a face on the bed", () => {
  /** Outward direction of each named face, in the model's own axes. */
  const FACE_NORMALS: Record<string, [number, number, number]> = {
    "face-front": [0, -1, 0],
    "face-back": [0, 1, 0],
    "face-left": [-1, 0, 0],
    "face-right": [1, 0, 0],
    "face-top": [0, 0, 1],
    "face-bottom": [0, 0, -1],
  };

  it("turns the chosen face downwards, and keeps the mesh un-mirrored", () => {
    for (const [mode, normal] of Object.entries(FACE_NORMALS)) {
      const down = transformNoTranslation(normal, mode as never, 1);
      // The face that was looked at now points at the bed.
      expect(down[2]).toBeCloseTo(-1, 6);
      // A rotation, not a reflection: the three axes stay right-handed.
      const x = transformNoTranslation([1, 0, 0], mode as never, 1);
      const y = transformNoTranslation([0, 1, 0], mode as never, 1);
      const z = transformNoTranslation([0, 0, 1], mode as never, 1);
      const determinant =
        x[0] * (y[1] * z[2] - y[2] * z[1]) -
        x[1] * (y[0] * z[2] - y[2] * z[0]) +
        x[2] * (y[0] * z[1] - y[1] * z[0]);
      expect(determinant).toBeCloseTo(1, 6);
    }
  });
});

describe("Bambu-family slicers", () => {
  function physicalOnlyPlan(palette: PaletteEntry[]): VirtualExtruderPlan {
    const { plan } = planWithGaps();
    return {
      ...plan,
      virtualBlends: [],
      physicalOnly: palette.map((entry, i) => ({
        paletteIndex: entry.index,
        targetPaletteIndices: [entry.index],
        targetRgb: entry.rgb,
        physicalRgb: entry.rgb,
        physicalExtruder: (i % 5) + 1,
        triangleCount: 10,
        linearRgbError: 0,
      })),
    };
  }

  it("writes paint_color next to the Prusa attribute, with the same code, and no Prusa-only files", async () => {
    const { palette } = planWithGaps();
    const result = await buildPrusa3mfBlob(exportOptions({ slicer: "bambu", virtualPlan: physicalOnlyPlan(palette) }));
    const zip = await readZip(result.blob);
    const xml = await zip.file("3D/3dmodel.model")!.async("text");
    const pairs = [...xml.matchAll(/paint_color="([0-9A-F]+)" slic3rpe:mmu_segmentation="([0-9A-F]+)"/g)];
    expect(pairs.length).toBe(exportOptions().model.triangles.length);
    expect(pairs.every((m) => m[1] === m[2])).toBe(true);
    expect(new Set(pairs.map((m) => decodePaintCode(m[1])))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(xml).toMatch(/<object id="1" name="typhoeus_XL_ready" type="model">/);
    expect(zip.file("Metadata/Prusa_Slicer_full_spectrum.json")).toBeNull();
    expect(zip.file("Metadata/Slic3r_PE.config")).toBeNull();
  });

  it("the Prusa file keeps its own attribute only", async () => {
    const result = await buildPrusa3mfBlob(exportOptions());
    const xml = await (await readZip(result.blob)).file("3D/3dmodel.model")!.async("text");
    expect(xml).not.toContain("paint_color=");
  });

  it("writes a Bambu Studio project, with the mixes as mixed filaments after the real ones", async () => {
    const result = await buildPrusa3mfBlob(exportOptions({ slicer: "bambu", bambuPrinter: "x1c" }));
    const zip = await readZip(result.blob);
    const main = await zip.file("3D/3dmodel.model")!.async("text");
    expect(main).toMatch(/<metadata name="Application">BambuStudio-\d/);
    expect(main).toContain('p:path="/3D/Objects/object_1.model"');
    const mesh = await zip.file("3D/Objects/object_1.model")!.async("text");
    expect(mesh).not.toContain("slic3rpe");
    const states = new Set([...mesh.matchAll(/paint_color="([0-9A-F]+)"/g)].map((m) => decodePaintCode(m[1])));
    // 5 real filaments, then the 6 used mixes renumbered 6..11; E2 is the one physical-only colour.
    expect(states).toEqual(new Set([2, 6, 7, 8, 9, 10, 11]));

    const config = JSON.parse(await zip.file("Metadata/project_settings.config")!.async("text"));
    expect(config.printer_settings_id).toBe("Bambu Lab X1 Carbon 0.4 nozzle");
    expect(config.filament_colour).toEqual(["#FFFFFF", "#000000", "#FF0000", "#0000FF", "#FFFF00", ...Array(6).fill(expect.stringMatching(/^#[0-9A-F]{6}$/))]);
    expect(config.filament_is_mixed).toEqual([...Array(5).fill("0"), ...Array(6).fill("1")]);
    expect(config.filament_mixed_components.slice(5)).toEqual(Array(6).fill("1,3"));
    expect(config.filament_mixed_sublayer_ratios.slice(5)).toEqual(Array(6).fill("0.5000,0.5000"));
    expect(config.filament_self_index).toEqual(Array.from({ length: 11 }, (_v, i) => String(i + 1)));
    expect(config.filament_settings_id).toEqual(Array(11).fill("Bambu PLA Basic @BBL X1C"));
    expect(config.inherits_group).toHaveLength(13);
    expect(config.flush_volumes_matrix).toHaveLength(121);
    expect(config.enable_mixed_color_sublayer).toBe("0");
    expect(result.summary.bambuMixedFilaments).toBe(6);
    expect(zip.file("Metadata/model_settings.config")).not.toBeNull();
    expect(zip.file("Metadata/plate_1.png")).not.toBeNull();
  });

  it("writes a Korean name composed (NFC): decomposed letters showed as ???? in Bambu Studio (11-10)", async () => {
    const decomposed = "무대 커튼".normalize("NFD");
    const { plan, palette } = planWithGaps();
    const model = { ...modelForPalette(palette), name: `${decomposed}.3mf` };
    const jamo = /[ᄀ-ᇿ]/;
    const prusa = await readZip((await buildPrusa3mfBlob(exportOptions({ model, adjustedColors: model.triangleColors, virtualPlan: plan, palette, fileName: `${decomposed}_colormix` }))).blob);
    const prusaXml = await prusa.file("3D/3dmodel.model")!.async("text");
    expect(prusaXml).toContain("무대 커튼");
    expect(jamo.test(prusaXml)).toBe(false);
    const bambu = await readZip(
      (await buildPrusa3mfBlob(exportOptions({ slicer: "bambu", bambuPrinter: "h2d", model, adjustedColors: model.triangleColors, virtualPlan: plan, palette, fileName: `${decomposed}_colormix` }))).blob,
    );
    for (const path of ["3D/3dmodel.model", "Metadata/model_settings.config"]) {
      const text = await bambu.file(path)!.async("text");
      expect(text).toContain("무대 커튼");
      expect(jamo.test(text)).toBe(false);
    }
  });

  it("a two-nozzle Bambu printer gets a flush matrix per nozzle", async () => {
    const result = await buildPrusa3mfBlob(exportOptions({ slicer: "bambu", bambuPrinter: "h2d" }));
    const config = JSON.parse(await (await readZip(result.blob)).file("Metadata/project_settings.config")!.async("text"));
    expect(config.flush_volumes_matrix).toHaveLength(2 * 11 * 11);
  });

  it("flags a mix that uses a filament past the last slot (fewer slots, smaller printer)", () => {
    expect(
      validateExportAssignments({ physicalExtruderCount: 4, virtuals: [{ id: 5, components: [{ extruder: 1 }, { extruder: 5 }] }], usedPaintStates: [1, 5] }),
    ).toEqual([expect.stringMatching(/Virtual extruder 5 mixes filament E5, outside 1\.\.4/)]);
  });

  it("checks mixed filaments the way Bambu Studio does", async () => {
    const { validateBambuMixedSlots } = await import("../bambuProject");
    expect(validateBambuMixedSlots(4, [{ components: [1, 2], ratios: [0.5, 0.5], colour: "#808080" }])).toEqual([]);
    expect(validateBambuMixedSlots(4, [{ components: [1], ratios: [1], colour: "#808080" }])).toEqual([expect.stringMatching(/at least 2/)]);
    expect(validateBambuMixedSlots(4, [{ components: [1, 5], ratios: [0.5, 0.5], colour: "#808080" }])).toEqual([expect.stringMatching(/physical filaments 1–4/)]);
    const many = Array.from({ length: 29 }, () => ({ components: [1, 2], ratios: [0.5, 0.5], colour: "#808080" }));
    expect(validateBambuMixedSlots(4, many)).toEqual([expect.stringMatching(/at most 32/)]);
  });

  it("refuses layer mixes, which those slicers cannot print", async () => {
    await expect(buildPrusa3mfBlob(exportOptions({ slicer: "bambu" }))).rejects.toThrow(/no layer mixing/);
    expect(
      validateExportAssignments({ physicalExtruderCount: 5, virtuals: [{ id: 6 }], usedPaintStates: [1, 6], layerMixing: false }),
    ).toEqual([expect.stringMatching(/no layer mixing, but 1 colours are mixes/)]);
  });
});
