import { describe, expect, it } from "vitest";
import { bambuFlushMatrix } from "../bambuFlush";

// Matrices the Bambu Studio 2.8.4 CLI wrote into projects for these colours.
describe("Bambu Studio flush volumes", () => {
  it("X1C: the colour formula plus the nozzle minimum", () => {
    const colours = ["#1B1889", "#4CAF50", "#E34A93", "#E6EAED", "#F7DEBD"];
    expect(bambuFlushMatrix(colours, 0, 63)).toEqual([
      [0, 458, 449, 583, 607],
      [215, 0, 253, 403, 398],
      [229, 308, 0, 454, 427],
      [201, 170, 223, 0, 123],
      [250, 182, 204, 154, 0],
    ].flat());
  });

  it("H2D: Bambu's measured table for colours close to its own, the formula for the rest", () => {
    const colours = ["#FFFFFF", "#000000", "#00AE42", "#E34A93", "#F7E6DE"];
    expect(bambuFlushMatrix(colours, 1, 130)).toEqual([
      [0, 90, 120, 291, 90],
      [900, 0, 810, 561, 900],
      [900, 150, 0, 458, 360],
      [559, 252, 305, 0, 510],
      [90, 90, 90, 273, 0],
    ].flat());
  });
});
