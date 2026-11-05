import type { Key, Translate } from "../i18n";
import type { ExportSettings, MixSettings } from "./types";

/**
 * Auto tidy: presets (rules, instant) and the AI consult share one shape of
 * change.  "clean" is step 02 (how many colours, islands, jagged edges,
 * protected and merged groups, regions painted, group colours), "mix" is step
 * 03 (mixing settings, a colour's own recipe or one filament), "export" is
 * step 04 (size, pieces, holes, the border cut).
 */
export type TidyScope = "clean" | "mix" | "both" | "export";

/** Step 04's settings the consult may change. */
export interface TidyExportChanges {
  targetHeight?: number;
  splitObjects?: boolean;
  splitAsParts?: boolean;
  closeHoles?: boolean;
  putOnBed?: boolean;
  centerOnBed?: boolean;
  /** The border cut (선 따라 자르기) on or off. */
  borderCut?: boolean;
  printPreset?: NonNullable<ExportSettings["printPreset"]>;
}

export type TidyMixChanges = Partial<
  Pick<MixSettings, "assignmentMode" | "maxComponents" | "recipeResolution" | "accentProtection" | "mappingStrategy" | "mixPriority" | "autoPhysicalDirect" | "physicalDirectDeltaE">
>;

export interface TidyChanges {
  /** Target colour count (02), 2..64. */
  target?: number;
  /** Islands smaller than this many faces are absorbed by their surroundings. */
  minBlob?: number;
  /** Rounds of smoothing along colour borders (jagged edges). */
  smoothing?: number;
  /** Protected colours (eyes, mouth lines) are smoothed too, without being cut or erased. */
  smoothProtected?: boolean;
  /** Rounds of trimming triangles that stick out of borders (teeth), 0 = off. */
  trimTeeth?: number;
  /** Straightening border lines: stairs shorter than this many border edges go (a gentle line through them), 0 = off. */
  lineSmooth?: number;
  /** Palette colours (hex) to protect from being absorbed / to stop protecting. */
  protect?: string[];
  unprotect?: string[];
  /** Palette colour `from` is merged into `into`. */
  merge?: Array<{ from: string; into: string }>;
  /** Preset only: after laying the colours out again, protect the small vivid ones. */
  protectAccents?: boolean;
  /** The part map (shape first): what the model is and which cells (1-based, as on the pictures) make each part. Not a colour change. */
  parts?: { subject: string; list: Array<{ name: string; cells: number[] }> };
  /** One colour per part: inside the part, colours other than `main` and the kept details take `main` (a new colour makes a group of its own). */
  partTidy?: Array<{ part: string; main: string; keep: string[] }>;
  /** Cells (1-based) painted with a colour — only their faces of the `from` colours, when given. */
  paint?: Array<{ cells: number[]; into: string; from?: string[] }>;
  /** Dark holes and dents (by number in the pit list) painted with a colour: a button's eye holes. */
  pits?: Array<{ ids: number[]; into: string }>;
  /** Colour borders moved to the deepest groove within this many rings of faces on each side (0 = off). */
  creaseSnap?: number;
  /** A part up close: its blobs (by number) grouped into pieces, each one colour. */
  pieces?: Array<{ name: string; blobs: number[]; colour: string }>;
  /**
   * 🤖 every part up close: each part's blobs (by number, its own numbering) in a colour of the
   * model's palette.  What a part leaves out (a blob blurred across two things) takes the colour
   * of the side next to it that is cheapest to reach.
   */
  assign?: Array<{ part: string; blobs: number[]; colour: string; what?: string; mine?: boolean }>;
  /**
   * 🤖 a thing pointed at on a picture (a bag's stripe, a brooch's dot): the face under the point, spread
   * over the model's own colour of that thing (a magic wand), in this colour — over what the votes gave.
   */
  marks?: Array<{ part: string; seed: number; colour: string; what?: string; shaded?: boolean }>;
  /**
   * 💬 a thing to paint that no blob or cell holds alone (a thin white rim round an eye): the app asks again with
   * a grid on the part's original pictures, the AI points at it, and the points become `marks` (11-05, the owner:
   * "색이 안 잡힌다는 이유로 아무것도 안 했어 — 직접 영역을 잡아서 칠해야지").  Never left in a plan that is applied.
   */
  fix?: Array<{ part: string; what: string; colour: string; problem: string }>;
  /** A group's colour changed (every face of it, the group stays). */
  recolour?: Array<{ hex: string; to: string }>;
  mix?: TidyMixChanges;
  /** 03: a colour's own mixture, layers per filament slot ("1".."5"). */
  recipes?: Array<{ hex: string; counts: Record<string, number> }>;
  /** 03: a colour printed with one filament alone. */
  single?: Array<{ hex: string; extruder: number }>;
  /** 03: colours back to the automatic recipe (a hand-set mixture or filament taken off). */
  autoRecipe?: string[];
  export?: TidyExportChanges;
}

/** The part map as the AI reads it: each part's size and the colours in it. */
export interface TidyShape {
  subject: string;
  cellCount: number;
  parts: Array<{ name: string; areaPct: number; cells: number[]; colours: Array<{ hex: string; pct: number }> }>;
}

/** Step 04 as the AI reads it. */
export interface TidyExportInfo {
  printer: string;
  /** The settings as they are (the quality preset: "template" when the template's own is kept). */
  settings: Required<Omit<TidyExportChanges, "printPreset">> & { printPreset: string };
  /** Size of the model as it would print (mm), when known. */
  sizeMm: [number, number, number] | null;
  bed: [number, number];
  /** Separate pieces of the mesh, open holes found, colours printed, filament slots. */
  pieces: number | null;
  colours: number;
  extruders: number;
  /** What the last export said (pieces, holes closed …), if there was one. */
  lastExport: string | null;
}

/** One group of the current palette, as the AI and the presets see it. */
export interface TidyColour {
  hex: string;
  /** Share of the surface, 0..100. */
  areaPct: number;
  family: string;
  /** How many source colours the group holds. */
  shades: number;
  protected: boolean;
  /** Where it prints (E2, VE14 …), when step 03 has a plan. */
  output?: string;
  /** 03: how it prints in layers ("E1 2 · E4 1 · E5 2"), the colour that comes out, and whether the owner set it by hand. */
  recipe?: string;
  printed?: string;
  hand?: boolean;
}

export interface TidyMixScore {
  components: number;
  resolution: MixSettings["recipeResolution"];
  fidelity: number;
  meanError: number;
  cycleLayers: number;
  lost: number;
  recommended: boolean;
}

export interface TidyContext {
  modelName: string;
  faces: number;
  /** Source colours the strip is laid out from (53,490 for a raw AI-made model, a few dozen after a tidy). */
  sourceColours: number;
  target: number;
  minBlob: number;
  smoothing: number;
  smoothProtected: boolean;
  trimTeeth: number;
  lineSmooth: number;
  palette: TidyColour[];
  slots: Array<{ label: string; hex: string; name: string }>;
  mix: MixSettings;
  mixScores: TidyMixScore[] | null;
  layerHeight: number | null;
  /** 02: the cells on the pictures (how many) and the part map, when there is one. */
  cellCount?: number;
  shape?: TidyShape | null;
  /** 02: the patches too small to number, per colour. */
  specks?: Array<{ hex: string; patches: number; tiny: number; faces: number }> | null;
  /** 02: dark holes and dents found in the sculpt (eye holes, nostrils, seams). */
  pits?: Array<{ id: number; inside: string; around: string[]; areaPct: number; faces: number; own: string; part?: string }> | null;
  /** 02, a part up close: the part and its blobs (numbered on the close-ups). */
  focus?: { part: string; blobs: Array<{ id: number; areaPct: number; mean: string; family: string }> } | null;
  /** 04. */
  exportInfo?: TidyExportInfo | null;
}

export interface TidyPreset {
  id: "crisp" | "gradient" | "solid" | "detail" | "trim" | "line";
  icon: string;
}

/** Requests to the consult that come ready-made (the text goes to Claude as the owner's words). */
export interface TidyConsultPreset {
  id: "face";
  icon: string;
  /** Pictures of the view as it is on screen go along (zoomed in on what it is about). */
  closeUp: boolean;
}

export const TIDY_CONSULT_PRESETS: TidyConsultPreset[] = [{ id: "face", icon: "😊", closeUp: true }];

export const TIDY_PRESETS: TidyPreset[] = [
  { id: "crisp", icon: "▣" },
  { id: "gradient", icon: "◐" },
  { id: "solid", icon: "■" },
  { id: "detail", icon: "✦" },
  { id: "trim", icon: "◇" },
  { id: "line", icon: "〰" },
];

const RESOLUTIONS: MixSettings["recipeResolution"][] = ["thirds", "half-thirds", "grid25", "grid20", "grid10", "grid5"];
const MAPPINGS: MixSettings["mappingStrategy"][] = ["closest", "smooth", "preserve-hue", "preserve-accent", "warm-neutral"];
const PRIORITIES: MixSettings["mixPriority"][] = ["accurate", "preserve-hue", "avoid-muddy"];
const ACCENTS: MixSettings["accentProtection"][] = ["off", "balanced", "strong"];
const PRESETS = ["finest", "high", "normal", "fast", "draft"] as const;

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * What each preset changes.  The numbers, and why:
 * - crisp: 6 smoothing rounds (twice the default 3) straighten borders; islands under 300 faces
 *   (default 150) go, so a border is not peppered with specks.  Mixing: 2 filaments in thirds —
 *   the shortest repeat, so a mixed area shows the fewest layer stripes at its edge.
 * - gradient: at least 32 colours (64 at most) so a shading keeps its steps; 1 smoothing round
 *   and 40-face islands, so the steps are not ironed flat.  Mixing: 3 filaments at 25 % — finer
 *   in-between colours at a still short repeat; "smooth" mapping keeps neighbours in order.
 * - solid: about 1.5 groups per colour family that covers at least 0.5 % (6..16 in all); 8
 *   smoothing rounds and 600-face islands for clean flat areas.  Mixing: thirds, and any colour
 *   within ΔE 10 of a loaded filament prints as that filament, not as a mix.
 * - detail: islands down to 20 faces are kept and only 2 smoothing rounds, small vivid colours
 *   are protected.  Mixing: accents kept (balanced) and mapped by accent.
 * - trim: 3 rounds of trimming the triangles that stick out of borders, so a border runs as
 *   evenly as its triangles allow — three rounds take teeth up to three faces deep, more
 *   would start rounding off real points.  Colours only; the mixing stays.
 * - line: the border lines redrawn as gentle lines through their stairs — stairs and bends
 *   shorter than 16 border edges straighten, longer curves (the shape of a part) stay — then
 *   the teeth trim (3) for what still sticks out.  Colours only; the mixing stays.
 */
export function presetChanges(id: TidyPreset["id"], context: TidyContext, scope: TidyScope): TidyChanges {
  const clean = scope !== "mix";
  const mix = scope !== "clean";
  const out: TidyChanges = {};
  if (id === "crisp") {
    if (clean) Object.assign(out, { smoothing: 6, minBlob: 300 });
    if (mix) out.mix = { assignmentMode: "physical-and-virtual", maxComponents: 2, recipeResolution: "thirds", mappingStrategy: "closest" };
  } else if (id === "gradient") {
    if (clean) Object.assign(out, { target: clampInt(Math.max(context.target, 32), 2, 64), smoothing: 1, minBlob: 40 });
    if (mix) out.mix = { assignmentMode: "physical-and-virtual", maxComponents: 3, recipeResolution: "grid25", mappingStrategy: "smooth" };
  } else if (id === "solid") {
    const families = new Map<string, number>();
    for (const colour of context.palette) families.set(colour.family, (families.get(colour.family) ?? 0) + colour.areaPct);
    const big = [...families.values()].filter((pct) => pct >= 0.5).length;
    if (clean) Object.assign(out, { target: clampInt(big * 1.5, 6, 16), smoothing: 8, minBlob: 600 });
    if (mix) out.mix = { assignmentMode: "physical-and-virtual", maxComponents: 2, recipeResolution: "thirds", autoPhysicalDirect: true, physicalDirectDeltaE: 10 };
  } else if (id === "detail") {
    if (clean) Object.assign(out, { smoothing: 2, minBlob: 20, protectAccents: true });
    if (mix) out.mix = { accentProtection: "balanced", mappingStrategy: "preserve-accent" };
  } else if (id === "trim") {
    if (clean) out.trimTeeth = 3;
  } else if (id === "line") {
    if (clean) Object.assign(out, { lineSmooth: 16, trimTeeth: 3 });
  }
  return out;
}

