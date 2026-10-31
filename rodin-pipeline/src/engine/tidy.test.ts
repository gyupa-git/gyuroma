import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";
import { describeChanges, hasCleanChanges, presetChanges, sanitizeChanges, type TidyContext } from "./tidy";

const context: TidyContext = {
  modelName: "test.obj",
  faces: 1000,
  sourceColours: 5000,
  target: 16,
  minBlob: 150,
  smoothing: 3,
  smoothProtected: false,
  palette: [
    { hex: "#F2F1EF", areaPct: 40, family: "neutral", shades: 30, protected: false },
    { hex: "#0E3D63", areaPct: 30, family: "blue", shades: 12, protected: false },
    { hex: "#2E8B57", areaPct: 28, family: "green", shades: 9, protected: false },
    { hex: "#D62860", areaPct: 2, family: "pink", shades: 2, protected: true },
  ],
  slots: [],
  mix: DEFAULT_SETTINGS.mix,
  mixScores: null,
  layerHeight: 0.15,
};

describe("auto tidy presets", () => {
  it("keep to the scope", () => {
    const clean = presetChanges("crisp", context, "clean");
    expect(clean.mix).toBeUndefined();
    expect(clean.smoothing).toBe(6);
    const mix = presetChanges("crisp", context, "mix");
    expect(hasCleanChanges(mix)).toBe(false);
    expect(mix.mix?.recipeResolution).toBe("thirds");
  });

  it("solid aims at about 1.5 groups per colour family", () => {
    // Four families of at least 0.5 %: 4 × 1.5 = 6.
    expect(presetChanges("solid", context, "clean").target).toBe(6);
  });

  it("gradient never lowers the count", () => {
    expect(presetChanges("gradient", { ...context, target: 48 }, "clean").target).toBe(48);
    expect(presetChanges("gradient", context, "clean").target).toBe(32);
  });
});

describe("AI changes", () => {
  it("drop what the scope does not cover and clamp numbers", () => {
    const { changes, dropped } = sanitizeChanges({ target: 200, smoothing: -3, mix: { maxComponents: 3 } }, context, "clean");
    expect(changes.target).toBe(64);
    expect(changes.smoothing).toBe(0);
    expect(changes.mix).toBeUndefined();
    expect(dropped.length).toBe(1);
  });

  it("keep colour names only for the palette as it is", () => {
    const { changes, dropped } = sanitizeChanges({ protect: ["#0e3d63", "#123456"], merge: [{ from: "#2E8B57", into: "#0E3D63" }] }, context, "clean");
    expect(changes.protect).toEqual(["#0E3D63"]);
    expect(changes.merge).toEqual([{ from: "#2E8B57", into: "#0E3D63" }]);
    expect(dropped.join(" ")).toContain("#123456");
  });

  it("take the protected-colour smoothing as a switch, for 02 only", () => {
    const { changes } = sanitizeChanges({ smoothProtected: true, smoothing: 6 }, context, "clean");
    expect(changes.smoothProtected).toBe(true);
    expect(hasCleanChanges({ smoothProtected: true })).toBe(true);
    expect(describeChanges(changes, context).map((l) => `${l.key} ${l.from}→${l.to}`)).toEqual(["smoothing 3회→6회", "smoothProtected 끔→켬"]);
    const mixOnly = sanitizeChanges({ smoothProtected: true }, context, "mix");
    expect(mixOnly.changes.smoothProtected).toBeUndefined();
    expect(mixOnly.dropped.length).toBe(1);
  });

  it("do not name colours in the same answer as a new count", () => {
    const { changes, dropped } = sanitizeChanges({ target: 8, protect: ["#0E3D63"] }, context, "clean");
    expect(changes.target).toBe(8);
    expect(changes.protect).toBeUndefined();
    expect(dropped.length).toBe(1);
  });

  it("list only what really changes, before → after", () => {
    const lines = describeChanges({ target: 16, smoothing: 6, protect: ["#D62860", "#0E3D63"], mix: { maxComponents: 2, recipeResolution: "grid25" } }, context);
    expect(lines.map((l) => l.key)).toEqual(["smoothing", "protect", "mix.recipeResolution"]);
    expect(lines[0]).toMatchObject({ from: "3회", to: "6회" });
  });
});
