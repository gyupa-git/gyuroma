import flushTables from "./bambu/flushTables.json";

/**
 * Bambu Studio's purge ("flush") volume between two filament colours, as its
 * flushing-volume dialog fills the matrix (FlushVolCalc.cpp and
 * FlushVolPredictor.cpp, Bambu Studio 2.8).  A colour pair close to one
 * Bambu measured (ΔE00 ≤ 5 to a colour of the data set) takes the measured
 * value; any other pair comes from the HSV/luminance formula plus the nozzle's
 * minimum.  Checked cell by cell against matrices the Bambu Studio CLI wrote.
 */

type Rgb = readonly [number, number, number];

interface FlushTable {
  colours: string[];
  pairs: Array<[string, string, number]>;
}

const MAX_FLUSH = 900;

function hexRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lab(c: Rgb): [number, number, number] {
  const g = (x: number) => (x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92);
  const [R, G, B] = c.map((v) => g(v / 255) * 100);
  const x = 0.412453 * R + 0.35758 * G + 0.180423 * B;
  const y = 0.212671 * R + 0.71516 * G + 0.072169 * B;
  const z = 0.019334 * R + 0.119193 * G + 0.950227 * B;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 0.137931);
  const xn = f(x / 95.0489);
  const yn = f(y / 100);
  const zn = f(z / 108.884);
  return [116 * yn - 16, 500 * (xn - yn), 200 * (yn - zn)];
}

/** CIEDE2000 as Bambu Studio writes it. */
function deltaE00(l1: [number, number, number], l2: [number, number, number]): number {
  const p25 = 25 ** 7;
  const rad = (d: number) => (d * Math.PI) / 180;
  const C1 = Math.hypot(l1[1], l1[2]);
  const C2 = Math.hypot(l2[1], l2[2]);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + p25)));
  const a1 = (1 + G) * l1[1];
  const a2 = (1 + G) * l2[1];
  const c1 = Math.hypot(a1, l1[2]);
  const c2 = Math.hypot(a2, l2[2]);
  const hueOf = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a);
    return h < 0 ? h + 2 * Math.PI : h;
  };
  const h1 = hueOf(a1, l1[2]);
  const h2 = hueOf(a2, l2[2]);
  const dL = l2[0] - l1[0];
  const dC = c2 - c1;
  let dH = 0;
  if (c1 * c2 !== 0) {
    let dh = h2 - h1;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    else if (dh > Math.PI) dh -= 2 * Math.PI;
    dH = 2 * Math.sqrt(c1 * c2) * Math.sin(dh / 2);
  }
  const Lm = (l1[0] + l2[0]) / 2;
  const Cp = (c1 + c2) / 2;
  const Hs = h1 + h2;
  const Hm = c1 * c2 === 0 ? Hs : Math.abs(h1 - h2) <= Math.PI ? Hs / 2 : Hs < 2 * Math.PI ? (Hs + 2 * Math.PI) / 2 : (Hs - 2 * Math.PI) / 2;
  const T = 1 - 0.17 * Math.cos(Hm - rad(30)) + 0.24 * Math.cos(2 * Hm) + 0.32 * Math.cos(3 * Hm + rad(6)) - 0.2 * Math.cos(4 * Hm - rad(63));
  const dTheta = rad(30) * Math.exp(-(((Hm - rad(275)) / rad(25)) ** 2));
  const RC = 2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + p25));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cp;
  const SH = 1 + 0.015 * Cp * T;
  const RT = -Math.sin(2 * dTheta) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

interface PreparedTable {
  colours: Array<{ hex: string; lab: [number, number, number] }>;
  value: Map<string, number>;
}

let prepared: PreparedTable[] | null = null;

function tables(): PreparedTable[] {
  if (!prepared)
    prepared = (flushTables.tables as FlushTable[]).map((table) => ({
      colours: table.colours.map((hex) => ({ hex, lab: lab(hexRgb(hex)) })),
      value: new Map(table.pairs.map(([from, to, volume]) => [`${from}>${to}`, volume])),
    }));
  return prepared;
}

function measured(dataset: number, from: Rgb, to: Rgb): number | null {
  const table = tables()[dataset];
  if (!table) return null;
  const fromLab = lab(from);
  const toLab = lab(to);
  const a = table.colours.find((c) => deltaE00(c.lab, fromLab) <= 5);
  const b = table.colours.find((c) => deltaE00(c.lab, toLab) <= 5);
  if (!a || !b) return null;
  return table.value.get(`${a.hex}>${b.hex}`) ?? null;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function formula(from: Rgb, to: Rgb): number {
  const [sr, sg, sb] = from.map((v) => v / 255);
  const [dr, dg, db] = to.map((v) => v / 255);
  const [h1, s1, v1] = rgbToHsv(sr, sg, sb);
  const [h2, s2, v2] = rgbToHsv(dr, dg, db);
  const rad = (d: number) => (d * Math.PI) / 180;
  const dx = Math.cos(rad(h1)) * s1 * v1 - Math.cos(rad(h2)) * s2 * v2;
  const dy = Math.sin(rad(h1)) * s1 * v1 - Math.sin(rad(h2)) * s2 * v2;
  let hs = Math.min(1.2, Math.hypot(dx, dy));
  const fromLumi = sr * 0.3 + sg * 0.59 + sb * 0.11;
  const toLumi = dr * 0.3 + dg * 0.59 + db * 0.11;
  let lumiFlush: number;
  if (toLumi >= fromLumi) lumiFlush = (toLumi - fromLumi) ** 0.7 * 560;
  else {
    lumiFlush = (fromLumi - toLumi) * 80;
    hs = Math.min(0.67 * v2 + 0.33 * v1, hs);
  }
  const hsFlush = 230 * hs;
  const edge = Math.sqrt(hsFlush * hsFlush + lumiFlush * lumiFlush - 2 * hsFlush * lumiFlush * Math.cos(rad(120)));
  return Math.max(edge, 60);
}

/**
 * Purge volume (mm³) from one colour to the next on a nozzle whose flush data
 * set and minimum are given (both measured per printer).
 */
export function bambuFlushVolume(fromHex: string, toHex: string, dataset: number, minimum: number): number {
  const from = hexRgb(fromHex);
  const to = hexRgb(toHex);
  if (dataset !== 0) {
    const value = measured(dataset, from, to);
    if (value !== null) return Math.min(Math.trunc(value), MAX_FLUSH);
  }
  const fromTable = dataset === 0 ? measured(0, from, to) : null;
  let volume = Math.trunc(fromTable ?? formula(from, to));
  // Bambu Studio compares 0–255 channels against 0–1 thresholds here; kept as it is.
  const lumi = (c: Rgb) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  if (dataset !== 0 && lumi(from) > 180 / 255 && lumi(to) < 75 / 255) volume *= 1.3;
  return Math.min(Math.trunc(volume + minimum), MAX_FLUSH);
}

/** The flush matrix of one nozzle, row = from, column = to, 0 on the diagonal. */
export function bambuFlushMatrix(colours: string[], dataset: number, minimum: number): number[] {
  const out: number[] = [];
  colours.forEach((from, i) => colours.forEach((to, j) => out.push(i === j ? 0 : bambuFlushVolume(from, to, dataset, minimum))));
  return out;
}
