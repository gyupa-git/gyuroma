import type {
  AccentProtectionMode,
  ColourDifferenceMetric,
  MappingStrategyMode,
  MixingRecipeResolution,
  VirtualMixPriorityMode,
} from "@core/types";
import type { ExportCoordinateMode } from "@core/orientation";

/** Tool changers keep growing (9-head machines are coming); the paint format allows 255 with the mixes. */
export const MAX_PHYSICAL = 16;
export const MIN_PHYSICAL = 2;

export interface FilamentSettings {
  /** Number of physical extruders in use (MIN_PHYSICAL..MAX_PHYSICAL). */
  count: number;
  /** Hex colour per slot, always MAX_PHYSICAL entries. */
  hex: string[];
  /** Display name per slot, always MAX_PHYSICAL entries. */
  names: string[];
}

export interface PaletteSettings {
  /** Maximum number of target colours after reduction. */
  maxColours: number;
  accentProtection: AccentProtectionMode;
}

export interface MergeSettings {
  ambiguousMaxSaturation: number;
  ambiguousMinValue: number;
  ambiguousMaxValue: number;
  ambiguousMinAreaPercent: number;
  protectMaxAreaPercent: number;
  protectMinSaturation: number;
  minBlobDefault: number;
  minBlobSkin: number;
  minBlobDark: number;
  propagationRounds: number;
  smoothingRounds: number;
  /** Protected colours (eyes, mouth lines) are smoothed too, without being cut or erased. */
  smoothProtected: boolean;
}

export interface MixSettings {
  assignmentMode: "physical-and-virtual" | "physical-only";
  maxComponents: 2 | 3;
  recipeResolution: MixingRecipeResolution;
  accentProtection: AccentProtectionMode;
  mixPriority: VirtualMixPriorityMode;
  mappingStrategy: MappingStrategyMode;
  colourDifferenceMetric: ColourDifferenceMetric;
  previewLightnessOffset: number;
  purePhysicalThreshold: number;
  physicalDirectDeltaE: number;
  autoPhysicalDirect: boolean;
}

export interface ExportSettings {
  /** The printer the file is for (engine/printers.ts): decides the slicer format, bed and slot limit. */
  printerId: string;
  /** Colour printers: the file format; null takes the printer's first. */
  colourFormat: "3mf" | "obj" | "wrl" | "ply" | null;
  fileName: string;
  /**
   * Which way up the model goes (@core/orientation).  It belongs to the model:
   * loading another file sets it again from that file (App installModel).
   */
  coordinateMode: ExportCoordinateMode;
  scale: number;
  targetHeight: number | null;
  /** Write each separate piece as its own 3MF object (PrusaSlicer's own split erases the paint). */
  splitObjects: boolean;
  putOnBed: boolean;
  centerOnBed: boolean;
  bedX: number;
  bedY: number;
  defaultExtruder: number;
  includePrinterConfig: boolean;
  /** Quality preset written into the exported printer config; null keeps the template's. */
  printPreset: "finest" | "high" | "normal" | "fast" | "draft" | null;
}

/** Per palette colour (keyed by hex) merge decisions. */
export interface MergeFlag {
  /** Hex of the colour this one is merged into; null / own hex = keep. */
  target: string | null;
  ambiguous: boolean;
  protect: boolean;
  minBlob: number;
}

export interface FilamentListEntry {
  name: string;
  type: string;
  hex: string;
}

export interface PipelineSettings {
  version: 1;
  /** Imported filament list (Filament-DB style: name; type; #hex). */
  filamentList: FilamentListEntry[];
  /** Keep the loaded PrusaSlicer template in the browser for next time. */
  rememberTemplate: boolean;
  /** Autosave the loaded model and its current face colours in the browser. */
  rememberWork: boolean;
  filaments: FilamentSettings;
  /**
   * Slot colours as they were before a template overwrote them, kept so one
   * undo survives a page reload (React state does not).  Null when there is
   * nothing to go back to.
   */
  filamentsUndo: FilamentSettings | null;
  palette: PaletteSettings;
  merge: MergeSettings;
  mix: MixSettings;
  export: ExportSettings;
  mergeFlags: Record<string, MergeFlag>;
  /** Palette index -> physical extruder forced by the user. */
  manualPhysical: Record<string, number>;
  /** Hand-set mixtures, keyed by the palette index the row is listed under. */
  recipeOverrides: Record<string, { counts: Record<string, number> }>;
  /**
   * Colour-strip cuts per model (by file name): where each colour family is
   * divided into groups, as fractions of the family's area, and the target
   * count they were laid out for.  Hand-moved cuts survive a reload this way.
   * `pins`: pieces split off to be groups of their own, by their colour keys
   * (each pin's colours sit at the end of their family on the strip).
   * `from`: for each pinned colour key, the colour key it had before it was
   * split off — so the piece can go back to the group it came from.
   */
  stripByModel: Record<string, { target: number; cuts: Record<string, number[]>; pins?: number[][]; from?: Record<string, number> }>;
}