/** Keeps only what the scope allows and what is valid; says what was left out. */
export function sanitizeChanges(raw: unknown, context: TidyContext, scope: TidyScope, t: Translate): { changes: TidyChanges; dropped: string[] } {
  const dropped: string[] = [];
  const changes: TidyChanges = {};
  if (!raw || typeof raw !== "object") return { changes, dropped };
  const r = raw as Record<string, unknown>;
  const hexes = new Set(context.palette.map((c) => c.hex));
  const HEX = /^#[0-9A-F]{6}$/;
  const hexList = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v).toUpperCase()).filter((hex) => HEX.test(hex)) : []);
  const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const objects = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object") : [];
  const clean = scope === "clean" || scope === "both";
  const mix = scope === "mix" || scope === "both";
  const exporting = scope === "export";

  const cleanKeys = ["target", "minBlob", "smoothing", "smoothProtected", "trimTeeth", "lineSmooth", "protect", "unprotect", "merge", "parts", "partTidy", "paint", "pits", "creaseSnap", "pieces", "assign", "marks", "fix", "recolour"];
  if (!clean && cleanKeys.some((k) => r[k] !== undefined && !(Array.isArray(r[k]) && (r[k] as unknown[]).length === 0))) dropped.push(t(exporting ? "tidy.drop.cleanElsewhere" : "tidy.drop.cleanInMix"));
  if (clean) {
    const target = num(r.target);
    if (target !== null) changes.target = clampInt(target, 2, 64);
    const minBlob = num(r.minBlob);
    if (minBlob !== null) changes.minBlob = clampInt(minBlob, 0, 5000);
    const smoothing = num(r.smoothing);
    if (smoothing !== null) changes.smoothing = clampInt(smoothing, 0, 20);
    if (typeof r.smoothProtected === "boolean") changes.smoothProtected = r.smoothProtected;
    const trimTeeth = num(r.trimTeeth);
    if (trimTeeth !== null) changes.trimTeeth = clampInt(trimTeeth, 0, 10);
    const lineSmooth = num(r.lineSmooth);
    if (lineSmooth !== null) changes.lineSmooth = clampInt(lineSmooth, 0, 40);
    // Colours are named by the palette as it is now; a new target lays the palette out
    // again, so the names would point at colours that no longer exist.
    const relayout = changes.target !== undefined && changes.target !== context.target;
    const protect = hexList(r.protect);
    const unprotect = hexList(r.unprotect);
    const merge = objects(r.merge)
      .map((m) => ({ from: String(m.from ?? "").toUpperCase(), into: String(m.into ?? "").toUpperCase() }))
      .filter((m) => m.from !== m.into);
    const cellCount = context.cellCount ?? 0;
    const cellList = (value: unknown): number[] =>
      Array.isArray(value) ? [...new Set(value.map((v) => Math.round(Number(v))).filter((c) => c >= 1 && c <= cellCount))] : [];
    const rawParts = r.parts && typeof r.parts === "object" && !Array.isArray(r.parts) ? (r.parts as Record<string, unknown>) : null;
    const partList = objects(rawParts?.list)
      .map((m) => ({ name: String(m.name ?? "").trim().slice(0, 24), cells: cellList(m.cells) }))
      .filter((m) => m.name && m.cells.length > 0);
    if (partList.length) changes.parts = { subject: String(rawParts?.subject ?? "").trim().slice(0, 80), list: partList };
    const partNames = new Set((changes.parts?.list ?? context.shape?.parts ?? []).map((part) => part.name));
    const partTidyRaw = objects(r.partTidy).map((m) => ({ part: String(m.part ?? "").trim(), main: String(m.main ?? "").toUpperCase(), keep: hexList(m.keep) }));
    const paintRaw = objects(r.paint).map((m) => ({ cells: cellList(m.cells), into: String(m.into ?? "").toUpperCase(), from: m.from === undefined ? undefined : hexList(m.from) }));
    const recolourRaw = objects(r.recolour).map((m) => ({ hex: String(m.hex ?? "").toUpperCase(), to: String(m.to ?? "").toUpperCase() }));
    const pitCount = context.pits?.length ?? 0;
    const pitsRaw = objects(r.pits)
      .map((m) => ({ ids: Array.isArray(m.ids) ? [...new Set(m.ids.map((v) => Math.round(Number(v))).filter((id) => id >= 1 && id <= pitCount))] : [], into: String(m.into ?? "").toUpperCase() }))
      .filter((m) => m.ids.length > 0 && HEX.test(m.into));
    if (pitsRaw.length) changes.pits = pitsRaw;
    const crease = num(r.creaseSnap);
    if (crease !== null) changes.creaseSnap = clampInt(crease, 0, 8);
    const blobCount = context.focus?.blobs.length ?? 0;
    const piecesRaw = objects(r.pieces).map((m) => ({
      name: String(m.name ?? "").trim().slice(0, 24),
      blobs: Array.isArray(m.blobs) ? [...new Set(m.blobs.map((v) => Math.round(Number(v))).filter((id) => id >= 1 && id <= blobCount))] : [],
      colour: String(m.colour ?? "").toUpperCase(),
    }));
    const pieces = piecesRaw.filter((m) => m.blobs.length > 0 && HEX.test(m.colour));
    if (pieces.length < piecesRaw.length) dropped.push(t("tidy.drop.badPiece"));
    if (pieces.length) changes.pieces = pieces;
    // 🤖 every part up close: blobs by each part's own numbering (the part's blob map checks the numbers).
    const assign = objects(r.assign)
      .map((m) => ({
        part: String(m.part ?? "").trim(),
        blobs: Array.isArray(m.blobs) ? [...new Set(m.blobs.map((v) => Math.round(Number(v))).filter((id) => id >= 1))] : [],
        colour: String(m.colour ?? "").toUpperCase(),
        what: m.what === undefined ? undefined : String(m.what).slice(0, 20),
        ...(m.mine === false ? { mine: false } : {}),
      }))
      .filter((m) => partNames.has(m.part) && m.blobs.length > 0 && HEX.test(m.colour));
    if (assign.length) changes.assign = assign;
    const marks = objects(r.marks)
      .map((m) => ({ part: String(m.part ?? "").trim(), seed: Math.round(Number(m.seed)), colour: String(m.colour ?? "").toUpperCase(), what: m.what === undefined ? undefined : String(m.what).slice(0, 20), ...(m.shaded === true ? { shaded: true } : {}) }))
      .filter((m) => partNames.has(m.part) && m.seed >= 0 && HEX.test(m.colour));
    if (marks.length) changes.marks = marks;
    const fix = objects(r.fix)
      .map((m) => ({ part: String(m.part ?? "").trim(), what: String(m.what ?? "").trim().slice(0, 30), colour: String(m.colour ?? "").toUpperCase(), problem: String(m.problem ?? "").trim().slice(0, 200) }))
      .filter((m) => partNames.has(m.part) && m.what && HEX.test(m.colour))
      .slice(0, 6);
    if (fix.length) changes.fix = fix;
    if (relayout && (protect.length || unprotect.length || merge.length || partTidyRaw.length || paintRaw.length || recolourRaw.length)) {
      dropped.push(t("tidy.drop.relayout"));
    } else {
      const known = (hex: string) => hexes.has(hex);
      const unknown = [...protect, ...unprotect, ...merge.flatMap((m) => [m.from, m.into]), ...recolourRaw.map((m) => m.hex)].filter((hex) => !known(hex));
      if (unknown.length) dropped.push(t("tidy.drop.unknownHex", { list: [...new Set(unknown)].join(", ") }));
      if (protect.some(known)) changes.protect = protect.filter(known);
      if (unprotect.some(known)) changes.unprotect = unprotect.filter(known);
      const merges = merge.filter((m) => known(m.from) && known(m.into));
      if (merges.length) changes.merge = merges;
      // One colour per part (a part of the map, by name); the main colour may be new, the kept ones are the palette's.
      const badParts = partTidyRaw.filter((m) => !partNames.has(m.part) || !HEX.test(m.main));
      if (badParts.length) dropped.push(t("tidy.drop.unknownPart", { list: badParts.map((m) => m.part || "?").join(", ") }));
      const partTidy = partTidyRaw.filter((m) => partNames.has(m.part) && HEX.test(m.main)).map((m) => ({ ...m, keep: m.keep.filter((hex) => known(hex) && hex !== m.main) }));
      if (partTidy.length) changes.partTidy = partTidy;
      const paint = paintRaw.filter((m) => m.cells.length > 0 && HEX.test(m.into)).map((m) => (m.from ? { ...m, from: m.from.filter(known) } : m));
      if (paint.length < paintRaw.length) dropped.push(t("tidy.drop.badPaint"));
      if (paint.length) changes.paint = paint;
      const recolour = new Map<string, string>();
      for (const m of recolourRaw) if (known(m.hex) && HEX.test(m.to) && m.to !== m.hex) recolour.set(m.hex, m.to);
      if (recolour.size) changes.recolour = [...recolour].map(([hex, to]) => ({ hex, to }));
    }
  }
  const rawMix = r.mix && typeof r.mix === "object" ? (r.mix as Record<string, unknown>) : null;
  const mixKeys = ["recipes", "single", "autoRecipe"];
  if (((rawMix && Object.keys(rawMix).length > 0) || mixKeys.some((k) => Array.isArray(r[k]) && (r[k] as unknown[]).length > 0)) && !mix)
    dropped.push(t(exporting ? "tidy.drop.mixElsewhere" : "tidy.drop.mixInClean"));
  if (rawMix && mix) {
    const m: TidyMixChanges = {};
    if (rawMix.assignmentMode === "physical-only" || rawMix.assignmentMode === "physical-and-virtual") m.assignmentMode = rawMix.assignmentMode;
    if (rawMix.maxComponents === 2 || rawMix.maxComponents === 3) m.maxComponents = rawMix.maxComponents;
    if (RESOLUTIONS.includes(rawMix.recipeResolution as MixSettings["recipeResolution"])) m.recipeResolution = rawMix.recipeResolution as MixSettings["recipeResolution"];
    if (ACCENTS.includes(rawMix.accentProtection as MixSettings["accentProtection"])) m.accentProtection = rawMix.accentProtection as MixSettings["accentProtection"];
    if (MAPPINGS.includes(rawMix.mappingStrategy as MixSettings["mappingStrategy"])) m.mappingStrategy = rawMix.mappingStrategy as MixSettings["mappingStrategy"];
    if (PRIORITIES.includes(rawMix.mixPriority as MixSettings["mixPriority"])) m.mixPriority = rawMix.mixPriority as MixSettings["mixPriority"];
    if (typeof rawMix.autoPhysicalDirect === "boolean") m.autoPhysicalDirect = rawMix.autoPhysicalDirect;
    const de = num(rawMix.physicalDirectDeltaE);
    if (de !== null) m.physicalDirectDeltaE = Math.max(0, Math.min(30, Math.round(de * 10) / 10));
    if (Object.keys(m).length) changes.mix = m;
  }
  if (mix) {
    const slotCount = context.slots.length;
    const known = (hex: string) => hexes.has(hex);
    const recipes: NonNullable<TidyChanges["recipes"]> = [];
    const single: NonNullable<TidyChanges["single"]> = [];
    const bad: string[] = [];
    for (const m of objects(r.recipes)) {
      const hex = String(m.hex ?? "").toUpperCase();
      const raw = m.counts && typeof m.counts === "object" ? (m.counts as Record<string, unknown>) : {};
      const counts: Record<string, number> = {};
      for (const [slot, value] of Object.entries(raw)) {
        const e = Number(String(slot).replace(/^E/i, ""));
        const count = num(value);
        if (Number.isInteger(e) && e >= 1 && e <= slotCount && count !== null && count >= 1) counts[String(e)] = clampInt(count, 1, 20);
      }
      const parts = Object.keys(counts).length;
      if (!known(hex) || parts < 1 || parts > 3) bad.push(hex || "?");
      else if (parts === 1) single.push({ hex, extruder: Number(Object.keys(counts)[0]) });
      else recipes.push({ hex, counts });
    }
    for (const m of objects(r.single)) {
      const hex = String(m.hex ?? "").toUpperCase();
      const e = Math.round(Number(String(m.extruder ?? "").replace(/^E/i, "")));
      if (!known(hex) || !(e >= 1 && e <= slotCount)) bad.push(hex || "?");
      else single.push({ hex, extruder: e });
    }
    if (bad.length) dropped.push(t("tidy.drop.badRecipe", { list: [...new Set(bad)].join(", ") }));
    if (recipes.length) changes.recipes = recipes;
    if (single.length) changes.single = single;
    const auto = hexList(r.autoRecipe).filter(known);
    if (auto.length) changes.autoRecipe = auto;
  }
  const rawExport = r.export && typeof r.export === "object" ? (r.export as Record<string, unknown>) : null;
  if (rawExport && Object.keys(rawExport).length > 0 && !exporting) dropped.push(t("tidy.drop.exportElsewhere"));
  if (rawExport && exporting) {
    const e: TidyExportChanges = {};
    const height = num(rawExport.targetHeight);
    if (height !== null) e.targetHeight = Math.max(5, Math.min(500, Math.round(height * 10) / 10));
    for (const k of ["splitObjects", "splitAsParts", "closeHoles", "putOnBed", "centerOnBed", "borderCut"] as const) if (typeof rawExport[k] === "boolean") e[k] = rawExport[k] as boolean;
    if (PRESETS.includes(rawExport.printPreset as (typeof PRESETS)[number])) e.printPreset = rawExport.printPreset as (typeof PRESETS)[number];
    if (Object.keys(e).length) changes.export = e;
  }
  return { changes, dropped };
}

