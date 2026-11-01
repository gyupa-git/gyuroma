import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";
import { translate, type Key, type Params } from "../i18n";
import { describeChanges, hasCleanChanges, presetChanges, sanitizeChanges, type TidyContext } from "./tidy";
import { pickedOnly, pickedValueLines } from "./tidyArea";

const ko = (key: Key, params?: Params) => translate("ko", key, params);
const en = (key: Key, params?: Params) => translate("en", key, params);
const HANGUL = /[\uAC00-\uD7A3]/;

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
    const { changes, dropped } = sanitizeChanges({ target: 200, smoothing: -3, mix: { maxComponents: 3 } }, context, "clean", ko);
    expect(changes.target).toBe(64);
    expect(changes.smoothing).toBe(0);
    expect(changes.mix).toBeUndefined();
    expect(dropped.length).toBe(1);
  });

  it("keep colour names only for the palette as it is", () => {
    const { changes, dropped } = sanitizeChanges({ protect: ["#0e3d63", "#123456"], merge: [{ from: "#2E8B57", into: "#0E3D63" }] }, context, "clean", ko);
    expect(changes.protect).toEqual(["#0E3D63"]);
    expect(changes.merge).toEqual([{ from: "#2E8B57", into: "#0E3D63" }]);
    expect(dropped.join(" ")).toContain("#123456");
  });

  it("take the protected-colour smoothing as a switch, for 02 only", () => {
    const { changes } = sanitizeChanges({ smoothProtected: true, smoothing: 6 }, context, "clean", ko);
    expect(changes.smoothProtected).toBe(true);
    expect(hasCleanChanges({ smoothProtected: true })).toBe(true);
    expect(describeChanges(changes, context, ko).map((l) => `${l.key} ${l.from}→${l.to}`)).toEqual(["smoothing 3회→6회", "smoothProtected 끔→켬"]);
    const mixOnly = sanitizeChanges({ smoothProtected: true }, context, "mix", ko);
    expect(mixOnly.changes.smoothProtected).toBeUndefined();
    expect(mixOnly.dropped.length).toBe(1);
  });

  it("do not name colours in the same answer as a new count", () => {
    const { changes, dropped } = sanitizeChanges({ target: 8, protect: ["#0E3D63"] }, context, "clean", ko);
    expect(changes.target).toBe(8);
    expect(changes.protect).toBeUndefined();
    expect(dropped.length).toBe(1);
  });

  it("list only what really changes, before → after", () => {
    const lines = describeChanges({ target: 16, smoothing: 6, protect: ["#D62860", "#0E3D63"], mix: { maxComponents: 2, recipeResolution: "grid25" } }, context, ko);
    expect(lines.map((l) => l.key)).toEqual(["smoothing", "protect", "mix.recipeResolution"]);
    expect(lines[0]).toMatchObject({ from: "3회", to: "6회" });
  });

  it("say every line in the UI's language (no Korean in English)", () => {
    const every = { target: 8, minBlob: 1, smoothing: 1, trimTeeth: 3, lineSmooth: 16, smoothProtected: true, protect: ["#0E3D63"], merge: [{ from: "#D62860", into: "#0E3D63" }], protectAccents: true, mix: { assignmentMode: "physical-only", maxComponents: 3, recipeResolution: "grid10", accentProtection: "strong", mappingStrategy: "smooth", mixPriority: "avoid-muddy", autoPhysicalDirect: true, physicalDirectDeltaE: 9 } } as const;
    const lines = describeChanges(every, context, en);
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) expect(`${line.label} ${line.from} ${line.to}`).not.toMatch(HANGUL);
    expect(lines.find((l) => l.key === "smoothing")).toMatchObject({ label: "Smooth jagged edges", from: "3 passes", to: "1 pass" });
    expect(lines.find((l) => l.key === "lineSmooth")?.to).toBe("16 edges");
    expect(lines.find((l) => l.key === "mix.mappingStrategy")?.to).toBe("Smooth transitions");
    for (const id of ["crisp", "gradient", "solid", "detail", "trim", "line"] as const) {
      for (const line of pickedValueLines(pickedOnly(presetChanges(id, context, "clean")), en)) expect(`${line.label} ${line.to}`).not.toMatch(HANGUL);
    }
    expect(pickedValueLines(pickedOnly(presetChanges("line", context, "clean")), en).map((l) => `${l.label} ${l.to}`)).toEqual(["Straighten borders 16 edges", "Trim teeth 3 passes"]);
    expect(pickedValueLines(pickedOnly(presetChanges("line", context, "clean")), ko).map((l) => `${l.label} ${l.to}`)).toEqual(["경계 선 펴기 16칸", "톱니 깎기 3회"]);
    // What an answer could not apply, in English too.
    const notes = [
      ...sanitizeChanges({ target: 4, mix: { maxComponents: 3 } }, context, "mix", en).dropped,
      ...sanitizeChanges({ mix: { maxComponents: 3 }, protect: ["#123456"] }, context, "clean", en).dropped,
      ...sanitizeChanges({ target: 8, protect: ["#0E3D63"] }, context, "clean", en).dropped,
    ];
    expect(notes.length).toBe(4);
    for (const note of notes) expect(note).not.toMatch(HANGUL);
  });

  it("say how many filaments mix as the 03 panel does: one line, its value before and after", () => {
    const single = { ...context, mix: { ...context.mix, assignmentMode: "physical-only" as const, maxComponents: 2 as const } };
    const lines = describeChanges({ mix: { assignmentMode: "physical-and-virtual", maxComponents: 3 } }, single, en);
    expect(lines.filter((l) => l.label === "Mix up to").map((l) => `${l.from} → ${l.to}`)).toEqual(["None → 3 colours"]);
    // A hidden count changed while the row shows "single only": no line.
    expect(describeChanges({ mix: { maxComponents: 3 } }, single, en).filter((l) => l.label === "Mix up to")).toEqual([]);
  });
});
