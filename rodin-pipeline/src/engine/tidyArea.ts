import type { FaceAdjacency } from "@core/meshAdjacency";
import type { ChangeLine, TidyChanges } from "./tidy";

/** Where a tidy preset applies. */
export type TidyArea = "model" | "picked";

/**
 * The part of a tidy that can be limited to patches: islands, borders,
 * protected and merged colours.  The colour count and the mixing belong to
 * the whole model, so a picked-patch tidy leaves them out.
 */
export function pickedOnly(changes: TidyChanges): TidyChanges {
  const { target: _target, mix: _mix, ...rest } = changes;
  return rest;
}

/** The values a picked-patch tidy bakes with (an empty `from`: nothing is switched over). */
export function pickedValueLines(changes: TidyChanges): ChangeLine[] {
  const lines: ChangeLine[] = [];
  if (changes.minBlob !== undefined) lines.push({ key: "minBlob", label: "작은 조각 흡수", from: "", to: `${changes.minBlob}면` });
  if (changes.smoothing !== undefined) lines.push({ key: "smoothing", label: "경계 톱니 다듬기", from: "", to: `${changes.smoothing}회` });
  if (changes.lineSmooth !== undefined) lines.push({ key: "lineSmooth", label: "경계 선 펴기", from: "", to: `${changes.lineSmooth}칸` });
  if (changes.trimTeeth !== undefined) lines.push({ key: "trimTeeth", label: "톱니 깎기", from: "", to: `${changes.trimTeeth}회` });
  if (changes.smoothProtected !== undefined) lines.push({ key: "smoothProtected", label: "보호한 색도 경계 다듬기", from: "", to: changes.smoothProtected ? "켬" : "끔" });
  if (changes.protectAccents) lines.push({ key: "protect", label: "작은 선명한 색", from: "", to: "보호" });
  return lines;
}

/**
 * A tidy limited to the picked patches.  The tidy itself runs on the whole
 * model (absorbing an island or smoothing a border needs its surroundings);
 * only its changes that belong to the patches are kept:
 *
 * - every changed face (one whose colour group the tidy changed) connected,
 *   through other changed faces, to a face
 *   within `touch` rings of a picked face: the patch's own border, the specks
 *   inside it or along it, each taken whole;
 * - nothing further than `reach` rings from the patches, so a long border
 *   cleaned elsewhere does not run in through one touching point.
 */
export function limitTidyToPicked(
  adjacency: FaceAdjacency,
  picked: Uint8Array,
  changedFace: (face: number) => boolean,
  options: { touch?: number; reach?: number } = {},
): Uint8Array {
  const touch = options.touch ?? 3;
  const reach = options.reach ?? 60;
  const count = picked.length;
  const { offsets, neighbours } = adjacency;

  // Rings from the picked faces (up to `reach`).
  const ring = new Int16Array(count).fill(-1);
  let frontier: number[] = [];
  for (let f = 0; f < count; f++)
    if (picked[f]) {
      ring[f] = 0;
      frontier.push(f);
    }
  for (let r = 1; r <= reach && frontier.length > 0; r++) {
    const nextFrontier: number[] = [];
    for (const f of frontier)
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        if (ring[g] < 0) {
          ring[g] = r;
          nextFrontier.push(g);
        }
      }
    frontier = nextFrontier;
  }

  // Changed faces reachable, through changed faces, from the touch band.
  const keep = new Uint8Array(count);
  const stack: number[] = [];
  for (let f = 0; f < count; f++) {
    if (keep[f] || ring[f] < 0 || ring[f] > touch || !changedFace(f)) continue;
    keep[f] = 1;
    stack.push(f);
    while (stack.length > 0) {
      const g = stack.pop() as number;
      for (let k = offsets[g]; k < offsets[g + 1]; k++) {
        const h = neighbours[k];
        if (keep[h] || ring[h] < 0 || !changedFace(h)) continue;
        keep[h] = 1;
        stack.push(h);
      }
    }
  }

  return keep;
}