export interface ChangeLine {
  /** Which field (for the highlight on the panel): target, minBlob, smoothing, protect, merge, mix.<key>. */
  key: string;
  label: string;
  from: string;
  to: string;
}

/** Each mixing field under the name its row has in the 03 panel (the mix count: see describeChanges). */
const MIX_LABEL: Record<Exclude<keyof TidyMixChanges, "assignmentMode" | "maxComponents">, Key> = {
  recipeResolution: "mix.ratioStep",
  accentProtection: "mix.accent",
  mappingStrategy: "mix.mapping",
  mixPriority: "mix.model",
  autoPhysicalDirect: "mix.autoDirect",
  physicalDirectDeltaE: "tidy.mix.directDeltaE",
};

/** A mixing value as the 03 panel names it. */
const MIX_VALUE: Partial<Record<keyof TidyMixChanges, Record<string, Key>>> = {
  accentProtection: { off: "mix.accentOff", balanced: "mix.accentBalanced", strong: "mix.accentStrong" },
  mappingStrategy: { closest: "mix.mapClosest", smooth: "mix.mapSmooth", "preserve-hue": "mix.mapHue", "preserve-accent": "mix.mapAccent", "warm-neutral": "mix.mapWarm" },
  mixPriority: { accurate: "mix.modelAccurate", "preserve-hue": "mix.modelHue", "avoid-muddy": "mix.modelAccent" },
};

function mixValue(key: keyof TidyMixChanges, value: unknown, t: Translate): string {
  if (key === "recipeResolution") {
    const v = String(value);
    return v === "thirds" ? "1/3" : v === "half-thirds" ? "50% + 1/3" : `${v.replace("grid", "")}% + 1/3`;
  }
  if (key === "autoPhysicalDirect") return t(value ? "tidy.val.on" : "tidy.val.off");
  const named = MIX_VALUE[key]?.[String(value)];
  return named ? t(named) : String(value);
}

/** A count with its unit, in the UI's language: faces, passes or border edges. */
export function tidyCount(n: number, unit: "faces" | "passes" | "edges", t: Translate): string {
  const one = n === 1;
  if (unit === "faces") return t(one ? "tidy.val.face" : "tidy.val.faces", { n });
  if (unit === "passes") return t(one ? "tidy.val.pass" : "tidy.val.passes", { n });
  return t(one ? "tidy.val.edge" : "tidy.val.edges", { n });
}

/** Before → after, one line per field that really changes (labels as the panels name the fields). */
export function describeChanges(changes: TidyChanges, context: TidyContext, t: Translate): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const onOff = (on: boolean) => t(on ? "tidy.val.on" : "tidy.val.off");
  if (changes.target !== undefined && changes.target !== context.target)
    lines.push({ key: "target", label: t("clean.target"), from: String(context.target), to: String(changes.target) });
  if (changes.minBlob !== undefined && changes.minBlob !== context.minBlob)
    lines.push({ key: "minBlob", label: t("clean.islands"), from: tidyCount(context.minBlob, "faces", t), to: tidyCount(changes.minBlob, "faces", t) });
  if (changes.smoothing !== undefined && changes.smoothing !== context.smoothing)
    lines.push({ key: "smoothing", label: t("clean.smooth"), from: tidyCount(context.smoothing, "passes", t), to: tidyCount(changes.smoothing, "passes", t) });
  if (changes.smoothProtected !== undefined && changes.smoothProtected !== context.smoothProtected)
    lines.push({ key: "smoothProtected", label: t("clean.smoothProtected"), from: onOff(context.smoothProtected), to: onOff(changes.smoothProtected) });
  if (changes.trimTeeth !== undefined && changes.trimTeeth !== context.trimTeeth)
    lines.push({ key: "trimTeeth", label: t("clean.trim"), from: tidyCount(context.trimTeeth, "passes", t), to: tidyCount(changes.trimTeeth, "passes", t) });
  if (changes.lineSmooth !== undefined && changes.lineSmooth !== context.lineSmooth)
    lines.push({ key: "lineSmooth", label: t("clean.line"), from: tidyCount(context.lineSmooth, "edges", t), to: tidyCount(changes.lineSmooth, "edges", t) });
  const isProtected = new Map(context.palette.map((c) => [c.hex, c.protected]));
  for (const hex of changes.protect ?? []) if (!isProtected.get(hex)) lines.push({ key: "protect", label: t("tidy.line.protectHex", { hex }), from: t("tidy.val.notProtected"), to: t("tidy.val.protected") });
  for (const hex of changes.unprotect ?? []) if (isProtected.get(hex)) lines.push({ key: "protect", label: t("tidy.line.protectHex", { hex }), from: t("tidy.val.protected"), to: t("tidy.val.notProtected") });
  for (const m of changes.merge ?? []) lines.push({ key: "merge", label: t("tidy.line.merge"), from: m.from, to: m.into });
  if (changes.protectAccents) lines.push({ key: "protect", label: t("tidy.line.accents"), from: t("tidy.val.auto"), to: t("tidy.val.protected") });
  // How many filaments mix is one row in the 03 panel ("single only / up to 2 / up to 3"), made of two
  // fields: one line with the row's value before and after (none when the row shows the same).
  if (changes.mix && (changes.mix.assignmentMode !== undefined || changes.mix.maxComponents !== undefined)) {
    const howMany = (m: Pick<MixSettings, "assignmentMode" | "maxComponents">): Key =>
      m.assignmentMode === "physical-only" ? "mix.onlySingle" : m.maxComponents === 3 ? "mix.upTo3" : "mix.upTo2";
    const before = howMany(context.mix);
    const after = howMany({ ...context.mix, ...changes.mix });
    if (before !== after) lines.push({ key: changes.mix.maxComponents !== undefined ? "mix.maxComponents" : "mix.assignmentMode", label: t("mix.howMany"), from: t(before), to: t(after) });
  }
  for (const [key, value] of Object.entries(changes.mix ?? {}) as Array<[keyof TidyMixChanges, unknown]>) {
    if (key === "assignmentMode" || key === "maxComponents") continue;
    const now = context.mix[key];
    if (now === value) continue;
    lines.push({ key: `mix.${key}`, label: t(MIX_LABEL[key]), from: mixValue(key, now, t), to: mixValue(key, value, t) });
  }
  if (changes.parts)
    lines.push({
      key: "parts",
      label: t("tidy.line.parts"),
      from: context.shape ? t("tidy.val.partsN", { n: context.shape.parts.length }) : t("tidy.val.none"),
      to: changes.parts.list.map((part) => part.name).join(", "),
    });
  const shapePart = new Map((context.shape?.parts ?? []).map((part) => [part.name, part]));
  for (const m of changes.partTidy ?? []) {
    const now = shapePart.get(m.part);
    lines.push({
      key: "partTidy",
      label: t("tidy.line.partTidy", { part: m.part }),
      from: now ? t("tidy.val.coloursN", { n: now.colours.filter((c) => c.pct >= 0.5).length }) : "—",
      to: m.keep.length ? `${m.main} + ${m.keep.join(" ")}` : m.main,
    });
  }
  for (const m of changes.paint ?? [])
    lines.push({ key: "paint", label: t("tidy.line.paint", { cells: m.cells.join("·") }), from: m.from?.length ? m.from.join(" ") : t("tidy.val.allColours"), to: m.into });
  for (const m of changes.pieces ?? []) lines.push({ key: "pieces", label: t("tidy.line.piece", { name: m.name || "?", blobs: m.blobs.join("·") }), from: m.blobs.map((id) => context.focus?.blobs[id - 1]?.mean).filter(Boolean).slice(0, 2).join(" ") || "—", to: m.colour });
  // 🤖 every part up close: one line a part (the colours its blobs got, biggest first).
  const assignedBy = new Map<string, Map<string, number>>();
  for (const m of changes.assign ?? []) {
    const row = assignedBy.get(m.part) ?? new Map<string, number>();
    row.set(m.colour, (row.get(m.colour) ?? 0) + m.blobs.length);
    assignedBy.set(m.part, row);
  }
  for (const [part, row] of assignedBy) {
    const now = shapePart.get(part);
    lines.push({
      key: "assign",
      label: t("tidy.line.assign", { part }),
      from: now ? t("tidy.val.coloursN", { n: now.colours.filter((c) => c.pct >= 0.5).length }) : "—",
      to: [...row].sort((a, b) => b[1] - a[1]).map(([hex]) => hex).join(" "),
    });
  }
  for (const m of changes.marks ?? []) lines.push({ key: "marks", label: t("tidy.line.mark", { part: m.part, what: m.what || "?" }), from: "—", to: m.colour });
  for (const m of changes.fix ?? []) lines.push({ key: "fix", label: t("tidy.line.fix", { part: m.part, what: m.what }), from: "—", to: m.colour });
  for (const m of changes.pits ?? []) {
    const pits = m.ids.map((id) => context.pits?.[id - 1]).filter(Boolean);
    lines.push({ key: "pits", label: t("tidy.line.pits", { ids: m.ids.join("·") }), from: pits.map((p) => p?.own).filter(Boolean).slice(0, 2).join(" ") || "—", to: m.into });
  }
  if (changes.creaseSnap) lines.push({ key: "creaseSnap", label: t("tidy.line.creaseSnap"), from: t("tidy.val.off"), to: changes.creaseSnap > 0 ? t("tidy.val.rings", { n: changes.creaseSnap }) : t("tidy.val.off") });
  for (const m of changes.recolour ?? []) lines.push({ key: "recolour", label: t("tidy.line.recolour"), from: m.hex, to: m.to });
  const colourOf = new Map(context.palette.map((c) => [c.hex, c]));
  const nowRecipe = (hex: string) => colourOf.get(hex)?.recipe ?? t("tidy.val.auto");
  for (const m of changes.recipes ?? [])
    lines.push({ key: "recipes", label: t("tidy.line.recipe", { hex: m.hex }), from: nowRecipe(m.hex), to: Object.entries(m.counts).map(([e, n]) => `E${e} ${n}`).join(" · ") });
  for (const m of changes.single ?? []) lines.push({ key: "recipes", label: t("tidy.line.recipe", { hex: m.hex }), from: nowRecipe(m.hex), to: t("tidy.val.single", { e: m.extruder }) });
  for (const hex of changes.autoRecipe ?? []) if (colourOf.get(hex)?.hand) lines.push({ key: "recipes", label: t("tidy.line.recipe", { hex }), from: nowRecipe(hex), to: t("tidy.val.auto") });
  const ex = context.exportInfo?.settings;
  if (changes.export && ex) {
    const onOff = (on: boolean) => t(on ? "tidy.val.on" : "tidy.val.off");
    for (const [k, value] of Object.entries(changes.export) as Array<[keyof TidyExportChanges, unknown]>) {
      const now = ex[k];
      if (now === value) continue;
      const show = (v: unknown) => (typeof v === "boolean" ? onOff(v) : k === "targetHeight" ? `${v} mm` : String(v));
      lines.push({ key: `export.${k}`, label: t(EXPORT_LABEL[k]), from: show(now), to: show(value) });
    }
  }
  return lines;
}

