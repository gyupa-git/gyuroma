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
import { apparentLayerRgbs, deltaE2000, linearToSrgb, rgbToLab, srgbToLinear } from "@core/prusaFdmMixer";
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
import { MeshViewer, type Callout, type FocusMode, type HighlightOverlay, type LayerPreview, type MeshViewerHandle, type PickInfo, type ViewerCut, type ViewerHit } from "./ui/MeshViewer";
import { meshWithCut, type BorderCut } from "@core/borderCut";
import { cutBorders, CutSuperseded } from "./engine/borderCutClient";
import { ColourStrip, type StripOutput } from "./ui/ColourStrip";
import { CleanupPanel } from "./ui/CleanupPanel";
import { ColourMap, type ColourMapHandle } from "./ui/ColourMap";
import { loadStoredBackground, storeBackground, type ViewBackground } from "./ui/background";
import { blendRecipeText } from "./engine/plan";
import { buildFaceAtlas, faceAtlasCentre, type AtlasMasks, type FaceAtlas } from "./engine/atlas";
import { HelpTip } from "./ui/HelpTip";
import { GyupaLoader } from "./ui/GyupaLoader";
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
import { WITH_CLAUDE } from "./features";
import { renderViews } from "./ui/snapshot";
import { aiAsk, aiStatus, loadApiKey, loadKeyUsage, maskKey, saveApiKey, type AiRoute, type KeyUsage } from "./engine/aiClient";
import { adviceKey, ask } from "./engine/adviceClient";
import { recommendMixOption } from "@core/mixAdvice";
import {
  describeChanges,
  hasCleanChanges,
  presetChanges,
  sanitizeChanges,
  tidyStablePrompt,
  tidyTurnPrompt,
  TIDY_SCHEMA,
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
import { limitTidyToPicked } from "./engine/tidyArea";
import { ExportSection, faceOnBed, type ExportCheck } from "./ui/ExportSection";
import { NumberField, Swatch, pct } from "./ui/common";
import { Brand, Glossary, Icon, Intro, Menu, Segmented, StepNav, Welcome, supportLinks } from "./ui/Shell";
import { ColourSelect } from "./ui/ColourSelect";
import { ColourPicker } from "./ui/ColourPicker";
import { GatherDialog } from "./ui/GatherDialog";
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
/** A toolbar toggle over both views: on, off, or "mixed" when they differ. */
function pairPressed(pair: [boolean, boolean]): boolean | "mixed" {
  return pair[0] === pair[1] ? pair[0] : "mixed";
}

/** From this much closer than the whole-model fit, the consult also gets the view on screen. */
const CLOSE_UP_ZOOM = 1.6;

const NO_OVERLAYS: HighlightOverlay[] = [];
const NO_CALLOUTS: Callout[] = [];
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
  const setTidyArea = (next: TidyArea) => {
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
      settings: Pick<PipelineSettings, "palette" | "merge" | "mergeFlags" | "stripByModel" | "mix">;
      colours: RGB[];
      chain: { base: RGB[]; result: RGB[] | null } | null;
      /** Colours a picked-patch tidy left (it bakes outside the tidy chain), and how many faces it changed. */
      result?: RGB[];
      faces?: number;
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
  const [atlasBuilding, setAtlasBuilding] = useState(false);
  const atlasRef = useRef<{ triangles: MeshModel["triangles"]; atlas: FaceAtlas } | null>(null);
  const faceGeometryRef = useRef<{ triangles: MeshModel["triangles"]; geometry: FaceGeometry } | null>(null);
  const [brushMode, setBrushMode] = useState(false);
  const [brushRadius, setBrushRadius] = useState(1);
  // Off by default: a brush held to a selection paints nothing until something
  // is selected, and "nothing happens" is the one failure a tool must not have.
  const [brushMaskOnly, setBrushMaskOnly] = useState(false);
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
  const strokeRef = useRef<{ working: RGB[]; mask: Uint8Array | null; count: number; rgb: RGB; hex: string } | null>(null);
  const viewerRef0 = useRef<MeshViewerHandle>(null);
  const viewerRef1 = useRef<MeshViewerHandle>(null);
  const viewerRef2 = useRef<MeshViewerHandle>(null);
  const viewerRefs = [viewerRef0, viewerRef1, viewerRef2];
  const mapRef = useRef<ColourMapHandle | null>(null);
  // Flat colours and soft edges for each side (0 = source, 1 = result), so the
  // two can be compared; the toolbar buttons set both.  Display only,
  // remembered per browser.
  const [paneLook, setPaneLookState] = useState<PaneLook>(loadPaneLook);
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
  const { palette, labels } = useMemo(() => {
    if (!model || !stripData) return { palette: [] as PaletteEntry[], labels: new Int32Array(0) };
    const built = stripPalette(committedGroups);
    const faceLabels = stripLabels(model.triangleColors, built.groupOfKey, built.palette);
    return { palette: built.palette, labels: faceLabels };
  }, [model, stripData, committedGroups]);
  const areaByPosition = useMemo(() => areaFractionByPosition(labels, palette.length, areaWeights), [labels, palette.length, areaWeights]);

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

  const sourceColours = useMemo(() => (model ? buildColourBuffer(model.triangles.length, (i) => model.triangleColors[i]) : null), [model]);
  const paletteColours = useMemo(
    () => (model && palette.length > 0 ? buildColourBuffer(model.triangles.length, (i) => palette[labels[i]]?.rgb ?? model.triangleColors[i]) : sourceColours),
    [model, palette, labels, sourceColours],
  );
  const printColours = useMemo(
    () =>
      model && palette.length > 0 && effectiveByIndex.size > 0
        ? buildColourBuffer(model.triangles.length, (i) => {
            const entry = palette[labels[i]];
            return (entry && effectiveByIndex.get(entry.index)) ?? entry?.rgb ?? model.triangleColors[i];
          })
        : paletteColours,
    [model, palette, labels, effectiveByIndex, paletteColours],
  );
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
  /** Two buffers taken in turn, so a drag does not allocate (and collect) 36 MB per move. */
  const dragBuffers = useRef<Float32Array[]>([]);
  const dragTurn = useRef(0);
  const dragColours = useMemo(() => {
    if (!model || !stripData || !previewCuts || !faceColourIndex) return null;
    const built = stripPalette(liveGroups);
    const linear = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const { index, keys } = faceColourIndex;
    const colourOf = new Float32Array(keys.length * 3);
    for (let u = 0; u < keys.length; u++) {
      const key = keys[u];
      const rgb = built.palette[built.groupOfKey.get(key) ?? 0]?.rgb ?? [(key >> 16) & 255, (key >> 8) & 255, key & 255];
      colourOf[u * 3] = linear(rgb[0]);
      colourOf[u * 3 + 1] = linear(rgb[1]);
      colourOf[u * 3 + 2] = linear(rgb[2]);
    }
    const size = model.triangles.length * 9;
    dragTurn.current = 1 - dragTurn.current;
    let out = dragBuffers.current[dragTurn.current];
    if (!out || out.length !== size) {
      out = new Float32Array(size);
      dragBuffers.current[dragTurn.current] = out;
    }
    for (let f = 0, p = 0; f < index.length; f++) {
      const o = index[f] * 3;
      const r = colourOf[o];
      const g = colourOf[o + 1];
      const b = colourOf[o + 2];
      out[p++] = r; out[p++] = g; out[p++] = b;
      out[p++] = r; out[p++] = g; out[p++] = b;
      out[p++] = r; out[p++] = g; out[p++] = b;
    }
    return out;
  }, [model, stripData, previewCuts, liveGroups, faceColourIndex]);
  const coloursForMode = (mode: PreviewMode) =>
    mode === "source" ? sourceColours : (dragColours ?? (mode === "palette" ? paletteColours : printColours));

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
  const [cutNotice, setCutNotice] = useState<"on" | "load" | "undone" | "off" | null>(null);
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
    const colours = model.triangleColors;
    const timer = window.setTimeout(() => {
      cutBorders(model, labels, shielded, cutSpan, settled)
        .then((cut) => {
          const layer: CutLayer = { triangles: model.triangles, paletteKey, paletteHex: hexByPosition, labels, cut };
          cutByColours.current.set(colours, { layer, triangles: model.triangles, span: cutSpan, protectedKey });
          if (alive) setCutLayer(layer);
        })
        .catch((err) => {
          if (!(err instanceof CutSuperseded)) console.warn("Border cut failed", err);
        });
    }, 150);
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
          detail: info ? `→ ${info.label}${info.recipe ? ` · ${info.recipe}` : ""}` : undefined,
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
        detail: info ? `→ ${info.label}${info.recipe ? ` · ${info.recipe}` : ""}` : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, pickedPatches, selectedHexes, palette, piecesCache, showRings, pointToView, extruderInfoByIndex, positionByHex, areaByPosition, t]);

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
            if (bytes <= OVERLAY_SHAPE_BUDGET || oldKey === key) break;
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
    if (!model || labels.length !== model.triangles.length || palette.length === 0) return;
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

  const pickedFaceCount = useMemo(() => pickedPatches.reduce((sum, patch) => sum + patch.faces.length, 0), [pickedPatches]);
  const pickedFraction = useMemo(() => pickedPatches.reduce((sum, patch) => sum + patch.fraction, 0), [pickedPatches]);
  const pickedHexes = useMemo(() => [...new Set(pickedPatches.map((patch) => patch.hex))], [pickedPatches]);
  const pickedExtruders = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ label: string; rgb: RGB; recipe: string; hex: string }> = [];
    for (const patch of pickedPatches) {
      const info = extruderInfoByIndex.get(patch.index);
      if (!info || seen.has(info.label)) continue;
      seen.add(info.label);
      out.push({ ...info, hex: patch.hex });
    }
    return out;
  }, [pickedPatches, extruderInfoByIndex]);

  const overlays = useMemo(
    () => [selectedOverlay, hoverOverlay, pickedOverlay, hoverPatchOverlay].filter((o): o is HighlightOverlay => o !== null),
    [selectedOverlay, hoverOverlay, pickedOverlay, hoverPatchOverlay],
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
    for (const { rgb, faces } of byColour.values()) for (const handle of viewerHandles()) handle.setFaceColours(faces, rgb);
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
    const { faces, shade, colours } = session;
    const each = new Uint8Array(faces.length * 3);
    for (let i = 0; i < faces.length; i++) {
      const rgb = colourOf.get(colours[shade[i]].key) as RGB;
      each[i * 3] = rgb[0];
      each[i * 3 + 1] = rgb[1];
      each[i * 3 + 2] = rgb[2];
    }
    const rep = colourOf.get(session.repKey) ?? colours[0].rgb;
    // The source view shows every shade; the palette and print views the group's one colour.
    viewerRef0.current?.setFaceColourList(faces, each);
    for (const handle of [viewerRef1.current, viewerRef2.current]) {
      if (!handle) continue;
      if (resultMode === "source") handle.setFaceColourList(faces, each);
      else handle.setFaceColours(faces, rep);
    }
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
    const current2d = atlasRef.current?.atlas;
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
    const position = labels[faceIndex];
    const hex = hexByPosition[position] ?? rgbToHex(current.triangleColors[faceIndex]);
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
    if (faceIndex !== null && info.piece !== undefined) faceIndex = faceShownAt(faceIndex, info.piece);
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
      } else if (info.toggle || shownHexRef.current !== null || gapModeRef.current) {
        // (The gap clean needs two colours, so there a click adds.)
        const next = exists ? current.filter((p) => p.id !== patch.id) : [...current, patch];
        setPickedPatches(next);
        setStatus(t(exists ? "status.pickRemoved" : "status.pickAdded", { index: patch.index, hex: patch.hex, ...selectionSummary(next) }));
        if (!exists) focusPatch(patch, info.source, faceIndex);
      } else {
        setPickedPatches([patch]);
        setStatus(t("status.picked", { index: patch.index, hex: patch.hex, n: patch.faces.length.toLocaleString(), pct: pct(patch.fraction), extruder: extruderText(patch.index) }));
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

  /** A palette colour exactly as the model has it, or a new colour. */
  function fillRgb(current: MeshModel, targetHex: string): RGB {
    // The group's own colour (the shade with the most area, as the palette shows it): filling with it
    // keeps it the most, so the group's colour — and the "change to" colour — stay as they are.
    const position = positionByHex.get(targetHex);
    return position !== undefined && palette[position] ? palette[position].rgb : hexToRgb(targetHex);
  }

  function applyPickColour(): void {
    if (!model || pickedPatches.length === 0) return;
    const targetHex = (pickTarget === "__new__" ? pickCustom : pickTarget).toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(targetHex)) return;
    const rgb = fillRgb(model, targetHex);
    const next = model.triangleColors.slice();
    let count = 0;
    for (const patch of pickedPatches) {
      for (let i = 0; i < patch.faces.length; i++) next[patch.faces[i]] = rgb;
      count += patch.faces.length;
    }
    keepGroupsFor(model.triangleColors, next);
    applyColours(model, next);
    setStatus(t("status.recoloured", { n: count.toLocaleString(), hex: targetHex, patches: pickedPatches.length }));
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
    keepGroupsFor(model.triangleColors, next);
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
    options?: { persist?: boolean; original?: RGB[]; history?: RGB[][]; restored?: boolean },
  ): void {
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
      manualPhysical: {},
      // The orientation belongs to the model: a face put down for the last one
      // used to stay and lay the next one over.  Restored work keeps its own.
      export: { ...prev.export, fileName: "", ...(options?.restored ? {} : { coordinateMode: orientationFor(info.kind) }) },
    }));
    setFitNonce((n) => n + 1);
    if (options?.persist === false) return;
    if (source && rememberWorkRef.current) void persistWorkFile(source, loadGenerationRef.current);
    else setAutosave({ state: "none", at: null });
  }

  async function onModelFile(file: File): Promise<void> {
    const kind: StoredWorkFile["kind"] = file.name.toLowerCase().endsWith(".3mf") ? "rodin" : "obj";
    setBusy(kind === "rodin" ? t("busy.readingRodin") : t("busy.readingObj"));
    await yieldToUi();
    try {
      const loaded = await parseModelFile(file, kind);
      installModel(loaded.model, loaded.info, { file, kind });
      setStatus(loaded.status);
      countAction(`load/${kind}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(t("status.error", { message: message === RODIN_TEXTURE_MODE_MESSAGE ? t("load.rodinTextureMode") : message }));
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

  async function restoreWork(): Promise<void> {
    const stored = await dataGet<unknown>(WORK_FILE_KEY);
    if (!isStoredWorkFile(stored) || loadGenerationRef.current !== 0) return;
    setBusy(t("busy.restoringWork"));
    await yieldToUi();
    try {
      const storedColours = await dataGet<unknown>(WORK_COLOURS_KEY);
      const storedCuts = await dataGet<unknown>(WORK_CUTS_KEY);
      const file = new File([stored.buffer], stored.name);
      const nomadPalette = stored.palette ? (unpackColours(stored.palette, Math.floor(stored.palette.length / 3)) ?? undefined) : undefined;
      const loaded = await parseModelFile(file, stored.kind, nomadPalette);
      if (loadGenerationRef.current !== 0) return;
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
      const colours =
        isStoredWorkColours(storedColours) && storedColours.faceCount === base.triangles.length
          ? unpackColours(storedColours.colours, storedColours.faceCount)
          : null;
      const restoredModel = colours
        ? { ...base, triangleColors: colours, stats: { ...base.stats, uniqueFaceColors: countUniqueColours(colours) } }
        : base;
      installModel(
        restoredModel,
        { ...loaded.info, uniqueColours: restoredModel.stats.uniqueFaceColors },
        { file, kind: stored.kind, palette: nomadPalette },
        { persist: false, original, history: colours ? [original] : [], restored: true },
      );
      const savedAt = colours && isStoredWorkColours(storedColours) ? storedColours.savedAt : stored.savedAt;
      setAutosave({ state: "saved", at: Number.isFinite(savedAt) ? savedAt : Date.now() });
      setStatus(t("status.workRestored", { name: stored.name, info: colours ? t("status.workRestoredColours") : t("status.workRestoredOriginal") }));
    } catch (err) {
      // Left in place: a failure in this window is no reason to delete what
      // another window may still be relying on.  "새로 시작" clears on purpose.
      setStatus(t("status.workRestoreFailed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
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

  function applyColours(current: MeshModel, next: RGB[], options?: { keepSelection?: boolean }): void {
    if (history.length >= 20) forgetOldestUndo("colours");
    setHistory((prev) => [...prev.slice(-19), current.triangleColors]);
    pushUndo("colours");
    setFuture([]);
    meshRedoRef.current = [];
    redoOrderRef.current = [];
    setModel({ ...current, triangleColors: next, stats: { ...current.stats, uniqueFaceColors: countUniqueColours(next) } });
    // the palette may be numbered anew: earlier recipe choices no longer line up
    forgetRecipeUndo();
    setSettings((prev) => ({ ...prev, manualPhysical: {} }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryTriangles]);

  // Full repaint of the map whenever the committed colours change.
  useEffect(() => {
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

  /** What the result view shows a face as, for the colour map (its group's colour, or the print's). */
  const mapLookRef = useRef<{ palette: PaletteEntry[]; labels: Int32Array; mode: PreviewMode; effective: Map<number, RGB> } | null>(null);
  const colourOfFace = useCallback((face: number): RGB => {
    const stroke = strokeRef.current;
    if (stroke) return stroke.working[face];
    const look = mapLookRef.current;
    const entry = look && look.mode !== "source" && look.labels.length > face ? look.palette[look.labels[face]] : undefined;
    if (entry) return (look?.mode === "print" && look.effective.get(entry.index)) || entry.rgb;
    return modelRef.current?.triangleColors[face] ?? [128, 128, 128];
  }, []);

  function viewerHandles(): MeshViewerHandle[] {
    return viewerRefs.map((r) => r.current).filter((h): h is MeshViewerHandle => h !== null);
  }

  /** Starts a stroke; returns false when the brush is limited to a selection and there is none. */
  function beginStroke(): boolean {
    const current = modelRef.current;
    if (!current) return false;
    if (strokeRef.current) return true;
    if (brushMaskOnly && !pickedMask) {
      setStatus(t("status.brushNeedsSelection"));
      return false;
    }
    strokeRef.current = { working: current.triangleColors.slice(), mask: brushMaskOnly ? pickedMask : null, count: 0, rgb: hexToRgb(brushHex), hex: brushHex };
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
    for (const handle of viewerHandles()) handle.setFaceColours(changed, rgb);
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
    keepGroupsFor(current.triangleColors, stroke.working);
    applyColours(current, stroke.working, { keepSelection: true });
    setStatus(t("status.brushed", { n: stroke.count.toLocaleString(), hex: stroke.hex }));
  }

  function showBrushCursorAt(hit: ViewerHit | null): void {
    const blocked = brushMaskOnly && (!pickedMask || hit === null || !pickedMask[hit.faceIndex]);
    for (const handle of viewerHandles())
      handle.setBrushCursor(hit ? { point: hit.point, normal: hit.normal, radius: brushRadius, blocked } : null);
  }

  function brushHover3D(hit: ViewerHit | null): void {
    showBrushCursorAt(hit);
    const current = atlasRef.current?.atlas ?? null;
    mapRef.current?.setRemoteCursor(hit && current ? faceAtlasCentre(current, hit.faceIndex) : null);
  }

  function paintAtHit(hit: ViewerHit | null, slot: number): void {
    const current = modelRef.current;
    if (!hit || !current || !strokeRef.current) return;
    const viewDir = viewerRefs[slot]?.current?.viewDirection() ?? null;
    paintFaces(
      facesInSphere(faceGeometryFor(current), pointToModel(hit.point), brushRadius, viewDir ? pointToModel(viewDir) : null),
    );
  }

  function brushStart3D(hit: ViewerHit | null, slot: number): void {
    if (!beginStroke()) return;
    paintAtHit(hit, slot);
  }

  function brushDrag3D(hit: ViewerHit | null, slot: number): void {
    brushHover3D(hit);
    paintAtHit(hit, slot);
  }

  function mapHover(face: number | null): void {
    if (!brushMode) {
      hoverFace(face);
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
    const radius = model ? faceGeometryFor(model).radius : 1;
    return { min: radius * 0.003, max: radius * 0.6 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryTriangles]);
  const brushSliderValue = Math.round(1000 * Math.max(0, Math.min(1, Math.log(brushRadius / brushBounds.min) / Math.log(brushBounds.max / brushBounds.min))));
  const setBrushRadiusClamped = (next: number) => setBrushRadius(Number(Math.max(brushBounds.min, Math.min(brushBounds.max, next)).toPrecision(3)));

  // [ and ] shrink / grow the brush while brush mode is on.
  useEffect(() => {
    if (!brushMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;
      const target = event.target as HTMLElement | null;
      if (typingIn(target)) return;
      event.preventDefault();
      setBrushRadiusClamped(brushRadius * (event.key === "[" ? 0.8 : 1.25));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushMode, brushRadius, brushBounds]);

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
      } else if (event.code === "KeyB") setBrushMode((v) => !v);
      else if (event.code === "KeyG") setFillMode((v) => !v);
      else if (event.code === "KeyI") setEyedropper((v) => !v);
      else if (event.code === "KeyC") setGapMode((v) => !v);
      else return;
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
  }, []);
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
        return {
          hex,
          areaPct: (areaByPosition[position] ?? 0) * 100,
          family: group ? familyName(group.family) : "?",
          shades: group?.colours.length ?? 1,
          protected: Boolean(settings.mergeFlags[hex]?.protect),
          output: stripOutputOf(hex)?.label,
        };
      }),
      slots: slots.map((slot) => ({ label: `E${slot.slot}`, hex: rgbToHex(slot.filament.rgb), name: slot.filament.name })),
      mix: settings.mix,
      mixScores: null,
      layerHeight: layerHeightMm ?? null,
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
  function takeTidyPictures(scope: TidyScope, closeUp: boolean): { stable: string[]; stableLabels: string[]; current: string[]; currentLabels: string[] } | null {
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
    const add = (colours: Float32Array | null, views: ViewName[], what: string) => {
      if (!colours) return;
      for (const shot of renderViews(positions, colours, views)) {
        current.push(shot.dataUrl);
        currentLabels.push(`${what} ${viewName[shot.view]}`);
      }
    };
    if (scope === "clean") add(palettePics, ["front", "back", "left", "right", "top", "iso"], "결과(02 팔레트)");
    else if (scope === "mix") add(printPics, ["front", "back", "left", "right", "top", "iso"], "결과(03 출력 시뮬레이션)");
    else {
      add(palettePics, ["front", "back", "iso"], "결과(02 팔레트)");
      add(printPics, ["front", "back", "iso"], "결과(03 출력 시뮬레이션)");
    }
    // What the owner is looking at, once zoomed in (or asked for, as the face
    // preset does): the same view before the tidy and now.  Small things like
    // eyes and a mouth are a few pixels in the whole-model pictures.
    const pose = (showResult ? viewerRef2 : viewerRef0).current?.cameraPose() ?? null;
    if (pose && (closeUp || pose.zoom >= CLOSE_UP_ZOOM)) {
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
  function applyTidy(changes: TidyChanges, entryId: string, title: string, lines: ChangeLine[], dropped?: string[]): void {
    if (!model) return;
    // A chain from before the mesh changed (a cut confirmed or undone) cannot be gone back to.
    if (tidyChainRef.current && tidyChainRef.current.base.length !== model.triangles.length) tidyChainRef.current = null;
    const touchesClean = hasCleanChanges(changes);
    const chain = tidyChainRef.current;
    const showingTidy = chain !== null && chain.result === model.triangleColors;
    pushTidyUndo({
      entryId,
      title,
      lines,
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
    if (model.triangleColors !== saved.colours) applyColours(model, saved.colours, { keepSelection: true });
    tidyChainRef.current = saved.chain;
    tidyUndoRef.current = steps.slice(0, -1);
    setTidyUndoCount(tidyUndoRef.current.length);
    setTidyResult({ entryId: saved.entryId, title: saved.title, lines: saved.lines, undone: true, faces: saved.faces });
    setTidyLog((prev) => [
      ...prev.map((entry) => (entry.id === saved.entryId && entry.status === "applied" ? { ...entry, status: "undone" as const } : entry)),
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

  function applyTidySuggestion(entryId: string): void {
    const entry = tidyLog.find((e) => e.id === entryId);
    const context = buildTidyContext();
    if (!entry?.changes || !context || busy !== null) return;
    // The values as shown, re-checked against the palette as it is now.
    const { changes, dropped } = sanitizeChanges(entry.changes, context, entry.scope, t);
    const lines = describeChanges(changes, context, t);
    setTidyLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: lines.length > 0 ? "applied" : "none", lines } : e)));
    applyTidy(changes, entryId, t("tidy.bySuggestion"), lines, dropped);
  }

  async function tidyAsk(message: string, analyse: boolean, closeUp = false): Promise<void> {
    if (!model || tidyBusy !== null || busy !== null) return;
    const scope = tidyScope;
    const history = tidyLog.filter((entry) => entry.model === tidyModelName);
    const at = () => new Date().toISOString();
    setTidyLog((prev) => [...prev, { id: `u${Date.now()}`, role: "user", text: message, at: at(), model: tidyModelName, scope }]);
    const controller = new AbortController();
    tidyAbortRef.current = controller;
    try {
      const context = buildTidyContext();
      if (!context) return;
      if (scope !== "clean") {
        setTidyBusy(t("tidy.busyScores"));
        context.mixScores = await rateMixOptions().catch(() => null);
      }
      setTidyBusy(t("tidy.busyShots"));
      await yieldToUi();
      const pictures = takeTidyPictures(scope, closeUp);
      if (!pictures) return;
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
        aiRoute ?? "local",
      );
      if (aiRoute === "key") setKeyUsage(loadKeyUsage());
      if (!answer.ok) throw new Error(answer.error);
      const raw = answer.result;
      // The state may have moved while Claude was thinking: check against it as it is now.
      const now = buildTidyContext() ?? context;
      const { changes, dropped } = sanitizeChanges(raw.changes, now, scope, t);
      const lines = describeChanges(changes, now, t);
      const asked = raw.asked_to_change === true && !analyse;
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
        status: lines.length === 0 ? "none" : asked ? "applied" : "suggested",
        dropped: dropped.length ? dropped : undefined,
      };
      setTidyLog((prev) => [...prev, entry]);
      // The mesh may have changed while Claude was thinking (a cut confirmed or undone): then the answer is only kept as a suggestion.
      const sameMesh = modelRef.current !== null && modelRef.current.triangles === model?.triangles;
      if (asked && lines.length > 0 && sameMesh) applyTidy(changes, entry.id, t("tidy.byAi"), lines, dropped);
    } catch (err) {
      const stopped = controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError");
      setTidyLog((prev) => [
        ...prev,
        {
          id: `s${Date.now()}`,
          role: "sys",
          text: stopped ? t("tidy.stopped") : t("tidy.failed", { message: err instanceof Error ? err.message : String(err) }),
          at: at(),
          model: tidyModelName,
          scope,
        },
      ]);
    } finally {
      setTidyBusy(null);
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
  async function modelForExport(current: MeshModel): Promise<MeshModel> {
    if (cutSpan <= 0 || palette.length === 0 || labels.length !== current.triangles.length) return current;
    let cut: BorderCut | null = null;
    for (let attempt = 0; attempt < 3 && !cut; attempt++) {
      try {
        cut = await cutBorders(current, labels, protectedPositions(), cutSpan, settledFaces(current), "export");
      } catch (err) {
        if (!(err instanceof CutSuperseded)) throw err;
      }
    }
    if (!cut || cut.replaced.length === 0) return current;
    return cutModelOf(current, cut, labels).model;
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
  useEffect(() => {
    // Once up, it is the "on" notice: it stays while a recolour's cut is worked out again.
    if (cutNotice === "load" && cutReady) setCutNotice("on");
  }, [cutNotice, cutReady]);

  function toggleCut(on: boolean): void {
    patchSettings("export", { ...settings.export, cutSpan: on ? CUT_SPAN : 0 });
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
      const settled = new Uint8Array(after.triangles.length * 3);
      for (let i = 0; i < after.triangles.length; i++) {
        const p = mesh.piece[i];
        const rgb = palette[p >= 0 ? cut.pieceGroups[p] : labels[mesh.originalFace[i]]]?.rgb;
        if (rgb) settled.set(rgb, i * 3);
      }
      settledRef.current.set(after.triangles, settled);
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
      const model = await modelForExport(source);
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
      const faceColours = model.triangleColors.map((rgb) => palette[nearestPaletteIndex(rgb, palette, settings.palette.accentProtection)]?.rgb ?? rgb);
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
      setStatus(t("status.colourExported", { file: result.fileName, colours: result.colourCount, faces: result.triangleCount.toLocaleString() }));
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
      const model = await modelForExport(source);
      const fileName = (e.fileName.trim() || defaultFileName).replace(/\.3mf$/i, "") + ".3mf";
      const result = await buildPrusa3mfBlob({
        slicer: printer.slicer,
        bambuPrinter: printer.bambuProject,
        fileName,
        templateArrayBuffer: template?.buffer ?? null,
        templateInfo: template?.info ?? null,
        model,
        adjustedColors: model.triangleColors,
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
        accentProtection: settings.palette.accentProtection,
        splitObjects: e.splitObjects,
        // PrusaSlicer's XL profiles and the template's config mean nothing to other slicers.
        printPreset: prusa ? e.printPreset : null,
        printPresetSupportWord: t("exp.supportPresetSuffix"),
        includePrinterConfig: prusa && e.includePrinterConfig && templateFitsPrinter(printer, template?.info.printerModel),
        effectiveRgbByPaletteIndex: effectiveByIndex,
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
          config: result.summary.printerConfigIncluded ? t("status.configIncluded") : t("status.configOmitted"),
          objects: result.summary.objectCount,
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
    softEdges: paneLook.soft[slot === 0 ? 0 : 1],
    cornerVertex,
    brush: brushMode,
    eyedropper,
    hand,
    background,
    // The welcome card (already played by the intro) in the first pane, once the intro has gone (two cards at
    // once read as a double); a second pane (side by side) just says what comes there.
    emptyLabel: slot === 0 ? (intro ? "" : <Welcome hint={t("view.empty")} still />) : t("view.empty"),
    onPick: (face: number | null, info: PickInfo) => void handlePick(face, info),
    onHoverFace: hoverFace,
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
    const linearOf = new Map<number, [number, number, number]>();
    const colourOf = (position: number) => {
      let lin = linearOf.get(position);
      if (!lin) {
        const entry = palette[position];
        const rgb = (resultMode === "print" && effectiveByIndex.get(entry.index)) || entry.rgb;
        lin = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
        linearOf.set(position, lin);
      }
      return lin;
    };
    const points = new Float32Array(kept.length * 9);
    const colours = new Float32Array(kept.length * 9);
    const parentFace = new Int32Array(kept.length);
    const corners = new Int32Array(kept.length * 3);
    kept.forEach((p, i) => {
      const lin = colourOf(keptGroup[i]);
      for (let k = 0; k < 3; k++) {
        const v = cut.pieces[p * 3 + k];
        const o = i * 9 + k * 3;
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
        colours[o] = lin[0];
        colours[o + 1] = lin[1];
        colours[o + 2] = lin[2];
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
          </div>
        )}
        <StepNav steps={stepInfo} current={step} onChange={changeStep} />
        <div className="top-actions">
          {/* how many steps ⌘Z can still take back (colour changes and strip cuts), and ⇧⌘Z bring again */}
          <button type="button" className="icon-btn with-count" aria-label={t("app.undo")} title={`${t("top.undo")} · ${t("top.stepsLeft", { n: history.length + stripUndo.length + meshUndoRef.current.length })}`} disabled={isBusy || tidyBusy !== null || (history.length === 0 && stripUndo.length === 0 && meshUndoRef.current.length === 0)} onClick={undoAny}>
            <Icon name="undo" />
            {history.length + stripUndo.length + meshUndoRef.current.length > 0 && <span className="step-count mono">{history.length + stripUndo.length + meshUndoRef.current.length}</span>}
          </button>
          <button type="button" className="icon-btn with-count" aria-label={t("app.redo")} title={`${t("top.redo")} · ${t("top.stepsLeft", { n: future.length + meshRedoRef.current.length })}`} disabled={isBusy || tidyBusy !== null || (future.length === 0 && meshRedoRef.current.length === 0)} onClick={redo}>
            <Icon name="redo" />
            {future.length > 0 && <span className="step-count mono">{future.length}</span>}
          </button>
          <span className="top-sep" aria-hidden="true" />
          <Menu trigger={<Icon name="help" />} label={t("top.glossary")} title={t("top.glossary")} className="glossary">
            <Glossary />
          </Menu>
          <Menu trigger={<Icon name="settings" />} label={t("top.settings")} title={t("top.settings")}>
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
                workState={model ? { restored: workRestored, undoSteps: history.length } : null}
                onClearWork={clearWork}
                onRecolour={recolourPaletteColour}
                onOpenGather={() => setGatherOpen(true)}
              />
              </>
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
                log={tidyLog.filter((entry) => entry.model === tidyModelName)}
                busy={tidyBusy}
                elapsed={tidyElapsed}
                onSend={(message) => void tidyAsk(message, false)}
                onAnalyse={() => void tidyAsk(t("tidy.analyseMessage"), true)}
                onStop={() => tidyAbortRef.current?.abort()}
                onApplySuggestion={applyTidySuggestion}
                onConsultPreset={tidyConsultPreset}
                connection={{
                  route: aiRoute,
                  keyMask: apiKey ? maskKey(apiKey) : null,
                  usage: keyUsage,
                  onSaveKey: (key) => {
                    saveApiKey(key);
                    setApiKey(key);
                  },
                  onClearKey: () => {
                    saveApiKey(null);
                    setApiKey(null);
                  },
                }}
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
                onToggleSelected={toggleSelectedHex}
                outputOf={stripOutputOf}
                flags={settings.mergeFlags}
                onFlagChange={updateFlag}
                mergeSettings={settings.merge}
                onMergeSettings={(next) => patchSettings("merge", next)}
                targetGroups={targetGroups}
                onTargetChange={(n) => patchSettings("palette", { ...settings.palette, maxColours: Math.max(2, Math.min(64, n)) })}
                onSplitGroup={(family, fraction) => keepStripCuts(addCut(committedCuts, family, fraction))}
                onMergeUp={(family, index) => keepStripCuts(removeCut(committedCuts, family, index))}
                onMergeSelected={mergeSelected}
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
                  <b>{fillMode ? t("fill.title") : t("brush.title")}</b>
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
                  {(pickTarget === "__new__" || !pickTarget) && <ColourPicker value={pickCustom} onChange={(hex) => setPickCustom(hex.toUpperCase())} />}
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
                  {brushMode ? (
                    <>
                      <span>{t("brush.size")}</span>
                      <NumberField value={brushRadius} min={0.001} max={10000} step={Math.max(0.001, Number((brushRadius / 5).toPrecision(1)))} onChange={(v) => setBrushRadiusClamped(v)} />
                      <span className="muted">{t("brush.keys")}</span>
                      <label className="inline" style={{ gap: 6 }}>
                        <input type="checkbox" checked={brushMaskOnly} onChange={(e) => setBrushMaskOnly(e.target.checked)} /> {t("brush.maskOnly")}
                      </label>
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
              {model && (pickedPatches.length > 0 || shownHex) && (
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
                      {pickedExtruders.length > 0 && (
                        <span className="pick-extruders" title={t("pick.extruderHint")}>
                          <span className="muted">→ {t("pick.extruder")}</span>
                          {pickedExtruders.slice(0, 4).map((info) => (
                            <span key={info.label} className="pick-extruder">
                              <Swatch rgb={info.rgb} size={14} />
                              <b>{info.label}</b>
                              {info.recipe && <span className="muted">{info.recipe}</span>}
                            </span>
                          ))}
                          {pickedExtruders.length > 4 && <span className="muted">+{pickedExtruders.length - 4}</span>}
                        </span>
                      )}
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
                          { value: "__new__", hex: pickCustom, label: t("pick.newColour") },
                        ]}
                      />
                      {pickTarget === "__new__" && <ColourPicker value={pickCustom} onChange={(hex) => setPickCustom(hex.toUpperCase())} />}
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
                        onClick={applyPickColour}
                      >
                        {t("pick.apply")}
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
                <span className="muted">{t("brush.keys")}</span>
                <label className={`mask-toggle${brushMaskOnly && !pickedMask ? " warn" : ""}`} title={t("brush.selectFirst")}>
                  <input type="checkbox" checked={brushMaskOnly} onChange={(e) => setBrushMaskOnly(e.target.checked)} /> {t("brush.maskOnly")}
                </label>
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
                atlas={atlas}
                building={atlasBuilding}
                colourOf={colourOfFace}
                coloursVersion={coloursVersion}
                masks={atlasMasks}
                brush={{ active: brushMode, radiusPx: atlas ? brushRadius * atlas.scale : 4, hex: brushHex }}
                eyedropper={eyedropper}
                hand={hand}
                background={background}
                onPick={(face, info) => void handlePick(face, info)}
                onHover={mapHover}
                onBrushStart={() => void beginStroke()}
                onBrushPaint={paintFaces}
                onBrushEnd={endStroke}
                label={t("map.label")}
                hint={t("map.hint")}
                emptyLabel={t("map.empty")}
                buildingLabel={t("busy.atlas")}
              />
            )}
            {step === 4 && layerPreview && printHeightMm !== null && (
              // shown again whenever the layer height or the soft/sharp look changes
              <span key={`${shownLayerHeight}|${paneLook.soft[1]}`} className="view-chip passing" style={chipStyle}>
                {t("layers.note", { mm: printHeightMm.toFixed(0), n: Math.ceil(printHeightMm / shownLayerHeight - 1e-6).toLocaleString() })}
              </span>
            )}
            {step === 3 && mixRow && (
              <span className="view-chip" style={chipStyle}>
                <span className="sw" style={{ background: mixRow.hex }} />
                <span className="mono">{mixRow.label}</span>
                <span className="mono muted">
                  {mixRow.hex} · {(mixRow.area * 100).toFixed(1)}%
                </span>
              </span>
            )}
            {dragging && compareStep && showResult && (
              <span className="drag-badge" style={{ left: showSource ? `calc(${100 / paneCount}% + 12px)` : 12 }}>
                {t("view.dragging")}
              </span>
            )}
            {compareStep && cutNoticeShown && cutNotice && (
              <div className="cut-notice" role="status">
                <span className="cut-notice-icon">
                  <Icon name="cutLine" size={13} stroke={1.5} />
                </span>
                <span className="cut-notice-body">
                  <span className="cut-notice-title">{t(`cutNotice.${cutNoticeText}.title` as Key)}</span>
                  <span className="cut-notice-detail">{t(`cutNotice.${cutNoticeText}.detail` as Key)}</span>
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
                      {t("toast.area")} <span className="mono">{(toast.area[0] * 100).toFixed(1)} → {(toast.area[1] * 100).toFixed(1)}%</span>
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
              <button type="button" aria-pressed={!brushMode && !fillMode && !eyedropper && !gapMode} title={t("pick.hint")} onClick={() => { setBrushMode(false); setFillMode(false); setEyedropper(false); setGapMode(false); }}>
                <Icon name="select" size={17} stroke={1.4} />
                <span>
                  {t("tool.select")} <span className="key">V</span>
                </span>
              </button>
              <button type="button" aria-pressed={brushMode} title={t("brush.hint")} onClick={() => setBrushMode((v) => !v)}>
                <Icon name="brush" size={17} stroke={1.4} />
                <span>
                  {t("tool.brush")} <span className="key">B</span>
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
      {intro && <Intro onDone={endIntro} hold={startupLoading} />}
      {about && <Intro onDone={endAbout} about={{ note: `${t("app.subtitle")} · ${t("top.version", { v: APP_VERSION })} · ${t("license.short")}` }} />}
    </div>
    </LangContext.Provider>
  );
}
