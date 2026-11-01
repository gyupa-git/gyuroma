import type { Vec3 } from "./types";

/**
 * Which way up a model goes on the bed.  Every mode is a quarter-turn rotation
 * kept here as one table, and the preview, the bounds, the 3MF thumbnail and
 * the written build transform all read it — they used to keep their own
 * copies, which disagreed: a Y-up figure the slicer stood upright was drawn
 * standing on its head, and one put on its right side went down on its left.
 *
 * A turn is given by its rows: v' = (r0·v, r1·v, r2·v).  The 3MF spec
 * multiplies row vectors instead (p' = p·M, translation last), so the matrix
 * written into a file is the transpose — PrusaSlicer and Bambu Studio read it
 * that way (checked by baking a marked mesh through the PrusaSlicer CLI).
 */
export type ExportCoordinateMode =
  | "auto"
  | "keep"
  | "blender-y-up"
  | "x-up"
  | "stand-up"
  /** Put a named face of the model on the bed. */
  | "face-front"
  | "face-back"
  | "face-left"
  | "face-right"
  | "face-top"
  | "face-bottom"
  /**
   * Any other quarter turn, its nine entries row by row ("turn:1,0,0,0,-1,0,0,0,-1"):
   * what "put the face you see on the bed" makes of the orientation already shown.
   */
  | `turn:${string}`;

/** A mode that is a turn by itself — "auto" and "stand-up" first look at the mesh. */
export type FixedCoordinateMode = Exclude<ExportCoordinateMode, "auto" | "stand-up">;

/** The nine entries of a turn, row by row. */
export type TurnRows = readonly [number, number, number, number, number, number, number, number, number];

const IDENTITY: TurnRows = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// A quarter turn about X: +Y up, and +Z (the front of a Nomad or Blender OBJ)
// to −Y, the front of the bed.  Seen from a Z-up model, the front goes down.
const Y_UP: TurnRows = [1, 0, 0, 0, 0, -1, 0, 1, 0];
// A quarter turn about Y: +X down.
const X_DOWN: TurnRows = [0, 0, 1, 0, 1, 0, -1, 0, 0];

const TURNS: Record<Exclude<FixedCoordinateMode, `turn:${string}`>, TurnRows> = {
  keep: IDENTITY,
  "face-bottom": IDENTITY,
  // OBJ files (Nomad, Blender) are written Y-up; 3MF is Z-up.
  "blender-y-up": Y_UP,
  "face-front": Y_UP,
  "face-back": [1, 0, 0, 0, 0, 1, 0, -1, 0],
  // A figure lying along X stands on its +X end; the same turn puts the right side down.
  "x-up": X_DOWN,
  "face-right": X_DOWN,
  "face-left": [0, 0, -1, 0, 1, 0, 1, 0, 0],
  "face-top": [1, 0, 0, 0, -1, 0, 0, 0, -1],
};

/** Reads "turn:…": nine entries of −1, 0 or 1, one per row and column, and no mirror. */
function parseTurn(mode: string): TurnRows | null {
  const values = mode.slice("turn:".length).split(",").map(Number);
  if (values.length !== 9 || values.some((v) => v !== -1 && v !== 0 && v !== 1)) return null;
  for (let i = 0; i < 3; i++) {
    let row = 0;
    let column = 0;
    for (let j = 0; j < 3; j++) {
      row += Math.abs(values[i * 3 + j]);
      column += Math.abs(values[j * 3 + i]);
    }
    if (row !== 1 || column !== 1) return null;
  }
  const [a, b, c, d, e, f, g, h, k] = values;
  if (a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g) !== 1) return null;
  return values as unknown as TurnRows;
}

/** The turn a mode applies (anything unreadable stays as it is). */
export function turnRows(mode: FixedCoordinateMode): TurnRows {
  if (mode.startsWith("turn:")) return parseTurn(mode) ?? IDENTITY;
  return TURNS[mode as keyof typeof TURNS] ?? IDENTITY;
}

/** The mode for a turn: "keep" when it turns nothing (unless `always`), "turn:…" otherwise. */
export function turnMode(rows: TurnRows, always = false): FixedCoordinateMode {
  if (!always && rows.every((v, i) => v === IDENTITY[i])) return "keep";
  // `+ 0` keeps a −0 out of the string.
  return `turn:${rows.map((v) => v + 0).join(",")}`;
}

/** Whether two fixed modes turn the model the same way. */
export function sameTurn(a: FixedCoordinateMode, b: FixedCoordinateMode): boolean {
  const ra = turnRows(a);
  const rb = turnRows(b);
  return ra.every((v, i) => v === rb[i]);
}

/** `after` applied on top of `before`. */
export function combineTurns(after: TurnRows, before: TurnRows): TurnRows {
  const out: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      out.push(after[r * 3] * before[c] + after[r * 3 + 1] * before[3 + c] + after[r * 3 + 2] * before[6 + c]);
  return out as unknown as TurnRows;
}

export function turnPoint(v: Vec3, rows: TurnRows, scale = 1): Vec3 {
  const [x, y, z] = v;
  return [
    scale * (rows[0] * x + rows[1] * y + rows[2] * z),
    scale * (rows[3] * x + rows[4] * y + rows[5] * z),
    scale * (rows[6] * x + rows[7] * y + rows[8] * z),
  ];
}

/** The 3×3 part of a 3MF transform ("m00 m01 m02 m10 …"), scaled: the turn transposed. */
export function turn3mfEntries(rows: TurnRows, scale: number): number[] {
  return [0, 3, 6, 1, 4, 7, 2, 5, 8].map((i) => scale * rows[i]);
}
