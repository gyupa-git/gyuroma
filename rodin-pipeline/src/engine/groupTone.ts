import { colourKey, familyOf, type StripColour } from "@core/colourStrip";
import { labToRgb, rgbToLab, type LAB } from "@core/prusaFdmMixer";
import type { RGB } from "@core/types";

/**
 * Brightness, saturation and hue of a whole group at once.  Every shade of
 * the group moves by the same amount, so its shading stays: lighter or
 * darker in CIELAB lightness, more or less chroma, the hue turned a little.
 * A shade moves only as far as it can while staying in its colour family (a
 * green stays a green on the spectrum, so its band does not jump to another
 * family) and on screen (no colour a display cannot show).  Lightness eases
 * toward a wall instead of crossing it: white and black, and the lightness of
 * the next group of the same family — a band on the spectrum is a run of
 * lightness, so a group made as dark as the one below would hand faces to it
 * (or take its faces); this way no other group changes.  Each slider runs
 * -100 … 100, 0 as it is.
 */
export interface Tone {
  light: number;
  chroma: number;
  hue: number;
}

export const NO_TONE: Tone = { light: 0, chroma: 0, hue: 0 };

export function isNoTone(tone: Tone): boolean {
  return tone.light === 0 && tone.chroma === 0 && tone.hue === 0;
}

export function sameTone(a: Tone, b: Tone): boolean {
  return a.light === b.light && a.chroma === b.chroma && a.hue === b.hue;
}

/** At ±100, how far lightness moves (CIELAB L) where nothing is near. */
const MOST_LIGHT = 30;
/** At ±100, how far the hue turns (degrees). */
const MOST_HUE = 30;

export type ToneColour = Pick<StripColour, "key" | "rgb" | "lab" | "family">;

/** The lightness a group's shades stay between (the next groups of its family, or black and white). */
export interface ToneWalls {
  darkest: number;
  lightest: number;
}

const OPEN: ToneWalls = { darkest: 0, lightest: 100 };

/**
 * The new colour of every shade (by its key) with the group at `tone`.  A
 * shade never lands on a colour in `taken` (another group's), so the groups
 * stay apart, nor on another shade's new colour, so every shade stays its own
 * (and a piece split off can be given back its colours one by one): it takes
 * the nearest free colour instead.
 */
export function toneColours(colours: readonly ToneColour[], tone: Tone, taken?: { has(key: number): boolean }, walls: ToneWalls = OPEN): Map<number, RGB> {
  const out = new Map<number, RGB>();
  if (isNoTone(tone)) {
    for (const colour of colours) out.set(colour.key, colour.rgb);
    return out;
  }
  const used = new Set<number>();
  const blocked = taken && { has: (key: number) => taken.has(key) || used.has(key) };
  for (const colour of colours) {
    let rgb = labToRgb(moved(colour.lab, tone, 1, walls));
    if (familyOf(rgbToLab(rgb)) !== colour.family) {
      // as far as it goes while still in its family
      let lo = 0;
      let hi = 1;
      rgb = colour.rgb;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        const tried = labToRgb(moved(colour.lab, tone, mid, walls));
        if (familyOf(rgbToLab(tried)) === colour.family) {
          lo = mid;
          rgb = tried;
        } else hi = mid;
      }
    }
    const landed = blocked ? free(rgb, colour.family, blocked) : rgb;
    used.add(colourKey(landed));
    out.set(colour.key, landed);
  }
  return out;
}

function moved(lab: LAB, tone: Tone, amount: number, walls: ToneWalls): LAB {
  const L = lightTo(lab.L, (tone.light / 100) * MOST_LIGHT * amount, walls);
  const chroma = Math.hypot(lab.a, lab.b) * Math.max(0, 1 + (tone.chroma / 100) * amount);
  const hue = Math.atan2(lab.b, lab.a) + ((tone.hue / 100) * MOST_HUE * amount * Math.PI) / 180;
  return onScreen(L, chroma, hue);
}

/**
 * `L` moved by `shift`, easing toward the wall it heads for: a shade far from
 * it moves (almost) the whole way, one close to it a little, none past it —
 * and the order of the shades stays.
 */
export function lightTo(L: number, shift: number, walls: ToneWalls = OPEN): number {
  if (shift === 0) return L;
  const room = shift < 0 ? L - walls.darkest : walls.lightest - L;
  if (room <= 0) return L;
  const left = room * Math.exp(-Math.abs(shift) / room);
  return shift < 0 ? walls.darkest + left : walls.lightest - left;
}

/** The colour at this lightness and hue with as much of the chroma as a screen can show. */
function onScreen(L: number, chroma: number, hue: number): LAB {
  const cos = Math.cos(hue);
  const sin = Math.sin(hue);
  if (shows(L, chroma * cos, chroma * sin)) return { L, a: chroma * cos, b: chroma * sin };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (shows(L, chroma * mid * cos, chroma * mid * sin)) lo = mid;
    else hi = mid;
  }
  return { L, a: chroma * lo * cos, b: chroma * lo * sin };
}

function shows(L: number, a: number, b: number): boolean {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const inv = (t: number) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const x = 0.95047 * inv(fx);
  const y = inv(fy);
  const z = 1.08883 * inv(fz);
  const r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  const e = 0.002;
  return r >= -e && r <= 1 + e && g >= -e && g <= 1 + e && bl >= -e && bl <= 1 + e;
}

/** Steps to a neighbouring colour, nearest first. */
const NUDGES: Array<[number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let r = -2; r <= 2; r++) for (let g = -2; g <= 2; g++) for (let b = -2; b <= 2; b++) if (r || g || b) out.push([r, g, b]);
  return out.sort((p, q) => Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]) - (Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2])));
})();

function free(rgb: RGB, family: number, taken: { has(key: number): boolean }): RGB {
  if (!taken.has(colourKey(rgb))) return rgb;
  for (const [dr, dg, db] of NUDGES) {
    const next: RGB = [rgb[0] + dr, rgb[1] + dg, rgb[2] + db];
    if (next.some((v) => v < 0 || v > 255) || taken.has(colourKey(next))) continue;
    if (familyOf(rgbToLab(next)) === family) return next;
  }
  return rgb;
}
