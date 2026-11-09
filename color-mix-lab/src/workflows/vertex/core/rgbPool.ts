import type { RGB } from './types';

/**
 * One [r, g, b] per colour value, shared by every face of that colour (11-05: a 4.6 M-face model held 4.6 M
 * little arrays for 90 k colours — 326 MB of the tab's memory). Face colours are never changed in place, so
 * faces can share theirs. Only whole values 0–255 are shared; anything else is passed through as it is.
 */
const pool = new Map<number, RGB>();

/**
 * A shared array's number in the pool (0, 1, 2 … in the order they were made), kept on the array itself: a pass
 * over millions of faces can add up per colour in a plain array instead of a map (buildColourStrip, 11-10).
 * Arrays not from the pool have none.
 */
export const POOL_ID: unique symbol = Symbol("rgbPool id");
let made = 0;

/** How many shared arrays there are (every POOL_ID is below it). */
export function poolSize(): number {
  return made;
}

/** A shared array's POOL_ID, or -1 for an array not from the pool. */
export function poolIdOf(rgb: RGB): number {
  const id = (rgb as RGB & { [POOL_ID]?: number })[POOL_ID];
  return id === undefined ? -1 : id;
}

export function sharedRgbOf(r: number, g: number, b: number): RGB {
  if (!((r | 0) === r && (g | 0) === g && (b | 0) === b && r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255)) return [r, g, b];
  const key = (r << 16) | (g << 8) | b;
  let rgb = pool.get(key);
  if (!rgb) {
    rgb = [r, g, b];
    (rgb as RGB & { [POOL_ID]?: number })[POOL_ID] = made++;
    pool.set(key, rgb);
  }
  return rgb;
}

export function sharedRgb(c: RGB): RGB {
  const s = sharedRgbOf(c[0], c[1], c[2]);
  return s[0] === c[0] && s[1] === c[1] && s[2] === c[2] ? s : c;
}

/**
 * The colours of `next` that are not `before`'s own arrays, swapped in place for the shared ones (an edit
 * paints a few faces: only those are looked up).
 */
export function shareNewColours(next: RGB[], before: RGB[] | null, changed?: ArrayLike<number>): void {
  // The faces an edit painted, when it says which (11-10: a brush stroke) — the others are `before`'s own arrays.
  if (changed && before && before.length === next.length) {
    for (let i = 0; i < changed.length; i++) {
      const f = changed[i];
      const c = next[f];
      if (c !== before[f]) next[f] = sharedRgb(c);
    }
    return;
  }
  const same = before && before.length === next.length;
  for (let f = 0; f < next.length; f++) {
    const c = next[f];
    if (same && c === before[f]) continue;
    next[f] = sharedRgb(c);
  }
}
