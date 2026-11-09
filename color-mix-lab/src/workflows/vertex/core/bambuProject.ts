import templates from "./bambu/projectTemplates.json";
import { bambuFlushMatrix } from "./bambuFlush";

/**
 * Bambu Studio project files.
 *
 * Bambu Studio reads a 3MF's settings only when the file says Bambu Studio
 * wrote it, and then it expects the whole project: every setting, one plate,
 * each object in its own model file.  Its mixed filaments (2.8+) live in those
 * settings: a mixed filament is one more filament slot after the physical ones,
 * flagged `filament_is_mixed`, with its components and layer ratios.  Unless
 * sub-layers are switched on, Bambu Studio prints whole layers of the
 * components in those ratios, as PrusaSlicer's Full Spectrum does.
 *
 * The settings start from a project Bambu Studio's CLI saved for each printer
 * (scripts/bambu_project_templates.py): the per-filament arrays are grown to
 * the slot count, the flush matrix is recomputed for the colours, and the
 * mixed slots are added the way Bambu Studio's "Add mixed filament" does
 * (the slot copies its first component's filament settings).
 */

export interface BambuMixedSlot {
  /** 1-based physical slots, at least two, no repeats. */
  components: number[];
  /** Share of layers per component, summing to 1. */
  ratios: number[];
  /** "#RRGGBB" the slot is shown in. */
  colour: string;
}

interface PrinterTemplate {
  machine: string;
  process: string;
  filament: string;
  nozzles: number;
  flush: Array<{ dataset: number; min: number }>;
  perFilament: string[];
  plusTwo: string[];
  config: Record<string, unknown>;
}

const PRINTERS = templates.printers as Record<string, PrinterTemplate>;
const BASE = templates.base as Record<string, unknown>;

/** Bambu Studio's limit on filament slots, mixed ones included. */
export const BAMBU_MAX_SLOTS = 32;
/** The Bambu Studio version the templates were measured from. */
export const BAMBU_PROJECT_VERSION: string = templates.version;

/**
 * The template printer a Bambu Studio project was made for (its key), from
 * the project's own settings: the machine preset first, then the model name.
 */
export function findBambuPrinter(settings: Record<string, unknown>): string | null {
  const preset = settings.printer_settings_id;
  const model = settings.printer_model;
  for (const [key, template] of Object.entries(PRINTERS)) if (typeof preset === "string" && preset === template.machine) return key;
  for (const [key, template] of Object.entries(PRINTERS)) if (typeof model === "string" && model === template.config.printer_model) return key;
  return null;
}

export function hasBambuProjectTemplate(printerKey: string | undefined): boolean {
  return Boolean(printerKey && PRINTERS[printerKey]);
}

export function bambuPrinterTemplate(printerKey: string): PrinterTemplate {
  const template = PRINTERS[printerKey];
  if (!template) throw new Error(`No Bambu Studio project template for "${printerKey}".`);
  return template;
}

function ratioText(value: number): string {
  return value.toFixed(4);
}

/** Checks the mixed slots the way Bambu Studio's validate_mixed_filament_params does. */
export function validateBambuMixedSlots(physicalCount: number, mixed: BambuMixedSlot[]): string[] {
  const failures: string[] = [];
  if (physicalCount + mixed.length > BAMBU_MAX_SLOTS)
    failures.push(`Bambu Studio takes at most ${BAMBU_MAX_SLOTS} filaments, mixed ones included (got ${physicalCount + mixed.length}).`);
  mixed.forEach((slot, index) => {
    const name = `mixed filament ${physicalCount + index + 1}`;
    if (slot.components.length < 2) failures.push(`${name}: needs at least 2 components.`);
    if (new Set(slot.components).size !== slot.components.length) failures.push(`${name}: a component appears twice.`);
    if (slot.components.some((c) => !Number.isInteger(c) || c < 1 || c > physicalCount))
      failures.push(`${name}: components must be physical filaments 1–${physicalCount}.`);
    if (slot.ratios.length !== slot.components.length || slot.ratios.some((r) => !(r > 0)))
      failures.push(`${name}: one positive ratio per component is needed.`);
  });
  return failures;
}

/**
 * The project settings (Metadata/project_settings.config) for a printer, the
 * physical filament colours (slot 1 first) and the mixed slots after them.
 */
