import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { encodePaintCode, paintCodeStates } from "@core/paintCodes";
import { bambuProjectFiles, buildBambuProjectSettings, type BambuMixedSlot } from "@core/bambuProject";
import { attr, planGather, readGatherSource, writeGather, type Box, type GatherSource } from "./gather";

const C = "#00AEEF";
const M = "#EC008C";
const Y = "#FFF200";
const W = "#FFFFFF";
const K = "#111111";
const RED = "#E02020";

interface Fake {
  physical: string[];
  mixes: Array<{ id: number; components: Array<[number, number]> }>;
  /** Paint code per triangle ("" = not painted). */
  codes: string[];
  /** Where the 10 × 10 mm square sits. */
  at: [number, number];
  extruder?: number;
  /** More objects with the same mesh, at these places. */
  more?: Array<[number, number]>;
}

/** A small PrusaSlicer project: one object, a strip of triangles, painted. */
function fake(f: Fake): Blob {
  const vertices: string[] = [];
  const triangles: string[] = [];
  f.codes.forEach((code, i) => {
    const x = (i * 10) / f.codes.length;
    vertices.push(`<vertex x="${x}" y="0" z="0"/>`, `<vertex x="${x + 1}" y="10" z="0"/>`, `<vertex x="${x}" y="10" z="5"/>`);
    triangles.push(`<triangle v1="${3 * i}" v2="${3 * i + 1}" v3="${3 * i + 2}"${code ? ` slic3rpe:mmu_segmentation="${code}"` : ""}/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
 <metadata name="slic3rpe:MmPaintingVersion">2</metadata>
 <metadata name="Application">PrusaSlicer-2.9.6</metadata>
 <resources>
${[f.at, ...(f.more ?? [])]
  .map(
    (_at, k) => `  <object id="${k + 1}" type="model">
   <mesh>
    <vertices>${vertices.join("\n")}</vertices>
    <triangles>${triangles.join("\n")}</triangles>
   </mesh>
  </object>`,
  )
  .join("\n")}
 </resources>
 <build>
${[f.at, ...(f.more ?? [])].map((at, k) => `  <item objectid="${k + 1}" transform="1 0 0 0 1 0 0 0 1 ${at[0]} ${at[1]} 0" printable="1"/>`).join("\n")}
 </build>
</model>
`;
  const spectrum = {
    physical_extruders: f.physical.map((color, i) => ({ id: i + 1, color })),
    version: 1,
    virtual_extruders: f.mixes.map((mix) => ({
      id: mix.id,
      kind: "fullspectrum",
      color: "#808080",
      components: mix.components.map(([extruder, ratio]) => ({ extruder, ratio })),
    })),
  };
  const config = `; bed_shape = 0x0,360x0,360x360,0x360\n; extruder_colour = ${f.physical.join(";")}\n; layer_height = 0.1\n; printer_model = XL5IS\n; wipe_tower = 1\n; wipe_tower_width = 60\n; wipe_tower_x = 165\n; wipe_tower_y = 300\n`;
  const modelConfig = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n <object id="1" instances_count="1">\n  <metadata type="object" key="name" value="piece"/>\n  <metadata type="object" key="extruder" value="${f.extruder ?? 1}"/>\n  <volume firstid="0" lastid="${f.codes.length - 1}">\n   <metadata type="volume" key="name" value="piece"/>\n  </volume>\n </object>\n</config>\n`;
  const bytes = zipSync({
    "3D/3dmodel.model": strToU8(model),
    "Metadata/Prusa_Slicer_full_spectrum.json": strToU8(JSON.stringify(spectrum)),
    "Metadata/Slic3r_PE.config": strToU8(config),
    "Metadata/Slic3r_PE_model.config": strToU8(modelConfig),
  });
  return new Blob([bytes as Uint8Array<ArrayBuffer>]);
}

// A paints E1, E3 and two mixes (C+W, M+Y).
const A = fake({ physical: [C, M, Y, W, K], mixes: [{ id: 6, components: [[1, 0.5], [4, 0.5]] }, { id: 7, components: [[2, 0.25], [3, 0.75]] }], codes: ["4", "0C", "3C", "4C"], at: [10, 10] });
// B: its 6 is A's 7, its 7 (C+K) is new; one triangle split by the brush into E1 and mix 6.
const B = fake({ physical: [C, M, Y, W, K], mixes: [{ id: 6, components: [[2, 0.25], [3, 0.75]] }, { id: 7, components: [[1, 0.3333], [5, 0.6667]] }], codes: ["3C", "4C", "8", "3C41"], at: [10, 10] });
// C: the same filaments loaded in another order (M first); its mix is A's C+W.
const Cf = fake({ physical: [M, C, Y, W, K], mixes: [{ id: 6, components: [[2, 0.5], [4, 0.5]] }], codes: ["3C", "4", ""], at: [10, 10], extruder: 1 });
// D: a red filament where the others have yellow.
const D = fake({ physical: [C, M, RED, W, K], mixes: [], codes: ["0C"], at: [10, 10] });

async function read(files: Blob[]): Promise<GatherSource[]> {
  return Promise.all(files.map((file, i) => readGatherSource(file, `f${i}.3mf`)));
}

function codesOf(model: string, objectId: number): string[] {
  const block = new RegExp(`<object id="${objectId}"[\\s\\S]*?</object>`).exec(model)?.[0] ?? "";
  return [...block.matchAll(/<triangle [^>]*>/g)].map((m) => attr(m[0], "slic3rpe:mmu_segmentation") ?? "");
}

describe("모아 뽑기 (gathering finished 3MF files)", () => {
  it("reads what each file paints with, without keeping the mesh", async () => {
    const [a, b] = await read([A, B]);
    expect(a.physical).toEqual([C, M, Y, W, K]);
    expect(a.states).toEqual({ 1: 1, 3: 1, 6: 1, 7: 1 });
    // the split triangle counts for both of its states
    expect(b.states).toEqual({ 6: 2, 7: 1, 2: 1, 1: 1 });
    expect(a.footprint.minX).toBeCloseTo(10);
    expect(a.footprint.maxY).toBeCloseTo(20);
    expect(a.bed).toEqual({ minX: 0, minY: 0, maxX: 360, maxY: 360 });
  });

  it("joins the same recipes and matches filaments by colour, not by slot", async () => {
    const sources = await read([A, B, Cf]);
    const plan = planGather(sources);
    expect(plan.used).toEqual([0, 1, 2]);
    expect(plan.slots).toEqual([C, M, Y, W, K]);
    expect(plan.slotChanges).toEqual([]);
    // A: 2 mixes, B: 2 (one is A's), C: 1 (A's): 5 before, 3 after
    expect(plan.mixesBefore).toBe(5);
    expect(plan.mixes.map((mix) => mix.components.map((c) => [c.extruder, c.ratio]))).toEqual([
      [[1, 0.5], [4, 0.5]],
      [[2, 0.25], [3, 0.75]],
      [[1, 0.3333], [5, 0.6667]],
    ]);
    expect(plan.stateMaps[1]).toMatchObject({ 6: 7, 7: 8 });
    // C has M in E1: its E1 is E2 now, its mix (its E2 + W) is A's C+W
    expect(plan.slotMaps[2]?.slice(1, 3)).toEqual([2, 1]);
    expect(plan.stateMaps[2]).toMatchObject({ 1: 2, 2: 1, 6: 6 });
  });

  it("leaves out a file whose filaments do not fit, or loads it in a free slot", async () => {
    const [a, b, , d] = await read([A, B, Cf, D]);
    const full = planGather([a, b, d]);
    expect(full.used).toEqual([0, 1]);
    expect(full.left).toEqual([{ source: 2, colours: [RED], reason: "filaments" }]);
    // without B, E5 (black) is free and the red goes there
    const roomy = planGather([a, d]);
    expect(roomy.used).toEqual([0, 1]);
    expect(roomy.slots).toEqual([C, M, Y, W, RED]);
    expect(roomy.slotChanges).toEqual([{ slot: 5, before: K, after: RED }]);
    expect(roomy.stateMaps[1]?.[3]).toBe(5);
  });

  it("takes a filament under another colour code as the same spool when told so", async () => {
    const [a, b] = await read([A, B]);
    // B again, with its black written a little differently; A and B fill all five slots
    const retinted = { ...b, physical: [C, M, Y, W, "#1A1A1A"] };
    expect(planGather([a, b, retinted]).left).toEqual([{ source: 2, colours: ["#1A1A1A"], reason: "filaments" }]);
    const plan = planGather([a, b, retinted], [0, 1, 2], { same: [2] });
    expect(plan.used).toEqual([0, 1, 2]);
    expect(plan.slots).toEqual([C, M, Y, W, K]);
    expect(plan.taken).toEqual([{ source: 2, colour: "#1A1A1A", slot: 5 }]);
    expect(plan.slotMaps[2]?.[5]).toBe(5);
    // and its mixes are B's, so they join
    expect(plan.mixes).toHaveLength(3);
  });

  it("puts every model on the bed, apart from each other and from the wipe tower", async () => {
    const sources = await read([A, B, Cf]);
    const plan = planGather(sources);
    const boxes = plan.used.flatMap((i) => (plan.places[i] ?? []).map((place) => place.box));
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box).toBeTruthy();
      expect(plan.places[0]?.[0].offBed).toBe(false);
      for (const other of boxes) {
        if (other === box || !box || !other) continue;
        const apart = box.maxX + 8 <= other.minX + 1e-6 || other.maxX + 8 <= box.minX + 1e-6 || box.maxY + 8 <= other.minY + 1e-6 || other.maxY + 8 <= box.minY + 1e-6;
        expect(apart).toBe(true);
      }
      const t = plan.tower as NonNullable<typeof plan.tower>;
      expect(box && (box.maxY <= t.minY || box.minY >= t.maxY || box.maxX <= t.minX || box.minX >= t.maxX)).toBe(true);
    }
  });

  it("keeps touching shells together and places a piece set apart on its own", async () => {
    // shells at the same place (one model), and one piece 200 mm away
    const split = fake({ physical: [C, M, Y, W, K], mixes: [], codes: ["4", "8"], at: [10, 10], more: [[10.5, 10], [210, 10]] });
    const [source] = await read([split]);
    expect(source.parts.map((part) => part.items)).toEqual([[0, 1], [2]]);
    const plan = planGather([source]);
    const [model, piece] = plan.places[0] as NonNullable<(typeof plan.places)[number]>;
    expect(model.offBed || piece.offBed).toBe(false);
    // the piece comes close instead of the pair taking 210 mm of bed
    expect(Math.abs(model.box.minX - piece.box.minX) + Math.abs(model.box.minY - piece.box.minY)).toBeLessThan(60);
    const out = unzipSync(new Uint8Array(await (await writeGather([split], [source], plan, { title: "x" })).arrayBuffer()));
    const items = [...strFromU8(out["3D/3dmodel.model"]).matchAll(/<item [^>]*>/g)].map((m) => (attr(m[0], "transform") ?? "").split(" ").map(Number));
    // the two shells keep their 0.5 mm offset
    expect(items[1][9] - items[0][9]).toBeCloseTo(0.5);
    expect(items[1][10]).toBeCloseTo(items[0][10]);
  });

  it("writes one project: renumbered paint, one mix table, every object placed", async () => {
    const files = [A, B, Cf];
    const sources = await read(files);
    const plan = planGather(sources);
    const blob = await writeGather(files, sources, plan, { title: "모아 뽑기" });
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const model = strFromU8(out["3D/3dmodel.model"]);
    expect(model).toContain('<metadata name="slic3rpe:MmPaintingVersion">2</metadata>');
    expect([...model.matchAll(/<object id="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    expect(codesOf(model, 1)).toEqual(["4", "0C", "3C", "4C"]);
    // B: 6 → 7, 7 → 8, E2 stays, the split keeps its split with 6 → 7 inside
    const bCodes = codesOf(model, 2);
    expect(bCodes.slice(0, 3)).toEqual(["4C", "5C", "8"]);
    expect(paintCodeStates(bCodes[3])).toEqual([1, 7]);
    // C: its mix 6 is A's 6, its E1 (magenta) is E2, the unpainted face stays unpainted
    expect(codesOf(model, 3)).toEqual(["3C", "8", ""]);
    const spectrum = JSON.parse(strFromU8(out["Metadata/Prusa_Slicer_full_spectrum.json"]));
    expect(spectrum.physical_extruders.map((p: { color: string }) => p.color)).toEqual([C, M, Y, W, K]);
    expect(spectrum.virtual_extruders.map((v: { id: number }) => v.id)).toEqual([6, 7, 8]);
    const items = [...model.matchAll(/<item [^>]*>/g)].map((m) => ({ id: attr(m[0], "objectid"), t: (attr(m[0], "transform") ?? "").split(" ").map(Number) }));
    expect(items.map((item) => item.id)).toEqual(["1", "2", "3"]);
    plan.used.forEach((index, k) => {
      const place = (plan.places[index] as NonNullable<(typeof plan.places)[number]>)[0];
      expect(items[k].t[9]).toBeCloseTo(10 + place.dx);
      expect(items[k].t[10]).toBeCloseTo(10 + place.dy);
    });
    // the model config follows: ids moved up, C's own extruder (magenta, its E1) is E2
    const modelConfig = strFromU8(out["Metadata/Slic3r_PE_model.config"]);
    expect([...modelConfig.matchAll(/<object id="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    expect(/<object id="3"[\s\S]*?key="extruder" value="(\d+)"/.exec(modelConfig)?.[1]).toBe("2");
    expect(strFromU8(out["Metadata/Slic3r_PE.config"])).toContain(`; extruder_colour = ${[C, M, Y, W, K].join(";")}`);
    // the mesh text goes through as it was
    const sourceModel = strFromU8(unzipSync(new Uint8Array(await A.arrayBuffer()))["3D/3dmodel.model"]);
    const vertices = (text: string) => [...text.matchAll(/<vertex [^>]*>/g)].map((m) => m[0]);
    expect(vertices(model).slice(0, 12)).toEqual(vertices(sourceModel));
  });

  it("loads a new filament's colour into the printer settings", async () => {
    const files = [A, D];
    const sources = await read(files);
    const plan = planGather(sources);
    const out = unzipSync(new Uint8Array(await (await writeGather(files, sources, plan, { title: "x" })).arrayBuffer()));
    expect(strFromU8(out["Metadata/Slic3r_PE.config"])).toContain(`; extruder_colour = ${[C, M, Y, W, RED].join(";")}`);
    expect(codesOf(strFromU8(out["3D/3dmodel.model"]), 2)).toEqual(["2C"]);
  });

});

interface FakeBambu {
  physical: string[];
  mixed: BambuMixedSlot[];
  /** Painted filament per triangle (as numbered in the project). */
  states: number[];
  at: [number, number];
  /** Mixed slot positions: filament numbers that are mixed (default: after the real ones). */
  order?: Array<"real" | "mixed">;
}

/** A small Bambu Studio project, as 규로마's Bambu export writes one. */
function fakeBambu(f: FakeBambu): Blob {
  const lines = ["   <mesh>", "    <vertices>"];
  f.states.forEach((_s, i) => {
    const x = (i * 10) / f.states.length;
    lines.push(`     <vertex x="${x}" y="0" z="0"/>`, `     <vertex x="${x + 1}" y="10" z="0"/>`, `     <vertex x="${x}" y="10" z="5"/>`);
  });
  lines.push("    </vertices>", "    <triangles>");
  f.states.forEach((state, i) => lines.push(`     <triangle v1="${3 * i}" v2="${3 * i + 1}" v3="${3 * i + 2}" paint_color="${encodePaintCode(state, "bambu")}"/>`));
  lines.push("    </triangles>", "   </mesh>");
  const settings = buildBambuProjectSettings("p2s", f.physical, f.mixed, { x: 20, y: 200 });
  if (f.order) {
    // the same filaments, with the mixed ones where `order` puts them
    const colours = settings.filament_colour as string[];
    const real = colours.slice(0, f.physical.length);
    const mixed = colours.slice(f.physical.length);
    let r = 0;
    let m = 0;
    const placed = f.order.map((kind) => (kind === "real" ? { kind, k: r++ } : { kind, k: m++ }));
    const realNumber = (k: number) => placed.findIndex((p) => p.kind === "real" && p.k === k) + 1;
    settings.filament_colour = placed.map((p) => (p.kind === "real" ? real[p.k] : mixed[p.k]));
    settings.filament_is_mixed = placed.map((p) => (p.kind === "real" ? "0" : "1"));
    settings.filament_mixed_components = placed.map((p) => (p.kind === "real" ? "" : f.mixed[p.k].components.map((c) => realNumber(c - 1)).join(",")));
    settings.filament_mixed_sublayer_ratios = placed.map((p) => (p.kind === "real" ? "" : f.mixed[p.k].ratios.map((v) => v.toFixed(4)).join(",")));
  }
  const files = bambuProjectFiles({
    title: "piece",
    sourceFile: "piece.obj",
    objects: [{ name: "piece", meshLines: lines, faceCount: f.states.length }],
    transform: `1 0 0 0 1 0 0 0 1 ${f.at[0]} ${f.at[1]} 0`,
    settings,
    hasThumbnail: false,
  });
  const zip: Record<string, Uint8Array> = {};
  for (const [path, text] of files) zip[path] = strToU8(text);
  return new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>]);
}

const mix = (components: number[], ratios: number[], colour: string): BambuMixedSlot => ({ components, ratios, colour });

describe("모아 뽑기 for Bambu Studio", () => {
  // 5 real filaments, 13 mixes: filament 18 is painted, in Bambu's own long form
  const many = Array.from({ length: 13 }, (_v, i) => mix([1 + (i % 5), 1 + ((i + 1) % 5)], [0.25 + i * 0.02, 0.75 - i * 0.02], `#${(0x405060 + i * 0x0a0806).toString(16).toUpperCase()}`));
  const P = fakeBambu({ physical: [C, M, Y, W, K], mixed: many, states: [1, 6, 17, 18], at: [100, 100] });
  // the same mixes but one, a new one in its place
  const Q = fakeBambu({ physical: [C, M, Y, W, K], mixed: [...many.slice(0, 12), mix([2, 5], [0.5, 0.5], "#704050")], states: [18, 6, 3], at: [100, 100] });

  it("reads a Bambu Studio project: real filaments first, its long codes, its printer", async () => {
    const [p] = await read([P]);
    expect(p.slicer).toBe("bambu");
    expect(p.bambu?.printerKey).toBe("p2s");
    expect(p.physical).toEqual([C, M, Y, W, K]);
    expect(p.mixes).toHaveLength(13);
    expect(p.states).toEqual({ 1: 1, 6: 1, 17: 1, 18: 1 });
    expect(p.mixes[12].components.map((c) => c.extruder)).toEqual([3, 4]);
  });

  it("puts mixed filaments after the real ones when the project has them in between", async () => {
    // filament 2 is a mix of filaments 1 and 3
    const between = fakeBambu({ physical: [C, M, Y], mixed: [mix([1, 2], [0.5, 0.5], "#808080")], states: [1, 2, 3, 4], at: [10, 10], order: ["real", "mixed", "real", "real"] });
    const [b] = await read([between]);
    expect(b.physical).toEqual([C, M, Y]);
    expect(b.bambu?.renumber).toEqual({ 1: 1, 2: 4, 3: 2, 4: 3 });
    expect(b.mixes[0].components.map((c) => c.extruder)).toEqual([1, 2]);
    expect(b.states).toEqual({ 1: 1, 4: 1, 2: 1, 3: 1 });
  });

  it("writes one Bambu Studio project with the mixes joined and Bambu's own codes", async () => {
    const files = [P, Q];
    const sources = await read(files);
    const plan = planGather(sources);
    expect(plan.slicer).toBe("bambu");
    // P uses 3 of its mixes (6, 17, 18 → its mixes 1, 12, 13), Q 2 (6 = shared, 18 = its new one)
    expect(plan.mixesBefore).toBe(5);
    expect(plan.mixes).toHaveLength(4);
    const out = unzipSync(new Uint8Array(await (await writeGather(files, sources, plan, { title: "x" })).arrayBuffer()));
    const settings = JSON.parse(strFromU8(out["Metadata/project_settings.config"]));
    expect(settings.filament_colour.slice(0, 5)).toEqual([C, M, Y, W, K]);
    expect(settings.filament_is_mixed).toEqual(["0", "0", "0", "0", "0", "1", "1", "1", "1"]);
    expect(settings.printer_settings_id).toBe("Bambu Lab P2S 0.4 nozzle");
    const main = strFromU8(out["3D/3dmodel.model"]);
    expect([...main.matchAll(/p:path="([^"]+)"/g)].map((m) => m[1])).toEqual(["/3D/Objects/object_1.model", "/3D/Objects/object_2.model"]);
    const codes = (path: string) => [...strFromU8(out[path]).matchAll(/paint_color="([0-9A-F]+)"/g)].map((m) => m[1]);
    // P: 1 stays, its mix 6 is new 6, 17 → 7, 18 → 8 (Bambu writes 17 as "EC" and 18 as "0FC")
    expect(codes("3D/Objects/object_1.model")).toEqual(["4", "3C", "4C", "5C"]);
    // Q: its 18 (a new mix) → 9, its 6 = P's 6, filament 3 stays
    expect(codes("3D/Objects/object_2.model")).toEqual(["6C", "3C", "0C"]);
    const recipes = settings.filament_mixed_components.slice(5);
    expect(recipes).toEqual(["1,2", "2,3", "3,4", "2,5"]);
    const modelSettings = strFromU8(out["Metadata/model_settings.config"]);
    expect([...modelSettings.matchAll(/<object id="(\d+)"/g)].map((m) => m[1])).toEqual(["3", "4"]);
    expect([...modelSettings.matchAll(/<part id="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "2"]);
    expect([...modelSettings.matchAll(/key="object_id" value="(\d+)"/g)].map((m) => m[1])).toEqual(["3", "4"]);
    // the two pieces stand apart and clear of the tower
    const boxes = plan.used.flatMap((i) => (plan.places[i] ?? []).map((place) => place.box));
    expect(boxes[0].maxX + 8 <= boxes[1].minX || boxes[1].maxX + 8 <= boxes[0].minX || boxes[0].maxY + 8 <= boxes[1].minY || boxes[1].maxY + 8 <= boxes[0].minY).toBe(true);
    expect(settings.wipe_tower_x).toEqual([String(Math.round((plan.tower as Box).minX))]);
  });

  it("joins the nearest mixes when Bambu Studio's 32 filaments are not enough", async () => {
    // 20 different recipes per file, none shared
    const colours = (shift: number) => Array.from({ length: 20 }, (_v, i) => mix([1 + (i % 5), 1 + ((i + 2) % 5)], [0.1 + i * 0.03 + shift, 0.9 - i * 0.03 - shift], `#${(0x203040 + i * 0x070503 + Math.round(shift * 100) * 0x10000).toString(16).toUpperCase()}`));
    const a = fakeBambu({ physical: [C, M, Y, W, K], mixed: colours(0), states: Array.from({ length: 20 }, (_v, i) => 6 + i), at: [10, 10] });
    const b = fakeBambu({ physical: [C, M, Y, W, K], mixed: colours(0.1), states: Array.from({ length: 20 }, (_v, i) => 6 + i), at: [10, 10] });
    const files = [a, b];
    const sources = await read(files);
    const plan = planGather(sources);
    expect(plan.mixesBefore).toBe(40);
    expect(plan.mixes).toHaveLength(27);
    expect(plan.joined).toHaveLength(13);
    for (const states of plan.stateMaps) for (const value of Object.values(states ?? {})) expect(value).toBeLessThanOrEqual(32);
    const out = unzipSync(new Uint8Array(await (await writeGather(files, sources, plan, { title: "x" })).arrayBuffer()));
    const settings = JSON.parse(strFromU8(out["Metadata/project_settings.config"]));
    expect(settings.filament_colour).toHaveLength(32);
  });

  it("leaves out a file for the other slicer", async () => {
    const sources = await read([P, A]);
    const plan = planGather(sources);
    expect(plan.used).toEqual([0]);
    expect(plan.left).toEqual([{ source: 1, colours: [], reason: "slicer" }]);
  });
});