export const FILAMENT_PRESETS: Array<{ name: string; hex: string[]; label: string }> = [
  { name: "XL5-WKCMY", label: "XL 5T: 흰 / 검 / 시안 / 마젠타 / 노랑", hex: ["#FFFFFF", "#111111", "#00B7EB", "#E4007C", "#FFE600"] },
  { name: "XL5-WKRBY", label: "XL 5T: 흰 / 검 / 빨강 / 파랑 / 노랑", hex: ["#FFFFFF", "#111111", "#C2001A", "#0065AA", "#EABD00"] },
  { name: "XL5-skin", label: "XL 5T 인물: 흰 / 검 / 살색 / 빨강 / 보라", hex: ["#FFFFFF", "#111111", "#F2C9A8", "#D62828", "#5B2C83"] },
  { name: "MMU5-CMYWK", label: "MMU3 5색: CMY + 흰 / 검", hex: ["#00FFFF", "#FF00FF", "#FFFF00", "#FFFFFF", "#000000"] },
  { name: "8-CMYWK+RGB", label: "8색: CMYWK + 빨 / 초 / 파", hex: ["#00FFFF", "#FF00FF", "#FFFF00", "#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF"] },
];

/** Export height used when nothing else is set; see export.targetHeight below. */
export const DEFAULT_TARGET_HEIGHT = 70;

export const DEFAULT_SETTINGS: PipelineSettings = {
  version: 1,
  filamentList: [],
  rememberTemplate: true,
  rememberWork: true,
  filaments: {
    count: 5,
    hex: ["#FFFFFF", "#111111", "#00B7EB", "#E4007C", "#FFE600", "#FF0000", "#00FF00", "#0000FF", "#FF8C00", "#8E44AD", "#8B5A2B", "#FF69B4", "#808080", "#00A86B", "#D4AF37", "#87CEEB"],
    names: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12", "E13", "E14", "E15", "E16"],
  },
  filamentsUndo: null,
  stripByModel: {},
  palette: { maxColours: 16, accentProtection: "off" },
  merge: {
    ambiguousMaxSaturation: 0.25,
    ambiguousMinValue: 0.3,
    ambiguousMaxValue: 0.85,
    ambiguousMinAreaPercent: 3,
    protectMaxAreaPercent: 1,
    protectMinSaturation: 0.5,
    minBlobDefault: 150,
    minBlobSkin: 60,
    minBlobDark: 120,
    propagationRounds: 80,
    smoothingRounds: 3,
    smoothProtected: false,
  },
  mix: {
    assignmentMode: "physical-and-virtual",
    maxComponents: 2,
    recipeResolution: "thirds",
    accentProtection: "off",
    mixPriority: "accurate",
    mappingStrategy: "closest",
    colourDifferenceMetric: "ciede2000",
    previewLightnessOffset: 0,
    purePhysicalThreshold: 0.985,
    physicalDirectDeltaE: 6,
    autoPhysicalDirect: true,
  },
  export: {
    printerId: "prusa-xl5",
    colourFormat: null,
    fileName: "",
    coordinateMode: "keep",
    scale: 1,
    // Nomad/Rodin meshes arrive at unit scale (a 2 mm model), which slices into a
    // handful of layers and looks single-coloured. Default every export to 70 mm.
    targetHeight: DEFAULT_TARGET_HEIGHT,
    splitObjects: true,
    putOnBed: true,
    centerOnBed: true,
    bedX: 360,
    bedY: 360,
    defaultExtruder: 1,
    includePrinterConfig: false,
    printPreset: null,
  },
  mergeFlags: {},
  manualPhysical: {},
  recipeOverrides: {},
};

export type ViewName = "front" | "back" | "left" | "right" | "top" | "iso";
export type PreviewMode = "source" | "palette" | "print";
