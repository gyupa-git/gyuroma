import { describe, expect, it } from "vitest";
import { faceOfGroupNear, pieceAt } from "./cutPick";

describe("a click on the preview's pieces", () => {
  // A square face cut along its diagonal into two pieces: below-right and above-left.
  const pieces = new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, // piece 0: under the diagonal
    0, 0, 0, 1, 1, 0, 0, 1, 0, // piece 1: over it
  ]);

  it("lands on the piece the point is in", () => {
    expect(pieceAt(pieces, 0, 2, [0.8, 0.2, 0])).toBe(0);
    expect(pieceAt(pieces, 0, 2, [0.2, 0.8, 0])).toBe(1);
  });

  it("takes the nearer piece on the seam or just outside both", () => {
    expect([0, 1]).toContain(pieceAt(pieces, 0, 2, [0.5, 0.5, 0]));
    expect(pieceAt(pieces, 0, 2, [1.02, 0.4, 0])).toBe(0);
  });

  it("reads only the face's own run of pieces", () => {
    const two = new Float32Array([...pieces, ...pieces]);
    expect(pieceAt(two, 2, 2, [0.2, 0.8, 0])).toBe(3);
  });

  // A strip of faces 0-1-2-3-4; groups 0,0,1,1,2.
  const offsets = Int32Array.from([0, 1, 3, 5, 7, 8]);
  const neighbours = Int32Array.from([1, 0, 2, 1, 3, 2, 4, 3]);
  const labels = [0, 0, 1, 1, 2];

  it("finds a face of the piece's group beside the cut face", () => {
    expect(faceOfGroupNear(offsets, neighbours, labels, 1, 1)).toBe(2);
    expect(faceOfGroupNear(offsets, neighbours, labels, 1, 2)).toBe(4);
  });

  it("looks as far as a cut's line may lie from its border", () => {
    // A strip of 32 faces, the group only from 20 on: 11 rings out is still near, 19 is not.
    const n = 32;
    const off = Int32Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : 2 * i - 1));
    const nb: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) nb.push(i - 1);
      if (i < n - 1) nb.push(i + 1);
    }
    const strip = Array.from({ length: n }, (_, i) => (i >= 20 ? 1 : 0));
    expect(faceOfGroupNear(off, Int32Array.from(nb), strip, 9, 1)).toBe(20);
    expect(faceOfGroupNear(off, Int32Array.from(nb), strip, 1, 1)).toBe(-1);
  });

  it("keeps the face when it is of that group, and says when none is near (preview only)", () => {
    expect(faceOfGroupNear(offsets, neighbours, labels, 2, 1)).toBe(2);
    expect(faceOfGroupNear(offsets, neighbours, labels, 0, 2, 2)).toBe(-1);
  });
});
