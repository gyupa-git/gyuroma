import { describe, expect, it } from "vitest";
import { buildTransform, transformNoTranslation } from "../export3mf";
import { combineTurns, turnMode, turnPoint, turnRows, type FixedCoordinateMode } from "../orientation";
import type { MeshModel, Vec3 } from "../types";

const MODES: FixedCoordinateMode[] = [
  "keep",
  "blender-y-up",
  "x-up",
  "face-front",
  "face-back",
  "face-left",
  "face-right",
  "face-top",
  "face-bottom",
  "turn:0,1,0,-1,0,0,0,0,1",
];

/** A point through a 3MF build transform the way the spec — and PrusaSlicer, Bambu Studio — read it: p' = p·M. */
function through3mf(m: number[], [x, y, z]: Vec3): Vec3 {
  return [
    x * m[0] + y * m[3] + z * m[6] + m[9],
    x * m[1] + y * m[4] + z * m[7] + m[10],
    x * m[2] + y * m[5] + z * m[8] + m[11],
  ];
}

const POINTS: Vec3[] = [
  [0, 0, 0],
  [2, 0, 0],
  [0, 3, 0],
  [0, 0, 5],
  [1, -2, 3],
];

describe("orientation", () => {
  it("writes the 3MF so the slicer puts every point where the preview does", () => {
    for (const mode of MODES) {
      const { transform } = buildTransform({ vertices: POINTS } as unknown as MeshModel, null, {
        coordinateMode: mode,
        scale: 2,
        targetHeight: null,
        putOnBed: true,
        centerOnBed: false,
        bedSource: "custom",
        customBedSize: { x: 200, y: 200 },
        fallbackBedSize: { x: 200, y: 200 },
        defaultExtruder: 1,
      });
      const m = transform.split(" ").map(Number);
      for (const p of POINTS) {
        const preview = transformNoTranslation(p, mode, 2);
        const slicer = through3mf(m, p);
        for (let i = 0; i < 3; i++) expect(slicer[i] - m[9 + i]).toBeCloseTo(preview[i], 9);
      }
    }
  });

  it("stands a Y-up OBJ (Nomad, Blender) upright with its front to the front of the bed", () => {
    const rows = turnRows("blender-y-up");
    expect(turnPoint([0, 1, 0], rows)).toEqual([0, 0, 1]);
    expect(turnPoint([0, 0, 1], rows).map((v) => v + 0)).toEqual([0, -1, 0]);
  });

  it("puts the face being looked at on the bed, from whatever the view already shows", () => {
    // An OBJ stood upright, then "the front down" seen from the front: the
    // figure's own front (+Z in the OBJ) is what now faces the bed.
    const upright = turnRows("blender-y-up");
    const front = combineTurns(turnRows("face-front"), upright);
    expect(turnPoint([0, 0, 1], front)[2]).toBe(-1);
    // Seen from the top instead, its head goes down.
    const top = combineTurns(turnRows("face-top"), upright);
    expect(turnPoint([0, 1, 0], top)[2]).toBe(-1);
  });

  it("names turns so they come back the same, and refuses a mirror", () => {
    expect(turnMode(turnRows("keep"))).toBe("keep");
    const turned = combineTurns(turnRows("face-left"), turnRows("blender-y-up"));
    const mode = turnMode(turned);
    expect(mode).toMatch(/^turn:/);
    expect(mode).not.toContain("-0");
    expect(turnRows(mode)).toEqual(turned);
    // A mirrored mesh would print back to front: read as no turn at all.
    expect(turnRows("turn:-1,0,0,0,1,0,0,0,1")).toEqual(turnRows("keep"));
    expect(turnRows("turn:1,1,0,0,1,0,0,0,1")).toEqual(turnRows("keep"));
  });
});
