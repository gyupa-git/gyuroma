/**
 * PrusaSlicer / Bambu Studio MMU painting codes.
 *
 * Both slicers serialise the per-triangle extruder state of a painted mesh
 * with the same compact hex encoding (3MF attribute
 * `slic3rpe:mmu_segmentation` in PrusaSlicer, `paint_color` in Bambu Studio).
 *
 *   extruder 1  -> "4"
 *   extruder 2  -> "8"
 *   extruder 3+ -> hex(extruder - 3) + "C"      ("0C" = 3 … "CC" = 15, "DC" = 16)
 *   extruder 17+ -> two hex digits (extruder - 17) + "EC"   (extended form)
 *
 * PrusaSlicer Full Spectrum (ColorMix) virtual extruders share the same
 * numbering space with the physical extruders, so the total number of
 * physical + virtual extruders is limited by this encoding:
 *
 *   PrusaSlicer <= 2.9.5: TriangleSelector states are 6-bit, max extruder 15
 *                         (the original work order's "15 colours" limit).
 *   PrusaSlicer >= 2.9.6: TRIANGLE_STATE_TYPE_COUNT = 256; states 17..255 use
 *                         the 14-bit "vvEC" form and the file must carry
 *                         <metadata name="slic3rpe:MmPaintingVersion">2</metadata>
 *                         (which the exporter always writes).
 *
 * ColorMix itself only exists from 2.9.6 on, so the export accepts up to 255.
 *
 * Bambu Studio (and the slicers forked from it) reads the long states another
 * way: four bits 14 is plainly 17, and four bits 15 is followed by four more
 * bits for 18..33 ("0FC" = 18 … "EFC" = 32).  Measured with Bambu Studio
 * 2.8.4 and a 32-filament project (2026-11-01): "00EC" … "05EC" all print with
 * filament 17, "0FC" … "EFC" with 18 … 32.  So `paint_color` is written in its
 * own flavour.
 */

/** How a file's codes read: PrusaSlicer 2.9.6+ (painting version 2), older PrusaSlicer (version 1), Bambu Studio. */
export type PaintFlavour = "prusa" | "prusa1" | "bambu";

/** The highest state each flavour can write. */
const FLAVOUR_MAX: Record<PaintFlavour, number> = { prusa: 255, prusa1: 18, bambu: 33 };

/** Highest physical + virtual extruder id the export accepts (PrusaSlicer 2.9.6+ paint state limit). */
export const MAX_PAINTABLE_EXTRUDER_ID = 255;

export function encodePaintCode(extruderId: number, flavour: PaintFlavour = "prusa"): string {
  const id = Math.round(extruderId);
  if (!Number.isFinite(id) || id < 1) throw new Error("Extruder ID is too small.");
  if (id > MAX_PAINTABLE_EXTRUDER_ID) throw new Error(`Extruder ID ${id} exceeds the PrusaSlicer paint state limit (${MAX_PAINTABLE_EXTRUDER_ID}).`);
  if (flavour !== "prusa") {
    const code = remapPaintCode("4", () => id, "prusa", flavour);
    if (code === null) throw new Error(`Extruder ID ${id} cannot be painted for ${flavour === "bambu" ? "Bambu Studio" : "this PrusaSlicer"} (at most ${FLAVOUR_MAX[flavour]}).`);
    return code;
  }
  if (id === 1) return "4";
  if (id === 2) return "8";
  const state = id - 3;
  if (state <= 13) return `${state.toString(16).toUpperCase()}C`;
  const value = state - 14;
  if (value > 0xff) throw new Error("Too many extruders for this encoder.");
  return `${value.toString(16).toUpperCase().padStart(2, "0")}EC`;
}

/**
 * Inverse of encodePaintCode.  An empty code means "not painted" (0).
 * Throws for codes the encoder can never produce.
 */
export function decodePaintCode(code: string, flavour: PaintFlavour = "prusa"): number {
  const c = code.trim().toUpperCase();
  if (flavour !== "prusa") {
    if (c === "") return 0;
    const states = paintCodeStates(c, flavour);
    if (!states || states.length !== 1) throw new Error(`Unsupported MMU paint code "${code}".`);
    return states[0];
  }
  if (c === "") return 0;
  if (c === "4") return 1;
  if (c === "8") return 2;
  const compact = /^([0-9A-D])C$/.exec(c);
  if (compact) return parseInt(compact[1], 16) + 3;
  const extended = /^([0-9A-F]{2})EC$/.exec(c);
  if (extended) return parseInt(extended[1], 16) + 17;
  throw new Error(`Unsupported MMU paint code "${code}".`);
}

