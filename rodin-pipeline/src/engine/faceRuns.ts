/**
 * Faces as runs [first, last] to send to the graphics card (11-10): sorted, with gaps of up to `gap` faces closed
 * (sending a few faces more costs less than another call) and the gap widened until at most `most` runs are left.
 * Sorts `faces` in place.  A brush stroke's faces sit all over the face order, so the lowest-to-highest span it
 * used to send could be most of a 4.6M-face model (53 ms on Tkc) for a few thousand painted faces.
 */
export function faceRuns(faces: Int32Array, gap = 1024, most = 256): Array<[number, number]> {
  if (faces.length === 0) return [];
  faces.sort();
  for (let reach = Math.max(0, gap); ; reach = reach * 4 + 1) {
    const runs: Array<[number, number]> = [];
    let lo = faces[0];
    let hi = faces[0];
    for (let i = 1; i < faces.length; i++) {
      const f = faces[i];
      if (f <= hi + reach + 1) {
        if (f > hi) hi = f;
      } else {
        runs.push([lo, hi]);
        lo = f;
        hi = f;
      }
    }
    runs.push([lo, hi]);
    if (runs.length <= most) return runs;
  }
}