const EXPORT_LABEL: Record<keyof TidyExportChanges, Key> = {
  targetHeight: "tidy.ex.height",
  splitObjects: "tidy.ex.split",
  splitAsParts: "tidy.ex.parts",
  closeHoles: "tidy.ex.holes",
  putOnBed: "tidy.ex.bed",
  centerOnBed: "tidy.ex.centre",
  borderCut: "tidy.ex.cut",
  printPreset: "tidy.ex.preset",
};

/** Colours painted before any bake: regions painted, group colours changed. */
export function hasColourEdits(changes: TidyChanges): boolean {
  return Boolean(changes.partTidy?.length || changes.paint?.length || changes.pits?.length || changes.pieces?.length || changes.assign?.length || changes.marks?.length || changes.fix?.length || changes.recolour?.length || (changes.creaseSnap ?? 0) > 0);
}

/** 03's hand choices per colour. */
export function hasRecipeChanges(changes: TidyChanges): boolean {
  return Boolean(changes.recipes?.length || changes.single?.length || changes.autoRecipe?.length);
}

export function hasCleanChanges(changes: TidyChanges): boolean {
  return (
    changes.target !== undefined ||
    changes.minBlob !== undefined ||
    changes.smoothing !== undefined ||
    changes.smoothProtected !== undefined ||
    changes.trimTeeth !== undefined ||
    changes.lineSmooth !== undefined ||
    Boolean(changes.protect?.length || changes.unprotect?.length || changes.merge?.length || changes.protectAccents)
  );
}

export interface TidyLogEntry {
  id: string;
  role: "user" | "ai" | "sys";
  text: string;
  /** ISO time. */
  at: string;
  model: string;
  scope: TidyScope;
  observations?: string[];
  /** What was changed (applied) or proposed (suggested). */
  changes?: TidyChanges;
  lines?: ChangeLine[];
  /** preview = done, waiting for the owner's ✅ (↩ takes it back); suggested = a plan not tried yet. */
  status?: "applied" | "preview" | "suggested" | "undone" | "none";
  dropped?: string[];
  /** The owner's message: thumbnails of the pictures that went with it. */
  images?: string[];
}

export const SCOPE_LABEL: Record<TidyScope, string> = { clean: "색정리(02)", mix: "혼합(03)", both: "색정리 + 혼합", export: "내보내기(04)" };

const HEX_ITEMS = { type: "array", items: { type: "string" } };

export const TIDY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "규파에게 하는 말(한국어, 4문장 안). 무엇을 왜 바꾸는지(또는 제안하는지)만 — 사진에서 본 자세한 것은 observations 에. changes 에 넣은 것만 실제로 바뀐다" },
    asked_to_change: { type: "boolean", description: "규파가 이번 말에서 무엇을 바꾸라고 분명히 요청했나(…해 줘·바꿔·정리해·줄여·늘려·그렇게 해). 묻기·의견 구하기·'추천해 줘'·'어때?'면 false" },
    observations: { type: "array", items: { type: "string" }, description: "사진에서 본 것 2~5줄, 줄마다 한 문장 — 부위(얼굴·머리·옷 …)와 문제(톱니·얼룩·작은 점·뭉개진 그라데이션 …)" },
    changes: {
      type: "object",
      description: "바꿀 칸만. 바꿀 게 없으면 {}. 앱이 미리보기로 보여 주고 규파가 [적용]을 눌러야 확정된다",
      properties: {
        parts: {
          type: "object",
          description: "(02) 부위 지도를 새로 짓거나 고칠 때만: 이게 무엇인지와 부위마다 칸 번호(사진의 숫자)",
          properties: { subject: { type: "string" }, list: { type: "array", items: { type: "object", properties: { name: { type: "string" }, cells: { type: "array", items: { type: "integer" } } } } } },
        },
        partTidy: {
          type: "array",
          description: "(02) 부위마다 한 색: 그 부위 안에서 main·keep 이 아닌 색(구워진 그림자·하이라이트·얼룩)은 main 으로. keep = 그 부위의 지킬 디테일 색(눈·입·무늬). main 은 지금 팔레트 색이거나 새 hex",
          items: { type: "object", properties: { part: { type: "string" }, main: { type: "string" }, keep: HEX_ITEMS } },
        },
        paint: {
          type: "array",
          description: "(02) 칸 번호로 고쳐 칠하기: cells 의 면 중 from 색(없으면 모든 색)을 into 로. 부위 정리로 안 되는 작은 손질에만",
          items: { type: "object", properties: { cells: { type: "array", items: { type: "integer" } }, into: { type: "string" }, from: HEX_ITEMS } },
        },
        pits: {
          type: "array",
          description: "(02) 구멍 디테일 목록의 번호(P1→1)로: 그 구멍들을 into 색으로(예: 해골 단추의 눈 구멍 → 진한 갈색). 그대로 둘 구멍은 넣지 않는다",
          items: { type: "object", properties: { ids: { type: "array", items: { type: "integer" } }, into: { type: "string" } } },
        },
        fix: {
          type: "array",
          description: "(02) 덩어리·칸으로 따로 안 잡히는 물건(눈알 둘레의 얇은 흰 테, 가는 줄, 작은 점)을 칠하기: [{part: 부위 이름, what: 흰 테, colour: #FFFFFF, problem: 눈알을 두른 흰 테가 피부색이 됐다}]. 앱이 그 부위 원본 사진에 격자를 깔아 다시 물어 점을 찍게 하고, 점 아래에서 원본 색 경계를 따라 그 물건만 잡아 칠한다",
          items: { type: "object", properties: { part: { type: "string" }, what: { type: "string" }, colour: { type: "string" }, problem: { type: "string" } }, required: ["part", "what", "colour"] },
        },
        pieces: {
          type: "array",
          description: "(02, 부위 확대 상의에서만) 덩어리 번호(사진의 숫자)를 묶어 조각을 만들고 조각마다 한 색: [{name: 테, blobs: [1,4], colour: #E69D3D}]. 안 넣은 덩어리는 그대로",
          items: { type: "object", properties: { name: { type: "string" }, blobs: { type: "array", items: { type: "integer" } }, colour: { type: "string" } } },
        },
        creaseSnap: { type: "integer", minimum: 0, maximum: 8, description: "(02) 색 경계를 근처의 가장 깊은 홈으로 옮기기(경계 양쪽 면 몇 줄 안에서). 부위 정리 때 앱이 기본 3을 쓴다. 0 = 끔" },
        recolour: { type: "array", description: "(02) 그룹 색 자체를 바꾸기: hex 그룹의 모든 면을 to 로. 원본이 맑으면 그대로, 구운 조명에 칙칙해진 색만 그 계열의 맑은 색으로(규칙의 Tkc 예). 색상 자체를 바꾸는 건 규파가 말할 때만", items: { type: "object", properties: { hex: { type: "string" }, to: { type: "string" } } } },
        target: { type: "integer", minimum: 2, maximum: 64, description: "(02) 목표 색 수 — 바꾸면 팔레트가 새로 나뉘어 같은 답에서 색 이름(hex)을 쓰는 칸은 못 쓴다" },
        minBlob: { type: "integer", minimum: 0, maximum: 5000, description: "(02) 이 면 수보다 작은 조각은 주변 색으로 흡수" },
        smoothing: { type: "integer", minimum: 0, maximum: 20, description: "(02) 경계 톱니 다듬기 횟수" },
        smoothProtected: { type: "boolean", description: "(02) 보호한 색(눈·입·꽃술 같은 작은 선)도 경계 톱니를 편다" },
        trimTeeth: { type: "integer", minimum: 0, maximum: 10, description: "(02) 경계에서 삐죽 튀어나온 삼각형 깎기 횟수, 0 = 끔" },
        lineSmooth: { type: "integer", minimum: 0, maximum: 40, description: "(02) 경계 선 펴기 길이(삼각형 변 몇 칸), 0 = 끔" },
        protect: { ...HEX_ITEMS, description: "(02) 흡수·합치기에서 지킬 지금 팔레트 색(hex)" },
        unprotect: HEX_ITEMS,
        merge: { type: "array", items: { type: "object", properties: { from: { type: "string" }, into: { type: "string" } } }, description: "(02) 지금 팔레트 색 from 을 into 로 합치기(모델 전체)" },
        mix: {
          type: "object",
          description: "(03) 혼합 설정",
          properties: {
            assignmentMode: { enum: ["physical-and-virtual", "physical-only"] },
            maxComponents: { enum: [2, 3] },
            recipeResolution: { enum: RESOLUTIONS },
            accentProtection: { enum: ACCENTS },
            mappingStrategy: { enum: MAPPINGS },
            mixPriority: { enum: PRIORITIES },
            autoPhysicalDirect: { type: "boolean" },
            physicalDirectDeltaE: { type: "number" },
          },
        },
        recipes: {
          type: "array",
          description: "(03) 한 색의 혼합 비율을 손으로: counts = 필라멘트 슬롯 번호(\"1\"~\"5\")마다 한 주기의 층 수(1~20), 2~3개",
          items: { type: "object", properties: { hex: { type: "string" }, counts: { type: "object" } } },
        },
        single: { type: "array", description: "(03) 한 색을 필라멘트 하나로만", items: { type: "object", properties: { hex: { type: "string" }, extruder: { type: "integer" } } } },
        autoRecipe: { ...HEX_ITEMS, description: "(03) 손으로 정한 비율·단색을 빼고 자동으로" },
        export: {
          type: "object",
          description: "(04) 내보내기 설정",
          properties: {
            targetHeight: { type: "number", description: "높이 mm" },
            splitObjects: { type: "boolean", description: "떨어진 조각을 따로(색칠 유지)" },
            splitAsParts: { type: "boolean", description: "나눈 조각을 한 객체의 부품으로(PrusaSlicer, 떠 있는 조각이 안 떨어짐)" },
            closeHoles: { type: "boolean", description: "작은 구멍 막기(열린 껍데기가 슬라이서에서 잘려 보이는 것 방지)" },
            putOnBed: { type: "boolean" },
            centerOnBed: { type: "boolean" },
            borderCut: { type: "boolean", description: "선 따라 자르기(색 경계를 매끈한 선으로 잘라 씀)" },
            printPreset: { enum: [...PRESETS] },
          },
        },
      },
    },
  },
  required: ["reply", "asked_to_change", "changes"],
};

