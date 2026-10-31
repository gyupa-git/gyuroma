import { describe, expect, it } from "vitest";
import type { RGB } from "../types";
import { apparentLayerRgbs, linearToSrgb, mixFilamentsRgb, srgbToLinear } from "../prusaFdmMixer";

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const luminance = (rgb: RGB) => 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
const linearMean = (rgbs: RGB[]): RGB =>
  [0, 1, 2].map((c) => linearToSrgb(rgbs.reduce((sum, rgb) => sum + srgbToLinear(rgb[c]), 0) / rgbs.length)) as RGB;

describe("apparentLayerRgbs", () => {
  const green = hex("#4CAF50");
  const navy = hex("#1B1889");
  // A cape recipe: 3 green layers in 10, the rest navy.
  const layers: RGB[] = [navy, navy, green, navy, navy, green, navy, navy, green, navy];

  it("averages, in linear light, to the calibrated mix", () => {
    const predicted = mixFilamentsRgb([
      { rgb: green, ratio: 3 },
      { rgb: navy, ratio: 7 },
    ]).rgb;
    const mean = linearMean(apparentLayerRgbs(layers));
    for (let c = 0; c < 3; c++) expect(Math.abs(mean[c] - predicted[c])).toBeLessThan(2);
    // The filaments' own colours average far lighter: what the stripes used to show.
    expect(luminance(linearMean(layers))).toBeGreaterThan(luminance(predicted) * 1.8);
  });

  it("darkens the light layers and narrows the stripes, in the same order", () => {
    const shown = apparentLayerRgbs(layers);
    expect(luminance(shown[2])).toBeLessThan(luminance(green) * 0.5);
    expect(luminance(shown[2])).toBeGreaterThan(luminance(shown[0]));
    expect(luminance(shown[2]) / luminance(shown[0])).toBeLessThan((luminance(green) / luminance(navy)) * 0.5);
    expect(shown[0]).toEqual(shown[1]);
  });

  it("leaves a single filament as it is", () => {
    expect(apparentLayerRgbs([green, green])).toEqual([green, green]);
    expect(apparentLayerRgbs([])).toEqual([]);
  });
});