/** Lenient variant for parsers: returns null instead of throwing. */
export function tryDecodePaintCode(code: string, flavour: PaintFlavour = "prusa"): number | null {
  try {
    return decodePaintCode(code, flavour);
  } catch {
    return null;
  }
}

/**
 * A triangle's code with every extruder state in it changed by `map`.  A
 * triangle painted with the brush in the slicer is split, and its code is a
 * tree, not one state: PrusaSlicer's TriangleSelector writes, per node and
 * least significant bit first, two bits for the number of split sides (0 = a
 * leaf), then for a split node two bits for the special side and its
 * children, for a leaf the state — two bits for 0..2, or 0b11 and four bits
 * (state − 3) for 3..16, and then per flavour: PrusaSlicer 2.9.6 four bits 14
 * and eight bits (state − 17) for 17..255, Bambu Studio four bits 14 for 17
 * and four bits 15 and four bits (state − 18) for 18..33.  The bits run four
 * to a hex digit, the first digit last.  The code is read as `from` and
 * written as `to`.  Null for a code that is not a whole tree, or a state `to`
 * cannot hold.
 */
export function remapPaintCode(code: string, map: (state: number) => number, from: PaintFlavour = "prusa", to: PaintFlavour = "prusa"): string | null {
  const digits: number[] = [];
  for (let i = code.length - 1; i >= 0; i--) {
    const digit = parseInt(code[i], 16);
    if (Number.isNaN(digit)) return null;
    digits.push(digit);
  }
  const bitCount = digits.length * 4;
  let at = 0;
  const read = (n: number): number => {
    let value = 0;
    for (let k = 0; k < n; k++) {
      if (at >= bitCount) throw new RangeError("short");
      value |= ((digits[at >> 2] >> (at & 3)) & 1) << k;
      at++;
    }
    return value;
  };
  const out: number[] = [];
  const write = (value: number, n: number) => {
    for (let k = 0; k < n; k++) out.push((value >> k) & 1);
  };
  const node = (): void => {
    const split = read(2);
    write(split, 2);
    if (split > 0) {
      write(read(2), 2);
      for (let child = 0; child <= split; child++) node();
      return;
    }
    let state = read(2);
    if (state === 3) {
      const n = read(4);
      state = from === "prusa" && n === 14 ? 17 + read(8) : from === "bambu" && n === 15 ? 18 + read(4) : 3 + n;
    }
    const next = map(state);
    if (!Number.isInteger(next) || next < 0 || next > FLAVOUR_MAX[to]) throw new RangeError("state");
    if (next < 3) write(next, 2);
    else if (next <= (to === "prusa" ? 16 : to === "bambu" ? 17 : 18)) {
      write(3, 2);
      write(next - 3, 4);
    } else if (to === "prusa") {
      write(3, 2);
      write(14, 4);
      write(next - 17, 8);
    } else {
      write(3, 2);
      write(15, 4);
      write(next - 18, 4);
    }
  };
  try {
    if (code.length === 0) return null;
    node();
    // Whatever follows the tree is padding PrusaSlicer never writes.
    if (bitCount - at >= 4) return null;
  } catch {
    return null;
  }
  let text = "";
  for (let i = 0; i < out.length; i += 4) {
    const digit = out[i] | ((out[i + 1] ?? 0) << 1) | ((out[i + 2] ?? 0) << 2) | ((out[i + 3] ?? 0) << 3);
    text = digit.toString(16).toUpperCase() + text;
  }
  return text;
}

/** Every extruder state a code paints (a split triangle can paint several). */
export function paintCodeStates(code: string, flavour: PaintFlavour = "prusa"): number[] | null {
  const states: number[] = [];
  // Written back as PrusaSlicer 2.9.6, which holds every state any flavour reads.
  return remapPaintCode(code, (state) => (states.push(state), state), flavour, "prusa") === null ? null : states;
}