/** The shape step: what the model is and its parts, from the pictures with the cell numbers. */
export const SHAPE_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "이게 무엇인지 한 줄(예: 갈색 생강빵 캐릭터, 사탕 지팡이를 든)" },
    parts: {
      type: "array",
      description: "부위마다 이름과 칸 번호. 보이는 칸은 모두 어느 부위엔가 넣는다",
      items: { type: "object", properties: { name: { type: "string" }, cells: { type: "array", items: { type: "integer" } } } },
    },
    notes: { type: "array", items: { type: "string" }, description: "헷갈린 경계 1~3줄(있으면)" },
  },
  required: ["subject", "parts"],
};

/** The rules the owner tidied five models by (measured from the work files, 11-04): the same for every model. */
const OWNER_RULES = `■ 규파식 색 정리 (규파가 직접 정리한 모델 5개에서 잰 것 — 원본 4천~9만 가지 색이 7~16색이 됐다)
- 형태 먼저: 이게 무엇이고 부위(얼굴·머리카락·몸통·팔·손·다리·옷·소품)가 어디서 어디까지인지 보고, 색은 부위 기준으로 정한다.
- 부위 하나 = 색 하나: AI 모델에 구워진 그림자·하이라이트(한 부위 안의 명암)는 그 부위의 색으로 합친다. 넓은 몸통 색이 한 덩어리로 이어지게. 결과는 보통 7~8색, 옷·무늬가 많으면 16색까지.
- 맞닿은 다른 물건은 구분되게: 원본 색이 거의 같아도(고글 테와 렌즈) 출력에서 형태가 보이게 서로 다른 색(선명한 색 + 밝은 색)으로.
- 작은 디테일은 지킨다: 눈·눈동자 하이라이트·입·볼·작은 무늬(면적 0.02~1%)는 그 부위의 keep 색으로 남기고 protect.
- 색은 그 물건이 원래 뜻한 맑은 색: 원본이 이미 맑으면(Slc·Apvc·Mnc — 흰색 L95, 파랑·초록·노랑이 또렷) 원본 대표색 그대로(ΔE 3 안). 원본이 구운 조명에 눌려 칙칙하면 그 계열의 맑은 색으로 크게 밝힌다 — 규파 Tkc: 회색빛 흰색→#FFFFFF, 황토색 머리→연노랑 #F4DB88, 황갈색 고글 테·챙·지팡이·머리 줄→주황 #E69D3D, 분홍빛 갈색 피부 #94715B→#B98660 (ΔE 25~35). Bvc: 갈색 #845E2D→#976F3D, 회색 흰색 #B6B4A7→#DCDFDA. 진한 갈색·검정은 그대로(ΔE 5 안). 맑게 하는 건 회색이 낀 탁한 색(회색빛 흰색, 황토·올리브·황갈색, 칙칙한 피부)만이다 — 또렷한 원색(Bvc 진한 빨강 #8B0303·파랑 #1E618C·하늘색 #40A1C6, Mnc 파랑들)은 어두워도 원본 그대로 둔다. 색상 자체(빨강→노랑, 피부→노랑)를 바꾸는 건 규파가 말할 때만.
- 경계는 홈에서: 색이 다른 파츠가 맞닿는 곳(아이싱·단추·손에 쥔 소품)은 가장 쏙 들어간 홈을 기점으로 색을 나눈다 — 앱이 부위 경계와 색 경계를 홈과 원본 색이 바뀌는 곳에 맞춘다(creaseSnap).
- 구멍 디테일: 단추의 눈 구멍·콧구멍처럼 파이고 원본에서 어두운 곳은 디테일이다. 구멍 목록을 보고 pits 로 색을 정한다(보통 둘레 색보다 진한 색, 몸통 계열이면 몸통보다 진한 갈색).
- 점·얼룩은 없앤다: 보호하지 않은 색의 20면 이하 조각.
- 경계: 내보낼 때 선 따라 자르기로 매끈하게(5개 중 4개).
- 출력(03): 필라멘트 5개 — 규파 XL 은 툴1 시안(Azure Blue)·툴2 마젠타(Ms. Pink)·툴3 노랑(Pineapple Yellow)·툴4 흰(Pristine White)·툴5 검정(Jet Black), 필라멘트 슬롯 목록과 다르면 그렇다고 말한다. 실물+가상 혼합, 한 색에 최대 3개, 비율 5~10% 단위, 실물과 ΔE 6 안이면 실물 그대로. 손으로 고친 비율은 짧은 주기(한 주기 4~6층)가 많고, 빨강·피부처럼 색이 중요한 곳은 19~20층도 썼다.
- 내보내기(04): Prusa XL 5툴, 높이 70mm, 품질 finest(0.10mm — 5개 모두), 떨어진 조각 나누기 + 한 객체의 부품, 선 따라 자르기 켬, 작은 구멍 막기 켬.`;

/** The same-every-time part of the consult (rules and the model as loaded): cached for an hour. */
export function tidyStablePrompt(context: Pick<TidyContext, "modelName" | "faces">): string {
  return `너는 규로마(GYUROMA) 앱의 '자동 정돈' 상의 담당이다. 규파(3D 조형 작가)가 AI 로 만든 3D 모델(면마다 색)을 PrusaSlicer 컬러 믹스(층마다 필라멘트를 바꿔 섞는 방식)로 FDM 출력하려고 색을 정리한다.
사진을 여러 각도로 보고 형태부터 파악한 뒤, 부위마다 색을 정하고, 아래 손잡이로 직접 고치거나 제안한다. 고친 것은 앱이 미리보기로 보여 주고 규파가 [적용]을 누른다.

${OWNER_RULES}

■ 부위 지도 (02)
- 사진의 흰 네모 숫자 = 칸 번호. 모델을 색과 상관없이 비슷한 크기로 나눈 것이고, 얇은 검은 선이 칸 경계, 굵은 선이 부위 경계다.
- 부위 지도가 있으면 목록에 부위마다 면적과 들어 있는 색(비율)이 있다. 틀렸으면 parts 로 고친다(규파가 '팔은 손목까지' 같이 말하면).
- partTidy [{part, main, keep}]: 그 부위 안에서 main·keep 이 아닌 색은 모두 main 이 된다(keep 과 아주 가까운 명암은 그 keep 으로). 다른 부위와 맞닿은 칸에서는 그 부위의 색은 건드리지 않고, 보호한 색도 keep 에 없으면 그대로 둔다. 부위 정리의 주 손잡이다.
- paint [{cells, into, from?}]: 칸 단위 손질(from 을 주면 그 색의 면만).
- recolour [{hex, to}]: 그룹 색 자체를 바꾼다(그룹 나눔은 그대로).
- pits [{ids, into}]: 구멍 디테일(목록의 P 번호)을 into 색으로. '지금 화면'·'구멍 확대' 사진에서 확인한다.
- creaseSnap: 색 경계를 가장 깊은 홈으로(경계 양쪽 몇 줄 안). 부위 정리를 하면 앱이 3으로 해 준다. 홈 맞추기를 쓰면 smoothing 은 0~2 로 낮게(다듬기가 경계를 홈에서 다시 밀어낸다).
- 안 쪽 디테일은 앱이 지킨다: keep 색 안에 둘러싸인 아주 다른 색(흰 단추 안의 어두운 점)은 그림자로 보지 않고 남긴다.

■ 02 색정리 손잡이
- target(목표 색 수 2~64): 비슷한 색을 이 개수의 그룹으로 묶는다. 바꾸면 팔레트가 새로 나뉘므로 같은 답에서 hex 를 쓰는 칸(partTidy·paint·recolour·protect·merge)은 쓰지 않는다(다음 말에서).
- minBlob(작은 조각 흡수, 면 수): 이보다 작은 같은 색 조각은 주변 색이 된다. 얼룩·점이 많으면 키우고(300~800), 눈·입이 사라지면 줄인다(20~60).
- smoothing(경계 톱니 다듬기 0~20) · trimTeeth(톱니 깎기 0~10, 보통 2~3) · lineSmooth(경계 선 펴기 0~40칸, 보통 16) · smoothProtected(보호 색도 다듬기).
- protect / unprotect: 지금 팔레트 색(hex)을 흡수·합치기에서 지킨다. merge [{from, into}]: 모델 전체에서 from 색을 into 로.
- fix [{part, what, colour, problem}]: 덩어리·칸으로 따로 안 잡히는 물건(얇은 테·가는 줄·작은 점)은 이걸로 칠한다 — 앱이 원본 사진에 격자를 깔아 다시 묻고, 점을 찍으면 원본 색 경계를 따라 그 물건만 잡는다. '안 잡혀서 못 한다'·'직접 칠하세요'로 끝내지 않는다. 원본에 정말 그런 물건이 없을 때만 그렇다고 말한다.
- 한계: 색은 삼각형 단위다. 선 굵기가 삼각형 서너 개뿐이면 다듬어도 지그재그가 남는다 — 그렇다고 말하고 할 수 있는 것만 한다.
- 손잡이를 바꾸면 앱이 '정리 실행'(면 색 확정 + 다듬기 + 흡수)까지 한다.

■ 03 혼합 손잡이 (mix · recipes · single · autoRecipe)
- assignmentMode: physical-and-virtual | physical-only. maxComponents 2|3. recipeResolution: thirds(1/3, 주기 짧음·줄무늬 적음) < half-thirds < grid25 < grid20 < grid10 < grid5(5%, 정확하지만 주기가 길어 줄무늬).
- accentProtection off|balanced|strong · mappingStrategy closest|smooth|preserve-hue|preserve-accent|warm-neutral · mixPriority accurate|preserve-hue|avoid-muddy · autoPhysicalDirect + physicalDirectDeltaE(실물과 이 ΔE 안이면 실물 그대로).
- recipes [{hex, counts}]: 한 색을 슬롯별 층 수로 직접(예: {"1":2,"4":1,"5":2} = 흰2·마젠타1·노랑2, 한 주기 5층). 목록의 '나오는 색'이 원래 색과 많이 다르면 고친다. 주기가 길수록 층 줄무늬가 보인다.
- single [{hex, extruder}]: 필라멘트 하나로만. autoRecipe: 손으로 정한 것을 빼고 자동으로.

■ 04 내보내기 (export)
- 높이(mm)·떨어진 조각 나누기·한 객체의 부품·작은 구멍 막기·바닥에 놓기·가운데·선 따라 자르기·품질. 판 크기를 넘지 않는지, 색 수가 슬롯으로 출력되는지, 구멍·떠 있는 조각이 없는지 본다.

■ 규칙
- 사진은 회색 배경에 조명을 받은 모습이다. '원본' 사진은 정리 전 색, '결과' 사진은 지금 상태다. '지금 화면' 사진은 규파가 확대해 보고 있는 곳 — 말이 가리키는 곳일 가능성이 크다. 부위를 짚어 말한다.
- changes 에 넣은 것만 실제로 바뀐다. 넣지 않은 걸 바꿨다고 말하지 않는다.
- 사진에 안 보이는 것을 지어내지 않는다. 확실하지 않으면 그렇다고 말한다.
- 숫자를 바꿀 땐 왜 그 값인지 짧게 말한다. reply 는 4문장 안, 한국어. 같은 말을 reply 와 observations 에 되풀이하지 않는다.

■ 모델
이름: ${context.modelName} · 면 ${context.faces.toLocaleString()}개`;
}

