import { describe, expect, it } from "vitest";
import { faceRuns } from "./faceRuns";

/** Whether a face is inside one of the (sorted) runs — found by halving, not by listing every face of every run. */
function inRuns(runs: Array<[number, number]>, f: number): boolean {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (f < runs[mid][0]) hi = mid - 1;
    else if (f > runs[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

describe("faceRuns — the faces a stroke changed, as runs to send", () => {
  it("covers every face given, in order, without overlap", () => {
    let s = 3;
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const [n, spread] of [[1, 10], [50, 100], [3000, 4_600_000], [20000, 4_600_000], [5000, 6000]]) {
      const faces = Int32Array.from({ length: n }, () => Math.floor(rand() * spread));
      const want = new Set(faces);
      const runs = faceRuns(faces.slice());
      let missing = 0;
      for (const f of want) if (!inRuns(runs, f)) missing++;
      expect(missing).toBe(0);
      expect(runs.length).toBeLessThanOrEqual(256);
      for (let i = 1; i < runs.length; i++) expect(runs[i][0]).toBeGreaterThan(runs[i - 1][1] + 1);
      for (const [lo, hi] of runs) expect(hi).toBeGreaterThanOrEqual(lo);
    }
  });

  it("closes small gaps and keeps far faces apart", () => {
    expect(faceRuns(Int32Array.from([10, 12, 11, 5000, 5001, 9_000_000]), 4)).toEqual([[10, 12], [5000, 5001], [9_000_000, 9_000_000]]);
    expect(faceRuns(Int32Array.from([1, 3]), 1)).toEqual([[1, 3]]);
    expect(faceRuns(Int32Array.from([1, 4]), 1)).toEqual([[1, 1], [4, 4]]);
    expect(faceRuns(new Int32Array(0))).toEqual([]);
  });

  it("sends far fewer faces than the lowest-to-highest span for a scattered stroke", () => {
    let s = 9;
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // 40 clumps of 150 faces each, over a 4.6M-face model.
    const faces: number[] = [];
    for (let c = 0; c < 40; c++) {
      const at = Math.floor(rand() * 4_500_000);
      for (let k = 0; k < 150; k++) faces.push(at + Math.floor(rand() * 400));
    }
    const runs = faceRuns(Int32Array.from(faces));
    const sent = runs.reduce((sum, [lo, hi]) => sum + hi - lo + 1, 0);
    const span = Math.max(...faces) - Math.min(...faces) + 1;
    expect(sent).toBeLessThan(span / 100);
  });
});
