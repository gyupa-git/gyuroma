import JSZip from "jszip";
import type {
  AccentProtectionMode,
  MeshModel,
  PaletteEntry,
  PhysicalSlot,
  RGB,
  Tri,
  Vec3,
} from "./types";
import { nearestPaletteIndex } from "./quantize";
import { rgbToHex } from "./colour";
import type { Template3mfInfo } from "./template3mf";
import type {
  VirtualExtruderPlan,
  VirtualBlendEntry,
} from "./virtualExtruders";
import {
  decodePaintCode,
  encodePaintCode,
  MAX_PAINTABLE_EXTRUDER_ID,
} from "./paintCodes";
import { splitMeshComponents, type MeshComponent } from "./splitComponents";
// Type only: the Bambu Studio module (and its printer data) is loaded when a Bambu project is written.
import type { BambuMixedSlot, BambuProjectObject } from "./bambuProject";
import { applyPrintPresetToConfig, findPrintPreset, type PrintPresetId } from "./printPresets";
import {
  rasterToPngBytes,
  renderModelThumbnail,
  type ThumbnailRaster,
} from "./modelThumbnail";
import {
  turn3mfEntries,
  turnPoint,
  turnRows,
  type ExportCoordinateMode,
  type FixedCoordinateMode,
} from "./orientation";

/**
 * How the mesh is turned before it is placed on the bed (orientation.ts).
 * "stand-up" puts the model's longest axis vertical, which is what a figure
 * sculpted lying down needs; "auto" only catches the Blender/Nomad Y-up
 * convention.
 */
export type { ExportCoordinateMode, FixedCoordinateMode };
export type ExportBedSource = "template" | "custom";

export interface ExportPlacementOptions {
  coordinateMode: ExportCoordinateMode;
  scale: number;
  targetHeight?: number | null;
  putOnBed: boolean;
  centerOnBed: boolean;
  bedSource: ExportBedSource;
  customBedSize: { x: number; y: number };
  fallbackBedSize: { x: number; y: number };
  defaultExtruder: number;
}

/**
 * Which slicer family opens the file.  PrusaSlicer reads the painting from
 * `slic3rpe:mmu_segmentation`; Bambu Studio, OrcaSlicer and their forks
 * (Creality Print, ElegooSlicer, QIDI Studio, Snapmaker Orca, Anycubic Slicer
 * Next …) read `paint_color` and ignore the Prusa attribute, so a Prusa-only
 * file opens there in one colour.  Both use the same code per filament
 * (checked by slicing with Bambu Studio 2.8 and ElegooSlicer 1.5).
 */
export type SlicerTarget = "prusa" | "bambu";

export interface Export3mfOptions {
  fileName: string;
  /** Default "prusa". "bambu" writes both paint attributes and no layer mixes. */
  slicer?: SlicerTarget;
  /**
   * With slicer "bambu": the Bambu Studio printer (a key of
   * bambu/projectTemplates.json).  The file is then a whole Bambu Studio
   * project, so the colour mixes go in as Bambu Studio 2.8 mixed filaments.
   */
  bambuPrinter?: string;
  templateArrayBuffer?: ArrayBuffer | null;
  templateInfo?: Template3mfInfo | null;
  model: MeshModel;
  adjustedColors: RGB[];
  palette: PaletteEntry[];
  physicalSlots: PhysicalSlot[];
  virtualPlan: VirtualExtruderPlan;
  placement: ExportPlacementOptions;
  updateExtruderColour?: boolean;
  accentProtection?: AccentProtectionMode;
  /**
   * Print quality preset applied to the template's printer config on the way
   * out: layer height, speeds and solid layers, taken from PrusaSlicer's own
   * XL profiles.  Support tuning in the template is left alone.
   */
  printPreset?: PrintPresetId | null;
  /**
   * The word after the template's own preset name in the renamed print
   * preset ("0.20mm SPEED (… support)"); PrusaSlicer shows it, so an app says
   * it in its UI's language.  Default "support".
   */
  printPresetSupportWord?: string;
  /**
   * Write each connected shell as its own 3MF object so that pieces can be
   * laid down separately in PrusaSlicer.  Splitting inside PrusaSlicer would
   * delete the multi-material painting, so the split has to happen here.
   */
  splitObjects?: boolean;
  /**
   * D-2: Metadata/Slic3r_PE.config is omitted by default so that the printer
   * profile selected in PrusaSlicer stays untouched.  Set to true to copy the
   * (slot-extended) config from the loaded 3MF template instead.
   */
  includePrinterConfig?: boolean;
  /**
   * D-4: colour per palette index as it will be printed (virtual blend or
   * physical filament).  Used for the thumbnail so that it matches the slicer.
   */
  effectiveRgbByPaletteIndex?: Map<number, RGB>;
  /** Test hook: replaces the canvas based PNG encoder. */
  thumbnailEncoder?: (raster: ThumbnailRaster) => Promise<Uint8Array>;
}

export interface ExportVirtualDefinition {
  id: number;
  /** Virtual id before the contiguous renumbering (D-1). */
  sourceId: number;
  color: string;
  components: Array<{ extruder: number; ratio: number }>;
  paletteIndices: number[];
}

export interface ExportAssignments {
  virtuals: ExportVirtualDefinition[];
  paletteToPaintCode: Map<number, string>;
  /** Old virtual id -> exported virtual id. */
  virtualIdRemap: Map<number, number>;
  physicalExtruderCount: number;
  /** Source virtual ids left out because no triangle maps to any of their palette colours. */
  droppedVirtuals: number[];
}

export interface ExportValidationInput {
  physicalExtruderCount: number;
  virtuals: Array<{ id: number; components?: Array<{ extruder: number }> }>;
  /** Decoded paint states of every exported triangle. */
  usedPaintStates: Iterable<number>;
  /** False when the slicer has no layer mixing (virtual extruders); default true. */
  layerMixing?: boolean;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(9)).toString();
}

function sanitise3mfName(name: string): string {
  const trimmed = name.trim() || "vertexcolor2colormix_export.3mf";
  return trimmed.toLowerCase().endsWith(".3mf") ? trimmed : `${trimmed}.3mf`;
}

function titleFromFilename(name: string): string {
  return sanitise3mfName(name).replace(/\.3mf$/i, "");
}

function modelBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name || "model";
}