/** The shape step's question (the stable part is tidyStablePrompt, so the cache serves both). */
export function shapePrompt(context: TidyContext, pictures: string[], message: string): string {
  return `■ 형태 파악 (색 정리 전에 먼저)
이게 무엇인지(subject) 한 줄로 말하고, 부위마다 이름과 칸 번호를 parts 로 낸다.
- 칸은 1~${context.cellCount ?? 0}번. 사진의 흰 네모 숫자가 칸 번호, 얇은 검은 선이 칸 경계다. 칸 하나는 한 부위에만.
- 부위 이름은 짧은 한국어: 얼굴, 머리카락, 귀, 몸통, 왼팔, 오른팔, 손, 치마, 다리, 신발, 꼬리, 소품(무엇인지) … 왼·오른쪽은 캐릭터 기준.
- 경계에 걸친 칸은 더 많이 차지한 부위로. 색이 바뀌는 경계(소매-손, 얼굴-머리카락)를 따라 나누되, 같은 색이라도 뜻이 다르면(팔-몸통) 나눈다.
- 안 보이는 칸은 넣지 않아도 된다(맞닿은 부위로 들어간다).
- 팔레트(참고): ${[...context.palette].sort((a, b) => b.areaPct - a.areaPct).slice(0, 24).map((c) => `${c.hex} ${c.areaPct.toFixed(1)}%`).join(" · ")}

■ 사진 (이 순서로 붙어 있음)
${pictures.map((p, i) => `${i + 1}. ${p}`).join("\n")}

■ 규파의 말 (형태 파악 뒤에 할 일)
${message}`;
}

/** A part up close: what its blobs are (shape first), grouped into pieces of one colour each. */
export function focusPrompt(context: TidyContext, history: TidyLogEntry[], message: string, pictures: string[]): string {
  const f = context.focus;
  const palette = [...context.palette].sort((a, b) => b.areaPct - a.areaPct).slice(0, 24).map((c) => `${c.hex} ${c.areaPct.toFixed(1)}%${c.protected ? " 보호" : ""}`).join(" · ");
  const past = history
    .slice(-8)
    .map((h) => (h.role === "user" ? `규파: ${h.text}` : h.role === "sys" ? `(기록) ${h.text}` : `너: ${h.text}`))
    .join("\n");
  return `■ 부위 확대: ${f?.part ?? "?"} ${context.shape?.subject ? `(${context.shape.subject})` : ""}
이 부위와 그 둘레만 크게 본다. 사진의 흰 네모 숫자 = 덩어리 번호 — 모델의 원래 색을 계열로 크게 나눠 보고(색 수 적게) 잘게도 나눠 본 뒤(색 수 많게), 경계가 홈이 아니고 색이 살짝만 바뀌는 곳(명암)은 이미 한 덩어리로 묶었다.
할 일: 형태를 보고 덩어리들이 무엇인지(테·렌즈·끈·톱니·바늘·나선·피부·모자 띠 …) 알아본 뒤, 같은 물건인 덩어리를 묶어 pieces 로 낸다 — 조각마다 한 색(colour). 같은 재질은 같은 색(왼쪽·오른쪽 렌즈 둘 다 연노랑처럼).
- 조각 색은 그 조각의 **원본 평균색**(목록의 색)에서 정한다 — '지금 결과' 사진의 색은 전체 정리에서 잘못 묶였을 수 있으니 따라가지 않는다(원본이 분홍빛 갈색인 얼굴을 주황으로 칠하지 않는다).
- 한 덩어리 안에 서로 다른 물건이 섞여 보이면(평균색이 두 색의 중간, 사진에서 흰 판과 피부가 한 번호) 그 덩어리는 pieces 에 넣지 않는다.
- 덩어리로 따로 안 잡히는 물건(눈알 둘레의 얇은 흰 테, 가는 줄, 작은 점, 위처럼 섞인 덩어리 속 물건)은 fix [{part, what, colour, problem}] 로 낸다 — 앱이 원본 사진에 격자를 깔아 다시 물어 점을 찍게 하고, 원본 색 경계를 따라 그 물건만 잡아 칠한다. '안 잡혀서 못 한다'·'직접 칠하세요'로 끝내지 않는다.
- 색은 규파식: 원본이 맑으면 원본 대표색, 칙칙하면 그 계열의 맑은 색(규칙의 Tkc 예). 이 부위가 둘레와 같은 물건(모자 띠 = 모자)이면 둘레 색과 같게 한다. 팔레트 색을 쓰면 그 그룹에 들어가고, 새 hex 면 새 그룹이 된다.
- 맞닿은 다른 물건은 구분되게: 원본에서 색이 거의 같아도(테와 렌즈, 톱니와 모자 챙) 출력에서 형태가 보이도록 서로 다른 색으로 — 하나는 그 계열의 선명한 색, 하나는 밝은 색(예: 황갈색 고글이면 테는 주황, 렌즈는 연노랑, 바늘은 검정).
- 둘레(이 부위가 아닌 모자·얼굴 등)의 덩어리는 건드리지 않아도 된다 — 넣지 않은 덩어리는 그대로.
- 경계는 앱이 홈에 맞춘다(creaseSnap 기본 3).

덩어리(번호 · 이 부위 안 면적 · 원본 평균색 · 계열):
${(f?.blobs ?? []).map((b) => `B${b.id} ${b.areaPct.toFixed(1)}% ${b.mean} ${b.family}`).join("\n")}

팔레트(지금 그룹): ${palette}

■ 사진 (이 순서로 붙어 있음)
${pictures.map((p, i) => `${i + 1}. ${p}`).join("\n")}

■ 지금까지 주고받은 말
${past || "(처음)"}

■ 규파의 말
${message}`;
}

/** 🤖 step 1 after the shape: the model's final palette — a few clean colours — and each part's main one. */
export const PALETTE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "규파에게 하는 말(한국어, 3문장 안): 몇 색으로, 원본이 맑아서 그대로인지 칙칙해서 밝혔는지" },
    observations: { type: "array", items: { type: "string" }, description: "2~4줄: 원본 색이 맑은지 칙칙한지, 헷갈리는 부위·무늬" },
    palette: {
      type: "array",
      description: "이 모델의 최종 색 — 규파가 정한 목표 색 수를 넘지 않게(보통 6~10개). 번호는 1부터. 같은 물감은 한 번만(모자와 치마가 같은 진갈색이면 한 번호)",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, name: { type: "string", description: "짧은 이름(진갈색·주황·연노랑·흰색·검정·피부 …)" }, hex: { type: "string" } },
        required: ["id", "name", "hex"],
      },
    },
    parts: {
      type: "array",
      description: "부위마다 주 색(main)과 그 부위에 나올 다른 색(also) — 팔레트 번호 — 그리고 그 안의 물건과 색(looks)",
      items: {
        type: "object",
        properties: {
          part: { type: "string" },
          main: { type: "integer" },
          also: { type: "array", items: { type: "integer" } },
          looks: { type: "string", description: "전체 사진에서 본 이 부위 안의 물건과 색, 한 줄(예: 크라운 진갈색 · 챙 윗면 주황 · 챙 밑면 진갈색). 다음 단계의 확대 사진은 각도가 낯설어서 이 줄이 길잡이가 된다" },
        },
        required: ["part", "main", "looks"],
      },
    },
    pits: {
      type: "array",
      description: "구멍 디테일(P 번호)에 칠할 팔레트 번호. 그대로 둘 구멍은 넣지 않는다",
      items: { type: "object", properties: { ids: { type: "array", items: { type: "integer" } }, colour: { type: "integer" } } },
    },
  },
  required: ["reply", "palette", "parts"],
};

export interface TidyPaletteColour {
  id: number;
  name: string;
  hex: string;
}

export interface TidyPalettePlan {
  reply: string;
  observations: string[];
  palette: TidyPaletteColour[];
  /** Part name → its main colour, the others that may show in it (palette ids), and what is in it as seen whole. */
  parts: Map<string, { main: number; also: number[]; looks: string }>;
  pits: Array<{ ids: number[]; colour: number }>;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** The palette answer as the app can use it (unknown parts, bad colours and numbers left out); null without a palette. */
/** The palette's answer held to the owner's target colour count (11-05, the owner: "AI 색정리가 목표 색수에 맞춰서 하니?"). */
export function paletteSchemaFor(target: number) {
  return { ...PALETTE_SCHEMA, properties: { ...PALETTE_SCHEMA.properties, palette: { ...PALETTE_SCHEMA.properties.palette, maxItems: Math.max(2, Math.round(target)) } } };
}

export function sanitizePalette(raw: unknown, partNames: string[], pitCount: number): TidyPalettePlan | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : []);
  const palette: TidyPaletteColour[] = [];
  for (const m of list(r.palette)) {
    const id = Math.round(Number(m.id));
    const hex = String(m.hex ?? "").trim();
    if (!(id >= 1) || !HEX_RE.test(hex) || palette.some((c) => c.id === id)) continue;
    palette.push({ id, name: String(m.name ?? "").trim().slice(0, 16) || hex, hex: hex.toUpperCase() });
  }
  if (palette.length === 0) return null;
  const ids = new Set(palette.map((c) => c.id));
  const known = new Set(partNames);
  const parts = new Map<string, { main: number; also: number[]; looks: string }>();
  for (const m of list(r.parts)) {
    const part = String(m.part ?? "").trim();
    const main = Math.round(Number(m.main));
    if (!known.has(part) || !ids.has(main)) continue;
    const also = (Array.isArray(m.also) ? m.also : []).map((v) => Math.round(Number(v))).filter((v) => ids.has(v) && v !== main);
    parts.set(part, { main, also: [...new Set(also)], looks: String(m.looks ?? "").trim().slice(0, 200) });
  }
  const pits = list(r.pits)
    .map((m) => ({ ids: (Array.isArray(m.ids) ? m.ids : []).map((v) => Math.round(Number(v))).filter((v) => v >= 1 && v <= pitCount), colour: Math.round(Number(m.colour)) }))
    .filter((m) => m.ids.length > 0 && ids.has(m.colour));
  return {
    reply: String(r.reply ?? "").trim(),
    observations: Array.isArray(r.observations) ? r.observations.map(String).filter(Boolean).slice(0, 5) : [],
    palette,
    parts,
    pits,
  };
}

const paletteLine = (palette: TidyPaletteColour[]) => palette.map((c) => `${c.id} ${c.name} ${c.hex}`).join(" · ");

