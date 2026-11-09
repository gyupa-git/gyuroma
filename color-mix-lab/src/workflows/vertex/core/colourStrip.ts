import { labChroma, labHueDegrees, rgbToLab, type LAB } from "./prusaFdmMixer";
import { POOL_ID, poolSize } from "./rgbPool";
import type { PaletteEntry, RGB } from "./types";

/**
 * The colour strip: every colour the model has, laid out family by family
 * (neutral, red, orange, …) and inside a family from light to dark, with a
 * band for each group.  Groups are made by cutting a family's run of colours;
 * a cut is kept as the fraction of the family's area above it, so dragging a
 * cut by pixels moves it by area — the thing the eye sees as band height.
 *
 * Nothing here touches face colours.  The groups become the palette; the
 * model's own colours stay as they are until "정리 실행" bakes them.
 */

export const FAMILY_NAMES = ["neutral", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
export type FamilyName = (typeof FAMILY_NAMES)[number];

/** Below this chroma a colour is a grey, whatever its hue angle says. */
const NEUTRAL_CHROMA = 9;

/**
 * Hue sector per family in FAMILY_NAMES order from index 1.  These are CIELAB
 * hue angles, which sit differently from the familiar RGB colour wheel: pure
 * red is near 40°, yellow near 100°, green near 135°, blue near 305°.
 */
const HUE_SECTORS: Array<[number, number]> = [
  [25, 50], // red
  [50, 80], // orange
  [80, 115], // yellow
  [115, 175], // green
  [175, 240], // cyan
  [240, 310], // blue
  [310, 355], // purple
  [355, 25], // pink (wraps through 0°)
];

export function familyOf(lab: LAB): number {
  if (labChroma(lab) < NEUTRAL_CHROMA) return 0;
  const hue = ((labHueDegrees(lab) % 360) + 360) % 360;
  for (let i = 0; i < HUE_SECTORS.length; i++) {
    const [lo, hi] = HUE_SECTORS[i];
    if (lo < hi ? hue >= lo && hue < hi : hue >= lo || hue < hi) return i + 1;
  }
  return 1;
}

export interface StripColour {
  /** r<<16 | g<<8 | b */
  key: number;
  rgb: RGB;
  lab: LAB;
  /** Share of the model's area (all colours sum to 1). */
  weight: number;
  family: number;
  /** Set when the colour is pinned: a piece split off to be a group of its own (see `buildColourStrip`). */
  pin?: number;
}

export interface StripFamily {
  family: number;
  name: FamilyName;
  /** Light to dark. */
  colours: StripColour[];
  weight: number;
}

export interface ColourStripData {
  families: StripFamily[];
  colourCount: number;
}

export function colourKey(rgb: RGB): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

/**
 * Unique colours with their area, sorted into families and by lightness.
 * Pinned colours (key -> pin) come after the rest of their family, each pin's
 * together: a piece split off keeps a band of its own wherever its lightness
 * falls, instead of mixing into the band that lightness belongs to.
 */
type Pooled = RGB & { [POOL_ID]?: number };

/**
 * Each colour's faces' weights added up in face order, the colours in the order first met.  Colours from the
 * shared pool (all of them, once the app has shared them) add up in plain arrays by their POOL_ID — no key worked
 * out and no map per face (11-10: Tkc 4.7M faces, 16k colours); a colour that is not from the pool sends it all to
 * the map.  Either way each colour adds its weights in face order: the sums are the same to the last bit.
 */
function colourSums(colours: ArrayLike<RGB>, weights?: ArrayLike<number>): { entries: Array<{ key: number; rgb: RGB; weight: number }>; total: number } {
  const size = poolSize();
  const sums = new Float64Array(size);
  const seen = new Uint8Array(size);
  const order: number[] = [];
  const firsts: RGB[] = [];
  let total = 0;
  let pooled = size > 0;
  let lastRgb: RGB | undefined;
  let lastId = -1;
  for (let i = 0; pooled && i < colours.length; i++) {
    const w = weights ? weights[i] : 1;
    if (!(w > 0)) continue;
    total += w;
    const rgb = colours[i];
    // Neighbouring faces mostly share a colour: the last face's array is the same entry.
    if (rgb === lastRgb) {
      sums[lastId] += w;
      continue;
    }
    const id = (rgb as Pooled)[POOL_ID];
    if (id === undefined || id >= size) {
      pooled = false;
      break;
    }
    if (seen[id] === 0) {
      seen[id] = 1;
      order.push(id);
      firsts.push(rgb);
      sums[id] = w;
    } else sums[id] += w;
    lastRgb = rgb;
    lastId = id;
  }
  if (pooled) return { entries: order.map((id, k) => ({ key: colourKey(firsts[k]), rgb: firsts[k], weight: sums[id] })), total };

  const byKey = new Map<number, { key: number; rgb: RGB; weight: number }>();
  total = 0;
  let lastEntry: { key: number; rgb: RGB; weight: number } | undefined;
  lastRgb = undefined;
  for (let i = 0; i < colours.length; i++) {
    const w = weights ? weights[i] : 1;
    if (!(w > 0)) continue;
    total += w;
    const rgb = colours[i];
    if (lastEntry !== undefined && rgb === lastRgb) {
      lastEntry.weight += w;
      continue;
    }
    const key = colourKey(rgb);
    let entry = byKey.get(key);
    if (entry) entry.weight += w;
    else byKey.set(key, (entry = { key, rgb, weight: w }));
    lastRgb = rgb;
    lastEntry = entry;
  }
  return { entries: [...byKey.values()], total };
}

export function buildColourStrip(colours: ArrayLike<RGB>, weights?: ArrayLike<number>, pins?: ReadonlyMap<number, number>): ColourStripData {
  const { entries, total } = colourSums(colours, weights);
  const families: StripFamily[] = FAMILY_NAMES.map((name, family) => ({ family, name, colours: [], weight: 0 }));
  for (const { key, ...entry } of entries) {
    const lab = rgbToLab(entry.rgb);
    const family = familyOf(lab);
    const colour: StripColour = { key, rgb: entry.rgb, lab, weight: total > 0 ? entry.weight / total : 0, family };
    const pin = pins?.get(key);
    if (pin !== undefined) colour.pin = pin;
    families[family].colours.push(colour);
    families[family].weight += colour.weight;
  }
  for (const family of families) family.colours.sort((a, b) => (a.pin ?? -1) - (b.pin ?? -1) || b.lab.L - a.lab.L);
  return { families: families.filter((family) => family.colours.length > 0), colourCount: entries.length };
}

/** Cut positions per family: fractions (0, 1) of the family's area, ascending. */
export type StripCuts = Record<number, number[]>;

export interface StripGroup {
  family: number;
  /** Position inside the family, light to dark. */
  index: number;
  colours: StripColour[];
  weight: number;
  /** Area fraction of the family where this group starts and ends. */
  from: number;
  to: number;
  /** The colour that covers the most area in the group. */
  rep: RGB;
  /** Light and dark ends of the group's lightness range. */
  lightest: number;
  darkest: number;
  /** A pinned piece's group (every colour pinned). */
  pinned?: boolean;
}

function representative(colours: StripColour[]): RGB {
  let best = colours[0];
  for (const colour of colours) if (colour.weight > best.weight) best = colour;
  return best.rgb;
}

/**
 * Splits every family at its cuts.  A cut that no colour falls under still
 * yields an (empty) group so a drag can show a band shrinking to nothing;
 * `normaliseCuts` removes those once the drag ends.
 */
export function groupsFromCuts(strip: ColourStripData, cuts: StripCuts): StripGroup[] {
  const out: StripGroup[] = [];
  for (const family of strip.families) {
    const thresholds = [...(cuts[family.family] ?? [])].filter((q) => q > 0 && q < 1).sort((a, b) => a - b);
    const bounds = [0, ...thresholds, 1];
    let position = 0; // cumulative fraction of the family's area
    let colourIndex = 0;
    for (let g = 0; g + 1 < bounds.length; g++) {
      const from = bounds[g];
      const to = bounds[g + 1];
      const colours: StripColour[] = [];
      let weight = 0;
      // A colour belongs to the group its centre of area falls in.
      while (colourIndex < family.colours.length) {
        const colour = family.colours[colourIndex];
        const share = family.weight > 0 ? colour.weight / family.weight : 0;
        const centre = position + share / 2;
        if (centre >= to && g + 1 < bounds.length - 1) break;
        colours.push(colour);
        weight += colour.weight;
        position += share;
        colourIndex++;
      }
      out.push({
        family: family.family,
        index: g,
        colours,
        weight,
        from,
        to,
        rep: colours.length > 0 ? representative(colours) : [128, 128, 128],
        lightest: colours.length > 0 ? colours[0].lab.L : 0,
        darkest: colours.length > 0 ? colours[colours.length - 1].lab.L : 0,
        ...(colours.length > 0 && colours.every((colour) => colour.pin !== undefined) ? { pinned: true } : {}),
      });
    }
  }
  return out;
}

/** Drops cuts that left a group empty, so a band dragged to nothing is gone for good. */
export function normaliseCuts(strip: ColourStripData, cuts: StripCuts): StripCuts {
  const groups = groupsFromCuts(strip, cuts);
  const out: StripCuts = {};
  for (const family of strip.families) {
    const survivors = groups.filter((group) => group.family === family.family && group.colours.length > 0);
    // The surviving groups' boundaries, re-derived from their areas, are the cuts.
    const rebuilt: number[] = [];
    let acc = 0;
    for (let i = 0; i < survivors.length - 1; i++) {
      acc += family.weight > 0 ? survivors[i].weight / family.weight : 0;
      rebuilt.push(acc);
    }
    if (rebuilt.length > 0) out[family.family] = rebuilt;
  }
  return out;
}

/**
 * Where to put the cuts for a target number of groups: groups are handed to
 * families in proportion to their area (every family keeps at least one), and
 * inside a family they fall where the lightness changes most, by a weighted
 * one-dimensional partition over lightness bins.
 */
/** A family whose colours span this much lightness (L*) keeps two groups before any family gets a third. */
const SPLIT_SPREAD = 45;

/**
 * The lightness (L*) a family's colours span, between its area-weighted 3rd and
 * 97th percentiles: a speck of white in a black family counts for nothing.
 */
function lightnessSpread(family: StripFamily): number {
  if (family.weight <= 0 || family.colours.length < 2) return 0;
  const edge = family.weight * 0.03;
  let acc = 0;
  let light = family.colours[0].lab.L;
  for (const colour of family.colours) {
    acc += colour.weight;
    if (acc >= edge) {
      light = colour.lab.L;
      break;
    }
  }
  acc = 0;
  let dark = family.colours[family.colours.length - 1].lab.L;
  for (let i = family.colours.length - 1; i >= 0; i--) {
    acc += family.colours[i].weight;
    if (acc >= edge) {
      dark = family.colours[i].lab.L;
      break;
    }
  }
  return light - dark;
}

export function initialCuts(strip: ColourStripData, targetGroups: number): StripCuts {
  const families = strip.families;
  if (families.length === 0) return {};
  const target = Math.max(families.length, Math.min(targetGroups, families.reduce((n, f) => n + f.colours.length, 0)));
  // Largest-remainder allocation with a floor of one per family — and, before any family
  // gets a third, a second group for each family that runs from light to dark (white and
  // black are both "neutral": one group would paint the one as the other), biggest first.
  const alloc = families.map(() => 1);
  let remaining = target - families.length;
  const wide = families
    .map((_family, i) => i)
    .filter((i) => families[i].colours.length > 1 && lightnessSpread(families[i]) >= SPLIT_SPREAD)
    .sort((a, b) => families[b].weight - families[a].weight);
  for (const i of wide) {
    if (remaining <= 0) break;
    alloc[i]++;
    remaining--;
  }
  const quota = families.map((family) => family.weight * remaining);
  const base = quota.map((q, i) => Math.min(Math.floor(q), families[i].colours.length - alloc[i]));
  for (let i = 0; i < families.length; i++) {
    alloc[i] += base[i];
    remaining -= base[i];
  }
  const order = families
    .map((family, i) => ({ i, frac: quota[i] - base[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remaining <= 0) break;
    if (alloc[i] < families[i].colours.length) {
      alloc[i]++;
      remaining--;
    }
  }
  const cuts: StripCuts = {};
  families.forEach((family, i) => {
    const breaks = withPins(family, (loose) => partitionByLightness(loose, alloc[i]));
    if (breaks.length > 0) cuts[family.family] = breaks;
  });
  return cuts;
}

/**
 * Cuts for a family with pinned colours at its end: `cut` lays out the rest
 * by lightness (given just those colours), and every pin starts a band of
 * its own.
 */
function withPins(family: StripFamily, cut: (loose: StripFamily) => number[]): number[] {
  const loose = family.colours.filter((colour) => colour.pin === undefined);
  if (loose.length === family.colours.length) return cut(family);
  const looseWeight = loose.reduce((sum, colour) => sum + colour.weight, 0);
  const share = family.weight > 0 ? looseWeight / family.weight : 0;
  const breaks = loose.length > 1 ? cut({ ...family, colours: loose, weight: looseWeight }).map((q) => q * share) : [];
  let acc = 0;
  let last: number | undefined;
  for (const colour of family.colours) {
    const pin = colour.pin ?? -1;
    if (last !== undefined && pin !== last && family.weight > 0) breaks.push(acc / family.weight);
    acc += colour.weight;
    last = pin;
  }
  return breaks.filter((q, i, all) => q > 0 && q < 1 && all.indexOf(q) === i).sort((a, b) => a - b);
}

const LIGHTNESS_BINS = 96;

/** Weighted optimal partition of a family's lightness into k runs; returns area-fraction cuts. */
function partitionByLightness(family: StripFamily, k: number): number[] {
  if (k <= 1 || family.colours.length <= 1) return [];
  // Bin colours by lightness (they are sorted light to dark).
  const lo = family.colours[family.colours.length - 1].lab.L;
  const hi = family.colours[0].lab.L;
  const span = Math.max(1e-6, hi - lo);
  const bins = Math.min(LIGHTNESS_BINS, family.colours.length);
  const weight = new Float64Array(bins);
  const sum = new Float64Array(bins);
  const sumSq = new Float64Array(bins);
  for (const colour of family.colours) {
    const b = Math.min(bins - 1, Math.floor(((hi - colour.lab.L) / span) * bins));
    weight[b] += colour.weight;
    sum[b] += colour.weight * colour.lab.L;
    sumSq[b] += colour.weight * colour.lab.L * colour.lab.L;
  }
  // Prefix sums for O(1) run cost = weighted variance of lightness in the run.
  const W = new Float64Array(bins + 1);
  const S = new Float64Array(bins + 1);
  const Q = new Float64Array(bins + 1);
  for (let b = 0; b < bins; b++) {
    W[b + 1] = W[b] + weight[b];
    S[b + 1] = S[b] + sum[b];
    Q[b + 1] = Q[b] + sumSq[b];
  }
  const cost = (a: number, b: number): number => {
    const w = W[b] - W[a];
    if (w <= 0) return 0;
    const s = S[b] - S[a];
    return Q[b] - Q[a] - (s * s) / w;
  };
  const groups = Math.min(k, bins);
  const best: Float64Array[] = [];
  const choice: Int32Array[] = [];
  for (let g = 0; g <= groups; g++) {
    best.push(new Float64Array(bins + 1).fill(Infinity));
    choice.push(new Int32Array(bins + 1).fill(-1));
  }
  best[0][0] = 0;
  for (let g = 1; g <= groups; g++) {
    for (let b = g; b <= bins; b++) {
      for (let a = g - 1; a < b; a++) {
        if (best[g - 1][a] === Infinity) continue;
        const c = best[g - 1][a] + cost(a, b);
        if (c < best[g][b]) {
          best[g][b] = c;
          choice[g][b] = a;
        }
      }
    }
  }
  const boundaries: number[] = [];
  let b = bins;
  for (let g = groups; g > 1; g--) {
    const a = choice[g][b];
    boundaries.push(a);
    b = a;
  }
  boundaries.sort((x, y) => x - y);
  // Bin boundary -> fraction of the family's area above it.
  const total = W[bins] || 1;
  return boundaries.map((bin) => W[bin] / total).filter((q, i, arr) => q > 0 && q < 1 && arr.indexOf(q) === i);
}

/** Moves one cut, keeping it between its neighbours (and inside the family). */
export function moveCut(cuts: StripCuts, family: number, index: number, fraction: number): StripCuts {
  const own = [...(cuts[family] ?? [])];
  if (index < 0 || index >= own.length) return cuts;
  const lo = index > 0 ? own[index - 1] : 0;
  const hi = index + 1 < own.length ? own[index + 1] : 1;
  own[index] = Math.max(lo, Math.min(hi, fraction));
  return { ...cuts, [family]: own };
}

/** Adds a cut at `fraction` of the family's area. */
export function addCut(cuts: StripCuts, family: number, fraction: number): StripCuts {
  if (!(fraction > 0 && fraction < 1)) return cuts;
  const own = [...(cuts[family] ?? []), fraction].sort((a, b) => a - b);
  return { ...cuts, [family]: own };
}

/** Removes the cut above group `index` (merging it into the group above). */
export function removeCut(cuts: StripCuts, family: number, index: number): StripCuts {
  const own = [...(cuts[family] ?? [])];
  if (index <= 0 || index > own.length) return cuts;
  own.splice(index - 1, 1);
  return { ...cuts, [family]: own };
}

/**
 * The palette the rest of the pipeline works from: one entry per non-empty
 * group, numbered in strip order, and the group of every colour key.
 */
export function stripPalette(groups: StripGroup[]): { palette: PaletteEntry[]; groupOfKey: Map<number, number> } {
  const palette: PaletteEntry[] = [];
  const groupOfKey = new Map<number, number>();
  for (const group of groups) {
    if (group.colours.length === 0) continue;
    const position = palette.length;
    palette.push({ index: position + 1, rgb: group.rep, count: 0 });
    for (const colour of group.colours) groupOfKey.set(colour.key, position);
  }
  return { palette, groupOfKey };
}

/** Face -> palette position, and the face count per entry. */
export function stripLabels(colours: ArrayLike<RGB>, groupOfKey: Map<number, number>, palette: PaletteEntry[]): Int32Array {
  const labels = new Int32Array(colours.length);
  const counts = new Int32Array(palette.length);
  for (let i = 0; i < colours.length; i++) {
    const position = groupOfKey.get(colourKey(colours[i])) ?? 0;
    labels[i] = position;
    counts[position]++;
  }
  palette.forEach((entry, position) => {
    entry.count = counts[position];
  });
  return labels;
}