function bounds(vertices: Vec3[]): { min: Vec3; max: Vec3; range: Vec3 } {
  const min: Vec3 = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: Vec3 = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const v of vertices) {
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  }
  return {
    min,
    max,
    range: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

/**
 * OBJ sources differ in their up-axis convention. Auto mode only applies the
 * Blender Y-up conversion when the model bounds strongly indicate that layout;
 * otherwise coordinates are preserved to avoid rotating already-correct models.
 */
export function resolveCoordinateMode(
  mode: ExportCoordinateMode,
  vertices: Vec3[],
): FixedCoordinateMode {
  if (mode !== "auto" && mode !== "stand-up") return mode;
  const b = bounds(vertices);
  const [rx, ry, rz] = b.range;
  if (mode === "stand-up") {
    // Tallest axis becomes Z. A figure sculpted on its side stands up.
    if (rx >= ry && rx >= rz) return "x-up";
    if (ry >= rx && ry >= rz) return "blender-y-up";
    return "keep";
  }
  return ry > Math.max(rx, rz) * 1.1 ? "blender-y-up" : "keep";
}

export function transformNoTranslation(
  v: Vec3,
  mode: FixedCoordinateMode,
  scale: number,
): Vec3 {
  return turnPoint(v, turnRows(mode), scale);
}

function transformedBounds(
  vertices: Vec3[],
  mode: FixedCoordinateMode,
  scale: number,
): { min: Vec3; max: Vec3; range: Vec3 } {
  const min: Vec3 = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: Vec3 = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const v of vertices) {
    const t = transformNoTranslation(v, mode, scale);
    for (let i = 0; i < 3; i++) {
      if (t[i] < min[i]) min[i] = t[i];
      if (t[i] > max[i]) max[i] = t[i];
    }
  }
  return {
    min,
    max,
    range: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function resolveScale(
  vertices: Vec3[],
  mode: FixedCoordinateMode,
  requestedScale: number,
  targetHeight?: number | null,
): number {
  const safeScale =
    Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
  if (!targetHeight || !Number.isFinite(targetHeight) || targetHeight <= 0)
    return safeScale;
  const b = transformedBounds(vertices, mode, 1);
  const zRange = Math.max(1e-9, b.range[2]);
  return targetHeight / zRange;
}

function matrixString(
  mode: FixedCoordinateMode,
  scale: number,
  tx: number,
  ty: number,
  tz: number,
): string {
  // The 3MF order (row vectors, orientation.ts), so the slicer places the mesh
  // where transformNoTranslation — the preview and the bounds — already has it.
  return [...turn3mfEntries(turnRows(mode), scale), tx, ty, tz].map(fmt).join(" ");
}

export function buildTransform(
  model: MeshModel,
  templateInfo: Template3mfInfo | null | undefined,
  placement: ExportPlacementOptions,
): {
  transform: string;
  resolvedMode: string;
  resolvedScale: number;
  bedSize?: { x: number; y: number };
} {
  const mode = resolveCoordinateMode(placement.coordinateMode, model.vertices);
  const scale = resolveScale(
    model.vertices,
    mode,
    placement.scale,
    placement.targetHeight,
  );
  const b = transformedBounds(model.vertices, mode, scale);
  let tx = 0;
  let ty = 0;
  let tz = 0;
  let bedSize: { x: number; y: number } | undefined;
  if (placement.centerOnBed) {
    if (placement.bedSource === "template" && templateInfo?.bedSize) {
      bedSize = templateInfo.bedSize;
    } else if (placement.bedSource === "custom") {
      bedSize = placement.customBedSize;
    } else {
      bedSize = placement.fallbackBedSize;
    }
    tx = bedSize.x / 2 - (b.min[0] + b.max[0]) / 2;
    ty = bedSize.y / 2 - (b.min[1] + b.max[1]) / 2;
  }
  if (placement.putOnBed) tz = -b.min[2];
  return {
    transform: matrixString(mode, scale, tx, ty, tz),
    resolvedMode: mode,
    resolvedScale: scale,
    bedSize,
  };
}

/**
 * PrusaSlicer mmu_segmentation paint codes are not plain extruder numbers
 * (see paintCodes.ts).  The same encoding is used for Full Spectrum virtual
 * extruder IDs, which follow directly after the physical extruders.
 */
export function prusaMmuPaintCode(extruderId: number): string {
  return encodePaintCode(extruderId);
}

// Backwards-compatible name for code that refers to virtual IDs only.
export const prusaMmuLeafCode = prusaMmuPaintCode;

function ratioFromComponentCount(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function virtualFromBlend(entry: VirtualBlendEntry): ExportVirtualDefinition {
  const total = Math.max(1, entry.sequence.length);
  return {
    id: entry.virtualId,
    sourceId: entry.virtualId,
    color: rgbToHex(entry.displayRgb),
    components: entry.components.map((component) => ({
      extruder: component.extruder,
      ratio: ratioFromComponentCount(component.count, total),
    })),
    paletteIndices: entry.targetPaletteIndices,
  };
}

/**
 * D-1: keep only the virtual extruders that are actually used and renumber
 * them contiguously from (physical extruder count + 1).  PrusaSlicer numbers
 * the Full Spectrum list by position, so gaps such as 6, 7, 9, 13 would shift
 * every colour after the first gap and push the highest ids onto extruder 1.
 * The same remap is applied to the mmu_segmentation codes and to the JSON ids.
 */
export function buildExportAssignments(
  plan: VirtualExtruderPlan,
  physicalExtruderCount: number,
  /**
   * Palette indices that at least one triangle maps to.  A palette colour can
   * end up with no triangles (median-cut centre that loses every member to a
   * neighbour under the accent-aware metric, or a colour painted away later);
   * its virtual extruder would then be defined in the JSON but never used,
   * which PrusaSlicer rejects.  Such virtuals are dropped and reported.
   */
  usedPaletteIndices?: ReadonlySet<number>,
): ExportAssignments {
  const physicalCount = Math.max(1, Math.round(physicalExtruderCount));
  const droppedVirtuals: number[] = [];
  const used = plan.virtualBlends
    .map(virtualFromBlend)
    .filter((entry) => entry.paletteIndices.length > 0) // merged away in the plan itself
    .map((entry) =>
      usedPaletteIndices
        ? { ...entry, paletteIndices: entry.paletteIndices.filter((index) => usedPaletteIndices.has(index)) }
        : entry,
    )
    .filter((entry) => {
      if (entry.paletteIndices.length > 0) return true;
      droppedVirtuals.push(entry.sourceId);
      return false;
    })
    .sort((a, b) => a.sourceId - b.sourceId);

  const virtualIdRemap = new Map<number, number>();
  const virtuals: ExportVirtualDefinition[] = used.map((entry, position) => {
    const id = physicalCount + 1 + position;
    virtualIdRemap.set(entry.sourceId, id);
    return { ...entry, id };
  });

  const paletteToPaintCode = new Map<number, string>();
  for (const entry of virtuals) {
    const code = encodePaintCode(entry.id);
    for (const paletteIndex of entry.paletteIndices)
      paletteToPaintCode.set(paletteIndex, code);
  }

  // Important: palette colours that are a pure physical extruder must be painted
  // with the physical E1..En paint code.  Exporting them as artificial 100%
  // Full Spectrum virtual extruders can make PrusaSlicer treat affected facets
  // as unpainted/default-extruder areas.
  for (const entry of plan.physicalOnly) {
    const extruder = Math.round(entry.physicalExtruder);
    if (extruder < 1 || extruder > physicalCount)
      throw new Error(
        `Physical extruder E${entry.physicalExtruder} is outside 1..${physicalCount}.`,
      );
    const code = encodePaintCode(extruder);
    for (const paletteIndex of entry.targetPaletteIndices)
      paletteToPaintCode.set(paletteIndex, code);
  }

  return { virtuals, paletteToPaintCode, virtualIdRemap, physicalExtruderCount: physicalCount, droppedVirtuals };
}

/**
 * D-3: pre-export validation.  Returns a list of human readable failures; an
 * empty list means the export is consistent.
 */
export function validateExportAssignments(input: ExportValidationInput): string[] {
  const failures: string[] = [];
  const physicalCount = Math.max(1, Math.round(input.physicalExtruderCount));
  const virtualIds = input.virtuals.map((entry) => entry.id).sort((a, b) => a - b);
  const virtualIdSet = new Set(virtualIds);

  const expectedIds = virtualIds.map((_id, position) => physicalCount + 1 + position);
  const contiguous =
    virtualIds.length === new Set(virtualIds).size &&
    virtualIds.every((id, position) => id === expectedIds[position]);
  if (!contiguous)
    failures.push(
      `Virtual extruder ids must be contiguous from ${physicalCount + 1} (got ${virtualIds.join(", ") || "none"}).`,
    );

  const usedStates = new Set<number>();
  for (const state of input.usedPaintStates) usedStates.add(state);
  const usedVirtualStates = [...usedStates].filter((state) => state > physicalCount).sort((a, b) => a - b);
  const usedPhysicalStates = [...usedStates].filter((state) => state <= physicalCount).sort((a, b) => a - b);

  const missingInJson = usedVirtualStates.filter((state) => !virtualIdSet.has(state));
  if (missingInJson.length > 0)
    failures.push(
      `Painted virtual states ${missingInJson.join(", ")} have no virtual_extruders entry in the JSON.`,
    );
  const unusedInMesh = virtualIds.filter((id) => !usedStates.has(id));
  if (unusedInMesh.length > 0)
    failures.push(
      `Virtual extruders ${unusedInMesh.join(", ")} are defined in the JSON but no triangle uses them.`,
    );

  for (const entry of input.virtuals) {
    const missing = (entry.components ?? []).map((c) => c.extruder).filter((e) => e < 1 || e > physicalCount);
    if (missing.length > 0)
      failures.push(`Virtual extruder ${entry.id} mixes filament ${missing.map((e) => `E${e}`).join(", ")}, outside 1..${physicalCount}.`);
  }

  const badPhysical = usedPhysicalStates.filter((state) => state < 1);
  if (badPhysical.length > 0)
    failures.push(`Unpainted triangles (state 0) are not allowed; every triangle needs an extruder.`);

  if (input.layerMixing === false && virtualIds.length > 0)
    failures.push(
      `This slicer has no layer mixing, but ${virtualIds.length} colours are mixes (virtual extruders ${virtualIds.join(", ")}).`,
    );

  const total = physicalCount + virtualIds.length;
  if (total > MAX_PAINTABLE_EXTRUDER_ID)
    failures.push(
      `Physical + virtual extruders = ${total}, but the MMU paint encoding supports at most ${MAX_PAINTABLE_EXTRUDER_ID}.`,
    );

  return failures;
}

/**
 * D-4: the thumbnail is rendered from the *effective* colours (what the slicer
 * will show after all merges and physical/virtual assignments), not from the
 * pre-merge palette.
 */
async function createExportThumbnailPng(
  options: Export3mfOptions,
  resolvedMode: FixedCoordinateMode,
  paletteIndices: number[],
): Promise<Uint8Array> {
  const paletteRgbByIndex = new Map<number, RGB>(
    options.palette.map((entry) => [entry.index, entry.rgb]),
  );
  const effective = options.effectiveRgbByPaletteIndex;
  const raster = renderModelThumbnail(
    options.model,
    (i) => {
      const paletteIndex = paletteIndices[i];
      return (
        effective?.get(paletteIndex) ??
        paletteRgbByIndex.get(paletteIndex) ??
        options.adjustedColors[i] ??
        options.model.triangleColors[i] ??
        ([180, 180, 180] as RGB)
      );
    },
    { width: 768, height: 768, view: "front-top-left", coordinateMode: resolvedMode },
  );
  const encoder = options.thumbnailEncoder ?? rasterToPngBytes;
  return encoder(raster);
}

function fullSpectrumJson(
  physicalSlots: PhysicalSlot[],
  virtuals: ExportVirtualDefinition[],
): string {
  const physical_extruders = physicalSlots
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((slot) => ({ id: slot.slot, color: rgbToHex(slot.filament.rgb) }));
  const virtual_extruders = virtuals.map((entry) => ({
    id: entry.id,
    kind: "fullspectrum",
    color: entry.color,
    components: entry.components.map((component) => ({
      extruder: component.extruder,
      ratio: Number(component.ratio.toFixed(6)),
    })),
  }));
  return JSON.stringify(
    { physical_extruders, version: 1, virtual_extruders },
    null,
    2,
  );
}

function trianglePaletteIndices(
  adjustedColors: RGB[],
  palette: PaletteEntry[],
  accentProtection: AccentProtectionMode = "balanced",
): number[] {
  return adjustedColors.map(
    (rgb) =>
      palette[nearestPaletteIndex(rgb, palette, accentProtection)]?.index ?? 1,
  );
}

interface ModelXmlResult {
  /** The whole 3D/3dmodel.model; empty for a Bambu Studio project, which keeps each mesh in its own file. */
  xml: string;
  /** Per object: its name and `<mesh>` lines (Bambu Studio project only). */
  meshes: BambuProjectObject[];
  /** Palette index used for every triangle. */
  paletteIndices: number[];
  /** Decoded extruder states written into the mesh. */
  usedPaintStates: Set<number>;
  /** Number of 3MF objects written (one per shell when splitting). */
  objectCount: number;
}

function buildModelXml(
  options: Export3mfOptions,
  paletteToPaintCode: Map<number, string>,
  transform: string,
  precomputedPaletteIndices?: number[],
  components?: MeshComponent[] | null,
): ModelXmlResult {
  const title = titleFromFilename(options.fileName);
  const model = options.model;
  const bambu = options.slicer === "bambu";
  const project = bambu && Boolean(options.bambuPrinter);
  const paletteIndices =
    precomputedPaletteIndices ??
    trianglePaletteIndices(
      options.adjustedColors,
      options.palette,
      options.accentProtection ?? "balanced",
    );
  const leafByPaletteIndex = new Map<number, string>();
  const stateByPaletteIndex = new Map<number, number>();
  // Only palette colours that a triangle actually uses need an assignment.
  const usedPaletteIndices = new Set<number>(paletteIndices);
  for (const paletteIndex of options.palette.map((p) => p.index)) {
    if (!usedPaletteIndices.has(paletteIndex)) continue;
    const paintCode = paletteToPaintCode.get(paletteIndex);
    if (!paintCode)
      throw new Error(
        `No extruder assignment for palette colour #${paletteIndex}.`,
      );
    leafByPaletteIndex.set(paletteIndex, paintCode);
    stateByPaletteIndex.set(paletteIndex, decodePaintCode(paintCode));
  }
  const usedPaintStates = new Set<number>();
  // Bambu Studio reads states past 16 its own way (see paintCodes.ts).
  const bambuLeafOf = new Map<string, string>();
  const bambuLeaf = (leaf: string): string => {
    let code = bambuLeafOf.get(leaf);
    if (code === undefined) {
      code = encodePaintCode(decodePaintCode(leaf), "bambu");
      bambuLeafOf.set(leaf, code);
    }
    return code;
  };

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">',
  );
  out.push(' <metadata name="slic3rpe:Version3mf">1</metadata>');
  out.push(' <metadata name="slic3rpe:MmPaintingVersion">2</metadata>');
  out.push(` <metadata name="Title">${xmlEscape(title)}</metadata>`);
  out.push(' <metadata name="Designer"></metadata>');
  out.push(
    ' <metadata name="Description">Converted from OBJ vertex colours by VertexColor2ColorMix. Reduced palette colours are mapped to PrusaSlicer Full Spectrum virtual extruders.</metadata>',
  );
  out.push(' <metadata name="Application">VertexColor2ColorMix</metadata>');
  // The paint code of one triangle, in the original triangle order.  Palette
  // indices are patched in place when an assignment is missing, so the caller
  // (thumbnail) keeps seeing what was actually written.
  const paintCodeOfTriangle = (i: number): string => {
    const paletteIndex = paletteIndices[i] ?? 1;
    let leaf = leafByPaletteIndex.get(paletteIndex);
    if (leaf === undefined) {
      // Should not happen (every palette entry has an assignment); fall back to
      // the first assignment so that no triangle is left unpainted.
      const first = leafByPaletteIndex.entries().next().value;
      if (!first) throw new Error("No extruder assignments were generated.");
      leaf = first[1];
      paletteIndices[i] = first[0];
    }
    usedPaintStates.add(
      stateByPaletteIndex.get(paletteIndices[i]) ?? decodePaintCode(leaf),
    );
    return leaf;
  };

  // One object per connected shell, or the whole mesh as a single object.
  const shells: Array<Int32Array | null> =
    components && components.length > 1
      ? components.map((component) => component.triangles)
      : [null];

  const meshes: BambuProjectObject[] = [];
  out.push(" <resources>");
  shells.forEach((shell, shellIndex) => {
    // Bambu-family slicers name objects from this attribute (PrusaSlicer from Slic3r_PE_model.config).
    const objectName = shells.length > 1 ? `${title} ${shellIndex + 1}` : title;
    // A Bambu Studio project keeps each mesh in its own file; the lines are collected per object.
    const lines: string[] = project ? [] : out;
    if (!project) out.push(`  <object id="${shellIndex + 1}" name="${xmlEscape(objectName)}" type="model">`);
    lines.push("   <mesh>");
    lines.push("    <vertices>");
    // A shell shares no vertex with any other shell, so each object carries its
    // own compacted vertex list and the triangles are renumbered into it.
    const localOfVertex = shell ? new Map<number, number>() : null;
    if (shell && localOfVertex) {
      for (let k = 0; k < shell.length; k++) {
        const [v1, v2, v3] = model.triangles[shell[k]] as Tri;
        for (const v of [v1, v2, v3]) {
          if (localOfVertex.has(v)) continue;
          localOfVertex.set(v, localOfVertex.size);
          const [x, y, z] = model.vertices[v];
          lines.push(`     <vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`);
        }
      }
    } else {
      for (const [x, y, z] of model.vertices) {
        lines.push(`     <vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`);
      }
    }
    lines.push("    </vertices>");
    lines.push("    <triangles>");
    const faceCount = shell ? shell.length : model.triangles.length;
    for (let k = 0; k < faceCount; k++) {
      const i = shell ? shell[k] : k;
      const [v1, v2, v3] = model.triangles[i] as Tri;
      const leaf = paintCodeOfTriangle(i);
      const a = localOfVertex ? (localOfVertex.get(v1) as number) : v1;
      const b = localOfVertex ? (localOfVertex.get(v2) as number) : v2;
      const c = localOfVertex ? (localOfVertex.get(v3) as number) : v3;
      lines.push(
        project
          ? `     <triangle v1="${a}" v2="${b}" v3="${c}" paint_color="${bambuLeaf(leaf)}"/>`
          : bambu
            ? `     <triangle v1="${a}" v2="${b}" v3="${c}" paint_color="${bambuLeaf(leaf)}" slic3rpe:mmu_segmentation="${leaf}"/>`
            : `     <triangle v1="${a}" v2="${b}" v3="${c}" slic3rpe:mmu_segmentation="${leaf}"/>`,
      );
    }
    lines.push("    </triangles>");
    lines.push("   </mesh>");
    if (project) meshes.push({ name: objectName, meshLines: lines, faceCount });
    else out.push("  </object>");
  });
  out.push(" </resources>");
  out.push(" <build>");
  // Every piece keeps the one shared transform, so the split model lands on the
  // bed exactly as the whole model would have.
  shells.forEach((_shell, shellIndex) => {
    out.push(
      `  <item objectid="${shellIndex + 1}" transform="${transform}" printable="1"/>`,
    );
  });
  out.push(" </build>");
  out.push("</model>");
  return {
    xml: project ? "" : out.join("\n") + "\n",
    meshes,
    paletteIndices,
    usedPaintStates,
    objectCount: shells.length,
  };
}

function buildModelConfig(
  model: MeshModel,
  outputFileName: string,
  defaultExtruder: number,
  components?: MeshComponent[] | null,
): string {
  const title = titleFromFilename(outputFileName);
  const sourceFile = model.name || `${modelBaseName(outputFileName)}.obj`;
  const split = Boolean(components && components.length > 1);
  const faceCounts = split
    ? (components as MeshComponent[]).map((c) => c.triangles.length)
    : [model.triangles.length];
  const extruder = Math.max(1, Math.round(defaultExtruder));
  const objects = faceCounts
    .map((faceCount, index) => {
      // Piece names are what PrusaSlicer shows in the object list.
      const name = split ? `${title} ${index + 1}` : title;
      const lastId = Math.max(0, faceCount - 1);
      return (
        ` <object id="${index + 1}" instances_count="1">\n` +
        `  <metadata type="object" key="name" value="${xmlEscape(name)}"/>\n` +
        `  <metadata type="object" key="extruder" value="${extruder}"/>\n` +
        `  <volume firstid="0" lastid="${lastId}">\n` +
        `   <metadata type="volume" key="name" value="${xmlEscape(name)}"/>\n` +
        `   <metadata type="volume" key="volume_type" value="ModelPart"/>\n` +
        `   <metadata type="volume" key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n` +
        `   <metadata type="volume" key="source_file" value="${xmlEscape(sourceFile)}"/>\n` +
        `   <metadata type="volume" key="source_object_id" value="0"/>\n` +
        `   <metadata type="volume" key="source_volume_id" value="0"/>\n` +
        `   <metadata type="volume" key="source_offset_x" value="0"/>\n` +
        `   <metadata type="volume" key="source_offset_y" value="0"/>\n` +
        `   <metadata type="volume" key="source_offset_z" value="0"/>\n` +
        `   <mesh edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n` +
        `  </volume>\n` +
        ` </object>\n`
      );
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${objects}</config>\n`;
}

function writeContentTypes(includePng: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n${includePng ? ' <Default Extension="png" ContentType="image/png"/>\n' : ""}</Types>\n`;
}

function writeRels(includeThumbnail: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n${includeThumbnail ? ' <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n' : ""}</Relationships>\n`;
}

function targetPhysicalExtruderCount(slots: PhysicalSlot[]): number {
  return Math.max(
    1,
    slots.length,
    ...slots.map((slot) => Math.max(1, Math.round(slot.slot))),
  );
}

function sortedPhysicalSlots(slots: PhysicalSlot[]): PhysicalSlot[] {
  return slots.slice().sort((a, b) => a.slot - b.slot);
}

function colourList(slots: PhysicalSlot[]): string {
  return physicalSlotColours(slots).join(";");
}

function physicalSlotColours(slots: PhysicalSlot[]): string[] {
  const targetCount = targetPhysicalExtruderCount(slots);
  const sorted = sortedPhysicalSlots(slots);
  const bySlot = new Map<number, string>();
  for (const slot of sorted) bySlot.set(Math.max(1, Math.round(slot.slot)), rgbToHex(slot.filament.rgb));
  const fallback = sorted.length > 0 ? rgbToHex(sorted[sorted.length - 1].filament.rgb) : "#FFFFFF";
  const colours: string[] = [];
  for (let slot = 1; slot <= targetCount; slot++) {
    colours.push(bySlot.get(slot) ?? colours[colours.length - 1] ?? fallback);
  }
  return colours;
}

function repeatValue(value: string, count: number, separator: string): string {
  return Array.from({ length: count }, () => value).join(separator);
}

function prusaConfigLine(key: string, value: string): string {
  // PrusaSlicer stores project-wide config values in Slic3r_PE.config
  // as semicolon-prefixed lines.  Writing active-looking INI lines here is
  // ignored by PrusaSlicer when opening a 3MF project, so keep the same
  // Prusa project config syntax for both updated and appended keys.
  return `; ${key} = ${value}`;
}

interface ParsedConfigLine {
  key: string;
  value: string;
  commented: boolean;
}

function parseConfigLine(raw: string): ParsedConfigLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const commented = trimmed.startsWith(";");
  const body = commented ? trimmed.slice(1).trim() : trimmed;
  if (!body.includes("=")) return null;
  const eq = body.indexOf("=");
  const key = body.slice(0, eq).trim();
  const value = body.slice(eq + 1).trim();
  return key ? { key, value, commented } : null;
}

const FILAMENT_SLOT_KEYS = new Set<string>([
  "bed_temperature",
  "bridge_fan_speed",
  "chamber_temperature",
  "compatible_printers",
  "compatible_printers_condition",
  "compatible_prints",
  "compatible_prints_condition",
  "cooling",
  "disable_fan_first_layers",
  "end_filament_gcode",
  "fan_always_on",
  "filament_abrasive",
  "filament_colour",
  "filament_cost",
  "filament_cooling_final_speed",
  "filament_cooling_initial_speed",
  "filament_cooling_moves",
  "filament_custom_variables",
  "filament_density",
  "filament_deretract_speed",
  "filament_diameter",
  "filament_end_gcode",
  "filament_flush_speed",
  "filament_flush_volume",
  "filament_infill_max_crossing_speed",
  "filament_infill_max_speed",
  "filament_load_time",
  "filament_loading_speed",
  "filament_loading_speed_start",
  "filament_max_volumetric_speed",
  "filament_minimal_purge_on_wipe_tower",
  "filament_multitool_ramming",
  "filament_multitool_ramming_flow",
  "filament_multitool_ramming_volume",
  "filament_notes",
  "filament_purge_multiplier",
  "filament_ramming_parameters",
  "filament_retract_before_travel",
  "filament_retract_before_wipe",
  "filament_retract_lift",
  "filament_retract_lift_above",
  "filament_retract_lift_below",
  "filament_retract_length",
  "filament_retract_length_toolchange",
  "filament_retract_layer_change",
  "filament_retract_restart_extra",
  "filament_retract_restart_extra_toolchange",
  "filament_retract_speed",
  "filament_seam_gap_distance",
  "filament_settings_id",
  "filament_shrinkage_compensation_xy",
  "filament_shrinkage_compensation_z",
  "filament_soluble",
  "filament_spool_weight",
  "filament_stamping_distance",
  "filament_stamping_loading_speed",
  "filament_start_gcode",
  "filament_toolchange_delay",
  "filament_travel_lift_before_obstacle",
  "filament_travel_max_lift",
  "filament_travel_ramping_lift",
  "filament_travel_slope",
  "filament_type",
  "filament_unload_time",
  "filament_unloading_speed",
  "filament_unloading_speed_start",
  "filament_wipe",
  "first_layer_bed_temperature",
  "first_layer_temperature",
  "full_fan_speed_layer",
  "max_fan_speed",
  "min_fan_speed",
  "slowdown_below_layer_time",
  "start_filament_gcode",
  "temperature",
]);

const EXTRUDER_SLOT_KEYS = new Set<string>([
  "deretract_speed",
  "extruder_colour",
  "extruder_offset",
  "extrusion_axis",
  "max_layer_height",
  "min_layer_height",
  "nozzle_diameter",
  "nozzle_high_flow",
  "retract_before_travel",
  "retract_before_wipe",
  "retract_layer_change",
  "retract_length",
  "retract_length_toolchange",
  "retract_lift",
  "retract_lift_above",
  "retract_lift_below",
  "retract_restart_extra",
  "retract_restart_extra_toolchange",
  "retract_speed",
  "wipe",
]);


const TEMPLATE_SLOT_EXTEND_KEYS = new Set<string>([
  // Native PrusaSlicer behaviour when a 5-slot MMU template is manually
  // increased to 8 slots.  Do not blindly expand every comma/semicolon list in
  // Slic3r_PE.config: several settings are intentionally left at their template
  // length by PrusaSlicer and some scalar strings contain semicolons inside
  // quoted G-code or condition expressions.
  "bed_temperature",
  "bridge_fan_speed",
  "chamber_temperature",
  "cooling",
  "deretract_speed",
  "disable_fan_first_layers",
  "end_filament_gcode",
  "extruder_colour",
  "extruder_offset",
  "extrusion_axis",
  "fan_always_on",
  "filament_abrasive",
  "filament_colour",
  "filament_cooling_final_speed",
  "filament_cooling_initial_speed",
  "filament_cooling_moves",
  "filament_cost",
  "filament_density",
  "filament_deretract_speed",
  "filament_diameter",
  "filament_infill_max_crossing_speed",
  "filament_infill_max_speed",
  "filament_load_time",
  "filament_loading_speed",
  "filament_loading_speed_start",
  "filament_max_volumetric_speed",
  "filament_minimal_purge_on_wipe_tower",
  "filament_multitool_ramming",
  "filament_multitool_ramming_flow",
  "filament_multitool_ramming_volume",
  "filament_notes",
  "filament_purge_multiplier",
  "filament_ramming_parameters",
  "filament_retract_before_travel",
  "filament_retract_before_wipe",
  "filament_retract_layer_change",
  "filament_retract_length",
  "filament_retract_length_toolchange",
  "filament_retract_lift",
  "filament_retract_lift_above",
  "filament_retract_lift_below",
  "filament_retract_restart_extra",
  "filament_retract_restart_extra_toolchange",
  "filament_retract_speed",
  "filament_seam_gap_distance",
  "filament_settings_id",
  "filament_shrinkage_compensation_xy",
  "filament_shrinkage_compensation_z",
  "filament_soluble",
  "filament_spool_weight",
  "filament_stamping_distance",
  "filament_stamping_loading_speed",
  "filament_toolchange_delay",
  "filament_travel_lift_before_obstacle",
  "filament_travel_max_lift",
  "filament_travel_ramping_lift",
  "filament_travel_slope",
  "filament_type",
  "filament_unload_time",
  "filament_unloading_speed",
  "filament_unloading_speed_start",
  "filament_wipe",
  "first_layer_bed_temperature",
  "first_layer_temperature",
  "full_fan_speed_layer",
  "max_fan_speed",
  "max_layer_height",
  "min_fan_speed",
  "min_layer_height",
  "nozzle_diameter",
  "nozzle_high_flow",
  "retract_before_travel",
  "retract_before_wipe",
  "retract_layer_change",
  "retract_length",
  "retract_length_toolchange",
  "retract_lift",
  "retract_lift_above",
  "retract_lift_below",
  "retract_restart_extra",
  "retract_restart_extra_toolchange",
  "retract_speed",
  "slowdown_below_layer_time",
  "start_filament_gcode",
  "temperature",
  "wipe",
]);

const SEMICOLON_FALLBACKS = new Map<string, string>([
  ["bed_temperature", "60"],
  ["bridge_fan_speed", "100"],
  ["chamber_temperature", "0"],
  ["cooling", "1"],
  ["disable_fan_first_layers", "1"],
  ["fan_always_on", "1"],
  ["filament_cost", "0"],
  ["filament_density", "1.24"],
  ["filament_diameter", "1.75"],
  ["filament_load_time", "0"],
  ["filament_max_volumetric_speed", "0"],
  ["filament_minimal_purge_on_wipe_tower", "15"],
  ["filament_purge_multiplier", "100"],
  ["filament_settings_id", "Generic PLA"],
  ["filament_soluble", "0"],
  ["filament_spool_weight", "0"],
  ["filament_toolchange_delay", "0"],
  ["filament_type", "PLA"],
  ["first_layer_bed_temperature", "60"],
  ["first_layer_temperature", "215"],
  ["max_fan_speed", "100"],
  ["min_fan_speed", "100"],
  ["temperature", "210"],
]);

const COMMA_FALLBACKS = new Map<string, string>([
  ["deretract_speed", "0"],
  ["extruder_offset", "0x0"],
  ["extrusion_axis", "E"],
  ["max_layer_height", "0.25"],
  ["min_layer_height", "0.07"],
  ["nozzle_diameter", "0.4"],
  ["retract_before_travel", "2"],
  ["retract_before_wipe", "0%"],
  ["retract_layer_change", "0"],
  ["retract_length", "0.8"],
  ["retract_length_toolchange", "4"],
  ["retract_lift", "0.4"],
  ["retract_lift_above", "0"],
  ["retract_lift_below", "0"],
  ["retract_restart_extra", "0"],
  ["retract_restart_extra_toolchange", "0"],
  ["retract_speed", "35"],
  ["wipe", "1"],
]);

function splitListValue(value: string, separator: string): string[] {
  if (!value.trim()) return [];
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;
  for (const char of value) {
    if (char === '"' && !escaped) inQuotes = !inQuotes;
    if (char === separator && !inQuotes) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += char;
    }
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  tokens.push(current.trim());
  return tokens;
}

function hasListSeparator(value: string, separator: string): boolean {
  return splitListValue(value, separator).length > 1;
}

function extendListValue(
  value: string,
  separator: string,
  targetCount: number,
  fallback: string,
): string {
  const tokens = splitListValue(value, separator);
  const fill = tokens.length > 0 ? tokens[tokens.length - 1] : fallback;
  while (tokens.length < targetCount) tokens.push(fill);
  return tokens.slice(0, targetCount).join(separator);
}

function filamentFallback(key: string, separator: string): string {
  if (key === "filament_colour") return "#FF8000";
  if (key === "filament_settings_id") return '"Generic PLA"';
  if (key === "filament_type") return "PLA";
  if (separator === ",") return COMMA_FALLBACKS.get(key) ?? SEMICOLON_FALLBACKS.get(key) ?? "0";
  return SEMICOLON_FALLBACKS.get(key) ?? COMMA_FALLBACKS.get(key) ?? "";
}

function parseNumericList(value: string): number[] {
  return splitListValue(value, ",")
    .map((token) => Number(token.trim()))
    .filter((value) => Number.isFinite(value));
}

function inferSquareSize(length: number): number {
  const size = Math.round(Math.sqrt(Math.max(0, length)));
  return size > 0 && size * size === length ? size : 0;
}

function formatWipingVolume(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function extendWipingVolumesMatrix(value: string, targetCount: number): string {
  const source = parseNumericList(value);
  const sourceCount = inferSquareSize(source.length);
  const offDiagonal = source.find((entry, index) => {
    if (entry <= 0) return false;
    if (sourceCount <= 0) return true;
    const row = Math.floor(index / sourceCount);
    const col = index % sourceCount;
    return row !== col;
  });
  const fallback = Number.isFinite(offDiagonal) ? Number(offDiagonal) : 65;
  const out: number[] = [];
  for (let row = 0; row < targetCount; row++) {
    for (let col = 0; col < targetCount; col++) {
      if (sourceCount > 0 && row < sourceCount && col < sourceCount) {
        out.push(source[row * sourceCount + col] ?? (row === col ? 0 : fallback));
      } else {
        out.push(row === col ? 0 : fallback);
      }
    }
  }
  return out.map(formatWipingVolume).join(",");
}

function detectSlotSeparator(parsed: ParsedConfigLine): string | null {
  // Do not treat every filament_* key as a slot list.  Some keys, for example
  // filament_vendor, are scalar values and must be preserved exactly.
  if (parsed.key === "extruder_colour" || parsed.key === "filament_colour") return ";";
  if (parsed.key === "filament_settings_id" || parsed.key === "filament_type") return ";";
  if (parsed.key === "start_filament_gcode" || parsed.key === "end_filament_gcode") return ";";
  if (parsed.key === "filament_notes" || parsed.key === "filament_ramming_parameters") return ";";
  if (isExtruderSlotKey(parsed.key)) return ",";
  if (!FILAMENT_SLOT_KEYS.has(parsed.key)) return null;
  if (hasListSeparator(parsed.value, ";")) return ";";
  if (hasListSeparator(parsed.value, ",")) return ",";
  return ";";
}

function isExtruderSlotKey(key: string): boolean {
  return EXTRUDER_SLOT_KEYS.has(key);
}

function extendKnownSlotLine(
  parsed: ParsedConfigLine,
  targetCount: number,
): string | null {
  if (!TEMPLATE_SLOT_EXTEND_KEYS.has(parsed.key)) return null;
  const separator = detectSlotSeparator(parsed);
  if (!separator) return null;
  const fallback = filamentFallback(parsed.key, separator);
  return extendListValue(parsed.value, separator, targetCount, fallback);
}

function setOrAppendConfigKeys(config: string, values: Map<string, string>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of config.split(/\r?\n/)) {
    const parsed = parseConfigLine(raw);
    if (parsed && values.has(parsed.key)) {
      if (!seen.has(parsed.key)) out.push(prusaConfigLine(parsed.key, values.get(parsed.key) ?? ""));
      seen.add(parsed.key);
      continue;
    }
    out.push(raw);
  }
  for (const [key, value] of values) {
    if (!seen.has(key)) out.push(prusaConfigLine(key, value));
  }
  return out.join("\n");
}

/**
 * Updates only the PrusaSlicer project keys that are required for the selected
 * physical extruder count. Template filament names and filament base colours are
 * intentionally preserved; Color Mix Lab only updates the visible extruder slot
 * colours and the slot-count metadata needed by PrusaSlicer.
 */
function updateSlic3rConfigForPhysicalSlots(
  config: string,
  slots: PhysicalSlot[],
  updateExtruderColour: boolean,
): string {
  const targetCount = targetPhysicalExtruderCount(slots);
  const colourValues = physicalSlotColours(slots);
  const values = new Map<string, string>();

  // Match PrusaSlicer project files as closely as possible: count keys are
  // written explicitly, but only a known-safe subset of per-slot arrays is
  // resized. This avoids corrupting scalar filament fields or embedded G-code.
  values.set("extruders_count", String(targetCount));
  values.set("num_extruders", String(targetCount));
  // The printer kind stays whatever the template says: a tool changer (Prusa XL)
  // has single_extruder_multi_material = 0, an MMU has 1.  Forcing 1 made
  // PrusaSlicer refuse XL projects ("Ooze prevention is only supported with the
  // wipe tower when 'single_extruder_multi_material' is off").
  values.set("printer_technology", "FFF");
  values.set("wipe_tower", "1");

  const parsedLines = config.split(/\r?\n/).flatMap((raw) => {
    const parsed = parseConfigLine(raw);
    return parsed ? [parsed] : [];
  });
  const customWipeMatrix =
    parsedLines.find((line) => line.key === "wiping_volumes_use_custom_matrix")?.value.trim() === "1";
  let templateHasWipingMatrix = false;

  for (const parsed of parsedLines) {
    if (parsed.key === "wiping_volumes_matrix") {
      templateHasWipingMatrix = true;
      if (customWipeMatrix) {
        values.set(parsed.key, extendWipingVolumesMatrix(parsed.value, targetCount));
      }
      continue;
    }
    const extended = extendKnownSlotLine(parsed, targetCount);
    if (extended !== null) values.set(parsed.key, extended);
  }

  if (!templateHasWipingMatrix) {
    values.set("wiping_volumes_matrix", extendWipingVolumesMatrix("", targetCount));
    values.set("wiping_volumes_use_custom_matrix", "0");
  }

  if (updateExtruderColour) {
    const colours = colourValues.join(";");
    values.set("extruder_colour", colours);
  }

  // Essential fallbacks for minimal or unusual templates.  For normal templates
  // these keys already exist and were extended above by repeating the last
  // native value, not by replacing user filament presets.
  if (!values.has("filament_settings_id"))
    values.set("filament_settings_id", repeatValue('"Generic PLA"', targetCount, ";"));
  if (!values.has("filament_type"))
    values.set("filament_type", repeatValue("PLA", targetCount, ";"));
  if (!values.has("filament_colour"))
    values.set("filament_colour", repeatValue("#FF8000", targetCount, ";"));
  if (!values.has("filament_diameter"))
    values.set("filament_diameter", repeatValue("1.75", targetCount, ","));
  if (!values.has("nozzle_diameter"))
    values.set("nozzle_diameter", repeatValue("0.4", targetCount, ","));
  if (!values.has("extruder_offset"))
    values.set("extruder_offset", repeatValue("0x0", targetCount, ","));
  if (!values.has("extrusion_axis"))
    values.set("extrusion_axis", repeatValue("E", targetCount, ","));

  return setOrAppendConfigKeys(config, values);
}

async function loadTemplateZip(
  arrayBuffer?: ArrayBuffer | null,
): Promise<JSZip | null> {
  if (!arrayBuffer) return null;
  try {
    return await JSZip.loadAsync(arrayBuffer.slice(0));
  } catch {
    return null;
  }
}

async function templateText(
  zip: JSZip | null,
  path: string,
): Promise<string | null> {
  const file = zip?.file(path);
  return file ? await file.async("text") : null;
}

async function templateBytes(
  zip: JSZip | null,
  path: string,
): Promise<Uint8Array | null> {
  const file = zip?.file(path);
  return file ? await file.async("uint8array") : null;
}

/** Beyond this many shells the model is almost certainly speckled; keep it whole. */
const MAX_SPLIT_OBJECTS = 64;

export interface Export3mfSummary {
  virtualCount: number;
  physicalExtruderCount: number;
  /** Exported virtual extruder ids (contiguous from physicalExtruderCount + 1). */
  virtualIds: number[];
  /** Original virtual id -> exported id, only where the number changed. */
  renumberedVirtuals: Array<{ from: number; to: number }>;
  /** Plan virtual ids left out because no triangle uses their palette colour. */
  droppedVirtuals: number[];
  physicalOnlyExportedAsVirtual: number;
  printerConfigIncluded: boolean;
  /** Quality preset written into the printer config, when one was chosen. */
  printPreset?: string;
  transform: string;
  coordinateMode: string;
  scale: number;
  bedSize?: { x: number; y: number };
  /** 3MF objects written: more than one when the shells were split. */
  objectCount: number;
  /** Written as a Bambu Studio project, with this many mixed filaments. */
  bambuMixedFilaments?: number;
}

export async function buildPrusa3mfBlob(
  options: Export3mfOptions,
): Promise<{
  blob: Blob;
  fileName: string;
  summary: Export3mfSummary;
}> {
  if (!options.model) throw new Error("No model loaded.");
  if (options.palette.length === 0) throw new Error("No palette generated.");
  if (options.physicalSlots.length === 0)
    throw new Error("No physical extruder colours available.");
  if (options.adjustedColors.length !== options.model.triangleColors.length)
    throw new Error("Adjusted colour data is incomplete.");

  const fileName = sanitise3mfName(options.fileName);
  const templateZip = await loadTemplateZip(options.templateArrayBuffer);
  const physicalExtruderCount = targetPhysicalExtruderCount(options.physicalSlots);
  const paletteIndices = trianglePaletteIndices(
    options.adjustedColors,
    options.palette,
    options.accentProtection ?? "balanced",
  );
  const { virtuals, paletteToPaintCode, virtualIdRemap, droppedVirtuals } = buildExportAssignments(
    options.virtualPlan,
    physicalExtruderCount,
    new Set(paletteIndices),
  );
  if (paletteToPaintCode.size === 0)
    throw new Error("No extruder assignments were generated.");

  const transformResult = buildTransform(
    options.model,
    options.templateInfo,
    options.placement,
  );
  // Splitting has to happen here: PrusaSlicer's own "split to objects" deletes
  // multi-material painting, because it renumbers the triangles the paint is
  // keyed to.  Guard against meshes that shatter into hundreds of specks.
  const components = options.splitObjects
    ? splitMeshComponents(options.model)
    : null;
  const splitComponents =
    components && components.length > 1 && components.length <= MAX_SPLIT_OBJECTS
      ? components
      : null;
  const modelResult = buildModelXml(
    options,
    paletteToPaintCode,
    transformResult.transform,
    paletteIndices,
    splitComponents,
  );

  // D-3: never write an inconsistent project.
  const bambu = options.slicer === "bambu";
  const bambuProject = bambu && options.bambuPrinter ? await import("./bambuProject") : null;
  if (bambuProject && !bambuProject.hasBambuProjectTemplate(options.bambuPrinter))
    throw new Error(`No Bambu Studio project template for "${options.bambuPrinter}".`);
  // Bambu Studio projects carry the mixes as mixed filaments, in the same slots.
  const mixedSlots: BambuMixedSlot[] = virtuals.map((entry) => ({
    components: entry.components.map((component) => component.extruder),
    ratios: entry.components.map((component) => component.ratio),
    colour: entry.color,
  }));
  const failures = [
    ...validateExportAssignments({
      physicalExtruderCount,
      virtuals,
      usedPaintStates: modelResult.usedPaintStates,
      layerMixing: !bambu || Boolean(bambuProject),
    }),
    ...(bambuProject ? bambuProject.validateBambuMixedSlots(physicalExtruderCount, mixedSlots) : []),
  ];
  if (failures.length > 0)
    throw new Error(`3MF export validation failed:\n- ${failures.join("\n- ")}`);

  const modelConfig = buildModelConfig(
    options.model,
    fileName,
    options.placement.defaultExtruder,
    splitComponents,
  );
  const fsJson = fullSpectrumJson(options.physicalSlots, virtuals);

  // The printer config, presets and Full Spectrum list are PrusaSlicer's own;
  // Bambu-family slicers skip those files and keep the printer selected there.
  const configText = options.includePrinterConfig && !bambu
    ? await templateText(templateZip, "Metadata/Slic3r_PE.config")
    : null;
  const wipeTowerBytes = await templateBytes(
    templateZip,
    "Metadata/Prusa_Slicer_wipe_tower_information.xml",
  );
  const generatedThumbnailBytes = await createExportThumbnailPng(
    options,
    transformResult.resolvedMode as FixedCoordinateMode,
    modelResult.paletteIndices,
  );

  const renumberedVirtuals = [...virtualIdRemap.entries()]
    .filter(([from, to]) => from !== to)
    .map(([from, to]) => ({ from, to }));
  const summaryBase = {
    virtualCount: virtuals.length,
    physicalExtruderCount,
    virtualIds: virtuals.map((entry) => entry.id),
    renumberedVirtuals,
    droppedVirtuals,
    physicalOnlyExportedAsVirtual: options.virtualPlan.physicalOnly.length,
    transform: transformResult.transform,
    coordinateMode: transformResult.resolvedMode,
    scale: transformResult.resolvedScale,
    bedSize: transformResult.bedSize,
    objectCount: modelResult.objectCount,
  };

  if (bambuProject && options.bambuPrinter) {
    const physicalColours = physicalSlotColours(options.physicalSlots);
    const settings = bambuProject.buildBambuProjectSettings(
      options.bambuPrinter,
      physicalColours,
      mixedSlots,
      bambuProject.bambuWipeTowerPosition(options.bambuPrinter, placedFootprint(options.model, transformResult.transform), physicalColours.length),
    );
    const files = bambuProject.bambuProjectFiles({
      title: titleFromFilename(fileName),
      sourceFile: options.model.name || `${modelBaseName(fileName)}.obj`,
      objects: modelResult.meshes,
      transform: transformResult.transform,
      settings,
      hasThumbnail: true,
    });
    const projectZip = new JSZip();
    for (const [path, text] of files) projectZip.file(path, text);
    projectZip.file("Metadata/plate_1.png", generatedThumbnailBytes);
    const projectBytes = await projectZip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return {
      blob: new Blob([projectBytes as Uint8Array<ArrayBuffer>], { type: "model/3mf" }),
      fileName,
      summary: { ...summaryBase, printerConfigIncluded: true, bambuMixedFilaments: mixedSlots.length },
    };
  }

  const zip = new JSZip();
  zip.file("[Content_Types].xml", writeContentTypes(true));
  zip.file("_rels/.rels", writeRels(true));
  zip.file("3D/3dmodel.model", modelResult.xml);
  // D-2: Slic3r_PE.config is only written when explicitly requested and a
  // template provides it.  A generated config would override the printer
  // profile the user selected in PrusaSlicer (e.g. XL wipe tower settings).
  const printerConfigIncluded = Boolean(configText);
  if (configText) {
    const preset = findPrintPreset(options.printPreset);
    const withSlots = updateSlic3rConfigForPhysicalSlots(
      configText,
      options.physicalSlots,
      options.updateExtruderColour ?? true,
    );
    zip.file(
      "Metadata/Slic3r_PE.config",
      preset
        ? applyPrintPresetToConfig(withSlots, preset).replace(
            /^; print_settings_id = (.*)$/m,
            (_line, name: string) => `; print_settings_id = ${preset.source} (${name.trim()} ${options.printPresetSupportWord ?? "support"})`,
          )
        : withSlots,
    );
  }
  zip.file("Metadata/Slic3r_PE_model.config", modelConfig);
  if (!bambu) {
    zip.file("Metadata/Prusa_Slicer_full_spectrum.json", fsJson);
    zip.file(
      "Metadata/Prusa_Slicer_wipe_tower_information.xml",
      wipeTowerBytes ??
        '<?xml version="1.0" encoding="UTF-8"?>\n<wipe_tower_information/>\n',
    );
  }
  zip.file("Metadata/thumbnail.png", generatedThumbnailBytes);

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "model/3mf" });

  return {
    blob,
    fileName,
    summary: {
      ...summaryBase,
      printerConfigIncluded,
      printPreset: findPrintPreset(options.printPreset)?.source,
    },
  };
}

/** Bed footprint of the model once the build transform has placed it. */
function placedFootprint(model: MeshModel, transform: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const m = transform.split(/\s+/).map(Number);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y, z] of model.vertices) {
    const px = x * m[0] + y * m[3] + z * m[6] + m[9];
    const py = x * m[1] + y * m[4] + z * m[7] + m[10];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { minX, minY, maxX, maxY };
}