/** 🤖 step 1's question: the part map as it is, the holes, and the owner's colour rule. */
export function palettePrompt(context: TidyContext, pictures: string[], message: string): string {
  const shape = context.shape;
  const parts = shape
    ? shape.parts
        .map((part) => `${part.name} ${part.areaPct.toFixed(1)}%: ${part.colours.filter((c) => c.pct >= 0.5).slice(0, 7).map((c) => `${c.hex} ${c.pct.toFixed(0)}%`).join(" · ")}`)
        .join("\n")
    : "(부위 지도 없음)";
  const pits = context.pits?.length
    ? context.pits.map((p) => `P${p.id} ${p.part ? `${p.part}의 ` : ""}구멍 · 원본 ${p.own} · 둘레 ${[p.inside, ...p.around].join("·")} · ${p.faces}면`).join("\n")
    : "(없음)";
  return `■ 🤖 자동 색정리 1단계 — 최종 팔레트 (${shape?.subject ?? "?"})
이 모델을 출력할 최종 색을 정한다: palette(번호·이름·hex)와 부위마다 주 색. 다음 단계에서 앱이 부위마다 확대 사진의 덩어리를 보여 주면, 덩어리마다 이 팔레트 색을 하나씩 고른다 — 그러니 무늬·디테일에 필요한 색(눈·입·줄무늬·테두리·단추)도 팔레트에 넣는다.
- 색 수: 규파가 정한 목표 색 수 ${context.target}가지를 넘지 않는다 — 그 안에서 출력에서 서로 다른 물건으로 보여야 할 만큼만(보통 6~10). 같은 물감은 하나로(모자와 치마가 둘 다 진갈색이면 한 번호).
- 색은 규칙의 '맑은 색'대로: 원본이 맑으면 그대로, 구운 조명에 칙칙하면 그 계열의 맑은 색으로 크게 밝힌다. 진한 갈색·검정은 그대로.
- 칙칙한 색을 맑게 바꿨으면 그 칙칙한 원래 색(황갈색·황토색)은 팔레트에 따로 남기지 않는다 — 한 계열에 맑은 색 하나(규파 Tkc: 황갈색 띠·챙·테는 모두 주황 하나).
- 아래 부위 줄의 hex 는 원본 색을 그룹으로 묶은 대표색이다 — 구운 명암이 섞여 실제 물건 색보다 탁할 수 있다. 사진의 원본을 보고 정한다.
- parts 의 also 에는 그 부위 안에 실제로 나오는 다른 색(눈·입·줄무늬·옆 물건)을 넣는다.
- parts 의 looks 에는 그 부위 안의 물건과 색을 한 줄로(예: 크라운 진갈색 · 챙 윗면 주황 · 챙 밑면 진갈색). 다음 단계의 확대 사진은 각도가 낯설어 넓은 면(챙·망토)을 다른 물건으로 착각하기 쉽다 — 이 줄이 길잡이다. 테 안에 들어앉은 판(고글·안경 렌즈, 시계판, 단추 가운데)은 테와 원본 색이 같아도 따로 적는다(예: 고글 테 주황 · 렌즈 연노랑 · 바늘 검정). 그 부위 위에 붙은 작은 소품(가방·단추·꽃 장식)과 그 위 무늬(줄·가운데 점)도 빠뜨리지 않는다(예: 코트 검정 · 가방 검정 · 가방 줄 2개 연노랑).

■ 부위 지도
${parts}

■ 구멍 디테일 (파이고 원본이 어두운 곳)
${pits}

■ 사진 (이 순서로 붙어 있음)
${pictures.map((p, i) => `${i + 1}. ${p}`).join("\n")}

■ 규파의 말
${message}`;
}

/** 🤖 step 2, one part up close: each blob given a colour of the palette. */
export const ASSIGN_SCHEMA = {
  type: "object",
  properties: {
    observations: { type: "array", items: { type: "string" }, description: "1~3줄: 이 부위에서 알아본 물건들과 헷갈린 곳" },
    assign: {
      type: "array",
      description: "덩어리 번호를 물건별로 묶어 팔레트 색 번호 하나씩: [{what: 테, blobs: [1,4], colour: 2}]. 모든 덩어리를 한 번씩 넣는다(못 고른 것은 unsure)",
      items: {
        type: "object",
        properties: {
          what: { type: "string" },
          blobs: { type: "array", items: { type: "integer" } },
          colour: { type: "integer" },
          mine: { type: "boolean", description: "이 부위의 물건이면 true, 옆 부위의 물건(사진에 같이 걸친 것)이면 false — 둘 다 색은 고른다" },
        },
        required: ["blobs", "colour", "mine"],
      },
    },
    unsure: { type: "array", items: { type: "integer" }, description: "두 물건이 섞여 보여 못 고른 덩어리 — 앱이 맞닿은 색으로 홈·색 경계에서 나눠 채운다" },
  },
  required: ["assign"],
};

export interface TidyAssignment {
  observations: string[];
  assign: Array<{ what: string; blobs: number[]; colour: number; mine: boolean }>;
  unsure: number[];
}

/** A part's answer as the app can use it: blobs that exist, colours of the palette, each blob once. */
export function sanitizeAssign(raw: unknown, blobCount: number, paletteIds: Set<number>): TidyAssignment {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const seen = new Set<number>();
  const assign: TidyAssignment["assign"] = [];
  for (const m of Array.isArray(r.assign) ? r.assign : []) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    const colour = Math.round(Number(row.colour));
    if (!paletteIds.has(colour)) continue;
    const blobs = (Array.isArray(row.blobs) ? row.blobs : []).map((v) => Math.round(Number(v))).filter((v) => v >= 1 && v <= blobCount && !seen.has(v));
    blobs.forEach((v) => seen.add(v));
    if (blobs.length) assign.push({ what: String(row.what ?? "").trim().slice(0, 20), blobs, colour, mine: row.mine !== false });
  }
  const unsure = (Array.isArray(r.unsure) ? r.unsure : []).map((v) => Math.round(Number(v))).filter((v) => v >= 1 && v <= blobCount && !seen.has(v));
  return { observations: Array.isArray(r.observations) ? r.observations.map(String).filter(Boolean).slice(0, 4) : [], assign, unsure };
}

/** 🤖 step 2's question for one part. */
export function assignPrompt(
  context: TidyContext,
  part: { name: string; subject: string; main: TidyPaletteColour | null; also: TidyPaletteColour[]; looks: string; neighbours: Array<{ name: string; looks: string }> },
  palette: TidyPaletteColour[],
  blobs: Array<{ id: number; areaPct: number; mean: string; family: string }>,
  pictures: string[],
  message: string,
): string {
  return `■ 🤖 자동 색정리 2단계 — 부위 확대: ${part.name} (${part.subject || context.modelName})
이 부위와 그 둘레를 크게 본 사진이다. 흰 네모 숫자 = 덩어리 번호(이 사진에서만 센 번호). 번호 사진에서 어둡게 눌린 곳은 이 부위 밖(둘레 부위)이다 — 부위 지도는 칸 단위라 거칠어서, 둘레 부위의 물건도 같이 번호를 받는다. 덩어리는 원본 색을 계열(색 수 적게)과 명암(색 수 많게)으로 나눠 본 뒤, 홈 없이 색이 살짝만 바뀌는 곳(구운 명암)은 이미 한 덩어리로 묶은 것이다.
'색 지도' 사진은 같은 덩어리들을 겉면째 펼쳐 놓은 것이다(같은 번호) — 3D 사진에서 가려졌거나 작은 덩어리(뒤쪽, 가방 줄, 단추 점)는 거기서 확인한다. 형태는 3D 사진으로, 빠진 것은 지도로.
할 일: 형태를 보고 덩어리가 무엇인지(테·렌즈·줄무늬·머리카락 결·그림자·옆 물건 …) 알아본 뒤, 물건별로 묶어 팔레트 색 번호를 하나씩 고른다(assign). 모든 덩어리를 한 번씩 넣는다.
- mine: 그 묶음이 '${part.name}'의 물건이면 true, 둘레 부위의 물건이면 false(색은 그래도 고른다). 앱은 같은 곳을 여러 부위가 칠하면 mine 이라고 한 부위 중 가장 작은 부위의 답을 쓴다 — 렌즈가 모자 칸에 걸쳐 있어도 '모자 톱니'가 렌즈라고 하면 렌즈 색이 된다.
- 전체 사진에서 본 이 부위: ${part.looks || "(메모 없음)"}
- 둘레 부위: ${part.neighbours.length ? part.neighbours.map((n) => `${n.name}${n.looks ? ` — ${n.looks}` : ""}`).join(" / ") : "없음"}
- 이 부위의 주 색: ${part.main ? `${part.main.id} ${part.main.name}` : "?"}${part.also.length ? ` · 나올 수 있는 다른 색: ${part.also.map((c) => `${c.id} ${c.name}`).join(", ")}` : ""}. 팔레트 밖의 색은 못 쓴다.
- 같은 물건인데 구워진 그림자·하이라이트·얼룩으로 어둡거나 밝은 덩어리는 그 물건의 색으로 — 얼룩을 남기지 않는다.
- 무늬·디테일(줄무늬·테두리·눈·입·단추)은 원본에서 형태가 또렷하면 그 색으로 살린다.
- 맞닿은 다른 물건(옆 부위가 걸친 덩어리 포함)은 그 물건의 색으로. 원본 색이 비슷해도 다른 물건이면 구분되는 색으로(테와 렌즈).
- 테·고리 안에 홈으로 갈라져 들어앉은 판(렌즈·시계판·단추 가운데)은 '구멍 안쪽 그림자'가 아니라 따로 된 물건이다 — 테와 원본 색이 같아도 다른 색(보통 밝은 계열)으로. 진짜 뚫린 구멍(뒤가 보이거나 아주 어두움)만 그림자 색.
- 두 물건이 반씩 섞여 보이는 덩어리는 unsure 에 — 앱이 맞닿은 색으로 홈·색이 바뀌는 곳에서 나눠 채운다.

덩어리(번호 · 이 부위 안 면적 · 원본 평균색 · 계열):
${blobs.map((b) => `B${b.id} ${b.areaPct.toFixed(1)}% ${b.mean} ${b.family}`).join("\n")}

팔레트: ${paletteLine(palette)}

■ 사진 (이 순서로 붙어 있음)
${pictures.map((p, i) => `${i + 1}. ${p}`).join("\n")}

■ 규파의 말
${message}`;
}

/** 🤖 passes 2 and 3: the result so far next to the original — what is still wrong, part by part. */
export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    observations: { type: "array", items: { type: "string" }, description: "1~3줄: 결과 전체에서 본 것" },
    problems: {
      type: "array",
      description: "아직 틀린 곳(많아야 6): 부위 이름(목록 그대로)과 무엇이 틀렸는지 한 줄. 고칠 게 없으면 []",
      items: { type: "object", properties: { part: { type: "string" }, problem: { type: "string" } }, required: ["part", "problem"] },
    },
  },
  required: ["problems"],
};

/** The review's answer: known parts only, one line each, six at most. */
export function sanitizeReview(raw: unknown, partNames: string[]): Array<{ part: string; problem: string }> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const known = new Set(partNames);
  const out: Array<{ part: string; problem: string }> = [];
  for (const m of Array.isArray(r.problems) ? r.problems : []) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    const part = String(row.part ?? "").trim();
    const problem = String(row.problem ?? "").trim().slice(0, 200);
    if (!known.has(part) || !problem) continue;
    const same = out.find((x) => x.part === part);
    if (same) same.problem = `${same.problem} / ${problem}`.slice(0, 300);
    else out.push({ part, problem });
  }
  return out.slice(0, 6);
}

export function reviewPrompt(context: TidyContext, pass: number, parts: Array<{ name: string; looks: string }>, palette: TidyPaletteColour[], pictures: string[], message: string): string {
  return `■ 🤖 자동 색정리 ${pass}차 검토 (${context.shape?.subject ?? context.modelName})
${pass - 1}차까지 칠한 결과를 원본과 견준다. 틀린 곳을 부위별로 짚으면, 앱이 그 부위만 결과 확대 사진과 함께 다시 물어 고친다.
기준은 원본 사진이다(아래 부위 메모는 1단계의 짐작일 뿐, 원본과 다르면 원본이 맞다). 원본에서 서로 다른 색으로 칠해진 면은 결과에서도 구분되는 게 맞다 — 칙칙한 색이 맑게 바뀐 것(황갈색 → 주황, 회색 → 흰색)은 규칙대로라 틀린 게 아니다.
틀린 것으로 칠 것:
- 원본에 또렷하던 무늬·디테일이 결과에서 사라짐(가방 줄·단추·꽃 가운데 점·테두리·눈·입) — '원본 | 결과' 나란히 확대 사진에서 본다
- 원본에서 한 색이던 물건이 결과에서 두세 색으로 갈림, 얼룩·조각이 남음
- 원본에서 다른 색이던 면이 결과에서 한 색에 묻힘(테와 렌즈, 챙 끝과 챙)
- 원본에서 밝은 면이 결과에서 어둡게 칠해짐, 엉뚱한 색
- 테 안에 들어앉은 판(렌즈·시계판)은 원본에서 테와 같은 색이어도 구멍이 아니다 — 판을 구멍 그림자 색으로 칠하라고 짚지 않는다
치지 않을 것: 경계의 작은 톱니, 그림자 쪽의 아주 작은 점, 사진에 안 보이는 곳. 다 맞으면 problems 를 비운다 — 억지로 찾지 않는다.

■ 부위와 메모(1단계 짐작 — 참고만)
${parts.map((part) => `${part.name}: ${part.looks || "(메모 없음)"}`).join("\n")}

팔레트: ${paletteLine(palette)}

■ 사진 (이 순서로 붙어 있음)
${pictures.map((p, i) => `${i + 1}. ${p}`).join("\n")}

■ 규파의 말
${message}`;
}