export function buildBambuProjectSettings(
  printerKey: string,
  physicalColours: string[],
  mixed: BambuMixedSlot[],
  wipeTower: { x: number; y: number },
): Record<string, unknown> {
  const template = bambuPrinterTemplate(printerKey);
  const config: Record<string, unknown> = structuredClone({ ...BASE, ...template.config });
  const colours = [...physicalColours, ...mixed.map((slot) => slot.colour)].map((c) => c.toUpperCase());
  const count = colours.length;
  const physical = physicalColours.length;
  // Every slot carries the printer's default PLA; a mixed slot copies its first
  // component, which here is the same filament.
  for (const key of template.perFilament) {
    const values = config[key] as string[];
    config[key] = Array.from({ length: count }, () => values[0]);
  }
  for (const key of template.plusTwo) {
    const [head, filament, tail] = config[key] as string[];
    config[key] = [head, ...Array.from({ length: count }, () => filament), tail];
  }
  for (const key of templates.slotDefaults) {
    const values = config[key];
    if (Array.isArray(values)) config[key] = Array.from({ length: count }, () => values[0]);
  }
  config.filament_colour = colours;
  config.filament_self_index = colours.map((_c, i) => String(i + 1));
  config.filament_is_mixed = colours.map((_c, i) => (i < physical ? "0" : "1"));
  config.filament_mixed_components = colours.map((_c, i) => (i < physical ? "" : mixed[i - physical].components.join(",")));
  config.filament_mixed_sublayer_ratios = colours.map((_c, i) => (i < physical ? "" : mixed[i - physical].ratios.map(ratioText).join(",")));
  config.filament_mixed_gradient = colours.map(() => "0");
  config.filament_mixed_gradient_range = colours.map(() => "");
  config.filament_mixed_gradient_curve = colours.map(() => "");
  config.filament_mixed_gradient_per_part = colours.map(() => "0");
  // Whole layers in the given ratios (sub-layers would split every layer).
  config.enable_mixed_color_sublayer = "0";
  config.flush_volumes_matrix = template.flush.flatMap((nozzle) => bambuFlushMatrix(colours, nozzle.dataset, nozzle.min).map(String));
  // Nozzles per extruder ("Standard#1"): the CLI leaves this empty, and then the
  // two-extruder printers find no nozzle to print with.
  const maxNozzles = config.extruder_max_nozzle_count as string[] | undefined;
  const volumeTypes = config.nozzle_volume_type as string[] | undefined;
  if (Array.isArray(maxNozzles) && !(config.extruder_nozzle_stats as string[] | undefined)?.length) {
    const stats = maxNozzles.map((n, i) => `${volumeTypes?.[i] ?? "Standard"}#${n}`);
    config.extruder_nozzle_stats = stats;
    config.extruder_nozzle_stats_new = stats;
  }
  config.wipe_tower_x = [String(Math.round(wipeTower.x))];
  config.wipe_tower_y = [String(Math.round(wipeTower.y))];
  return config;
}

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of a Bambu polygon: ["0x0", "18x0", …] or one "0x0,325x0,…" string. */
function polygonBox(points: string[]): Rect | null {
  const xy = points
    .flatMap((p) => p.split(","))
    .map((p) => p.split("x").map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (xy.length === 0) return null;
  return {
    minX: Math.min(...xy.map((p) => p[0])),
    minY: Math.min(...xy.map((p) => p[1])),
    maxX: Math.max(...xy.map((p) => p[0])),
    maxY: Math.max(...xy.map((p) => p[1])),
  };
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.minX < b.maxX + gap && a.maxX + gap > b.minX && a.minY < b.maxY + gap && a.maxY + gap > b.minY;
}

/**
 * Where the wipe tower goes: a corner of the area every nozzle reaches (the
 * H2 printers' two nozzles each miss one edge of the bed), outside the bed's
 * excluded area (the X1/P1 front-left corner) and clear of the model.  Its
 * depth grows with the real filaments (mixed ones only reuse them): about 45
 * mm for five in the Bambu Studio slices this was checked with, so 20 + 6 per
 * filament plus the brim is assumed.  Bambu Studio flags any clash, and the
 * tower can be dragged there.
 */
export function bambuWipeTowerPosition(
  printerKey: string,
  footprint: Rect,
  physicalCount: number,
): { x: number; y: number } {
  const tower = bambuPlate(printerKey, physicalCount, footprint).tower;
  return { x: tower.minX, y: tower.minY };
}

/**
 * A printer's plate as the wipe tower sees it: the area every nozzle reaches,
 * the excluded corner (if any), and the box of the tower at the first corner
 * clear of `footprint` (see bambuWipeTowerPosition).
 */
export function bambuPlate(printerKey: string, physicalCount: number, footprint?: Rect): { reach: Rect; excluded: Rect | null; tower: Rect } {
  const template = bambuPrinterTemplate(printerKey);
  const config = { ...BASE, ...template.config } as Record<string, unknown>;
  const bed = polygonBox((config.printable_area as string[]) ?? []) ?? { minX: 0, minY: 0, maxX: 256, maxY: 256 };
  const reach = { ...bed };
  for (const area of (config.extruder_printable_area as string[]) ?? []) {
    const box = polygonBox([area]);
    if (!box) continue;
    reach.minX = Math.max(reach.minX, box.minX);
    reach.minY = Math.max(reach.minY, box.minY);
    reach.maxX = Math.min(reach.maxX, box.maxX);
    reach.maxY = Math.min(reach.maxY, box.maxY);
  }
  const excluded = polygonBox((config.bed_exclude_area as string[]) ?? []);
  const brim = 6;
  const width = (Number(config.prime_tower_width) || 35) + 2 * brim;
  const depth = Math.min((reach.maxY - reach.minY) * 0.45, 20 + physicalCount * 6 + 2 * brim);
  const margin = 15;
  const left = reach.minX + margin;
  const right = reach.maxX - margin - width;
  const front = reach.minY + margin;
  const back = reach.maxY - margin - depth;
  // Back-left first, where Bambu Studio puts it.
  const corners = [
    { x: left, y: back },
    { x: right, y: back },
    { x: left, y: front },
    { x: right, y: front },
  ];
  const box = (c: { x: number; y: number }): Rect => ({ minX: c.x, minY: c.y, maxX: c.x + width, maxY: c.y + depth });
  const allowed = corners.filter((c) => !excluded || !overlaps(box(c), excluded, 5));
  const corner = allowed.find((c) => !footprint || !overlaps(box(c), footprint, 5)) ?? allowed[0] ?? corners[0];
  return { reach, excluded, tower: box(corner) };
}

export interface BambuProjectObject {
  name: string;
  /** The object's `<mesh>…</mesh>` lines, triangles painted with `paint_color`; left out when the caller writes the object file itself. */
  meshLines?: string[];
  faceCount: number;
}

/** Composed (NFC) first, as in export3mf.ts: decomposed Korean showed as "????" in Bambu Studio. */
function xmlEscape(value: string): string {
  return value.normalize("NFC").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}

export const BAMBU_MODEL_HEADER =
  '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">';

/** The object file around one object's `<mesh>` lines: the lines before them, and after. */
export function bambuObjectModelFrame(k: number): { head: string[]; tail: string[] } {
  return {
    head: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      BAMBU_MODEL_HEADER,
      ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
      " <resources>",
      `  <object id="${k + 1}" p:UUID="${hex8(0x10000 + k)}-81cb-4c03-9d28-80fed5dfa1dc" type="model">`,
    ],
    tail: ["  </object>", " </resources>", " <build/>", "</model>"],
  };
}

