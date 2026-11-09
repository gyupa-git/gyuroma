import { describe, expect, it } from "vitest";
import { paintAtlasOutline, paintAtlasOverlay, repaintAtlasMasks, type AtlasMaskPaint, type AtlasMasks, type FaceAtlas } from "./atlas";

/** A small map: faces as blobs of pixels (like charts), some pixels empty, a few faces with no pixel at all. */
function makeAtlas(size: number, faces: number, seed: number): FaceAtlas {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const idMap = new Int32Array(size * size).fill(-1);
  for (let f = 0; f < faces - 3; f++) {
    const cx = Math.floor(rand() * size);
    const cy = Math.floor(rand() * size);
    const r = 1 + Math.floor(rand() * 4);
    for (let y = Math.max(0, cy - r); y <= Math.min(size - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(size - 1, cx + r); x++) if (rand() < 0.8) idMap[y * size + x] = f;
  }
  const counts = new Int32Array(faces + 1);
  for (let i = 0; i < idMap.length; i++) if (idMap[i] >= 0) counts[idMap[i] + 1]++;
  for (let f = 0; f < faces; f++) counts[f + 1] += counts[f];
  const fill = new Int32Array(faces);
  const pixelIndices = new Int32Array(counts[faces]);
  for (let i = 0; i < idMap.length; i++) if (idMap[i] >= 0) pixelIndices[counts[idMap[i]] + fill[idMap[i]]++] = i;
  return { size, idMap, pixelOffsets: counts, pixelIndices } as unknown as FaceAtlas;
}

function randomMasks(faces: number, rand: () => number, previous: AtlasMasks | null): AtlasMasks {
  // Mostly a few faces changed from the last masks (a stroke, a hover move); sometimes a mask comes or goes.
  const next = (mask: Uint8Array | null): Uint8Array | null => {
    if (rand() < 0.1) return null;
    const out = mask ? mask.slice() : new Uint8Array(faces);
    const flips = rand() < 0.2 ? Math.floor(faces / 2) : 1 + Math.floor(rand() * 12);
    for (let k = 0; k < flips; k++) out[Math.floor(rand() * faces)] ^= 1;
    return out;
  };
  return { hover: next(previous?.hover ?? null), selected: next(previous?.selected ?? null), picked: next(previous?.picked ?? null) };
}

describe("the colour map's highlight, painted again only where it changed", () => {
  it("gives what painting it all gives, byte for byte, over many random changes", { timeout: 60_000 }, () => {
    // The last two are bigger than a tile (128): changes in many tiles, painted as several regions.
    for (const [size, faces, seed, steps] of [
      [48, 120, 7, 160],
      [64, 300, 11, 160],
      [33, 60, 3, 160],
      [300, 2500, 13, 60],
      [257, 900, 17, 60],
    ] as const) {
      const atlas = makeAtlas(size, faces, seed);
      let s = seed * 31;
      const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const overlay = new Uint8ClampedArray(size * size * 4);
      const outline = new Uint8ClampedArray(size * size * 4);
      let paint: AtlasMaskPaint | null = null;
      let masks: AtlasMasks | null = null;
      let width = 2;
      for (let step = 0; step < steps; step++) {
        // Now and then nothing highlighted at all, then highlights coming back.
        masks = step % 37 === 36 ? { hover: null, selected: null, picked: null } : randomMasks(faces, rand, masks);
        if (rand() < 0.05) width = 1 + Math.floor(rand() * 5);
        const result = repaintAtlasMasks(paint, atlas, masks, overlay, outline, width);
        paint = result.paint;
        const fullOverlay = new Uint8ClampedArray(size * size * 4);
        const fullOutline = new Uint8ClampedArray(size * size * 4);
        const any = paintAtlasOverlay(atlas, masks, fullOverlay);
        paintAtlasOutline(atlas, masks, fullOutline, width);
        expect(result.any).toBe(any);
        // The outline: every byte. The overlay: every alpha, and the colour wherever it shows.
        expect(Buffer.from(outline).equals(Buffer.from(fullOutline)), `outline step ${step}`).toBe(true);
        let wrong = -1;
        for (let i = 0; i < size * size && wrong < 0; i++) {
          if (overlay[i * 4 + 3] !== fullOverlay[i * 4 + 3]) wrong = i;
          else if (fullOverlay[i * 4 + 3] > 0) for (let k = 0; k < 3; k++) if (overlay[i * 4 + k] !== fullOverlay[i * 4 + k]) wrong = i;
        }
        expect(wrong, `overlay pixel ${wrong} at step ${step}`).toBe(-1);
      }
    }
  });

  it("says nothing changed when the classes are the same, and paints all for another map or width", () => {
    const atlas = makeAtlas(32, 50, 5);
    const masks: AtlasMasks = { hover: null, selected: null, picked: new Uint8Array(50).fill(1) };
    const overlay = new Uint8ClampedArray(32 * 32 * 4);
    const outline = new Uint8ClampedArray(32 * 32 * 4);
    const first = repaintAtlasMasks(null, atlas, masks, overlay, outline, 2);
    expect(first.rect).toBe("full");
    const same = repaintAtlasMasks(first.paint, atlas, { ...masks, picked: masks.picked!.slice() }, overlay, outline, 2);
    expect(same.rect).toBeNull();
    expect(repaintAtlasMasks(same.paint, atlas, masks, overlay, outline, 3).rect).toBe("full");
    expect(repaintAtlasMasks(same.paint, makeAtlas(32, 50, 6), masks, overlay, outline, 2).rect).toBe("full");
  });
});