/** 🤖 passes 2 and 3, a part named in the review: the things to fix pointed at on its pictures. */
export const POINT_SCHEMA = {
  type: "object",
  properties: {
    observations: { type: "array", items: { type: "string" }, description: "1~2줄: 무엇을 어디에 찍었는지" },
    points: {
      type: "array",
      description: "고칠 물건마다(조각마다) 점 하나: 사진 번호, 픽셀 x·y(왼쪽 위가 0,0), 무엇, 칠할 팔레트 번호. 고칠 게 없으면 []",
      items: {
        type: "object",
        properties: {
          picture: { type: "integer" },
          x: { type: "number" },
          y: { type: "number" },
          what: { type: "string" },
          colour: { type: "integer" },
          source: { type: "string", description: "원본 사진에서 그 물건이 보이는 색(대략 hex, 예: 황갈색 줄이면 #B89B62). 앱이 점 둘레에서 이 색의 면을 골라 시작한다" },
          shaded: { type: "boolean", description: "넓은 면(옷깃·주름 천·소매)이라 접힌 곳·그늘에 명암이 있으면 true — 앱이 밝기 차이는 덜 따져 한 물건으로 잡는다. 가는 선·테·점(입 선·눈 테·단추 점)이면 false" },
        },
        required: ["picture", "x", "y", "colour", "source"],
      },
    },
  },
  required: ["points"],
};

export function sanitizePoints(raw: unknown, pictures: number[], size: number, paletteIds: Set<number>): Array<{ picture: number; x: number; y: number; what: string; colour: number; source: string | null; shaded: boolean }> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Array<{ picture: number; x: number; y: number; what: string; colour: number; source: string | null; shaded: boolean }> = [];
  for (const m of Array.isArray(r.points) ? r.points : []) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    const picture = Math.round(Number(row.picture));
    const x = Number(row.x), y = Number(row.y), colour = Math.round(Number(row.colour));
    if (!pictures.includes(picture) || !(x >= 0 && x < size && y >= 0 && y < size) || !paletteIds.has(colour)) continue;
    const source = String(row.source ?? "").trim().toUpperCase();
    out.push({ picture, x, y, what: String(row.what ?? "").trim().slice(0, 30), colour, source: HEX_RE.test(source) ? source : null, shaded: row.shaded === true });
  }
  return out.slice(0, 12);
}

export function pointPrompt(context: TidyContext, pass: number, part: string, subject: string, problem: string, palette: TidyPaletteColour[], pick: number[], resultPicture: number, size: number, pictures: string[], message: string): string {
  // pass 0: the consult's own fix (what the owner asked for), not a review's.
  return `■ ${pass > 0 ? `🤖 ${pass}차 고치기` : "💬 상의 고치기"} — 점 찍기: ${part} (${subject || context.modelName})
${pass > 0 ? "검토에서 지적" : "고칠 것"}: ${problem}
사진 ${pick.join("·")} = 원본 색 확대, 사진 ${resultPicture} = 지금 결과(사진 ${pick[0]}과 같은 각도). 모두 ${size}×${size} 픽셀, 격자는 60픽셀마다(가장자리 숫자 = 픽셀 위치).
지적된 것을 고칠 물건마다 원본 사진(${pick.join("·")}) 위에 점을 찍는다: {picture, x, y, what, colour(팔레트 번호)}. 앱이 점 아래 면에서 시작해 원본 색이 같은 곳까지 넓혀(홈에서 멈춤) 그 물건을 정확히 잡고 그 색으로 칠한다 — 경계는 앱이 잡으니 점만 정확하면 된다.
- 점은 물건 한가운데 깊숙이(가장자리·경계 말고). 작은 점·가는 줄도 그 위에 정확히.
- shaded: 넓은 면(옷깃·주름 천·소매)이라 접힌 곳·그늘에 명암이 있으면 true(앱이 밝기는 덜 따져 한 물건으로 잡는다). 가는 선·테·점이면 false(밝기까지 따져 둘레로 번지지 않게). source 에 원본에서 그 물건이 보이는 색을 적는다 — 점이 조금 빗나가면 앱이 둘레에서 그 색의 면을 찾아 시작하고, 없으면 그 점은 버린다(옆 물건으로 번지지 않게).
- 한 물건이 여러 조각이면(줄 두 개, 양쪽 렌즈) 조각마다 점 하나.
- 지적과 상관없는 곳은 찍지 않는다. 사진에 안 보이면 찍지 않는다.

팔레트: ${paletteLine(palette)}

■ 사진 (이 순서로 붙어 있음)
${pictures.map((p, i) => `${i + 1}. ${p}`).join("\n")}

■ 규파의 말
${message}`;
}

function mixLine(mix: MixSettings): string {
  return `출력 방식 ${mix.assignmentMode} · 섞는 수 ${mix.maxComponents} · 비율 ${mix.recipeResolution} · 포인트 ${mix.accentProtection} · 짝짓기 ${mix.mappingStrategy} · 우선 ${mix.mixPriority} · 가까우면 실물 ${mix.autoPhysicalDirect ? `켬(ΔE ${mix.physicalDirectDeltaE})` : "끔"}`;
}

/** The part that changes every turn: the state now, the conversation so far and the new message. */
export function tidyTurnPrompt(context: TidyContext, scope: TidyScope, history: TidyLogEntry[], message: string, pictures: string[]): string {
  const palette = [...context.palette]
    .sort((a, b) => b.areaPct - a.areaPct)
    .map(
      (c) =>
        `${c.hex} ${c.areaPct.toFixed(2)}% ${c.family}${c.shades > 1 ? ` 명암${c.shades}` : ""}${c.protected ? " 보호" : ""}${c.output ? ` →${c.output}` : ""}` +
        (scope === "mix" || scope === "both" ? `${c.recipe ? ` [${c.recipe}${c.hand ? " 손" : ""}]` : ""}${c.printed ? ` 나오는 색 ${c.printed}` : ""}` : ""),
    )
    .join("\n");
  const scores = context.mixScores?.length
    ? context.mixScores
        .map((s) => `${s.components}개·${s.resolution}: fidelity ${s.fidelity.toFixed(0)} · 평균오차 ${s.meanError.toFixed(1)} · 주기 ${s.cycleLayers}층${s.lost ? ` · 잃는 색 ${s.lost}` : ""}${s.recommended ? " ★" : ""}`)
        .join("\n")
    : "(점수표 없음)";
  const slots = context.slots.map((s) => `${s.label} ${s.hex} ${s.name}`).join(" · ");
  const past = history
    .slice(-16)
    .map((h) => {
      if (h.role === "user") return `규파: ${h.text}`;
      if (h.role === "sys") return `(기록) ${h.text}`;
      const state = h.status === "applied" ? "적용됨" : h.status === "preview" ? "미리보기 중(아직 확정 안 함)" : h.status === "undone" ? "되돌림" : "제안";
      const what = h.lines?.length ? ` [${state}: ${h.lines.map((l) => `${l.label} ${l.from}→${l.to}`).join(", ")}]` : "";
      return `너: ${h.text}${what}`;
    })
    .join("\n");
  const shape = context.shape
    ? `■ 부위 지도 — ${context.shape.subject || "(무엇인지 미정)"} · 칸 ${context.cellCount}개
${context.shape.parts
  .map((part) => `${part.name} ${part.areaPct.toFixed(1)}% (칸 ${part.cells.join(",")}): ${part.colours.filter((c) => c.pct >= 0.3).slice(0, 7).map((c) => `${c.hex} ${c.pct.toFixed(1)}%`).join(" · ")}`)
  .join("\n")}`
    : `■ 부위 지도: 아직 없음 (칸 ${context.cellCount ?? 0}개 — 필요하면 parts 로 짓는다)`;
  const specks = context.specks?.length
    ? context.specks.filter((s) => s.tiny > 0).slice(0, 12).map((s) => `${s.hex} 작은 조각 ${s.patches}개(20면 이하 ${s.tiny}개, ${s.faces.toLocaleString()}면)`).join(" · ")
    : "";
  const pitsBlock =
    (scope === "clean" || scope === "both") && context.pits?.length
      ? `구멍 디테일(파이고 원본이 어두운 곳, 번호 P): ${context.pits
          .map((p) => `P${p.id} ${p.part ? `${p.part}의 ` : ""}${p.inside}${p.around.length ? `·${p.around.join("·")}` : ""} 둘레 · 원본 ${p.own} · ${p.faces}면 ${p.areaPct.toFixed(3)}%`)
          .join(" / ")}\n`
      : "";
  const ex = context.exportInfo;
  const exportBlock = ex
    ? `■ 내보내기 지금
프린터 ${ex.printer} · 판 ${ex.bed[0]}×${ex.bed[1]}mm · 크기 ${ex.sizeMm ? ex.sizeMm.map((v) => v.toFixed(0)).join("×") + "mm" : "?"} · 높이 ${ex.settings.targetHeight}mm · 조각 ${ex.pieces ?? "?"}개 · 색 ${ex.colours}가지 · 슬롯 ${ex.extruders}개
조각 나누기 ${ex.settings.splitObjects ? "켬" : "끔"} · 한 객체의 부품 ${ex.settings.splitAsParts ? "켬" : "끔"} · 작은 구멍 막기 ${ex.settings.closeHoles ? "켬" : "끔"} · 바닥에 ${ex.settings.putOnBed ? "켬" : "끔"} · 가운데 ${ex.settings.centerOnBed ? "켬" : "끔"} · 선 따라 자르기 ${ex.settings.borderCut ? "켬" : "끔"} · 품질 ${ex.settings.printPreset}
${ex.lastExport ? `지난 내보내기: ${ex.lastExport}` : ""}`
    : "";
  return `■ 지금 상태 (범위: ${SCOPE_LABEL[scope]})
원본 색 ${context.sourceColours.toLocaleString()}가지 · 목표 색 수 ${context.target} · 작은 조각 흡수 ${context.minBlob}면 · 경계 다듬기 ${context.smoothing}회 · 보호한 색도 다듬기 ${context.smoothProtected ? "켬" : "끔"} · 톱니 깎기 ${context.trimTeeth}회 · 경계 선 펴기 ${context.lineSmooth}칸
팔레트(면적순, hex 면적 계열 [보호] [→출력]${scope === "mix" || scope === "both" ? " [비율] 나오는 색" : ""}):
${palette}
${specks ? `작은 조각: ${specks}\n` : ""}${pitsBlock}
${scope === "clean" || scope === "both" ? shape + "\n" : ""}
필라멘트 슬롯: ${slots || "(없음)"}${context.layerHeight ? ` · 층 높이 ${context.layerHeight}mm` : ""}
혼합 설정: ${mixLine(context.mix)}
혼합 점수표:
${scores}
${exportBlock}

■ 사진 (이 순서로 붙어 있음)
${pictures.map((p, i) => `${i + 1}. ${p}`).join("\n")}

■ 지금까지 주고받은 말
${past || "(처음)"}

■ 규파의 말
${message}`;
}
