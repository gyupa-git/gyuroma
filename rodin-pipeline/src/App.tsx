import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { MeshModel, PaletteEntry, PhysicalSlot, RGB } from "@core/types";
import { rgbToHex } from "@core/colour";
import { addCut, buildColourStrip, colourKey as stripColourKey, groupsFromCuts, initialCuts, normaliseCuts, removeCut, stripLabels, stripPalette, type ColourStripData, type StripColour, type StripCuts, type StripGroup } from "@core/colourStrip";
import { buildVirtualExtruderPlan } from "@core/virtualExtruders";
import { applyAssignmentOverridesToPlan, type AssignmentOverride } from "@core/assignmentOverrides";
import { applyRecipeOverridesToPlan, normaliseRecipeCounts, type RecipeOverride } from "@core/recipeOverrides";
import { resolveCoordinateMode, transformNoTranslation } from "@core/export3mf";
import { combineTurns, turnMode, turnRows, type FixedCoordinateMode } from "@core/orientation";
import { accentPaletteIndices, fidelityScore, scoreSlotSet } from "@core/spoolAdvice";
import { loadRodin3mf, RODIN_TEXTURE_MODE_MESSAGE } from "@core/rodin3mf";
import { parseObjFile } from "@core/objParser";
import { readTemplate3mf, type Template3mfInfo } from "@core/template3mf";
import { buildFaceAdjacency, type FaceAdjacency } from "@core/meshAdjacency";
import {
  groupWeightFractions,
  isLikelyAmbiguousColour,
  isLikelyProtectedColour,
  isDarkColour,
  isSkinLikeColour,
  mergeWithReprojection,
} from "@core/mergeReprojection";
import { buildExportAssignments, buildPrusa3mfBlob, buildTransform, validateExportAssignments } from "@core/export3mf";
import { buildColourFile } from "@core/exportColour";
import { nearestPaletteIndex } from "@core/quantize";
import { BAMBU_STUDIO_MAX_FILAMENTS, findPrinter, templateFitsPrinter } from "./engine/printers";
import { decodePaintCode } from "@core/paintCodes";
import { applyNomadObjToModel, buildNomadObj, NOMAD_NEW_MODEL_WARNING, NOMAD_OFF_PALETTE_WARNING, nomadRemeshWarning, parseNomadObj } from "@core/nomadRoundTrip";
import { apparentLayerRgbs, deltaE2000, linearToSrgb, rgbToLab, srgbToLinear, type LAB } from "@core/prusaFdmMixer";
import { downloadBlob, downloadText } from "@core/exportCsv";
import {
  CUT_SPAN,
  DEFAULT_SETTINGS,
  MAX_PHYSICAL,
  MIN_PHYSICAL,
  type MergeFlag,
  type MergeSettings,
  type PipelineSettings,
  type PreviewMode,
  type ViewName,
} from "./engine/types";
import {
  areaFractionByPosition,
  buildColourBuffer,
  patchColourBuffer,
  buildPositions,
  colourKey,
  countUniqueColours,
  faceGeometry,
  facesInSphere,
  hexToRgb,
  highlightGeometry,
  highlightGeometryCut,
  smoothVertexNormals,
  type FaceGeometry,
  type HighlightCut,
  maskFromLabels,
  representativeColoursByPosition,
  sameLabelComponent,
  triangleAreaWeights,
  modelRadius,
  packedFaceColours,
  linearToSrgbByte,
  SRGB_TO_LINEAR,
  FACE_BYTES,
  type ColourBuffer,
} from "./engine/mesh";
import {
  clearStoredWorkEverywhere,
  dataDelete,
  dataGet,
  dataSet,
  downloadTextFile,
  isStoredWorkColours,
  isStoredWorkFile,
  loadServerSettings,
  loadStoredSettings,
  localServerAvailable,
  mergeSettings,
  packColours,
  settingsToJson,
  storeServerSettings,
  storeSettings,
  isStoredWorkCuts,
  packRuns,
  unpackColours,
  unpackRuns,
  WORK_COLOURS_KEY,
  WORK_CUTS_KEY,
  WORK_FILE_KEY,
  type StoredCut,
  type StoredWorkColours,
  type StoredWorkCuts,
  type StoredWorkFile,
} from "./engine/storage";
import { MeshViewer, VIEW_DIRECTIONS, type CameraPose, type Callout, type FocusMode, type HighlightOverlay, type LayerPreview, type MeshViewerHandle, type PickInfo, type ViewerCut, type ViewerHit } from "./ui/MeshViewer";
import { meshWithCut, type BorderCut } from "@core/borderCut";
import { fillSmallHoles } from "@core/meshHoles";
import { cutBorders, CutSuperseded } from "./engine/borderCutClient";
import { ColourStrip, type StripOutput } from "./ui/ColourStrip";
import { CleanupPanel, TargetSection } from "./ui/CleanupPanel";
import { ColourMap, type ColourMapHandle } from "./ui/ColourMap";
import { loadStoredBackground, storeBackground, type ViewBackground } from "./ui/background";
import { blendRecipeText } from "./engine/plan";
import { atlasPointOnFace, buildFaceAtlas, buildPatchAtlas, faceAtlasPoint, facesUnderMapBrush, type AtlasMasks, type FaceAtlas } from "./engine/atlas";
import { cancelUnfold, unfoldInWorker, UnfoldSuperseded } from "./engine/unfoldClient";
import { specksIn } from "./engine/specks";
import { HelpTip } from "./ui/HelpTip";
import { GyupaLoader, GyupaSpin } from "./ui/GyupaLoader";
import { LoadSection, type SourceInfo } from "./ui/LoadSection";
import { FilamentSection } from "./ui/FilamentSection";
import { MergeSection, type MergeReportData } from "./ui/MergeSection";
import { MixSection, type PhysicalDirectSuggestion } from "./ui/MixSection";
import { buildMatrixRows, MappingMatrix, summariseRows } from "./ui/MappingMatrix";
import { RecipeDetail } from "./ui/RecipeDetail";
import { BandingPanel, outputsFromRows } from "./ui/BandingPanel";
import { TidyPanel, type TidyResultCard } from "./ui/TidyPanel";
import { edgeChanges, measurePatchEdge, type PatchEdge } from "./engine/patchEdge";
import { cleanGaps, discDiameter, piecesOf as placesOf } from "./engine/gapClean";
import { NO_TONE, isNoTone, sameTone, toneColours, type Tone, type ToneColour, type ToneWalls } from "./engine/groupTone";
import { cutsKeepingGroups } from "./engine/stripCuts";
import { faceOfGroupNear } from "./engine/cutPick";
import { packWorkFile, readWorkFile, WORK_FILE_EXT, WorkFileError, workFileName, type WorkFileContents } from "./engine/workFile";
import { WITH_CLAUDE } from "./features";
import { regionPixels, renderFaceIds, renderNumberedViews, renderViews, withGrid } from "./ui/snapshot";
import { markRegion } from "./engine/wand";
import { mapPicture, numberedMapPicture, regionAtlas } from "./ui/mapShots";
import type { AttachedImage } from "./ui/attachImage";
import { cellParts, faceCentroids, facePartsOf, partsBySpill, shapeCells, summariseParts, tidyByParts, type ShapeCells, type ShapePart } from "./engine/shapeParts";
import { findRegions } from "./engine/regions";
import { creaseGeometry, faceConcavity, fillUnlabelled, findPits, snapToCreases, type CreaseGeometry, type Pit } from "./engine/creases";
import { regionBlobs, type BlobMap } from "./engine/blobs";
import { ConnectionLine, KeyForm } from "./ui/TidyPanel";
import { ConsultBox } from "./ui/ConsultBox";
import { aiAsk, aiStatus, loadApiKey, loadKeyUsage, maskKey, saveApiKey, type AiRoute, type KeyUsage } from "./engine/aiClient";
import { adviceKey, ask } from "./engine/adviceClient";
import { recommendMixOption } from "@core/mixAdvice";
import {
  describeChanges,
  hasCleanChanges,
  hasColourEdits,
  hasRecipeChanges,
  presetChanges,
  sanitizeChanges,
  focusPrompt,
  shapePrompt,
  SHAPE_SCHEMA,
  ASSIGN_SCHEMA,
  assignPrompt,
  REVIEW_SCHEMA,
  reviewPrompt,
  sanitizeReview,
  POINT_SCHEMA,
  pointPrompt,
  sanitizePoints,
  type TidyAssignment,
  paletteSchemaFor,
  palettePrompt,
  sanitizeAssign,
  sanitizePalette,
  tidyStablePrompt,
  tidyTurnPrompt,
  TIDY_SCHEMA,
  type TidyExportInfo,
  type TidyShape,
  type ChangeLine,
  type TidyChanges,
  type TidyContext,
  type TidyLogEntry,
  type TidyMixScore,
  type TidyPreset,
  type TidyConsultPreset,
  type TidyScope,
} from "./engine/tidy";
import { pickedOnly, pickedValueLines, type TidyArea } from "./engine/tidyArea";
import { findPrintPreset } from "@core/printPresets";
import { shareNewColours } from "@core/rgbPool";
import { limitTidyToPicked } from "./engine/tidyArea";
import { ExportSection, faceOnBed, type ExportCheck } from "./ui/ExportSection";
import { NumberField, Swatch, pct, pctNumber } from "./ui/common";
import { Brand, Glossary, Icon, Intro, Menu, Segmented, StepNav, Welcome, supportLinks } from "./ui/Shell";
import { ColourSelect } from "./ui/ColourSelect";
import { ColourPicker } from "./ui/ColourPicker";
import { GatherDialog } from "./ui/GatherDialog";
import { GuideTour, type GuideMode } from "./ui/GuideTour";
import { dueHint, markHintsSeen } from "./guide";
import { GyupaFaceIcon } from "./ui/GuideGyupa";
import { countAction } from "./engine/counter";
import { LangContext, loadStoredLang, storeLang, translate, type Lang, type Params, type Key } from "./i18n";

const APP_VERSION = "0.7.0";
/** The public copy: its source and the licence the footer points to. */
const SOURCE_URL = "https://github.com/gyupa-git/gyuroma";

/** The left panel: narrow enough for three panels, wide enough to drag out for the long tables. */
const LEFT_MIN = 260;
const LEFT_DEFAULT = 300;
/** The right panel: its own width in step 02 (the colour strip) and in steps 03-04 (recipes, banding). */
const RIGHT_MIN = 240;
const rightDefault = (key: string) => (key === "2" ? 264 : 344);
/** Step 03: the share of the stage's height the mapping matrix takes, under the 3D view. */
const MATRIX_DEFAULT = 0.44;

/** A remembered layout size, or null. */
function storedSize(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function storeSize(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

type CompareMode = "source" | "both" | "result";

/** Flat colours / soft edges of the two views: [source, result]. */
interface PaneLook {
  flat: [boolean, boolean];
  soft: [boolean, boolean];
}
const PANE_LOOK_KEY = "rodin-pipeline-pane-look";
function loadPaneLook(): PaneLook {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PANE_LOOK_KEY) ?? "null") as Partial<PaneLook> | null;
    if (stored && Array.isArray(stored.flat) && Array.isArray(stored.soft))
      return { flat: [Boolean(stored.flat[0]), Boolean(stored.flat[1])], soft: [Boolean(stored.soft[0]), Boolean(stored.soft[1])] };
    // From before the views had their own: one switch for both.
    const flat = window.localStorage.getItem("rodin-pipeline-flat") === "1";
    const soft = window.localStorage.getItem("rodin-pipeline-soft-edges") !== "0";
    return { flat: [flat, flat], soft: [soft, soft] };
  } catch {
    return { flat: [false, false], soft: [true, true] };
  }
}
/**
 * The face a point on a picture means: round the point (a few pixels off is usual), a face of the region whose own
 * colour is the thing's as the AI saw it; none like it near → -1, the point dropped rather than spread over a
 * neighbour (11-04 Tkc: a point meant for a bag's stripe fell on the skirt, and the skirt went yellow).
 */
function seedUnderPoint(ids: Int32Array, size: number, x: number, y: number, inRegion: Uint8Array | null, lab: Float32Array, source: string | null): number {
  const want = source ? rgbToLab(hexToRgb(source)) : null;
  let seed = -1;
  let bestScore = Infinity;
  for (let dy = -12; dy <= 12; dy++)
    for (let dx = -12; dx <= 12; dx++) {
      const px = Math.round(x) + dx, py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const f = ids[py * size + px];
      if (f < 0 || (inRegion && !inRegion[f])) continue;
      const off = Math.hypot(dx, dy);
      const de = want ? Math.hypot(lab[f * 3] - want.L, lab[f * 3 + 1] - want.a, lab[f * 3 + 2] - want.b) : 0;
      if (want && de > 22) continue;
      const score = de + off * 0.8;
      if (score < bestScore) {
        bestScore = score;
        seed = f;
      }
    }
  return seed;
}

/**
 * A part's cells and the cells two steps round them: what a thing pointed at in that part may spread over.
 * The part map is rough — Tkc's 'face' was one cell of a face several cells big, and a white rim round the
 * eye came out as a dotted line along the one cell (11-05).
 */
function partNeighbourhood(cells: { count: number; cellOf: ArrayLike<number>; touching: Array<Map<number, number>> }, partCells: number[], faceCount: number): Uint8Array {
  const near = new Uint8Array(cells.count);
  for (const c of partCells) near[c] = 1;
  for (let ring = 0; ring < 2; ring++) {
    const now = near.slice();
    for (let c = 0; c < cells.count; c++) if (now[c]) for (const d of cells.touching[c].keys()) near[d] = 1;
  }
  const within = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) if (near[cells.cellOf[f]]) within[f] = 1;
  return within;
}

/** Most faces the colour map unfolds in one go (the solver's time grows with them; a whole body is not one piece anyway). */
const UNFOLD_MAX_FACES = 800_000;

/** A share in per cent, short: 0.04 → "0.04", 3.2 → "3.2", 41 → "41". */
function formatPct(pct: number): string {
  return pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2);
}

/** A toolbar toggle over both views: on, off, or "mixed" when they differ. */
function pairPressed(pair: [boolean, boolean]): boolean | "mixed" {
  return pair[0] === pair[1] ? pair[0] : "mixed";
}

/** From this much closer than the whole-model fit, the consult also gets the view on screen. */
const CLOSE_UP_ZOOM = 1.6;
/**
 * Cells of the shape step: enough that a part (an arm, a sleeve, the face) is a few of them
 * and its border falls near the real one, few enough that their numbers stay readable on
 * six 640-pixel pictures (about 30 a picture).
 */
const SHAPE_CELL_COUNT = 90;
/** Tints of the part map in 3D (one a part, in order). */
const PART_TINTS = ["#E6194B", "#3CB44B", "#FFE119", "#4363D8", "#F58231", "#911EB4", "#42D4F4", "#F032E6", "#BFEF45", "#FABED4", "#469990", "#DCBEFF", "#9A6324", "#FFFAC8", "#800000", "#AAFFC3", "#808000", "#FFD8B1", "#000075", "#A9A9A9"];
const SIX_VIEWS: ViewName[] = ["front", "back", "left", "right", "top", "iso"];
/** 🤖 every part up close: this many parts asked at once (each answer takes half a minute or so). */
const AUTO_PARALLEL = 4;
/** 🤖 after the first pass, this many more: the result looked at next to the original, what is wrong asked again. */
const AUTO_REVIEWS = 2;

/** The part map kept for a model: its cells (0-based) per part, for the mesh it was made on. */
interface StoredPartMap {
  faces: number;
  cells: number;
  subject: string;
  parts: ShapePart[];
  at: string;
}

const NO_OVERLAYS: HighlightOverlay[] = [];
const NO_CALLOUTS: Callout[] = [];
/** A face's centroid, as barycentric weights. */
const EVEN_THIRDS: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];
/** From here a model is big enough that the tab's memory may run short in a long session: the app says so. */
const BIG_MODEL_FACES = 2_000_000;
/**
 * Whether keys go into a field being typed in (its own ⌘Z, Esc, [ ]); a
 * slider or a checkbox with the focus does not count, so ⌘Z still undoes
 * right after the edge slider was used.
 */
function typingIn(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.tagName === "TEXTAREA" || target.isContentEditable) return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(type);
}
const NO_FOCUS = { mask: null, mode: "normal" as const };
/** Gap clean, picked bits: melting more than this share of the surface asks first. */
const GAP_PICK_ASK_SHARE = 0.02;
/**
 * Gap clean, picked bits: a place this wide on the print (the diameter of a
 * disc of its area, mm) or wider is asked about before it melts — a dot of a
 * millimetre shows on a figure, the bits wedged in gaps are far smaller.
 */
const GAP_BIG_DIAMETER_MM = 1;
/** Outline shapes kept per model (bytes): every colour of a million-face model fits. */
const OVERLAY_SHAPE_BUDGET = 160 * 1024 * 1024;
/** On a big model the outlines kept are fewer, and none is worked out ahead (11-05: the cache filled 160 MB there). */
const OVERLAY_SHAPE_BUDGET_BIG = 40 * 1024 * 1024;
type UndoKind = "strip" | "colours" | "mesh";

/** A confirmed cut as an undo step: the model before and after it, and the original colours of each. */
interface MeshStep {
  before: MeshModel;
  after: MeshModel;
  originalBefore: RGB[] | null;
  originalAfter: RGB[] | null;
  /** The cut as it was shown before the confirm: undone, it shows again at once (no flicker while it is worked out anew). */
  shown: CutLayer;
}

/** A cut worked out for the result view, with what it was worked out for. */
interface CutLayer {
  triangles: MeshModel["triangles"];
  /** The palette's colours in order (the cut's groups are positions in it). */
  paletteKey: string;
  /** The same colours one by one, to find a group again when the palette is numbered anew. */
  paletteHex: string[];
  labels: Int32Array;
  cut: BorderCut;
}
/** The same group for every face (two label arrays alike, value by value). */
function sameGroups(a: Int32Array, b: Int32Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Confirmed cuts kept for undo (each holds the model before it: ~30 MB of arrays at 2.4 million faces, its parts shared). */
const MESH_UNDO_LIMIT = 5;
/**
 * One change made in a recipe panel, for that panel's own undo (the work's
 * undo ⌘Z does not touch recipe choices): which panel, the colour it was made
 * on, the colours it touched and their choices (mixture, forced filament)
 * before it, in words too.
 */
interface RecipeStep {
  source: "recipe" | "band";
  row: number;
  indices: number[];
  overrides: PipelineSettings["recipeOverrides"];
  manual: PipelineSettings["manualPhysical"];
  before: string;
}

/** What the last strip edit did, shown over the views with an undo button. */
interface StripToast {
  kind: "merge" | "split";
  from: string[];
  to: string;
  /** Group count before and after. */
  counts: [number, number];
  /** Area of the group that kept its colour, before and after. */
  area: [number, number];
  /** The one output every merged group printed as, when they all printed the same. */
  sameOutput: string | null;
  outputs: string[];
  at: number;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "model";
}

/**
 * How a freshly loaded file stands: OBJ (Nomad, Blender) is written Y-up and
 * 3MF is Z-up by its spec.  Following the file beats guessing from its shape —
 * "the longest side up" laid wide figures (a big head, a key on the back) on
 * their side.
 */
function orientationFor(kind: SourceInfo["kind"]): FixedCoordinateMode {
  return kind === "rodin" ? "keep" : "blender-y-up";
}

function yieldToUi(ms = 30): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Step 02's settings once a tidy's clean changes are in: island size,
 * smoothing, protected and merged colours.  The whole-model tidy keeps them;
 * the picked-patch tidy bakes with them once and leaves the settings alone.
 */
function cleanSettingsAfter(
  merge: MergeSettings,
  mergeFlags: Record<string, MergeFlag>,
  changes: TidyChanges,
): { merge: MergeSettings; mergeFlags: Record<string, MergeFlag> } {
  const flags = { ...mergeFlags };
  const next = { ...merge };
  if (changes.minBlob !== undefined) {
    // Skin and dark colours keep their default proportions (60 and 120 of 150): small
    // features there (lips, pupils) are kept a little longer.
    next.minBlobDefault = changes.minBlob;
    next.minBlobSkin = Math.round((changes.minBlob * 60) / 150);
    next.minBlobDark = Math.round((changes.minBlob * 120) / 150);
    // Every colour carries its own size (filled in when it first appeared); the
    // default alone would change nothing for the colours already there.
    for (const hex of Object.keys(flags)) {
      const rgb = hexToRgb(hex);
      flags[hex] = { ...flags[hex], minBlob: isSkinLikeColour(rgb) ? next.minBlobSkin : isDarkColour(rgb) ? next.minBlobDark : next.minBlobDefault };
    }
  }
  if (changes.smoothing !== undefined) next.smoothingRounds = changes.smoothing;
  if (changes.smoothProtected !== undefined) next.smoothProtected = changes.smoothProtected;
  if (changes.trimTeeth !== undefined) next.trimRounds = changes.trimTeeth;
  if (changes.lineSmooth !== undefined) next.lineSpan = changes.lineSmooth;
  const flagOf = (hex: string) => flags[hex] ?? { target: null, ambiguous: false, protect: false, minBlob: next.minBlobDefault };
  for (const hex of changes.protect ?? []) flags[hex] = { ...flagOf(hex), protect: true };
  for (const hex of changes.unprotect ?? []) flags[hex] = { ...flagOf(hex), protect: false };
  for (const m of changes.merge ?? []) flags[m.from] = { ...flagOf(m.from), target: m.into };
  return { merge: next, mergeFlags: flags };
}

type StoredStrip = PipelineSettings["stripByModel"][string];

/** Pinned pieces as colour key -> pin, from what the strip stores. */
function pinMap(pins: number[][] | undefined): Map<number, number> | undefined {
  if (!pins || pins.length === 0) return undefined;
  const map = new Map<number, number>();
  pins.forEach((keys, pin) => {
    for (const key of keys) map.set(key, pin);
  });
  return map;
}

/** The pins with only the colours the strip still has (a pin left with none is gone). */
function livePins(pins: number[][] | undefined, strip: ColourStripData): number[][] | undefined {
  if (!pins || pins.length === 0) return undefined;
  const present = new Set<number>();
  for (const family of strip.families) for (const colour of family.colours) present.add(colour.key);
  // Nothing gone: the same pins (the strip worked out ahead for them is used as it is).
  if (pins.every((keys) => keys.every((key) => present.has(key)))) return pins;
  const out = pins.map((keys) => keys.filter((key) => present.has(key))).filter((keys) => keys.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * What the strip stores: these cuts for `target`, and the pinned pieces if
 * there are any, with the colour each pinned colour had before it was split
 * off (only for colours still pinned).
 */
function stripStore(target: number, cuts: StripCuts, pins: number[][] | undefined, from?: Record<string, number>): StoredStrip {
  const stored: StoredStrip = { target, cuts: cuts as unknown as Record<string, number[]> };
  if (pins && pins.length > 0) {
    stored.pins = pins;
    const kept: Record<string, number> = {};
    for (const keys of pins) for (const key of keys) if (from?.[key] !== undefined) kept[key] = from[key];
    if (Object.keys(kept).length > 0) stored.from = kept;
  }
  return stored;
}

/**
 * A short print of a strip (each colour and its share of the area), to tell
 * whether cuts kept for one set of face colours fit the colours shown now.
 */
function stripPrint(strip: ColourStripData): string {
  let h = 2166136261;
  const mix = (n: number) => {
    h ^= n;
    h = Math.imul(h, 16777619) >>> 0;
  };
  let total = 0;
  for (const family of strip.families) total += family.weight;
  for (const family of strip.families) {
    mix(family.family + 1);
    for (const colour of family.colours) {
      mix(colour.key);
      mix(Math.round((total > 0 ? colour.weight / total : 0) * 1e7));
    }
  }
  return h.toString(36);
}

/** The strip's cuts forgotten (laid out again from the target) — the pinned pieces kept. */
function forgetCuts(strips: Record<string, StoredStrip>, key: string): void {
  const pins = strips[key]?.pins;
  if (pins && pins.length > 0) strips[key] = { target: -1, cuts: {}, pins, ...(strips[key]?.from ? { from: strips[key].from } : {}) };
  else delete strips[key];
}

/** Where split-off pieces go back to, after the colours they came from changed (`moved`: old key -> new key). */
function fromMoved(from: Record<string, number> | undefined, moved: (key: number) => number | undefined): Record<string, number> | undefined {
  if (!from) return undefined;
  const out: Record<string, number> = {};
  for (const [key, was] of Object.entries(from)) out[key] = moved(was) ?? was;
  return out;
}

/** A colour key's colour. */
const rgbOfKey = (key: number): RGB => [(key >> 16) & 255, (key >> 8) & 255, key & 255];

/** A colour's merge flags (and every flag merging into it) moved to its new hex. */
function carryFlags(flags: Record<string, MergeFlag>, from: string, to: string): Record<string, MergeFlag> {
  const out = { ...flags };
  const own = out[from];
  if (own) {
    delete out[from];
    out[to] = { ...own, target: own.target === to ? null : own.target };
  }
  for (const key of Object.keys(out)) if (out[key].target === from) out[key] = { ...out[key], target: to };
  return out;
}

/** Small (under 2 %) vivid colours protected: eyes, lips, the flower's centre. */
function protectSmallVivid(flags: Record<string, MergeFlag>, palette: PaletteEntry[], areaByPosition: ArrayLike<number>): Record<string, MergeFlag> {
  const out = { ...flags };
  palette.forEach((entry, position) => {
    const hex = rgbToHex(entry.rgb);
    const [r, g, b] = entry.rgb;
    const max = Math.max(r, g, b);
    const saturation = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    if ((areaByPosition[position] ?? 0) < 0.02 && saturation >= 0.3) out[hex] = { ...out[hex], protect: true };
  });
  return out;
}

/** Where the current model came from; kept so the work autosave can store the file bytes. */
interface WorkSource {
  file: File;
  kind: StoredWorkFile["kind"];
  /** Palette a Nomad OBJ was snapped to (needed to re-import it identically). */
  palette?: RGB[];
}

/** One connected patch of a single palette colour, picked in the preview. */
interface PickedPatch {
  /** Smallest face index of the patch (stable identity for toggling). */
  id: number;
  faces: Int32Array;
  hex: string;
  index: number;
  fraction: number;
  /** The face that was clicked: the tag's dot sits on it. */
  anchor: number;
}

/**
 * Gap clean, picked bits: the places big enough to be a detail, each shown and
 * asked about (keep it, or melt it too) before anything melts.
 */
interface GapReview {
  /** Every face that would melt. */
  melt: Int32Array;
  /** The big places, largest first, and their print areas (mm²). */
  places: Int32Array[];
  areas: number[];
  /** Answers so far, one per place: true = keep it. */
  keep: boolean[];
  /** The selection as it was, back if the review is stopped. */
  before: { picked: PickedPatch[]; chosen: string[]; shown: string | null };
}

interface LoadedModel {
  model: MeshModel;
  info: SourceInfo;
  status: string;
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(() => loadStoredLang());
  const t = useCallback((key: Key, params?: Params) => translate(lang, key, params), [lang]);
  useEffect(() => {
    document.title = translate(lang, "app.docTitle");
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    storeLang(next);
  }, []);
  const [settings, setSettings] = useState<PipelineSettings>(() => loadStoredSettings());
  const [model, setModel] = useState<MeshModel | null>(null);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [history, setHistory] = useState<RGB[][]>([]);
  const [future, setFuture] = useState<RGB[][]>([]);
  const [template, setTemplate] = useState<{ info: Template3mfInfo; buffer: ArrayBuffer } | null>(null);
  const [lastExport, setLastExport] = useState<{ fileName: string; blob: Blob; at: number } | null>(null);
  /** Slots as they were before "use the template's colours", for one undo. */
  const [exportOutcome, setExportOutcome] = useState<{ kind: "ok" | "error"; message: string; at: number } | null>(null);
  /** What picking a printer changed, with its undo (shown under the picker). */
  const [printerNotice, setPrinterNotice] = useState<{ changes: string[]; undo: () => void } | null>(null);
  /** Slot count and layer mixing a printer pick turned down, to give back when the next printer allows them. */
  const printerTakenRef = useRef<{ count: number | null; mixing: boolean }>({ count: null, mixing: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState(() => translate(loadStoredLang(), "status.ready"));
  const [mergeReport, setMergeReport] = useState<MergeReportData | null>(null);
  // ✨ Auto tidy (presets + Claude consult).
  const [tidyScope, setTidyScopeState] = useState<TidyScope>(() => {
    try {
      const stored = window.localStorage.getItem("rodin-pipeline-tidy-scope");
      return stored === "mix" || stored === "both" ? stored : "clean";
    } catch {
      return "clean";
    }
  });
  const setTidyScope = (next: TidyScope) => {
    setTidyScopeState(next);
    try {
      window.localStorage.setItem("rodin-pipeline-tidy-scope", next);
    } catch {
      // ignore
    }
  };
  // Where a preset applies: the whole model, or only the patches picked in 3D.
  const [tidyArea, setTidyAreaState] = useState<TidyArea>(() => {
    try {
      return window.localStorage.getItem("rodin-pipeline-tidy-area") === "picked" ? "picked" : "model";
    } catch {
      return "model";
    }
  });
  /** The area went to "picked" by itself, on picking: it goes back to the whole model when the pick goes. */
  const tidyAreaAutoRef = useRef(false);
  const setTidyArea = (next: TidyArea) => {
    tidyAreaAutoRef.current = false;
    setTidyAreaState(next);
    try {
      window.localStorage.setItem("rodin-pipeline-tidy-area", next);
    } catch {
      // ignore
    }
  };
  const [tidyLog, setTidyLog] = useState<TidyLogEntry[]>([]);
  const tidyLogLoaded = useRef(false);
  const [tidyBusy, setTidyBusy] = useState<string | null>(null);
  /** The part 🎯 is working on (its chip shows the working face). */
  const [focusBusyPart, setFocusBusyPart] = useState<string | null>(null);
  const [tidyElapsed, setTidyElapsed] = useState(0);
  const tidyAbortRef = useRef<AbortController | null>(null);
  /** This computer's Claude login through the app's server (null while checking). */
  const [localAi, setLocalAi] = useState<boolean | null>(null);
  /** Or the person's own API key, kept in this browser. */
  const [apiKey, setApiKey] = useState<string | null>(loadApiKey);
  const [keyUsage, setKeyUsage] = useState<KeyUsage>(loadKeyUsage);
  const aiRoute: AiRoute | null = localAi ? "local" : apiKey ? "key" : null;
  const aiAvailable = localAi === null ? null : aiRoute !== null;
  const [tidyResult, setTidyResult] = useState<TidyResultCard | null>(null);
  /** Fields changed by the last tidy (yellow on the panels) until hidden. */
  const [tidyHighlight, setTidyHighlight] = useState<Set<string> | null>(null);
  /**
   * The colours before the first tidy of a run of tidies, and the colours the
   * last tidy left.  While the model still shows that result, a new tidy
   * starts over from the colours before: a new target lays out the original
   * strip again instead of the already reduced one.
   */
  const tidyChainRef = useRef<{ base: RGB[]; result: RGB[] | null } | null>(null);
  /**
   * What each tidy replaced (its settings and the colours before it), newest
   * last: ↩ goes back one tidy at a time, all the way to the start.  A press
   * that changed nothing adds no step.  Emptied when another model opens.
   */
  const tidyUndoRef = useRef<
    Array<{
      entryId: string;
      title: string;
      lines: ChangeLine[];
      settings: Pick<PipelineSettings, "palette" | "merge" | "mergeFlags" | "stripByModel" | "mix"> & Partial<Pick<PipelineSettings, "recipeOverrides" | "manualPhysical" | "export">>;
      colours: RGB[];
      chain: { base: RGB[]; result: RGB[] | null } | null;
      /** Colours a picked-patch tidy left (it bakes outside the tidy chain), and how many faces it changed. */
      result?: RGB[];
      faces?: number;
      /** The colour history's newest entry when the tidy started (null: it was empty): the tidy's own steps come after it. */
      historyTop?: RGB[] | null;
    }>
  >([]);
  /** How many tidies ↩ can still take back (shown on the button). */
  const [tidyUndoCount, setTidyUndoCount] = useState(0);
  const pushTidyUndo = (step: (typeof tidyUndoRef.current)[number]) => {
    tidyUndoRef.current = [...tidyUndoRef.current.slice(-29), step];
    setTidyUndoCount(tidyUndoRef.current.length);
  };
  const forgetTidyUndo = () => {
    tidyUndoRef.current = [];
    tidyChainRef.current = null;
    setTidyUndoCount(0);
  };
  /** A tidy waiting for its new palette before it bakes (02's Tidy up). */
  const [pendingTidy, setPendingTidy] = useState<{ entryId: string; protectAccents: boolean } | null>(null);
  /** The part map per model (shape first: what it is, which cells make each part), kept in user-data. */
  const [partMaps, setPartMaps] = useState<Record<string, StoredPartMap>>({});
  const partMapsLoaded = useRef(false);
  /** The part map shown in 3D, each part in its tint. */
  const [partView, setPartView] = useState(false);
  const shapeCellsRef = useRef<{ triangles: MeshModel["triangles"]; cells: ShapeCells } | null>(null);
  /** A plan's settings, waiting for the colours it painted to be in before they bake. */
  const [pendingPlan, setPendingPlan] = useState<{ changes: TidyChanges; entryId: string; title: string; lines: ChangeLine[]; dropped?: string[]; colours: RGB[] } | null>(null);
  /** Pictures of the colours before the tidy, kept while those colours stay (the cached part of the consult). */
  const tidyStableShotsRef = useRef<{ colours: RGB[]; urls: string[] } | null>(null);
  const [nomadReport, setNomadReport] = useState<{ message: string; warnings: string[] } | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("palette");
  const [background, setBackgroundState] = useState<ViewBackground>(() => loadStoredBackground());
  const setBackground = (next: ViewBackground) => {
    setBackgroundState(next);
    storeBackground(next);
  };
  const [showMap, setShowMapState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("rodin-pipeline-map") === "1";
    } catch {
      return false;
    }
  });
  const setShowMap = (next: boolean) => {
    setShowMapState(next);
    try {
      window.localStorage.setItem("rodin-pipeline-map", next ? "1" : "0");
    } catch {
      // ignore
    }
  };
  const [atlas, setAtlas] = useState<FaceAtlas | null>(null);
  // About what the app holds for this model, on the status line (11-05, the owner: "메모리 처리는 어떻게 되고
  // 있는 거야?"). Worked out from the face count — Chrome gives a page only a rounded count, minutes old
  // (0.01 GB right after a 734 k-face load); the line fits what was measured with its exact count:
  // Bvc 0.73 M faces 322 MB, Slc 2.37 M 678 MB, Tkc 4.62 M 1,295 MB (11-05, docs/메모리-2026-11-05.md).
  const memoryMb = model ? Math.round(140 + (model.triangles.length * 250) / 1e6) : null;
  const [atlasBuilding, setAtlasBuilding] = useState(false);
  const atlasRef = useRef<{ triangles: MeshModel["triangles"]; atlas: FaceAtlas } | null>(null);
  // 🧩 The picked patches unfolded in one piece on the colour map (11-05, the owner: "이 한 조각을 눌렀을 때 그 한 조각이
  // 그대로 펼쳐진 느낌으로") — on unless turned off; the whole map comes back with nothing picked or the switch off.
  const [unfoldOn, setUnfoldOnState] = useState(() => {
    try {
      return window.localStorage.getItem("rodin-pipeline-unfold") !== "0";
    } catch {
      return true;
    }
  });
  const setUnfoldOn = (on: boolean) => {
    setUnfoldOnState(on);
    try {
      window.localStorage.setItem("rodin-pipeline-unfold", on ? "1" : "0");
    } catch {
      // ignore
    }
  };
  const [unfolded, setUnfolded] = useState<{ key: string; atlas: FaceAtlas; pieces: number } | null>(null);
  const unfoldedRef = useRef(unfolded);
  unfoldedRef.current = unfolded;
  /** How far the unfold has gone (0..1) while it runs. */
  const [unfolding, setUnfolding] = useState<number | null>(null);
  /** Why the pick is not unfolded (too big, failed) — said on the map itself, not only on the status line. */
  const [unfoldNote, setUnfoldNote] = useState<string | null>(null);
  const unfoldRunningKeyRef = useRef<string | null>(null);
  const shownAtlas = unfolded?.atlas ?? atlas;
  /** The colour map as shown: the picked patches unfolded, else the whole model's. */
  const mapAtlasNow = (): FaceAtlas | null => unfoldedRef.current?.atlas ?? atlasRef.current?.atlas ?? null;
  const faceGeometryRef = useRef<{ triangles: MeshModel["triangles"]; geometry: FaceGeometry } | null>(null);
  const [brushMode, setBrushMode] = useState(false);
  /** The healing brush: the brush, but it turns only the specks of other colours lying in the brush colour, never past its outline. */
  const [healMode, setHealMode] = useState(false);
  const healOnRef = useRef(false);
  healOnRef.current = brushMode && healMode;
  /** The plain brush is on (its "only inside the selected patches" box is there), and that box: for the S key. */
  const maskKeyRef = useRef({ on: false, checked: false });
  /** Turning the healing brush on with a colour off the palette: the first palette colour is taken (it paints palette colours only). */
  const healPickRef = useRef<() => void>(() => {});
  /** The healing brush's inner circle (model units): its tip — what lies under it is healed; never wider than the brush. */
  const [healSize, setHealSize] = useState(0.5);
  /** Where the brush circles were last shown, so a size change redraws them there. */
  const brushHitRef = useRef<ViewerHit | null>(null);
  /** "얼룩 없애기": a patch of more faces than this stays (set beside the button; follows the model's size at first). */
  const [speckFaces, setSpeckFaces] = useState(600);
  const [brushRadius, setBrushRadius] = useState(1);
  // Off by default: a brush held to a selection paints nothing until something
  // is selected, and "nothing happens" is the one failure a tool must not have.
  const [brushMaskOnly, setBrushMaskOnly] = useState(false);
  maskKeyRef.current = { on: brushMode && !healMode, checked: brushMaskOnly };
  /** Solo / x-ray view of whatever is highlighted (picked patches and selected colours). */
  const [focusMode, setFocusMode] = useState<FocusMode>("normal");
  const [eyedropper, setEyedropper] = useState(false);
  const eyedropperRef = useRef(false);
  eyedropperRef.current = eyedropper;
  /** Space held over the views: a hand — the left button moves the view sideways, whatever tool is on. */
  const [hand, setHand] = useState(false);
  const handRef = useRef(false);
  handRef.current = hand;
  /** Fill tool: a click fills the patch under it, or the whole selection when clicked inside it. */
  const [fillMode, setFillMode] = useState(false);
  const fillModeRef = useRef(false);
  fillModeRef.current = fillMode;
  /**
   * Gap clean (C): clicks add patches to the selection; Enter or the bar's
   * button turns the colours wedged between the picked colours ("part", the
   * default), melts the picked bits themselves into what is around them
   * ("picked": a double click takes every place of that colour) or, after a
   * warning, cleans between any two colours ("all").
   */
  const [gapMode, setGapMode] = useState(false);
  const gapModeRef = useRef(false);
  gapModeRef.current = gapMode;
  const [gapScope, setGapScope] = useState<"part" | "picked" | "all">("part");
  /** Runs the gap clean when it can run now (for Enter). */
  const gapRunRef = useRef<(() => void) | null>(null);
  /** After a gap clean between patches: faces to pick again once the colours are in. */
  const regrabRef = useRef<number[] | null>(null);
  const [gapReview, setGapReview] = useState<GapReview | null>(null);
  const gapReviewRef = useRef<GapReview | null>(null);
  gapReviewRef.current = gapReview;
  /** A picked place at least this wide on the print (mm) is asked about first. */
  const [gapBigMm, setGapBigMm] = useState(GAP_BIG_DIAMETER_MM);
  const [coloursVersion, setColoursVersion] = useState(0);
  const strokeRef = useRef<{ working: RGB[]; mask: Uint8Array | null; count: number; rgb: RGB; hex: string; changed: number[]; healed: Uint8Array | null; relabel: Map<number, number> | null; healColours: Set<number> | null } | null>(null);
  /**
   * A brush stroke just committed: which faces it painted, from which colours to
   * which.  A stroke changes only those faces, so the colour buffers, the labels and
   * the map are patched for them instead of being built again for every face of the
   * model — on a model of a million faces that was a second of work after every stroke.
   * `exact`: the painted faces show the brush colour itself in the palette view too
   * (the brush colour is a palette colour), so the live painting already looks right.
   */
  const strokePatchRef = useRef<{ from: RGB[]; to: RGB[]; faces: Int32Array; rgb: RGB; exact: boolean } | null>(null);
  /** The committed stroke, when it is exactly the step from the colours a buffer was built for to the colours now. */
  const strokePatchFor = (from: RGB[] | null | undefined, to: RGB[]) => {
    const patch = strokePatchRef.current;
    return patch && patch.to === to && patch.from === from ? patch : null;
  };
  const viewerRef0 = useRef<MeshViewerHandle>(null);
  const viewerRef1 = useRef<MeshViewerHandle>(null);
  const viewerRef2 = useRef<MeshViewerHandle>(null);
  const viewerRefs = [viewerRef0, viewerRef1, viewerRef2];
  const mapRef = useRef<ColourMapHandle | null>(null);
  // Flat colours and soft edges for each side (0 = source, 1 = result), so the
  // two can be compared; the toolbar buttons set both.  Display only,
  // remembered per browser.
  const [paneLook, setPaneLookState] = useState<PaneLook>(loadPaneLook);
  // Form lines over flat colours (both views; on unless turned off).
  const [formLines, setFormLinesState] = useState(() => {
    try {
      return window.localStorage.getItem("rodin-pipeline-form-lines") !== "0";
    } catch {
      return true;
    }
  });
  const setFormLines = (on: boolean) => {
    setFormLinesState(on);
    try {
      window.localStorage.setItem("rodin-pipeline-form-lines", on ? "1" : "0");
    } catch {
      // ignore
    }
  };
  const setPaneLook = (key: keyof PaneLook, pane: 0 | 1 | "both", value: boolean) => {
    setPaneLookState((prev) => {
      const pair: [boolean, boolean] = pane === "both" ? [value, value] : pane === 0 ? [value, prev[key][1]] : [prev[key][0], value];
      const next = { ...prev, [key]: pair };
      try {
        window.localStorage.setItem(PANE_LOOK_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };
  const [view, setView] = useState<ViewName>("front");
  const [fitNonce, setFitNonce] = useState(0);
  const [hoverHex, setHoverHex] = useState<string | null>(null);
  const [selectedHexes, setSelectedHexes] = useState<string[]>([]);
  const [pickedPatches, setPickedPatches] = useState<PickedPatch[]>([]);
  // The edge slider of the picked patches (see engine/patchEdge.ts): 50 = as they were picked.
  const [edgeValue, setEdgeValue] = useState(50);
  const [edgeCount, setEdgeCount] = useState({ join: 0, leave: 0 });
  /**
   * One go of the edge slider: the colours, patches and cuts it started from
   * (the edges measured once), how the faces that can move looked then, which
   * of them show changed now, and what the last letting-go left.  The slider
   * stays where it is let go, and every position is worked out from the start,
   * so the middle is the start again.
   */
  const edgeSessionRef = useRef<{
    base: RGB[];
    edges: Array<PatchEdge | null>;
    look: Map<number, RGB>;
    groupOfKey: Map<number, string>;
    cuts: PipelineSettings["stripByModel"][string] | null;
    shown: Map<number, RGB>;
    kept: Map<number, RGB>;
    left: RGB[] | null;
    touched: boolean;
  } | null>(null);
  /** After the edge moved: faces deep inside each patch, to pick the patches again once the colours are in. */
  const edgeRepickRef = useRef<number[] | null>(null);
  /** True while that picking-again happens (it keeps the go going). */
  const edgeRepickingRef = useRef(false);
  /** The colour sliders on the left card, from where the adjustment started. */
  const [tone, setTone] = useState<Tone>(NO_TONE);
  /** The card's group's colour as the sliders have it while they move. */
  const [toneHex, setToneHex] = useState<string | null>(null);
  /** The group's colour before the adjustment began. */
  const [toneStart, setToneStart] = useState<string | null>(null);
  /** The next group of the same family whose lightness the brightness slider has reached, if it has. */
  const [toneWall, setToneWall] = useState<string | null>(null);
  /** With a patch picked: adjust only the picked pieces (the default) or the whole group. */
  const [toneScopeChoice, setToneScopeChoice] = useState<"piece" | "group">("piece");
  /**
   * One go of the colour sliders on the card's group: the colours and cuts it
   * started from, the group's shades and the faces of each, every other
   * group's colours (a shade never lands on one of them), and what the last
   * letting-go left.  Like the edge slider, the sliders stay where they are
   * let go and every position is worked out from the start.
   */
  const toneSessionRef = useRef<{
    /** The whole group, or only the picked pieces of it (which then split off as a group of their own). */
    scope: "group" | "piece";
    /** The picked pieces it was started for (their anchors), for the piece scope. */
    pickKey: string;
    base: RGB[];
    hexStart: string;
    /** The group's colour after the last letting-go, and the one before (the card may still show it for a moment). */
    hexNow: string;
    hexPrev: string;
    colours: StripColour[];
    repKey: number;
    faces: Int32Array;
    /** Per face of `faces`: its shade in `colours`. */
    shade: Int32Array;
    taken: Set<number>;
    /** Lightness the shades stay between, and the groups there (lighter, darker) if any. */
    walls: ToneWalls;
    lighter: StripGroup | null;
    darker: StripGroup | null;
    groupOfKey: Map<number, string>;
    groupId: string;
    cuts: PipelineSettings["stripByModel"][string] | null;
    /** The pinned pieces at the start, and which of them is this group (a pinned group adjusted as a whole). */
    pins: number[][];
    pin: number | undefined;
    /** What each pinned colour was before it was split off, at the start. */
    from: Record<string, number>;
    shown: Tone;
    kept: Tone;
    left: RGB[] | null;
    touched: boolean;
  } | null>(null);
  /** A group's colour before and after each adjustment, so a choice of it follows ⌘Z and redo. */
  const hexTwinsRef = useRef(new Map<string, Set<string>>());
  const pickedRef = useRef<PickedPatch[]>([]);
  pickedRef.current = pickedPatches;
  /** Fills the picked patches when that is possible right now (for Enter). */
  const fillPickRef = useRef<(() => void) | null>(null);
  // Turning the brush on with patches picked keeps it inside them; with
  // nothing picked it paints freely.  Brush and fill are one tool at a time.
  useEffect(() => {
    if (!brushMode) return;
    setBrushMaskOnly(pickedRef.current.length > 0);
    setFillMode(false);
    setGapMode(false);
  }, [brushMode]);
  useEffect(() => {
    if (!fillMode) return;
    setBrushMode(false);
    setGapMode(false);
  }, [fillMode]);
  // The gap clean picks as the select tool does: no brush, fill or eyedropper with it.
  useEffect(() => {
    if (!gapMode) return;
    setBrushMode(false);
    setFillMode(false);
    setEyedropper(false);
  }, [gapMode]);
  useEffect(() => {
    if (eyedropper) setGapMode(false);
  }, [eyedropper]);
  /** Colour mode: every patch of this colour is outlined; clicks add/remove patches. */
  const [shownHex, setShownHex] = useState<string | null>(null);
  const shownHexRef = useRef<string | null>(null);
  shownHexRef.current = shownHex;
  const [pickTarget, setPickTarget] = useState("");
  const [pickCustom, setPickCustom] = useState("#FF0000");
  /** The colour being chosen in the picker, laid over the selection meanwhile (null: the picker is closed). */
  const [pickPreviewHex, setPickPreviewHex] = useState<string | null>(null);
  /** The group card's picker while open: the faces it paints, and whether the views show its colour yet. */
  const groupPickRef = useRef<{ faces: Int32Array; touched: boolean } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const templateRestoredRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const stored = Number(window.localStorage.getItem("rodin-pipeline-left-width"));
      return Number.isFinite(stored) && stored >= LEFT_MIN ? stored : LEFT_DEFAULT;
    } catch {
      return LEFT_DEFAULT;
    }
  });
  const [rightWidths, setRightWidths] = useState<Record<string, number>>(() => {
    const stored = storedSize("rodin-pipeline-right-width");
    const widths: Record<string, number> = {};
    if (stored && typeof stored === "object")
      for (const [key, value] of Object.entries(stored)) if (typeof value === "number" && value >= RIGHT_MIN) widths[key] = value;
    return widths;
  });
  const [matrixShare, setMatrixShare] = useState<number>(() => {
    const stored = storedSize("rodin-pipeline-matrix-share");
    return typeof stored === "number" && stored >= 0.1 && stored <= 0.85 ? stored : MATRIX_DEFAULT;
  });
  /** 모아 뽑기 is open (it keeps its files while closed). */
  const [gatherOpen, setGatherOpen] = useState(false);
  /** The app guide: Gyupa walking the screen (ui/GuideTour, the lines in guide.ts), or one first-time hint. */
  const [guideMode, setGuideMode] = useState<GuideMode | null>(null);
  /** Which of the four steps is on screen (load · colours · filaments · export). */
  const [step, setStepState] = useState<number>(() => {
    try {
      const stored = Number(window.localStorage.getItem("rodin-pipeline-step"));
      return stored >= 1 && stored <= 4 ? stored : 1;
    } catch {
      return 1;
    }
  });
  const setStep = (next: number) => {
    setStepState(next);
    // Each tab's consult talks about that tab: 03 about the mixing, 02 about the colours ("both" stays as chosen).
    if (next === 3 && tidyScope === "clean") setTidyScope("mix");
    if (next === 2 && tidyScope === "mix") setTidyScope("clean");
    try {
      window.localStorage.setItem("rodin-pipeline-step", String(next));
    } catch {
      // ignore
    }
  };
  /** Steps 01–02: original only, both side by side, or the result only. */
  const [compare, setCompareState] = useState<CompareMode>(() => {
    try {
      const stored = window.localStorage.getItem("rodin-pipeline-compare");
      return stored === "source" || stored === "result" ? stored : "both";
    } catch {
      return "both";
    }
  });
  const setCompare = (next: CompareMode) => {
    setCompareState(next);
    try {
      window.localStorage.setItem("rodin-pipeline-compare", next);
    } catch {
      // ignore
    }
  };
  const undoOrderRef = useRef<UndoKind[]>([]);
  /** Confirmed cuts for undo and redo, and the order redo takes them in among colour steps. */
  const meshUndoRef = useRef<MeshStep[]>([]);
  const meshRedoRef = useRef<MeshStep[]>([]);
  const redoOrderRef = useRef<Array<"colours" | "mesh">>([]);
  /** The cuts confirmed into a mesh so far, in order (by its faces array): what autosave stores and a restore makes again. */
  const cutLogRef = useRef(new WeakMap<MeshModel["triangles"], StoredCut[]>());
  /** Each face's group colour right after its mesh was last cut (3 bytes a face, by the faces array). */
  const settledRef = useRef(new WeakMap<MeshModel["triangles"], Uint8Array>());
  /** 1 for the faces the confirmed cuts made (pieces): the cut line itself, never drawn afresh (borderLines `cutFaces`). */
  const cutFacesRef = useRef(new WeakMap<MeshModel["triangles"], Uint8Array>());
  const lastSavedCutsRef = useRef<StoredCut[] | null>(null);
  /** Autosaves go one after another (saveLineRef); only the newest waiting one runs (saveTicketRef). */
  const saveLineRef = useRef<Promise<void>>(Promise.resolve());
  const saveTicketRef = useRef(0);
  const settledKeysRef = useRef(new WeakMap<Uint8Array, Int32Array>());
  /** Area weights worked out ahead for a mesh about to be shown (a confirmed cut), by its faces array. */
  const areaWeightsAhead = useRef(new WeakMap<MeshModel["triangles"], Float32Array>());
  const mainRef = useRef<HTMLDivElement | null>(null);
  const matrixScrollRef = useRef<HTMLDivElement | null>(null);
  const linkRowRef = useRef<HTMLDivElement | null>(null);
  const linkCardRef = useRef<HTMLDivElement | null>(null);
  const [link, setLink] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  /** Where the line from the selected matrix row to its detail card runs (null when either is off screen). */
  const measureLink = useCallback(() => {
    const main = mainRef.current;
    const row = linkRowRef.current;
    const card = linkCardRef.current;
    const scroller = matrixScrollRef.current;
    let next: { x1: number; y1: number; x2: number; y2: number } | null = null;
    if (main && row && card && scroller) {
      const m = main.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const y = r.top + r.height / 2;
      if (y > box.top + 26 && y < box.bottom - 4)
        // The row can be wider than the matrix (many tools): start at the edge that shows.
        next = { x1: Math.round(Math.min(r.right, box.right) - m.left - 6), y1: Math.round(y - m.top), x2: Math.round(c.left - m.left + 4), y2: Math.round(c.top + c.height / 2 - m.top) };
    }
    setLink((prev) => (prev === next || (prev && next && prev.x1 === next.x1 && prev.y1 === next.y1 && prev.x2 === next.x2 && prev.y2 === next.y2) ? prev : next));
  }, []);
  useLayoutEffect(() => {
    measureLink();
  });
  useEffect(() => {
    window.addEventListener("resize", measureLink);
    return () => window.removeEventListener("resize", measureLink);
  }, [measureLink]);
  const [toast, setToast] = useState<StripToast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 9000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  /** Step 04: the print simulation or the layer preview, and the layer height being previewed. */
  const [exportView, setExportView] = useState<"sim" | "layers">("layers");
  const [previewLayerHeight, setPreviewLayerHeight] = useState<number | null>(null);
  const [bandLabel, setBandLabel] = useState<string | null>(null);
  /** Step 03 shows one view; this is what it is coloured by. */
  const [singleMode, setSingleMode] = useState<PreviewMode>("print");
  const [splitterDragging, setSplitterDragging] = useState<"left" | "right" | "matrix" | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const adjacencyRef = useRef<{ triangles: MeshModel["triangles"]; adjacency: FaceAdjacency } | null>(null);
  const modelFileRef = useRef<WorkSource | null>(null);
  const modelRef = useRef<MeshModel | null>(null);
  modelRef.current = model;
  /** Face colours right after parsing the file (the "original" the undo stack bottoms out at). */
  const originalColoursRef = useRef<RGB[] | null>(null);
  /** Last colour array handed to the autosave effect (skips re-saving what is already stored). */
  const lastSavedColoursRef = useRef<RGB[] | null>(null);
  /** Increments on every model install/clear so stale async saves and restores are dropped. */
  const loadGenerationRef = useRef(0);
  const workRestoredRef = useRef(false);
  const rememberWorkRef = useRef(settings.rememberWork);
  const [workRestored, setWorkRestored] = useState(false);
  // The welcome plays over the window each time the app opens, and again from the settings menu (about).
  const [intro, setIntro] = useState(true);
  const endIntro = useCallback(() => setIntro(false), []);
  // the saved work is still loading at startup (the intro waits for it)
  const [startupLoading, setStartupLoading] = useState(true);
  const [about, setAbout] = useState(false);
  const endAbout = useCallback(() => setAbout(false), []);
  const [autosave, setAutosave] = useState<{ state: "none" | "saving" | "saved" | "failed"; at: number | null }>({ state: "none", at: null });

  // Settings live in the browser and, when the app runs from its own local server, as
  // rodin-pipeline/user-data/settings (survives port, browser and profile changes).
  const settingsSyncReadyRef = useRef(false);
  const [storageMode, setStorageMode] = useState<"browser" | "folder">("browser");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const available = await localServerAvailable();
      if (cancelled) return;
      if (available) {
        const fromServer = await loadServerSettings();
        if (cancelled) return;
        setStorageMode("folder");
        if (fromServer) setSettings(fromServer);
        else await storeServerSettings(loadStoredSettings());
      }
      settingsSyncReadyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    storeSettings(settings);
    if (!settingsSyncReadyRef.current) return;
    const timer = window.setTimeout(() => void storeServerSettings(settings), 300);
    return () => window.clearTimeout(timer);
  }, [settings]);

  const patchSettings = useCallback(<K extends keyof PipelineSettings>(key: K, value: PipelineSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  /**
   * A site's store in the browser is "best effort" unless the site asks: when
   * the disk runs low the browser may clear it.  Asked (the browser decides —
   * Chrome says yes to sites in use), the autosave stays until someone clears
   * the site's data.  null = not known.
   */
  const [storageKept, setStorageKept] = useState<boolean | null>(null);
  useEffect(() => {
    if (!settings.rememberWork) return;
    let cancelled = false;
    void (async () => {
      try {
        const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
        if (!storage?.persist) return;
        const kept = (await storage.persisted()) || (await storage.persist());
        if (!cancelled) setStorageKept(kept);
      } catch {
        // not offered here
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.rememberWork]);

  // Leaving by accident — a reload, the back button or swipe, the tab closed —
  // asks first while a model is open: the work is autosaved, but the steps to
  // undo and the view are not, and a big model takes a second or two to store
  // (leaving before it is down loses the last change).
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!modelRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  // ------------------------------------------------------------------
  // Derived data
  // ------------------------------------------------------------------
  // Geometry-only inputs: keyed on vertices/triangles so recolouring (merge, patch recolour, undo)
  // neither rebuilds the viewer geometry nor resets its camera.
  const geometryVertices = model?.vertices ?? null;
  const geometryTriangles = model?.triangles ?? null;
  /** The model vertex of every corner (3 per face), for the viewers' soft colour borders. */
  const cornerVertex = useMemo(() => {
    if (!geometryTriangles) return null;
    const out = new Int32Array(geometryTriangles.length * 3);
    for (let i = 0; i < geometryTriangles.length; i++) {
      const tri = geometryTriangles[i];
      out[i * 3] = tri[0];
      out[i * 3 + 1] = tri[1];
      out[i * 3 + 2] = tri[2];
    }
    return out;
  }, [geometryTriangles]);
  const areaWeights = useMemo(
    () => (model ? (areaWeightsAhead.current.get(model.triangles) ?? triangleAreaWeights(model)) : new Float32Array(0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryVertices, geometryTriangles],
  );
  const areaWeightList = useMemo(() => Array.from(areaWeights), [areaWeights]);
  /** The model's whole area (model units²), for turning a face count into a printed size. */
  const areaTotal = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < areaWeights.length; i++) sum += areaWeights[i];
    return sum;
  }, [areaWeights]);
  // The preview stands the model the way the export will place it, so what is
  // on screen is what comes out of the slicer.
  /** The orientation the previews are drawn in (the one the model exports in). */
  const viewMode = useMemo(
    () => (model ? resolveCoordinateMode(settings.export.coordinateMode, model.vertices) : "keep"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryVertices, settings.export.coordinateMode],
  );

  /**
   * Model space -> what the viewers show.  Everything drawn on top of the mesh
   * has to go through this as well: highlights built straight from the model's
   * own vertices used to stay in the old orientation, so a selection on a
   * standing figure was drawn lying down beside it.
   */
  const toViewSpace = useCallback(
    (src: Float32Array): Float32Array => {
      if (viewMode === "keep") return src;
      // The modes are linear (axis swaps and sign flips), so the images of the
      // three axes are the whole transform — no per-point call or array.
      const [ax, ay, az] = transformNoTranslation([1, 0, 0], viewMode, 1);
      const [bx, by, bz] = transformNoTranslation([0, 1, 0], viewMode, 1);
      const [cx, cy, cz] = transformNoTranslation([0, 0, 1], viewMode, 1);
      const out = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i];
        const y = src[i + 1];
        const z = src[i + 2];
        out[i] = x * ax + y * bx + z * cx;
        out[i + 1] = x * ay + y * by + z * cy;
        out[i + 2] = x * az + y * bz + z * cz;
      }
      return out;
    },
    [viewMode],
  );

  /**
   * One point back from what the viewer reports to the model's own
   * coordinates.  The viewers pick and draw in view space; the brush, the
   * face geometry and the colours all live in model space.  The modes are
   * axis swaps and sign flips, so the inverse is the transpose: dot the point
   * with the images of the three axes.
   */
  const pointToModel = useCallback(
    (point: [number, number, number]): [number, number, number] => {
      if (viewMode === "keep") return point;
      const ux = transformNoTranslation([1, 0, 0], viewMode, 1);
      const uy = transformNoTranslation([0, 1, 0], viewMode, 1);
      const uz = transformNoTranslation([0, 0, 1], viewMode, 1);
      const dot = (u: [number, number, number]) => u[0] * point[0] + u[1] * point[1] + u[2] * point[2];
      return [dot(ux), dot(uy), dot(uz)];
    },
    [viewMode],
  );

  const pointToView = useCallback(
    (point: [number, number, number]): [number, number, number] =>
      viewMode === "keep" ? point : transformNoTranslation(point, viewMode, 1),
    [viewMode],
  );

  const positions = useMemo(
    () => (model ? toViewSpace(buildPositions(model)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryVertices, geometryTriangles, toViewSpace],
  );

  /** Smooth normals per model vertex, for the outline shell around a highlight. */
  const vertexNormals = useMemo(
    () => (model ? smoothVertexNormals(model) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryVertices, geometryTriangles],
  );

  // ------------------------------------------------------------------
  // The colour strip: the model's colours by family, cut into groups.  The
  // groups are the palette; no face colour changes until "정리 실행" bakes it.
  // ------------------------------------------------------------------
  const stripKey = sourceInfo?.fileName ?? "";
  const targetGroups = settings.palette.maxColours;
  const storedStrip = settings.stripByModel[stripKey];
  // Pieces split off as groups of their own: their colours sit at the end of their family.
  const pins = useMemo(() => pinMap(storedStrip?.pins), [storedStrip?.pins]);
  /** The last strip worked out ahead for new colours (keepGroupsFor), so the render does not build it again. */
  const stripAheadRef = useRef<{ colours: RGB[]; weights: typeof areaWeightList; pins: typeof pins; strip: ColourStripData } | null>(null);
  const stripFor = (colours: RGB[]): ColourStripData => {
    const ahead = stripAheadRef.current;
    if (ahead && ahead.colours === colours && ahead.weights === areaWeightList && ahead.pins === pins) return ahead.strip;
    const strip = buildColourStrip(colours, areaWeightList, pins);
    stripAheadRef.current = { colours, weights: areaWeightList, pins, strip };
    return strip;
  };
  const stripData = useMemo(
    () => (model ? stripFor(model.triangleColors) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, areaWeightList, pins],
  );
  const committedCuts = useMemo<StripCuts>(() => {
    if (!stripData) return {};
    if (storedStrip && storedStrip.target === targetGroups) {
      // Cuts kept for edited colours (a fill, a stroke) fit only those: with other colours — the
      // file opened afresh, without its work — the cuts from before the edits stand.
      if (!storedStrip.for || storedStrip.for === stripPrint(stripData)) return storedStrip.cuts as unknown as StripCuts;
      if (storedStrip.base && storedStrip.base.target === targetGroups) return storedStrip.base.cuts as unknown as StripCuts;
    }
    return initialCuts(stripData, targetGroups);
  }, [stripData, storedStrip, targetGroups]);
  /** Cuts being dragged right now; null while the strip is at rest. */
  const [previewCuts, setPreviewCuts] = useState<StripCuts | null>(null);
  const [stripUndo, setStripUndo] = useState<StripCuts[]>([]);
  /**
   * The spectrum's cuts that go with a set of face colours, for a change that
   * moved both (a band turned into another): ⌘Z and redo put them back together.
   */
  const cutsWithColours = useRef(new WeakMap<RGB[], PipelineSettings["stripByModel"][string] | null>());
  const [recipeSteps, setRecipeSteps] = useState<RecipeStep[]>([]);
  useEffect(() => {
    setPreviewCuts(null);
    setStripUndo([]);
  }, [stripKey]);
  const committedGroups = useMemo(() => (stripData ? groupsFromCuts(stripData, committedCuts) : []), [stripData, committedCuts]);
  const liveGroups = useMemo(
    () => (stripData && previewCuts ? groupsFromCuts(stripData, previewCuts) : committedGroups),
    [stripData, previewCuts, committedGroups],
  );
  /** The labels last worked out, so a brush stroke only relabels the faces it painted. */
  const labelsRef = useRef<{ colours: RGB[]; paletteKey: string; labels: Int32Array; palette: PaletteEntry[] } | null>(null);
  const { palette, labels, positionOfKey } = useMemo(() => {
    if (!model || !stripData) return { palette: [] as PaletteEntry[], labels: new Int32Array(0), positionOfKey: new Map<number, number>() };
    const built = stripPalette(committedGroups);
    const paletteKey = built.palette.map((entry) => rgbToHex(entry.rgb)).join(",");
    const prev = labelsRef.current;
    const patch = strokePatchFor(prev?.colours, model.triangleColors);
    let faceLabels: Int32Array;
    if (patch && prev && prev.paletteKey === paletteKey && prev.labels.length === model.triangles.length) {
      // The same palette: only the painted faces change group, and the groups' counts with them.
      // A new array all the same, so what was worked out from the old labels is not taken for these.
      faceLabels = prev.labels.slice();
      const position = built.groupOfKey.get(stripColourKey(patch.rgb)) ?? 0;
      const counts = prev.palette.map((entry) => entry.count ?? 0);
      for (let i = 0; i < patch.faces.length; i++) {
        const f = patch.faces[i];
        counts[faceLabels[f]]--;
        faceLabels[f] = position;
        counts[position]++;
      }
      built.palette.forEach((entry, p) => {
        entry.count = counts[p];
      });
      const shown = built.palette[position]?.rgb;
      patch.exact = Boolean(shown && shown[0] === patch.rgb[0] && shown[1] === patch.rgb[1] && shown[2] === patch.rgb[2]);
    } else {
      faceLabels = stripLabels(model.triangleColors, built.groupOfKey, built.palette);
    }
    labelsRef.current = { colours: model.triangleColors, paletteKey, labels: faceLabels, palette: built.palette };
    return { palette: built.palette, labels: faceLabels, positionOfKey: built.groupOfKey };
  }, [model, stripData, committedGroups]);
  const areaByPosition = useMemo(() => areaFractionByPosition(labels, palette.length, areaWeights), [labels, palette.length, areaWeights]);

  /**
   * The print choices made by hand in 03 (one filament alone, a re-mixed
   * recipe) are kept by palette number, and the palette is numbered anew when
   * a band is split or merged or a colour change moves a group.  They follow
   * the colour they were made for: each old entry's colour, found in the new
   * palette, takes its choice along (a colour gone takes it away).  They used
   * to be wiped on every colour change and every reload instead.
   */
  const choicesPaletteRef = useRef<{ generation: number; keys: number[] } | null>(null);
  useEffect(() => {
    const before = choicesPaletteRef.current;
    const generation = loadGenerationRef.current;
    if (palette.length === 0) return;
    const keys = palette.map((entry) => stripColourKey(entry.rgb));
    choicesPaletteRef.current = { generation, keys };
    // Another model, or the work just put back: its choices are numbered for this palette already.
    if (!before || before.generation !== generation) return;
    const moved = new Map<number, number>();
    before.keys.forEach((key, position) => {
      const now = positionOfKey.get(key);
      if (now !== undefined) moved.set(position + 1, now + 1);
    });
    if (moved.size === before.keys.length && [...moved].every(([from, to]) => from === to)) return;
    const carry = <T,>(choices: Record<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [key, value] of Object.entries(choices)) {
        const to = moved.get(Number(key));
        if (to !== undefined && out[String(to)] === undefined) out[String(to)] = value;
      }
      return out;
    };
    setSettings((prev) => {
      if (Object.keys(prev.manualPhysical).length === 0 && Object.keys(prev.recipeOverrides).length === 0) return prev;
      return { ...prev, manualPhysical: carry(prev.manualPhysical), recipeOverrides: carry(prev.recipeOverrides) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  /** The colours differ from the loaded file's own (what "원본 색으로" would put back). */
  const coloursChanged = useMemo(() => {
    const original = originalColoursRef.current;
    const colours = model?.triangleColors;
    if (!colours || !original || colours === original) return false;
    if (colours.length !== original.length) return true;
    for (let f = 0; f < colours.length; f++) {
      const a = colours[f];
      const b = original[f];
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return true;
    }
    return false;
  }, [model?.triangleColors]);

  /**
   * New face colours that move faces from one group to another (a fill, a
   * stroke, a gap clean, a tidy of picked patches) keep every colour in the
   * group it is in.  The spectrum's cuts are shares of each family's area: left
   * as they were, they fall on other colours once the areas change, and groups
   * shift — patches turning up out of nowhere, a group's colour (and the
   * "change to" colour) changing.  `also` names the group of a colour that is
   * new (a palette colour given a new value).  ⌘Z puts the cuts back with the colours.
   */
  function keepGroupsFor(before: RGB[], next: RGB[], also?: Map<number, string>, pinned?: { pins: number[][] | undefined; from: Record<string, number> | undefined }): void {
    if (!stripData || !model || model.triangleColors !== before || before === next) return;
    const groupOfKey = new Map<number, string>();
    for (const group of committedGroups) for (const colour of group.colours) groupOfKey.set(colour.key, `${group.family}:${group.index}`);
    // A colour already in a group stays there (a colour given another group's value joins that group).
    if (also) for (const [key, name] of also) if (!groupOfKey.has(key)) groupOfKey.set(key, name);
    const pinsNext = pinned ? pinned.pins : storedStrip?.pins;
    const strip = pinned ? buildColourStrip(next, areaWeightList, pinMap(pinned.pins)) : stripFor(next);
    const stored = stripStore(targetGroups, cutsKeepingGroups(strip, groupOfKey), livePins(pinsNext, strip), pinned ? pinned.from : storedStrip?.from);
    // These cuts fit these colours only; the ones from before the first such edit go along (see committedCuts).
    const previous = settings.stripByModel[stripKey];
    const base = previous?.for ? previous.base : previous ? { target: previous.target, cuts: previous.cuts } : undefined;
    stored.for = stripPrint(strip);
    if (base) stored.base = base;
    cutsWithColours.current.set(before, previous ?? null);
    cutsWithColours.current.set(next, stored);
    setSettings((prev) => ({ ...prev, stripByModel: { ...prev.stripByModel, [stripKey]: stored } }));
  }
  const areaByIndex = useMemo(() => {
    const map = new Map<number, number>();
    palette.forEach((entry, position) => map.set(entry.index, areaByPosition[position] ?? 0));
    return map;
  }, [palette, areaByPosition]);

  const slots = useMemo<PhysicalSlot[]>(
    () =>
      Array.from({ length: settings.filaments.count }, (_v, i) => {
        const rgb = hexToRgb(settings.filaments.hex[i] ?? "#808080");
        return {
          slot: i + 1,
          filament: {
            name: settings.filaments.names[i] || `E${i + 1}`,
            type: "",
            rgb,
            effectiveRgb: rgb,
            sourceLine: settings.filaments.hex[i] ?? "",
          },
          role: "fixed physical colour",
        };
      }),
    [settings.filaments],
  );

  const basePlan = useMemo(() => {
    if (palette.length === 0 || slots.length === 0) return null;
    const mix = settings.mix;
    return buildVirtualExtruderPlan(palette, slots, {
      maxComponents: mix.assignmentMode === "physical-only" ? 1 : mix.maxComponents,
      virtualStartId: slots.length + 1,
      purePhysicalThreshold: mix.purePhysicalThreshold,
      recipeResolution: mix.recipeResolution,
      accentProtection: mix.accentProtection,
      mixPriority: mix.mixPriority,
      mappingStrategy: mix.mappingStrategy,
      colourDifferenceMetric: mix.colourDifferenceMetric,
      previewLightnessOffset: mix.previewLightnessOffset,
    });
  }, [palette, slots, settings.mix]);

  const suggestions = useMemo(() => {
    const map = new Map<number, PhysicalDirectSuggestion>();
    if (!basePlan || slots.length === 0) return map;
    const slotLabs = slots.map((slot) => ({ slot: slot.slot, lab: rgbToLab(slot.filament.effectiveRgb) }));
    const byIndex = new Map(palette.map((entry) => [entry.index, entry]));
    for (const blend of basePlan.virtualBlends) {
      for (const paletteIndex of blend.targetPaletteIndices) {
        const entry = byIndex.get(paletteIndex);
        if (!entry) continue;
        const lab = rgbToLab(entry.rgb);
        let best: PhysicalDirectSuggestion | null = null;
        for (const candidate of slotLabs) {
          const deltaE = deltaE2000(lab, candidate.lab);
          if (!best || deltaE < best.deltaE) best = { extruder: candidate.slot, deltaE };
        }
        if (best && best.deltaE < settings.mix.physicalDirectDeltaE) map.set(paletteIndex, best);
      }
    }
    return map;
  }, [basePlan, palette, slots, settings.mix.physicalDirectDeltaE]);

  const plan = useMemo(() => {
    if (!basePlan) return null;
    const overrides: Record<number, AssignmentOverride> = {};
    if (settings.mix.autoPhysicalDirect) {
      for (const [paletteIndex, suggestion] of suggestions) overrides[paletteIndex] = { kind: "physical", extruder: suggestion.extruder };
    }
    for (const [key, extruder] of Object.entries(settings.manualPhysical)) {
      const paletteIndex = Number(key);
      if (Number.isFinite(paletteIndex) && extruder >= 1 && extruder <= slots.length) overrides[paletteIndex] = { kind: "physical", extruder };
    }
    const assigned = applyAssignmentOverridesToPlan(basePlan, palette, slots, overrides);
    // Hand-set mixtures are applied last: they replace the recipe of one row
    // without disturbing which colour is assigned where.
    const recipes: Record<number, RecipeOverride> = {};
    for (const [key, value] of Object.entries(settings.recipeOverrides)) {
      const paletteIndex = Number(key);
      if (!Number.isFinite(paletteIndex) || !value?.counts) continue;
      const counts: Record<number, number> = {};
      let missingSlot = false;
      for (const [extruder, count] of Object.entries(value.counts)) {
        const slot = Number(extruder);
        if (!Number.isFinite(slot) || !(count > 0)) continue;
        counts[slot] = count;
        if (slot > slots.length) missingSlot = true;
      }
      // A hand-set mixture that needs a slot no longer there (fewer slots, a
      // smaller printer) rests until it is back; the automatic recipe stands in.
      if (!missingSlot && Object.keys(counts).length > 0) recipes[paletteIndex] = { counts };
    }
    return applyRecipeOverridesToPlan(assigned, palette, slots, recipes, {
      colourDifferenceMetric: settings.mix.colourDifferenceMetric,
    });
  }, [
    basePlan,
    palette,
    slots,
    suggestions,
    settings.mix.autoPhysicalDirect,
    settings.manualPhysical,
    settings.recipeOverrides,
    settings.mix.colourDifferenceMetric,
  ]);

  // What section 5 shows just before the print: the colour result in the same
  // numbers the filament and mixing sections use.
  const finalCheck = useMemo(() => {
    if (!plan || palette.length === 0 || slots.length === 0) return null;
    const score = scoreSlotSet(palette, slots, {
      accentIndices: accentPaletteIndices(palette),
      maxComponents: settings.mix.assignmentMode === "physical-only" ? 1 : settings.mix.maxComponents,
      recipeResolution: settings.mix.recipeResolution,
      purePhysicalThreshold: settings.mix.purePhysicalThreshold,
      accentProtection: settings.mix.accentProtection,
      mixPriority: settings.mix.mixPriority,
      mappingStrategy: settings.mix.mappingStrategy,
      colourDifferenceMetric: settings.mix.colourDifferenceMetric,
    });
    const cycles = plan.virtualBlends
      .filter((blend) => blend.components.length > 1)
      .map((blend) => blend.sequence.length);
    return {
      fidelity: fidelityScore(score),
      cycleLayers: cycles.length > 0 ? Math.max(...cycles) : 1,
      layerHeightMm: findPrintPreset(settings.export.printPreset)?.layerHeight ?? template?.info?.layerHeight ?? null,
      lost: score.lost.map((entry) => ({ paletteIndex: entry.paletteIndex, hex: rgbToHex(entry.rgb) })),
      worstDeltaE: plan.mappingDiagnostics.worstError,
      poorCount: plan.mappingDiagnostics.poorMatchCount,
      colourCount: palette.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, palette, slots, settings.mix, template, settings.export.printPreset]);

  /** The layer height the print will use: the chosen quality preset, else the template's. */
  const layerHeightMm = findPrintPreset(settings.export.printPreset)?.layerHeight ?? template?.info?.layerHeight ?? null;
  const matrixRows = useMemo(
    () => buildMatrixRows(plan, palette, areaByIndex, settings.mix.colourDifferenceMetric, settings.recipeOverrides, settings.manualPhysical),
    [plan, palette, areaByIndex, settings.mix.colourDifferenceMetric, settings.recipeOverrides, settings.manualPhysical],
  );
  const matrixSummary = useMemo(
    () => summariseRows(matrixRows, finalCheck?.fidelity ?? null, finalCheck?.lost.length ?? 0, slots.length, plan?.virtualBlends.length ?? 0),
    [matrixRows, finalCheck, slots.length, plan],
  );
  /** How much of the model's surface each slot shows: layer share × area, summed over the rows. */
  const shareBySlot = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of matrixRows) {
      const total = Object.values(row.counts).reduce((sum, n) => sum + n, 0) || 1;
      for (const [slot, count] of Object.entries(row.counts)) map.set(Number(slot), (map.get(Number(slot)) ?? 0) + (count / total) * row.area);
    }
    return map;
  }, [matrixRows]);
  /** Bottom and top of the model in view space (z is up, as on the bed). */
  /** The printer the export is for (step 04). */
  const printer = findPrinter(settings.export.printerId);
  const viewBounds = useMemo(() => {
    if (!positions || positions.length === 0) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = positions[i + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    return { xSpan: max[0] - min[0], ySpan: max[1] - min[1], zMin: min[2], zMax: max[2] };
  }, [positions]);
  /** Millimetres per model unit in the exported file (target height wins over scale, as in the export). */
  const mmPerUnit = useMemo(() => {
    const e = settings.export;
    if (viewBounds && e.targetHeight && e.targetHeight > 0) return e.targetHeight / Math.max(1e-9, viewBounds.zMax - viewBounds.zMin);
    return e.scale > 0 ? e.scale : 1;
  }, [viewBounds, settings.export]);
  const printHeightMm = viewBounds ? (viewBounds.zMax - viewBounds.zMin) * mmPerUnit : null;
  /**
   * Whether the print fits the chosen printer: footprint on the bed (either
   * way round) and height under its build height.  `fitHeight` is the tallest
   * target height that would fit.
   */
  const printFit = useMemo(() => {
    if (!viewBounds || printHeightMm === null) return null;
    const x = viewBounds.xSpan * mmPerUnit;
    const y = viewBounds.ySpan * mmPerUnit;
    const z = printHeightMm;
    // A named printer's own bed is the real limit, whatever was typed into the bed fields.
    const bed = printer.name ? printer.bed : { x: settings.export.bedX, y: settings.export.bedY, z: printer.bed.z };
    const fits = z <= bed.z + 1e-6 && ((x <= bed.x + 1e-6 && y <= bed.y + 1e-6) || (y <= bed.x + 1e-6 && x <= bed.y + 1e-6));
    // Scaling keeps the proportions, so the tightest of the three limits wins (best of both turns on the bed).
    const flat = Math.max(Math.min(bed.x / Math.max(x, 1e-9), bed.y / Math.max(y, 1e-9)), Math.min(bed.x / Math.max(y, 1e-9), bed.y / Math.max(x, 1e-9)));
    const factor = Math.min(flat, bed.z / Math.max(z, 1e-9));
    return { size: { x, y, z }, bed, fits, fitHeight: Math.floor(z * factor * 0.98) };
  }, [viewBounds, printHeightMm, mmPerUnit, settings.export.bedX, settings.export.bedY, printer]);
  const shownLayerHeight = previewLayerHeight ?? layerHeightMm ?? 0.15;
  /** Every face's recipe and the recipes as rows of filament colours, for the layer preview. */
  const layerRecipes = useMemo(() => {
    if (step !== 4 || !model || !plan || labels.length !== model.triangles.length) return null;
    const sequences: number[][] = [];
    const recipeOfIndex = new Map<number, number>();
    for (const blend of plan.virtualBlends) {
      for (const index of blend.targetPaletteIndices) recipeOfIndex.set(index, sequences.length);
      sequences.push(blend.sequence);
    }
    for (const entry of plan.physicalOnly) {
      for (const index of entry.targetPaletteIndices) recipeOfIndex.set(index, sequences.length);
      sequences.push([entry.physicalExtruder]);
    }
    if (sequences.length === 0) return null;
    const width = Math.max(...sequences.map((seq) => seq.length)) + 1;
    const height = sequences.length;
    const table = new Uint8Array(width * height * 2 * 4);
    // Row y: each layer as it looks in the print (the light it shares with the
    // layers around it, Prusa's calibrated mix); row height + y: each layer's
    // own filament, for the sharp view.
    const writeRow = (row: number, layerRgbs: RGB[]) => {
      const mean = [0, 0, 0];
      for (let x = 0; x < width - 1; x++) {
        const rgb = layerRgbs[x % layerRgbs.length];
        const o = (row * width + x) * 4;
        table[o] = rgb[0];
        table[o + 1] = rgb[1];
        table[o + 2] = rgb[2];
        table[o + 3] = Math.min(255, layerRgbs.length);
        if (x < layerRgbs.length) for (let c = 0; c < 3; c++) mean[c] += srgbToLinear(rgb[c]) / layerRgbs.length;
      }
      const o = (row * width + width - 1) * 4;
      table[o] = Math.round(linearToSrgb(mean[0]));
      table[o + 1] = Math.round(linearToSrgb(mean[1]));
      table[o + 2] = Math.round(linearToSrgb(mean[2]));
      table[o + 3] = Math.min(255, layerRgbs.length);
    };
    sequences.forEach((seq, y) => {
      const filamentRgbs = seq.map((extruder) => slots[extruder - 1]?.filament.effectiveRgb ?? ([128, 128, 128] as RGB));
      writeRow(y, apparentLayerRgbs(filamentRgbs));
      writeRow(height + y, filamentRgbs);
    });
    const recipeOfVertex = new Float32Array(model.triangles.length * 3);
    for (let f = 0; f < model.triangles.length; f++) {
      const entry = palette[labels[f]];
      const id = entry ? (recipeOfIndex.get(entry.index) ?? 0) : 0;
      recipeOfVertex[f * 3] = id;
      recipeOfVertex[f * 3 + 1] = id;
      recipeOfVertex[f * 3 + 2] = id;
    }
    return { table, width, height, recipeOfVertex };
  }, [step, model, plan, labels, palette, slots]);
  const layerPreview = useMemo<LayerPreview | null>(
    () =>
      layerRecipes && viewBounds && exportView === "layers"
        ? { ...layerRecipes, zMin: viewBounds.zMin, layerUnits: shownLayerHeight / mmPerUnit }
        : null,
    [layerRecipes, viewBounds, exportView, shownLayerHeight, mmPerUnit],
  );
  const bandOutputs = useMemo(() => outputsFromRows(matrixRows), [matrixRows]);
  const [mixRowIndex, setMixRowIndex] = useState<number | null>(null);
  const mixRow = matrixRows.find((row) => row.paletteIndex === mixRowIndex) ?? matrixRows[0] ?? null;

  const effectiveByIndex = useMemo(() => {
    const map = new Map<number, RGB>();
    if (!plan) return map;
    for (const entry of plan.virtualBlends) for (const i of entry.targetPaletteIndices) map.set(i, entry.displayRgb);
    for (const entry of plan.physicalOnly) for (const i of entry.targetPaletteIndices) map.set(i, entry.physicalRgb);
    return map;
  }, [plan]);

  /** Which extruder each palette colour prints with, for labels ("VE13 · E2 67% + E4 33%"). */
  const extruderInfoByIndex = useMemo(() => {
    const map = new Map<number, { label: string; rgb: RGB; recipe: string }>();
    if (!plan) return map;
    for (const entry of plan.virtualBlends) for (const i of entry.targetPaletteIndices) map.set(i, { label: `VE${entry.virtualId}`, rgb: entry.displayRgb, recipe: blendRecipeText(entry) });
    for (const entry of plan.physicalOnly) {
      const label = `E${entry.physicalExtruder}`;
      const name = (settings.filaments.names[entry.physicalExtruder - 1] ?? "").trim();
      for (const i of entry.targetPaletteIndices) map.set(i, { label, rgb: entry.physicalRgb, recipe: name && name !== label ? name : "" });
    }
    return map;
  }, [plan, settings.filaments.names]);
  const extruderText = (paletteIndex: number): string => {
    const info = extruderInfoByIndex.get(paletteIndex);
    return info ? (info.recipe ? `${info.label} (${info.recipe})` : info.label) : "-";
  };

  // The colour buffers the views draw (one colour per corner, linear).  A committed
  // brush stroke patches the buffer it was built on for the painted faces and keeps
  // the same object: the views painted those faces as the stroke went, so nothing is
  // uploaded again.
  const sourceBufferRef = useRef<{ colours: RGB[]; buffer: ColourBuffer } | null>(null);
  /**
   * "원본 색": the file's own colours, as it was loaded — what painting, filling and tidying
   * changed is not in it (11-04: it showed the faces as they are now, painted bits and all,
   * and read as a bug).  Through confirmed cuts the file's colours follow the pieces.
   */
  const sourceColours = useMemo(() => {
    if (!model) return null;
    const own = originalColoursRef.current;
    const colours = own && own.length === model.triangles.length ? own : model.triangleColors;
    const prev = sourceBufferRef.current;
    if (prev && prev.colours === colours && prev.buffer.length === model.triangles.length * FACE_BYTES) return prev.buffer;
    const buffer = buildColourBuffer(model.triangles.length, (i) => colours[i]);
    sourceBufferRef.current = { colours, buffer };
    return buffer;
  }, [model]);
  const paletteHexKey = useMemo(() => palette.map((entry) => rgbToHex(entry.rgb)).join(","), [palette]);
  const paletteBufferRef = useRef<{ colours: RGB[]; paletteKey: string; buffer: ColourBuffer } | null>(null);
  const paletteColours = useMemo(() => {
    if (!model || palette.length === 0) return sourceColours;
    const prev = paletteBufferRef.current;
    const patch = strokePatchFor(prev?.colours, model.triangleColors);
    const buffer =
      patch && patch.exact && prev && prev.paletteKey === paletteHexKey && prev.buffer.length === model.triangles.length * FACE_BYTES
        ? patchColourBuffer(prev.buffer, patch.faces, patch.rgb)
        : buildColourBuffer(model.triangles.length, (i) => palette[labels[i]]?.rgb ?? model.triangleColors[i]);
    paletteBufferRef.current = { colours: model.triangleColors, paletteKey: paletteHexKey, buffer };
    return buffer;
  }, [model, palette, labels, sourceColours, paletteHexKey]);
  const printBufferRef = useRef<{ colours: RGB[]; paletteKey: string; effective: Map<number, RGB>; buffer: ColourBuffer } | null>(null);
  // Only while a view shows the print (11-05: built always, it was 36 bytes a face for nothing — 166 MB on a
  // 4.6 M-face model in 02, where the result shows the palette).
  const wantPrint = step <= 2 ? previewMode === "print" : step === 4 || singleMode === "print";
  const printColours = useMemo(() => {
    if (!wantPrint) {
      printBufferRef.current = null;
      return null;
    }
    if (!model || palette.length === 0 || effectiveByIndex.size === 0) return paletteColours;
    const prev = printBufferRef.current;
    const patch = strokePatchFor(prev?.colours, model.triangleColors);
    const printed = (i: number): RGB => {
      const entry = palette[labels[i]];
      return (entry && effectiveByIndex.get(entry.index)) ?? entry?.rgb ?? model.triangleColors[i];
    };
    let buffer: ColourBuffer;
    if (patch && patch.exact && prev && prev.paletteKey === paletteHexKey && prev.effective === effectiveByIndex && prev.buffer.length === model.triangles.length * FACE_BYTES) {
      // The painted faces all print alike: one colour for all of them.
      buffer = patchColourBuffer(prev.buffer, patch.faces, printed(patch.faces[0]));
    } else {
      buffer = buildColourBuffer(model.triangles.length, printed);
    }
    printBufferRef.current = { colours: model.triangleColors, paletteKey: paletteHexKey, effective: effectiveByIndex, buffer };
    return buffer;
  }, [model, palette, labels, effectiveByIndex, paletteColours, paletteHexKey, wantPrint]);
  // While a cut is dragged the result shows the groups as they would be —
  // one colour buffer, nothing in the plan recomputed until the drag ends.
  // Each face's original colour as an index, worked out once per model, so a
  // drag only maps ~50k colours to groups instead of a million faces.
  const faceColourIndex = useMemo(() => {
    if (!model) return null;
    const keyIndex = new Map<number, number>();
    const keys: number[] = [];
    const index = new Int32Array(model.triangles.length);
    for (let f = 0; f < model.triangles.length; f++) {
      const key = stripColourKey(model.triangleColors[f]);
      let at = keyIndex.get(key);
      if (at === undefined) {
        at = keys.length;
        keyIndex.set(key, at);
        keys.push(key);
      }
      index[f] = at;
    }
    return { index, keys };
  }, [model]);
  /** Two buffers taken in turn, so a drag does not allocate (and collect) a buffer per move; let go once it ends. */
  const dragBuffers = useRef<ColourBuffer[]>([]);
  const dragTurn = useRef(0);
  const dragColours = useMemo(() => {
    if (!model || !stripData || !previewCuts || !faceColourIndex) {
      dragBuffers.current = [];
      return null;
    }
    const built = stripPalette(liveGroups);
    const { index, keys } = faceColourIndex;
    const colourOf = new Uint8Array(keys.length * 3);
    for (let u = 0; u < keys.length; u++) {
      const key = keys[u];
      const rgb = built.palette[built.groupOfKey.get(key) ?? 0]?.rgb ?? [(key >> 16) & 255, (key >> 8) & 255, key & 255];
      colourOf[u * 3] = rgb[0];
      colourOf[u * 3 + 1] = rgb[1];
      colourOf[u * 3 + 2] = rgb[2];
    }
    const size = model.triangles.length * FACE_BYTES;
    dragTurn.current = 1 - dragTurn.current;
    let out = dragBuffers.current[dragTurn.current];
    if (!out || out.length !== size) {
      out = new Uint8Array(size);
      dragBuffers.current[dragTurn.current] = out;
    }
    for (let f = 0, p = 0; f < index.length; f++) {
      const o = index[f] * 3;
      const r = colourOf[o];
      const g = colourOf[o + 1];
      const b = colourOf[o + 2];
      out[p++] = r; out[p++] = g; out[p++] = b; out[p++] = 255;
      out[p++] = r; out[p++] = g; out[p++] = b; out[p++] = 255;
      out[p++] = r; out[p++] = g; out[p++] = b; out[p++] = 255;
    }
    return out;
  }, [model, stripData, previewCuts, liveGroups, faceColourIndex]);
  const coloursForMode = (mode: PreviewMode) =>
    mode === "source" ? sourceColours : (dragColours ?? (mode === "palette" ? paletteColours : (printColours ?? paletteColours)));

  const defaultFileName = model ? `${baseName(model.name)}_colormix.3mf` : "model_colormix.3mf";

  const exportCheck = useMemo<ExportCheck | null>(() => {
    // A colour printer prints the cleaned colours as they are: nothing to assign.
    if (printer.kind === "colour") return palette.length > 0 ? { physicalCount: 0, virtualIds: [], renumbered: [], failures: [] } : null;
    if (!plan || palette.length === 0) return null;
    // Slots past the printer's last tool would be painted with filaments it does not have.
    const printerFailures = slots.length > printer.slots.max ? [t("exp.printerTooManySlots", { app: slots.length, max: printer.slots.max, name: printer.name })] : [];
    try {
      const assignments = buildExportAssignments(plan, slots.length);
      const used = new Set<number>();
      for (const entry of palette) {
        const code = assignments.paletteToPaintCode.get(entry.index);
        used.add(code === undefined ? 0 : decodePaintCode(code));
      }
      const failures = validateExportAssignments({
        physicalExtruderCount: slots.length,
        virtuals: assignments.virtuals,
        usedPaintStates: used,
        layerMixing: printer.layerMixing,
      }).map((failure) => (/no layer mixing/.test(failure) ? t("exp.printerNoMixing", { app: printer.app, n: assignments.virtuals.length }) : failure));
      const total = slots.length + assignments.virtuals.length;
      if (printer.bambuProject && total > BAMBU_STUDIO_MAX_FILAMENTS)
        failures.push(t("exp.bambuTooManySlots", { max: BAMBU_STUDIO_MAX_FILAMENTS, p: slots.length, m: assignments.virtuals.length, t: total }));
      return {
        physicalCount: slots.length,
        virtualIds: assignments.virtuals.map((v) => v.id),
        renumbered: [...assignments.virtualIdRemap.entries()].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to })),
        failures: [...printerFailures, ...failures],
      };
    } catch (err) {
      return { physicalCount: slots.length, virtualIds: [], renumbered: [], failures: [...printerFailures, err instanceof Error ? err.message : String(err)] };
    }
  }, [plan, palette, slots.length, printer, t]);

  // ------------------------------------------------------------------
  // Highlights (hover / selected colours / picked patch), picking, template memory
  // ------------------------------------------------------------------
  const hexByPosition = useMemo(() => palette.map((entry) => rgbToHex(entry.rgb)), [palette]);
  const positionByHex = useMemo(() => new Map(hexByPosition.map((hex, position) => [hex, position])), [hexByPosition]);
  // The "change to" colour follows its group when the group's colour changes
  // (a band recoloured, a tidy): its colour is still in the model, only the group's name moved.
  useEffect(() => {
    if (!pickTarget || pickTarget === "__new__" || positionByHex.has(pickTarget)) return;
    const key = stripColourKey(hexToRgb(pickTarget));
    const group = committedGroups.find((g) => g.colours.length > 0 && g.colours.some((colour) => colour.key === key));
    if (group) {
      setPickTarget(rgbToHex(group.rep));
      return;
    }
    // Its colour is gone from the model (the group recoloured): the group's new colour, if known; else let go.
    const twin = [...(hexTwinsRef.current.get(pickTarget) ?? [])].find((hex) => positionByHex.has(hex));
    setPickTarget(twin ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionByHex]);
  /** The colour the brush and the fill tool put down (the "change to" colour of the pick bar too). */
  const brushHex = useMemo(() => {
    const target = pickTarget || "__new__";
    const candidate = (target === "__new__" ? pickCustom : target).toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(candidate)) return candidate;
    return hexByPosition[0] ?? "#FF0000";
  }, [pickTarget, pickCustom, hexByPosition]);

  // The healing brush needs no colour of its own any more (it takes the colour around each speck).
  healPickRef.current = () => {};

  /** Where a palette colour prints, for the spectrum and the group panel. */
  const stripOutputOf = useCallback(
    (hex: string): StripOutput | undefined => {
      const position = positionByHex.get(hex);
      const entry = position === undefined ? undefined : palette[position];
      const info = entry ? extruderInfoByIndex.get(entry.index) : undefined;
      return info ? { label: info.label, physical: !info.label.startsWith("VE") } : undefined;
    },
    [positionByHex, palette, extruderInfoByIndex],
  );
  const stripSummary = useMemo(() => {
    if (!plan) return undefined;
    const singleLabels = [...new Set(plan.physicalOnly.map((entry) => `E${entry.physicalExtruder}`))];
    return {
      single: plan.physicalOnly.reduce((sum, entry) => sum + entry.targetPaletteIndices.length, 0),
      singleLabels,
      mixed: plan.virtualBlends.length,
    };
  }, [plan]);
  const protectedHexes = useMemo(
    () => new Set(Object.entries(settings.mergeFlags).filter(([, flag]) => flag?.protect).map(([hex]) => hex)),
    [settings.mergeFlags],
  );

  // ------------------------------------------------------------------
  // Faces cut along the colour borders (@core/borderCut): worked out in a
  // worker a moment after every change of the groups, shown in the result
  // view in place of the faces they come from, and written so on export.
  // The model itself keeps its faces: picking, the brush and undo go on as
  // before.
  // ------------------------------------------------------------------
  const cutSpan = settings.export.cutSpan;
  /** The last cut, with what it was worked out for. */
  const [cutLayer, setCutLayer] = useState<CutLayer | null>(null);
  /**
   * The small notice at the result view's bottom right, like a slicer's: why
   * it is up ("on" the smooth borders are a preview until confirmed, "load" the
   * same for a model just opened, "undone" a confirm was taken back but the
   * preview looks the same, "off" the borders were straightened while the cut
   * is off) — null when closed.
   */
  const [cutNotice, setCutNotice] = useState<"on" | "load" | "undone" | "off" | "piece" | null>(null);
  /** Each colour state's cut once worked out (by its colours array, as undo and redo bring it back). */
  const cutByColours = useRef(new WeakMap<RGB[], { layer: CutLayer; triangles: MeshModel["triangles"]; span: number; protectedKey: string }>());
  /** The palette's colours in order: a cut's groups are positions in it. */
  const paletteKey = useMemo(() => hexByPosition.join(","), [hexByPosition]);
  const protectedKey = useMemo(() => hexByPosition.map((hex) => (protectedHexes.has(hex) ? "1" : "0")).join(""), [hexByPosition, protectedHexes]);
  useEffect(() => {
    if (!model || cutSpan <= 0 || palette.length === 0 || labels.length !== model.triangles.length || previewCuts) return;
    // Colours shown before (an undo, a redo): their cut is known — shown at once, and
    // nothing to work out when the groups are the same too.
    const known = cutByColours.current.get(model.triangleColors);
    if (known && known.triangles === model.triangles && known.span === cutSpan && known.protectedKey === protectedKey) {
      const same = known.layer.paletteKey === paletteKey && sameGroups(known.layer.labels, labels);
      setCutLayer(same ? { ...known.layer, labels } : known.layer);
      if (same) return;
    }
    let alive = true;
    const shielded = protectedPositions();
    const settled = settledFaces(model);
    const cutFaces = cutFacesRef.current.get(model.triangles);
    const colours = model.triangleColors;
    const timer = window.setTimeout(() => {
      cutBorders(model, labels, shielded, cutSpan, settled, "preview", cutFaces)
        .then((cut) => {
          const layer: CutLayer = { triangles: model.triangles, paletteKey, paletteHex: hexByPosition, labels, cut };
          cutByColours.current.set(colours, { layer, triangles: model.triangles, span: cutSpan, protectedKey });
          if (alive) setCutLayer(layer);
        })
        .catch((err) => {
          if (!(err instanceof CutSuperseded)) console.warn("Border cut failed", err);
        });
      // Strokes come one after another: the cut waits until the brush rests a moment.
    }, strokePatchRef.current?.to === model.triangleColors ? 1000 : 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, labels, palette, cutSpan, protectedKey, previewCuts]);

  // Face masks shared by the 3D outlines and the colour map.
  /** Which colours a mask stands for, so the outline geometry built for it can be reused. */
  const maskKeys = useRef(new WeakMap<Uint8Array, string>());
  /** Masks already made for these labels (a pass over every face each), most recently used last. */
  const maskCache = useMemo(() => new Map<string, Uint8Array>(), [labels]);
  const keyedMask = (positions: number[], kind: string): Uint8Array => {
    const key = `${kind}${[...positions].sort((a, b) => a - b).join(",")}`;
    const known = maskCache.get(key);
    if (known) {
      maskCache.delete(key);
      maskCache.set(key, known);
      return known;
    }
    const mask = maskFromLabels(labels, positions);
    maskKeys.current.set(mask, key);
    maskCache.set(key, mask);
    if (maskCache.size > 32) maskCache.delete(maskCache.keys().next().value as string);
    return mask;
  };
  const hoverMask = useMemo<Uint8Array | null>(() => {
    if (!model || !hoverHex) return null;
    const position = positionByHex.get(hoverHex);
    return position === undefined ? null : keyedMask([position], "c");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, hoverHex, positionByHex, labels]);

  const selectedMask = useMemo<Uint8Array | null>(() => {
    if (!model) return null;
    const hexes = shownHex && !selectedHexes.includes(shownHex) ? [...selectedHexes, shownHex] : selectedHexes;
    if (hexes.length === 0) return null;
    const wanted = hexes.map((hex) => positionByHex.get(hex)).filter((p): p is number => p !== undefined);
    return wanted.length === 0 ? null : keyedMask(wanted, "c");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, selectedHexes, shownHex, positionByHex, labels]);

  const pickedMask = useMemo<Uint8Array | null>(() => {
    if (!model || pickedPatches.length === 0) return null;
    const mask = new Uint8Array(model.triangles.length);
    for (const patch of pickedPatches) for (let i = 0; i < patch.faces.length; i++) mask[patch.faces[i]] = 1;
    return mask;
  }, [model, pickedPatches]);
  const pickedMaskRef = useRef<Uint8Array | null>(null);
  pickedMaskRef.current = pickedMask;

  // What a click would take, shown while the pointer rests on the model or
  // the map: the patch under it — in the fill tool the whole selection when
  // the pointer is inside it.  Each patch is flood-filled once and remembered
  // by face, so moving within it or back onto it is a lookup.
  const patchGenRef = useRef(0);
  const hoverPatches = useMemo(
    () => ({ gen: ++patchGenRef.current, ofFace: new Int32Array(labels.length).fill(-1), faces: [] as Int32Array[], masks: new Map<number, Uint8Array>() }),
    [labels],
  );
  const [hoverPatch, setHoverPatch] = useState<{ id: number; face: number } | null>(null);
  const hoverFaceRef = useRef<number | null>(null);
  const hoverPatchTimer = useRef<number | null>(null);
  /**
   * The face that stands for what the pointer is on.  On a piece of the smooth
   * borders' preview whose group is not its face's (the face is cut, not yet
   * confirmed), a face of the piece's group beside it — so a hover or a click
   * takes the patch the piece shows as part of, not the colour under it.
   */
  /**
   * The face a click on the result view means: on a preview piece, a face of the
   * colour the piece shows (see faceOfGroupNear); -1 when that colour is in the
   * preview only — no face of it near yet, until the cut is confirmed.
   */
  function faceShownAt(face: number, piece: number | undefined): number {
    const group = piece !== undefined ? viewerCut?.group?.[piece] : undefined;
    const current = modelRef.current;
    if (group === undefined || group < 0 || !current) return face;
    const { offsets, neighbours } = adjacencyFor(current);
    return faceOfGroupNear(offsets, neighbours, labels, face, group);
  }

  function hoverFace(face: number | null, piece?: number): void {
    if (face !== null && piece !== undefined) face = faceShownAt(face, piece);
    hoverFaceRef.current = face;
    if (hoverPatchTimer.current !== null) {
      window.clearTimeout(hoverPatchTimer.current);
      hoverPatchTimer.current = null;
    }
    if (face === null || face < 0 || face >= hoverPatches.ofFace.length || brushMode || eyedropper || !modelRef.current) {
      setHoverPatch(null);
      return;
    }
    const inside = (f: number) => pickedMaskRef.current?.[f] === 1;
    const show = (id: number) => setHoverPatch((prev) => (prev && prev.id === id && inside(prev.face) === inside(face) ? prev : { id, face }));
    const known = hoverPatches.ofFace[face];
    if (known >= 0) {
      show(known);
      return;
    }
    // A patch not met yet is found once the pointer rests on it a moment, so
    // a sweep across many small patches does not flood-fill each of them.
    hoverPatchTimer.current = window.setTimeout(() => {
      hoverPatchTimer.current = null;
      const current = modelRef.current;
      if (!current) return;
      const adjacency = adjacencyFor(current);
      const faces = sameLabelComponent(adjacency.offsets, adjacency.neighbours, labels, face);
      const id = hoverPatches.faces.length;
      hoverPatches.faces.push(faces);
      for (let i = 0; i < faces.length; i++) hoverPatches.ofFace[faces[i]] = id;
      show(id);
    }, 40);
  }
  // New colours (a fill, a stroke, a merge): the patches are new too, so the
  // one under a resting pointer is found again.
  useEffect(() => {
    setHoverPatch(null);
    if (hoverFaceRef.current !== null) hoverFace(hoverFaceRef.current);
    return () => {
      if (hoverPatchTimer.current !== null) window.clearTimeout(hoverPatchTimer.current);
      hoverPatchTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverPatches]);
  // The brush shows its own circle and the eyedropper takes a colour, not a patch.
  useEffect(() => {
    if (brushMode) hoverFaceRef.current = null;
    if (brushMode) {
      // The brush has its own circles on both views.
      for (const handle of viewerHandles()) handle.setPointerMark(null);
      mapRef.current?.setPointer(null);
    }
    if (brushMode || eyedropper) setHoverPatch(null);
    else if (hoverFaceRef.current !== null) hoverFace(hoverFaceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushMode, eyedropper]);
  const hoverPatchMask = useMemo<Uint8Array | null>(() => {
    if (!hoverPatch) return null;
    if (fillMode && pickedMask && pickedMask[hoverPatch.face]) return pickedMask;
    const known = hoverPatches.masks.get(hoverPatch.id);
    if (known) return known;
    const faces = hoverPatches.faces[hoverPatch.id];
    if (!faces) return null;
    const mask = new Uint8Array(labels.length);
    for (let i = 0; i < faces.length; i++) mask[faces[i]] = 1;
    maskKeys.current.set(mask, `p${hoverPatches.gen}.${hoverPatch.id}`);
    hoverPatches.masks.set(hoverPatch.id, mask);
    if (hoverPatches.masks.size > 16) hoverPatches.masks.delete(hoverPatches.masks.keys().next().value as number);
    return mask;
  }, [hoverPatch, hoverPatches, fillMode, pickedMask, labels.length]);

  const atlasMasks = useMemo<AtlasMasks>(
    () => ({ hover: hoverMask ?? hoverPatchMask, selected: selectedMask, picked: pickedMask }),
    [hoverMask, hoverPatchMask, selectedMask, pickedMask],
  );

  /**
   * The separate pieces of one colour on the model, largest first, each with
   * the face nearest its middle (where a tag or a ring points).  Worked out
   * when a colour is chosen and kept until the colours change.
   */
  const piecesCache = useMemo(() => new Map<number, { anchors: number[]; count: number }>(), [labels]);
  // The rings on a chosen colour's pieces can be turned off (remembered in this browser).
  const [showRings, setShowRings] = useState(() => {
    try {
      return window.localStorage.getItem("rodin-pipeline-rings") !== "0";
    } catch {
      return true;
    }
  });
  const toggleRings = () => {
    setShowRings(!showRings);
    try {
      window.localStorage.setItem("rodin-pipeline-rings", showRings ? "0" : "1");
    } catch {
      // ignore
    }
  };
  function piecesOf(current: MeshModel, position: number): { anchors: number[]; count: number } {
    const known = piecesCache.get(position);
    if (known) return known;
    const { offsets, neighbours } = adjacencyFor(current);
    const { centroids } = faceGeometryFor(current);
    const seen = new Uint8Array(labels.length);
    const found: Array<{ area: number; anchor: number }> = [];
    const stack: number[] = [];
    for (let start = 0; start < labels.length; start++) {
      if (seen[start] || labels[start] !== position) continue;
      const faces: number[] = [];
      let area = 0;
      let x = 0;
      let y = 0;
      let z = 0;
      seen[start] = 1;
      stack.push(start);
      while (stack.length > 0) {
        const f = stack.pop() as number;
        faces.push(f);
        const weight = areaWeights[f] ?? 0;
        area += weight;
        x += centroids[f * 3] * weight;
        y += centroids[f * 3 + 1] * weight;
        z += centroids[f * 3 + 2] * weight;
        for (let k = offsets[f]; k < offsets[f + 1]; k++) {
          const g = neighbours[k];
          if (!seen[g] && labels[g] === position) {
            seen[g] = 1;
            stack.push(g);
          }
        }
      }
      if (area > 0) {
        x /= area;
        y /= area;
        z /= area;
      }
      let anchor = faces[0];
      let nearest = Infinity;
      for (const f of faces) {
        const d = (centroids[f * 3] - x) ** 2 + (centroids[f * 3 + 1] - y) ** 2 + (centroids[f * 3 + 2] - z) ** 2;
        if (d < nearest) {
          nearest = d;
          anchor = f;
        }
      }
      found.push({ area, anchor });
    }
    found.sort((a, b) => b.area - a.area);
    const result = { anchors: found.slice(0, 24).map((piece) => piece.anchor), count: found.length };
    piecesCache.set(position, result);
    return result;
  }

  // A tag at each picked patch: a dot on the face that was clicked, a leader
  // line, and the colour, its share of the model and the extruder it prints
  // with — so what was picked, and where it is on the spectrum, reads at once.
  // With no patch picked, a colour chosen on the spectrum or in the matrix gets
  // a tag at its largest piece (and how many pieces it has) and, unless they are
  // turned off, a ring on each piece (up to 24, largest first), large colour or
  // small alike, so even a speck of 0.1 % is found.
  const callouts = useMemo<Callout[]>(() => {
    // Nothing picked or chosen: no tags, and no face geometry worked out for them (a new mesh waits for that).
    if (!model || (pickedPatches.length === 0 && selectedHexes.length === 0)) return [];
    const { centroids } = faceGeometryFor(model);
    const at = (face: number): [number, number, number] => pointToView([centroids[face * 3], centroids[face * 3 + 1], centroids[face * 3 + 2]]);
    if (pickedPatches.length === 0) {
      const rings: Callout[] = [];
      const tags: Callout[] = [];
      for (const hex of selectedHexes.slice(-4)) {
        const position = positionByHex.get(hex);
        if (position === undefined) continue;
        const { anchors, count } = piecesOf(model, position);
        if (anchors.length === 0) continue;
        const share = areaByPosition[position] ?? 0;
        const entry = palette[position];
        const info = entry ? extruderInfoByIndex.get(entry.index) : undefined;
        tags.push({
          point: at(anchors[0]),
          hex,
          title: hex,
          value: pct(share),
          extra: count > 1 ? t("callout.pieces", { n: count.toLocaleString() }) : undefined,
          // Where it prints (and the mix) from 03 on: 02 is about colours, not filaments.
          detail: step >= 3 && info ? `→ ${info.label}${info.recipe ? ` · ${info.recipe}` : ""}` : undefined,
        });
        if (showRings) for (const face of anchors) rings.push({ kind: "ring", point: at(face), hex, title: "", value: "" });
      }
      // the rings first, so the tags draw over them
      return [...rings, ...tags];
    }
    return pickedPatches.slice(-6).map((patch) => {
      const info = extruderInfoByIndex.get(patch.index);
      const position = positionByHex.get(patch.hex);
      const whole = position === undefined ? undefined : areaByPosition[position];
      return {
        point: at(patch.anchor),
        hex: patch.hex,
        title: patch.hex,
        value: pct(patch.fraction),
        // The colour's own share when this patch is only part of it (the chip over the view shows that one).
        extra: whole !== undefined && whole - patch.fraction > 0.0005 ? t("callout.total", { pct: pct(whole) }) : undefined,
        detail: step >= 3 && info ? `→ ${info.label}${info.recipe ? ` · ${info.recipe}` : ""}` : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, pickedPatches, selectedHexes, palette, piecesCache, showRings, pointToView, extruderInfoByIndex, positionByHex, areaByPosition, t, step]);

  // What solo / x-ray single out: picked patches and selected colours together.
  const focusMask = useMemo<Uint8Array | null>(() => {
    if (!pickedMask) return selectedMask;
    if (!selectedMask) return pickedMask;
    const out = new Uint8Array(pickedMask.length);
    for (let i = 0; i < out.length; i++) out[i] = pickedMask[i] | selectedMask[i];
    return out;
  }, [pickedMask, selectedMask]);
  const focus = useMemo(() => ({ mask: focusMask, mode: focusMode }), [focusMask, focusMode]);

  // Everything a highlight draws goes through toViewSpace — positions and
  // normals alike — so it sits on the model exactly as the model is shown.
  /** Outline geometry per colour set, valid until the faces or their labels change. */
  /** The cut the result view shows now (worked out for exactly these groups): outlines follow its line too. */
  /**
   * The cut as the views show it now, its groups in today's palette.  Right
   * after a recolour the new cut is still being worked out (seconds on a big
   * model): the last one stands in, by colour, on every face whose group is
   * as it was then — a face's pieces all or none (no hole where one piece's
   * colour has gone).  The pieces drawn and the outlines both come from here,
   * so an outline never steps along triangles beside smooth pieces.
   */
  const cutNow = useMemo<{ cut: HighlightCut; group: Int32Array } | null>(() => {
    if (!model || !cutLayer || cutSpan <= 0 || dragColours || cutLayer.triangles !== model.triangles) return null;
    const { cut, labels: then, paletteHex: thenHex } = cutLayer;
    if (cutLayer.paletteKey === paletteKey && cutLayer.labels === labels) return { cut, group: cut.pieceGroups };
    // A group of the cut, found in the palette as it is now by its colour (-1: gone).
    const nowOf = cutLayer.paletteKey === paletteKey ? null : new Map(hexByPosition.map((hex, position) => [hex, position]));
    const toNow = (position: number) => (nowOf ? (nowOf.get(thenHex[position]) ?? -1) : position);
    const faceOk = new Map<number, boolean>();
    for (let p = 0; p < cut.pieceGroups.length; p++) {
      const f = cut.pieceFaces[p];
      const ok = toNow(then[f]) === labels[f] && toNow(cut.pieceGroups[p]) >= 0;
      faceOk.set(f, (faceOk.get(f) ?? true) && ok);
    }
    const kept: number[] = [];
    for (let p = 0; p < cut.pieceGroups.length; p++) if (faceOk.get(cut.pieceFaces[p])) kept.push(p);
    const pieces = new Int32Array(kept.length * 3);
    const pieceGroups = new Int32Array(kept.length);
    const pieceFaces = new Int32Array(kept.length);
    kept.forEach((p, i) => {
      pieces.set(cut.pieces.subarray(p * 3, p * 3 + 3), i * 3);
      pieceGroups[i] = toNow(cut.pieceGroups[p]);
      pieceFaces[i] = cut.pieceFaces[p];
    });
    const replaced = Int32Array.from(cut.replaced.filter((f) => faceOk.get(f) === true));
    return { cut: { addedVertices: cut.addedVertices, pieces, pieceGroups, pieceFaces, replaced }, group: pieceGroups };
  }, [model, cutLayer, cutSpan, dragColours, paletteKey, hexByPosition, labels]);
  const outlineCut = cutNow?.cut ?? null;
  const overlayShapes = useMemo(
    () => new Map<string, Pick<HighlightOverlay, "fill" | "fillNormals" | "edges" | "edgeNormals" | "edgeInside">>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model?.triangles, labels, vertexNormals, toViewSpace, outlineCut],
  );
  const overlayFor = useCallback(
    (id: string, mask: Uint8Array, look: Pick<HighlightOverlay, "colour" | "line" | "rim" | "opacity" | "lineOpacity" | "pulse">): HighlightOverlay | null => {
      if (!model) return null;
      const key = maskKeys.current.get(mask);
      let shape = key ? overlayShapes.get(key) : undefined;
      if (!shape) {
        const { fill, fillNormals, edges, edgeNormals, edgeInside } = outlineCut
          ? highlightGeometryCut(model, mask, outlineCut, labels, vertexNormals ?? undefined)
          : highlightGeometry(model, mask, vertexNormals ?? undefined);
        shape = { fill: toViewSpace(fill), fillNormals: toViewSpace(fillNormals), edges: toViewSpace(edges), edgeNormals: toViewSpace(edgeNormals), edgeInside: toViewSpace(edgeInside) };
        if (key) {
          overlayShapes.set(key, shape);
          // A large colour is tens of MB; the budget holds every colour of a
          // million-face model, so going back to any of them costs nothing.
          let bytes = 0;
          for (const kept of overlayShapes.values()) bytes += kept.fill.byteLength * 2 + kept.edges.byteLength * 2;
          for (const [oldKey, kept] of overlayShapes) {
            if (bytes <= (model.triangles.length >= BIG_MODEL_FACES ? OVERLAY_SHAPE_BUDGET_BIG : OVERLAY_SHAPE_BUDGET) || oldKey === key) break;
            bytes -= kept.fill.byteLength * 2 + kept.edges.byteLength * 2;
            overlayShapes.delete(oldKey);
          }
        }
      }
      return { id, pulse: true, ...look, ...shape };
    },
    [model, vertexNormals, toViewSpace, overlayShapes, outlineCut, labels],
  );

  const hoverOverlay = useMemo<HighlightOverlay | null>(
    () => (hoverMask ? overlayFor("hover", hoverMask, { colour: "#9aa0ff", line: "#525aff", opacity: 0.4, lineOpacity: 0.9 }) : null),
    [hoverMask, overlayFor],
  );

  // Every colour's outline is worked out while the app is idle, largest
  // first, so even the first hover over a colour shows at once.  One colour
  // per idle moment, and none while a cut on the strip is being dragged.
  const stripDragging = useRef(false);
  stripDragging.current = previewCuts !== null;
  useEffect(() => {
    if (!model || labels.length !== model.triangles.length || palette.length === 0 || model.triangles.length >= BIG_MODEL_FACES) return;
    const order = palette.map((_, position) => position).sort((a, b) => (areaByPosition[b] ?? 0) - (areaByPosition[a] ?? 0));
    const idle = (run: () => void): number =>
      typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(run, { timeout: 3000 }) : window.setTimeout(run, 200);
    const cancel = (handle: number) =>
      typeof window.cancelIdleCallback === "function" ? window.cancelIdleCallback(handle) : window.clearTimeout(handle);
    let at = 0;
    let handle = 0;
    const work = () => {
      if (at >= order.length) return;
      if (!stripDragging.current) overlayFor("warm", keyedMask([order[at++]], "c"), { colour: "#000000", opacity: 0, lineOpacity: 0 });
      handle = idle(work);
    };
    handle = idle(work);
    return () => cancel(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, labels, palette, areaByPosition, overlayFor]);

  const selectedOverlay = useMemo<HighlightOverlay | null>(
    // the app's iris, no dark rim: a white line with a dark edge read as the model's own painted outlines
    () => (selectedMask ? overlayFor("selected", selectedMask, { colour: "#9aa0ff", opacity: 0.3, lineOpacity: 0.95 }) : null),
    [selectedMask, overlayFor],
  );

  // The picked patch is the one being looked at: a thin tint for the opening
  // flash, then the outline alone, so the colour it points at stays visible.
  const pickedOverlay = useMemo<HighlightOverlay | null>(
    () => (pickedMask ? overlayFor("picked", pickedMask, { colour: "#9aa0ff", opacity: 0.22, lineOpacity: 0.9 }) : null),
    [pickedMask, overlayFor],
  );

  // Select: a light iris tint and outline on the patch a click would take.
  // Fill: the patch (or selection) already in the fill colour, outlined in white.
  const hoverPatchOverlay = useMemo<HighlightOverlay | null>(() => {
    if (!hoverPatchMask) return null;
    const look = fillMode
      ? { colour: brushHex, line: "#ffffff", rim: "#0d0d0e", opacity: 0.85, lineOpacity: 0.95, pulse: false }
      : { colour: "#9aa0ff", line: "#525aff", opacity: 0.3, lineOpacity: 1, pulse: false };
    if (hoverPatchMask === pickedMask && pickedOverlay) {
      // The selection's outline is already worked out.
      const { fill, fillNormals, edges, edgeNormals, edgeInside } = pickedOverlay;
      return { id: "hoverPatch", ...look, fill, fillNormals, edges, edgeNormals, edgeInside };
    }
    return overlayFor("hoverPatch", hoverPatchMask, look);
  }, [hoverPatchMask, fillMode, brushHex, pickedMask, pickedOverlay, overlayFor]);

  // The colour being chosen in the picker, laid over the selection as it would look
  // (the shading shows through, as the fill tool's hover does); gone when the picker closes.
  const pickPreviewOverlay = useMemo<HighlightOverlay | null>(() => {
    if (!pickPreviewHex || !pickedMask) return null;
    const look = { colour: pickPreviewHex, line: "#ffffff", rim: "#0d0d0e", opacity: 0.85, lineOpacity: 0.95, pulse: false };
    if (pickedOverlay) {
      const { fill, fillNormals, edges, edgeNormals, edgeInside } = pickedOverlay;
      return { id: "pickPreview", ...look, fill, fillNormals, edges, edgeNormals, edgeInside };
    }
    return overlayFor("pickPreview", pickedMask, look);
  }, [pickPreviewHex, pickedMask, pickedOverlay, overlayFor]);

  // Patches picked: a preset goes on them (11-04: white clothes picked, "smooth borders" ran on the whole
  // model and the face went orange).  Picking switches the area once; a choice made by hand stays.
  const hadPickRef = useRef(false);
  useEffect(() => {
    const has = pickedPatches.length > 0;
    if (has === hadPickRef.current) return;
    hadPickRef.current = has;
    if (has && tidyArea === "model") {
      tidyAreaAutoRef.current = true;
      setTidyAreaState("picked");
    } else if (!has && tidyAreaAutoRef.current) {
      tidyAreaAutoRef.current = false;
      setTidyAreaState("model");
    }
  }, [pickedPatches.length, tidyArea]);
  const pickedFaceCount = useMemo(() => pickedPatches.reduce((sum, patch) => sum + patch.faces.length, 0), [pickedPatches]);
  const pickedFraction = useMemo(() => pickedPatches.reduce((sum, patch) => sum + patch.fraction, 0), [pickedPatches]);
  const pickedHexes = useMemo(() => [...new Set(pickedPatches.map((patch) => patch.hex))], [pickedPatches]);
  // What an AI answer changed (set once the answer is in — see the ✨ below), flashing yellow (twice, then the outline a moment).
  const flashArmRef = useRef<Uint32Array | null>(null);
  /** The marks the last plan could not paint (see markFaces). */
  const floodedRef = useRef<string[]>([]);
  const [changeFlash, setChangeFlash] = useState<{ mask: Uint8Array; faces: number; total: number; at: number } | null>(null);
  const flashOverlay = useMemo<HighlightOverlay | null>(
    () =>
      changeFlash
        ? // Most of the model changed (a whole 🤖 paint): a light flash, the model still to be seen through it.
          overlayFor(`flash-${changeFlash.at}`, changeFlash.mask, { colour: "#ffd60a", line: "#ffd60a", rim: "#0d0d0e", opacity: changeFlash.faces > changeFlash.total * 0.4 ? 0.3 : 0.7, lineOpacity: 1, pulse: true })
        : null,
    [changeFlash, overlayFor],
  );
  const overlays = useMemo(
    () => [selectedOverlay, hoverOverlay, pickedOverlay, hoverPatchOverlay, pickPreviewOverlay, flashOverlay].filter((o): o is HighlightOverlay => o !== null),
    [selectedOverlay, hoverOverlay, pickedOverlay, hoverPatchOverlay, pickPreviewOverlay, flashOverlay],
  );

  function handleHover(hex: string | null): void {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHoverHex(hex);
      // Short enough to feel immediate; a sweep across rows still skips the ones passed over.
    }, hex ? 60 : 120);
  }

  function toggleSelectedHex(hex: string): void {
    setSelectedHexes((prev) => (prev.includes(hex) ? prev.filter((h) => h !== hex) : [...prev, hex]));
  }

  /**
   * The chosen bands take the colour of the band whose output chip was
   * clicked (its main colour), every face of them; nothing else changes — no
   * tidy-up runs, and the cuts are laid again so every other band keeps its
   * colours.  ⌘Z takes it back, cuts and all.
   */
  function recolourChosenTo(targetHex: string): void {
    if (!model || !stripData) return;
    const live = committedGroups.filter((group) => group.colours.length > 0);
    const target = live.find((group) => rgbToHex(group.rep) === targetHex);
    if (!target) return;
    const chosen = live.filter((group) => group !== target && selectedHexes.includes(rgbToHex(group.rep)));
    if (chosen.length === 0) return;
    const gone = new Set<number>();
    for (const group of chosen) for (const colour of group.colours) gone.add(colour.key);
    const before = model.triangleColors;
    let faces = 0;
    const next = before.map((rgb) => {
      if (!gone.has(stripColourKey(rgb))) return rgb;
      faces++;
      return target.rep;
    });
    const groupOfKey = new Map<number, string>();
    for (const group of live) for (const colour of group.colours) groupOfKey.set(colour.key, `${group.family}:${group.index}`);
    const strip = buildColourStrip(next, areaWeightList, pins);
    // A piece split off from a band now recoloured goes back to the new colour.
    const targetKey = stripColourKey(target.rep);
    const from = fromMoved(storedStrip?.from, (key) => (gone.has(key) ? targetKey : undefined));
    const stored = stripStore(targetGroups, cutsKeepingGroups(strip, groupOfKey), livePins(storedStrip?.pins, strip), from);
    cutsWithColours.current.set(before, settings.stripByModel[stripKey] ?? null);
    cutsWithColours.current.set(next, stored);
    setSettings((prev) => ({ ...prev, stripByModel: { ...prev.stripByModel, [stripKey]: stored } }));
    applyColours(model, next);
    setSelectedHexes([]);
    setStatus(t("status.bandsRecoloured", { n: chosen.length, hex: targetHex, faces: faces.toLocaleString() }));
  }

  /** The go of the edge slider on the picked patches, started on the first touch (or again if the colours changed). */
  function edgeSession(current: MeshModel): NonNullable<typeof edgeSessionRef.current> {
    const live = edgeSessionRef.current;
    if (live && current.triangleColors === (live.left ?? live.base)) return live;
    const adjacency = adjacencyFor(current);
    // The original texture holds the blend even after a tidy flattened it.
    const original = originalColoursRef.current && originalColoursRef.current.length === current.triangles.length ? originalColoursRef.current : current.triangleColors;
    const edges = pickedPatches.map((patch) => measurePatchEdge(adjacency, patch.faces, original));
    const look = new Map<number, RGB>();
    const lookOf = (f: number) => {
      if (!look.has(f)) look.set(f, palette[labels[f]]?.rgb ?? current.triangleColors[f]);
    };
    for (const edge of edges) {
      if (!edge) continue;
      lookOf(edge.heart);
      for (let i = 0; i < edge.band.length; i++) {
        lookOf(edge.band[i]);
        if (edge.outer[i] >= 0) lookOf(edge.outer[i]);
      }
    }
    const groupOfKey = new Map<number, string>();
    for (const group of committedGroups) for (const colour of group.colours) groupOfKey.set(colour.key, `${group.family}:${group.index}`);
    const session = {
      base: current.triangleColors,
      edges,
      look,
      groupOfKey,
      cuts: settings.stripByModel[stripKey] ?? null,
      shown: new Map<number, RGB>(),
      kept: new Map<number, RGB>(),
      left: null,
      touched: false,
    };
    edgeSessionRef.current = session;
    return session;
  }

  /** The faces the edge slider changes at `value` from the start, and the colour each takes (the patch's, or the one beyond it). */
  function edgePlan(current: MeshModel, session: NonNullable<typeof edgeSessionRef.current>, value: number): { colours: Map<number, RGB>; join: number; leave: number } {
    const adjacency = adjacencyFor(current);
    const colours = new Map<number, RGB>();
    let join = 0;
    let leave = 0;
    for (const edge of session.edges) {
      if (!edge) continue;
      const moved = edgeChanges(edge, adjacency, value);
      const own = session.look.get(edge.heart) as RGB;
      for (const f of moved.join)
        if (!colours.has(f)) {
          colours.set(f, own);
          join++;
        }
      for (const f of moved.leave) {
        const seed = edge.outer[edge.slot[f]];
        if (seed < 0 || colours.has(f)) continue;
        colours.set(f, session.look.get(seed) as RGB);
        leave++;
      }
    }
    return { colours, join, leave };
  }

  /** While the slider moves: the faces shown as they would be at this position (as a brush stroke shows), nothing kept yet. */
  function previewEdge(value: number): void {
    const current = modelRef.current;
    setEdgeValue(value);
    if (!current) return;
    const session = edgeSession(current);
    const plan = edgePlan(current, session, value);
    const byColour = new Map<number, { rgb: RGB; faces: number[] }>();
    const put = (f: number, rgb: RGB) => {
      const key = stripColourKey(rgb);
      const entry = byColour.get(key) ?? { rgb, faces: [] };
      entry.faces.push(f);
      byColour.set(key, entry);
    };
    for (const f of session.shown.keys()) if (!plan.colours.has(f)) put(f, session.look.get(f) ?? current.triangleColors[f]);
    for (const [f, rgb] of plan.colours) {
      const was = session.shown.get(f);
      if (!was || stripColourKey(was) !== stripColourKey(rgb)) put(f, rgb);
    }
    if (byColour.size > 0) session.touched = true;
    session.shown = plan.colours;
    for (const { rgb, faces } of byColour.values()) for (const handle of editedViewers()) handle.setFaceColours(faces, rgb);
    setEdgeCount({ join: plan.join, leave: plan.leave });
  }

  /**
   * On letting go: the model becomes the start with this position's changes
   * (the middle: the start itself, cuts and all); the other bands keep their
   * colours; ⌘Z takes it back.  The slider stays where it is.
   */
  function commitEdge(): void {
    const session = edgeSessionRef.current;
    const current = modelRef.current;
    if (!session || !current) return;
    const same = session.shown.size === session.kept.size && [...session.shown].every(([f, rgb]) => session.kept.get(f) === rgb);
    if (same) {
      // Let go where it was: the views may still show the way there.
      if (session.touched) setModel({ ...current });
      session.touched = false;
      return;
    }
    const next = session.base.slice();
    for (const [f, rgb] of session.shown) next[f] = rgb;
    const stored =
      session.shown.size === 0
        ? session.cuts
        : stripStore(targetGroups, cutsKeepingGroups(buildColourStrip(next, areaWeightList, pins), session.groupOfKey), storedStrip?.pins, storedStrip?.from);
    cutsWithColours.current.set(current.triangleColors, settings.stripByModel[stripKey] ?? null);
    cutsWithColours.current.set(next, stored);
    setSettings((prev) => {
      const strips = { ...prev.stripByModel };
      if (stored) strips[stripKey] = stored;
      else delete strips[stripKey];
      return { ...prev, stripByModel: strips };
    });
    session.left = next;
    session.kept = new Map(session.shown);
    session.touched = false;
    edgeRepickRef.current = session.edges.filter((edge): edge is PatchEdge => edge !== null).map((edge) => edge.heart);
    applyColours(current, next, { keepSelection: true });
    setStatus(session.shown.size === 0 ? t("status.edgeBack") : t("status.edgeMoved", { join: edgeCount.join.toLocaleString(), leave: edgeCount.leave.toLocaleString() }));
  }

  const commitEdgeRef = useRef(commitEdge);
  commitEdgeRef.current = commitEdge;
  // A new pick starts a new go of the slider, in the middle; the same patches picked again after
  // the edge moved keep it going.
  useEffect(() => {
    if (edgeRepickingRef.current) {
      edgeRepickingRef.current = false;
      return;
    }
    edgeSessionRef.current = null;
    setEdgeValue(50);
    setEdgeCount({ join: 0, leave: 0 });
  }, [pickedPatches]);
  // Colours changed by anything else (⌘Z, a fill, a tidy): the slider starts again from them.
  useEffect(() => {
    const session = edgeSessionRef.current;
    if (!session || !model || model.triangleColors === (session.left ?? session.base)) return;
    edgeSessionRef.current = null;
    setEdgeValue(50);
    setEdgeCount({ join: 0, leave: 0 });
  }, [model]);
  // When the colours change under a pick (the edge moved, ⌘Z, a cut moved), the patches are picked
  // again where they were, in their shape now — after the edge moved, from a face deep inside each.
  useEffect(() => {
    const current = modelRef.current;
    const hearts = edgeRepickRef.current;
    edgeRepickRef.current = null;
    if (!current || pickedRef.current.length === 0 || labels.length !== current.triangles.length) return;
    if (hearts) edgeRepickingRef.current = true;
    setPickedPatches(pickedRef.current.map((patch, i) => patchAt(current, hearts?.[i] ?? patch.anchor)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels]);

  // The group the left card shows: in 02 a patch picked on the model (the last one picked), else the
  // last colour chosen on the spectrum — a click on the model works like a click on the spectrum.
  // A colour just adjusted may still be asked for by its old hex for a moment; its twin answers.
  const liveGroupByHex = useMemo(() => {
    const map = new Map<string, StripGroup>();
    for (const group of committedGroups) if (group.colours.length > 0) map.set(rgbToHex(group.rep), group);
    return map;
  }, [committedGroups]);
  const liveHex = (hex: string | null): string | null => {
    if (!hex) return null;
    if (liveGroupByHex.has(hex)) return hex;
    return [...(hexTwinsRef.current.get(hex) ?? [])].find((twin) => liveGroupByHex.has(twin)) ?? null;
  };
  const cardHex =
    (step === 2 && pickedPatches.length > 0 ? liveHex(pickedPatches[pickedPatches.length - 1].hex) : null) ??
    [...selectedHexes].reverse().find((hex) => liveGroupByHex.has(hex)) ??
    null;

  function twinHexes(a: string, b: string): void {
    const twins = hexTwinsRef.current;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const set = twins.get(x) ?? new Set<string>();
      set.add(y);
      twins.set(x, set);
    }
  }

  /** The groups beside one on the spectrum (same family, lighter and darker): its shades stay a little short of their lightness. */
  function toneWallsOf(group: StripGroup): { walls: ToneWalls; lighter: StripGroup | null; darker: StripGroup | null } {
    // A pinned piece sits apart from the lightness order: nothing to keep short of.
    if (group.pinned) return { walls: { darkest: 0, lightest: 100 }, lighter: null, darker: null };
    const family = committedGroups.filter((other) => other.family === group.family && other.colours.length > 0 && !other.pinned);
    const at = family.indexOf(group);
    const lighter = family[at - 1] ?? null;
    const darker = family[at + 1] ?? null;
    return { walls: { darkest: darker ? darker.lightest + 1 : 0, lightest: lighter ? lighter.darkest - 1 : 100 }, lighter, darker };
  }

  // The picked pieces of the card's group, and whether the sliders work on them alone: with a patch
  // picked (and its group not a split-off piece already) the choice is offered, pieces first; a go
  // already started on pieces keeps going on them once they are a group of their own.
  const cardGroup = cardHex ? liveGroupByHex.get(cardHex) ?? null : null;
  const cardPieces = step === 2 && cardGroup ? pickedPatches.filter((patch) => liveHex(patch.hex) === cardHex) : [];
  const pieceKey = cardPieces.map((patch) => patch.anchor).sort((a, b) => a - b).join(",");
  const runningPieces = toneSessionRef.current?.scope === "piece" && (cardHex === toneSessionRef.current.hexNow || cardHex === toneSessionRef.current.hexPrev);
  const pieceChoice = runningPieces || (cardPieces.length > 0 && !cardGroup?.pinned);
  const toneScope: "piece" | "group" = runningPieces ? "piece" : pieceChoice ? toneScopeChoice : "group";
  const pieceFaceCount = cardPieces.reduce((sum, patch) => sum + patch.faces.length, 0);

  function chooseToneScope(scope: "piece" | "group"): void {
    if (scope === toneScope) return;
    // What was let go stays; the sliders start again from it for the other choice.
    endToneSession();
    setToneScopeChoice(scope);
  }

  /** The faces the card's colour picker works on — what the sliders would: the picked pieces of the group, or every face of it. */
  function groupPickFaces(): { faces: Int32Array; whole: boolean } | null {
    if (!model || !cardGroup || !faceColourIndex) return null;
    if (toneScope === "piece" && cardPieces.length > 0) {
      let n = 0;
      for (const patch of cardPieces) n += patch.faces.length;
      const faces = new Int32Array(n);
      let at = 0;
      for (const patch of cardPieces) {
        faces.set(patch.faces, at);
        at += patch.faces.length;
      }
      return { faces, whole: false };
    }
    const own = new Set(cardGroup.colours.map((colour) => colour.key));
    const { index, keys } = faceColourIndex;
    const ownUnique = new Uint8Array(keys.length);
    for (let u = 0; u < keys.length; u++) if (own.has(keys[u])) ownUnique[u] = 1;
    const faces: number[] = [];
    for (let f = 0; f < index.length; f++) if (ownUnique[index[f]]) faces.push(f);
    return { faces: Int32Array.from(faces), whole: true };
  }

  /**
   * The card's big swatch is a colour picker.  While it is open, its faces show
   * the colour being chosen (as a slider drag shows); closed without Apply, the
   * views show the model's own colours again.
   */
  function previewGroupPick(hex: string | null): void {
    const current = modelRef.current;
    if (!current) return;
    if (hex === null) {
      if (groupPickRef.current?.touched) setModel({ ...current });
      groupPickRef.current = null;
      return;
    }
    let held = groupPickRef.current;
    if (!held) {
      const got = groupPickFaces();
      if (!got) return;
      held = { faces: got.faces, touched: false };
      groupPickRef.current = held;
    }
    held.touched = true;
    const rgb = hexToRgb(hex);
    for (const handle of editedViewers()) handle.setFaceColours(held.faces, rgb);
  }

  /**
   * The card's picker applied: its faces take the colour chosen, as a fill does —
   * a colour the model does not have as a band of its own; the picked pieces as a
   * group of their own, the whole group as the same group in its new colour (its
   * protection and its place in the merge choices go along).  ⌘Z takes it back.
   */
  function applyGroupPick(hex: string): void {
    const chosen = hex.toUpperCase();
    if (!model || !cardHex || !/^#[0-9A-F]{6}$/.test(chosen)) return;
    const got = groupPickFaces();
    // The model itself changes now: nothing to put back when the picker closes.
    groupPickRef.current = null;
    if (!got || got.faces.length === 0) return;
    if (chosen === cardHex) {
      setStatus(t("status.fillSame", { hex: chosen }));
      return;
    }
    const { faces, whole } = got;
    const rgb = fillRgb(model, chosen);
    const shown = rgbToHex(rgb);
    const next = model.triangleColors.slice();
    for (let i = 0; i < faces.length; i++) next[faces[i]] = rgb;
    const grouping = groupingForNew(rgb);
    keepGroupsFor(model.triangleColors, next, grouping?.also, grouping?.pinned);
    const was = cardHex;
    if (whole) {
      if (grouping) setSettings((prev) => ({ ...prev, mergeFlags: carryFlags(prev.mergeFlags, was, shown) }));
      twinHexes(was, shown);
      setSelectedHexes((prev) => prev.map((h) => (h === was ? shown : h)));
    }
    endToneSession();
    // The picked pieces keep their faces, now in the new colour: the card follows them there.
    const painted = new Uint8Array(model.triangles.length);
    for (let i = 0; i < faces.length; i++) painted[faces[i]] = 1;
    setPickedPatches((prev) => prev.map((patch) => (painted[patch.anchor] ? { ...patch, hex: shown } : patch)));
    applyColours(model, next, { keepSelection: true });
    const n = faces.length.toLocaleString();
    setStatus(whole ? t("status.groupRecoloured", { from: was, to: chosen, n }) : t("status.recoloured", { n, hex: chosen, patches: cardPieces.length }));
  }

  /**
   * What each colour slider would make of the group's colour from one end to
   * the other (the other two where they are), for the slider's track: the
   * colours themselves, so where a slider stops changing anything shows.
   */
  function toneTracksFor(): Record<keyof Tone, string> | null {
    const session = toneSessionRef.current;
    if (!cardGroup) return null;
    const start = session ? session.colours.find((colour) => colour.key === session.repKey) : cardGroup.colours.find((colour) => colour.key === stripColourKey(cardGroup.rep));
    if (!start) return null;
    const walls = session ? session.walls : toneScope === "piece" ? { darkest: 0, lightest: 100 } : toneWallsOf(cardGroup).walls;
    const track = (axis: keyof Tone) => {
      const stops = [-100, -50, 0, 50, 100].map((v) => rgbToHex(toneColours([start], { ...tone, [axis]: v }, undefined, walls).get(start.key) as RGB));
      return `linear-gradient(90deg, ${stops[0]} 0%, ${stops[1]} 25%, ${stops[2]} calc(50% - 1px), rgba(255, 255, 255, 0.85) calc(50% - 1px), rgba(255, 255, 255, 0.85) calc(50% + 1px), ${stops[2]} calc(50% + 1px), ${stops[3]} 75%, ${stops[4]} 100%)`;
    };
    return { light: track("light"), chroma: track("chroma"), hue: track("hue") };
  }

  function endToneSession(): void {
    toneSessionRef.current = null;
    setTone(NO_TONE);
    setToneHex(null);
    setToneStart(null);
    setToneWall(null);
  }

  /**
   * The go of the colour sliders, started on the first touch (or again if the
   * colours, the group, the choice or the picked pieces changed): the whole
   * card's group, or only its picked pieces.
   */
  function toneSession(current: MeshModel): NonNullable<typeof toneSessionRef.current> | null {
    const live = toneSessionRef.current;
    if (
      live &&
      current.triangleColors === (live.left ?? live.base) &&
      (cardHex === live.hexNow || cardHex === live.hexPrev) &&
      live.scope === toneScope &&
      (live.scope === "group" || live.pickKey === pieceKey)
    )
      return live;
    const group = cardGroup;
    if (!cardHex || !group || !faceColourIndex || !stripData || current !== model) return null;
    const scope = toneScope === "piece" && cardPieces.length > 0 ? "piece" : "group";
    const groupOfKey = new Map<number, string>();
    for (const other of committedGroups) for (const colour of other.colours) groupOfKey.set(colour.key, `${other.family}:${other.index}`);
    const faces: number[] = [];
    const shade: number[] = [];
    let colours: StripColour[];
    let repKey: number;
    const taken = new Set<number>();
    if (scope === "piece") {
      // The picked faces' own shades; every colour of the model stays someone else's.
      const byKey = new Map<number, StripColour>();
      for (const family of stripData.families)
        for (const colour of family.colours) {
          byKey.set(colour.key, colour);
          taken.add(colour.key);
        }
      const shadeOfKey = new Map<number, number>();
      const area: number[] = [];
      colours = [];
      for (const patch of cardPieces)
        for (let i = 0; i < patch.faces.length; i++) {
          const f = patch.faces[i];
          const key = stripColourKey(current.triangleColors[f]);
          let at = shadeOfKey.get(key);
          if (at === undefined) {
            const colour = byKey.get(key);
            if (!colour) continue;
            at = colours.length;
            shadeOfKey.set(key, at);
            colours.push(colour);
            area.push(0);
          }
          faces.push(f);
          shade.push(at);
          area[at] += areaWeights[f] ?? 0;
        }
      if (colours.length === 0) return null;
      let most = 0;
      for (let i = 1; i < area.length; i++) if (area[i] > area[most]) most = i;
      repKey = colours[most].key;
    } else {
      const shadeOfKey = new Map<number, number>();
      group.colours.forEach((colour, i) => shadeOfKey.set(colour.key, i));
      const { index, keys } = faceColourIndex;
      const shadeOfUnique = new Int32Array(keys.length);
      for (let u = 0; u < keys.length; u++) shadeOfUnique[u] = shadeOfKey.get(keys[u]) ?? -1;
      for (let f = 0; f < index.length; f++) {
        const at = shadeOfUnique[index[f]];
        if (at < 0) continue;
        faces.push(f);
        shade.push(at);
      }
      for (const family of stripData.families) for (const colour of family.colours) if (!shadeOfKey.has(colour.key)) taken.add(colour.key);
      colours = group.colours;
      repKey = stripColourKey(group.rep);
    }
    const { walls, lighter, darker } = scope === "piece" ? { walls: { darkest: 0, lightest: 100 }, lighter: null, darker: null } : toneWallsOf(group);
    const session = {
      scope,
      pickKey: pieceKey,
      base: current.triangleColors,
      hexStart: cardHex,
      hexNow: cardHex,
      hexPrev: cardHex,
      colours,
      repKey,
      faces: Int32Array.from(faces),
      shade: Int32Array.from(shade),
      taken,
      walls,
      lighter,
      darker,
      groupOfKey,
      groupId: scope === "piece" ? "piece" : `${group.family}:${group.index}`,
      cuts: settings.stripByModel[stripKey] ?? null,
      pins: storedStrip?.pins ?? [],
      pin: scope === "group" && group.pinned ? group.colours[0].pin : undefined,
      from: storedStrip?.from ?? {},
      shown: NO_TONE,
      kept: NO_TONE,
      left: null,
      touched: false,
    } satisfies NonNullable<typeof toneSessionRef.current>;
    toneSessionRef.current = session;
    setToneStart(cardHex);
    return session;
  }

  /** While a slider moves: the faces shown at this tone (as a brush stroke shows), nothing kept yet. */
  function previewTone(next: Tone): void {
    setTone(next);
    const current = modelRef.current;
    if (!current) return;
    const session = toneSession(current);
    if (!session) return;
    const colourOf = toneColours(session.colours, next, session.taken, session.walls);
    session.shown = next;
    session.touched = true;
    const { faces, colours } = session;
    const rep = colourOf.get(session.repKey) ?? colours[0].rgb;
    // The palette and print views show the group's one colour; the source view the file's own, untouched.
    for (const handle of editedViewers()) handle.setFaceColours(faces, rep);
    setToneHex(rgbToHex(rep));
    // Brightness held back by the next group's lightness: say so, or the slider seems not to work.
    const repL = rgbToLab(rep).L;
    const wall = next.light < 0 && session.darker && repL - session.walls.darkest < 1.5 ? session.darker : next.light > 0 && session.lighter && session.walls.lightest - repL < 1.5 ? session.lighter : null;
    setToneWall(wall ? rgbToHex(wall.rep) : null);
  }

  /**
   * On letting go: the shades take this tone from the start (all at 0: the
   * start itself, cuts and all); every other group keeps its colours.  The
   * whole group keeps its band (and its protection) under its new colour;
   * picked pieces become a group of their own, pinned at the end of their
   * family on the spectrum (one more colour to print).  ⌘Z takes it back.
   * The sliders stay where they are.
   */
  function commitTone(): void {
    const session = toneSessionRef.current;
    const current = modelRef.current;
    if (!session || !current) return;
    const shown = session.shown;
    if (sameTone(shown, session.kept)) {
      // Let go where it was: the views may still show the way there.
      if (session.touched) setModel({ ...current });
      session.touched = false;
      return;
    }
    const none = isNoTone(shown);
    const piece = session.scope === "piece";
    let next = session.base;
    let stored = session.cuts;
    let hex = session.hexStart;
    if (!none) {
      const colourOf = toneColours(session.colours, shown, session.taken, session.walls);
      next = session.base.slice();
      for (let i = 0; i < session.faces.length; i++) next[session.faces[i]] = colourOf.get(session.colours[session.shade[i]].key) as RGB;
      const keys = [...new Set([...colourOf.values()].map((rgb) => stripColourKey(rgb)))];
      const groupOfKey = new Map(session.groupOfKey);
      for (const key of keys) groupOfKey.set(key, session.groupId);
      // The pieces' new colours pinned as one more pin; a pinned group adjusted whole keeps its pin.
      const pins = piece ? [...session.pins, keys] : session.pin !== undefined ? session.pins.map((own, i) => (i === session.pin ? keys : own)) : session.pins;
      // What to go back to: a piece, the colours it had; a pinned group, what it had; pieces split off
      // from a group adjusted whole, that group's new colours.
      const keyOf = (key: number) => {
        const rgb = colourOf.get(key);
        return rgb ? stripColourKey(rgb) : undefined;
      };
      // A piece split off from this group may have had shades only it had (gone from the group now):
      // they take the same tone, so the piece goes back as dark or light as the rest.
      const ownKeys = new Set(session.colours.map((colour) => colour.key));
      const alsoFromHere = new Map<number, ToneColour>();
      if (!piece && session.pin === undefined)
        for (const keys of session.pins) {
          if (!keys.some((key) => ownKeys.has(session.from[key]))) continue;
          for (const key of keys) {
            const was = session.from[key];
            if (was === undefined || ownKeys.has(was) || alsoFromHere.has(was)) continue;
            const rgb = rgbOfKey(was);
            alsoFromHere.set(was, { key: was, rgb, lab: rgbToLab(rgb), family: session.colours[0].family });
          }
        }
      const alsoToned = toneColours([...alsoFromHere.values()], shown, undefined, session.walls);
      const from =
        piece || session.pin !== undefined
          ? { ...session.from }
          : fromMoved(session.from, (key) => {
              const rgb = alsoToned.get(key);
              return keyOf(key) ?? (rgb ? stripColourKey(rgb) : undefined);
            });
      if (piece) for (const colour of session.colours) from![keyOf(colour.key) as number] = colour.key;
      else if (session.pin !== undefined)
        for (const colour of session.colours) if (session.from[colour.key] !== undefined) from![keyOf(colour.key) as number] = session.from[colour.key];
      const strip = buildColourStrip(next, areaWeightList, pinMap(pins));
      const cuts = cutsKeepingGroups(strip, groupOfKey);
      stored = stripStore(targetGroups, cuts, livePins(pins, strip), from);
      const rep = colourOf.get(session.repKey) as RGB;
      const repKey = stripColourKey(rep);
      const after = groupsFromCuts(strip, cuts).find((group) => group.colours.some((colour) => colour.key === repKey));
      hex = rgbToHex(after?.rep ?? rep);
    }
    const was = session.hexNow;
    // The pieces' group is new (and gone again at 0): the group they came from keeps its own flags and choice.
    const sameGroup = !piece || (was !== session.hexStart && !none);
    cutsWithColours.current.set(current.triangleColors, settings.stripByModel[stripKey] ?? null);
    cutsWithColours.current.set(next, stored);
    setSettings((prev) => {
      const strips = { ...prev.stripByModel };
      if (stored) strips[stripKey] = stored;
      else delete strips[stripKey];
      return { ...prev, stripByModel: strips, mergeFlags: hex === was || !sameGroup ? prev.mergeFlags : carryFlags(prev.mergeFlags, was, hex) };
    });
    if (hex !== was && sameGroup) {
      twinHexes(was, hex);
      setSelectedHexes((prev) => prev.map((h) => (h === was ? hex : h)));
    }
    session.hexPrev = was;
    session.hexNow = hex;
    session.left = next;
    session.kept = shown;
    session.touched = false;
    applyColours(current, next, { keepSelection: true });
    setToneHex(null);
    const n = session.faces.length.toLocaleString();
    setStatus(none ? t("status.toneBack", { hex }) : piece ? t("status.tonePiece", { n, to: hex }) : t("status.toneChanged", { from: session.hexStart, to: hex, n }));
  }

  const commitToneRef = useRef(commitTone);
  commitToneRef.current = commitTone;

  /**
   * The card's split-off piece back into the group it came from: its faces
   * take the colours they had before it was split off (a colour with nothing
   * recorded keeps its own and falls in with its lightness), its pin goes,
   * and every other group keeps its colours.  One colour fewer to print; ⌘Z
   * splits it off again.
   */
  function rejoinPiece(): void {
    const current = modelRef.current;
    const group = cardGroup;
    if (!current || current !== model || !group?.pinned || !faceColourIndex || !cardHex) return;
    const pin = group.colours[0].pin;
    const from = storedStrip?.from ?? {};
    const back = new Map<number, RGB>();
    for (const colour of group.colours) if (from[colour.key] !== undefined) back.set(colour.key, rgbOfKey(from[colour.key]));
    const next = current.triangleColors.slice();
    const { index, keys } = faceColourIndex;
    const backOfUnique = keys.map((key) => back.get(key) ?? null);
    let faces = 0;
    for (let f = 0; f < index.length; f++) {
      const rgb = backOfUnique[index[f]];
      if (!rgb) continue;
      next[f] = rgb;
      faces++;
    }
    const pins = (storedStrip?.pins ?? []).filter((_, i) => i !== pin);
    const groupOfKey = new Map<number, string>();
    for (const other of committedGroups) if (other !== group) for (const colour of other.colours) groupOfKey.set(colour.key, `${other.family}:${other.index}`);
    const strip = buildColourStrip(next, areaWeightList, pinMap(pins));
    const cuts = cutsKeepingGroups(strip, groupOfKey);
    const stored = stripStore(targetGroups, cuts, livePins(pins, strip), storedStrip?.from);
    // The group it went back to: the one its main colour's old colour is in now.
    const repBack = back.get(stripColourKey(group.rep));
    const home = repBack ? groupsFromCuts(strip, cuts).find((other) => other.colours.some((colour) => colour.key === stripColourKey(repBack))) : undefined;
    const hex = home ? rgbToHex(home.rep) : null;
    cutsWithColours.current.set(current.triangleColors, settings.stripByModel[stripKey] ?? null);
    cutsWithColours.current.set(next, stored);
    setSettings((prev) => ({ ...prev, stripByModel: { ...prev.stripByModel, [stripKey]: stored } }));
    setSelectedHexes((prev) => [...new Set(prev.flatMap((h) => (h === cardHex ? (hex ? [hex] : []) : [h])))]);
    endToneSession();
    applyColours(current, next, { keepSelection: true });
    setStatus(back.size > 0 ? t("status.rejoined", { n: faces.toLocaleString(), hex: hex ?? "" }) : t("status.rejoinedLoose"));
  }
  // Colours changed by anything else (⌘Z, a fill, a tidy) or another group on the card: the sliders start again at 0.
  useEffect(() => {
    const session = toneSessionRef.current;
    if (!session) return;
    const sameColours = model?.triangleColors === (session.left ?? session.base);
    const sameGroup = cardHex === session.hexNow || cardHex === session.hexPrev;
    if (!sameColours || !sameGroup) endToneSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, cardHex]);
  // After ⌘Z or redo an adjusted colour is back under its other hex: what was chosen (and protected) follows it.
  useEffect(() => {
    const twins = hexTwinsRef.current;
    if (twins.size === 0) return;
    const twinOf = (hex: string) => (positionByHex.has(hex) ? undefined : [...(twins.get(hex) ?? [])].find((h) => positionByHex.has(h)));
    setSelectedHexes((prev) => {
      if (!prev.some((hex) => twinOf(hex))) return prev;
      return [...new Set(prev.map((hex) => twinOf(hex) ?? hex))];
    });
    setSettings((prev) => {
      let flags = prev.mergeFlags;
      for (const hex of Object.keys(prev.mergeFlags)) {
        const twin = twinOf(hex);
        if (twin && !flags[twin]) flags = carryFlags(flags, hex, twin);
      }
      return flags === prev.mergeFlags ? prev : { ...prev, mergeFlags: flags };
    });
  }, [positionByHex]);

  function mergeSelected(targetHex: string): void {
    if (!targetHex || !positionByHex.has(targetHex)) return;
    const nextFlags = { ...settings.mergeFlags };
    for (const hex of selectedHexes) {
      if (hex === targetHex || !positionByHex.has(hex)) continue;
      nextFlags[hex] = {
        ...(nextFlags[hex] ?? { target: null, ambiguous: false, protect: false, minBlob: settings.merge.minBlobDefault }),
        target: targetHex,
      };
    }
    setSettings((prev) => ({ ...prev, mergeFlags: nextFlags }));
    setSelectedHexes([]);
    void runMerge(nextFlags);
  }

  function clearPick(): void {
    setPickedPatches([]);
    setShownHex(null);
  }

  // Space over the views turns the pointer into a hand, as in drawing apps: the
  // left button pans the 3D views and the colour map (the right button alone did,
  // which a trackpad hardly can, and the brush had no pan at all).  Elsewhere,
  // and in a text field, the key keeps its own job.
  useEffect(() => {
    const overViews = () => Boolean(stageRef.current?.querySelector(".viewers")?.matches(":hover"));
    const onDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typingIn(event.target as HTMLElement | null)) return;
      if (!handRef.current && !overViews()) return;
      event.preventDefault();
      if (!handRef.current) setHand(true);
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !handRef.current) return;
      event.preventDefault();
      setHand(false);
    };
    const release = () => setHand(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
    };
  }, []);

  // Escape clears the patch selection and the colours chosen on the spectrum or in the table — unless a
  // popover, a menu, the intro or a drag on the spectrum is using the key, or it is typed in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".colour-picker-popover, .colour-select-popover, .help-popover, .menu, .intro, .spectrum-cut.active")) return;
      const target = event.target as HTMLElement | null;
      if (typingIn(target)) return;
      if (pickedRef.current.length > 0 || shownHexRef.current) clearPick();
      setSelectedHexes((prev) => (prev.length > 0 ? [] : prev));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function patchAt(current: MeshModel, faceIndex: number): PickedPatch {
    const adjacency = adjacencyFor(current);
    const faces = sameLabelComponent(adjacency.offsets, adjacency.neighbours, labels, faceIndex);
    const position = labels[faceIndex];
    const hex = hexByPosition[position] ?? rgbToHex(current.triangleColors[faceIndex]);
    let area = 0;
    let total = 0;
    let id = faceIndex;
    for (let i = 0; i < areaWeights.length; i++) total += areaWeights[i];
    for (let i = 0; i < faces.length; i++) {
      area += areaWeights[faces[i]];
      if (faces[i] < id) id = faces[i];
    }
    return { id, faces, hex, index: palette[position]?.index ?? 0, fraction: total > 0 ? area / total : 0, anchor: faceIndex };
  }

  /**
   * Centre the *other* view on the clicked spot: a map pick pans the 3D cameras to the clicked face,
   * a 3D pick frames the part of the patch that lies in the clicked face's chart on the map (a patch
   * can be spread over many charts, so framing all of it would just show the whole map).
   */
  function focusPatch(patch: PickedPatch, source: PickInfo["source"], clickedFace: number): void {
    const current = modelRef.current;
    if (!current) return;
    const geometry = faceGeometryFor(current);
    if (source !== "3d") {
      const f = clickedFace >= 0 && clickedFace < geometry.centroids.length / 3 ? clickedFace : patch.faces[0];
      // Centroids are model space; the viewers draw in view space.
      const point = pointToView([geometry.centroids[f * 3], geometry.centroids[f * 3 + 1], geometry.centroids[f * 3 + 2]]);
      for (const handle of viewerHandles()) handle.focusOn(point);
    }
    // With the picked patches unfolded the map is laid out again for the new pick (and fits itself to it).
    const current2d = unfoldOn ? null : atlasRef.current?.atlas;
    if (current2d && mapRef.current && source !== "map") {
      const chart = current2d.chartOf[clickedFace] ?? -1;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const grow = (face: number) => {
        const o = face * 6;
        for (let k = 0; k < 3; k++) {
          const x = current2d.faceUv[o + k * 2];
          const y = current2d.faceUv[o + k * 2 + 1];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      };
      for (let i = 0; i < patch.faces.length; i++) if (current2d.chartOf[patch.faces[i]] === chart) grow(patch.faces[i]);
      if (!Number.isFinite(x0)) for (let i = 0; i < patch.faces.length; i++) grow(patch.faces[i]);
      if (Number.isFinite(x0)) mapRef.current.focusOn([x0, y0, x1, y1]);
    }
  }

  function selectionSummary(patches: PickedPatch[]): { n: number; faces: string; pct: string } {
    const faces = patches.reduce((sum, patch) => sum + patch.faces.length, 0);
    const fraction = patches.reduce((sum, patch) => sum + patch.fraction, 0);
    return { n: patches.length, faces: faces.toLocaleString(), pct: pct(fraction) };
  }

  /** Eyedropper: the face's palette colour becomes the brush / "change to" colour. */
  function sampleFace(faceIndex: number | null): void {
    const current = modelRef.current;
    setEyedropper(false);
    if (!current || faceIndex === null || faceIndex < 0 || faceIndex >= labels.length) {
      setStatus(t("status.pickNothing"));
      return;
    }
    samplePosition(labels[faceIndex], rgbToHex(current.triangleColors[faceIndex]));
  }

  /** The eyedropper's colour: a palette colour (or `fallback` when it is not one). */
  function samplePosition(position: number, fallback?: string): void {
    setEyedropper(false);
    const hex = hexByPosition[position] ?? fallback;
    if (!hex) {
      setStatus(t("status.pickNothing"));
      return;
    }
    if (hexByPosition.includes(hex)) setPickTarget(hex);
    else {
      setPickTarget("__new__");
      setPickCustom(hex);
    }
    setStatus(t("status.eyedropper", { index: palette[position]?.index ?? 0, hex }));
  }

  async function handlePick(faceIndex: number | null, info: PickInfo = { double: false, toggle: false }): Promise<void> {
    if (!model) return;
    // A click on a preview piece means the colour it shows (see faceShownAt): picking, the fill tool and the eyedropper alike.
    if (faceIndex !== null && info.piece !== undefined) {
      const shown = faceShownAt(faceIndex, info.piece);
      if (shown < 0) {
        // That colour is in the preview only: the eyedropper takes it; a pick or a fill would
        // take the face's own colour under it — say so instead, beside the confirm button.
        const group = viewerCut?.group?.[info.piece] ?? -1;
        if ((info.alt || eyedropperRef.current) && group >= 0) {
          samplePosition(group);
          return;
        }
        if (cutSpan > 0) setCutNotice("piece");
        setStatus(t("status.previewPiece"));
        return;
      }
      faceIndex = shown;
    }
    if (info.alt || eyedropperRef.current) {
      sampleFace(faceIndex);
      return;
    }
    if (fillModeRef.current) {
      // The first click of a double click has filled already.
      if (!info.double) fillAt(faceIndex);
      return;
    }
    if (faceIndex === null || faceIndex < 0 || faceIndex >= labels.length) {
      if (pickedRef.current.length > 0 || shownHexRef.current) clearPick();
      else setStatus(t("status.pickNothing"));
      return;
    }
    setBusy(t("busy.picking"));
    await yieldToUi();
    try {
      const patch = patchAt(model, faceIndex);
      // In 02 the left card shows the picked patch's group, as a click on the spectrum would; a choice
      // on the spectrum drops a pick, so a pick drops the choice there.
      if (step === 2) setSelectedHexes((prev) => (prev.length > 0 ? [] : prev));
      const current = pickedRef.current;
      const exists = current.some((p) => p.id === patch.id);
      if (info.double) {
        // Colour mode: outline every patch of this colour; keep the clicked patch selected.
        const next = exists ? current : [...current, patch];
        setPickedPatches(next);
        setShownHex(patch.hex);
        setStatus(t("status.colourMode", { index: patch.index, hex: patch.hex, ...selectionSummary(next) }));
        focusPatch(patch, info.source, faceIndex);
      } else if (info.toggle || gapModeRef.current) {
        // Shift (or ⌘, Ctrl) adds or takes away.  (The gap clean needs two colours, so there a click adds.)
        const next = exists ? current.filter((p) => p.id !== patch.id) : [...current, patch];
        setPickedPatches(next);
        setStatus(t(exists ? "status.pickRemoved" : "status.pickAdded", { index: patch.index, hex: patch.hex, ...selectionSummary(next) }));
        if (!exists) focusPatch(patch, info.source, faceIndex);
      } else {
        // A plain click picks this patch alone, in colour mode too (it ends it): a double click
        // made by chance must not leave every later click adding.
        setShownHex(null);
        setPickedPatches([patch]);
        setStatus(t("status.picked", { index: patch.index, hex: patch.hex, n: patch.faces.length.toLocaleString(), pct: pct(patch.fraction), extruder: step >= 3 ? ` → ${extruderText(patch.index)}` : "" }));
        focusPatch(patch, info.source, faceIndex);
      }
      // In 03 the picked colour's recipe opens beside the matrix, ready to change.
      if (step === 3) {
        const row = matrixRows.find((r) => r.hex === patch.hex);
        if (row) setMixRowIndex(row.paletteIndex);
      }
      // The chosen colour stays for the next pick (and for the brush and the
      // fill tool, which share it) — even when the patch just picked has it:
      // filling is off then, and the next patch is filled with it again.
    } finally {
      setBusy(null);
    }
  }

  /** Change the value of a palette colour: every face labelled with it takes the new colour. */
  function recolourPaletteColour(oldHex: string, newHex: string): void {
    if (!model) return;
    const position = positionByHex.get(oldHex);
    const target = newHex.toUpperCase();
    if (position === undefined || !/^#[0-9A-F]{6}$/.test(target) || target === oldHex) return;
    const rgb = hexToRgb(target);
    const next = model.triangleColors.slice();
    let n = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === position) {
        next[i] = rgb;
        n++;
      }
    }
    // Carry the merge flags of the old colour over to the new hex.
    setSettings((prev) => ({ ...prev, mergeFlags: carryFlags(prev.mergeFlags, oldHex, target) }));
    const group = committedGroups.find((g) => g.colours.length > 0 && rgbToHex(g.rep) === oldHex);
    const newKey = stripColourKey(rgb);
    let pinned: { pins: number[][] | undefined; from: Record<string, number> | undefined } | undefined;
    if (group) {
      const own = new Set(group.colours.map((colour) => colour.key));
      const pins = storedStrip?.pins;
      const at = pins ? pins.findIndex((keys) => keys.some((key) => own.has(key))) : -1;
      // A pinned piece given a new colour stays a piece of its own (and goes back where it came from);
      // pieces split off from this group now came from its new colour.
      const fromWas = storedStrip?.from;
      const cameFrom = at >= 0 && pins ? pins[at].map((key) => fromWas?.[key]).find((was) => was !== undefined) : undefined;
      const from = fromMoved(fromWas, (key) => (own.has(key) ? newKey : undefined));
      if (at >= 0 && pins) {
        const kept = { ...(from ?? {}) };
        if (cameFrom !== undefined) kept[newKey] = cameFrom;
        pinned = { pins: pins.map((keys, i) => (i === at ? [newKey] : keys)), from: kept };
      } else if (from) pinned = { pins, from };
    }
    keepGroupsFor(model.triangleColors, next, group ? new Map([[newKey, `${group.family}:${group.index}`]]) : undefined, pinned);
    applyColours(model, next);
    setStatus(t("status.paletteRecoloured", { from: oldHex, to: target, n: n.toLocaleString() }));
  }

  /**
   * A palette colour exactly as the model has it, or a new colour of its own.  A new colour
   * the model already has as a hidden shade inside some group would join that group when the
   * fill or stroke lands, and show as the group's colour (11-03: orange painted, yellow once
   * let go): it is taken one step off instead — a colour of its own, the same to the eye.
   * The step it took before (now its own group's colour) is found again, so every stroke of
   * the same new colour goes into the same group.
   */
  function fillRgb(_current: MeshModel, targetHex: string): RGB {
    // The group's own colour (the shade with the most area, as the palette shows it): filling with it
    // keeps it the most, so the group's colour — and the "change to" colour — stay as they are.
    const position = positionByHex.get(targetHex);
    if (position !== undefined && palette[position]) return palette[position].rgb;
    const rgb = hexToRgb(targetHex);
    if (!stripData) return rgb;
    const present = new Set<number>();
    for (const family of stripData.families) for (const colour of family.colours) present.add(colour.key);
    if (!present.has(stripColourKey(rgb))) return rgb;
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    for (let d = 1; d <= 8; d++)
      for (const [dr, dg, db] of [[0, 0, d], [0, 0, -d], [0, d, 0], [0, -d, 0], [d, 0, 0], [-d, 0, 0]]) {
        const near: RGB = [clamp(rgb[0] + dr), clamp(rgb[1] + dg), clamp(rgb[2] + db)];
        const at = positionByHex.get(rgbToHex(near));
        if (at !== undefined && palette[at]) return palette[at].rgb;
        if (!present.has(stripColourKey(near))) return near;
      }
    return rgb;
  }

  /**
   * How a colour the model does not have yet, put down by a fill or the brush,
   * joins the palette: as a band of its own (pinned at its family's end under a
   * group name of its own, as a piece split off is), so the model shows the colour
   * chosen — not the band its lightness happens to fall in (11-03: a new tan went in
   * as VE8).  Undefined for a colour the model has: it stays in its group.
   */
  function groupingForNew(rgb: RGB): { also: Map<number, string>; pinned: { pins: number[][]; from: Record<string, number> | undefined } } | undefined {
    const key = stripColourKey(rgb);
    for (const group of committedGroups) if (group.colours.some((colour) => colour.key === key)) return undefined;
    const pins = storedStrip?.pins ?? [];
    if (pins.some((keys) => keys.includes(key))) return undefined;
    return { also: new Map([[key, `new:${key}`]]), pinned: { pins: [...pins, [key]], from: storedStrip?.from } };
  }

  /** Fills the picked patches with the "change to" colour — or with `chosen` (the picker's Apply). */
  function applyPickColour(chosen?: string): void {
    if (!model || pickedPatches.length === 0) return;
    const targetHex = (chosen ?? (pickTarget === "__new__" ? pickCustom : pickTarget)).toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(targetHex)) return;
    if (chosen !== undefined && pickedHexes.length === 1 && pickedHexes[0] === targetHex) {
      setStatus(t("status.fillSame", { hex: targetHex }));
      return;
    }
    const rgb = fillRgb(model, targetHex);
    const next = model.triangleColors.slice();
    let count = 0;
    for (const patch of pickedPatches) {
      for (let i = 0; i < patch.faces.length; i++) next[patch.faces[i]] = rgb;
      count += patch.faces.length;
    }
    const grouping = groupingForNew(rgb);
    keepGroupsFor(model.triangleColors, next, grouping?.also, grouping?.pinned);
    applyColours(model, next);
    setStatus(t("status.recoloured", { n: count.toLocaleString(), hex: targetHex, patches: pickedPatches.length }));
  }

  /** The picker's Apply: the colour chosen becomes the "change to" colour (and, with a selection, fills it). */
  function takePickedColour(hex: string, fill: boolean): void {
    const chosen = hex.toUpperCase();
    if (positionByHex.has(chosen)) setPickTarget(chosen);
    else {
      setPickCustom(chosen);
      setPickTarget("__new__");
    }
    if (fill && pickedPatches.length > 0) applyPickColour(chosen);
  }

  /**
   * Gap clean: between the picked colours, faces of another colour wedged a
   * face or two deep go to the side they are joined to more strongly; "all"
   * does it between any two colours, after a warning to protect what must
   * stay.  One undo step.  See engine/gapClean.ts for the rules.
   */
  async function runGap(): Promise<void> {
    if (!model || busy !== null) return;
    const scope = gapScope;
    // Colours chosen on the spectrum (or in the table) count as picks of every place of them.
    const chosenHexes = gapChosenHexes;
    /** Every face of these palette colours. */
    const facesOfColours = (hexes: string[]): Int32Array => {
      const wanted = new Set(hexes.map((hex) => positionByHex.get(hex)).filter((p): p is number => p !== undefined));
      const out: number[] = [];
      for (let f = 0; f < labels.length; f++) if (wanted.has(labels[f])) out.push(f);
      return Int32Array.from(out);
    };
    const keptCount = new Set([...pickedPatches.map((patch) => patch.hex), ...chosenHexes]).size;
    if (scope === "part" && keptCount < 2) {
      setStatus(t("gap.needTwo", { n: keptCount }));
      return;
    }
    // "picked": the picked patches, and every place of a colour shown (double click) or chosen.
    const pickedFaces = (): Int32Array => {
      const take = new Uint8Array(labels.length);
      for (const patch of pickedPatches) for (let i = 0; i < patch.faces.length; i++) take[patch.faces[i]] = 1;
      const whole = facesOfColours(shownHex ? [...chosenHexes, shownHex] : chosenHexes);
      for (let i = 0; i < whole.length; i++) take[whole[i]] = 1;
      const out: number[] = [];
      for (let f = 0; f < take.length; f++) if (take[f]) out.push(f);
      return Int32Array.from(out);
    };
    if (scope === "picked" && pickedPatches.length === 0 && !shownHex && chosenHexes.length === 0) {
      setStatus(t("gap.needPick"));
      return;
    }
    const melt = scope === "picked" ? pickedFaces() : null;
    // A double click can take a whole big colour: more than a sliver of the surface asks first
    // (by area, as the selection shows it).
    if (melt) {
      let area = 0;
      let total = 0;
      for (let i = 0; i < areaWeights.length; i++) total += areaWeights[i];
      for (let i = 0; i < melt.length; i++) area += areaWeights[melt[i]];
      const share = total > 0 ? area / total : 0;
      if (share > GAP_PICK_ASK_SHARE && !window.confirm(t("gap.confirmBigPick", { pct: (share * 100).toFixed(1), n: melt.length.toLocaleString() }))) return;
    }
    if (scope === "all") {
      const shielded = hexByPosition.filter((hex) => protectedHexes.has(hex)).length;
      if (!window.confirm(t("gap.confirmAll", { n: shielded, none: shielded === 0 ? t("gap.confirmNone") : "" }))) return;
    }
    if (melt) {
      // Places big enough to be a detail are asked about first, the biggest first.
      const shielded = protectedPositions();
      const scale = mmPerUnit * mmPerUnit;
      const big = placesOf(adjacencyFor(model), melt.filter((f) => !shielded[labels[f]]))
        .map((faces) => {
          let area = 0;
          for (let i = 0; i < faces.length; i++) area += areaWeights[faces[i]];
          return { faces, area: area * scale };
        })
        .filter((place) => discDiameter(place.area) >= gapBigMm)
        .sort((a, b) => b.area - a.area);
      if (big.length > 0) {
        const review: GapReview = {
          melt,
          places: big.map((place) => place.faces),
          areas: big.map((place) => place.area),
          keep: [],
          before: { picked: pickedPatches, chosen: selectedHexes, shown: shownHex },
        };
        setGapReview(review);
        setSelectedHexes([]);
        setShownHex(null);
        showGapPlace(review, 0);
        return;
      }
    }
    await cleanNow(scope, {
      patches: scope === "part" ? [...pickedPatches.map((patch) => patch.faces), ...chosenHexes.map((hex) => facesOfColours([hex]))] : undefined,
      faces: melt ?? undefined,
    });
  }

  /** 1 for the palette positions of protected colours. */
  function protectedPositions(): Uint8Array {
    const out = new Uint8Array(palette.length);
    hexByPosition.forEach((hex, position) => {
      if (protectedHexes.has(hex)) out[position] = 1;
    });
    return out;
  }

  /** The gap clean itself, once everything is asked: one undo step. */
  async function cleanNow(scope: "part" | "picked" | "all", what: { patches?: Int32Array[]; faces?: Int32Array; keptPlaces?: number }): Promise<void> {
    if (!model) return;
    setBusy(t("busy.gap"));
    await yieldToUi();
    try {
      const result = cleanGaps(
        { adjacency: adjacencyFor(model), triangles: model.triangles, vertices: model.vertices, labels, colours: model.triangleColors, protectedLabels: protectedPositions() },
        scope === "part" ? { kind: "between", patches: what.patches ?? [] } : scope === "picked" ? { kind: "picked", faces: what.faces ?? new Int32Array(0) } : { kind: "all" },
      );
      const kept = what.keptPlaces ? ` ${t("gap.keptPlaces", { n: what.keptPlaces })}` : "";
      if (result.changed.length === 0) {
        if (scope === "picked") clearPick();
        setStatus(t(scope === "part" ? "gap.nonePart" : scope === "picked" ? "gap.nonePicked" : "gap.noneAll") + kept);
        return;
      }
      const detail = [...result.into]
        .sort((a, b) => b[1] - a[1])
        .map(([position, n]) => `${hexByPosition[position]} ${n.toLocaleString()}`)
        .join(" · ");
      // Between patches the same places stay picked: their outlines show the gap gone.
      if (scope === "part") regrabRef.current = pickedPatches.map((patch) => patch.anchor);
      // Melted colours may be gone: the spectrum lets go of them.
      if (scope === "picked") setSelectedHexes([]);
      keepGroupsFor(model.triangleColors, result.colours);
      applyColours(model, result.colours, { keepSelection: scope === "part" });
      const done = t(scope === "part" ? "gap.donePart" : scope === "picked" ? "gap.donePicked" : "gap.doneAll", { n: result.changed.length.toLocaleString(), detail });
      setStatus((result.left > 0 ? `${done} ${t("gap.leftPicked", { n: result.left.toLocaleString() })}` : done) + kept);
    } finally {
      setBusy(null);
    }
  }

  /** Shows the review's place `index`: picked (outlined, with its tag) and brought into view. */
  function showGapPlace(review: GapReview, index: number): void {
    const faces = review.places[index];
    if (!faces || faces.length === 0) return;
    let id = faces[0];
    for (let i = 0; i < faces.length; i++) if (faces[i] < id) id = faces[i];
    const position = labels[faces[0]];
    let total = 0;
    let area = 0;
    for (let i = 0; i < areaWeights.length; i++) total += areaWeights[i];
    for (let i = 0; i < faces.length; i++) area += areaWeights[faces[i]];
    const place: PickedPatch = { id, faces, hex: hexByPosition[position] ?? "#000000", index: palette[position]?.index ?? 0, fraction: total > 0 ? area / total : 0, anchor: faces[0] };
    setPickedPatches([place]);
    focusPatch(place, undefined, faces[0]);
  }

  /** An answer to the review: keep this place, melt it, the same for all that are left, or stop. */
  function answerGapReview(answer: "keep" | "melt" | "keepRest" | "meltRest" | "stop"): void {
    const review = gapReviewRef.current;
    if (!review) return;
    if (answer === "stop") {
      setGapReview(null);
      setPickedPatches(review.before.picked);
      setSelectedHexes(review.before.chosen);
      setShownHex(review.before.shown);
      setStatus(t("gap.reviewStopped"));
      return;
    }
    const keep = review.keep.slice();
    if (answer === "keep" || answer === "melt") keep.push(answer === "keep");
    else while (keep.length < review.places.length) keep.push(answer === "keepRest");
    if (keep.length < review.places.length) {
      const next = { ...review, keep };
      setGapReview(next);
      showGapPlace(next, keep.length);
      return;
    }
    setGapReview(null);
    const skip = new Uint8Array(labels.length);
    let keptPlaces = 0;
    review.places.forEach((faces, i) => {
      if (!keep[i]) return;
      keptPlaces++;
      for (let k = 0; k < faces.length; k++) skip[faces[k]] = 1;
    });
    void cleanNow("picked", { faces: review.melt.filter((f) => !skip[f]), keptPlaces });
  }
  const gapAnswerRef = useRef(answerGapReview);
  gapAnswerRef.current = answerGapReview;
  // Leaving the tool or the way of cleaning stops a review; so does Escape.
  useEffect(() => {
    if (gapReviewRef.current && (!gapMode || gapScope !== "picked")) gapAnswerRef.current("stop");
  }, [gapMode, gapScope]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gapReviewRef.current) gapAnswerRef.current("stop");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const anchors = regrabRef.current;
    if (!anchors || !model) return;
    regrabRef.current = null;
    const seen = new Set<number>();
    const next: PickedPatch[] = [];
    for (const face of anchors) {
      const patch = patchAt(model, face);
      if (seen.has(patch.id)) continue;
      seen.add(patch.id);
      next.push(patch);
    }
    setPickedPatches(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels]);

  /**
   * Fill tool: the patch under the click takes the fill colour — or, clicked
   * inside the selection, every picked patch does (and the selection is let
   * go, as with the pick bar's button).  One undo step either way.
   */
  function fillAt(faceIndex: number | null): void {
    if (!model) return;
    if (faceIndex === null || faceIndex < 0 || faceIndex >= labels.length) {
      setStatus(t("status.pickNothing"));
      return;
    }
    const inSelection = pickedMask !== null && pickedMask[faceIndex] === 1;
    const rgb = fillRgb(model, brushHex);
    const next = model.triangleColors.slice();
    let count = 0;
    const fill = (faces: Int32Array) => {
      for (let i = 0; i < faces.length; i++) {
        const c = next[faces[i]];
        if (c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]) continue;
        next[faces[i]] = rgb;
        count++;
      }
    };
    if (inSelection) for (const patch of pickedPatches) fill(patch.faces);
    else fill(patchAt(model, faceIndex).faces);
    if (count === 0) {
      setStatus(t("status.fillSame", { hex: brushHex }));
      return;
    }
    const grouping = groupingForNew(rgb);
    keepGroupsFor(model.triangleColors, next, grouping?.also, grouping?.pinned);
    applyColours(model, next, { keepSelection: !inSelection });
    setStatus(
      inSelection
        ? t("status.filledSelection", { patches: pickedPatches.length, n: count.toLocaleString(), hex: brushHex })
        : t("status.filledPatch", { n: count.toLocaleString(), hex: brushHex }),
    );
  }

  // Remembered PrusaSlicer template (IndexedDB).
  useEffect(() => {
    if (templateRestoredRef.current) return;
    templateRestoredRef.current = true;
    if (!settings.rememberTemplate) return;
    void (async () => {
      const stored = await dataGet<{ name: string; buffer: ArrayBuffer }>("template");
      if (!stored || !(stored.buffer instanceof ArrayBuffer)) return;
      try {
        const file = new File([stored.buffer], stored.name, { type: "model/3mf" });
        const info = await readTemplate3mf(file);
        setTemplate({ info, buffer: stored.buffer });
        // The template's bed only for the printer it was made for: an XL
        // template must not put a 360 mm bed under an A1 on every start.
        const bed = info.bedSize;
        if (bed)
          setSettings((prev) =>
            templateFitsPrinter(findPrinter(prev.export.printerId), info.printerModel)
              ? { ...prev, export: { ...prev.export, bedX: Math.round(bed.x), bedY: Math.round(bed.y) } }
              : prev,
          );
        setStatus(t("status.templateRestored", { name: stored.name }));
      } catch {
        void dataDelete("template");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!settings.rememberTemplate) {
      void dataDelete("template");
      return;
    }
    if (template) void dataSet("template", { name: template.info.fileName, buffer: template.buffer });
  }, [settings.rememberTemplate, template]);

  /**
   * Copy the template's extruder filaments (colour, preset name, type) into the slots E1..En and
   * add them to the filament list. Returns how many slots were set.
   */
  function applyTemplateFilaments(info: Template3mfInfo): number {
    const colours = info.physicalColours;
    if (colours.length === 0) return 0;
    const count = Math.max(MIN_PHYSICAL, Math.min(MAX_PHYSICAL, colours.length));
    setSettings((prev) => {
      const hex = prev.filaments.hex.slice();
      const names = prev.filaments.names.slice();
      const list = prev.filamentList.slice();
      for (let i = 0; i < count && i < colours.length; i++) {
        hex[i] = rgbToHex(colours[i]);
        const name = (info.physicalNames[i] ?? "").trim();
        if (name) names[i] = name;
        if (name && !list.some((entry) => entry.hex.toUpperCase() === hex[i] && entry.name === name)) {
          list.push({ name, type: (info.physicalTypes[i] ?? "").trim(), hex: hex[i] });
        }
      }
      // Keep one undo of hand-set slot colours; a second adopt must not
      // overwrite it with the template's own colours.
      const changed =
        count !== prev.filaments.count || hex.some((value, i) => value !== prev.filaments.hex[i]);
      return {
        ...prev,
        filaments: { ...prev.filaments, count, hex, names },
        filamentsUndo: changed ? prev.filaments : prev.filamentsUndo,
        filamentList: list,
        manualPhysical: {},
      };
    });
    return Math.min(count, colours.length);
  }

  function adoptTemplateColours(): void {
    if (!template) return;
    // applyTemplateFilaments stores the previous slot colours for one undo.
    const n = applyTemplateFilaments(template.info);
    if (n > 0) setStatus(t("status.templateFilamentsApplied", { n }));
  }

  /**
   * Hand-editing the slots means the user has taken the colours over, so the
   * "go back to my colours" offer stops applying and is dropped.
   */
  function changeFilaments(next: PipelineSettings["filaments"]): void {
    setSettings((prev) => {
      const touched =
        next.count !== prev.filaments.count || next.hex.some((hex, i) => hex !== prev.filaments.hex[i]);
      return { ...prev, filaments: next, filamentsUndo: touched ? null : prev.filamentsUndo };
    });
  }

  function undoAdoptTemplateColours(): void {
    setSettings((prev) =>
      prev.filamentsUndo ? { ...prev, filaments: prev.filamentsUndo, filamentsUndo: null } : prev,
    );
    setStatus(t("status.filamentsRestored"));
  }

  function clearTemplate(): void {
    setTemplate(null);
    void dataDelete("template");
  }

  // Suggest merge flags for palette colours that have none yet.
  useEffect(() => {
    if (palette.length === 0) return;
    setSettings((prev) => {
      let changed = false;
      const next = { ...prev.mergeFlags };
      palette.forEach((entry, position) => {
        const hex = rgbToHex(entry.rgb);
        if (next[hex]) return;
        next[hex] = autoFlagFor(entry.rgb, areaByPosition[position] ?? 0, prev);
        changed = true;
      });
      return changed ? { ...prev, mergeFlags: next } : prev;
    });
  }, [palette, areaByPosition]);

  function autoFlagFor(rgb: RGB, area: number, current: PipelineSettings): MergeFlag {
    const m = current.merge;
    return {
      target: null,
      ambiguous: isLikelyAmbiguousColour(rgb, area, {
        maxSaturation: m.ambiguousMaxSaturation,
        minValue: m.ambiguousMinValue,
        maxValue: m.ambiguousMaxValue,
        minAreaFraction: m.ambiguousMinAreaPercent / 100,
      }),
      protect: isLikelyProtectedColour(rgb, area, { maxAreaFraction: m.protectMaxAreaPercent / 100, minSaturation: m.protectMinSaturation }),
      minBlob: isSkinLikeColour(rgb) ? m.minBlobSkin : isDarkColour(rgb) ? m.minBlobDark : m.minBlobDefault,
    };
  }

  function reapplyAutoFlags(): void {
    setSettings((prev) => {
      const next = { ...prev.mergeFlags };
      palette.forEach((entry, position) => {
        const hex = rgbToHex(entry.rgb);
        next[hex] = { ...autoFlagFor(entry.rgb, areaByPosition[position] ?? 0, prev), target: next[hex]?.target ?? null };
      });
      return { ...prev, mergeFlags: next };
    });
  }

  function updateFlag(hex: string, patch: Partial<MergeFlag>): void {
    setSettings((prev) => ({
      ...prev,
      mergeFlags: {
        ...prev.mergeFlags,
        [hex]: { ...(prev.mergeFlags[hex] ?? { target: null, ambiguous: false, protect: false, minBlob: prev.merge.minBlobDefault }), ...patch },
      },
    }));
  }

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------
  async function parseModelFile(file: File, kind: StoredWorkFile["kind"], nomadPalette?: RGB[]): Promise<LoadedModel> {
    if (kind === "rodin") {
      const result = await loadRodin3mf(file, file.name);
      return {
        model: result.model,
        info: {
          kind: "rodin",
          fileName: file.name,
          uniqueColours: result.model.stats.uniqueFaceColors,
          rodin: {
            paletteHex: result.paletteHex,
            usedPaletteNumbers: result.usedPaletteNumbers,
            warnings: result.warnings,
            paletteSource: result.paletteSource,
            paletteCount: result.stats.paletteCount,
            usedColourCount: result.stats.usedColourCount,
            unpaintedTriangleCount: result.stats.unpaintedTriangleCount,
          },
        },
        status: t("status.rodinLoaded", {
          faces: result.stats.triangleCount.toLocaleString(),
          vertices: result.stats.vertexCount.toLocaleString(),
          palette: result.stats.paletteCount,
          used: result.stats.usedColourCount,
        }),
      };
    }
    if (kind === "nomad") {
      const parsed = parseNomadObj(await file.text());
      const result = applyNomadObjToModel(null, parsed, nomadPalette ?? [], file.name);
      return {
        model: result.model,
        info: { kind: "nomad", fileName: file.name, uniqueColours: result.colourCount },
        status: t("status.objLoaded", { faces: result.model.stats.triangleCount.toLocaleString(), colours: result.colourCount }),
      };
    }
    const parsed = await parseObjFile(file, (p) => {
      if (p.totalBytes && p.loadedBytes !== undefined) setBusy(t("busy.readingObjPct", { pct: Math.round((p.loadedBytes / p.totalBytes) * 100) }));
    });
    return {
      model: parsed,
      info: { kind: "obj", fileName: file.name, uniqueColours: parsed.stats.uniqueFaceColors },
      status: t("status.objLoaded", { faces: parsed.stats.triangleCount.toLocaleString(), colours: parsed.stats.uniqueFaceColors }),
    };
  }

  function installModel(
    next: MeshModel,
    info: SourceInfo,
    source: WorkSource | null,
    options?: { persist?: boolean; original?: RGB[]; history?: RGB[][]; restored?: boolean; sameWork?: boolean },
  ): void {
    // Work put back (the autosave, a work file) keeps its hand-set print choices and orientation.
    const sameWork = options?.restored || options?.sameWork;
    // Faces of one colour share its array, whatever read the model (rgbPool: a third of a big model's memory).
    shareNewColours(next.triangleColors, null);
    if (options?.original && options.original !== next.triangleColors) shareNewColours(options.original, null);
    loadGenerationRef.current += 1;
    modelFileRef.current = source;
    adjacencyRef.current = null;
    atlasRef.current = null;
    faceGeometryRef.current = null;
    strokeRef.current = null;
    setAtlas(null);
    originalColoursRef.current = options?.original ?? next.triangleColors;
    lastSavedColoursRef.current = next.triangleColors;
    setHistory(options?.history ?? []);
    undoOrderRef.current = (options?.history ?? []).map(() => "colours");
    setFuture([]);
    meshUndoRef.current = [];
    meshRedoRef.current = [];
    redoOrderRef.current = [];
    setCutNotice(cutSpan > 0 ? "load" : null);
    lastSavedCutsRef.current = options?.restored ? (cutLogRef.current.get(next.triangles) ?? []) : null;
    setWorkRestored(options?.restored ?? false);
    setMergeReport(null);
    setNomadReport(null);
    clearPick();
    setSelectedHexes([]);
    setHoverHex(null);
    setModel(next);
    setSourceInfo(info);
    forgetRecipeUndo();
    forgetTidyUndo();
    setTidyResult(null);
    setSettings((prev) => ({
      ...prev,
      // The print choices made by hand (03) are numbered by palette colour: another
      // model's do not fit this one.  Work put back keeps its own — they used to be
      // wiped on every reload.
      ...(sameWork ? {} : { manualPhysical: {}, recipeOverrides: {} }),
      // The orientation belongs to the model: a face put down for the last one
      // used to stay and lay the next one over.  Restored work keeps its own.
      export: { ...prev.export, fileName: "", ...(sameWork ? {} : { coordinateMode: orientationFor(info.kind) }) },
    }));
    setFitNonce((n) => n + 1);
    if (options?.persist === false) return;
    if (source && rememberWorkRef.current) void persistWorkFile(source, loadGenerationRef.current);
    else setAutosave({ state: "none", at: null });
  }

  async function onModelFile(file: File): Promise<void> {
    if (file.name.toLowerCase().endsWith(WORK_FILE_EXT)) return openWorkFile(file);
    const kind: StoredWorkFile["kind"] = file.name.toLowerCase().endsWith(".3mf") ? "rodin" : "obj";
    setBusy(kind === "rodin" ? t("busy.reading3mf") : t("busy.readingObj"));
    await yieldToUi();
    try {
      const loaded = await parseModelFile(file, kind);
      installModel(loaded.model, loaded.info, { file, kind });
      setStatus(loaded.status);
      countAction(`load/${kind}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(t("status.error", { message: message === RODIN_TEXTURE_MODE_MESSAGE ? t("load.textureMode3mf") : message }));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Work autosave (IndexedDB): the model file bytes + the current face colours.
  // ------------------------------------------------------------------
  async function persistWorkFile(source: WorkSource, generation: number): Promise<boolean> {
    setAutosave({ state: "saving", at: null });
    try {
      // The stored colours and cuts belong to the previous model; drop them before the new file lands.
      await Promise.all([dataDelete(WORK_COLOURS_KEY), dataDelete(WORK_CUTS_KEY)]);
      const buffer = await source.file.arrayBuffer();
      if (generation !== loadGenerationRef.current) return false;
      const record: StoredWorkFile = {
        name: source.file.name,
        kind: source.kind,
        buffer,
        palette: source.palette ? packColours(source.palette) : undefined,
        savedAt: Date.now(),
      };
      const ok = await dataSet(WORK_FILE_KEY, record);
      if (generation === loadGenerationRef.current) setAutosave({ state: ok ? "saved" : "failed", at: Date.now() });
      return ok;
    } catch {
      if (generation === loadGenerationRef.current) setAutosave({ state: "failed", at: null });
      return false;
    }
  }

  /**
   * Stores the current colours, and first the cuts confirmed into the mesh
   * they belong to (when those changed): a restore makes the cuts again on the
   * file, then puts the colours on.
   */
  function persistWorkColours(colours: RGB[], generation: number, cuts: StoredCut[]): Promise<void> {
    // One save after another, and only the newest of those waiting: an older save
    // finishing last must not put back what a newer one replaced.
    const ticket = ++saveTicketRef.current;
    const run = () => saveWorkColours(colours, generation, cuts, ticket);
    saveLineRef.current = saveLineRef.current.then(run, run);
    return saveLineRef.current;
  }

  async function saveWorkColours(colours: RGB[], generation: number, cuts: StoredCut[], ticket: number): Promise<void> {
    if (ticket !== saveTicketRef.current || generation !== loadGenerationRef.current) return;
    setAutosave({ state: "saving", at: null });
    let ok = true;
    // The cuts are a log the colours point into (their `cuts` = how many apply): a cut
    // undone stays at the end, unused; only a log that does not start with these cuts is written.
    const saved = lastSavedCutsRef.current;
    const onDisk = cuts.length === 0 || (saved !== null && cuts.length <= saved.length && cuts.every((cut, i) => cut === saved[i]));
    if (!onDisk) {
      const record: StoredWorkCuts = { fileName: modelFileRef.current?.file.name ?? "", cuts, savedAt: Date.now() };
      if (!(await dataSet(WORK_CUTS_KEY, record))) {
        // The colours stay as they were on disk: they still match the cuts there.
        if (generation === loadGenerationRef.current) setAutosave({ state: "failed", at: null });
        return;
      }
      lastSavedCutsRef.current = cuts;
    }
    if (generation !== loadGenerationRef.current) return;
    if (colours === originalColoursRef.current && cuts.length === 0) await dataDelete(WORK_COLOURS_KEY);
    else {
      const record: StoredWorkColours = { faceCount: colours.length, colours: packColours(colours), savedAt: Date.now(), cuts: cuts.length };
      ok = await dataSet(WORK_COLOURS_KEY, record);
    }
    if (generation === loadGenerationRef.current) setAutosave({ state: ok ? "saved" : "failed", at: Date.now() });
  }

  // Debounced save of the current colours whenever they change (merge, patch recolour, undo, Nomad import).
  useEffect(() => {
    if (!model) return;
    if (lastSavedColoursRef.current === model.triangleColors) return;
    const colours = model.triangleColors;
    lastSavedColoursRef.current = colours;
    if (!settings.rememberWork) return;
    const generation = loadGenerationRef.current;
    const cuts = cutLogRef.current.get(model.triangles) ?? [];
    // Show "saving" as soon as a change is pending, not only when the debounce fires.
    setAutosave({ state: "saving", at: null });
    const timer = window.setTimeout(() => void persistWorkColours(colours, generation, cuts), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, settings.rememberWork]);

  // Turning autosave off only stops saving — what is stored stays, since the
  // folder is shared by every open window and "off" in one of them must not
  // throw away another's work.  Turning it on stores the current work right
  // away.  Deleting is left to "새로 시작", which says so.
  useEffect(() => {
    const was = rememberWorkRef.current;
    rememberWorkRef.current = settings.rememberWork;
    if (was === settings.rememberWork) return;
    if (!settings.rememberWork) {
      setAutosave({ state: "none", at: null });
      return;
    }
    const source = modelFileRef.current;
    if (!source || !model) return;
    const generation = loadGenerationRef.current;
    void (async () => {
      if (!(await persistWorkFile(source, generation))) return;
      lastSavedCutsRef.current = null;
      // The model as it is now (it may have changed while the file was being stored).
      const current = modelRef.current;
      if (!current) return;
      const cuts = cutLogRef.current.get(current.triangles) ?? [];
      if (current.triangleColors !== originalColoursRef.current || cuts.length > 0) await persistWorkColours(current.triangleColors, generation, cuts);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.rememberWork]);

  // Restore the saved work once on startup, first thing: the intro waits for
  // it (reading a big model holds the page for a moment and would make the
  // intro stutter).
  useEffect(() => {
    if (workRestoredRef.current) return;
    workRestoredRef.current = true;
    if (!settings.rememberWork) {
      setStartupLoading(false);
      return;
    }
    void restoreWork().finally(() => setStartupLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Puts stored work back — the model file, the confirmed cuts made again in
   * order on it, then the colours — from the autosave or from a work file.
   * Null when another model came in meanwhile.  ⌘Z has nothing to take back
   * afterwards: it used to hold the file's own colours, so one ⌘Z after a
   * reload undid all the colour work at once, and the autosave kept that.
   */
  async function putBackWork(
    stored: StoredWorkFile,
    storedColours: unknown,
    storedCuts: unknown,
    from: "autosave" | "file",
  ): Promise<{ model: MeshModel; cuts: StoredCut[]; colours: boolean } | null> {
    const generation = loadGenerationRef.current;
    const file = new File([stored.buffer], stored.name);
    const nomadPalette = stored.palette ? (unpackColours(stored.palette, Math.floor(stored.palette.length / 3)) ?? undefined) : undefined;
    const loaded = await parseModelFile(file, stored.kind, nomadPalette);
    if (loadGenerationRef.current !== generation) return null;
    // The cuts confirmed before, made again in order on the file (the colours belong to the cut mesh).
    let base = loaded.model;
    let original = loaded.model.triangleColors;
    let log: StoredCut[] = [];
    const wanted = isStoredWorkColours(storedColours) ? (storedColours.cuts ?? 0) : 0;
    if (wanted > 0 && isStoredWorkCuts(storedCuts) && storedCuts.fileName === stored.name && storedCuts.cuts.length >= wanted) {
      for (const made of storedCuts.cuts.slice(0, wanted)) {
        if (made.faces !== base.triangles.length || made.vertices !== base.vertices.length) break;
        const mesh = meshWithCut(base.vertices, base.triangles, made);
        original = Array.from(mesh.originalFace, (f) => original[f]);
        base = { ...base, vertices: mesh.vertices, triangles: mesh.triangles, triangleColors: original, stats: { ...base.stats, vertexCount: mesh.vertices.length, triangleCount: mesh.triangles.length } };
        log = [...log, made];
      }
      if (log.length !== wanted) {
        base = loaded.model;
        original = loaded.model.triangleColors;
        log = [];
      }
    }
    cutLogRef.current.set(base.triangles, log);
    const lastCut = log[log.length - 1];
    const settledBack = lastCut?.settled ? unpackRuns(lastCut.settled, base.triangles.length) : null;
    if (settledBack) settledRef.current.set(base.triangles, settledBack);
    // Which faces the cuts made, replayed from the log (meshWithCut: a replaced face's
    // number goes to its first piece, the other pieces follow at the end).
    if (log.length > 0) {
      let was: Uint8Array | null = null;
      for (const entry of log) {
        const next = new Uint8Array(entry.faces + entry.pieceGroups.length - entry.replaced.length);
        if (was && was.length === entry.faces) next.set(was);
        for (let i = 0; i < entry.replaced.length; i++) next[entry.replaced[i]] = 1;
        next.fill(1, entry.faces);
        was = next;
      }
      if (was && was.length === base.triangles.length) cutFacesRef.current.set(base.triangles, was);
    }
    const colours =
      isStoredWorkColours(storedColours) && storedColours.faceCount === base.triangles.length
        ? unpackColours(storedColours.colours, storedColours.faceCount)
        : null;
    const backModel = colours ? { ...base, triangleColors: colours, stats: { ...base.stats, uniqueFaceColors: countUniqueColours(colours) } } : base;
    installModel(
      backModel,
      { ...loaded.info, uniqueColours: backModel.stats.uniqueFaceColors },
      { file, kind: stored.kind, palette: nomadPalette },
      from === "autosave" ? { persist: false, original, restored: true } : { persist: false, original, sameWork: true },
    );
    return { model: backModel, cuts: log, colours: colours !== null };
  }

  async function restoreWork(): Promise<void> {
    const stored = await dataGet<unknown>(WORK_FILE_KEY);
    if (!isStoredWorkFile(stored) || loadGenerationRef.current !== 0) return;
    setBusy(t("busy.restoringWork"));
    await yieldToUi();
    try {
      const storedColours = await dataGet<unknown>(WORK_COLOURS_KEY);
      const storedCuts = await dataGet<unknown>(WORK_CUTS_KEY);
      const back = await putBackWork(stored, storedColours, storedCuts, "autosave");
      if (!back) return;
      const savedAt = back.colours && isStoredWorkColours(storedColours) ? storedColours.savedAt : stored.savedAt;
      setAutosave({ state: "saved", at: Number.isFinite(savedAt) ? savedAt : Date.now() });
      setStatus(t("status.workRestored", { name: stored.name, info: back.colours ? t("status.workRestoredColours") : t("status.workRestoredOriginal") }));
    } catch (err) {
      // Left in place: a failure in this window is no reason to delete what
      // another window may still be relying on.  "새로 시작" clears on purpose.
      setStatus(t("status.workRestoreFailed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Work files (.gyuroma): the work kept as a file of the person's own, out of
  // the browser's reach — opened again here, in another browser or computer.
  // ------------------------------------------------------------------
  const [workFileSave, setWorkFileSave] = useState<"idle" | "saving" | "saved">("idle");

  async function saveWorkFile(): Promise<void> {
    const source = modelFileRef.current;
    const current = modelRef.current;
    if (!source || !current || workFileSave === "saving") return;
    const name = workFileName(source.file.name, new Date());
    // Where first, while the press still counts as the person's: the browser
    // opens a save dialog only then, not after the packing that follows.
    type SavePicker = (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle>;
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    let handle: FileSystemFileHandle | null = null;
    if (picker) {
      try {
        handle = await picker({ suggestedName: name, types: [{ description: t("workFile.kind"), accept: { "application/octet-stream": [WORK_FILE_EXT] } }] });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        handle = null;
      }
    }
    setWorkFileSave("saving");
    setBusy(t("busy.packingWork"));
    await yieldToUi();
    try {
      const now = Date.now();
      const cuts = cutLogRef.current.get(current.triangles) ?? [];
      const ownColours = current.triangleColors === originalColoursRef.current && cuts.length === 0;
      const blob = await packWorkFile({
        file: { name: source.file.name, kind: source.kind, buffer: await source.file.arrayBuffer(), palette: source.palette ? packColours(source.palette) : undefined, savedAt: now },
        colours: ownColours ? null : { faceCount: current.triangleColors.length, colours: packColours(current.triangleColors), savedAt: now, cuts: cuts.length },
        cuts: cuts.length > 0 ? { fileName: source.file.name, cuts, savedAt: now } : null,
        settings,
        // The AI's part map and the consult go with the work: reopened, it goes on where it was.
        ai: { partMap: partMaps[tidyModelName] ?? null, chat: tidyLog.filter((entry) => entry.model === tidyModelName).slice(-200) },
        app: `GYUROMA ${APP_VERSION}`,
        savedAt: now,
      });
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else downloadBlob(name, blob);
      setStatus(t("status.workFileSaved", { name: handle?.name ?? name, mb: (blob.size / 1e6).toFixed(1) }));
      countAction("work/save");
      setWorkFileSave("saved");
      window.setTimeout(() => setWorkFileSave((state) => (state === "saved" ? "idle" : state)), 3000);
    } catch (err) {
      setWorkFileSave("idle");
      setStatus(t("status.workFileSaveFailed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  /** Opens a work file: it becomes the work, and the autosave keeps it from here. */
  async function openWorkFile(file: File): Promise<void> {
    setBusy(t("busy.openingWork"));
    await yieldToUi();
    try {
      const work = await readWorkFile(file);
      const back = await putBackWork(work.file, work.colours, work.cuts, "file");
      if (!back) return;
      takeWorkSettings(work.settings, work.file.name);
      takeWorkAi(work.ai, work.file.name);
      setStatus(t("status.workFileOpened", { name: file.name, at: new Date(work.savedAt).toLocaleString(lang === "ko" ? "ko-KR" : "en-GB") }));
      countAction("load/work");
      if (!rememberWorkRef.current) {
        setAutosave({ state: "none", at: null });
        return;
      }
      const generation = loadGenerationRef.current;
      const source = modelFileRef.current;
      if (!source || !(await persistWorkFile(source, generation))) return;
      lastSavedCutsRef.current = null;
      if (back.colours || back.cuts.length > 0) await persistWorkColours(back.model.triangleColors, generation, back.cuts);
    } catch (err) {
      setStatus(err instanceof WorkFileError ? t(`workFile.${err.code}`) : t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  /**
   * What a work file's settings bring: what belongs to the work — its colour
   * bands, the print choices made by hand, colour protection, the tidy and
   * palette settings, the orientation — as it was; the filaments and the
   * mixing are the workshop's own, taken only when the person says so.
   */
  function takeWorkSettings(raw: unknown, modelName: string): void {
    const saved = mergeSettings(raw);
    const workshop = JSON.stringify([saved.filaments.count, saved.filaments.hex.slice(0, saved.filaments.count), saved.mix]) !== JSON.stringify([settings.filaments.count, settings.filaments.hex.slice(0, settings.filaments.count), settings.mix]);
    const takeWorkshop = workshop && window.confirm(t("workFile.takeWorkshop"));
    setSettings((prev) => {
      const stripByModel = { ...prev.stripByModel };
      if (saved.stripByModel[modelName]) stripByModel[modelName] = saved.stripByModel[modelName];
      else delete stripByModel[modelName];
      return {
        ...prev,
        stripByModel,
        manualPhysical: saved.manualPhysical,
        recipeOverrides: saved.recipeOverrides,
        mergeFlags: { ...prev.mergeFlags, ...saved.mergeFlags },
        merge: saved.merge,
        palette: saved.palette,
        export: { ...prev.export, coordinateMode: saved.export.coordinateMode },
        ...(takeWorkshop ? { filaments: saved.filaments, mix: saved.mix } : {}),
      };
    });
  }

  /** A work file's part map and consult, back (a preview then is on the colours already: it counts as applied). */
  function takeWorkAi(ai: WorkFileContents["ai"], modelName: string): void {
    if (!ai) return;
    const map = ai.partMap as StoredPartMap | null;
    if (map && typeof map === "object" && Array.isArray(map.parts) && typeof map.faces === "number") setPartMaps((prev) => ({ ...prev, [modelName]: map }));
    const chat = (ai.chat as TidyLogEntry[]).filter((entry) => entry && typeof entry.id === "string" && typeof entry.text === "string");
    if (chat.length === 0) return;
    setTidyLog((prev) => {
      const have = new Set(prev.map((entry) => entry.id));
      const back = chat.filter((entry) => !have.has(entry.id)).map((entry) => ({ ...entry, model: modelName, status: entry.status === "preview" ? ("applied" as const) : entry.status }));
      return [...prev, ...back].slice(-200);
    });
  }

  /** The file's own colours back, as one step ⌘Z takes back. */
  function revertToOriginal(): void {
    const current = modelRef.current;
    const original = originalColoursRef.current;
    if (!current || !original || original.length !== current.triangles.length || current.triangleColors === original) return;
    if (!window.confirm(t("load.revertConfirm"))) return;
    keepGroupsFor(current.triangleColors, original);
    applyColours(current, original);
    setStatus(t("status.revertedToOriginal"));
  }

  function clearWork(): void {
    if (model && !window.confirm(t("load.newWorkConfirm"))) return;
    loadGenerationRef.current += 1;
    modelFileRef.current = null;
    adjacencyRef.current = null;
    atlasRef.current = null;
    faceGeometryRef.current = null;
    strokeRef.current = null;
    stripAheadRef.current = null;
    dragBuffers.current = [];
    tidyStableShotsRef.current = null;
    setAtlas(null);
    originalColoursRef.current = null;
    lastSavedColoursRef.current = null;
    setModel(null);
    setSourceInfo(null);
    setHistory([]);
    undoOrderRef.current = [];
    meshUndoRef.current = [];
    meshRedoRef.current = [];
    redoOrderRef.current = [];
    lastSavedCutsRef.current = null;
    setCutNotice(null);
    setRecipeSteps([]);
    forgetTidyUndo();
    setTidyResult(null);
    setFuture([]);
    setWorkRestored(false);
    setMergeReport(null);
    setNomadReport(null);
    clearPick();
    setSelectedHexes([]);
    setHoverHex(null);
    setAutosave({ state: "none", at: null });
    void clearStoredWorkEverywhere();
    setStatus(t("status.workCleared"));
  }

  async function onTemplateFile(file: File): Promise<void> {
    setBusy(t("busy.readingTemplate"));
    try {
      const [info, buffer] = await Promise.all([readTemplate3mf(file), file.arrayBuffer()]);
      setTemplate({ info, buffer });
      if (info.bedSize && templateFitsPrinter(printer, info.printerModel))
        patchSettings("export", { ...settings.export, bedX: Math.round(info.bedSize.x), bedY: Math.round(info.bedSize.y) });
      // The template's extruder filaments become the physical slots so both sides agree from the start.
      const applied = applyTemplateFilaments(info);
      setStatus(
        t("status.templateLoaded", { name: file.name, bed: info.bedSize ? t("status.templateBed", { x: info.bedSize.x, y: info.bedSize.y }) : "" }) +
          (applied > 0 ? ` · ${t("status.templateFilamentsApplied", { n: applied })}` : ""),
      );
    } catch (err) {
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Feature B: merge
  // ------------------------------------------------------------------
  function adjacencyFor(current: MeshModel): FaceAdjacency {
    const cached = adjacencyRef.current;
    if (cached && cached.triangles === current.triangles) return cached.adjacency;
    const adjacency = buildFaceAdjacency(current.triangles, current.vertices.length);
    adjacencyRef.current = { triangles: current.triangles, adjacency };
    return adjacency;
  }

  function applyColours(current: MeshModel, next: RGB[], options?: { keepSelection?: boolean; uniqueFaceColors?: number }): void {
    // What an edit painted shares the colour arrays too (only the faces whose array is new are looked up).
    shareNewColours(next, current.triangleColors);
    if (history.length >= 20) forgetOldestUndo("colours");
    setHistory((prev) => [...prev.slice(-19), current.triangleColors]);
    pushUndo("colours");
    setFuture([]);
    meshRedoRef.current = [];
    redoOrderRef.current = [];
    setModel({ ...current, triangleColors: next, stats: { ...current.stats, uniqueFaceColors: options?.uniqueFaceColors ?? countUniqueColours(next) } });
    // The palette may be numbered anew: the recipe panel's undo steps no longer line
    // up.  The hand-set choices themselves follow their colours (choicesPaletteRef).
    forgetRecipeUndo();
    if (!options?.keepSelection) clearPick();
  }

  // ------------------------------------------------------------------
  // Colour map (face atlas) and brush
  // ------------------------------------------------------------------
  function faceGeometryFor(current: MeshModel): FaceGeometry {
    const cached = faceGeometryRef.current;
    if (cached && cached.triangles === current.triangles) return cached.geometry;
    const geometry = faceGeometry(current);
    faceGeometryRef.current = { triangles: current.triangles, geometry };
    return geometry;
  }

  // Default brush size follows the model size (a mesh of the same size — a cut confirmed or undone — keeps the brush as it is).
  const brushForRadius = useRef<number | null>(null);
  useEffect(() => {
    if (!model) return;
    const radius = faceGeometryFor(model).radius;
    if (brushForRadius.current !== null && Math.abs(brushForRadius.current - radius) <= 1e-6 * radius) return;
    brushForRadius.current = radius;
    setBrushRadius(Number((radius * 0.04).toPrecision(2)));
    setHealSize(Number((radius * 0.02).toPrecision(2)));
    setSpeckFaces(Math.max(150, Math.round(model.triangles.length / 4000 / 50) * 50));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryTriangles]);

  // Full repaint of the map whenever the committed colours change — except for a brush
  // stroke whose faces the map painted as it went, in the colour they keep.
  useEffect(() => {
    const patch = strokePatchRef.current;
    if (model && patch && patch.to === model.triangleColors && patch.exact) return;
    setColoursVersion((v) => v + 1);
  }, [model?.triangleColors]);

  // Build the atlas lazily when the map is shown.
  useEffect(() => {
    if (!showMap || !model) return;
    const cached = atlasRef.current;
    if (cached && cached.triangles === model.triangles) {
      if (atlas !== cached.atlas) setAtlas(cached.atlas);
      return;
    }
    let cancelled = false;
    setAtlasBuilding(true);
    setBusy(t("busy.atlas"));
    const timer = window.setTimeout(() => {
      try {
        const size = model.triangles.length > 300_000 ? 3072 : 2048;
        const built = buildFaceAtlas(model, adjacencyFor(model), faceGeometryFor(model), areaWeights, size);
        atlasRef.current = { triangles: model.triangles, atlas: built };
        if (!cancelled) {
          setAtlas(built);
          setStatus(t("status.atlasBuilt", { size, charts: built.chartCount.toLocaleString(), fill: Math.round(built.filledRatio * 100), extent: `${Math.round(built.extent[0])}×${Math.round(built.extent[1])}` }));
        }
      } catch (err) {
        if (!cancelled) setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
      } finally {
        if (!cancelled) {
          setAtlasBuilding(false);
          setBusy(null);
        }
      }
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, geometryTriangles]);

  // A file dropped where nothing takes it is not opened by the browser (it would leave the app, and the work on
  // screen with it — 11-05: a picture let go beside the consult's field opened in a new tab).
  useEffect(() => {
    const keep = (event: DragEvent) => {
      if (event.dataTransfer && [...event.dataTransfer.types].includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", keep);
    window.addEventListener("drop", keep);
    return () => {
      window.removeEventListener("dragover", keep);
      window.removeEventListener("drop", keep);
    };
  }, []);

  // 🧩 The picked patches unfolded (unfold.ts, in a worker): a new pick lays them out again.  Keyed by what is
  // picked, not by the list's identity — a list made again for the same patches must not start the solve over
  // (11-05 Tkc: it never came to an end).
  const pickKey = model ? `${model.triangles.length}|${pickedPatches.map((patch) => `${patch.id}:${patch.faces.length}`).join(",")}` : "";
  const pickedForUnfoldRef = useRef(pickedPatches);
  pickedForUnfoldRef.current = pickedPatches;
  useEffect(() => {
    const picked = pickedForUnfoldRef.current;
    const total = picked.reduce((n, patch) => n + patch.faces.length, 0);
    if (!showMap || !unfoldOn || !model || total === 0 || total > UNFOLD_MAX_FACES) {
      cancelUnfold();
      unfoldRunningKeyRef.current = null;
      setUnfolding(null);
      setUnfolded(null);
      setUnfoldNote(showMap && unfoldOn && total > UNFOLD_MAX_FACES ? t("map.unfoldTooBig", { n: total.toLocaleString(), max: UNFOLD_MAX_FACES.toLocaleString() }) : null);
      return;
    }
    const key = pickKey;
    if (unfoldedRef.current?.key === key || unfoldRunningKeyRef.current === key) return;
    setUnfoldNote(null);
    const timer = window.setTimeout(() => {
      // The patches' faces, and their corners numbered afresh (positions of those vertices only).
      const mark = new Uint8Array(model.triangles.length);
      for (const patch of picked) for (const f of patch.faces) mark[f] = 1;
      const faces = new Int32Array(total);
      let count = 0;
      for (let f = 0; f < mark.length; f++) if (mark[f]) faces[count++] = f;
      const used = faces.subarray(0, count);
      const localOf = new Int32Array(model.vertices.length).fill(-1);
      const triangles = new Int32Array(count * 3);
      const order: number[] = [];
      for (let i = 0; i < count; i++) {
        const tri = model.triangles[used[i]];
        for (let k = 0; k < 3; k++) {
          let local = localOf[tri[k]];
          if (local < 0) {
            local = localOf[tri[k]] = order.length;
            order.push(tri[k]);
          }
          triangles[i * 3 + k] = local;
        }
      }
      const positions = new Float64Array(order.length * 3);
      order.forEach((g, i) => positions.set(model.vertices[g], i * 3));
      const facesKept = used.slice();
      unfoldRunningKeyRef.current = key;
      setUnfolding(0);
      const started = performance.now();
      unfoldInWorker(positions, triangles, (share) => {
        if (unfoldRunningKeyRef.current === key) setUnfolding(share);
      })
        .then((out) => {
          if (unfoldRunningKeyRef.current !== key) return;
          unfoldRunningKeyRef.current = null;
          const size = facesKept.length > 300_000 ? 3072 : 2048;
          try {
            setUnfolded({ key, atlas: buildPatchAtlas(model, faceGeometryFor(model), facesKept, out, size), pieces: out.pieces });
            setStatus(t("status.unfolded", { faces: facesKept.length.toLocaleString(), pieces: out.pieces, s: ((performance.now() - started) / 1000).toFixed(1) }));
          } catch (err) {
            setUnfoldNote(t("map.unfoldFailed", { message: err instanceof Error ? err.message : String(err) }));
          }
          setUnfolding(null);
        })
        .catch((err) => {
          if (err instanceof UnfoldSuperseded || unfoldRunningKeyRef.current !== key) return;
          unfoldRunningKeyRef.current = null;
          setUnfolding(null);
          setUnfoldNote(t("map.unfoldFailed", { message: err instanceof Error ? err.message : String(err) }));
        });
    }, 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, unfoldOn, pickKey]);

  /** What the result view shows a face as, for the colour map (its group's colour, or the print's). */
  const mapLookRef = useRef<{ palette: PaletteEntry[]; labels: Int32Array; mode: PreviewMode; effective: Map<number, RGB> } | null>(null);
  const colourOfFace = useCallback((face: number): RGB => {
    const stroke = strokeRef.current;
    if (stroke) return stroke.working[face];
    const look = mapLookRef.current;
    const entry = look && look.mode !== "source" && look.labels.length > face ? look.palette[look.labels[face]] : undefined;
    if (entry) return (look?.mode === "print" && look.effective.get(entry.index)) || entry.rgb;
    // The source look: the file's own colours, as the source view shows them.
    const own = originalColoursRef.current;
    if (look?.mode === "source" && own && own.length > face) return own[face];
    return modelRef.current?.triangleColors[face] ?? [128, 128, 128];
  }, []);

  /** The views that show the colours as edited — not the source view (the file's own colours), nor the result view in its source look. */
  function editedViewers(): MeshViewerHandle[] {
    const result = viewerRef2.current;
    return result && resultMode !== "source" ? [result] : [];
  }

  function viewerHandles(): MeshViewerHandle[] {
    return viewerRefs.map((r) => r.current).filter((h): h is MeshViewerHandle => h !== null);
  }

  /** Starts a stroke; returns false when the brush is limited to a selection and there is none. */
  function beginStroke(): boolean {
    const current = modelRef.current;
    if (!current) return false;
    if (strokeRef.current) return true;
    if (brushMaskOnly && !pickedMask && !healMode) {
      setStatus(t("status.brushNeedsSelection"));
      return false;
    }
    strokeRef.current = {
      working: current.triangleColors.slice(),
      mask: brushMaskOnly && !healMode ? pickedMask : null,
      count: 0,
      rgb: fillRgb(current, brushHex),
      hex: brushHex,
      changed: [],
      healed: healMode ? new Uint8Array(current.triangleColors.length) : null,
      relabel: healMode ? new Map() : null,
      healColours: healMode ? new Set() : null,
    };
    return true;
  }

  function paintFaces(faces: ArrayLike<number>): void {
    const stroke = strokeRef.current;
    if (!stroke) return;
    const { rgb, mask, working } = stroke;
    const changed: number[] = [];
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      if (mask && !mask[f]) continue;
      const c = working[f];
      if (c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]) continue;
      working[f] = rgb;
      changed.push(f);
    }
    if (changed.length === 0) return;
    stroke.count += changed.length;
    for (let i = 0; i < changed.length; i++) stroke.changed.push(changed[i]);
    for (const handle of editedViewers()) handle.setFaceColours(changed, rgb);
    mapRef.current?.repaintFaces(changed);
  }

  function endStroke(): void {
    const stroke = strokeRef.current;
    const current = modelRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    if (!current) return;
    if (stroke.count === 0) {
      setStatus(t("status.brushNothing"));
      return;
    }
    // The healing brush puts palette colours only: no new group.
    const grouping = stroke.healColours ? undefined : groupingForNew(stroke.rgb);
    keepGroupsFor(current.triangleColors, stroke.working, grouping?.also, grouping?.pinned);
    // Only the painted faces changed: buffers, labels and map are patched for them (strokePatchRef) —
    // one colour only; a healing stroke that put several is worked out whole.
    strokePatchRef.current =
      !stroke.healColours || stroke.healColours.size === 1
        ? { from: current.triangleColors, to: stroke.working, faces: Int32Array.from(stroke.changed), rgb: stroke.rgb, exact: false }
        : null;
    applyColours(current, stroke.working, { keepSelection: true, uniqueFaceColors: stripFor(stroke.working).colourCount });
    setStatus(stroke.healColours ? t("status.healed", { n: stroke.count.toLocaleString() }) : t("status.brushed", { n: stroke.count.toLocaleString(), hex: stroke.hex }));
  }

  function showBrushCursorAt(hit: ViewerHit | null): void {
    brushHitRef.current = hit;
    const blocked = !healMode && brushMaskOnly && (!pickedMask || hit === null || !pickedMask[hit.faceIndex]);
    for (const handle of viewerHandles())
      handle.setBrushCursor(hit ? { point: hit.point, normal: hit.normal, radius: brushRadius, blocked, inner: healMode ? healSize : undefined } : null);
  }

  function brushHover3D(hit: ViewerHit | null): void {
    showBrushCursorAt(hit);
    const current = mapAtlasNow();
    mapRef.current?.setRemoteCursor(hit && current && current.chartOf[hit.faceIndex] >= 0 ? faceAtlasPoint(current, hit.faceIndex, hit.bary ?? EVEN_THIRDS) : null);
  }

  /**
   * The spot under the pointer on the 3D model, marked on the colour map so it can be
   * found there to paint.  The mark stays where the pointer last touched the model (the
   * pointer goes to the map next), and the map follows it when it is out of view.
   */
  function hoverHit3D(hit: ViewerHit | null): void {
    if (!hit) return;
    const current = mapAtlasNow();
    if (!current) return;
    // Off the map (the map shows the picked patches unfolded, this face is not among them).
    if (current.chartOf[hit.faceIndex] < 0) {
      mapRef.current?.setPointer(null);
      return;
    }
    // The pointer is on the model now: the model's own mark (the map's last spot) goes.
    for (const handle of viewerHandles()) handle.setPointerMark(null);
    mapRef.current?.setPointer(faceAtlasPoint(current, hit.faceIndex, hit.bary ?? EVEN_THIRDS), true);
  }

  /** The map's brush: the surface under the circle, as the 3D brush paints it (faces the map shows thin or not at all included). */
  function paintAtMap(x: number, y: number): void {
    const current = modelRef.current;
    const built = mapAtlasNow();
    if (!current || !built || !strokeRef.current) return;
    const geometry = faceGeometryFor(current);
    const reach = facesUnderMapBrush(built, current, geometry, x, y, brushRadius);
    if (healMode) paintHealed(healFaces(current, reach, facesUnderMapBrush(built, current, geometry, x, y, Math.min(healSize, brushRadius))));
    else paintFaces(reach);
  }

  /**
   * The healing brush's dab (the owner's rule, 11-03): the other colours under the
   * inner circle — the tip — turn into the brush colour where, inside the outer
   * circle, that colour encloses them.  A patch is judged inside the outer circle
   * only (a neck to a body of its own colour outside is a short open stretch; a
   * body's own edge a long one, left alone), and only what lies under the tip is
   * painted — so the brush never crosses the colour's own outline, and a blotch
   * joined to something is a blotch all the same.  What earlier dabs took counts
   * as the colour already.
   */
  function healFaces(current: MeshModel, reach: Int32Array, tip: Int32Array): { faces: Int32Array; targets: number[] } {
    const stroke = strokeRef.current;
    const targets: number[] = [];
    if (!stroke || labels.length !== current.triangles.length) return { faces: new Int32Array(0), targets };
    // No colour to choose (11-03: the "change to" colour was orange, the specks lay in yellow, and nothing went):
    // each speck takes the colour around it.
    // A hand tool, as the plain brush: 🔒 keeps a colour from the automatic tidy-ups, not from where you rub
    // (11-03: the dots on the ball were bits of the protected orange, and nothing would take them).
    const faces = specksIn(labels, adjacencyFor(current), { into: -1, within: reach, tip, maxFaces: 0, enclosed: 0.8, protectedLabels: null, taken: stroke.healed, relabel: stroke.relabel, targets });
    return { faces, targets };
  }

  /** The healing brush's dab painted: each face in the palette colour around its speck. */
  function paintHealed({ faces, targets }: { faces: Int32Array; targets: number[] }): void {
    const stroke = strokeRef.current;
    if (!stroke || faces.length === 0) return;
    const changed: number[] = [];
    const each: number[] = [];
    for (let i = 0; i < faces.length; i++) {
      const rgb = palette[targets[i]]?.rgb;
      if (!rgb) continue;
      const f = faces[i];
      const c = stroke.working[f];
      if (c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]) continue;
      stroke.working[f] = rgb;
      changed.push(f);
      each.push(rgb[0], rgb[1], rgb[2]);
      stroke.healColours?.add(targets[i]);
      stroke.rgb = rgb;
    }
    if (changed.length === 0) return;
    stroke.count += changed.length;
    for (let i = 0; i < changed.length; i++) stroke.changed.push(changed[i]);
    const list = Uint8Array.from(each);
    for (const handle of editedViewers()) handle.setFaceColourList(changed, list);
    mapRef.current?.repaintFaces(changed);
  }

  /**
   * The specks in a colour, all at once (02's "얼룩 없애기"): the small patches of other colours
   * lying in it — enclosed by it, up to the small-island size — turn into it.  Shown at once,
   * as a stroke is, and committed by the stroke's quick path: only those faces changed.
   */
  function removeSpecksInto(hex: string): void {
    const current = modelRef.current;
    const into = positionByHex.get(hex);
    if (!current || into === undefined || labels.length !== current.triangles.length) return;
    const maxFaces = speckFaces;
    const adjacency = adjacencyFor(current);
    const faces = specksIn(labels, adjacency, { into, within: null, maxFaces, enclosed: 0.8, protectedLabels: protectedPositions(), taken: null });
    // What 🔒 kept: said so, or the specks seem not to go (11-03).
    const kept = Math.max(0, specksIn(labels, adjacency, { into, within: null, maxFaces, enclosed: 0.8, protectedLabels: null, taken: null }).length - faces.length);
    const keptNote = kept > 0 ? t("status.specksKept", { n: kept.toLocaleString() }) : "";
    if (faces.length === 0) {
      setStatus(t("status.specksNone", { hex, n: maxFaces }) + keptNote);
      return;
    }
    const rgb = hexToRgb(hex);
    const next = current.triangleColors.slice();
    for (let i = 0; i < faces.length; i++) next[faces[i]] = rgb;
    for (const handle of editedViewers()) handle.setFaceColours(faces, rgb);
    mapRef.current?.repaintFaces(faces);
    keepGroupsFor(current.triangleColors, next);
    strokePatchRef.current = { from: current.triangleColors, to: next, faces, rgb, exact: false };
    applyColours(current, next, { keepSelection: true, uniqueFaceColors: stripFor(next).colourCount });
    setStatus(t("status.specksDone", { n: faces.length.toLocaleString(), hex }) + keptNote);
  }

  function paintAtHit(hit: ViewerHit | null, slot: number): void {
    const current = modelRef.current;
    if (!hit || !current || !strokeRef.current) return;
    const viewDir = viewerRefs[slot]?.current?.viewDirection() ?? null;
    const geometry = faceGeometryFor(current);
    const centre = pointToModel(hit.point);
    const along = viewDir ? pointToModel(viewDir) : null;
    const reach = facesInSphere(geometry, centre, brushRadius, along);
    if (healMode) paintHealed(healFaces(current, reach, facesInSphere(geometry, centre, Math.min(healSize, brushRadius), along)));
    else paintFaces(reach);
  }

  function brushStart3D(hit: ViewerHit | null, slot: number): void {
    if (!beginStroke()) return;
    paintAtHit(hit, slot);
  }

  function brushDrag3D(hit: ViewerHit | null, slot: number): void {
    brushHover3D(hit);
    paintAtHit(hit, slot);
  }

  function mapHover(face: number | null, at?: [number, number]): void {
    if (!brushMode) {
      hoverFace(face);
      // The spot under the map's pointer, marked on the model (it stays where the pointer last touched the
      // map); the map's own mark goes, the pointer is here now.
      const current = modelRef.current;
      const built = mapAtlasNow();
      if (face !== null && face >= 0 && at && current && built) {
        const geometry = faceGeometryFor(current);
        const mark = {
          point: pointToView(atlasPointOnFace(built, current, face, at[0], at[1])),
          normal: pointToView([geometry.normals[face * 3], geometry.normals[face * 3 + 1], geometry.normals[face * 3 + 2]]),
        };
        for (const handle of viewerHandles()) handle.setPointerMark(mark);
        mapRef.current?.setPointer(null);
      }
      return;
    }
    const current = modelRef.current;
    if (face === null || face < 0 || !current) {
      showBrushCursorAt(null);
      return;
    }
    const geometry = faceGeometryFor(current);
    showBrushCursorAt({
      faceIndex: face,
      point: pointToView([geometry.centroids[face * 3], geometry.centroids[face * 3 + 1], geometry.centroids[face * 3 + 2]]),
      normal: pointToView([geometry.normals[face * 3], geometry.normals[face * 3 + 1], geometry.normals[face * 3 + 2]]),
    });
  }

  // Brush size bounds follow the model size; the slider is logarithmic.
  const brushBounds = useMemo(() => {
    // The size alone (11-05: the whole face geometry, 110 MB on a 4.6 M-face model, was built here just for it).
    const radius = model ? modelRadius(model) : 1;
    return { min: radius * 0.003, max: radius * 0.6 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryTriangles]);
  const brushSliderValue = Math.round(1000 * Math.max(0, Math.min(1, Math.log(brushRadius / brushBounds.min) / Math.log(brushBounds.max / brushBounds.min))));
  const setBrushRadiusClamped = (next: number) => setBrushRadius(Number(Math.max(brushBounds.min, Math.min(brushBounds.max, next)).toPrecision(3)));
  // The healing spot runs from the smallest brush up to the brush itself: never past the outer circle.
  const healTop = Math.max(brushRadius, brushBounds.min * 1.001);
  const healSliderValue = Math.round(1000 * Math.max(0, Math.min(1, Math.log(healSize / brushBounds.min) / Math.log(healTop / brushBounds.min))));
  const setHealSizeClamped = (next: number) => setHealSize(Number(Math.max(brushBounds.min, Math.min(healTop, next)).toPrecision(3)));
  useEffect(() => {
    if (healSize > brushRadius) setHealSize(brushRadius);
  }, [brushRadius, healSize]);

  // [ and ] shrink / grow the brush while brush mode is on.
  useEffect(() => {
    if (!brushMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "{" || event.key === "}") {
        if (!healOnRef.current) return;
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        event.preventDefault();
        setHealSizeClamped(healSize * (event.key === "{" ? 0.8 : 1.25));
        return;
      }
      if (event.key !== "[" && event.key !== "]") return;
      const target = event.target as HTMLElement | null;
      if (typingIn(target)) return;
      event.preventDefault();
      setBrushRadiusClamped(brushRadius * (event.key === "[" ? 0.8 : 1.25));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushMode, brushRadius, brushBounds, healSize]);

  // The circles on the model follow the sizes as they change (the slider, [ ] { }), not only on the next move.
  useEffect(() => {
    if (brushMode && brushHitRef.current) showBrushCursorAt(brushHitRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushMode, brushRadius, healSize, healMode]);

  // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes the last colour change.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;
      const target = event.target as HTMLElement | null;
      if (typingIn(target)) return;
      event.preventDefault();
      // Not while something is being worked on (or the tidy AI answering): it would come back to a different model.
      if (busy !== null || tidyBusy !== null) return;
      if (isUndo) undoAny();
      else redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, future, model, stripUndo, committedCuts, busy, tidyBusy]);

  /** Undo has two kinds of change (strip cuts, face colours); this is their order, newest last. */
  function pushUndo(kind: UndoKind): void {
    undoOrderRef.current = [...undoOrderRef.current.slice(-39), kind];
  }
  function dropUndo(kind: UndoKind): void {
    const order = undoOrderRef.current;
    const at = order.lastIndexOf(kind);
    if (at >= 0) undoOrderRef.current = [...order.slice(0, at), ...order.slice(at + 1)];
  }
  /** Undo whichever change was made last. */
  function undoAny(): void {
    // The newest step whose list still has it and still fits the mesh; a step whose
    // list was trimmed (or a colour step of another mesh) is dropped from the order —
    // never swapped for a step of another kind out of turn.
    for (;;) {
      const order = undoOrderRef.current;
      const last = order[order.length - 1];
      if (last === undefined) return;
      if (last === "strip" && stripUndo.length > 0) return undoStripCut();
      const step = meshUndoRef.current[meshUndoRef.current.length - 1];
      if (last === "mesh" && step && model && step.after.triangles === model.triangles) return undoMesh();
      const colours = history[history.length - 1];
      // A tidy (a preset, the AI's changes) is one step: its settings and the bake it made come back together.
      if (last === "colours" && model && tidyUndoRef.current.length > 0 && tidyChainRef.current && tidyChainRef.current.result === model.triangleColors) return undoTidy();
      if (last === "colours" && colours && model && colours.length === model.triangles.length) return undoMerge();
      undoOrderRef.current = order.slice(0, -1);
    }
  }
  /** Takes the oldest step of a kind out of the undo order (its list dropped it). */
  function forgetOldestUndo(kind: UndoKind): void {
    const order = undoOrderRef.current;
    const at = order.indexOf(kind);
    if (at >= 0) undoOrderRef.current = [...order.slice(0, at), ...order.slice(at + 1)];
  }

  /** A colour's recipe choice in words: a forced filament, a set mixture, or the automatic one. */
  function recipeChoiceText(indices: number[], overrides = settings.recipeOverrides, manual = settings.manualPhysical): string {
    for (const index of indices) {
      const forced = manual[String(index)];
      if (forced !== undefined) return t("recipe.choiceSingle", { e: forced });
    }
    for (const index of indices) {
      const counts = overrides[String(index)]?.counts;
      if (counts) return normaliseRecipeCounts(counts as Record<number, number>).map((c) => `E${c.extruder} ${c.count}`).join(" · ");
    }
    return t("recipe.choiceAuto");
  }

  /** Called once before a change in a recipe panel: keeps the touched colours' choices from before it. */
  function rememberRecipe(source: RecipeStep["source"], row: number, indices: number[]): void {
    const overrides: RecipeStep["overrides"] = {};
    const manual: RecipeStep["manual"] = {};
    for (const index of indices) {
      const key = String(index);
      if (settings.recipeOverrides[key] !== undefined) overrides[key] = settings.recipeOverrides[key];
      if (settings.manualPhysical[key] !== undefined) manual[key] = settings.manualPhysical[key];
    }
    setRecipeSteps((prev) => [...prev.slice(-59), { source, row, indices, overrides, manual, before: recipeChoiceText(indices) }]);
  }

  /** The panel's undo: those colours' choices back as they were before the step. */
  function undoRecipeStep(step: RecipeStep): void {
    setRecipeSteps((prev) => prev.filter((kept) => kept !== step));
    setSettings((prev) => {
      const overrides = { ...prev.recipeOverrides };
      const manual = { ...prev.manualPhysical };
      for (const index of step.indices) {
        const key = String(index);
        if (step.overrides[key] !== undefined) overrides[key] = step.overrides[key];
        else delete overrides[key];
        if (step.manual[key] !== undefined) manual[key] = step.manual[key];
        else delete manual[key];
      }
      return { ...prev, recipeOverrides: overrides, manualPhysical: manual };
    });
    setStatus(t("status.recipeUndone"));
  }

  /** What a panel's undo shows: its newest step (for the recipe panel, on that colour) and how many it has. */
  function recipeUndoFor(source: RecipeStep["source"], row?: number): { before: string; now: string; count: number; onUndo: () => void } | null {
    const steps = recipeSteps.filter((step) => step.source === source && (row === undefined || step.row === row));
    const last = steps[steps.length - 1];
    if (!last) return null;
    return { before: last.before, now: recipeChoiceText(last.indices), count: steps.length, onUndo: () => undoRecipeStep(last) };
  }

  function forgetRecipeUndo(): void {
    setRecipeSteps([]);
  }

  /**
   * What a strip edit did, for the toast: which groups became one (and
   * whether they printed the same), or which group was cut in two.  A plain
   * move of a cut says nothing — the numbers on the bands already moved.
   */
  function describeStripChange(before: StripGroup[], after: StripGroup[]): StripToast | null {
    const b = before.filter((group) => group.colours.length > 0);
    const a = after.filter((group) => group.colours.length > 0);
    if (a.length === b.length) return null;
    const beforeOf = new Map<number, number>();
    b.forEach((group, i) => group.colours.forEach((colour) => beforeOf.set(colour.key, i)));
    const outputLabel = (hex: string) => stripOutputOf(hex)?.label;
    if (a.length < b.length) {
      for (const group of a) {
        const members = [...new Set(group.colours.map((colour) => beforeOf.get(colour.key)).filter((i): i is number => i !== undefined))];
        if (members.length < 2) continue;
        const resultHex = rgbToHex(group.rep);
        const keeper = members.find((i) => rgbToHex(b[i].rep) === resultHex) ?? members[0];
        const absorbed = members.filter((i) => i !== keeper).map((i) => b[i]);
        const labels = [...new Set(members.map((i) => outputLabel(rgbToHex(b[i].rep))).filter((l): l is string => Boolean(l)))];
        return {
          kind: "merge",
          from: absorbed.map((g) => rgbToHex(g.rep)),
          to: resultHex,
          counts: [b.length, a.length],
          area: [b[keeper].weight, group.weight],
          sameOutput: labels.length === 1 ? labels[0] : null,
          outputs: labels,
          at: Date.now(),
        };
      }
      return null;
    }
    const afterOf = new Map<number, number>();
    a.forEach((group, i) => group.colours.forEach((colour) => afterOf.set(colour.key, i)));
    for (const group of b) {
      const parts = [...new Set(group.colours.map((colour) => afterOf.get(colour.key)).filter((i): i is number => i !== undefined))];
      if (parts.length < 2) continue;
      return {
        kind: "split",
        from: [rgbToHex(group.rep)],
        to: parts.map((i) => rgbToHex(a[i].rep)).join(" · "),
        counts: [b.length, a.length],
        area: [group.weight, a[parts[0]].weight],
        sameOutput: null,
        outputs: [],
        at: Date.now(),
      };
    }
    return null;
  }

  // V B G I C M F pick the tool dock's tools (by physical key, so a Korean input
  // mode works too); ignored while typing or with a modifier held.  M and F
  // work in every step, the painting tools only where the dock is.  Enter
  // fills the picked patches (with the gap clean on: cleans the gap), unless
  // another button or a matrix row has the focus (they keep their own Enter).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        const fill = gapModeRef.current ? gapRunRef.current : fillPickRef.current;
        const inPickBar = Boolean(target?.closest(".pick-panel"));
        const ownEnter = Boolean(target?.closest("a, [role='row'], [role='option']")) || (Boolean(target?.closest("button")) && !inPickBar);
        if (!fill || ownEnter || (inPickBar && target?.closest("button") && !target.closest(".colour-select-trigger"))) return;
        event.preventDefault();
        fill();
        return;
      }
      if (event.code === "KeyF") {
        event.preventDefault();
        setFitNonce((n) => n + 1);
        return;
      }
      if (event.code === "KeyM") {
        event.preventDefault();
        setShowMap(!showMap);
        return;
      }
      if (step > 2 || !modelRef.current) return;
      if (event.code === "KeyV") {
        setBrushMode(false);
        setFillMode(false);
        setEyedropper(false);
        setGapMode(false);
      } else if (event.code === "KeyB") {
        setBrushMode((v) => !v || healOnRef.current);
        setHealMode(false);
      } else if (event.code === "KeyH") {
        const on = !healOnRef.current;
        setBrushMode(on);
        setHealMode(on);
        if (on) healPickRef.current();
      } else if (event.code === "KeyG") setFillMode((v) => !v);
      else if (event.code === "KeyI") setEyedropper((v) => !v);
      else if (event.code === "KeyC") setGapMode((v) => !v);
      else if (event.code === "KeyS") {
        // S: the brush's "only inside the selected patches", while the plain brush is on.
        if (!maskKeyRef.current.on) return;
        const next = !maskKeyRef.current.checked;
        setBrushMaskOnly(next);
        setStatus(t(next ? "brush.maskOnlyOn" : "brush.maskOnlyOff"));
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, showMap]);

  function keepStripCuts(next: StripCuts): void {
    if (!stripData) return;
    const tidy = normaliseCuts(stripData, next);
    setPreviewCuts(null);
    // A press without a move is not an edit: nothing to keep, nothing to undo.
    if (JSON.stringify(tidy) === JSON.stringify(normaliseCuts(stripData, committedCuts))) return;
    setStripUndo((prev) => [...prev.slice(-19), committedCuts]);
    pushUndo("strip");
    setToast(describeStripChange(committedGroups, groupsFromCuts(stripData, tidy)));
    setPreviewCuts(null);
    setSettings((prev) => ({
      ...prev,
      stripByModel: { ...prev.stripByModel, [stripKey]: stripStore(targetGroups, tidy, prev.stripByModel[stripKey]?.pins, prev.stripByModel[stripKey]?.from) },
    }));
  }
  function undoStripCut(): void {
    const previous = stripUndo[stripUndo.length - 1];
    if (!previous) return;
    setStripUndo((prev) => prev.slice(0, -1));
    dropUndo("strip");
    setToast(null);
    setPreviewCuts(null);
    setSettings((prev) => ({
      ...prev,
      stripByModel: { ...prev.stripByModel, [stripKey]: stripStore(targetGroups, previous, prev.stripByModel[stripKey]?.pins, prev.stripByModel[stripKey]?.from) },
    }));
  }
  function relayoutStrip(): void {
    setStripUndo((prev) => [...prev.slice(-19), committedCuts]);
    pushUndo("strip");
    setPreviewCuts(null);
    setSettings((prev) => {
      const next = { ...prev.stripByModel };
      forgetCuts(next, stripKey);
      return { ...prev, stripByModel: next };
    });
  }

  /** Bakes the palette (and merges) into the faces; returns the new colours, or null when nothing ran. */
  async function runMerge(
    flagsOverride?: Record<string, MergeFlag>,
    options?: {
      cleanupOnly?: boolean;
      /** Settings for this run only (the picked-patch tidy). */
      merge?: MergeSettings;
      /** Keep only the changes that belong to these faces' patches (see limitTidyToPicked). */
      limitTo?: Uint8Array;
    },
  ): Promise<RGB[] | null> {
    if (!model || palette.length === 0) return null;
    const flags = flagsOverride ?? settings.mergeFlags;
    const mergeSettings = options?.merge ?? settings.merge;
    setBusy(t("busy.adjacency"));
    await yieldToUi();
    try {
      const hexes = palette.map((entry) => rgbToHex(entry.rgb));
      const positionByHex = new Map(hexes.map((hex, position) => [hex, position]));
      const targetOf = (position: number): number => {
        let current = position;
        for (let hop = 0; hop < palette.length; hop++) {
          const target = flags[hexes[current]]?.target;
          const next = target ? positionByHex.get(target) : undefined;
          if (next === undefined || next === current) return current;
          current = next;
        }
        return current;
      };
      const headOf = hexes.map((_h, position) => targetOf(position));
      const heads = [...new Set(headOf)].sort((a, b) => a - b);
      const groupOfHead = new Map(heads.map((head, group) => [head, group]));
      const labelToGroup = Int32Array.from(headOf.map((head) => groupOfHead.get(head) ?? 0));
      const groupCount = heads.length;
      if (groupCount === palette.length && !options?.cleanupOnly) {
        setStatus(t("status.noMergeTargets"));
        return null;
      }
      const flagOf = (position: number) => flags[hexes[position]];
      const ambiguousLabels = hexes.map((_h, p) => p).filter((p) => headOf[p] !== p && flagOf(p)?.ambiguous);
      const protectGroups = new Set<number>();
      hexes.forEach((_h, p) => {
        if (flagOf(p)?.protect) protectGroups.add(labelToGroup[p]);
      });
      const minBlob = new Map<number, number>();
      heads.forEach((head, group) => minBlob.set(group, flagOf(head)?.minBlob ?? mergeSettings.minBlobDefault));

      const adjacency = adjacencyFor(model);
      setBusy(t("busy.merging"));
      await yieldToUi();
      const result = mergeWithReprojection(adjacency, {
        faceLabels: labels,
        labelToGroup,
        groupCount,
        ambiguousLabels,
        protectGroups,
        minBlob,
        maxPropagationRounds: mergeSettings.propagationRounds,
        smoothingRounds: mergeSettings.smoothingRounds,
        smoothProtected: mergeSettings.smoothProtected,
        trimRounds: mergeSettings.trimRounds,
        lineSpan: mergeSettings.lineSpan,
        // Borders cut along their line and confirmed are smooth already: the tidy leaves them as they are.
        settled: settledFaces(model),
        geometry: { triangles: model.triangles, vertices: model.vertices },
      });
      const representatives = representativeColoursByPosition(model.triangleColors, labels, palette);
      // A tidy of picked patches paints with the groups' own colours (as the palette shows them), so the groups keep them.
      const groupColour = heads.map((head) => (options?.limitTo ? palette[head].rgb : representatives[head]));
      const next: RGB[] = new Array(result.groups.length);
      for (let i = 0; i < result.groups.length; i++) next[i] = groupColour[result.groups[i]];
      if (options?.limitTo) {
        // A face changed when the tidy moved it to another group; everything else keeps its colour.
        const keep = limitTidyToPicked(adjacency, options.limitTo, (f) => result.groups[f] !== labelToGroup[labels[f]]);
        const limited = model.triangleColors.map((colour, f) => (keep[f] ? next[f] : colour));
        keepGroupsFor(model.triangleColors, limited);
        applyColours(model, limited, { keepSelection: true });
        return limited;
      }

      const before = groupWeightFractions(labels, palette.length, areaWeights);
      const naive = groupWeightFractions(result.naiveGroups, groupCount, areaWeights);
      const after = groupWeightFractions(result.groups, groupCount, areaWeights);
      const rows = heads
        .map((head, group) => ({
          label: `#${palette[head].index} ${hexes[head]}`,
          rgb: palette[head].rgb,
          before: before[head],
          naive: naive[group],
          after: after[group],
          merged: headOf.some((h, p) => h === head && p !== head),
        }))
        .sort((a, b) => Number(b.merged) - Number(a.merged) || b.after - a.after);
      setMergeReport({ rows, stats: result.stats, coloursBefore: countUniqueColours(model.triangleColors), coloursAfter: countUniqueColours(next) });
      // Every group keeps its band under its one colour: left as they were, the spectrum's cuts (shares of each
      // family's area) fall elsewhere on the few colours left, and a group lands in its neighbour's band
      // (11-04: the face's tan in the protected orange's — the face turned orange).
      keepGroupsFor(model.triangleColors, next);
      applyColours(model, next);
      setStatus(
        t("status.mergeDone", {
          from: palette.length,
          to: groupCount,
          ambiguous: result.stats.ambiguousFaceCount.toLocaleString(),
          smoothed: result.stats.smoothedFaceChanges.toLocaleString(),
          trimmed: result.stats.trimmedFaces.toLocaleString(),
          lined: result.stats.lineFaces.toLocaleString(),
          islands: result.stats.absorbedIslands,
        }),
      );
      return next;
    } catch (err) {
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
      return null;
    } finally {
      setBusy(null);
    }
  }


  // ------------------------------------------------------------------
  // ✨ Auto tidy
  // ------------------------------------------------------------------
  useEffect(() => {
    void aiStatus().then(setLocalAi);
    void dataGet<TidyLogEntry[]>("tidy-chat").then((saved) => {
      if (Array.isArray(saved)) setTidyLog(saved.slice(-200));
      tidyLogLoaded.current = true;
    });
    void dataGet<Record<string, StoredPartMap>>("part-maps").then((saved) => {
      if (saved && typeof saved === "object" && !Array.isArray(saved)) setPartMaps(saved);
      partMapsLoaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (!partMapsLoaded.current) return;
    void dataSet("part-maps", partMaps);
  }, [partMaps]);
  // The conversation is kept in user-data like the rest of the work (last 200 entries).
  useEffect(() => {
    if (!tidyLogLoaded.current) return;
    void dataSet("tidy-chat", tidyLog.slice(-200));
  }, [tidyLog]);
  useEffect(() => {
    if (!tidyBusy) return;
    const started = Date.now();
    setTidyElapsed(0);
    const timer = window.setInterval(() => setTidyElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
    // Restart only when the AI starts or stops, not on every step label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tidyBusy !== null]);

  const tidyModelName = sourceInfo?.fileName ?? model?.name ?? "";

  /** The newest AI change still waiting for ✅ (shown over the views too). */
  const aiPreview = useMemo(() => {
    for (let i = tidyLog.length - 1; i >= 0; i--) {
      const entry = tidyLog[i];
      if (entry.model !== tidyModelName || entry.role !== "ai") continue;
      return entry.status === "preview" ? entry : null;
    }
    return null;
  }, [tidyLog, tidyModelName]);

  /**
   * ✨ An answer that came (11-05, the owner: "클로드가 최종 답을 줄 때 뭔가 줬다는 표시를 해 줘 — 팝업이 뜨든 바뀐 부분이
   * 번쩍하든, 뭐가 바뀐지 모르겠잖아"): a word over the views, and the faces it changed flashing yellow on the model.
   * The faces' colours are noted when the first plan of an ask goes in and compared once everything has settled
   * (the AI done, the bake done), so a three-pass 🤖 flashes all it changed.
   */
  const paletteColoursRef = useRef(paletteColours);
  paletteColoursRef.current = paletteColours;
  const [aiArrived, setAiArrived] = useState<number | null>(null);
  useEffect(() => {
    if (!flashArmRef.current || busy !== null || pendingPlan || tidyBusy !== null) return;
    const timer = window.setTimeout(() => {
      const before = flashArmRef.current;
      const now = paletteColoursRef.current;
      flashArmRef.current = null;
      if (!before || !now || now.length / FACE_BYTES !== before.length) return;
      const after = packedFaceColours(now);
      const mask = new Uint8Array(before.length);
      let faces = 0;
      for (let f = 0; f < before.length; f++)
        if (after[f] !== before[f]) {
          mask[f] = 1;
          faces++;
        }
      if (faces > 0) setChangeFlash({ mask, faces, total: before.length, at: Date.now() });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [paletteColours, busy, pendingPlan, tidyBusy]);
  useEffect(() => {
    if (!changeFlash) return;
    // A small change stays outlined while its preview waits for ✅ or ↩ (11-05, the owner: the view turned to
    // look at it, and the mark had gone); a whole paint only flashes.
    const small = changeFlash.faces <= changeFlash.total * 0.4;
    if (small && aiPreview) return;
    const timer = window.setTimeout(() => setChangeFlash(null), small ? 300 : 4500);
    return () => window.clearTimeout(timer);
  }, [changeFlash, aiPreview]);
  const tidyBusyWasRef = useRef<string | null>(null);
  /** The newest entry when the AI started: an answer is any AI entry after it (a note may follow the answer). */
  const tidyLogAtStartRef = useRef<string | null>(null);
  useEffect(() => {
    const was = tidyBusyWasRef.current;
    tidyBusyWasRef.current = tidyBusy;
    if (was === null && tidyBusy !== null) {
      tidyLogAtStartRef.current = tidyLog.length ? tidyLog[tidyLog.length - 1].id : null;
      return;
    }
    if (was === null || tidyBusy !== null) return;
    const from = tidyLogAtStartRef.current ? tidyLog.findIndex((entry) => entry.id === tidyLogAtStartRef.current) + 1 : 0;
    if (tidyLog.slice(from).some((entry) => entry.model === tidyModelName && entry.role === "ai")) setAiArrived(Date.now());
    // Only when the AI starts or stops working.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tidyBusy]);
  useEffect(() => {
    if (aiArrived === null) return;
    const timer = window.setTimeout(() => setAiArrived(null), 6000);
    return () => window.clearTimeout(timer);
  }, [aiArrived]);

  /** How the consults reach Claude (the same in 02, 03 and 04). */
  const aiConnection = {
    route: aiRoute,
    keyMask: apiKey ? maskKey(apiKey) : null,
    usage: keyUsage,
    onSaveKey: (key: string) => {
      saveApiKey(key);
      setApiKey(key);
    },
    onClearKey: () => {
      saveApiKey(null);
      setApiKey(null);
    },
  };

  /** The part map under the consult: what the model is, its parts with their size and tint. */
  const partsShown = useMemo(() => {
    const map = model ? partMaps[tidyModelName] : undefined;
    if (!model || !map || map.faces !== model.triangles.length) return null;
    const cells = shapeCellsRef.current?.triangles === model.triangles ? shapeCellsRef.current.cells : cellsFor(model);
    const pct = (part: ShapePart) => part.cells.reduce((sum, c) => sum + (cells.areaPct[c] ?? 0), 0);
    return { subject: map.subject, list: map.parts.map((part, p) => ({ name: part.name, pct: pct(part), tint: PART_TINTS[p % PART_TINTS.length] })) };
  }, [model, partMaps, tidyModelName]);

  // The part map in 3D: each part in its tint, while asked for (the model's colours come back when it is turned off).
  useEffect(() => {
    if (!partView || !model) return;
    const map = partMaps[tidyModelName];
    if (!map || map.faces !== model.triangles.length) return;
    const cells = cellsFor(model);
    if (map.cells !== cells.count) return;
    const { partOfFace } = partFacesFor(model, map, cells);
    const byPart: number[][] = map.parts.map(() => []);
    for (let f = 0; f < partOfFace.length; f++) if (partOfFace[f] >= 0) byPart[partOfFace[f]].push(f);
    for (const handle of editedViewers()) byPart.forEach((faces, p) => handle.setFaceColours(Int32Array.from(faces), hexToRgb(PART_TINTS[p % PART_TINTS.length])));
    return () => {
      const current = modelRef.current;
      if (current) setModel({ ...current });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partView, model?.triangleColors, model?.triangles, partMaps, tidyModelName]);

  function buildTidyContext(): TidyContext | null {
    if (!model) return null;
    const groupByHex = new Map(committedGroups.filter((group) => group.colours.length > 0).map((group) => [rgbToHex(group.rep), group]));
    const familyName = (family: number) => stripData?.families.find((f) => f.family === family)?.name ?? "?";
    return {
      modelName: tidyModelName,
      faces: model.triangles.length,
      sourceColours: stripData?.colourCount ?? palette.length,
      target: targetGroups,
      minBlob: settings.merge.minBlobDefault,
      smoothing: settings.merge.smoothingRounds,
      smoothProtected: settings.merge.smoothProtected,
      trimTeeth: settings.merge.trimRounds,
      lineSmooth: settings.merge.lineSpan,
      palette: palette.map((entry, position) => {
        const hex = rgbToHex(entry.rgb);
        const group = groupByHex.get(hex);
        // How it prints (03): one filament, or a mixture in layers, and the colour that comes out.
        const assignment = plan?.paletteToAssignment.get(entry.index);
        let recipe: string | undefined;
        let printed: string | undefined;
        if (assignment?.kind === "physical") {
          recipe = `E${assignment.extruder}`;
          const slot = slots[assignment.extruder - 1];
          if (slot) printed = rgbToHex(slot.filament.rgb);
        } else if (assignment?.kind === "virtual") {
          const blend = plan?.virtualBlends.find((b) => b.virtualId === assignment.virtualId);
          if (blend) {
            recipe = blend.components.map((c) => `E${c.extruder} ${c.count}`).join(" · ");
            printed = rgbToHex(blend.displayRgb);
          }
        }
        const key = String(entry.index);
        return {
          hex,
          areaPct: (areaByPosition[position] ?? 0) * 100,
          family: group ? familyName(group.family) : "?",
          shades: group?.colours.length ?? 1,
          protected: Boolean(settings.mergeFlags[hex]?.protect),
          output: stripOutputOf(hex)?.label,
          recipe,
          printed,
          hand: settings.manualPhysical[key] !== undefined || settings.recipeOverrides[key] !== undefined,
        };
      }),
      slots: slots.map((slot) => ({ label: `E${slot.slot}`, hex: rgbToHex(slot.filament.rgb), name: slot.filament.name })),
      mix: settings.mix,
      mixScores: null,
      layerHeight: layerHeightMm ?? null,
    };
  }

  /** The shape step's cells of this mesh (worked out once a mesh, the same every time). */
  function cellsFor(current: MeshModel): ShapeCells {
    const held = shapeCellsRef.current;
    if (held && held.triangles === current.triangles) return held.cells;
    const weights = current === model ? areaWeights : triangleAreaWeights(current);
    const cells = shapeCells(faceCentroids(current.vertices, current.triangles), adjacencyFor(current), weights, SHAPE_CELL_COUNT);
    shapeCellsRef.current = { triangles: current.triangles, cells };
    return cells;
  }

  /** Face centres and normals, and how deep each face sits in a dent (per mesh). */
  const creaseRef = useRef<{ triangles: MeshModel["triangles"]; geometry: CreaseGeometry; concavity: Float32Array } | null>(null);
  function creasesFor(current: MeshModel): { geometry: CreaseGeometry; concavity: Float32Array } {
    const held = creaseRef.current;
    if (held && held.triangles === current.triangles) return held;
    const geometry = creaseGeometry(current.vertices, current.triangles);
    const concavity = faceConcavity(adjacencyFor(current), geometry);
    creaseRef.current = { triangles: current.triangles, geometry, concavity };
    return creaseRef.current;
  }

  /** The model's own colours where they still fit this mesh (the file's), else the colours now. */
  function ownColoursOf(current: MeshModel): RGB[] {
    const own = originalColoursRef.current;
    return own && own.length === current.triangles.length ? own : current.triangleColors;
  }

  /** Each face's own colour as Lab (for the cost of crossing a colour change). */
  const ownLabRef = useRef<{ colours: RGB[]; lab: Float32Array } | null>(null);
  function ownLabOf(current: MeshModel): Float32Array {
    const own = ownColoursOf(current);
    if (ownLabRef.current?.colours === own) return ownLabRef.current.lab;
    const lab = new Float32Array(own.length * 3);
    const cache = new Map<number, LAB>();
    for (let f = 0; f < own.length; f++) {
      const c = own[f];
      const key = (c[0] << 16) | (c[1] << 8) | c[2];
      let v = cache.get(key);
      if (!v) cache.set(key, (v = rgbToLab(c)));
      lab[f * 3] = v.L;
      lab[f * 3 + 1] = v.a;
      lab[f * 3 + 2] = v.b;
    }
    ownLabRef.current = { colours: own, lab };
    return lab;
  }

  /**
   * Each face's part: the cells' parts, then the borders between parts moved into the groove
   * (and onto the change of the model's own colour) nearby — a hand round a candy cane is the
   * hand's up to where it meets the cane, not wherever a cell happened to end (11-04).
   */
  const partFacesRef = useRef<{ triangles: MeshModel["triangles"]; map: StoredPartMap; labels: Int32Array; partOfFace: Int32Array; partOfCell: Int32Array } | null>(null);
  function partFacesFor(current: MeshModel, map: StoredPartMap, cells: ShapeCells): { partOfFace: Int32Array; partOfCell: Int32Array } {
    const held = partFacesRef.current;
    if (held && held.triangles === current.triangles && held.map === map && held.labels === labels) return held;
    const partOfCell = cellParts(cells, map.parts);
    const rough = facePartsOf(cells, partOfCell);
    // Half a cell's width either side: a cell's faces are about √(faces a cell) across.
    const band = Math.max(4, Math.min(80, Math.round(Math.sqrt(current.triangles.length / Math.max(1, cells.count)) * 0.35)));
    const adjacency = adjacencyFor(current);
    let partOfFace = snapToCreases(rough, adjacency, creasesFor(current).geometry, { band, lab: ownLabOf(current), grooveCost: 80, colourCost: 0.6 });
    // A part's colour spilling into the next part's cells (a hand in the cane's cells) goes back to its part.
    if (labels.length === current.triangles.length) {
      const summary = summariseParts(partOfFace, map.parts.length, labels, palette.length, areaWeights);
      partOfFace = partsBySpill(partOfFace, labels, adjacency, summary);
    }
    partFacesRef.current = { triangles: current.triangles, map, labels, partOfFace, partOfCell };
    return partFacesRef.current;
  }

  /** The part looked at up close: its faces and blobs, for the colours they were made on. */
  const focusRef = useRef<{ triangles: MeshModel["triangles"]; colours: RGB[]; part: string; map: BlobMap; mask: Uint8Array } | null>(null);
  /** Each close-up answer's blobs, so a proposal tried later (👀) paints the blobs it was made for. */
  const focusByEntryRef = useRef(new Map<string, NonNullable<typeof focusRef.current>>());
  /** 🤖 every part up close: each part's blobs, and which part each face is (a part paints its own faces only). */
  const autoFocusRef = useRef<{ triangles: MeshModel["triangles"]; partOfFace: Int32Array; parts: Map<string, { index: number; map: BlobMap; share: number }> } | null>(null);
  const autoFocusByEntryRef = useRef(new Map<string, NonNullable<typeof autoFocusRef.current>>());

  /** The dark holes and dents of the sculpt (eye holes of a button), for the colours as they are. */
  const pitsRef = useRef<{ colours: RGB[]; pits: Pit[] } | null>(null);
  function pitsFor(current: MeshModel): Pit[] {
    if (pitsRef.current?.colours === current.triangleColors) return pitsRef.current.pits;
    if (labels.length !== current.triangles.length) return [];
    const { geometry, concavity } = creasesFor(current);
    const pits = findPits(labels, adjacencyFor(current), concavity, areaWeights, ownColoursOf(current), geometry).slice(0, 16);
    pitsRef.current = { colours: current.triangleColors, pits };
    return pits;
  }

  /** The holes as the AI reads them (numbered P1…), with the part each lies in. */
  function pitsContext(current: MeshModel, map: StoredPartMap | null, cells: ShapeCells | null): NonNullable<TidyContext["pits"]> {
    const pits = pitsFor(current);
    const partOfFace = map && cells && map.cells === cells.count ? partFacesFor(current, map, cells).partOfFace : null;
    const hexOf = (label: number) => (palette[label] ? rgbToHex(palette[label].rgb) : "?");
    return pits.map((pit, i) => {
      let part: string | undefined;
      if (partOfFace && map) {
        const votes = new Map<number, number>();
        for (const f of pit.faces) votes.set(partOfFace[f], (votes.get(partOfFace[f]) ?? 0) + 1);
        const best = [...votes].sort((a, b) => b[1] - a[1])[0];
        if (best && best[0] >= 0) part = map.parts[best[0]]?.name;
      }
      return {
        id: i + 1,
        inside: hexOf(pit.inside),
        around: pit.around.slice(1).filter((a) => a.share >= 0.2).map((a) => hexOf(a.label)),
        areaPct: pit.areaPct,
        faces: pit.faces.length,
        own: rgbToHex(pit.own),
        part,
      };
    });
  }

  /** The part map kept for this model, if it was made on this mesh. */
  function partMapFor(current: MeshModel | null, maps = partMaps): StoredPartMap | null {
    const map = current ? maps[tidyModelName] : undefined;
    return map && current && map.faces === current.triangles.length ? map : null;
  }

  /** The part map as the AI reads it: each part's size and the colours in it (palette as now). */
  function shapeContext(current: MeshModel, map: StoredPartMap, cells: ShapeCells): TidyShape | null {
    if (map.cells !== cells.count || labels.length !== current.triangles.length) return null;
    const summary = summariseParts(partFacesFor(current, map, cells).partOfFace, map.parts.length, labels, palette.length, areaWeights);
    return {
      subject: map.subject,
      cellCount: cells.count,
      parts: map.parts.map((part, p) => ({
        name: part.name,
        areaPct: summary[p].areaPct,
        cells: part.cells.map((c) => c + 1),
        colours: summary[p].colours.map((c) => ({ hex: palette[c.label] ? rgbToHex(palette[c.label].rgb) : "?", pct: c.pct })),
      })),
    };
  }

  /** The patches too small to matter one by one, per colour (02: what the speck clean-up would take). */
  function specksSummary(current: MeshModel): TidyContext["specks"] {
    if (labels.length !== current.triangles.length) return null;
    // Every patch of 0.02 % or more is listed (a part, not a speck): what is left over is the specks.
    const map = findRegions(labels, adjacencyFor(current), areaWeights, { minPct: 0.02, max: 1_000_000 });
    return map.unlisted
      .filter((row) => row.tiny > 0)
      .map((row) => ({ hex: palette[row.label] ? rgbToHex(palette[row.label].rgb) : "?", patches: row.patches, tiny: row.tiny, faces: row.faces }));
  }

  /** Loose pieces of the mesh (what "split loose pieces" would write apart). */
  const piecesRef = useRef<{ triangles: MeshModel["triangles"]; count: number } | null>(null);
  function piecesOfMesh(current: MeshModel): number {
    const held = piecesRef.current;
    if (held && held.triangles === current.triangles) return held.count;
    const { offsets, neighbours } = adjacencyFor(current);
    const n = current.triangles.length;
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    let count = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (seen[s0]) continue;
      count++;
      let top = 0;
      seen[s0] = 1;
      stack[top++] = s0;
      while (top > 0) {
        const a = stack[--top];
        for (let i = offsets[a]; i < offsets[a + 1]; i++) {
          const b = neighbours[i];
          if (!seen[b]) {
            seen[b] = 1;
            stack[top++] = b;
          }
        }
      }
    }
    piecesRef.current = { triangles: current.triangles, count };
    return count;
  }

  /** Step 04 as the AI reads it. */
  function exportInfoNow(current: MeshModel): TidyExportInfo {
    const e = settings.export;
    return {
      printer: printer.name || settings.export.printerId,
      settings: {
        targetHeight: e.targetHeight ?? Math.round(printHeightMm ?? 0),
        splitObjects: e.splitObjects,
        splitAsParts: e.splitAsParts,
        closeHoles: e.closeHoles,
        putOnBed: e.putOnBed,
        centerOnBed: e.centerOnBed,
        borderCut: e.cutSpan > 0,
        printPreset: e.printPreset ?? "template",
      },
      sizeMm: printFit ? [printFit.size.x, printFit.size.y, printFit.size.z] : null,
      bed: [printFit?.bed.x ?? e.bedX, printFit?.bed.y ?? e.bedY],
      pieces: piecesOfMesh(current),
      colours: palette.length,
      extruders: slots.length,
      lastExport: exportOutcome ? exportOutcome.message.slice(0, 300) : null,
    };
  }

  /** Step 03's rating of every mixing option (the same twelve plans as its 점수 button). */
  async function rateMixOptions(): Promise<TidyMixScore[] | null> {
    if (palette.length === 0 || slots.length === 0) return null;
    const m = settings.mix;
    const options = {
      accentIndices: accentPaletteIndices(palette),
      purePhysicalThreshold: m.purePhysicalThreshold,
      accentProtection: m.accentProtection,
      mixPriority: m.mixPriority,
      mappingStrategy: m.mappingStrategy,
      colourDifferenceMetric: m.colourDifferenceMetric,
    };
    const scores = await ask(
      { kind: "rate", palette, slots, options },
      adviceKey("rate", { palette: palette.map((p) => [p.index, p.rgb, p.count]), slots: slots.map((slot) => slot.filament.effectiveRgb), options }),
    );
    const best = recommendMixOption(scores);
    return scores.map((score) => ({
      components: score.maxComponents,
      resolution: score.recipeResolution,
      fidelity: score.fidelity,
      meanError: score.meanError,
      cycleLayers: score.maxCycleLayers,
      lost: score.lost,
      recommended: score === best,
    }));
  }

  /**
   * Pictures for the consult: the colours before the tidy from the front and
   * at an angle (the same every turn, so they are cached), then the state now
   * from six sides — the palette for colours, the print simulation for mixing.
   */
  function takeTidyPictures(
    scope: TidyScope,
    closeUp: boolean,
    shape?: { cells: ShapeCells; partOfCell: Int32Array | null },
    pits: Pit[] = [],
  ): { stable: string[]; stableLabels: string[]; current: string[]; currentLabels: string[] } | null {
    if (!model || !positions) return null;
    const viewName: Record<ViewName | "now", string> = { front: "앞", back: "뒤", left: "왼쪽", right: "오른쪽", top: "위", iso: "사선", now: "지금 화면" };
    const chain = tidyChainRef.current;
    const before = chain && chain.result === model.triangleColors ? chain.base : model.triangleColors;
    let stable = tidyStableShotsRef.current;
    if (!stable || stable.colours !== before) {
      const buffer = buildColourBuffer(model.triangles.length, (i) => before[i]);
      stable = { colours: before, urls: renderViews(positions, buffer, ["front", "iso"]).map((shot) => shot.dataUrl) };
      tidyStableShotsRef.current = stable;
    }
    const stableLabels = ["원본(정돈 전) 앞", "원본(정돈 전) 사선"];
    const palettePics = paletteColours ?? sourceColours;
    const printPics = printColours ?? palettePics;
    const current: string[] = [];
    const currentLabels: string[] = [];
    const add = (colours: ColourBuffer | null, views: ViewName[], what: string) => {
      if (!colours) return;
      for (const shot of renderViews(positions, colours, views)) {
        current.push(shot.dataUrl);
        currentLabels.push(`${what} ${viewName[shot.view]}`);
      }
    };
    // 02's pictures carry the cell numbers (and the part borders, once there is a part map).
    const numbered = (views: ViewName[], what: string) => {
      if (!palettePics || !shape) return add(palettePics, views, what);
      const shots = renderNumberedViews(positions, palettePics, shape.cells.cellOf, shape.cells.count, views, 640, shape.partOfCell ?? undefined);
      for (const shot of shots.shots) {
        current.push(shot.dataUrl);
        currentLabels.push(`${what} ${viewName[shot.view]} — 칸 번호${shape.partOfCell ? "·굵은 선 = 부위 경계" : ""}`);
      }
    };
    if (scope === "clean") numbered(SIX_VIEWS, "결과(02 팔레트)");
    else if (scope === "mix") add(printPics, SIX_VIEWS, "결과(03 출력 시뮬레이션)");
    else if (scope === "export") add(printPics, ["front", "back", "iso"], "결과(출력 시뮬레이션)");
    else {
      numbered(["front", "back", "iso"], "결과(02 팔레트)");
      add(printPics, ["front", "back", "iso"], "결과(03 출력 시뮬레이션)");
    }
    // The biggest hole up close, before and now: small holes (a button's eye holes) are a few pixels in the whole-model pictures.
    if (pits.length > 0 && viewBounds && (scope === "clean" || scope === "both")) {
      const pit = pits[0];
      const size = Math.max(viewBounds.xSpan, viewBounds.ySpan, viewBounds.zMax - viewBounds.zMin);
      const target = pointToView(pit.centre);
      const dir = pointToView(pit.normal);
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const d = size * 0.28;
      const pose = {
        position: [target[0] + (dir[0] / len) * d, target[1] + (dir[1] / len) * d, target[2] + (dir[2] / len) * d] as [number, number, number],
        target,
        up: [0, 0, 1] as [number, number, number],
        fov: 30,
        aspect: 1,
        zoom: 4,
      };
      const beforeBuffer = buildColourBuffer(model.triangles.length, (i) => before[i]);
      for (const [colours, what] of [
        [beforeBuffer, "구멍 확대(P1 둘레) — 원본"],
        [palettePics, "구멍 확대(P1 둘레) — 결과(02 팔레트)"],
      ] as const) {
        if (!colours) continue;
        const [shot] = renderViews(positions, colours, [pose], 520);
        current.push(shot.dataUrl);
        currentLabels.push(what);
      }
    }
    // What the owner is looking at, once zoomed in (or asked for, as the face
    // preset does): the same view before the tidy and now.  Small things like
    // eyes and a mouth are a few pixels in the whole-model pictures.
    const pose = (showResult ? viewerRef2 : viewerRef0).current?.cameraPose() ?? null;
    if (scope !== "export" && pose && (closeUp || pose.zoom >= CLOSE_UP_ZOOM)) {
      const beforeBuffer = buildColourBuffer(model.triangles.length, (i) => before[i]);
      const nowWhat = scope === "mix" ? "결과(03 출력 시뮬레이션)" : "결과(02 팔레트)";
      for (const [colours, what] of [
        [beforeBuffer, "지금 화면 — 원본(정돈 전)"],
        [scope === "mix" ? printPics : palettePics, `지금 화면 — ${nowWhat}`],
      ] as const) {
        if (!colours) continue;
        const [shot] = renderViews(positions, colours, [pose], 720);
        current.push(shot.dataUrl);
        currentLabels.push(what);
      }
    }
    return { stable: stable.urls, stableLabels, current, currentLabels };
  }

  /**
   * Applies a tidy: settings first, then (for colour changes) 02's Tidy up
   * once the new palette is in.  Starts over from the colours before the
   * last tidy while the model still shows its result.
   */
  function applyTidy(changes: TidyChanges, entryId: string, title: string, lines: ChangeLine[], dropped?: string[], options?: { undoPushed?: boolean }): void {
    if (!model) return;
    // A chain from before the mesh changed (a cut confirmed or undone) cannot be gone back to.
    if (tidyChainRef.current && tidyChainRef.current.base.length !== model.triangles.length) tidyChainRef.current = null;
    const touchesClean = hasCleanChanges(changes);
    const chain = tidyChainRef.current;
    const showingTidy = chain !== null && chain.result === model.triangleColors;
    // A plan (applyPlan) recorded its own step before painting: one ↩ takes back all of it.
    if (!options?.undoPushed)
      pushTidyUndo({
        entryId,
        title,
        lines,
        historyTop: history[history.length - 1] ?? null,
        settings: { palette: settings.palette, merge: settings.merge, mergeFlags: settings.mergeFlags, stripByModel: settings.stripByModel, mix: settings.mix },
        colours: model.triangleColors,
        chain: chain ? { ...chain } : null,
      });
    if (touchesClean) {
      if (showingTidy && chain) {
        setModel({ ...model, triangleColors: chain.base, stats: { ...model.stats, uniqueFaceColors: countUniqueColours(chain.base) } });
        // The bake below records the base again as its undo step.
        if (history[history.length - 1] === chain.base) {
          setHistory((prev) => prev.slice(0, -1));
          dropUndo("colours");
        }
      }
      tidyChainRef.current = { base: showingTidy && chain ? chain.base : model.triangleColors, result: null };
    }
    setSettings((prev) => {
      const next = { ...prev };
      if (changes.target !== undefined && changes.target !== prev.palette.maxColours) {
        next.palette = { ...prev.palette, maxColours: changes.target };
        // Hand-moved cuts were for the old count: lay the strip out again.
        const strips = { ...prev.stripByModel };
        forgetCuts(strips, stripKey);
        next.stripByModel = strips;
      }
      const clean = cleanSettingsAfter(prev.merge, prev.mergeFlags, changes);
      next.merge = clean.merge;
      next.mergeFlags = clean.mergeFlags;
      if (changes.mix) next.mix = { ...prev.mix, ...changes.mix };
      return next;
    });
    if (touchesClean) setPendingTidy({ entryId, protectAccents: Boolean(changes.protectAccents) });
    setTidyHighlight(lines.length > 0 ? new Set(lines.map((line) => line.key)) : null);
    setTidyResult({ entryId, title, lines, undone: false, dropped });
    if (lines.length > 0) setStatus(t("tidy.statusDone", { n: lines.length }));
  }

  // The bake of a tidy, once the new palette and its colour flags are in.
  useEffect(() => {
    if (!pendingTidy || !model || busy !== null) return;
    if (palette.some((entry) => !settings.mergeFlags[rgbToHex(entry.rgb)])) return;
    const job = pendingTidy;
    setPendingTidy(null);
    let flags = settings.mergeFlags;
    if (job.protectAccents) {
      flags = protectSmallVivid(flags, palette, areaByPosition);
      setSettings((prev) => ({ ...prev, mergeFlags: flags }));
    }
    void runMerge(flags, { cleanupOnly: true }).then((next) => {
      const chain = tidyChainRef.current;
      if (next && chain) chain.result = next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTidy, palette, settings.mergeFlags, model, busy]);

  /**
   * The colours a plan paints before anything bakes: each part one colour (its shading
   * and specks to its main colour, its details kept), cells painted, group colours made
   * clean.  Null when it paints nothing.  New colours come in as groups of their own.
   */
  function planColours(
    current: MeshModel,
    changes: TidyChanges,
    mapNow?: StoredPartMap | null,
  ): { next: RGB[]; also: Map<number, string>; pinned: { pins: number[][] | undefined; from: Record<string, number> | undefined } | undefined; faces: number; moved: Array<[string, string]>; pitHexes: string[]; flooded: string[] } | null {
    // Things pointed at that were not painted (the wand ran over their part): said after the plan goes in.
    const flooded: string[] = [];
    floodedRef.current = flooded;
    if (labels.length !== current.triangles.length) return null;
    const before = current.triangleColors;
    const next = before.slice();
    const touched = new Uint8Array(before.length);
    let faces = 0;
    const recolourTo = new Map((changes.recolour ?? []).map((m) => [m.hex, m.to]));
    const hexOf = (position: number) => (palette[position] ? rgbToHex(palette[position].rgb) : "");
    const rgbCache = new Map<string, RGB>();
    // A colour recoloured in the same plan paints with its new colour.
    const rgbOf = (hex: string): RGB => {
      const final = recolourTo.get(hex) ?? hex;
      let rgb = rgbCache.get(final);
      if (!rgb) {
        rgb = fillRgb(current, final);
        rgbCache.set(final, rgb);
      }
      return rgb;
    };
    const paintFace = (f: number, rgb: RGB) => {
      if (next[f] === rgb) return;
      next[f] = rgb;
      if (!touched[f]) {
        touched[f] = 1;
        faces++;
      }
    };
    const map = mapNow === undefined ? partMapFor(current) : mapNow;
    if ((changes.partTidy?.length || changes.paint?.length) && map) {
      const cells = cellsFor(current);
      if (map.cells === cells.count) {
        const { partOfCell, partOfFace } = partFacesFor(current, map, cells);
        // Protected as the plan leaves it: a colour it stops protecting is tidied with the rest, and a colour
        // the plan gives to some parts (red: the mouth, the cane) is tidied away in the others (a red speck on a foot).
        const unprotected = new Set(changes.unprotect ?? []);
        const placed = new Set((changes.partTidy ?? []).flatMap((m) => [m.main, ...m.keep]));
        const protectedLabels = new Uint8Array(palette.length);
        palette.forEach((entry, position) => {
          const hex = rgbToHex(entry.rgb);
          if (placed.has(hex)) return;
          if ((settings.mergeFlags[hex]?.protect && !unprotected.has(hex)) || changes.protect?.includes(hex)) protectedLabels[position] = 1;
        });
        const rules = (changes.partTidy ?? [])
          .map((m) => ({
            part: map.parts.findIndex((part) => part.name === m.part),
            main: positionByHex.get(m.main) ?? -1,
            mainHex: m.main,
            keep: m.keep.map((hex) => positionByHex.get(hex)).filter((p): p is number => p !== undefined),
          }))
          .filter((rule) => rule.part >= 0);
        const mainHexOfPart = new Map(rules.map((rule) => [rule.part, rule.mainHex]));
        const labOf = (position: number) => rgbToLab(palette[position].rgb);
        // A shade of a kept detail (a lighter eye) joins that detail, not the part's main colour.
        const near = (label: number, keep: number[]): number | null => {
          let best: number | null = null;
          let bestD = 10;
          const a = labOf(label);
          for (const k of keep) {
            const d = deltaE2000(a, labOf(k));
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
          return best;
        };
        // A colour far from the kept one round it (a dark hole in a white button) is a detail, not shading.
        const distinct = (label: number, around: number) => deltaE2000(labOf(label), labOf(around)) >= 25;
        const out = tidyByParts(partOfFace, cells, partOfCell, labels, rules, { protectedLabels, near, adjacency: adjacencyFor(current), distinct });
        for (let i = 0; i < out.faces.length; i++) {
          const to = out.to[i];
          paintFace(out.faces[i], to >= 0 ? rgbOf(hexOf(to)) : rgbOf(mainHexOfPart.get(out.parts[i]) ?? ""));
        }
        for (const m of changes.paint ?? []) {
          const wanted = new Uint8Array(cells.count);
          for (const c of m.cells) if (c >= 1 && c <= cells.count) wanted[c - 1] = 1;
          const from = m.from ? new Set(m.from.map((hex) => positionByHex.get(hex)).filter((p): p is number => p !== undefined)) : null;
          const rgb = rgbOf(m.into);
          for (let f = 0; f < next.length; f++) if (wanted[cells.cellOf[f]] && (!from || from.has(labels[f]))) paintFace(f, rgb);
        }
      }
    }
    // A part up close: its pieces (blobs grouped by the AI), each one colour.
    const focus = focusRef.current;
    // The blobs come from the model's own colours: they hold as long as the mesh does (other parts may have been painted since).
    const focusUsable = Boolean(changes.pieces?.length && focus && focus.triangles === current.triangles);
    if (focusUsable && focus) {
      for (const piece of changes.pieces ?? []) {
        const rgb = rgbOf(piece.colour);
        for (const id of piece.blobs) {
          const blob = focus.map.blobs[id - 1];
          if (!blob) continue;
          for (let k = 0; k < blob.members.length; k++) paintFace(focus.map.faces[blob.members[k]], rgb);
        }
      }
    }
    // 🤖 every part up close: each part's own faces in the colours its blobs were given; what no answer placed
    // (a blob blurred across two things, a part with no answer) takes the side cheapest to reach.
    const auto = autoFocusRef.current;
    const autoUsable = Boolean(changes.assign?.length && auto && auto.triangles === current.triangles);
    if (autoUsable && auto) {
      const colourIds: RGB[] = [];
      const idOfHex = new Map<string, number>();
      const idOf = (rgb: RGB) => {
        const key = rgbToHex(rgb);
        let id = idOfHex.get(key);
        if (id === undefined) {
          id = colourIds.length;
          idOfHex.set(key, id);
          colourIds.push(rgb);
        }
        return id;
      };
      const looked = new Uint8Array(auto.parts.size ? Math.max(...[...auto.parts.values()].map((p) => p.index)) + 1 : 0);
      for (const info of auto.parts.values()) looked[info.index] = 1;
      // The answers' colours first (they are what is voted on), then the colours of faces no part looked at.
      const assignIds = (changes.assign ?? []).map((m) => idOf(rgbOf(m.colour)));
      const width = colourIds.length;
      const ids = new Int32Array(next.length);
      for (let f = 0; f < next.length; f++) {
        const p = auto.partOfFace[f];
        ids[f] = p >= 0 && p < looked.length && looked[p] ? -1 : idOf(next[f]);
      }
      const inParts = ids.map((id) => (id === -1 ? 1 : 0));
      // Each part saw its own faces and the cells round them, so most faces were looked at by a few parts: they vote.
      // A part calling a thing its own counts most (more still on its own faces), a part naming a neighbour's
      // thing counts once — one part getting it wrong is outvoted (11-04 Tkc: the hat took its brim's lip for
      // hair; six neighbours said brim → orange).  The goggles saying "my lens" beats the hat calling it gear.
      const votes = new Uint8Array(next.length * width);
      // The colour a small thing named on this face got (it is not overruled by its blob's majority afterwards).
      const pinned = new Int32Array(next.length).fill(-1);
      for (let a = 0; a < (changes.assign ?? []).length; a++) {
        const m = (changes.assign ?? [])[a];
        const info: { index: number; map: BlobMap; share: number } | undefined = auto.parts.get(m.part);
        if (!info) continue;
        const id = assignIds[a];
        const mine = m.mine !== false;
        // A small thing named as one's own (a brooch's gold dot, a bag's stripe — under 0.05 % of the model) is the
        // surest answer there is: it outvotes a part calling the whole flower its own black (11-04 Tkc).
        let groupFaces = 0;
        for (const b of m.blobs) groupFaces += info.map.blobs[b - 1]?.members.length ?? 0;
        const pinpoint = mine && groupFaces < next.length * 0.0005 ? 2 : 0;
        for (const b of m.blobs) {
          const blob: BlobMap["blobs"][number] | undefined = info.map.blobs[b - 1];
          if (!blob) continue;
          for (let k = 0; k < blob.members.length; k++) {
            const face: number = info.map.faces[blob.members[k]];
            if (!inParts[face]) continue;
            const own = auto.partOfFace[face] === info.index;
            const weight = mine ? (own ? 5 : 4) + pinpoint : 1;
            const slot = face * width + id;
            votes[slot] = Math.min(255, votes[slot] + weight);
            if (pinpoint) pinned[face] = id;
          }
        }
      }
      // A face's own vote, kept where it wins clearly (twice the runner-up: "my lens" against the hat's "gear").
      const clear = new Uint8Array(next.length);
      for (let f = 0; f < next.length; f++) {
        if (!inParts[f]) continue;
        let best = -1;
        let most = 0;
        let second = 0;
        for (let c = 0; c < width; c++) {
          const v = votes[f * width + c];
          if (v > most) {
            second = most;
            most = v;
            best = c;
          } else if (v > second) second = v;
        }
        ids[f] = best;
        if ((most >= 2 * second && most >= 2) || (best >= 0 && pinned[f] === best)) clear[f] = 1;
      }
      // Where the vote is close, the face goes with its blob (as its own part cut it): one thing stays one colour,
      // not a patchwork of neighbours' guesses (11-04 Tkc: a brim in three colours).
      for (const info of auto.parts.values()) {
        const tally = new Float64Array(width);
        for (const blob of info.map.blobs) {
          tally.fill(0);
          let any = false;
          for (let k = 0; k < blob.members.length; k++) {
            const face: number = info.map.faces[blob.members[k]];
            if (auto.partOfFace[face] !== info.index) continue;
            for (let c = 0; c < width; c++) tally[c] += votes[face * width + c];
            any = true;
          }
          if (!any) continue;
          let major = -1;
          let top = 0;
          for (let c = 0; c < width; c++) if (tally[c] > top) {
            top = tally[c];
            major = c;
          }
          if (major < 0) continue;
          for (let k = 0; k < blob.members.length; k++) {
            const face: number = info.map.faces[blob.members[k]];
            if (auto.partOfFace[face] === info.index && !clear[face]) ids[face] = major;
          }
        }
      }
      const filled = fillUnlabelled(ids, adjacencyFor(current), creasesFor(current).geometry, { lab: ownLabOf(current), grooveCost: 60, colourCost: 0.6 });
      for (let f = 0; f < next.length; f++) if (inParts[f] && filled[f] >= 0) paintFace(f, colourIds[filled[f]]);
      // Things pointed at (a bag's stripe, a brooch's dot): from the face under the point over that thing's own
      // colour (a magic wand on the surface, stopping at folds), over whatever the votes gave.
      for (const m of changes.marks ?? []) {
        const info: { index: number; map: BlobMap; share: number } | undefined = auto.parts.get(m.part);
        let within: Uint8Array | null = null;
        if (info) {
          within = new Uint8Array(next.length);
          for (let i = 0; i < info.map.faces.length; i++) within[info.map.faces[i]] = 1;
        }
        const region = markRegion(m.seed, ownLabOf(current), adjacencyFor(current), creasesFor(current).geometry, within, next.length, m.shaded === true);
        if (!region) {
          flooded.push(m.what || m.part);
          continue;
        }
        const rgb = rgbOf(m.colour);
        for (const f of region) paintFace(f, rgb);
      }
    }
    // Things pointed at from a consult (no 🤖 run round them): the same wand, inside the part and the cells round it.
    if (!autoUsable && changes.marks?.length) {
      const marksMap = mapNow === undefined ? partMapFor(current) : mapNow;
      const cells = cellsFor(current);
      for (const m of changes.marks) {
        const index = marksMap && marksMap.cells === cells.count ? marksMap.parts.findIndex((part) => part.name === m.part) : -1;
        const within = marksMap && index >= 0 ? partNeighbourhood(cells, marksMap.parts[index].cells, next.length) : null;
        const region = markRegion(m.seed, ownLabOf(current), adjacencyFor(current), creasesFor(current).geometry, within, next.length, m.shaded === true);
        if (!region) {
          flooded.push(m.what || m.part);
          continue;
        }
        const rgb = rgbOf(m.colour);
        for (const f of region) paintFace(f, rgb);
      }
    }
    // Holes and dents (a button's eye holes) with the colour chosen for them.
    const pitColours = new Set<string>();
    if (changes.pits?.length) {
      const pits = pitsFor(current);
      for (const m of changes.pits) {
        const rgb = rgbOf(m.into);
        pitColours.add(rgbToHex(rgb));
        for (const id of m.ids) for (const f of pits[id - 1]?.faces ?? []) paintFace(f, rgb);
      }
    }
    // A group's colour made clean: its faces not painted already take the new colour; the group stays (as 🎨 on its chip).
    const also = new Map<number, string>();
    let pins = storedStrip?.pins;
    let from = storedStrip?.from;
    const moved: Array<[string, string]> = [];
    for (const [hex, to] of recolourTo) {
      const position = positionByHex.get(hex);
      if (position === undefined) continue;
      const rgb = hexToRgb(to);
      for (let f = 0; f < next.length; f++) if (labels[f] === position && !touched[f]) paintFace(f, rgb);
      const group = committedGroups.find((g) => g.colours.length > 0 && rgbToHex(g.rep) === hex);
      const newKey = stripColourKey(rgb);
      if (group) {
        also.set(newKey, `${group.family}:${group.index}`);
        const own = new Set(group.colours.map((colour) => colour.key));
        if (pins?.some((keys) => keys.some((key) => own.has(key)))) pins = pins.map((keys) => (keys.some((key) => own.has(key)) ? [newKey] : keys));
        from = fromMoved(from, (key) => (own.has(key) ? newKey : undefined)) ?? from;
      }
      moved.push([hex, rgbToHex(rgb)]);
    }
    // Colour borders into the grooves nearby (on by default with a part tidy): where sculpted parts of
    // different colour meet, the colour changes at the bottom of the groove between them.
    const band = changes.creaseSnap ?? (changes.partTidy?.length || focusUsable || autoUsable ? 3 : 0);
    if (band > 0) {
      // By group, not by shade: a group's faces keep their thousands of shades (the bake makes them one);
      // a face that changes side takes the group's colour.  (11-04: by shade, the blue of the eyes mixed
      // with the grey round it and the whole group came out grey-blue.)
      const recolourKey = new Map<number, number>();
      for (const [hex, to] of recolourTo) {
        const position = positionByHex.get(hex);
        if (position !== undefined) recolourKey.set(stripColourKey(hexToRgb(to)), position);
      }
      const extraOf = new Map<number, number>();
      const colourOf: RGB[] = palette.map((entry) => rgbOf(rgbToHex(entry.rgb)));
      const ids = new Int32Array(next.length);
      for (let f = 0; f < next.length; f++) {
        if (!touched[f]) {
          ids[f] = labels[f];
          continue;
        }
        const c = next[f];
        const key = stripColourKey(c);
        const position = positionByHex.get(rgbToHex(c)) ?? recolourKey.get(key);
        if (position !== undefined) {
          ids[f] = position;
          continue;
        }
        let id = extraOf.get(key);
        if (id === undefined) {
          id = colourOf.length;
          extraOf.set(key, id);
          colourOf.push(c);
        }
        ids[f] = id;
      }
      // Protected colours and the holes' colours keep their faces.
      const unprotected = new Set(changes.unprotect ?? []);
      const frozen = new Uint8Array(colourOf.length);
      palette.forEach((entry, position) => {
        const hex = rgbToHex(entry.rgb);
        if ((settings.mergeFlags[hex]?.protect && !unprotected.has(hex)) || changes.protect?.includes(hex)) frozen[position] = 1;
      });
      colourOf.forEach((c, id) => {
        if (pitColours.has(rgbToHex(c))) frozen[id] = 1;
      });
      // A part up close changes only inside what was looked at.
      const only = focusUsable && !changes.partTidy?.length && !autoUsable && focus ? focus.mask : null;
      const snapped = snapToCreases(ids, adjacencyFor(current), creasesFor(current).geometry, { band, frozen, lab: ownLabOf(current), grooveCost: 60, colourCost: 0.5, only });
      for (let f = 0; f < next.length; f++) if (snapped[f] !== ids[f]) paintFace(f, colourOf[snapped[f]]);
    }
    // New colours (a part's clean main colour, a cell painted with one): a group of their own each.
    const present = new Set<number>();
    for (const group of committedGroups) for (const colour of group.colours) present.add(colour.key);
    for (const rgb of rgbCache.values()) {
      const key = stripColourKey(rgb);
      if (present.has(key) || also.has(key) || pins?.some((keys) => keys.includes(key))) continue;
      also.set(key, `new:${key}`);
      pins = [...(pins ?? []), [key]];
    }
    if (faces === 0) return null;
    return { next, also, pinned: pins !== storedStrip?.pins || from !== storedStrip?.from ? { pins, from } : undefined, faces, moved, pitHexes: [...pitColours], flooded };
  }

  /** 03's hand choices, as a plan sets them (by the colour's palette number). */
  function withRecipeChanges(prev: PipelineSettings, changes: TidyChanges): PipelineSettings {
    const indexOf = (hex: string) => {
      const position = positionByHex.get(hex);
      return position === undefined || !palette[position] ? null : String(palette[position].index);
    };
    const overrides = { ...prev.recipeOverrides };
    const manual = { ...prev.manualPhysical };
    for (const m of changes.recipes ?? []) {
      const key = indexOf(m.hex);
      if (key === null) continue;
      overrides[key] = { counts: m.counts };
      delete manual[key];
    }
    for (const m of changes.single ?? []) {
      const key = indexOf(m.hex);
      if (key === null) continue;
      manual[key] = m.extruder;
      delete overrides[key];
    }
    for (const hex of changes.autoRecipe ?? []) {
      const key = indexOf(hex);
      if (key === null) continue;
      delete overrides[key];
      delete manual[key];
    }
    return { ...prev, recipeOverrides: overrides, manualPhysical: manual };
  }

  /**
   * A plan from the consult, done at once as a preview (✅ keeps it, ↩ takes all of it
   * back): 03's recipes and 04's settings, then the colours it paints (parts, cells,
   * group colours), then its knobs and merges — those bake once the painted colours are in.
   */
  function applyPlan(changes: TidyChanges, entryId: string, title: string, lines: ChangeLine[], dropped?: string[], mapNow?: StoredPartMap | null): void {
    if (!model) return;
    // The faces' colours before this ask's first plan, to flash what it changed once all is in.
    if (!flashArmRef.current && paletteColoursRef.current) flashArmRef.current = packedFaceColours(paletteColoursRef.current);
    if (tidyChainRef.current && tidyChainRef.current.base.length !== model.triangles.length) tidyChainRef.current = null;
    const chain = tidyChainRef.current;
    pushTidyUndo({
      entryId,
      title,
      lines,
      historyTop: history[history.length - 1] ?? null,
      settings: {
        palette: settings.palette,
        merge: settings.merge,
        mergeFlags: settings.mergeFlags,
        stripByModel: settings.stripByModel,
        mix: settings.mix,
        recipeOverrides: settings.recipeOverrides,
        manualPhysical: settings.manualPhysical,
        export: settings.export,
      },
      colours: model.triangleColors,
      chain: chain ? { ...chain } : null,
    });
    if (hasRecipeChanges(changes)) setSettings((prev) => withRecipeChanges(prev, changes));
    if (changes.export) {
      const ex = changes.export;
      const next = { ...settings.export };
      if (ex.targetHeight !== undefined) next.targetHeight = ex.targetHeight;
      if (ex.splitObjects !== undefined) next.splitObjects = ex.splitObjects;
      if (ex.splitAsParts !== undefined) next.splitAsParts = ex.splitAsParts;
      if (ex.closeHoles !== undefined) next.closeHoles = ex.closeHoles;
      if (ex.putOnBed !== undefined) next.putOnBed = ex.putOnBed;
      if (ex.centerOnBed !== undefined) next.centerOnBed = ex.centerOnBed;
      if (ex.borderCut !== undefined) {
        next.cutSpan = ex.borderCut ? CUT_SPAN : 0;
        next.cutChosen = true;
      }
      if (ex.printPreset !== undefined && ex.printPreset !== next.printPreset) {
        next.printPreset = ex.printPreset;
        setPreviewLayerHeight(null);
      }
      patchSettings("export", next);
    }
    floodedRef.current = [];
    const painted = hasColourEdits(changes) ? planColours(model, changes, mapNow) : null;
    if (floodedRef.current.length) {
      const what = [...new Set(floodedRef.current)].join(" · ");
      setTidyLog((prev) => [...prev, { id: `s${Date.now()}f`, role: "sys", text: t("tidy.markFlooded", { what }), at: new Date().toISOString(), model: tidyModelName, scope: "clean" }]);
    }
    if (painted) {
      keepGroupsFor(model.triangleColors, painted.next, painted.also.size ? painted.also : undefined, painted.pinned);
      if (painted.moved.length) {
        setSettings((prev) => {
          let flags = prev.mergeFlags;
          for (const [from, to] of painted.moved) flags = carryFlags(flags, from, to);
          return { ...prev, mergeFlags: flags };
        });
        for (const [from, to] of painted.moved) twinHexes(from, to);
      }
      applyColours(model, painted.next, { keepSelection: true });
    }
    // Knobs and merges name colours as the palette was: a colour recoloured by this plan goes by its new name.
    const renamed = new Map(painted?.moved ?? []);
    const rename = (hex: string) => renamed.get(hex) ?? hex;
    const rest: TidyChanges = {
      target: changes.target,
      minBlob: changes.minBlob,
      smoothing: changes.smoothing,
      smoothProtected: changes.smoothProtected,
      trimTeeth: changes.trimTeeth,
      lineSmooth: changes.lineSmooth,
      // The holes' colour is protected: small as they are, the bake's speck clean-up would take them (11-04: minBlob 300 ate a button's eye holes).
      // So are the things pointed at (a thin rim — 11-05): a speck clean-up would take a rim a few faces wide.
      protect: [...new Set([...(changes.protect ?? []).map(rename), ...(painted?.pitHexes ?? []), ...(painted ? (changes.marks ?? []).map((m) => m.colour.toUpperCase()) : [])])],
      unprotect: changes.unprotect?.map(rename),
      merge: changes.merge?.map((m) => ({ from: rename(m.from), into: rename(m.into) })),
      protectAccents: changes.protectAccents,
      mix: changes.mix,
    };
    if (hasCleanChanges(rest) || rest.mix) {
      if (painted) setPendingPlan({ changes: rest, entryId, title, lines, dropped, colours: painted.next });
      else applyTidy(rest, entryId, title, lines, dropped, { undoPushed: true });
      return;
    }
    setTidyHighlight(lines.length > 0 ? new Set(lines.map((line) => line.key)) : null);
    setTidyResult({ entryId, title, lines, undone: false, dropped });
    if (lines.length > 0) setStatus(t("tidy.statusDone", { n: lines.length }));
  }

  // A plan's knobs, once the colours it painted are in (their palette is laid out from them).
  useEffect(() => {
    const job = pendingPlan;
    if (!job || !model || busy !== null) return;
    if (model.triangleColors !== job.colours) return;
    setPendingPlan(null);
    applyTidy(job.changes, job.entryId, job.title, job.lines, job.dropped, { undoPushed: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlan, model, busy]);

  /** ✅ on a preview: it stays (it is already in; only the mark changes). */
  function acceptPreview(entryId: string): void {
    const entry = tidyLog.find((e) => e.id === entryId);
    // Previews stack (an auto tidy, then its parts up close): they are all on the model, so ✅ keeps them all.
    setTidyLog((prev) => prev.map((e) => (e.model === tidyModelName && e.status === "preview" ? { ...e, status: "applied" as const } : e)));
    setStatus(t("tidy.previewApplied", { title: entry?.text.slice(0, 40) ?? "" }));
  }

  /** Whether ↩ can take this entry back: only the newest change can. */
  function canCancelEntry(entryId: string): boolean {
    const steps = tidyUndoRef.current;
    return tidyUndoCount > 0 && steps[steps.length - 1]?.entryId === entryId;
  }

  function cancelEntry(entryId: string): void {
    if (canCancelEntry(entryId)) undoTidy();
  }

  /** Takes back the newest tidy (settings and colours); pressed again, the one before it, to the start. */
  function undoTidy(): void {
    const steps = tidyUndoRef.current;
    const saved = steps[steps.length - 1];
    if (!saved || !model) return;
    if (saved.colours.length !== model.triangles.length) {
      // Made on another mesh (before a cut was confirmed or undone): it cannot be gone back to.
      tidyUndoRef.current = steps.slice(0, -1);
      setTidyUndoCount(tidyUndoRef.current.length);
      return;
    }
    const chain = tidyChainRef.current;
    const expected = saved.result ?? chain?.result ?? saved.colours;
    if (model.triangleColors !== expected && model.triangleColors !== saved.colours && !window.confirm(t("tidy.undoConfirm"))) return;
    setPendingTidy(null);
    setSettings((prev) => ({ ...prev, ...saved.settings }));
    if (saved.historyTop !== undefined) {
      // Back to before the tidy, its own colour steps (the paint, the bake) leave the history with it: ↩ again goes
      // to what came before the tidy — not back to its result, as when the undo itself was a step (11-04).
      const at = saved.historyTop === null ? 0 : history.lastIndexOf(saved.historyTop) + 1;
      const drop = at > 0 || saved.historyTop === null ? history.length - at : 0;
      if (model.triangleColors !== saved.colours) {
        setModel({ ...model, triangleColors: saved.colours, stats: { ...model.stats, uniqueFaceColors: countUniqueColours(saved.colours) } });
        forgetRecipeUndo();
      }
      if (drop > 0) {
        setHistory((prev) => prev.slice(0, at));
        for (let k = 0; k < drop; k++) dropUndo("colours");
      }
      setFuture([]);
      redoOrderRef.current = [];
    } else {
      if (model.triangleColors !== saved.colours) applyColours(model, saved.colours, { keepSelection: true });
      // The bake recorded the colours it started from; back at those, that step would be a no-op — dropped.
      if (chain && saved.colours === chain.base && history[history.length - 1] === chain.base) {
        setHistory((prev) => prev.slice(0, -1));
        dropUndo("colours");
      }
    }
    tidyChainRef.current = saved.chain;
    tidyUndoRef.current = steps.slice(0, -1);
    setTidyUndoCount(tidyUndoRef.current.length);
    setTidyResult({ entryId: saved.entryId, title: saved.title, lines: saved.lines, undone: true, faces: saved.faces });
    setTidyLog((prev) => [
      ...prev.map((entry) => (entry.id === saved.entryId && (entry.status === "applied" || entry.status === "preview") ? { ...entry, status: "undone" as const } : entry)),
      { id: `t${Date.now()}`, role: "sys", text: t("tidy.undoneLog", { title: saved.title }), at: new Date().toISOString(), model: tidyModelName, scope: tidyScope },
    ]);
    setStatus(t("tidy.statusUndoneMsg", { n: saved.lines.length }));
  }

  /** What a preset would change, before it is pressed (shown under the presets). */
  function previewTidyPreset(id: TidyPreset["id"]): ChangeLine[] | null {
    const context = buildTidyContext();
    if (!context) return null;
    // On picked patches the values are baked whatever the model's are: show them, not a difference.
    if (tidyArea === "picked") return pickedValueLines(pickedOnly(presetChanges(id, context, "clean")), t);
    return describeChanges(presetChanges(id, context, tidyScope), context, t);
  }

  /**
   * A preset on the picked patches only: step 02's tidy with the preset's
   * values, kept where it touches the patches (their border, the specks in
   * and along them).  The model's settings stay as they are.
   */
  async function tidyPresetPicked(id: TidyPreset["id"]): Promise<void> {
    const context = buildTidyContext();
    const picked = pickedMaskRef.current;
    if (!context || !model || !picked || busy !== null) return;
    if (id === "line") setCutNotice(cutSpan > 0 ? "on" : "off");
    const changes = pickedOnly(presetChanges(id, context, "clean"));
    // Lines are the values that differ from the model's; the bake runs even when
    // none do, since the patch itself may not be tidy yet.
    const lines = describeChanges(changes, context, t);
    const title = t("tidy.presetLogPicked", { name: t(`tidy.preset.${id}` as Key) });
    const entryId = `t${Date.now()}`;
    const clean = cleanSettingsAfter(settings.merge, settings.mergeFlags, changes);
    const flags = changes.protectAccents ? protectSmallVivid(clean.mergeFlags, palette, areaByPosition) : clean.mergeFlags;
    const before = model.triangleColors;
    const after = await runMerge(flags, { cleanupOnly: true, merge: clean.merge, limitTo: picked });
    if (!after) return;
    let changed = 0;
    for (let f = 0; f < after.length; f++) if (after[f] !== before[f]) changed++;
    const chain = tidyChainRef.current;
    if (changed > 0)
      pushTidyUndo({
        entryId,
        title,
        lines,
        historyTop: history[history.length - 1] ?? null,
        settings: { palette: settings.palette, merge: settings.merge, mergeFlags: settings.mergeFlags, stripByModel: settings.stripByModel, mix: settings.mix },
        colours: before,
        chain: chain ? { ...chain } : null,
        result: after,
        faces: changed,
      });
    setTidyLog((prev) => [
      ...prev,
      { id: entryId, role: "sys", text: title, at: new Date().toISOString(), model: tidyModelName, scope: "clean", changes, lines, status: changed > 0 ? "applied" : "none" },
    ]);
    setTidyHighlight(lines.length > 0 ? new Set(lines.map((line) => line.key)) : null);
    setTidyResult({ entryId, title, lines, undone: false, faces: changed });
    setStatus(changed > 0 ? t("tidy.statusPicked", { n: changed.toLocaleString() }) : t("tidy.nothingPicked"));
  }

  function tidyPreset(id: TidyPreset["id"]): void {
    if (tidyArea === "picked") {
      void tidyPresetPicked(id);
      return;
    }
    const context = buildTidyContext();
    if (!context || busy !== null) return;
    if (id === "line") setCutNotice(cutSpan > 0 ? "on" : "off");
    const changes = presetChanges(id, context, tidyScope);
    const lines = describeChanges(changes, context, t);
    const name = t(`tidy.preset.${id}` as Key);
    const title = t("tidy.presetLog", { name, scope: t(tidyScope === "clean" ? "tidy.scopeClean" : tidyScope === "mix" ? "tidy.scopeMix" : "tidy.scopeBoth") });
    const entry: TidyLogEntry = {
      id: `t${Date.now()}`,
      role: "sys",
      text: title,
      at: new Date().toISOString(),
      model: tidyModelName,
      scope: tidyScope,
      changes,
      lines,
      status: lines.length > 0 ? "applied" : "none",
    };
    setTidyLog((prev) => [...prev, entry]);
    if (lines.length === 0) {
      setTidyResult({ entryId: entry.id, title, lines, undone: false });
      return;
    }
    applyTidy(changes, entry.id, title, lines);
  }

  function tidyConsultPreset(preset: TidyConsultPreset): void {
    void tidyAsk(t(`tidy.consult.${preset.id}.ask` as Key), false, preset.closeUp);
  }

  /** The context a plan is checked against now: the palette, the cells and the part map, step 04. */
  function planContext(scope: TidyScope): TidyContext | null {
    const context = buildTidyContext();
    if (!context || !model) return context;
    if (scope === "clean" || scope === "both") {
      const cells = cellsFor(model);
      context.cellCount = cells.count;
      const map = partMapFor(model);
      context.shape = map ? shapeContext(model, map, cells) : null;
      context.pits = pitsContext(model, map, cells);
    }
    if (scope === "export") context.exportInfo = exportInfoNow(model);
    return context;
  }

  /** 👀 on a proposal: tried as a preview (checked again against the state as it is now). */
  function applyTidySuggestion(entryId: string): void {
    const entry = tidyLog.find((e) => e.id === entryId);
    if (!entry?.changes || busy !== null) return;
    const context = planContext(entry.scope);
    if (!context) return;
    const heldAuto = autoFocusByEntryRef.current.get(entryId);
    if (heldAuto && model && heldAuto.triangles === model.triangles) autoFocusRef.current = heldAuto;
    const held = focusByEntryRef.current.get(entryId);
    if (held && model && held.triangles === model.triangles) {
      focusRef.current = held;
      context.focus = { part: held.part, blobs: held.map.blobs.map((b) => ({ id: b.id, areaPct: b.areaPct, mean: rgbToHex(b.mean), family: b.familyName })) };
    }
    const { changes, dropped } = sanitizeChanges({ ...entry.changes, parts: undefined }, context, entry.scope, t);
    if (changes.fix?.length) {
      void tryWithFixes(entryId, changes, dropped, context);
      return;
    }
    const lines = describeChanges(changes, context, t);
    setTidyLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: lines.length > 0 ? "preview" : "none", lines } : e)));
    if (lines.length > 0) applyPlan(changes, entryId, t("tidy.bySuggestion"), lines, dropped);
  }

  /**
   * 💬 What a consult wants painted that no blob or cell holds alone (a thin white rim round an eye — 11-05, the owner:
   * "색이 안 잡힌다는 이유로 아무것도 안 했어"): asked again with a grid on the part's own original pictures, the
   * points the AI gives become wand marks — painted along the original's colour borders, stopping at folds.
   */
  async function marksForFixes(fixes: NonNullable<TidyChanges["fix"]>, context: TidyContext, message: string, signal: AbortSignal, route: AiRoute): Promise<{ marks: NonNullable<TidyChanges["marks"]>; missed: string[] }> {
    const marks: NonNullable<TidyChanges["marks"]> = [];
    const missed: string[] = [];
    const current = model;
    const map = current ? partMapFor(current) : null;
    const cells = current ? cellsFor(current) : null;
    if (!current || !positions || !map || !cells || map.cells !== cells.count) return { marks, missed: fixes.map((fix) => fix.what) };
    const SIZE = 720;
    const ownBuffer = buildColourBuffer(current.triangles.length, (i) => ownColoursOf(current)[i]);
    const resultBuffer = paletteColours ?? sourceColours ?? ownBuffer;
    const shots = takeTidyPictures("clean", false);
    const lab = ownLabOf(current);
    for (let n = 0; n < fixes.length; n++) {
      const fix = fixes[n];
      setTidyBusy(t("tidy.busyPoint", { what: fix.what, done: n, n: fixes.length }));
      await yieldToUi();
      const index = map.parts.findIndex((part) => part.name === fix.part);
      if (index < 0) {
        missed.push(fix.what);
        continue;
      }
      // The part's cells and two rings of cells round them (the part map is rough).
      const own = new Uint8Array(cells.count);
      for (const c of map.parts[index].cells) own[c] = 1;
      const inRegion = partNeighbourhood(cells, map.parts[index].cells, current.triangles.length);
      const partFaces: number[] = [];
      for (let f = 0; f < cells.cellOf.length; f++) if (own[cells.cellOf[f]]) partFaces.push(f);
      const poses = partCloseUps(partFaces, 2);
      const originals = renderViews(positions, ownBuffer, poses, SIZE);
      const [now] = renderViews(positions, resultBuffer, [poses[0]], SIZE);
      const images = await Promise.all([...originals.map((shot) => withGrid(shot.dataUrl)), withGrid(now.dataUrl)]);
      const first = (shots?.stable.length ?? 0) + 1;
      const pick = poses.map((_, i) => first + i);
      const resultPicture = first + poses.length;
      const labels = [...poses.map((_, i) => `${fix.part} 원본 확대 ${i + 1} — 격자`), `${fix.part} 지금 결과 — 사진 ${first}과 같은 각도, 격자`];
      const reply = await aiAsk(
        {
          stable: tidyStablePrompt(context),
          stableImages: shots?.stable ?? [],
          images,
          text: pointPrompt(context, 0, fix.part, map.subject, `${fix.what} → ${fix.colour}${fix.problem ? ` (${fix.problem})` : ""}`, [{ id: 1, name: fix.what, hex: fix.colour }], pick, resultPicture, SIZE, [...(shots?.stableLabels ?? []), ...labels], message),
          schema: POINT_SCHEMA,
          tag: "point",
        },
        signal,
        route,
      ).catch((err) => {
        if (signal.aborted) throw err;
        return null;
      });
      let got = 0;
      if (reply?.ok) {
        const idsOf = new Map<number, Int32Array>();
        for (const point of sanitizePoints(reply.result, [...pick, resultPicture], SIZE, new Set([1]))) {
          const poseIndex = point.picture === resultPicture ? 0 : point.picture - first;
          let ids = idsOf.get(poseIndex);
          if (!ids) idsOf.set(poseIndex, (ids = renderFaceIds(positions, poses[poseIndex], SIZE)));
          const seed = seedUnderPoint(ids, SIZE, point.x, point.y, inRegion, lab, point.source);
          if (seed < 0) continue;
          marks.push({ part: fix.part, seed, colour: fix.colour, what: point.what || fix.what, ...(point.shaded ? { shaded: true } : {}) });
          got++;
        }
      }
      if (got === 0) missed.push(fix.what);
    }
    return { marks, missed };
  }

  /** A consult's fixes made marks (pointed at on the pictures), in place; what could not be found is said. */
  async function resolveFixes(changes: TidyChanges, dropped: string[], context: TidyContext, message: string, signal: AbortSignal, route: AiRoute): Promise<void> {
    const fixes = changes.fix;
    delete changes.fix;
    if (!fixes?.length) return;
    const { marks, missed } = await marksForFixes(fixes, context, message, signal, route);
    if (marks.length) changes.marks = [...(changes.marks ?? []), ...marks];
    for (const what of missed) dropped.push(t("tidy.drop.fixMissed", { what }));
    // A rim a few faces wide does not live through smoothing (11-05: the eye's white rim, smoothed with the
    // protected colours, came out a dotted line).
    if (changes.marks?.length && changes.smoothProtected === true) {
      delete changes.smoothProtected;
      dropped.push(t("tidy.drop.smoothThin"));
    }
  }

  /** 👀 on a proposal with fixes: the things pointed at first (Claude asked again), then the preview. */
  async function tryWithFixes(entryId: string, changes: TidyChanges, dropped: string[], context: TidyContext): Promise<void> {
    if (tidyBusy !== null || busy !== null) return;
    const controller = new AbortController();
    tidyAbortRef.current = controller;
    const message = [...tidyLog].reverse().find((e) => e.role === "user" && e.model === tidyModelName)?.text ?? "";
    try {
      await resolveFixes(changes, dropped, context, message, controller.signal, aiRoute ?? "local");
    } catch {
      setTidyLog((prev) => [...prev, { id: `s${Date.now()}`, role: "sys", text: t("tidy.stopped"), at: new Date().toISOString(), model: tidyModelName, scope: "clean" }]);
      return;
    } finally {
      setTidyBusy(null);
      tidyAbortRef.current = null;
    }
    const lines = describeChanges(changes, context, t);
    setTidyLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: lines.length > 0 ? "preview" : "none", lines, ...(dropped.length ? { dropped } : {}) } : e)));
    if (lines.length > 0) applyPlan(changes, entryId, t("tidy.bySuggestion"), lines, dropped);
  }

  /** The shape step's answer as a part map (cells 0-based, each cell in one part only). */
  function partsFromAnswer(raw: unknown, cellCount: number, faces: number): StoredPartMap | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const taken = new Uint8Array(cellCount);
    const parts: ShapePart[] = [];
    for (const item of Array.isArray(r.parts) ? r.parts : []) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const name = String(m.name ?? "").trim().slice(0, 24);
      const cells: number[] = [];
      for (const v of Array.isArray(m.cells) ? m.cells : []) {
        const c = Math.round(Number(v)) - 1;
        if (c >= 0 && c < cellCount && !taken[c]) {
          taken[c] = 1;
          cells.push(c);
        }
      }
      if (!name || cells.length === 0) continue;
      const same = parts.find((part) => part.name === name);
      if (same) same.cells.push(...cells);
      else parts.push({ name, cells });
    }
    if (parts.length === 0) return null;
    return { faces, cells: cellCount, subject: String(r.subject ?? "").trim().slice(0, 80), parts, at: new Date().toISOString() };
  }

  /** Shape first: what the model is, and which cells make each part (no owner check needed — it is the AI's own step). */
  async function shapeStep(context: TidyContext, cells: ShapeCells, message: string, controller: AbortController, route: AiRoute, sys: (text: string) => void): Promise<StoredPartMap | null> {
    if (!model) return null;
    const shots = takeTidyPictures("clean", false, { cells, partOfCell: null });
    if (!shots) return null;
    if (controller.signal.aborted) throw new DOMException("stopped", "AbortError");
    setTidyBusy(t("tidy.busyShape"));
    const shaped = await aiAsk(
      {
        stable: tidyStablePrompt(context),
        stableImages: shots.stable,
        images: shots.current,
        text: shapePrompt(context, [...shots.stableLabels, ...shots.currentLabels], message),
        schema: SHAPE_SCHEMA,
        tag: "shape",
      },
      controller.signal,
      route,
    );
    if (aiRoute === "key") setKeyUsage(loadKeyUsage());
    const made = shaped.ok ? partsFromAnswer(shaped.result, cells.count, model.triangles.length) : null;
    if (made) {
      setPartMaps((prev) => ({ ...prev, [tidyModelName]: made }));
      sys(t("tidy.shapeLog", { subject: made.subject || "?", n: made.parts.length, names: made.parts.map((part) => part.name).join(", ") }));
    } else sys(t("tidy.shapeFailed", { message: shaped.ok ? "—" : shaped.error }));
    return made;
  }

  async function tidyAsk(message: string, analyse: boolean, closeUp = false, scopeArg?: TidyScope, options?: { reshapeOnly?: boolean; images?: AttachedImage[] }): Promise<void> {
    if (!model || tidyBusy !== null || busy !== null) return;
    const scope = scopeArg ?? tidyScope;
    const exporting = scope === "export";
    const history = tidyLog.filter((entry) => entry.model === tidyModelName && (entry.scope === "export") === exporting);
    const at = () => new Date().toISOString();
    const sys = (text: string) => setTidyLog((prev) => [...prev, { id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`, role: "sys", text, at: at(), model: tidyModelName, scope }]);
    const attached = options?.images ?? [];
    setTidyLog((prev) => [...prev, { id: `u${Date.now()}`, role: "user", text: message, at: at(), model: tidyModelName, scope, ...(attached.length ? { images: attached.map((image) => image.thumb) } : {}) }]);
    const controller = new AbortController();
    tidyAbortRef.current = controller;
    const route = aiRoute ?? "local";
    try {
      const context = buildTidyContext();
      if (!context) return;
      const shaping = scope === "clean" || scope === "both";
      let cells: ShapeCells | null = null;
      let map = options?.reshapeOnly ? null : partMapFor(model);
      if (shaping) {
        setTidyBusy(t("tidy.busyShapeShots"));
        await yieldToUi();
        cells = cellsFor(model);
        context.cellCount = cells.count;
        if (map && map.cells !== cells.count) map = null;
        if (!map) map = await shapeStep(context, cells, message, controller, route, sys);
        if (options?.reshapeOnly) return;
        if (map) {
          setTidyBusy(t("tidy.busyParts"));
          await yieldToUi();
          context.shape = shapeContext(model, map, cells);
        }
        context.specks = specksSummary(model);
        context.pits = pitsContext(model, map, cells);
      }
      if (exporting) context.exportInfo = exportInfoNow(model);
      if (scope === "mix" || scope === "both") {
        setTidyBusy(t("tidy.busyScores"));
        context.mixScores = await rateMixOptions().catch(() => null);
      }
      setTidyBusy(t("tidy.busyShots"));
      await yieldToUi();
      const pictures = takeTidyPictures(scope, closeUp, cells ? { cells, partOfCell: map ? cellParts(cells, map.parts) : null } : undefined, shaping ? pitsFor(model) : []);
      if (!pictures) return;
      // The owner's own pictures go last, and the model's pictures make room for them (12 at most in one question).
      if (attached.length) {
        const room = Math.max(0, 12 - pictures.stable.length - attached.length);
        pictures.current = pictures.current.slice(0, room);
        pictures.currentLabels = pictures.currentLabels.slice(0, room);
        attached.forEach((image, i) => {
          pictures.current.push(image.full);
          pictures.currentLabels.push(t("tidy.attachedLabel", { n: i + 1 }));
        });
      }
      if (controller.signal.aborted) throw new DOMException("stopped", "AbortError");
      setTidyBusy(t("tidy.busyThinking", { n: pictures.stable.length + pictures.current.length }));
      const answer = await aiAsk(
        {
          stable: tidyStablePrompt(context),
          stableImages: pictures.stable,
          images: pictures.current,
          text: tidyTurnPrompt(context, scope, history, message, [...pictures.stableLabels, ...pictures.currentLabels]),
          schema: TIDY_SCHEMA,
          tag: "tidy",
        },
        controller.signal,
        route,
      );
      if (aiRoute === "key") setKeyUsage(loadKeyUsage());
      if (!answer.ok) throw new Error(answer.error);
      const raw = answer.result;
      // The state may have moved while Claude was thinking: check against it as it is now.
      const now = buildTidyContext() ?? context;
      Object.assign(now, { cellCount: context.cellCount, shape: context.shape, specks: context.specks, pits: context.pits, exportInfo: context.exportInfo, mixScores: context.mixScores });
      const sameMesh = modelRef.current !== null && modelRef.current.triangles === model.triangles;
      const { changes, dropped } = sanitizeChanges(raw.changes, now, scope, t);
      // A corrected part map (the owner said where an arm ends) is kept at once: it is not a colour change.
      let mapNow = map;
      if (changes.parts && cells && sameMesh) {
        const updated: StoredPartMap = {
          faces: model.triangles.length,
          cells: cells.count,
          subject: changes.parts.subject || map?.subject || "",
          parts: changes.parts.list.map((part) => ({ name: part.name, cells: part.cells.map((c) => c - 1) })),
          at: at(),
        };
        mapNow = updated;
        setPartMaps((prev) => ({ ...prev, [tidyModelName]: updated }));
        now.shape = shapeContext(model, updated, cells);
      }
      if (!sameMesh && (changes.partTidy || changes.paint || changes.fix)) {
        delete changes.partTidy;
        delete changes.paint;
        delete changes.fix;
        dropped.push(t("tidy.drop.meshChanged"));
      }
      const asked = raw.asked_to_change === true && !analyse;
      // What no blob or cell holds alone, pointed at on the part's pictures now (asked) or when the proposal is tried.
      if (asked && changes.fix?.length) await resolveFixes(changes, dropped, now, message, controller.signal, route);
      const lines = describeChanges(changes, now, t);
      const doable = lines.filter((line) => line.key !== "parts");
      const observations = Array.isArray(raw.observations) ? raw.observations.map(String).filter(Boolean).slice(0, 6) : [];
      const entry: TidyLogEntry = {
        id: `a${Date.now()}`,
        role: "ai",
        text: String(raw.reply ?? "").trim() || "…",
        at: at(),
        model: tidyModelName,
        scope,
        observations,
        changes,
        lines,
        status: doable.length === 0 ? (lines.length > 0 ? "applied" : "none") : asked && sameMesh ? "preview" : "suggested",
        dropped: dropped.length ? dropped : undefined,
      };
      setTidyLog((prev) => [...prev, entry]);
      if (asked && doable.length > 0 && sameMesh) applyPlan({ ...changes, parts: undefined }, entry.id, t("tidy.byAiPreview"), doable, dropped, mapNow);
    } catch (err) {
      const stopped = controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError");
      sys(stopped ? t("tidy.stopped") : t("tidy.failed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTidyBusy(null);
      tidyAbortRef.current = null;
    }
  }

  /**
   * Close-ups of a part: aimed at its middle, as near as fits it all, from the directions it shows the
   * most in — measured (drawn once in a flat colour, whatever stands in front hiding it), so the back of
   * the hair is looked at from behind, not through the head.  Up to `count`, at least 50° apart.
   */
  function partCloseUps(partFaces: ArrayLike<number>, count: number): CameraPose[] {
    if (!positions || !model) return [];
    const centre = [0, 0, 0];
    const normal = [0, 0, 0];
    let sum = 0;
    for (let k = 0; k < partFaces.length; k++) {
      const o = partFaces[k] * 9;
      const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
      const ux = positions[o + 3] - ax, uy = positions[o + 4] - ay, uz = positions[o + 5] - az;
      const vx = positions[o + 6] - ax, vy = positions[o + 7] - ay, vz = positions[o + 8] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const w = Math.hypot(nx, ny, nz) / 2;
      sum += w;
      centre[0] += ((ax + positions[o + 3] + positions[o + 6]) / 3) * w;
      centre[1] += ((ay + positions[o + 4] + positions[o + 7]) / 3) * w;
      centre[2] += ((az + positions[o + 5] + positions[o + 8]) / 3) * w;
      normal[0] += nx / 2;
      normal[1] += ny / 2;
      normal[2] += nz / 2;
    }
    if (sum > 0) for (let k = 0; k < 3; k++) centre[k] /= sum;
    let reach = 0;
    for (let k = 0; k < partFaces.length; k++) {
      const o = partFaces[k] * 9;
      reach = Math.max(reach, Math.hypot(positions[o] - centre[0], positions[o + 1] - centre[1], positions[o + 2] - centre[2]));
    }
    const unit = (d: number[]) => {
      const l = Math.hypot(d[0], d[1], d[2]);
      return l > 1e-9 ? d.map((v) => v / l) : [0, -1, 0];
    };
    const dir = unit(normal);
    const fov = 30;
    const distance = (Math.max(reach, 1e-3) / Math.sin(((fov / 2) * Math.PI) / 180)) * 1.1;
    const poseAlong = (d: number[]): CameraPose => ({
      position: [centre[0] + d[0] * distance, centre[1] + d[1] * distance, centre[2] + d[2] * distance],
      target: centre as [number, number, number],
      // Looking straight down (or up), "up" on the picture is the model's front-back axis.
      up: Math.abs(d[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1],
      fov,
      aspect: 1,
      zoom: 4,
    });
    const turn = (d: number[], deg: number) => {
      const a = (deg * Math.PI) / 180;
      return unit([d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a), d[2]]);
    };
    const r = Math.SQRT1_2;
    // The views the owner knows the model from (front, a little from above, the iso view) come first: the first
    // close-up is one of them when the part shows there at least half as well (11-04: seen from above, a hat's brim looked like hair).
    const known = [VIEW_DIRECTIONS.front, [0, -1, 0.6], VIEW_DIRECTIONS.iso].map(unit);
    const candidates = [...known, dir, turn(dir, 35), turn(dir, -35), [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [r, r, 0], [-r, r, 0], [r, -r, 0], [-r, -r, 0]].map(unit);
    const poses = candidates.map(poseAlong);
    const regionOf = new Int32Array(model.triangles.length).fill(-1);
    for (let k = 0; k < partFaces.length; k++) regionOf[partFaces[k]] = 0;
    const shows = regionPixels(positions, regionOf, 1, poses).map((c) => c[0]);
    const order = candidates.map((_, i) => i).sort((a, b) => shows[b] - shows[a]);
    const bestKnown = [0, 1, 2].sort((a, b) => shows[b] - shows[a])[0];
    if (shows[bestKnown] >= shows[order[0]] * 0.5) {
      order.splice(order.indexOf(bestKnown), 1);
      order.unshift(bestKnown);
    }
    const chosen: number[] = [];
    const apart = Math.cos((50 * Math.PI) / 180);
    for (const i of order) {
      if (chosen.length >= count || shows[i] <= 0 || (chosen.length > 0 && shows[i] < shows[chosen[0]] * 0.3)) break;
      const dot = (j: number) => candidates[i][0] * candidates[j][0] + candidates[i][1] * candidates[j][1] + candidates[i][2] * candidates[j][2];
      if (chosen.some((j) => dot(j) > apart)) continue;
      chosen.push(i);
    }
    return (chosen.length ? chosen : [0]).map((i) => poses[i]);
  }

  /**
   * The model's front in four quarters up close, the original and another colouring side by side in each
   * picture (for a review to see small things that went missing).
   */
  async function sideBySideQuarters(before: ColourBuffer, after: ColourBuffer): Promise<string[]> {
    if (!positions) return [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const half = Math.max(x1 - x0, z1 - z0) / 2;
    const fov = 30;
    const distance = ((half / 2) * 1.15) / Math.tan(((fov / 2) * Math.PI) / 180) + (y1 - y0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const out: string[] = [];
    for (const [dx, dz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const target: [number, number, number] = [cx + (dx * half) / 2, (y0 + y1) / 2, cz + (dz * half) / 2];
      const front = VIEW_DIRECTIONS.front;
      const pose: CameraPose = { position: [target[0] + front[0] * distance, target[1] + front[1] * distance, target[2] + front[2] * distance], target, up: [0, 0, 1], fov, aspect: 1, zoom: 2 };
      const [a] = renderViews(positions, before, [pose], 480);
      const [b] = renderViews(positions, after, [pose], 480);
      const canvas = document.createElement("canvas");
      canvas.width = 968;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, 968, 480);
      for (const [url, left] of [[a.dataUrl, 0], [b.dataUrl, 488]] as const) {
        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
        });
        ctx.drawImage(img, left, 0, 480, 480);
      }
      out.push(canvas.toDataURL("image/jpeg", 0.88));
    }
    return out;
  }

  /**
   * A big part's stretches: its cells (5 or more) in up to three groups of cells close together
   * (farthest-apart seeds, each cell to the nearest), each group's own faces.  None for a small part.
   */
  function partTiles(partCells: number[], ownFaces: Int32Array, cells: ShapeCells): Int32Array[] {
    if (!positions || partCells.length < 5) return [];
    const k = Math.min(3, Math.ceil(partCells.length / 4));
    const index = new Map(partCells.map((c, i) => [c, i]));
    const sum = new Float64Array(partCells.length * 4);
    for (const f of ownFaces) {
      const i = index.get(cells.cellOf[f]);
      if (i === undefined) continue;
      sum[i * 4] += positions[f * 9];
      sum[i * 4 + 1] += positions[f * 9 + 1];
      sum[i * 4 + 2] += positions[f * 9 + 2];
      sum[i * 4 + 3]++;
    }
    const at = (i: number) => [sum[i * 4] / (sum[i * 4 + 3] || 1), sum[i * 4 + 1] / (sum[i * 4 + 3] || 1), sum[i * 4 + 2] / (sum[i * 4 + 3] || 1)];
    const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const used = partCells.map((_, i) => i).filter((i) => sum[i * 4 + 3] > 0);
    if (used.length < 5) return [];
    const seeds = [used[0]];
    while (seeds.length < k) {
      let far = -1;
      let farD = -1;
      for (const i of used) {
        const d = Math.min(...seeds.map((s) => d2(at(i), at(s))));
        if (d > farD) {
          farD = d;
          far = i;
        }
      }
      seeds.push(far);
    }
    const groupOf = new Int32Array(partCells.length).fill(-1);
    for (const i of used) {
      let best = 0;
      for (let g = 1; g < seeds.length; g++) if (d2(at(i), at(seeds[g])) < d2(at(i), at(seeds[best]))) best = g;
      groupOf[i] = best;
    }
    const lists: number[][] = seeds.map(() => []);
    for (const f of ownFaces) {
      const i = index.get(cells.cellOf[f]);
      if (i !== undefined && groupOf[i] >= 0) lists[groupOf[i]].push(f);
    }
    return lists.filter((list) => list.length > 0).map((list) => Int32Array.from(list));
  }

  /**
   * 🤖 AI 단색 도색 (11-04 저녁 — the owner: "AI 색정리도 계속 진행해봐. 지금 너무 허접해"): the shape
   * first, then the model's final palette (a few colours; the owner's rule: colours the bake made dull
   * become the clean colour of that thing, clean ones stay), then every part up close at once — its own
   * faces cut into blobs by the model's colours, numbered on the views it shows best in — each blob
   * given a palette colour.  One preview for all of it; what no answer placed is filled from its sides.
   */
  async function autoTidy(message: string): Promise<void> {
    if (!model || !positions || tidyBusy !== null || busy !== null) return;
    const scope: TidyScope = "clean";
    const at = () => new Date().toISOString();
    const sys = (text: string) => setTidyLog((prev) => [...prev, { id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`, role: "sys", text, at: at(), model: tidyModelName, scope }]);
    setTidyLog((prev) => [...prev, { id: `u${Date.now()}`, role: "user", text: message, at: at(), model: tidyModelName, scope }]);
    const controller = new AbortController();
    tidyAbortRef.current = controller;
    const route = aiRoute ?? "local";
    const stopped = () => {
      if (controller.signal.aborted) throw new DOMException("stopped", "AbortError");
    };
    try {
      const context = buildTidyContext();
      if (!context) return;
      setTidyBusy(t("tidy.busyShapeShots"));
      await yieldToUi();
      const cells = cellsFor(model);
      context.cellCount = cells.count;
      let found = partMapFor(model);
      if (found && found.cells !== cells.count) found = null;
      if (!found) found = await shapeStep(context, cells, message, controller, route, sys);
      if (!found) return;
      const map = found;
      stopped();
      setTidyBusy(t("tidy.busyParts"));
      await yieldToUi();
      context.shape = shapeContext(model, map, cells);
      context.pits = pitsContext(model, map, cells);

      // 1. The palette, from the whole model with its part borders.
      const shots = takeTidyPictures("clean", false, { cells, partOfCell: cellParts(cells, map.parts) }, pitsFor(model));
      if (!shots) return;
      stopped();
      setTidyBusy(t("tidy.busyPalette"));
      const answer = await aiAsk(
        {
          stable: tidyStablePrompt(context),
          stableImages: shots.stable,
          images: shots.current,
          text: palettePrompt(context, [...shots.stableLabels, ...shots.currentLabels], message),
          schema: paletteSchemaFor(context.target),
          tag: "palette",
        },
        controller.signal,
        route,
      );
      if (aiRoute === "key") setKeyUsage(loadKeyUsage());
      if (!answer.ok) throw new Error(answer.error);
      const plan = sanitizePalette(answer.result, map.parts.map((part) => part.name), context.pits?.length ?? 0);
      if (!plan) {
        sys(t("tidy.paletteFailed"));
        return;
      }
      sys(t("tidy.paletteLog", { n: plan.palette.length, list: plan.palette.map((c) => `${c.name} ${c.hex}`).join(" · ") }));

      // 2. Every part up close, a few questions at a time (the blobs and pictures are made one part at a time).
      const { partOfFace } = partFacesFor(model, map, cells);
      const own = ownColoursOf(model);
      const ownBuffer = buildColourBuffer(model.triangles.length, (i) => own[i]);
      const facesOf: number[][] = map.parts.map(() => []);
      for (let f = 0; f < partOfFace.length; f++) if (partOfFace[f] >= 0) facesOf[partOfFace[f]].push(f);
      const byId = new Map(plan.palette.map((c) => [c.id, c]));
      const paletteIds = new Set(byId.keys());
      const parts = new Map<string, { index: number; map: BlobMap; share: number }>();
      // What each part was shown (its blobs and close-ups) and its latest answer: a later pass asks it again about the same blobs.
      type PartLook = { p: number; blobMap: BlobMap; faces: Int32Array; poses: CameraPose[]; overview: number; images: string[]; labels: string[]; neighbours: string[] };
      const looks = new Map<string, PartLook>();
      const answers = new Map<string, TidyAssignment["assign"]>();
      const notes: string[] = [];
      // Things pointed at in passes 2 and 3 (painted over the votes).
      const marks: NonNullable<TidyChanges["marks"]> = [];
      const askPart = async (name: string, look: PartLook, extra: string, extraImages: string[] = [], extraLabels: string[] = []) => {
        stopped();
        const setting = plan.parts.get(name);
        const reply = await aiAsk(
          {
            stable: tidyStablePrompt(context),
            stableImages: shots.stable,
            images: [...look.images, ...extraImages],
            text:
              assignPrompt(
                context,
                {
                  name,
                  subject: map.subject,
                  main: setting ? byId.get(setting.main) ?? null : null,
                  also: (setting?.also ?? []).map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c)),
                  looks: setting?.looks ?? "",
                  neighbours: look.neighbours.map((n) => ({ name: n, looks: plan.parts.get(n)?.looks ?? "" })),
                },
                plan.palette,
                look.blobMap.blobs.map((b) => ({ id: b.id, areaPct: b.areaPct, mean: rgbToHex(b.mean), family: b.familyName })),
                [...shots.stableLabels, ...look.labels, ...extraLabels],
                message,
              ) + extra,
            schema: ASSIGN_SCHEMA,
            tag: "assign",
          },
          controller.signal,
          route,
        );
        if (!reply.ok) throw new Error(reply.error);
        return sanitizeAssign(reply.result, look.blobMap.blobs.length, paletteIds);
      };
      const todo = map.parts.map((_, p) => p).filter((p) => facesOf[p].length > 0).sort((a, b) => facesOf[b].length - facesOf[a].length);
      let modelArea = 0;
      for (let f = 0; f < areaWeights.length; f++) modelArea += areaWeights[f];
      let done = 0;
      setTidyBusy(t("tidy.busyAutoParts", { done, n: todo.length }));
      /**
       * What a part is shown: its own faces and the cells round them cut into blobs, numbered close-ups from the
       * views it shows best in (and its stretches), and its colour map.
       */
      const buildLook = (p: number): PartLook => {
        const part = map.parts[p];
        // Its own faces and the cells round its cells: the part map is rough (a lens in the hat's cells).
        const ownFaces = Int32Array.from(facesOf[p]);
        const near = new Uint8Array(cells.count);
        for (const c of part.cells) for (const d of cells.touching[c].keys()) near[d] = 1;
        const region: number[] = [];
        const seenParts = new Map<number, number>();
        for (let f = 0; f < partOfFace.length; f++) {
          if (partOfFace[f] !== p && !near[cells.cellOf[f]]) continue;
          region.push(f);
          if (partOfFace[f] !== p && partOfFace[f] >= 0) seenParts.set(partOfFace[f], (seenParts.get(partOfFace[f]) ?? 0) + 1);
        }
        const neighbours = [...seenParts].filter(([, n]) => n >= region.length * 0.02).sort((a, b) => b[1] - a[1]).map(([q]) => map.parts[q].name);
        const faces = Int32Array.from(region);
        const areaPct = context.shape?.parts[p]?.areaPct ?? 0;
        const blobMap = regionBlobs(faces, own, areaWeights, adjacencyFor(model), creasesFor(model).concavity, {
          coarse: 6,
          fine: 24,
          max: areaPct >= 6 ? 48 : 40,
          geometry: creasesFor(model).geometry,
          // A speck is small for the model (an eye's glint stays even in the head's big region).
          speckArea: modelArea * 0.00008,
        });
        parts.set(part.name, { index: p, map: blobMap, share: areaPct / 100 });
        const codes = new Int32Array(model.triangles.length).fill(-1);
        faces.forEach((f, i) => {
          codes[f] = blobMap.blobOf[i];
        });
        const poses = partCloseUps(ownFaces, areaPct >= 6 ? 3 : 2);
        // A part spread over the body (a coat with a bag on it) also gets nearer looks at its stretches:
        // its cells in a few groups close together, each looked at on its own (11-04: the bag's stripes were a few pixels).
        const tiles = partTiles(part.cells, ownFaces, cells);
        const overview = poses.length;
        for (const tile of tiles) poses.push(...partCloseUps(tile, 1));
        const [plain] = renderViews(positions, ownBuffer, [poses[0]], 560);
        // The numbered close-ups with everything not this part dimmed (the buffer is put back right after: nothing else draws in between).
        const dimmed: number[] = [];
        for (let f = 0; f < partOfFace.length; f++) if (partOfFace[f] !== p) dimmed.push(f);
        const kept = new Uint8Array(dimmed.length * FACE_BYTES);
        dimmed.forEach((f, i) => kept.set(ownBuffer.subarray(f * FACE_BYTES, (f + 1) * FACE_BYTES), i * FACE_BYTES));
        for (const f of dimmed)
          for (let k = 0; k < FACE_BYTES; k++) if (k % 4 !== 3) ownBuffer[f * FACE_BYTES + k] = linearToSrgbByte(SRGB_TO_LINEAR[ownBuffer[f * FACE_BYTES + k]] * 0.4);
        let numbered: ReturnType<typeof renderNumberedViews>;
        try {
          numbered = renderNumberedViews(positions, ownBuffer, codes, blobMap.blobs.length, poses, 720);
        } finally {
          dimmed.forEach((f, i) => ownBuffer.set(kept.subarray(i * FACE_BYTES, (i + 1) * FACE_BYTES), f * FACE_BYTES));
        }
        const labels = [
          `${part.name} 확대 — 원본 색`,
          ...numbered.shots.map((_, i) => (i < overview ? `${part.name} 확대 ${i + 1} — 덩어리 번호(원본 색 위)` : `${part.name} 부분 확대 ${i - overview + 1} — 덩어리 번호(원본 색 위)`)),
        ];
        // Its colour map: the part and the cells round it laid out flat, numbered (nothing hidden, small things full size).
        const sheet = numberedMapPicture(regionAtlas(model, faces, 1024), (i) => own[faces[i]], blobMap.blobOf, blobMap.blobs.length, (i) => partOfFace[faces[i]] !== p);
        labels.push(`${part.name} 색 지도 — 이 부위와 둘레의 겉면을 펼친 것(가려진 면 없음), 덩어리 번호(원본 색 위), 어두운 곳 = 둘레`);
        const look: PartLook = { p, blobMap, faces, poses, overview, images: [plain.dataUrl, ...numbered.shots.map((shot) => shot.dataUrl), sheet], labels, neighbours };
        looks.set(part.name, look);
        return look;
      };
      const lookAt = async (p: number) => {
        const part = map.parts[p];
        const setting = plan.parts.get(part.name);
        try {
          stopped();
          await yieldToUi();
          const look = buildLook(p);
          const ask = (check: string) => askPart(part.name, look, check);
          let got = await ask("");
          // Its own check: a blob light in the original given a far darker colour.  The bake's light only darkens —
          // a light face is that thing's own light colour far more often than shade (11-04 Tkc: a tan brim lip and a
          // bag's tan stripes went dark brown and black, "one part, one colour").  Those blobs are named back to it once.
          const regionShare = look.faces.length / Math.max(1, model.triangles.length);
          const doubtful = got.assign
            .flatMap((m) => m.blobs.map((id) => ({ id, to: byId.get(m.colour) })))
            .map(({ id, to }) => ({ id, to, blob: look.blobMap.blobs[id - 1] }))
            .filter((x) => x.blob && x.to && x.blob.areaPct * regionShare > 0.03 && rgbToLab(x.blob.mean).L - rgbToLab(hexToRgb(x.to.hex)).L > 30)
            .sort((a, b) => b.blob.areaPct - a.blob.areaPct)
            .slice(0, 6);
          if (doubtful.length) {
            const lines = doubtful.map((x) => `- B${x.id} (원본 ${rgbToHex(x.blob.mean)}, 밝기 ${Math.round(rgbToLab(x.blob.mean).L)}) → ${x.to?.id} ${x.to?.name} ${x.to?.hex} (밝기 ${Math.round(rgbToLab(hexToRgb(x.to?.hex ?? "#000000")).L)})`);
            const again = await ask(`

■ 점검 (네 첫 답을 앱이 확인함)
아래 덩어리는 원본에서 밝은데 훨씬 어두운 색을 골랐다. 구운 조명은 색을 어둡게 할 뿐 밝은 면을 새로 만들지 않는다 — 원본이 밝은 면은 보통 그 면의 진짜 색이 밝다(챙 밑면·가방 줄·테두리·단추). 사진을 다시 보고, 정말 그림자·같은 천이면 그대로, 따로 칠해진 면·무늬면 맞는 밝은 색으로 고쳐 assign 전체를 다시 낸다.
${lines.join("\n")}`).catch(() => null);
            if (again && again.assign.length) got = again;
          }
          answers.set(part.name, got.assign);
          if (got.observations[0]) notes.push(`${part.name}: ${got.observations[0]}`);
        } catch (err) {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
          // No answer for this part: its main colour all over (the crease snap still divides it from its neighbours) — or left as it is.
          const held = parts.get(part.name);
          if (held && setting) answers.set(part.name, [{ what: "", blobs: held.map.blobs.map((b) => b.id), colour: setting.main, mine: true }]);
          else parts.delete(part.name);
          notes.push(t("tidy.autoPartFailed", { part: part.name }));
        }
        done++;
        setTidyBusy(t("tidy.busyAutoParts", { done, n: todo.length }));
      };
      const queue = todo.slice();
      await Promise.all(
        Array.from({ length: Math.min(AUTO_PARALLEL, queue.length) }, async () => {
          for (let p = queue.shift(); p !== undefined; p = queue.shift()) await lookAt(p);
        }),
      );
      stopped();

      // All of it as one plan: the parts' colours, the holes, borders into the grooves, then a light bake.
      const pitsHex = plan.pits.map((m) => ({ ids: m.ids, into: byId.get(m.colour)?.hex ?? "" })).filter((m) => m.into);
      const assemble = (): TidyChanges => {
        const assign: NonNullable<TidyChanges["assign"]> = [];
        const detailHexes = new Set<string>();
        for (const [name, list] of answers) {
          const look = looks.get(name);
          for (const m of list) {
            const hex = byId.get(m.colour)?.hex;
            if (!hex) continue;
            assign.push({ part: name, blobs: m.blobs, colour: hex, what: m.what || undefined, ...(m.mine ? {} : { mine: false }) });
            // A small piece (an eye, a button, a stripe) is a detail: its colour stays through the speck clean-up.
            const share = look ? (m.blobs.reduce((total, id) => total + (look.blobMap.blobs[id - 1]?.areaPct ?? 0), 0) * look.faces.length) / Math.max(1, model.triangles.length) : 1;
            if (m.mine && share < 0.15) detailHexes.add(hex);
          }
        }
        // A pointed-at thing's colour stays through the speck clean-up.
        for (const m of marks) detailHexes.add(m.colour);
        return {
          assign,
          ...(marks.length ? { marks: marks.slice() } : {}),
          ...(pitsHex.length ? { pits: pitsHex } : {}),
          // No snapping to grooves: the blobs already end at folds and colour changes, and the snap ate thin things
          // the AI had named (11-04 Tkc: a bag's stripes, 1,186 of 1,201 faces kept without it, 254 with it).
          creaseSnap: 0,
          // Only real specks go (a flower's gold dot is a blob the AI placed, not a speck).
          minBlob: Math.max(20, Math.round(model.triangles.length * 0.00002)),
          smoothing: 2,
          trimTeeth: 2,
          lineSmooth: 16,
          ...(detailHexes.size ? { protect: [...detailHexes] } : {}),
        };
      };
      autoFocusRef.current = { triangles: model.triangles, partOfFace, parts };

      // 3. Passes 2 and 3 (the owner, 11-04: "한방에 뽑으려 하지 말고 1차 2차 3차 이렇게 여러 번"): the result so far
      // next to the original, the AI names what is still wrong, and only those parts are asked again — with their
      // close-ups in the colours they now have.  Stops as soon as a look finds nothing to fix.
      let wholeMap: FaceAtlas | null = null;
      for (let pass = 2; pass <= 1 + AUTO_REVIEWS; pass++) {
        stopped();
        setTidyBusy(t("tidy.busyReview", { pass }));
        await yieldToUi();
        const draft = planColours(model, assemble());
        if (!draft) break;
        const resultBuffer = buildColourBuffer(model.triangles.length, (i) => draft.next[i]);
        const views: ViewName[] = ["front", "back", "iso"];
        const viewName: Record<ViewName, string> = { front: "앞", back: "뒤", left: "왼쪽", right: "오른쪽", top: "위", iso: "사선" };
        // The whole result from three sides, and the front in four quarters up close — original | result side by side
        // (a bag's stripes are a few pixels in a whole view).
        const wholeShots = renderViews(positions, resultBuffer, views);
        const quarters = await sideBySideQuarters(ownBuffer, resultBuffer);
        // The whole surface laid out flat, original and result in the same layout: what went missing anywhere, the back too.
        wholeMap ??= atlasRef.current?.triangles === model.triangles ? atlasRef.current.atlas : buildFaceAtlas(model, adjacencyFor(model), faceGeometryFor(model), areaWeights, 2048);
        const maps = [mapPicture(wholeMap, (f) => own[f]), mapPicture(wholeMap, (f) => draft.next[f])];
        const resultShots = [...wholeShots, ...quarters, ...maps];
        const resultLabels = [
          ...views.map((v) => `${pass - 1}차 결과 ${viewName[v]}`),
          ...quarters.map((_, i) => `앞모습 ${["왼쪽 위", "오른쪽 위", "왼쪽 아래", "오른쪽 아래"][i]} 확대 — 왼쪽 원본 | 오른쪽 ${pass - 1}차 결과`),
          "색 지도(겉면 전체를 펼친 것) — 원본",
          `색 지도(같은 배치) — ${pass - 1}차 결과`,
        ];
        const reviewed = await aiAsk(
          {
            stable: tidyStablePrompt(context),
            stableImages: shots.stable,
            images: resultShots.map((shot) => (typeof shot === "string" ? shot : shot.dataUrl)),
            text: reviewPrompt(
              context,
              pass,
              map.parts.map((part) => ({ name: part.name, looks: plan.parts.get(part.name)?.looks ?? "" })),
              plan.palette,
              [...shots.stableLabels, ...resultLabels],
              message,
            ),
            schema: REVIEW_SCHEMA,
            tag: "review",
          },
          controller.signal,
          route,
        );
        if (!reviewed.ok) break;
        const problems = sanitizeReview(reviewed.result, [...looks.keys()]);
        if (problems.length === 0) {
          sys(t("tidy.reviewOk", { pass }));
          break;
        }
        sys(t("tidy.reviewLog", { pass, list: problems.map((m) => `${m.part}: ${m.problem}`).join(" · ") }));
        let fixed = 0;
        setTidyBusy(t("tidy.busyFix", { pass, done: fixed, n: problems.length }));
        const fixes = problems.slice();
        await Promise.all(
          Array.from({ length: Math.min(AUTO_PARALLEL, fixes.length) }, async () => {
            for (let m = fixes.shift(); m !== undefined; m = fixes.shift()) {
              const look = looks.get(m.part);
              if (!look) continue;
              await yieldToUi();
              // The thing to fix pointed at on the original (a grid on the pictures), and the face under the point found:
              // no blob numbers to misread (11-04: a brooch's dot fixed on the wrong blob three times over).
              const SIZE = 720;
              const poses = look.poses.slice(0, Math.min(2, look.poses.length));
              const originals = renderViews(positions, ownBuffer, poses, SIZE);
              const [now] = renderViews(positions, resultBuffer, [poses[0]], SIZE);
              const images = await Promise.all([...originals.map((shot) => withGrid(shot.dataUrl)), withGrid(now.dataUrl)]);
              const first = shots.stable.length + 1;
              const pick = poses.map((_, i) => first + i);
              const resultPicture = first + poses.length;
              const pictureLabels = [...poses.map((_, i) => `${m.part} 원본 확대 ${i + 1} — 격자`), `${m.part} 지금 결과(${pass - 1}차) — 사진 ${first}과 같은 각도, 격자`];
              const reply = await aiAsk(
                {
                  stable: tidyStablePrompt(context),
                  stableImages: shots.stable,
                  images,
                  text: pointPrompt(context, pass, m.part, map.subject, m.problem, plan.palette, pick, resultPicture, SIZE, [...shots.stableLabels, ...pictureLabels], message),
                  schema: POINT_SCHEMA,
                  tag: "point",
                },
                controller.signal,
                route,
              ).catch((err) => {
                if (controller.signal.aborted) throw err;
                return null;
              });
              if (reply?.ok) {
                const inRegion = new Uint8Array(model.triangles.length);
                for (const f of look.faces) inRegion[f] = 1;
                const idsOf = new Map<number, Int32Array>();
                for (const point of sanitizePoints(reply.result, [...pick, resultPicture], SIZE, paletteIds)) {
                  const poseIndex = point.picture === resultPicture ? 0 : point.picture - first;
                  let ids = idsOf.get(poseIndex);
                  if (!ids) idsOf.set(poseIndex, (ids = renderFaceIds(positions, poses[poseIndex], SIZE)));
                  const seed = seedUnderPoint(ids, SIZE, point.x, point.y, inRegion, ownLabOf(model), point.source);
                  const hex = byId.get(point.colour)?.hex;
                  if (seed >= 0 && hex) marks.push({ part: m.part, seed, colour: hex, what: point.what || undefined, ...(point.shaded ? { shaded: true } : {}) });
                }
              }
              fixed++;
              setTidyBusy(t("tidy.busyFix", { pass, done: fixed, n: problems.length }));
            }
          }),
        );
      }
      stopped();
      const sameMesh = modelRef.current !== null && modelRef.current.triangles === model.triangles && modelRef.current.triangleColors === model.triangleColors;
      const changes = assemble();
      const now = buildTidyContext() ?? context;
      Object.assign(now, { cellCount: context.cellCount, shape: context.shape, pits: context.pits });
      const lines = describeChanges(changes, now, t);
      const entry: TidyLogEntry = {
        id: `a${Date.now()}`,
        role: "ai",
        text: plan.reply || "…",
        at: at(),
        model: tidyModelName,
        scope,
        observations: [...plan.observations, ...notes].slice(0, 10),
        changes,
        lines,
        status: lines.length === 0 ? "none" : sameMesh ? "preview" : "suggested",
      };
      setTidyLog((prev) => [...prev, entry]);
      autoFocusByEntryRef.current.set(entry.id, autoFocusRef.current);
      if (lines.length > 0 && sameMesh) applyPlan(changes, entry.id, t("tidy.byAiPreview"), lines, []);
    } catch (err) {
      const stop = controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError");
      sys(stop ? t("tidy.stopped") : t("tidy.failed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTidyBusy(null);
      tidyAbortRef.current = null;
    }
  }

  /**
   * 🎯 One part up close: its cells and the cells round it, cut into blobs by the model's own colours
   * (few colours and many, shading merged where no groove is), numbered on close-ups for Claude, which
   * groups them into pieces by their shape and gives each one colour.  A preview, as every plan.
   */
  async function focusAsk(part: string, message?: string): Promise<void> {
    if (!model || !positions || tidyBusy !== null || busy !== null) return;
    const scope: TidyScope = "clean";
    const at = () => new Date().toISOString();
    const sys = (text: string) => setTidyLog((prev) => [...prev, { id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`, role: "sys", text, at: at(), model: tidyModelName, scope }]);
    const map = partMapFor(model);
    const cells = cellsFor(model);
    const index = map ? map.parts.findIndex((p) => p.name === part) : -1;
    if (!map || map.cells !== cells.count || index < 0) {
      sys(t("tidy.focusNoParts"));
      return;
    }
    const ask = message ?? t("tidy.focusAsk", { part });
    setTidyLog((prev) => [...prev, { id: `u${Date.now()}`, role: "user", text: ask, at: at(), model: tidyModelName, scope }]);
    const controller = new AbortController();
    tidyAbortRef.current = controller;
    try {
      setTidyBusy(t("tidy.busyBlobs", { part }));
      setFocusBusyPart(part);
      await yieldToUi();
      // The part's cells and the cells round them (the part map is rough at its edges).
      const own = new Uint8Array(cells.count);
      for (const c of map.parts[index].cells) own[c] = 1;
      const near = own.slice();
      for (const c of map.parts[index].cells) for (const d of cells.touching[c].keys()) near[d] = 1;
      const faces: number[] = [];
      const partFaces: number[] = [];
      for (let f = 0; f < cells.cellOf.length; f++) {
        if (near[cells.cellOf[f]]) faces.push(f);
        if (own[cells.cellOf[f]]) partFaces.push(f);
      }
      const regionFaces = Int32Array.from(faces);
      const blobMap = regionBlobs(regionFaces, ownColoursOf(model), areaWeights, adjacencyFor(model), creasesFor(model).concavity, { coarse: 6, fine: 24, max: 36, geometry: creasesFor(model).geometry });
      const mask = new Uint8Array(model.triangles.length);
      for (const f of regionFaces) mask[f] = 1;
      focusRef.current = { triangles: model.triangles, colours: model.triangleColors, part, map: blobMap, mask };
      // The close-ups: from the directions the part shows the most in.
      const [poseA, poseB = poseA] = partCloseUps(partFaces, 2);
      const ownBuffer = buildColourBuffer(model.triangles.length, (i) => ownColoursOf(model)[i]);
      const codes = new Int32Array(model.triangles.length).fill(-1);
      regionFaces.forEach((f, i) => {
        codes[f] = blobMap.blobOf[i];
      });
      setTidyBusy(t("tidy.busyShots"));
      await yieldToUi();
      const stableShots = takeTidyPictures("clean", false);
      const numbered = renderNumberedViews(positions, ownBuffer, codes, blobMap.blobs.length, [poseA, poseB], 720);
      const [plainOwn] = renderViews(positions, ownBuffer, [poseA], 560);
      const nowBuffer = paletteColours ?? sourceColours;
      const nowShot = nowBuffer ? renderViews(positions, nowBuffer, [poseA], 560)[0] : null;
      const images = [plainOwn.dataUrl, ...numbered.shots.map((shot) => shot.dataUrl), ...(nowShot ? [nowShot.dataUrl] : [])];
      const labels = [`${part} 확대 — 원본 색`, `${part} 확대 — 덩어리 번호(원본 색 위)`, `${part} 확대 35° 돌려서 — 덩어리 번호`, ...(nowShot ? [`${part} 확대 — 지금 결과(02 팔레트)`] : [])];
      if (controller.signal.aborted) throw new DOMException("stopped", "AbortError");
      const context = buildTidyContext();
      if (!context) return;
      context.cellCount = cells.count;
      context.shape = shapeContext(model, map, cells);
      context.focus = {
        part,
        blobs: blobMap.blobs.map((b) => ({ id: b.id, areaPct: b.areaPct, mean: rgbToHex(b.mean), family: b.familyName })),
      };
      setTidyBusy(t("tidy.busyThinking", { n: (stableShots?.stable.length ?? 0) + images.length }));
      const history = tidyLog.filter((entry) => entry.model === tidyModelName && entry.scope !== "export");
      const answer = await aiAsk(
        {
          stable: tidyStablePrompt(context),
          stableImages: stableShots?.stable ?? [],
          images,
          text: focusPrompt(context, history, ask, [...(stableShots?.stableLabels ?? []), ...labels]),
          schema: TIDY_SCHEMA,
          tag: "focus",
        },
        controller.signal,
        aiRoute ?? "local",
      );
      if (aiRoute === "key") setKeyUsage(loadKeyUsage());
      if (!answer.ok) throw new Error(answer.error);
      const raw = answer.result;
      const now = buildTidyContext() ?? context;
      Object.assign(now, { cellCount: context.cellCount, shape: context.shape, focus: context.focus });
      const sameMesh = modelRef.current !== null && modelRef.current.triangles === model.triangles && modelRef.current.triangleColors === model.triangleColors;
      const { changes, dropped } = sanitizeChanges(raw.changes, now, scope, t);
      delete changes.parts;
      // What no blob holds alone (a thin rim), pointed at on the pictures and caught along the original's borders.
      if (sameMesh && changes.fix?.length) await resolveFixes(changes, dropped, now, ask, controller.signal, aiRoute ?? "local");
      else delete changes.fix;
      const lines = describeChanges(changes, now, t);
      const entry: TidyLogEntry = {
        id: `a${Date.now()}`,
        role: "ai",
        text: String(raw.reply ?? "").trim() || "…",
        at: at(),
        model: tidyModelName,
        scope,
        observations: Array.isArray(raw.observations) ? raw.observations.map(String).filter(Boolean).slice(0, 6) : [],
        changes,
        lines,
        status: lines.length === 0 ? "none" : sameMesh ? "preview" : "suggested",
        dropped: dropped.length ? dropped : undefined,
      };
      setTidyLog((prev) => [...prev, entry]);
      if (focusRef.current) focusByEntryRef.current.set(entry.id, focusRef.current);
      if (lines.length > 0 && sameMesh) applyPlan(changes, entry.id, t("tidy.byAiPreview"), lines, dropped);
    } catch (err) {
      const stopped = controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError");
      sys(stopped ? t("tidy.stopped") : t("tidy.failed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTidyBusy(null);
      setFocusBusyPart(null);
      tidyAbortRef.current = null;
    }
  }

  /** Puts back the spectrum's cuts that went with these colours, if a change moved both. */
  function cutsBackWith(colours: RGB[]): void {
    const stored = cutsWithColours.current.get(colours);
    if (stored === undefined) return;
    setSettings((prev) => {
      const strips = { ...prev.stripByModel };
      if (stored) strips[stripKey] = stored;
      else delete strips[stripKey];
      return { ...prev, stripByModel: strips };
    });
  }

  function undoMerge(): void {
    const last = history[history.length - 1];
    if (!model || !last || last.length !== model.triangles.length) return;
    cutsBackWith(last);
    setFuture((prev) => [...prev.slice(-19), model.triangleColors]);
    setModel({ ...model, triangleColors: last, stats: { ...model.stats, uniqueFaceColors: countUniqueColours(last) } });
    setHistory((prev) => prev.slice(0, -1));
    dropUndo("colours");
    redoOrderRef.current = [...redoOrderRef.current, "colours"];
    setMergeReport(null);
    setStatus(t("status.undone", { n: history.length - 1 }));
  }

  function redo(): void {
    if (redoOrderRef.current[redoOrderRef.current.length - 1] === "mesh") return redoMesh();
    const next = future[future.length - 1];
    if (!model || !next || next.length !== model.triangles.length) return;
    redoOrderRef.current = redoOrderRef.current.slice(0, -1);
    cutsBackWith(next);
    setHistory((prev) => [...prev.slice(-19), model.triangleColors]);
    pushUndo("colours");
    setModel({ ...model, triangleColors: next, stats: { ...model.stats, uniqueFaceColors: countUniqueColours(next) } });
    setFuture((prev) => prev.slice(0, -1));
    setStatus(t("status.redone", { n: future.length - 1 }));
  }

  // ------------------------------------------------------------------
  // Feature D: export
  // ------------------------------------------------------------------
  /**
   * Picking a printer also fits the plan to it: the bed, no more slots than it
   * has tools, and no layer mixes when its slicer cannot print them.  What
   * changed is listed under the picker with one undo.
   */
  function choosePrinter(id: string): void {
    const next = findPrinter(id);
    const before = { export: settings.export, filaments: settings.filaments, mix: settings.mix };
    const takenBefore = { ...printerTakenRef.current };
    const changes: string[] = [];
    const exportNext = { ...settings.export, printerId: next.id, bedX: next.bed.x, bedY: next.bed.y };
    let filamentsNext = settings.filaments;
    let mixNext = settings.mix;
    if (next.bed.x !== settings.export.bedX || next.bed.y !== settings.export.bedY)
      changes.push(t("exp.printerChangedBed", { x: next.bed.x, y: next.bed.y }));
    if (next.kind === "fdm") {
      // What an earlier pick took away comes back once the printer allows it again.
      const taken = printerTakenRef.current;
      if (taken.count !== null && taken.count > settings.filaments.count && taken.count <= next.slots.max) {
        filamentsNext = { ...settings.filaments, count: taken.count };
        changes.push(t("exp.printerChangedSlots", { from: settings.filaments.count, to: taken.count }));
        taken.count = null;
      } else if (settings.filaments.count > next.slots.max) {
        filamentsNext = { ...settings.filaments, count: next.slots.max };
        changes.push(t("exp.printerChangedSlots", { from: settings.filaments.count, to: next.slots.max }));
        taken.count ??= settings.filaments.count;
      }
      if (taken.mixing && next.layerMixing && settings.mix.assignmentMode === "physical-only") {
        mixNext = { ...settings.mix, assignmentMode: "physical-and-virtual" };
        changes.push(t("exp.printerChangedMixingBack"));
        taken.mixing = false;
      } else if (!next.layerMixing && settings.mix.assignmentMode !== "physical-only") {
        mixNext = { ...settings.mix, assignmentMode: "physical-only" };
        changes.push(t("exp.printerChangedMixing"));
        taken.mixing = true;
      }
    }
    setSettings((prev) => ({ ...prev, export: exportNext, filaments: filamentsNext, mix: mixNext }));
    setPrinterNotice(
      changes.length > 0
        ? {
            changes,
            undo: () => {
              setSettings((prev) => ({ ...prev, ...before }));
              printerTakenRef.current = takenBefore;
              setPrinterNotice(null);
            },
          }
        : null,
    );
  }

  /**
   * Each face's group colour (as a number) right after the mesh was last cut
   * (a confirmed cut): the borders there were cut along their line then, and
   * are not cut again — whatever their colours have become since.  Undefined
   * before any cut.
   */
  function settledFaces(current: MeshModel): Int32Array | undefined {
    const base = settledRef.current.get(current.triangles);
    if (!base || base.length !== current.triangles.length * 3) return undefined;
    const known = settledKeysRef.current.get(base);
    if (known) return known;
    const keys = new Int32Array(current.triangles.length);
    for (let f = 0; f < keys.length; f++) keys[f] = (base[f * 3] << 16) | (base[f * 3 + 1] << 8) | base[f * 3 + 2];
    settledKeysRef.current.set(base, keys);
    return keys;
  }

  /**
   * `current` with `cut` made (worked out for `groups`).  A piece on its face's
   * own side keeps the face's colour; a piece on the other side takes that
   * group's colour.
   */
  function cutModelOf(current: MeshModel, cut: BorderCut, groups: Int32Array) {
    const mesh = meshWithCut(current.vertices, current.triangles, cut);
    const triangleColors: RGB[] = new Array(mesh.triangles.length);
    for (let i = 0; i < mesh.triangles.length; i++) {
      const p = mesh.piece[i];
      const from = mesh.originalFace[i];
      const group = p >= 0 ? cut.pieceGroups[p] : -1;
      triangleColors[i] = group >= 0 && group !== groups[from] ? (palette[group]?.rgb ?? current.triangleColors[from]) : current.triangleColors[from];
    }
    const model: MeshModel = {
      ...current,
      vertices: mesh.vertices,
      triangles: mesh.triangles,
      triangleColors,
      stats: { ...current.stats, vertexCount: mesh.vertices.length, triangleCount: mesh.triangles.length, uniqueFaceColors: countUniqueColours(triangleColors) },
    };
    return { model, mesh };
  }

  /**
   * The model as it goes out: with the faces along the borders cut along the
   * line when that is on — what the result view shows.
   */
  /**
   * The model as it goes out, and each of its faces' group (palette position) — what the
   * palette and print views show.  The export prints the group, never a face's own shade
   * matched again to the nearest palette colour: a shade sits in its group by the colour
   * strip, not by distance (11-04: the white clothes' grey shades — 5.5 % of the model —
   * would have printed as the face's tan).
   */
  async function exportFaces(current: MeshModel): Promise<{ model: MeshModel; groups: Int32Array }> {
    const cutModel = await modelForExport(current);
    let model = cutModel;
    let groups: Int32Array = labels;
    if (cutModel !== current) {
      const cut = exportCutRef.current;
      groups = new Int32Array(cutModel.triangles.length);
      if (cut) for (let i = 0; i < groups.length; i++) groups[i] = cut.piece[i] >= 0 ? cut.pieceGroups[cut.piece[i]] : labels[cut.originalFace[i]];
    }
    // Small holes closed (a shell left open is dropped by the slicer from every layer that crosses
    // its hole — 11-04: two hair locks cut flat 3 mm short): the new faces take the colour beside them.
    holesClosedRef.current = 0;
    if (settings.export.closeHoles) {
      const fill = fillSmallHoles(model.vertices, model.triangles);
      if (fill.triangles.length > 0) {
        const base = model;
        const more = new Int32Array(groups.length + fill.triangles.length);
        more.set(groups);
        for (let i = 0; i < fill.borders.length; i++) more[groups.length + i] = groups[fill.borders[i]];
        groups = more;
        const triangleColors = base.triangleColors.concat(Array.from(fill.borders, (f) => base.triangleColors[f]));
        model = {
          ...base,
          vertices: base.vertices.concat(fill.vertices),
          triangles: base.triangles.concat(fill.triangles),
          triangleColors,
          stats: { ...base.stats, vertexCount: base.vertices.length + fill.vertices.length, triangleCount: triangleColors.length },
        };
        holesClosedRef.current = fill.filled;
      }
    }
    return { model, groups };
  }
  /** Small holes the last export closed. */
  const holesClosedRef = useRef(0);
  /** The faces of the last cut export: their pieces and the faces they came from. */
  const exportCutRef = useRef<{ piece: Int32Array; originalFace: Int32Array; pieceGroups: Int32Array } | null>(null);
  /** The group colours of `groups`, for an export that maps colours to the palette: exact, so nothing moves. */
  function groupColours(groups: Int32Array, fallback: RGB[]): RGB[] {
    return Array.from(groups, (g, i) => palette[g]?.rgb ?? fallback[i]);
  }

  async function modelForExport(current: MeshModel): Promise<MeshModel> {
    exportCutRef.current = null;
    if (cutSpan <= 0 || palette.length === 0 || labels.length !== current.triangles.length) return current;
    let cut: BorderCut | null = null;
    for (let attempt = 0; attempt < 3 && !cut; attempt++) {
      try {
        cut = await cutBorders(current, labels, protectedPositions(), cutSpan, settledFaces(current), "export", cutFacesRef.current.get(current.triangles));
      } catch (err) {
        if (!(err instanceof CutSuperseded)) throw err;
      }
    }
    if (!cut || cut.replaced.length === 0) return current;
    const made = cutModelOf(current, cut, labels);
    exportCutRef.current = { piece: Int32Array.from(made.mesh.piece), originalFace: Int32Array.from(made.mesh.originalFace), pieceGroups: Int32Array.from(cut.pieceGroups) };
    return made.model;
  }

  /** The cut worked out for exactly what is shown now (null while it is being worked out). */
  const cutFresh = model && cutSpan > 0 && cutLayer && cutLayer.triangles === model.triangles && cutLayer.paletteKey === paletteKey && cutLayer.labels === labels ? cutLayer : null;
  /** The cut shown in the result view, ready to confirm. */
  const cutReady = Boolean(cutFresh && cutFresh.cut.replaced.length > 0);
  /** The notice stays only while it still says something true: closed once nothing is left to confirm. */
  const cutNoticeShown =
    Boolean(model) &&
    cutNotice !== null &&
    (cutNotice === "off" ? cutSpan <= 0 : cutNotice === "load" ? cutSpan > 0 && cutReady : cutSpan > 0 && !(cutFresh && !cutReady));
  /** A model just opened says what turning the cut on says (and only once there is something to confirm). */
  const cutNoticeText = cutNotice === "load" ? "on" : cutNotice;
  /** After a confirm with nothing repainted, what is left is only teeth trimmed off the confirmed line: said so. */
  const cutNoticeKey = cutNoticeText === "on" && cutFresh?.cut.trim ? "trim" : cutNoticeText;
  useEffect(() => {
    // Once up, it is the "on" notice: it stays while a recolour's cut is worked out again.
    if (cutNotice === "load" && cutReady) setCutNotice("on");
  }, [cutNotice, cutReady]);

  function toggleCut(on: boolean): void {
    patchSettings("export", { ...settings.export, cutSpan: on ? CUT_SPAN : 0, cutChosen: true });
    setCutNotice(on ? "on" : null);
  }

  /**
   * Confirm the cut shown: the model takes the cut faces for good (one undo
   * step), so each piece can be picked, recoloured and merged like any face.
   * Exactly the cut on screen — nothing is worked out again.
   */
  async function confirmCut(): Promise<void> {
    if (!model || busy !== null || tidyBusy !== null || pendingTidy || previewCuts || gapReview || strokeRef.current) return;
    const layer = cutLayer;
    if (!cutReady || !layer) {
      setStatus(t("status.cutNotReady"));
      return;
    }
    setBusy(t("busy.cutConfirm"));
    await yieldToUi();
    try {
      const started = performance.now();
      const before = model;
      const { cut } = layer;
      const { model: after, mesh } = cutModelOf(before, cut, labels);
      // What the faces' groups are right after: these are not cut again until they change.
      // And which faces a cut made (this one or an earlier one): the cut line itself, final.
      const settled = new Uint8Array(after.triangles.length * 3);
      const wasCut = cutFacesRef.current.get(before.triangles);
      const cutFaces = new Uint8Array(after.triangles.length);
      for (let i = 0; i < after.triangles.length; i++) {
        const p = mesh.piece[i];
        const rgb = palette[p >= 0 ? cut.pieceGroups[p] : labels[mesh.originalFace[i]]]?.rgb;
        if (rgb) settled.set(rgb, i * 3);
        cutFaces[i] = p >= 0 ? 1 : (wasCut?.[mesh.originalFace[i]] ?? 0);
      }
      settledRef.current.set(after.triangles, settled);
      cutFacesRef.current.set(after.triangles, cutFaces);
      cutLogRef.current.set(after.triangles, [
        ...(cutLogRef.current.get(before.triangles) ?? []),
        {
          faces: before.triangles.length,
          vertices: before.vertices.length,
          addedVertices: cut.addedVertices,
          pieces: cut.pieces,
          pieceGroups: cut.pieceGroups,
          pieceFaces: cut.pieceFaces,
          replaced: cut.replaced,
          settled: packRuns(settled),
        },
      ]);
      // The spectrum keeps its groups: its cuts are worked out again for the new areas.
      const weights = triangleAreaWeights(after);
      areaWeightsAhead.current.set(after.triangles, weights);
      const groupOfKey = new Map<number, string>();
      for (const group of committedGroups) for (const colour of group.colours) groupOfKey.set(colour.key, `${group.family}:${group.index}`);
      const strip = buildColourStrip(after.triangleColors, weights, pins);
      const stored = stripStore(targetGroups, cutsKeepingGroups(strip, groupOfKey), livePins(storedStrip?.pins, strip), storedStrip?.from);
      cutsWithColours.current.set(before.triangleColors, settings.stripByModel[stripKey] ?? null);
      cutsWithColours.current.set(after.triangleColors, stored);
      setSettings((prev) => ({ ...prev, stripByModel: { ...prev.stripByModel, [stripKey]: stored } }));
      const originalBefore = originalColoursRef.current;
      const originalAfter = originalBefore && originalBefore.length === before.triangles.length ? Array.from(mesh.originalFace, (f) => originalBefore[f]) : null;
      if (meshUndoRef.current.length >= MESH_UNDO_LIMIT) forgetOldestUndo("mesh");
      meshUndoRef.current = [...meshUndoRef.current.slice(-(MESH_UNDO_LIMIT - 1)), { before, after, originalBefore, originalAfter, shown: layer }];
      meshRedoRef.current = [];
      redoOrderRef.current = [];
      setFuture([]);
      pushUndo("mesh");
      swapGeometry(after, originalAfter);
      setCutNotice(null);
      setStatus(
        t("status.cutConfirmed", {
          faces: cut.replaced.length.toLocaleString(),
          pieces: cut.pieceGroups.length.toLocaleString(),
          total: after.triangles.length.toLocaleString(),
          ms: Math.round(performance.now() - started),
        }),
      );
    } catch (err) {
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  /**
   * The model's mesh changes (a cut confirmed, undone or redone).  Face numbers
   * stay (meshWithCut keeps them), but a cut face is pieces now: whatever was
   * picked, hovered or under way goes, and what was worked out per face is
   * worked out again.  The camera stays where it is.
   */
  function swapGeometry(next: MeshModel, original: RGB[] | null): void {
    adjacencyRef.current = null;
    atlasRef.current = null;
    faceGeometryRef.current = null;
    strokeRef.current = null;
    regrabRef.current = null;
    edgeRepickRef.current = null;
    hoverFaceRef.current = null;
    edgeSessionRef.current = null;
    tidyStableShotsRef.current = null;
    dragBuffers.current = [];
    setAtlas(null);
    setCutLayer(null);
    setGapReview(null);
    setHoverPatch(null);
    setMergeReport(null);
    setPendingTidy(null);
    clearPick();
    endToneSession();
    forgetTidyUndo();
    forgetRecipeUndo();
    originalColoursRef.current = original;
    setModel(next);
  }

  function undoMesh(): void {
    const step = meshUndoRef.current[meshUndoRef.current.length - 1];
    if (!model || !step || model.triangles !== step.after.triangles) return;
    meshUndoRef.current = meshUndoRef.current.slice(0, -1);
    meshRedoRef.current = [...meshRedoRef.current, { ...step, after: model }];
    redoOrderRef.current = [...redoOrderRef.current, "mesh"];
    dropUndo("mesh");
    cutsBackWith(step.before.triangleColors);
    swapGeometry(step.before, step.originalBefore);
    setCutLayer(step.shown);
    // The preview comes back looking just like the confirmed cut did: say so.
    if (cutSpan > 0) setCutNotice("undone");
    setStatus(t("status.cutUndone", { total: step.before.triangles.length.toLocaleString() }));
  }

  function redoMesh(): void {
    const step = meshRedoRef.current[meshRedoRef.current.length - 1];
    if (!model || !step || model.triangles !== step.before.triangles) return;
    meshRedoRef.current = meshRedoRef.current.slice(0, -1);
    redoOrderRef.current = redoOrderRef.current.slice(0, -1);
    meshUndoRef.current = [...meshUndoRef.current, step];
    pushUndo("mesh");
    cutsBackWith(step.after.triangleColors);
    swapGeometry(step.after, step.originalAfter);
    setCutNotice(null);
    setStatus(t("status.cutRedone", { total: step.after.triangles.length.toLocaleString() }));
  }

  async function exportColourFile(): Promise<void> {
    if (!model || palette.length === 0 || printer.kind !== "colour") return;
    const source = model;
    setExportOutcome(null);
    setBusy(t("busy.exporting"));
    await yieldToUi();
    try {
      const e = settings.export;
      const format = e.colourFormat && printer.formats.includes(e.colourFormat) ? e.colourFormat : printer.formats[0];
      const { model, groups } = await exportFaces(source);
      const { transform } = buildTransform(model, null, {
        coordinateMode: e.coordinateMode,
        scale: e.scale,
        targetHeight: e.targetHeight,
        putOnBed: e.putOnBed,
        centerOnBed: false,
        bedSource: "custom",
        customBedSize: { x: e.bedX, y: e.bedY },
        fallbackBedSize: { x: e.bedX, y: e.bedY },
        defaultExtruder: 1,
      });
      // Every face gets its palette colour exactly: the cleaned colours, not filament stand-ins.
      const faceColours = groupColours(groups, model.triangleColors);
      const result = await buildColourFile(format, {
        model,
        faceColours,
        transform,
        putOnBed: e.putOnBed,
        bedCentre: e.centerOnBed ? { x: e.bedX / 2, y: e.bedY / 2 } : null,
        baseName: (e.fileName.trim() || defaultFileName).replace(/\.(3mf|obj|zip|wrl|ply)$/i, ""),
      });
      setLastExport({ fileName: result.fileName, blob: result.blob, at: Date.now() });
      downloadBlob(result.fileName, result.blob);
      countAction(`export/${printer.id}`);
      const size = `${(result.blob.size / (1024 * 1024)).toFixed(1)} MB`;
      setExportOutcome({ kind: "ok", message: t("exp.outcomeOk", { file: result.fileName, size }), at: Date.now() });
      setStatus(t("status.colourExported", { file: result.fileName, colours: result.colourCount, faces: result.triangleCount.toLocaleString() }) + (holesClosedRef.current > 0 ? t("status.holesClosed", { n: holesClosedRef.current }) : ""));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Colour export failed", err);
      setExportOutcome({ kind: "error", message, at: Date.now() });
      setStatus(t("status.exportFailed", { message }));
    } finally {
      setBusy(null);
    }
  }

  async function export3mf(): Promise<void> {
    if (printer.kind === "colour") return exportColourFile();
    if (!model || !plan || palette.length === 0) return;
    const source = model;
    setExportOutcome(null);
    setBusy(t("busy.exporting"));
    await yieldToUi();
    try {
      const e = settings.export;
      const prusa = printer.slicer === "prusa";
      const { model, groups } = await exportFaces(source);
      const fileName = (e.fileName.trim() || defaultFileName).replace(/\.3mf$/i, "") + ".3mf";
      const result = await buildPrusa3mfBlob({
        slicer: printer.slicer,
        bambuPrinter: printer.bambuProject,
        fileName,
        templateArrayBuffer: template?.buffer ?? null,
        templateInfo: template?.info ?? null,
        model,
        // Each face in its group's colour exactly, matched with no accent rule: the group shown is the group printed.
        adjustedColors: groupColours(groups, model.triangleColors),
        palette,
        physicalSlots: slots,
        virtualPlan: plan,
        placement: {
          coordinateMode: e.coordinateMode,
          scale: e.scale,
          targetHeight: e.targetHeight,
          putOnBed: e.putOnBed,
          centerOnBed: e.centerOnBed,
          bedSource: "custom",
          customBedSize: { x: e.bedX, y: e.bedY },
          fallbackBedSize: { x: e.bedX, y: e.bedY },
          defaultExtruder: e.defaultExtruder,
        },
        accentProtection: "off",
        splitObjects: e.splitObjects,
        splitAsParts: e.splitAsParts,
        // PrusaSlicer's XL profiles and the template's config mean nothing to other slicers.
        printPreset: prusa ? e.printPreset : null,
        printPresetSupportWord: t("exp.supportPresetSuffix"),
        includePrinterConfig: prusa && e.includePrinterConfig && templateFitsPrinter(printer, template?.info.printerModel),
        effectiveRgbByPaletteIndex: effectiveByIndex,
        // A big model takes a while to write: the busy line counts it up, and the screen gets a turn between pieces.
        onProgress: async (fraction) => {
          setBusy(t("busy.exportingPct", { pct: Math.round(fraction * 100) }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
      });
      setLastExport({ fileName: result.fileName, blob: result.blob, at: Date.now() });
      downloadBlob(result.fileName, result.blob);
      countAction(`export/${printer.id}`);
      setExportOutcome({
        kind: "ok",
        message: t("exp.outcomeOk", { file: result.fileName, size: `${(result.blob.size / (1024 * 1024)).toFixed(1)} MB` }),
        at: Date.now(),
      });
      const renumbered =
        (result.summary.renumberedVirtuals.length > 0
          ? t("status.renumbered", { list: result.summary.renumberedVirtuals.map((r) => `VE${r.from}→VE${r.to}`).join(" ") })
          : "") +
        (result.summary.droppedVirtuals.length > 0
          ? t("status.droppedVirtuals", { list: result.summary.droppedVirtuals.map((id) => `VE${id}`).join(" ") })
          : "");
      setStatus(
        t("status.exported", {
          file: result.fileName,
          physical: result.summary.physicalExtruderCount,
          virtual: result.summary.virtualCount,
          ids: result.summary.virtualIds.join(", ") || "-",
          renumbered,
          config: (result.summary.printerConfigIncluded ? t("status.configIncluded") : t("status.configOmitted")) + (holesClosedRef.current > 0 ? t("status.holesClosed", { n: holesClosedRef.current }) : ""),
          objects: result.summary.partCount > result.summary.objectCount ? t("status.exportedParts", { objects: result.summary.objectCount, parts: result.summary.partCount }) : t("status.exportedObjects", { objects: result.summary.objectCount }),
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("3MF export failed", err);
      setExportOutcome({ kind: "error", message, at: Date.now() });
      setStatus(t("status.exportFailed", { message }));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Feature C: Nomad
  // ------------------------------------------------------------------
  function nomadExport(): void {
    if (!model || palette.length === 0) return;
    try {
      const result = buildNomadObj(model, model.triangleColors, palette.map((entry) => entry.rgb), model.name);
      downloadText(result.fileName, result.obj);
      countAction("export/nomad");
      setNomadReport({
        message: t("nomad.exported", { file: result.fileName, colours: result.colourCount, vertices: result.vertexCount.toLocaleString(), faces: result.faceCount.toLocaleString() }),
        warnings: [],
      });
      setStatus(t("status.nomadExported", { file: result.fileName }));
    } catch (err) {
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    }
  }

  async function nomadImport(file: File): Promise<void> {
    setBusy(t("busy.readingNomad"));
    await yieldToUi();
    try {
      const parsed = parseNomadObj(await file.text());
      const paletteRgb = palette.map((entry) => entry.rgb);
      const result = applyNomadObjToModel(model, parsed, paletteRgb, file.name);
      if (result.mode === "colours-only" && model) {
        // Colours snapped to the palette come in as the palette's own colours (each group keeps its colour).
        const next = result.model.triangleColors;
        keepGroupsFor(model.triangleColors, next);
        applyColours(model, next);
      } else {
        installModel(
          result.model,
          { kind: "nomad", fileName: file.name, uniqueColours: result.colourCount },
          { file, kind: "nomad", palette: paletteRgb.length > 0 ? paletteRgb : (parsed.paletteHint ?? []) },
        );
      }
      const message = t("nomad.applied", {
        mode: result.mode === "colours-only" ? t("nomad.coloursOnly") : t("nomad.fullReload"),
        colours: result.colourCount,
        off: result.snap.offPaletteVertexCount.toLocaleString(),
        max: result.snap.maxDeltaE.toFixed(1),
      });
      // The core's warnings are English: say the ones it names in the UI's language.
      const before = model ? { vertices: model.vertices.length, faces: model.triangles.length } : null;
      const remeshed = before ? nomadRemeshWarning(before, { vertices: parsed.vertices.length, faces: parsed.triangles.length }) : null;
      const warnings = result.warnings.map((warning) =>
        warning === NOMAD_OFF_PALETTE_WARNING
          ? t("nomad.warnOffPalette")
          : warning === NOMAD_NEW_MODEL_WARNING
            ? t("nomad.warnNewModel")
            : before && warning === remeshed
              ? t("nomad.warnRemeshed", { a: before.vertices, b: before.faces, c: parsed.vertices.length, d: parsed.triangles.length })
              : warning,
      );
      setNomadReport({ message, warnings });
      setStatus(warnings[0] ? `${message} · ${warnings[0]}` : message);
    } catch (err) {
      setNomadReport({ message: t("status.error", { message: err instanceof Error ? err.message : String(err) }), warnings: [] });
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Settings file
  // ------------------------------------------------------------------
  function saveSettingsFile(): void {
    downloadTextFile("rodin-pipeline-settings.json", settingsToJson(settings));
    setStatus(t("status.settingsSaved"));
  }
  async function loadSettingsFile(file: File): Promise<void> {
    try {
      setSettings(mergeSettings(JSON.parse(await file.text())));
      setStatus(t("status.settingsLoaded", { name: file.name }));
    } catch (err) {
      setStatus(t("status.settingsFileError", { message: err instanceof Error ? err.message : String(err) }));
    }
  }

  /**
   * Drags one of the splitters: `move` gets how far the pointer has gone
   * (px, along x or y) and sets the size; `done` runs once on release.
   */
  function dragSplitter(event: ReactPointerEvent<HTMLDivElement>, which: "left" | "right" | "matrix", move: (delta: number) => void, done: () => void): void {
    event.preventDefault();
    const start = which === "matrix" ? event.clientY : event.clientX;
    setSplitterDragging(which);
    const onMove = (pointer: PointerEvent) => move((which === "matrix" ? pointer.clientY : pointer.clientX) - start);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSplitterDragging(null);
      done();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** The left panel grows as its splitter goes right; the 3D view keeps at least 360 px. */
  function startSplitterDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const startWidth = sidebarWidth;
    const most = Math.max(LEFT_MIN, Math.min(Math.round(window.innerWidth * 0.6), window.innerWidth - (rightPanel ? rightWidth + 5 : 0) - 370));
    dragSplitter(
      event,
      "left",
      (delta) => setSidebarWidth(Math.max(LEFT_MIN, Math.min(most, startWidth + delta))),
      () =>
        setSidebarWidth((width) => {
          try {
            window.localStorage.setItem("rodin-pipeline-left-width", String(width));
          } catch {
            // ignore
          }
          return width;
        }),
    );
  }

  /** The right panel grows as its splitter goes left; the 3D view keeps at least 360 px. */
  function startRightDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const startWidth = rightWidth;
    const most = Math.max(RIGHT_MIN, Math.min(Math.round(window.innerWidth * 0.5), window.innerWidth - sidebarWidth - 370));
    dragSplitter(
      event,
      "right",
      (delta) => setRightWidths((widths) => ({ ...widths, [rightKey]: Math.max(RIGHT_MIN, Math.min(most, startWidth - delta)) })),
      () =>
        setRightWidths((widths) => {
          storeSize("rodin-pipeline-right-width", widths);
          return widths;
        }),
    );
  }

  function resetRightWidth(): void {
    setRightWidths((widths) => {
      const { [rightKey]: _reset, ...rest } = widths;
      storeSize("rodin-pipeline-right-width", rest);
      return rest;
    });
  }

  /** The mapping matrix grows as its splitter goes up; the table keeps 140 px and the 3D view 220 px. */
  function startMatrixDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const stage = stageRef.current;
    const height = stage?.getBoundingClientRect().height ?? 0;
    const viewers = stage?.querySelector(".viewers")?.getBoundingClientRect().height ?? 0;
    const table = stage?.querySelector(".matrix")?.getBoundingClientRect().height ?? 0;
    if (height <= 0) return;
    // the toolbar, this splitter and the tool dock keep their height
    const fixed = height - viewers - table;
    const startShare = matrixShare;
    const least = Math.min(0.4, 140 / height);
    const most = Math.max(least, (height - fixed - 220) / height);
    dragSplitter(
      event,
      "matrix",
      (delta) => setMatrixShare(Math.max(least, Math.min(most, startShare - delta / height))),
      () =>
        setMatrixShare((share) => {
          storeSize("rodin-pipeline-matrix-share", share);
          return share;
        }),
    );
  }

  const isBusy = busy !== null;
  // First-time hints, each once in this browser: the order of the steps on the first visit, then a step's job
  // the first time 02–04 opens.  Never over the intro, a dialog or work in progress; after that only the guide button.
  useEffect(() => {
    if (guideMode || intro || about || gatherOpen || isBusy) return;
    const hint = dueHint(step);
    if (hint === null) return;
    const timer = window.setTimeout(() => {
      // The step on screen at the welcome is not one being entered: its own hint is not owed.
      markHintsSeen(hint === "welcome" ? ["welcome", step] : [hint]);
      setGuideMode({ kind: "hint", hint });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [step, guideMode, intro, about, gatherOpen, isBusy]);
  // While the app works the pointer is "working", not "not allowed" over the buttons it waits with.
  useEffect(() => {
    document.body.classList.toggle("is-busy", isBusy);
  }, [isBusy]);
  const canFillPick =
    !isBusy && pickedPatches.length > 0 && Boolean(pickTarget) && !(pickTarget !== "__new__" && pickedHexes.length === 1 && pickTarget === pickedHexes[0]);
  fillPickRef.current = canFillPick ? applyPickColour : null;
  /** Colours chosen on the spectrum or in the table that the model has: the gap clean takes them too. */
  const gapChosenHexes = selectedHexes.filter((hex) => positionByHex.has(hex));
  const gapHexes = [...new Set([...pickedPatches.map((patch) => patch.hex), ...gapChosenHexes])];
  const canRunGap =
    !isBusy &&
    model !== null &&
    gapReview === null &&
    (gapScope === "all" || (gapScope === "picked" ? pickedPatches.length > 0 || shownHex !== null || gapChosenHexes.length > 0 : gapHexes.length >= 2));
  gapRunRef.current = canRunGap ? () => void runGap() : null;
  const setRecipeOverride = (paletteIndex: number, counts: Record<number, number> | null) => {
    setSettings((prev) => {
      const next = { ...prev.recipeOverrides };
      if (counts === null) delete next[String(paletteIndex)];
      else next[String(paletteIndex)] = { counts };
      return { ...prev, recipeOverrides: next };
    });
  };
  const setManualPhysical = (paletteIndex: number, extruder: number | null) => {
    setSettings((prev) => {
      const next = { ...prev.manualPhysical };
      if (extruder === null) delete next[String(paletteIndex)];
      else next[String(paletteIndex)] = extruder;
      return { ...prev, manualPhysical: next };
    });
  };
  function changeStep(next: number): void {
    if (next >= 3) {
      setBrushMode(false);
      setFillMode(false);
      setEyedropper(false);
    }
    setStep(next);
  }
  const viewerCommon = (slot: number, visible = true) => ({
    view,
    fitNonce,
    // A hidden view gets no highlights: building them is the slow part.
    overlays: visible ? overlays : NO_OVERLAYS,
    focus: visible ? focus : NO_FOCUS,
    callouts: visible ? callouts : NO_CALLOUTS,
    flat: paneLook.flat[slot === 0 ? 0 : 1],
    formLines: formLines && paneLook.flat[slot === 0 ? 0 : 1],
    softEdges: paneLook.soft[slot === 0 ? 0 : 1],
    cornerVertex,
    brush: brushMode,
    eyedropper,
    hand,
    background,
    // The welcome card (already played by the intro) in the first pane, once the intro has gone (two cards at
    // once read as a double); a second pane (side by side) just says what comes there.
    emptyLabel:
      slot === 0
        ? intro
          ? ""
          : (
            <Welcome
              hint={t("view.empty")}
              what={t("brand.what")}
              still
              action={
                <button type="button" className="guide-welcome" onClick={() => setGuideMode({ kind: "guide" })}>
                  <GyupaFaceIcon size={20} />
                  {t("guide.welcome")}
                </button>
              }
            />
          )
        : t("view.empty"),
    onPick: (face: number | null, info: PickInfo) => void handlePick(face, info),
    onHoverFace: hoverFace,
    onHoverHit: hoverHit3D,
    onBrushHover: brushHover3D,
    onBrushStart: (hit: ViewerHit | null) => brushStart3D(hit, slot),
    onBrushDrag: (hit: ViewerHit | null) => brushDrag3D(hit, slot),
    onBrushEnd: endStroke,
  });
  const autosaveLabel = !settings.rememberWork
    ? t("autosave.off")
    : autosave.state === "saving"
      ? t("autosave.saving")
      : autosave.state === "failed"
        ? t("autosave.failed")
        : autosave.state === "saved"
          ? t("autosave.saved", {
              time: new Date(autosave.at ?? Date.now()).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-GB", { hour: "2-digit", minute: "2-digit" }),
            })
          : "";
  const modeLabel: Record<PreviewMode, string> = { source: t("view.source"), palette: t("view.palette"), print: t("view.print") };
  const viewLabels: Array<[ViewName, string]> = [
    ["front", t("view.front")],
    ["back", t("view.back")],
    ["left", t("view.left")],
    ["right", t("view.right")],
    ["top", t("view.top")],
    ["iso", t("view.iso")],
  ];

  const stepInfo = [
    { id: 1, label: t("steps.load"), done: Boolean(model) },
    { id: 2, label: t("steps.colours"), count: palette.length > 0 ? t("steps.colourCount", { n: palette.length }) : undefined, done: Boolean(model) && step > 2 },
    { id: 3, label: t("steps.mix"), count: t("steps.slotCount", { n: slots.length }), done: Boolean(plan) && step > 3 },
    { id: 4, label: t("steps.export") },
  ];
  const saveDot = !settings.rememberWork ? "off" : autosave.state === "failed" ? "failed" : autosave.state === "saving" ? "saving" : "";
  // Steps 01–02 compare the original with the result; 03–04 show one view.
  const compareStep = step <= 2;
  const showSource = compareStep && compare !== "result";
  const showResult = !compareStep || compare !== "source";
  const compareBoth = showSource && showResult;
  /** Flat / soft for one side only, beside its label, while both sides show. */
  const paneTools = (pane: 0 | 1) =>
    compareBoth ? (
      <span className="pane-tools">
        <button
          type="button"
          className="icon-btn tiny"
          aria-pressed={paneLook.flat[pane]}
          aria-label={`${t("view.flat")} (${t(pane === 0 ? "view.paneLeft" : "view.paneRight")})`}
          title={`${t("view.flat")} — ${t("view.paneOnly")}`}
          onClick={() => setPaneLook("flat", pane, !paneLook.flat[pane])}
        >
          <Icon name="flat" size={12} stroke={1.4} />
        </button>
        <button
          type="button"
          className="icon-btn tiny"
          aria-pressed={paneLook.soft[pane]}
          aria-label={`${t("view.soft")} (${t(pane === 0 ? "view.paneLeft" : "view.paneRight")})`}
          title={`${t("view.soft")} — ${t("view.paneOnly")}`}
          onClick={() => setPaneLook("soft", pane, !paneLook.soft[pane])}
        >
          <Icon name="soft" size={12} stroke={1.4} />
        </button>
      </span>
    ) : undefined;
  const resultMode: PreviewMode = compareStep ? (previewMode === "source" ? "palette" : previewMode) : step === 4 ? "print" : singleMode;
  // The colour map paints what the result view shows (it used to show the faces' own colours, like the original view).
  mapLookRef.current = { palette, labels, mode: resultMode, effective: effectiveByIndex };
  useEffect(() => {
    setColoursVersion((v) => v + 1);
  }, [palette, labels, resultMode, effectiveByIndex]);
  /**
   * The cut pieces for the result view.  Right after a change the last cut
   * still stands where the faces kept their groups (the new one follows a
   * moment later), so the line does not flicker back to the faces.
   */
  const viewerCut = useMemo<ViewerCut | null>(() => {
    if (!model || !cutNow || resultMode === "source") return null;
    const { cut, group: pieceGroup } = cutNow;
    const vertexCount = model.vertices.length;
    const kept: number[] = [];
    const keptGroup: number[] = [];
    for (let p = 0; p < pieceGroup.length; p++) {
      if (!palette[pieceGroup[p]]) continue;
      kept.push(p);
      keptGroup.push(pieceGroup[p]);
    }
    const colourOf = (position: number): RGB => {
      const entry = palette[position];
      return (resultMode === "print" && effectiveByIndex.get(entry.index)) || entry.rgb;
    };
    const points = new Float32Array(kept.length * 9);
    // A colour buffer, as the model's (sRGB RGBA bytes).
    const colours = new Uint8Array(kept.length * FACE_BYTES);
    const parentFace = new Int32Array(kept.length);
    const corners = new Int32Array(kept.length * 3);
    kept.forEach((p, i) => {
      const rgb = colourOf(keptGroup[i]);
      for (let k = 0; k < 3; k++) {
        const v = cut.pieces[p * 3 + k];
        const o = i * 9 + k * 3;
        const c = i * FACE_BYTES + k * 4;
        corners[i * 3 + k] = v;
        if (v < vertexCount) {
          const point = model.vertices[v];
          points[o] = point[0];
          points[o + 1] = point[1];
          points[o + 2] = point[2];
        } else {
          const a = (v - vertexCount) * 3;
          points[o] = cut.addedVertices[a];
          points[o + 1] = cut.addedVertices[a + 1];
          points[o + 2] = cut.addedVertices[a + 2];
        }
        colours[c] = rgb[0];
        colours[c + 1] = rgb[1];
        colours[c + 2] = rgb[2];
        colours[c + 3] = 255;
      }
      parentFace[i] = cut.pieceFaces[p];
    });
    return { positions: toViewSpace(points), colours, parentFace, corners, group: Int32Array.from(keptGroup) };
  }, [model, cutNow, resultMode, palette, effectiveByIndex, toViewSpace]);
  const paneCount = (showSource ? 1 : 0) + (showResult ? 1 : 0) + (showMap ? 1 : 0);
  // A chip about the 3D view keeps off the colour map (the last column).
  const chipStyle: CSSProperties | undefined = showMap && paneCount > 1 ? { right: `calc(${100 / paneCount}% + 12px)` } : undefined;
  const dragging = previewCuts !== null;
  const showDock = Boolean(model) && compareStep;
  const rightPanel = step >= 2;
  const rightKey = step === 2 ? "2" : "34";
  const rightWidth = rightWidths[rightKey] ?? rightDefault(rightKey);
  // The two that look at the mesh first; every fixed turn is named by the face it puts down.
  const faceDownLabel: Partial<Record<PipelineSettings["export"]["coordinateMode"], string>> = {
    "stand-up": t("exp.coordStandUp"),
    auto: t("exp.coordAuto"),
  };
  const layerChoices = [...new Set([0.1, 0.15, 0.2, 0.25, ...(layerHeightMm ? [layerHeightMm] : [])])].sort((a, b) => a - b);

  // Step 03's side panels do not depend on hover; building them only when
  // their data changes keeps a mouse-over from re-rendering them.  Their
  // callbacks all go through functional state updates, so they never act on a
  // stale value.
  const mixPanels = useMemo(
    () => (
                <FilamentSection
                  settings={settings.filaments}
                  onChange={changeFilaments}
                  palette={palette}
                  list={settings.filamentList}
                  onListChange={(next) => patchSettings("filamentList", next)}
                  mix={settings.mix}
                  currentSlots={slots}
                  shareBySlot={shareBySlot}
                >
                  <MixSection
                    settings={settings.mix}
                    onChange={(next) => patchSettings("mix", next)}
                    palette={palette}
                    slots={slots}
                    layerHeight={layerHeightMm}
                    fidelity={finalCheck?.fidelity ?? null}
                    longestCycle={matrixSummary.longestCycle}
                    highlight={tidyHighlight}
                    mixingBlockedBy={printer.kind === "fdm" && !printer.layerMixing ? printer.name || printer.app : null}
                  />
                </FilamentSection>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, settings.filaments, palette, settings.filamentList, settings.mix, slots, shareBySlot, layerHeightMm, finalCheck?.fidelity, matrixSummary.longestCycle, tidyHighlight, t, printer],
  );
  const recipePanel = useMemo(
    () => (
              <RecipeDetail
                row={mixRow}
                plan={plan}
                basePlan={basePlan}
                slots={slots}
                settings={settings.mix}
                layerHeight={layerHeightMm}
                recipeOverrides={settings.recipeOverrides}
                onRecipeOverride={setRecipeOverride}
                manualPhysical={settings.manualPhysical}
                onManualPhysical={setManualPhysical}
                onRemember={(indices) => mixRow && rememberRecipe("recipe", mixRow.paletteIndex, indices)}
                undo={mixRow ? recipeUndoFor("recipe", mixRow.paletteIndex) : null}
                onLayerPreview={() => changeStep(4)}
                headerRef={(element) => {
                  linkCardRef.current = element;
                }}
              />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mixRow, plan, basePlan, slots, settings.mix, layerHeightMm, settings.recipeOverrides, settings.manualPhysical, recipeSteps, t],
  );

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
    <div className="app">
      <header className="topbar">
        <Brand />
        {model && sourceInfo && (
          <div className="file-chip" title={sourceInfo.fileName}>
            <b>{sourceInfo.fileName}</b>
            <span className="mono">{t("top.faces", { n: model.triangles.length.toLocaleString() })}</span>
            <span className={`save-dot ${saveDot}`} aria-hidden="true" />
            <span className="save-text">{autosaveLabel}</span>
            <button type="button" className="chip-btn save-file" disabled={isBusy || workFileSave === "saving"} title={t("load.saveWorkHint")} onClick={() => void saveWorkFile()}>
              <Icon name="download" size={12} stroke={1.6} />
              <span>{workFileSave === "saving" ? t("load.saving") : workFileSave === "saved" ? t("load.saved") : t("top.saveWork")}</span>
            </button>
          </div>
        )}
        <StepNav steps={stepInfo} current={step} onChange={changeStep} />
        <div className="top-actions">
          {/* how many steps ⌘Z can still take back (colour changes and strip cuts), and ⇧⌘Z bring again */}
          <button type="button" className="icon-btn with-count" data-guide="undo" aria-label={t("app.undo")} title={`${t("top.undo")} · ${t("top.stepsLeft", { n: history.length + stripUndo.length + meshUndoRef.current.length })}`} disabled={isBusy || tidyBusy !== null || (history.length === 0 && stripUndo.length === 0 && meshUndoRef.current.length === 0)} onClick={undoAny}>
            <Icon name="undo" />
            {history.length + stripUndo.length + meshUndoRef.current.length > 0 && <span className="step-count mono">{history.length + stripUndo.length + meshUndoRef.current.length}</span>}
          </button>
          <button type="button" className="icon-btn with-count" aria-label={t("app.redo")} title={`${t("top.redo")} · ${t("top.stepsLeft", { n: future.length + meshRedoRef.current.length })}`} disabled={isBusy || tidyBusy !== null || (future.length === 0 && meshRedoRef.current.length === 0)} onClick={redo}>
            <Icon name="redo" />
            {future.length > 0 && <span className="step-count mono">{future.length}</span>}
          </button>
          <span className="top-sep" aria-hidden="true" />
          <button type="button" className="guide-btn" data-guide="guide" title={t("guide.openHint")} onClick={() => setGuideMode({ kind: "guide" })}>
            <GyupaFaceIcon size={18} />
            <span>{t("guide.open")}</span>
          </button>
          <Menu trigger={<Icon name="help" />} label={t("top.glossary")} title={t("top.glossary")} className="glossary" guide="glossary">
            <Glossary />
          </Menu>
          <Menu trigger={<Icon name="settings" />} label={t("top.settings")} title={t("top.settings")} guide="settings">
            {(close) => (
              <>
                <div className="menu-label">{t("top.settings")}</div>
                <button type="button" className="menu-item" onClick={() => {
                    const next = lang === "ko" ? "en" : "ko";
                    setLang(next);
                    // What the status line said is in the old language: say what just happened in the new one.
                    setStatus(translate(next, "status.langChanged"));
                    close();
                  }}>
                  <span>{t("app.language")}</span>
                  <span className="menu-key">{lang === "ko" ? "KO" : "EN"}</span>
                </button>
                <div className="menu-sep" />
                <button type="button" className="menu-item" onClick={() => { saveSettingsFile(); close(); }}>
                  {t("app.saveSettings")}
                </button>
                <label className="menu-item">
                  {t("app.loadSettings")}
                  <input
                    type="file"
                    accept=".json,application/json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void loadSettingsFile(file);
                      e.target.value = "";
                      close();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setSettings(structuredClone(DEFAULT_SETTINGS));
                    setStatus(t("status.settingsReset"));
                    close();
                  }}
                >
                  {t("app.defaults")}
                </button>
                <div className="menu-sep" />
                <button type="button" className="menu-item" onClick={() => { setAbout(true); close(); }}>
                  {t("app.about")}
                </button>
                {supportLinks(lang).map((link) => (
                  <a key={link.id} className="menu-item" href={link.href} target="_blank" rel="noopener noreferrer" onClick={close}>
                    <span>{t(link.id === "toonation" ? "support.toonation" : "support.paypal")}</span>
                    <Icon name="heart" size={13} />
                  </a>
                ))}
                <div className="menu-note">
                  {t("app.subtitle")} · {t("top.version", { v: APP_VERSION })}
                </div>
              </>
            )}
          </Menu>
          {step !== 4 && (
            <button type="button" className="export-btn" disabled={!plan} title={t("top.exportGo")} onClick={() => changeStep(4)}>
              <Icon name="download" size={14} stroke={1.7} />
              {t("top.export")}
            </button>
          )}
        </div>
      </header>

      <div ref={mainRef} className={`main${rightPanel ? "" : " no-right"}`} style={{ "--left-w": `${sidebarWidth}px`, "--right-w": `${rightWidth}px` } as CSSProperties}>
        <aside className="sidebar" aria-label={stepInfo[step - 1].label}>
          <div className="sidebar-scroll">
            {step === 1 && (
              <>
              <LoadSection
                model={model}
                sourceInfo={sourceInfo}
                busy={isBusy}
                onModelFile={(file) => void onModelFile(file)}
                templateInfo={template?.info ?? null}
                onTemplateFile={(file) => void onTemplateFile(file)}
                onClearTemplate={clearTemplate}
                palette={palette}
                rememberTemplate={settings.rememberTemplate}
                onRememberTemplate={(next) => patchSettings("rememberTemplate", next)}
                rememberWork={settings.rememberWork}
                onRememberWork={(next) => patchSettings("rememberWork", next)}
                workState={model ? { restored: workRestored, undoSteps: history.length, changed: coloursChanged } : null}
                onClearWork={clearWork}
                onSaveWork={() => void saveWorkFile()}
                saveState={workFileSave}
                onRevertOriginal={revertToOriginal}
                workStore={storageMode === "folder" ? "folder" : storageKept === true ? "kept" : storageKept === false ? "notKept" : "browser"}
                onRecolour={recolourPaletteColour}
                onOpenGather={() => setGatherOpen(true)}
              />
              </>
            )}
            {/* The target colour count first: the strip and the 🤖 AI flat paint both keep within it. */}
            {step === 2 && model && (
              <TargetSection
                strip={stripData}
                targetGroups={targetGroups}
                onTargetChange={(n) => patchSettings("palette", { ...settings.palette, maxColours: Math.max(2, Math.min(64, n)) })}
                busy={isBusy}
                highlight={tidyHighlight}
              />
            )}
            {(step === 2 || step === 3) && model && (
              <TidyPanel
                scope={tidyScope}
                onScope={setTidyScope}
                area={tidyArea}
                onArea={setTidyArea}
                pickedCount={pickedPatches.length}
                previewPreset={previewTidyPreset}
                onPreset={tidyPreset}
                result={tidyResult}
                onUndo={undoTidy}
                undoCount={tidyUndoCount}
                highlight={tidyHighlight !== null}
                onHideHighlight={() => setTidyHighlight(null)}
                ai={aiAvailable}
                consult={WITH_CLAUDE}
                log={tidyLog.filter((entry) => entry.model === tidyModelName && entry.scope !== "export")}
                busy={tidyBusy}
                elapsed={tidyElapsed}
                onSend={(message, images) => void tidyAsk(message, false, false, undefined, { images })}
                onAnalyse={() => void tidyAsk(t("tidy.analyseMessage"), true)}
                onStop={() => tidyAbortRef.current?.abort()}
                onApplySuggestion={applyTidySuggestion}
                onConsultPreset={tidyConsultPreset}
                onApplyPreview={acceptPreview}
                onCancelEntry={cancelEntry}
                canCancel={canCancelEntry}
                onAuto={() => void (tidyScope === "mix" ? tidyAsk(t("tidy.mixAutoAsk"), false) : autoTidy(t("tidy.autoAsk")))}
                parts={partsShown}
                partView={partView}
                onPartView={setPartView}
                onRedoParts={() => void tidyAsk(t("tidy.partsRedo"), false, false, "clean", { reshapeOnly: true })}
                onFocusPart={(part) => void focusAsk(part)}
                focusBusy={focusBusyPart}
                connection={aiConnection}
                disabled={isBusy}
              />
            )}
            {step === 2 && (
              <CleanupPanel
                highlight={tidyHighlight}
                strip={stripData}
                groups={committedGroups}
                selected={selectedHexes}
                focusHex={cardHex}
                tone={tone}
                onTone={previewTone}
                onToneCommit={() => commitToneRef.current()}
                toneFrom={toneStart && !isNoTone(tone) ? toneStart : null}
                toneHex={toneHex}
                toneWall={toneWall}
                toneTracks={step === 2 ? toneTracksFor() : null}
                toneScope={pieceChoice ? toneScope : null}
                onToneScope={chooseToneScope}
                pieceFaces={pieceFaceCount}
                onRejoin={rejoinPiece}
                onPickColour={applyGroupPick}
                onPickDraft={previewGroupPick}
                onToggleSelected={toggleSelectedHex}
                outputOf={stripOutputOf}
                flags={settings.mergeFlags}
                onFlagChange={updateFlag}
                mergeSettings={settings.merge}
                onMergeSettings={(next) => patchSettings("merge", next)}
                onSplitGroup={(family, fraction) => keepStripCuts(addCut(committedCuts, family, fraction))}
                onMergeUp={(family, index) => keepStripCuts(removeCut(committedCuts, family, index))}
                onMergeSelected={mergeSelected}
                onRemoveSpecks={removeSpecksInto}
                speckFaces={speckFaces}
                speckMm={model && areaTotal > 0 ? discDiameter((speckFaces * areaTotal) / model.triangles.length * mmPerUnit * mmPerUnit) : null}
                onSpeckFaces={(n) => setSpeckFaces(Math.max(1, Math.min(1_000_000, Math.round(n))))}
                busy={isBusy}
                advanced={
                  <MergeSection
                    palette={palette}
                    paletteSettings={settings.palette}
                    onPaletteSettingsChange={(next) => patchSettings("palette", next)}
                    areaByPosition={areaByPosition}
                    flags={settings.mergeFlags}
                    onFlagChange={updateFlag}
                    settings={settings.merge}
                    onSettingsChange={(next) => patchSettings("merge", next)}
                    onAutoFlags={reapplyAutoFlags}
                    onRunMerge={() => void runMerge()}
                    onUndo={undoMerge}
                    undoCount={history.length}
                    report={mergeReport}
                    busy={isBusy}
                    selected={selectedHexes}
                    onToggleSelected={toggleSelectedHex}
                    onClearSelection={() => setSelectedHexes([])}
                    onMergeSelected={mergeSelected}
                    hoverHex={hoverHex}
                    onHover={handleHover}
                    onRecolour={recolourPaletteColour}
                  />
                }
              />
            )}
            {step === 3 && mixPanels}
            {step === 4 && (
              <>
              <ExportSection
                settings={settings.export}
                orientationBase={orientationFor(sourceInfo?.kind ?? "rodin")}
                onChange={(next) => {
                  if (next.printPreset !== settings.export.printPreset) setPreviewLayerHeight(null);
                  patchSettings("export", next);
                }}
                summary={matrixSummary}
                print={{
                  heightMm: printHeightMm,
                  layerHeight: layerHeightMm,
                  layers: printHeightMm !== null && layerHeightMm ? Math.ceil(printHeightMm / layerHeightMm - 1e-6) : null,
                  faceDown:
                    faceDownLabel[settings.export.coordinateMode] ??
                    t(faceOnBed(settings.export.coordinateMode, orientationFor(sourceInfo?.kind ?? "rodin")) ?? "exp.coordTurn"),
                  fit: printFit,
                }}
                check={exportCheck}
                finalCheck={finalCheck}
                printer={printer}
                onChoosePrinter={choosePrinter}
                printerNotice={printerNotice}
                slotCount={slots.length}
                slotColours={slots.map((slot) => ({ label: `E${slot.slot}`, hex: rgbToHex(slot.filament.rgb), name: slot.filament.name }))}
                slotsAreDefault={settings.filaments.hex.slice(0, settings.filaments.count).every((hex, i) => hex.toUpperCase() === DEFAULT_SETTINGS.filaments.hex[i].toUpperCase())}
                onExport={() => void export3mf()}
                busy={isBusy}
                templateInfo={template?.info ?? null}
                defaultFileName={defaultFileName}
                filaments={settings.filaments}
                onAdoptTemplateColours={adoptTemplateColours}
                onUndoAdoptTemplateColours={settings.filamentsUndo ? undoAdoptTemplateColours : null}
                configIncluded={settings.export.includePrinterConfig && Boolean(template?.info.configFound) && templateFitsPrinter(printer, template?.info.printerModel)}
                lastExport={lastExport ? { fileName: lastExport.fileName, size: lastExport.blob.size, at: lastExport.at } : null}
                outcome={exportOutcome}
                onDownloadAgain={() => {
                  if (lastExport) downloadBlob(lastExport.fileName, lastExport.blob);
                }}
                nomad={{
                  canExport: Boolean(model) && palette.length > 0,
                  colourCount: palette.length,
                  onExport: nomadExport,
                  onImport: (file) => void nomadImport(file),
                  report: nomadReport,
                }}
                onOpenGather={() => setGatherOpen(true)}
              />
              {WITH_CLAUDE && model && (
                <section className="pane-section tidy" aria-label={t("tidy.exportConsult")}>
                  <ConsultBox
                    title={t("tidy.exportConsult")}
                    sub={t("tidy.exportSub")}
                    inputId="export-consult-input"
                    ai={aiAvailable}
                    log={tidyLog.filter((entry) => entry.model === tidyModelName && entry.scope === "export")}
                    busy={tidyBusy}
                    elapsed={tidyElapsed}
                    disabled={isBusy}
                    auto={{ label: t("tidy.exportAuto"), hint: t("tidy.exportAutoHint"), onClick: () => void tidyAsk(t("tidy.exportAutoAsk"), false, false, "export") }}
                    examples={[t("tidy.exExport3"), t("tidy.exExport1"), t("tidy.exExport2")]}
                    placeholder={t("tidy.exportPlaceholder")}
                    onSend={(message, images) => void tidyAsk(message, false, false, "export", { images })}
                    onStop={() => tidyAbortRef.current?.abort()}
                    onTry={applyTidySuggestion}
                    onApply={acceptPreview}
                    onCancel={cancelEntry}
                    canCancel={canCancelEntry}
                    connection={aiConnection}
                    keyForm={<KeyForm connection={aiConnection} />}
                    connectionLine={<ConnectionLine connection={aiConnection} />}
                  />
                </section>
              )}
              </>
            )}
          </div>
          {step === 2 && (
            <div className="sidebar-foot">
              <button
                type="button"
                className="btn primary big"
                disabled={isBusy || !model}
                onClick={() => void runMerge(undefined, { cleanupOnly: true })}
                title={t("strip.cleanupHint")}
              >
                {t("strip.cleanup")}
              </button>
              <span className="hint">{t("strip.cleanupFoot")}</span>
            </div>
          )}
        </aside>
        <div
          className={`splitter${splitterDragging === "left" ? " dragging" : ""}`}
          title={t("layout.splitter")}
          onPointerDown={startSplitterDrag}
          onDoubleClick={() => {
            setSidebarWidth(LEFT_DEFAULT);
            try {
              window.localStorage.setItem("rodin-pipeline-left-width", String(LEFT_DEFAULT));
            } catch {
              // ignore
            }
          }}
        />

        <section ref={stageRef} className="stage" aria-label={t("view.compareAria")} style={{ "--matrix-h": `${(matrixShare * 100).toFixed(2)}%` } as CSSProperties}>
          <GyupaLoader label={busy} />
          <div className="stage-toolbar">
            {compareStep ? (
              <>
                <Segmented
                  label={t("view.compareAria")}
                  value={compare}
                  onChange={setCompare}
                  options={[
                    { value: "source", label: t("view.compareSource") },
                    { value: "both", label: t("view.compareBoth") },
                    { value: "result", label: t("view.compareResult") },
                  ]}
                />
                <Segmented
                  label={t("view.resultAria")}
                  value={resultMode}
                  onChange={(mode) => setPreviewMode(mode)}
                  options={[
                    { value: "palette", label: modeLabel.palette, disabled: !showResult },
                    { value: "print", label: modeLabel.print, disabled: !showResult },
                  ]}
                />
              </>
            ) : step === 4 ? (
              <>
                <Segmented
                  label={t("view.resultAria")}
                  value={exportView}
                  onChange={setExportView}
                  options={[
                    { value: "sim", label: modeLabel.print },
                    { value: "layers", label: t("layers.view") },
                  ]}
                />
                {exportView === "layers" && (
                  <Segmented
                    label={t("layers.height")}
                    value={shownLayerHeight}
                    onChange={setPreviewLayerHeight}
                    options={layerChoices.map((h) => ({ value: h, label: <span className="mono">{h.toFixed(2)}</span>, title: h === layerHeightMm ? t("layers.heightSet") : t("layers.heightTry") }))}
                  />
                )}

              </>
            ) : (
              <Segmented
                label={t("view.resultAria")}
                value={singleMode}
                onChange={setSingleMode}
                options={[
                  { value: "source", label: t("view.compareSource") },
                  { value: "palette", label: modeLabel.palette },
                  { value: "print", label: modeLabel.print },
                ]}
              />
            )}
            <HelpTip text={t("help.preview")} />
            <div className="view-tools push">
              <Menu
                triggerClassName="text-btn"
                align="right"
                label={t("view.dirMenu")}
                title={t("view.dirMenu")}
                trigger={
                  <>
                    <Icon name="cube" size={14} stroke={1.4} />
                    {viewLabels.find(([name]) => name === view)?.[1]} ▾
                  </>
                }
              >
                {(close) => (
                  <>
                    <div className="menu-label">{t("view.dirMenu")}</div>
                    {viewLabels.map(([name, label]) => (
                      <button
                        key={name}
                        type="button"
                        className="menu-item"
                        role="menuitemradio"
                        aria-checked={view === name}
                        onClick={() => {
                          setView(name);
                          setFitNonce((n) => n + 1);
                          close();
                        }}
                      >
                        {label}
                        {view === name && <Icon name="check" size={12} />}
                      </button>
                    ))}
                    <div className="menu-sep" />
                    <button
                      type="button"
                      className="menu-item"
                      disabled={view === "iso"}
                      title={t("view.faceDownHint")}
                      onClick={() => {
                        if (view === "iso") return;
                        patchSettings("export", {
                          ...settings.export,
                          // The side being looked at — as the view shows the model
                          // now, not as the file has it — is the one that goes down.
                          coordinateMode: turnMode(combineTurns(turnRows(`face-${view}`), turnRows(viewMode))),
                        });
                        close();
                      }}
                    >
                      ⤓ {t("view.faceDown")}
                    </button>
                  </>
                )}
              </Menu>
              <span className="sep" aria-hidden="true" />
              <button
                type="button"
                className="icon-btn small"
                aria-pressed={pairPressed(paneLook.flat)}
                aria-label={t("view.flat")}
                title={`${t("view.flat")} — ${t("view.flatHint")}${compareBoth ? ` ${t("view.bothHint")}` : ""}`}
                onClick={() => setPaneLook("flat", "both", pairPressed(paneLook.flat) !== true)}
              >
                <Icon name="flat" size={14} stroke={1.4} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                aria-pressed={formLines}
                aria-label={t("view.lines")}
                disabled={pairPressed(paneLook.flat) === false}
                title={pairPressed(paneLook.flat) === false ? `${t("view.lines")} — ${t("view.linesNeedFlat")}` : `${t("view.lines")} — ${t("view.linesHint")}`}
                onClick={() => setFormLines(!formLines)}
              >
                <Icon name="lines" size={14} stroke={1.4} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                aria-pressed={pairPressed(paneLook.soft)}
                aria-label={t("view.soft")}
                title={`${t("view.soft")} — ${t(pairPressed(paneLook.soft) === true ? "view.softOnHint" : "view.softOffHint")}${compareBoth ? ` ${t("view.bothHint")}` : ""}`}
                onClick={() => setPaneLook("soft", "both", pairPressed(paneLook.soft) !== true)}
              >
                <Icon name="soft" size={14} stroke={1.4} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                aria-pressed={cutSpan > 0}
                data-guide="cut"
                aria-label={t("view.cut")}
                title={`${t("view.cut")} — ${t(cutSpan > 0 ? "view.cutOnHint" : "view.cutOffHint")}`}
                onClick={() => toggleCut(cutSpan <= 0)}
              >
                <Icon name="cutLine" size={14} stroke={1.4} />
              </button>
              {cutSpan > 0 && model && compareStep && (
                <button
                  type="button"
                  className="text-btn small cut-confirm"
                  disabled={isBusy || !cutReady}
                  title={t(cutReady ? "view.cutConfirmHint" : cutFresh ? "view.cutNothingHint" : "view.cutConfirmWait")}
                  onClick={() => void confirmCut()}
                >
                  {cutReady && cutFresh
                    ? t("view.cutConfirmN", { n: cutFresh.cut.replaced.length.toLocaleString() })
                    : t(cutFresh ? "view.cutNothing" : "view.cutWorking")}
                </button>
              )}
              <Menu triggerClassName="icon-btn small" label={t("view.bgMenu")} title={t("view.backgroundHint")} trigger={<Icon name="background" size={14} stroke={1.4} />}>
                <div className="menu-label">{t("view.background")}</div>
                <label className="menu-row">
                  <span>{t("view.checker")}</span>
                  <input type="checkbox" checked={background.checker} onChange={(e) => setBackground({ ...background, checker: e.target.checked })} />
                </label>
                <label className="menu-row">
                  <span>{t("view.brightness")}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(background.brightness * 100)}
                    onChange={(e) => setBackground({ ...background, brightness: Number(e.target.value) / 100 })}
                    aria-label={t("view.brightness")}
                  />
                </label>
              </Menu>
              <button
                type="button"
                className="icon-btn small"
                aria-pressed={focusMode === "xray"}
                aria-label={t("focus.xray")}
                title={`${t("focus.xray")} — ${t("focus.hint")}`}
                disabled={!focusMask}
                onClick={() => setFocusMode(focusMode === "xray" ? "normal" : "xray")}
              >
                <Icon name="xray" size={14} stroke={1.4} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                aria-pressed={focusMode === "solo"}
                aria-label={t("focus.solo")}
                title={`${t("focus.solo")} — ${t("focus.hint")}`}
                disabled={!focusMask}
                onClick={() => setFocusMode(focusMode === "solo" ? "normal" : "solo")}
              >
                <Icon name="solo" size={14} stroke={1.4} />
              </button>
              <button type="button" className="icon-btn small" aria-pressed={showRings} aria-label={t("view.rings")} title={t("view.ringsHint")} onClick={toggleRings}>
                <Icon name="rings" size={14} stroke={1.4} />
              </button>
              {!showDock && (
                <>
                  <button type="button" className="icon-btn small" aria-pressed={showMap} aria-label={t("tool.map")} title={`${t("tool.map")} M — ${t("view.mapHint")}`} onClick={() => setShowMap(!showMap)}>
                    <Icon name="map" size={14} stroke={1.4} />
                  </button>
                  <button type="button" className="icon-btn small" aria-label={t("tool.fit")} title={`${t("tool.fit")} F`} onClick={() => setFitNonce((n) => n + 1)}>
                    <Icon name="fit" size={14} stroke={1.4} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className={`viewers${showDock ? "" : " dock-off"}${fillMode && !eyedropper ? " filling" : ""}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, paneCount)}, minmax(0, 1fr))` }}>
            {/* The tool and pick bars float over the views: coming and going they
                no longer resize them, which moved the model on every pick and fill. */}
            <div className="stage-bars">
              {model && (brushMode || fillMode) && (
                <div className="stage-bar brush-bar">
                  <b>{fillMode ? t("fill.title") : healMode ? t("brush.healTitle") : t("brush.title")}</b>
                  {healMode && !fillMode && <span className="muted">{t("brush.healNote")}</span>}
                  {/* The healing brush takes the colour around each speck: no colour controls for it. */}
                  {!(healMode && !fillMode) && (
                  <>
                  <span>{t("brush.colour")}</span>
                  <ColourSelect
                    value={pickTarget || "__new__"}
                    placeholder="…"
                    onChange={setPickTarget}
                    options={[
                      ...palette.map((entry, position) => {
                        const hex = rgbToHex(entry.rgb);
                        return { value: hex, hex, label: `#${entry.index} ${hex}`, sub: pct(areaByPosition[position] ?? 0) };
                      }),
                      { value: "__new__", hex: pickCustom, label: t("pick.newColour") },
                    ]}
                  />
                  <ColourPicker value={brushHex} commit title={t("brush.pickHint")} onDraft={setPickPreviewHex} onChange={(hex) => takePickedColour(hex, false)} />
                  <button
                    type="button"
                    className={`btn small eyedropper-toggle${eyedropper ? " active" : ""}`}
                    title={t("brush.eyedropperHint")}
                    onClick={() => {
                      setEyedropper((v) => !v);
                      if (!eyedropper) setStatus(t("status.eyedropperOn"));
                    }}
                  >
                    {t("brush.eyedropper")}
                  </button>
                  </>
                  )}
                  {brushMode ? (
                    <>
                      <span>{t("brush.size")}</span>
                      <NumberField value={brushRadius} min={0.001} max={10000} step={Math.max(0.001, Number((brushRadius / 5).toPrecision(1)))} onChange={(v) => setBrushRadiusClamped(v)} />
                      {healMode && (
                        <>
                          <span title={t("brush.healSizeHint")}>{t("brush.healSize")}</span>
                          <NumberField value={healSize} min={0.001} max={brushRadius} step={Math.max(0.001, Number((healSize / 5).toPrecision(1)))} onChange={(v) => setHealSize(Math.max(0.001, Math.min(brushRadius, v)))} />
                        </>
                      )}
                      <span className="muted">{t("brush.keys")}</span>
                      {!healMode && (
                        <label className="inline" style={{ gap: 6 }}>
                          <input type="checkbox" checked={brushMaskOnly} onChange={(e) => setBrushMaskOnly(e.target.checked)} /> {t("brush.maskOnly")} <span className="key">S</span>
                        </label>
                      )}
                      {brushMaskOnly && !pickedMask && <span className="warn">{t("brush.selectFirst")}</span>}
                      <span className="muted">{t("brush.hint")}</span>
                    </>
                  ) : (
                    <span className="muted">{t(pickedPatches.length > 0 ? "fill.hintSelection" : "fill.hint")}</span>
                  )}
                </div>
              )}
              {model && gapMode && (
                <div className="stage-bar gap-bar">
                  {gapReview ? (
                    <>
                      <b>{t("gap.reviewTitle", { i: gapReview.keep.length + 1, n: gapReview.places.length })}</b>
                      <span>
                        {t("gap.reviewAsk", {
                          mm: discDiameter(gapReview.areas[gapReview.keep.length] ?? 0).toFixed(1),
                          area: (gapReview.areas[gapReview.keep.length] ?? 0).toFixed(1),
                        })}
                      </span>
                      <button type="button" className="btn primary small" onClick={() => answerGapReview("keep")}>
                        {t("gap.reviewKeep")}
                      </button>
                      <button type="button" className="btn small" onClick={() => answerGapReview("melt")}>
                        {t("gap.reviewMelt")}
                      </button>
                      {gapReview.places.length - gapReview.keep.length > 1 && (
                        <>
                          <button type="button" className="btn small" onClick={() => answerGapReview("keepRest")}>
                            {t("gap.reviewKeepRest")}
                          </button>
                          <button type="button" className="btn small" onClick={() => answerGapReview("meltRest")}>
                            {t("gap.reviewMeltRest")}
                          </button>
                        </>
                      )}
                      <button type="button" className="btn small" onClick={() => answerGapReview("stop")}>
                        {t("gap.reviewStop")}
                      </button>
                    </>
                  ) : (
                    <>
                      <b>{t("gap.title")}</b>
                      <Segmented
                        value={gapScope}
                        onChange={setGapScope}
                        label={t("gap.title")}
                        options={[
                          { value: "part", label: t("gap.part"), title: t("gap.hintPart") },
                          { value: "picked", label: t("gap.picked"), title: t("gap.hintPicked") },
                          { value: "all", label: t("gap.all"), title: t("gap.hintAll") },
                        ]}
                      />
                      {gapScope !== "all" && gapHexes.length > 0 && (
                        <span className="cell-colour">
                          {gapHexes.slice(0, 8).map((hex) => (
                            <Swatch key={hex} hex={hex} size={14} title={hex} />
                          ))}
                        </span>
                      )}
                      <span className="muted">
                        {gapScope === "all"
                          ? t("gap.hintAll")
                          : gapScope === "picked"
                            ? shownHex || gapChosenHexes.length > 0
                              ? t("gap.hintPickedColour", { hex: [...new Set([...gapChosenHexes, ...(shownHex ? [shownHex] : [])])].slice(0, 3).join(" · ") })
                              : t(pickedPatches.length > 0 ? "gap.hintPickedReady" : "gap.hintPicked")
                            : t(gapHexes.length >= 2 ? "gap.hintPartReady" : "gap.hintPart")}
                      </span>
                      {gapScope === "picked" && (
                        <label className="inline gap-big" title={t("gap.bigHint")}>
                          {t("gap.bigLabel")}
                          <NumberField value={gapBigMm} min={0.1} max={50} step={0.1} width={64} onChange={(v) => setGapBigMm(Math.max(0.1, v))} />
                          mm
                        </label>
                      )}
                      <button type="button" className="btn primary small" disabled={!canRunGap} onClick={() => void runGap()}>
                        {t(gapScope === "all" ? "gap.runAll" : "gap.run")}
                      </button>
                    </>
                  )}
                </div>
              )}
              {/* The pick bar edits colours: 02 only (in 03 and 04 the tag over the patch says where it prints). */}
              {model && step === 2 && (pickedPatches.length > 0 || shownHex) && (
                <div className="stage-bar pick-panel">
                    <>
                      <span className="pin-mark" title={t("pick.pinHint")} aria-hidden="true" />
                      <b className="pick-title" title={t("pick.pinHint")}>
                        {t("pick.title", { n: pickedPatches.length })}
                      </b>
                      <span className="cell-colour">
                        {pickedHexes.slice(0, 8).map((hex) => (
                          <Swatch key={hex} hex={hex} size={14} title={hex} />
                        ))}
                        {pickedHexes.length === 1 && <code>{pickedHexes[0]}</code>}
                      </span>
                      <span className="muted">{t("pick.faces", { n: pickedFaceCount.toLocaleString(), pct: pct(pickedFraction) })}</span>
                      <span className="pick-edge" title={t("pick.edgeHint")}>
                        <span className="muted">{t("pick.edge")}</span>
                        <span className="end">{t("pick.edgeThin")}</span>
                        <datalist id="edge-middle">
                          <option value="50" />
                        </datalist>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={edgeValue}
                          aria-label={t("pick.edge")}
                          list="edge-middle"
                          disabled={isBusy}
                          onChange={(event) => previewEdge(Number(event.target.value))}
                          onPointerDown={() => window.addEventListener("pointerup", () => commitEdgeRef.current(), { once: true })}
                          onKeyUp={() => commitEdgeRef.current()}
                        />
                        <span className="end">{t("pick.edgeThick")}</span>
                        <span className="mono count">{edgeValue === 50 ? t("pick.edgeAsIs") : t("pick.edgeCount", { join: edgeCount.join.toLocaleString(), leave: edgeCount.leave.toLocaleString() })}</span>
                        {edgeValue !== 50 && (
                          <button
                            type="button"
                            className="btn small"
                            title={t("pick.edgeResetHint")}
                            disabled={isBusy}
                            onClick={() => {
                              previewEdge(50);
                              commitEdgeRef.current();
                            }}
                          >
                            ↺ {t("pick.edgeReset")}
                          </button>
                        )}
                      </span>
                      {shownHex && (
                        <span className="pick-colour-mode">
                          <Swatch hex={shownHex} size={12} /> {t("pick.colourMode", { hex: shownHex })}
                          <button type="button" className="btn small" onClick={() => setShownHex(null)}>
                            {t("pick.colourModeOff")}
                          </button>
                        </span>
                      )}
                      {/* One "change to" colour: the list (palette colours, or the new colour) and, beside it,
                          the picker to choose one yourself — one swatch for it, not two. */}
                      <span>{t("pick.changeTo")}</span>
                      <ColourSelect
                        value={pickTarget}
                        placeholder="…"
                        onChange={setPickTarget}
                        options={[
                          ...palette.map((entry, position) => {
                            const hex = rgbToHex(entry.rgb);
                            return { value: hex, hex, label: `#${entry.index} ${hex}`, sub: pct(areaByPosition[position] ?? 0), disabled: pickedHexes.length === 1 && hex === pickedHexes[0] };
                          }),
                          { value: "__new__", hex: pickCustom, label: `${t("pick.newColour")} ${pickCustom}` },
                        ]}
                      />
                      <ColourPicker
                        value={brushHex}
                        before={pickedHexes[0]}
                        commit
                        applyLabel={t("pick.apply")}
                        title={t("brush.pickHint")}
                        onDraft={setPickPreviewHex}
                        onChange={(hex) => takePickedColour(hex, true)}
                      >
                        <span>🎨 {t("pick.pickOwn")}</span>
                      </ColourPicker>
                      {!brushMode && (
                        <button
                          type="button"
                          className={`btn small eyedropper-toggle${eyedropper ? " active" : ""}`}
                          title={t("brush.eyedropperHint")}
                          onClick={() => {
                            setEyedropper((v) => !v);
                            if (!eyedropper) setStatus(t("status.eyedropperOn"));
                          }}
                        >
                          {t("brush.eyedropper")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn primary small"
                        disabled={!canFillPick}
                        title={t("pick.applyHint")}
                        onClick={() => applyPickColour()}
                      >
                        {t("pick.apply")} <span className="key">Enter</span>
                      </button>
                      <button type="button" className="btn small" onClick={clearPick}>
                        {t("pick.clear")}
                      </button>
                    </>
                </div>
              )}
            </div>
            {model && brushMode && (
              <div className="brush-size-overlay" title={t("brush.keys")}>
                <span>{t("brush.sizeShort")}</span>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  step={1}
                  value={brushSliderValue}
                  onChange={(e) => setBrushRadiusClamped(brushBounds.min * Math.pow(brushBounds.max / brushBounds.min, Number(e.target.value) / 1000))}
                />
                <b>{brushRadius}</b>
                {healMode && (
                  <>
                    <span title={t("brush.healSizeHint")}>{t("brush.healSizeShort")}</span>
                    <input
                      type="range"
                      min={0}
                      max={1000}
                      step={1}
                      value={healSliderValue}
                      title={t("brush.healSizeHint")}
                      onChange={(e) => setHealSizeClamped(brushBounds.min * Math.pow(healTop / brushBounds.min, Number(e.target.value) / 1000))}
                    />
                    <b>{healSize}</b>
                  </>
                )}
                <span className="muted">{healMode ? t("brush.healKeys") : t("brush.keys")}</span>
                {!healMode && (
                  <label className={`mask-toggle${brushMaskOnly && !pickedMask ? " warn" : ""}`} title={t("brush.selectFirst")}>
                    <input type="checkbox" checked={brushMaskOnly} onChange={(e) => setBrushMaskOnly(e.target.checked)} /> {t("brush.maskOnly")} <span className="key">S</span>
                  </label>
                )}
              </div>
            )}
            <MeshViewer
              ref={viewerRef0}
              positions={positions}
              colours={sourceColours}
              label={t("view.source")}
              labelTools={paneTools(0)}
              className={showSource ? undefined : "pane-hidden"}
              {...viewerCommon(0, showSource)}
            />
            <MeshViewer
              ref={viewerRef2}
              positions={positions}
              colours={coloursForMode(resultMode)}
              cut={viewerCut}
              label={step === 4 && layerPreview ? t("layers.label", { h: shownLayerHeight.toFixed(2) }) : modeLabel[resultMode]}
              layers={step === 4 ? layerPreview : null}
              labelTools={paneTools(1)}
              className={[showResult ? "" : "pane-hidden", dragging && compareStep ? "dragging" : ""].filter(Boolean).join(" ") || undefined}
              {...viewerCommon(2, showResult)}
            />
            {showMap && (
              <ColourMap
                ref={mapRef}
                atlas={shownAtlas}
                building={atlasBuilding}
                colourOf={colourOfFace}
                coloursVersion={coloursVersion}
                masks={atlasMasks}
                brush={{ active: brushMode, radiusPx: shownAtlas ? brushRadius * shownAtlas.scale : 4, hex: brushHex, innerPx: healMode && shownAtlas ? healSize * shownAtlas.scale : undefined }}
                eyedropper={eyedropper}
                hand={hand}
                background={background}
                onPick={(face, info) => void handlePick(face, info)}
                onHover={mapHover}
                onBrushStart={() => void beginStroke()}
                onBrushPaintAt={paintAtMap}
                onBrushEnd={endStroke}
                label={unfolded ? t("map.unfoldLabel", { n: unfolded.pieces }) : t("map.label")}
                hint={t(unfolded ? "map.unfoldHint" : unfoldOn && pickedPatches.length === 0 ? "map.unfoldPickHint" : "map.hint")}
                emptyLabel={t("map.empty")}
                buildingLabel={t("busy.atlas")}
                busyLabel={unfolding !== null ? t("map.unfolding", { pct: Math.round(unfolding * 100) }) : (unfoldNote ?? undefined)}
                tools={
                  <button type="button" className="link-btn" aria-pressed={unfoldOn} title={t("map.unfoldHintToggle")} onClick={() => setUnfoldOn(!unfoldOn)}>
                    🧩 {t("map.unfold")}
                  </button>
                }
              />
            )}
            {step === 4 && layerPreview && printHeightMm !== null && (
              // shown again whenever the layer height or the soft/sharp look changes
              <span key={`${shownLayerHeight}|${paneLook.soft[1]}`} className="view-chip passing" style={chipStyle}>
                {t("layers.note", { mm: printHeightMm.toFixed(0), n: Math.ceil(printHeightMm / shownLayerHeight - 1e-6).toLocaleString() })}
              </span>
            )}
            {model && model.triangles.length >= BIG_MODEL_FACES && step <= 2 && (
              // Said once a model is opened, then out of the way (11-05: always on, it sat over the views' corner).
              <span key={`${model.name}|${model.triangles.length}`} className="view-chip passing long" style={chipStyle}>
                {t("load.bigModel", { faces: model.triangles.length.toLocaleString() })}
              </span>
            )}
            {step === 3 && mixRow && (
              <span className="view-chip" style={chipStyle}>
                <span className="sw" style={{ background: mixRow.hex }} />
                <span className="mono">{mixRow.label}</span>
                <span className="mono muted">
                  {mixRow.hex} · {pct(mixRow.area)}
                </span>
              </span>
            )}
            {dragging && compareStep && showResult && (
              <span className="drag-badge" style={{ left: showSource ? `calc(${100 / paneCount}% + 12px)` : 12 }}>
                {t("view.dragging")}
              </span>
            )}
            <div className="view-notices">
            {/* Claude at work, where the eyes are (the consult's own line may be scrolled away). */}
            {tidyBusy !== null && (
              <div className="view-working" role="status">
                <GyupaSpin size={22} />
                <span>
                  {tidyBusy} · {t("tidy.seconds", { n: tidyElapsed })}
                </span>
                <button type="button" className="btn small" onClick={() => tidyAbortRef.current?.abort()}>
                  ⏹ {t("tidy.stop")}
                </button>
              </div>
            )}
            {aiArrived !== null && tidyBusy === null && (
              <div className="view-arrived" role="status" key={aiArrived}>
                {changeFlash ? t("tidy.arrivedChanged", { pct: formatPct((changeFlash.faces / changeFlash.total) * 100) }) : t("tidy.arrived")}
              </div>
            )}
            {aiPreview && (
              <div className="ai-preview-banner" role="status">
                <span>{t("tidy.previewBanner", { n: aiPreview.lines?.length ?? 0 })}</span>
                <button type="button" className="btn small primary" disabled={tidyBusy !== null} onClick={() => acceptPreview(aiPreview.id)}>
                  ✅ {t("tidy.previewApply")}
                </button>
                {canCancelEntry(aiPreview.id) && (
                  <button type="button" className="btn small" disabled={tidyBusy !== null || isBusy} onClick={() => cancelEntry(aiPreview.id)}>
                    ↩ {t("tidy.previewCancel")}
                  </button>
                )}
              </div>
            )}
            </div>
            {compareStep && cutNoticeShown && cutNotice && (
              <div className="cut-notice" role="status">
                <span className="cut-notice-icon">
                  <Icon name="cutLine" size={13} stroke={1.5} />
                </span>
                <span className="cut-notice-body">
                  <span className="cut-notice-title">{t(`cutNotice.${cutNoticeKey}.title` as Key)}</span>
                  <span className="cut-notice-detail">{t(`cutNotice.${cutNoticeKey}.detail` as Key)}</span>
                  {cutNotice === "off" ? (
                    <span className="cut-notice-actions">
                      <button type="button" className="cut-confirm" onClick={() => toggleCut(true)}>
                        {t("cutNotice.turnOn")}
                      </button>
                    </span>
                  ) : (
                    <span className="cut-notice-actions">
                      <button type="button" className="cut-confirm" disabled={isBusy || !cutReady} onClick={() => void confirmCut()}>
                        {t("view.cutConfirm")}
                      </button>
                      <span className="mono muted">
                        {cutReady && cutFresh ? t("cutNotice.count", { n: cutFresh.cut.replaced.length.toLocaleString() }) : t("view.cutWorking")}
                      </span>
                    </span>
                  )}
                </span>
                <button type="button" className="close" aria-label={t("toast.close")} onClick={() => setCutNotice(null)}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            )}
          </div>
          {step === 3 && (
            <div
              className={`splitter-row${splitterDragging === "matrix" ? " dragging" : ""}`}
              title={t("layout.splitterRow")}
              onPointerDown={startMatrixDrag}
              onDoubleClick={() => {
                setMatrixShare(MATRIX_DEFAULT);
                storeSize("rodin-pipeline-matrix-share", MATRIX_DEFAULT);
              }}
            />
          )}
          {step === 3 && (
            <MappingMatrix
              ref={matrixScrollRef}
              rows={matrixRows}
              slots={slots}
              summary={matrixSummary}
              selected={mixRow?.paletteIndex ?? null}
              onSelect={(paletteIndex) => {
                // a row chosen here takes over from patches picked on the model (their tags go)
                clearPick();
                setMixRowIndex(paletteIndex);
                const row = matrixRows.find((r) => r.paletteIndex === paletteIndex);
                if (row) setSelectedHexes([row.hex]);
              }}
              hoverHex={hoverHex}
              onHover={handleHover}
              pointed={pickedHexes}
              selectedRowRef={(element) => {
                linkRowRef.current = element;
              }}
              onScroll={measureLink}
            />
          )}
          {toast && compareStep && (
            <div className="toast" role="status" style={showDock ? undefined : { bottom: 18 }}>
              <span className="toast-icon">
                <Icon name="check" size={12} stroke={1.8} />
              </span>
              <span className="toast-body">
                <span className="toast-title">
                  {toast.kind === "merge" ? t("toast.merged") : t("toast.split")}
                  {toast.from.map((hex) => (
                    <span key={hex} className="inline" style={{ gap: 4 }}>
                      <span className="sw" style={{ background: hex }} />
                      <span className="mono">{hex}</span>
                    </span>
                  ))}
                  <span>→</span>
                  {toast.to.split(" · ").map((hex) => (
                    <span key={hex} className="inline" style={{ gap: 4 }}>
                      <span className="sw" style={{ background: hex }} />
                      <span className="mono">{hex}</span>
                    </span>
                  ))}
                </span>
                <span className="toast-detail">
                  <span className="mono">{t("toast.counts", { a: toast.counts[0], b: toast.counts[1] })}</span>
                  {toast.kind === "merge" && (
                    <>
                      {" · "}
                      {t("toast.area")} <span className="mono">{pctNumber(toast.area[0])} → {pct(toast.area[1])}</span>
                      {" · "}
                      {toast.sameOutput ? t("toast.sameOutput", { out: toast.sameOutput }) : toast.outputs.length > 0 ? t("toast.outputs", { list: toast.outputs.join(" · ") }) : t("toast.replan")}
                    </>
                  )}
                </span>
              </span>
              <button type="button" className="undo" onClick={undoStripCut}>
                {t("strip.undo")} <span className="mono">⌘Z</span>
              </button>
              <button type="button" className="close" aria-label={t("toast.close")} onClick={() => setToast(null)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
          {showDock && (
            <div className="tool-dock" role="toolbar" aria-label={t("tool.aria")}>
              <button type="button" aria-pressed={!brushMode && !fillMode && !eyedropper && !gapMode} title={t("pick.hint")} onClick={() => { setBrushMode(false); setHealMode(false); setFillMode(false); setEyedropper(false); setGapMode(false); }}>
                <Icon name="select" size={17} stroke={1.4} />
                <span>
                  {t("tool.select")} <span className="key">V</span>
                </span>
              </button>
              <button type="button" aria-pressed={brushMode && !healMode} title={t("brush.hint")} onClick={() => { setBrushMode((v) => !v || healMode); setHealMode(false); }}>
                <Icon name="brush" size={17} stroke={1.4} />
                <span>
                  {t("tool.brush")} <span className="key">B</span>
                </span>
              </button>
              <button type="button" aria-pressed={brushMode && healMode} title={t("heal.hint")} onClick={() => { const on = !(brushMode && healMode); setBrushMode(on); setHealMode(on); if (on) healPickRef.current(); }}>
                <Icon name="heal" size={17} stroke={1.4} />
                <span>
                  {t("tool.heal")} <span className="key">H</span>
                </span>
              </button>
              <button type="button" aria-pressed={fillMode} title={t("fill.hint")} onClick={() => setFillMode((v) => !v)}>
                <Icon name="fill" size={17} stroke={1.4} />
                <span>
                  {t("tool.fill")} <span className="key">G</span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={eyedropper}
                title={t("brush.eyedropperHint")}
                onClick={() => {
                  setEyedropper((v) => !v);
                  if (!eyedropper) setStatus(t("status.eyedropperOn"));
                }}
              >
                <Icon name="eyedropper" size={17} stroke={1.4} />
                <span>
                  {t("tool.eyedropper")} <span className="key">I</span>
                </span>
              </button>
              <button type="button" aria-pressed={gapMode} title={t("gap.hintDock")} onClick={() => setGapMode((v) => !v)}>
                <Icon name="gap" size={17} stroke={1.4} />
                <span>
                  {t("tool.gap")} <span className="key">C</span>
                </span>
              </button>
              <span className="dock-sep" aria-hidden="true" />
              <button type="button" aria-pressed={showMap} title={t("view.mapHint")} onClick={() => setShowMap(!showMap)}>
                <Icon name="map" size={17} stroke={1.4} />
                <span>
                  {t("tool.map")} <span className="key">M</span>
                </span>
              </button>
              <button type="button" title={t("tool.fit")} onClick={() => setFitNonce((n) => n + 1)}>
                <Icon name="fit" size={17} stroke={1.4} />
                <span>
                  {t("tool.fit")} <span className="key">F</span>
                </span>
              </button>
            </div>
          )}
        </section>

        {rightPanel && (
          <div
            className={`splitter right${splitterDragging === "right" ? " dragging" : ""}`}
            title={t("layout.splitter")}
            onPointerDown={startRightDrag}
            onDoubleClick={resetRightWidth}
          />
        )}
        {step === 3 && (
          <aside className="inspector" aria-label={t("recipe.panel")}>
            {recipePanel}
          </aside>
        )}
        {step === 4 && (
          <aside className="inspector" aria-label={t("band.title")}>
            <BandingPanel
              outputs={bandOutputs}
              slots={slots}
              layerHeight={shownLayerHeight}
              selected={bandLabel}
              onSelect={(output) => {
                setBandLabel(output.label);
                setSelectedHexes(output.rows.map((row) => row.hex));
              }}
              settings={settings.mix}
              onRecipeOverride={setRecipeOverride}
              onRemember={(row, indices) => rememberRecipe("band", row, indices)}
              undo={recipeUndoFor("band")}
            />
          </aside>
        )}
        {link && (
          <svg className="row-link" aria-hidden="true" width="100%" height="100%">
            <path d={`M ${link.x1} ${link.y1} H ${link.x2 - 13} V ${link.y2} H ${link.x2}`} />
            <circle cx={link.x1} cy={link.y1} r={2.5} />
            <path className="head" d={`M ${link.x2 - 5} ${link.y2 - 4} L ${link.x2} ${link.y2} L ${link.x2 - 5} ${link.y2 + 4}`} />
          </svg>
        )}
        {step === 2 && (
          <aside className="inspector" aria-label={t("strip.title")}>
            <ColourStrip
              strip={stripData}
              groups={liveGroups}
              baseGroups={committedGroups}
              committedCuts={committedCuts}
              onPreview={setPreviewCuts}
              onCommit={keepStripCuts}
              onSplit={(family, _index, fraction) => keepStripCuts(addCut(committedCuts, family, fraction))}
              onRelayout={relayoutStrip}
              onUndo={undoStripCut}
              undoCount={stripUndo.length}
              hoverHex={hoverHex}
              onHover={handleHover}
              selected={selectedHexes}
              onToggleSelected={(hex) => {
                // a colour chosen on the spectrum takes over from patches picked on the model (their tags go)
                clearPick();
                toggleSelectedHex(hex);
              }}
              onApplyTo={recolourChosenTo}
              onClearSelected={() => {
                clearPick();
                setSelectedHexes([]);
              }}
              pointed={pickedHexes}
              outputOf={stripOutputOf}
              protectedHexes={protectedHexes}
              summary={stripSummary}
              busy={isBusy}
            />
          </aside>
        )}
      </div>

      <footer className={`statusbar${isBusy ? " busy" : ""}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span className="label">{isBusy ? busy : t("status.label")}</span>
        <span className="message" title={status}>{status}</span>
        {memoryMb !== null && (
          <span className={`memory-use${memoryMb > 2500 ? " warn" : ""}`} title={t("status.memoryHint")}>
            {t("status.memory", { gb: (memoryMb / 1000).toFixed(memoryMb >= 1000 ? 1 : 2) })}
          </span>
        )}
        <span className="storage-mode" title={t(storageMode === "folder" ? "storage.folderHint" : "storage.browserHint")}>
          {t(storageMode === "folder" ? "storage.folder" : "storage.browser")}
        </span>
        <a className="license-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer" title={t("license.hint")}>
          {t("license.short")}
        </a>
        {/* the logo page carries the support links (Toonation, PayPal) */}
        <button type="button" className="support-link" onClick={() => setAbout(true)}>
          <Icon name="heart" size={11} /> {t("support.toGyupa")}
        </button>
      </footer>
      <GatherDialog open={gatherOpen} onClose={() => setGatherOpen(false)} />
      <GuideTour mode={guideMode} onMode={setGuideMode} step={step} onStep={changeStep} />
      {intro && <Intro onDone={endIntro} hold={startupLoading} />}
      {about && <Intro onDone={endAbout} about={{ note: `${t("app.subtitle")} · ${t("top.version", { v: APP_VERSION })} · ${t("license.short")}` }} />}
    </div>
    </LangContext.Provider>
  );
}