/**
 * Every file of a Bambu Studio project except the thumbnail: the model with
 * one component per object, each object's mesh in 3D/Objects, the plate, and
 * the settings.
 */
export function bambuProjectFiles(input: {
  title: string;
  sourceFile: string;
  objects: BambuProjectObject[];
  /** 3MF build transform shared by all objects (placement on the plate). */
  transform: string;
  settings: Record<string, unknown>;
  hasThumbnail: boolean;
}): Map<string, string> {
  const files = new Map<string, string>();
  const date = new Date().toISOString().slice(0, 10);
  const count = input.objects.length;
  const assemblyId = (k: number) => count + k + 1;

  const main: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', BAMBU_MODEL_HEADER];
  main.push(` <metadata name="Application">BambuStudio-${BAMBU_PROJECT_VERSION}</metadata>`);
  main.push(' <metadata name="BambuStudio:3mfVersion">1</metadata>');
  main.push(` <metadata name="CreationDate">${date}</metadata>`);
  main.push(` <metadata name="ModificationDate">${date}</metadata>`);
  main.push(` <metadata name="Title">${xmlEscape(input.title)}</metadata>`);
  main.push(" <resources>");
  input.objects.forEach((_object, k) => {
    main.push(`  <object id="${assemblyId(k)}" p:UUID="${hex8(k + 1)}-61cb-4c03-9d28-80fed5dfa1dc" type="model">`);
    main.push("   <components>");
    main.push(
      `    <component p:path="/3D/Objects/object_${k + 1}.model" objectid="${k + 1}" p:UUID="${hex8(0x10000 + k)}-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`,
    );
    main.push("   </components>");
    main.push("  </object>");
  });
  main.push(" </resources>");
  main.push(' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">');
  input.objects.forEach((_object, k) => {
    main.push(`  <item objectid="${assemblyId(k)}" p:UUID="${hex8(k + 2)}-b1ec-4553-aec9-835e5b724bb4" transform="${input.transform}" printable="1"/>`);
  });
  main.push(" </build>");
  main.push("</model>");
  files.set("3D/3dmodel.model", main.join("\n") + "\n");

  input.objects.forEach((object, k) => {
    if (!object.meshLines) return;
    const frame = bambuObjectModelFrame(k);
    files.set(`3D/Objects/object_${k + 1}.model`, [...frame.head, ...object.meshLines, ...frame.tail].join("\n") + "\n");
  });

  files.set(
    "3D/_rels/3dmodel.model.rels",
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      input.objects.map((_o, k) => ` <Relationship Target="/3D/Objects/object_${k + 1}.model" Id="rel-${k + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n`).join("") +
      "</Relationships>\n",
  );

  const settings: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
  input.objects.forEach((object, k) => {
    const name = xmlEscape(object.name);
    settings.push(`  <object id="${assemblyId(k)}">`);
    settings.push(`    <metadata key="name" value="${name}"/>`);
    settings.push('    <metadata key="extruder" value="1"/>');
    settings.push(`    <metadata face_count="${object.faceCount}"/>`);
    settings.push(`    <part id="${k + 1}" subtype="normal_part">`);
    settings.push(`      <metadata key="name" value="${name}"/>`);
    settings.push('      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>');
    settings.push(`      <metadata key="source_file" value="${xmlEscape(input.sourceFile)}"/>`);
    settings.push('      <metadata key="source_object_id" value="0"/>');
    settings.push('      <metadata key="source_volume_id" value="0"/>');
    settings.push(`      <mesh_stat face_count="${object.faceCount}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>`);
    settings.push("    </part>");
    settings.push("  </object>");
  });
  settings.push("  <plate>");
  settings.push('    <metadata key="plater_id" value="1"/>');
  settings.push('    <metadata key="plater_name" value=""/>');
  settings.push('    <metadata key="locked" value="false"/>');
  settings.push('    <metadata key="filament_map_mode" value="Auto For Flush"/>');
  settings.push('    <metadata key="gcode_file" value=""/>');
  if (input.hasThumbnail) settings.push('    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>');
  input.objects.forEach((_object, k) => {
    settings.push("    <model_instance>");
    settings.push(`      <metadata key="object_id" value="${assemblyId(k)}"/>`);
    settings.push('      <metadata key="instance_id" value="0"/>');
    settings.push(`      <metadata key="identify_id" value="${100 + k}"/>`);
    settings.push("    </model_instance>");
  });
  settings.push("  </plate>");
  settings.push("  <assemble>");
  settings.push("  </assemble>");
  settings.push("</config>");
  files.set("Metadata/model_settings.config", settings.join("\n") + "\n");

  files.set("Metadata/project_settings.config", JSON.stringify(input.settings, null, 4) + "\n");
  files.set(
    "Metadata/slice_info.config",
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="${BAMBU_PROJECT_VERSION}"/>\n  </header>\n</config>\n`,
  );
  files.set("Metadata/filament_sequence.json", '{"plate_1":{"nozzle_sequence":[],"optimal_assignment":[],"sequence":[]}}');
  files.set(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n',
  );
  files.set(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
      (input.hasThumbnail
        ? ' <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>\n'
        : "") +
      "</Relationships>\n",
  );
  return files;
}
