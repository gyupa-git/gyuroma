/**
 * Print quality presets, taken from the profiles PrusaSlicer ships for the
 * Original Prusa XL with Input Shaper and a 0.4 nozzle.  Only the keys that
 * actually differ between those profiles are carried, so a preset changes
 * layer height, speeds, solid layers and support contact distance and leaves
 * everything else — including hand-tuned support settings — as the template
 * has it.
 *
 * Extracted from PrusaResearch.ini (PrusaSlicer 2.9.6) with the inheritance
 * chains resolved; the source profile of each preset is named below.
 */
export type PrintPresetId = "finest" | "high" | "normal" | "fast" | "draft";

export interface PrintPreset {
  id: PrintPresetId;
  /** The PrusaSlicer profile these values come from. */
  source: string;
  /** Layer height, for showing the preset's headline number. */
  layerHeight: number;
  settings: Record<string, string>;
}

export const PRINT_PRESETS: PrintPreset[] = [
  {
    id: "finest",
    source: "0.10mm FAST DETAIL @XLIS 0.4",
    layerHeight: 0.1,
    settings: {
      "bottom_solid_layers": "7",
      "bridge_speed": "40",
      "external_perimeter_acceleration": "2000",
      "external_perimeter_extrusion_width": "0.45",
      "external_perimeter_speed": "140",
      "gap_fill_speed": "120",
      "infill_extrusion_width": "0.45",
      "infill_speed": "140",
      "layer_height": "0.1",
      "overhang_speed_3": "80%",
      "perimeter_acceleration": "2000",
      "perimeter_extrusion_width": "0.45",
      "perimeter_speed": "140",
      "small_perimeter_speed": "140",
      "solid_infill_acceleration": "2500",
      "solid_infill_extrusion_width": "0.45",
      "solid_infill_speed": "200",
      "support_material_contact_distance": "0.17",
      "support_material_interface_speed": "50",
      "support_material_speed": "120",
      "top_infill_extrusion_width": "0.4",
      "top_solid_infill_acceleration": "1500",
      "top_solid_infill_speed": "100",
      "top_solid_layers": "8",
    },
  },
  {
    id: "high",
    source: "0.15mm STRUCTURAL @XLIS 0.4",
    layerHeight: 0.15,
    settings: {
      "bottom_solid_layers": "5",
      "bridge_speed": "45",
      "external_perimeter_acceleration": "1500",
      "external_perimeter_extrusion_width": "0.45",
      "external_perimeter_speed": "45",
      "gap_fill_speed": "65",
      "infill_extrusion_width": "0.45",
      "infill_speed": "110",
      "layer_height": "0.15",
      "overhang_speed_3": "90%",
      "perimeter_acceleration": "2500",
      "perimeter_extrusion_width": "0.45",
      "perimeter_speed": "80",
      "small_perimeter_speed": "45",
      "solid_infill_acceleration": "3000",
      "solid_infill_extrusion_width": "0.45",
      "solid_infill_speed": "140",
      "support_material_contact_distance": "0.17",
      "support_material_interface_speed": "50",
      "support_material_speed": "120",
      "top_infill_extrusion_width": "0.42",
      "top_solid_infill_acceleration": "1000",
      "top_solid_infill_speed": "75",
      "top_solid_layers": "6",
    },
  },
  {
    id: "normal",
    source: "0.15mm SPEED @XLIS 0.4",
    layerHeight: 0.15,
    settings: {
      "bottom_solid_layers": "4",
      "bridge_speed": "45",
      "external_perimeter_acceleration": "2500",
      "external_perimeter_extrusion_width": "0.45",
      "external_perimeter_speed": "170",
      "gap_fill_speed": "120",
      "infill_extrusion_width": "0.45",
      "infill_speed": "200",
      "layer_height": "0.15",
      "overhang_speed_3": "80%",
      "perimeter_acceleration": "3000",
      "perimeter_extrusion_width": "0.45",
      "perimeter_speed": "170",
      "small_perimeter_speed": "170",
      "solid_infill_acceleration": "3500",
      "solid_infill_extrusion_width": "0.45",
      "solid_infill_speed": "200",
      "support_material_contact_distance": "0.17",
      "support_material_interface_speed": "50",
      "support_material_speed": "120",
      "top_infill_extrusion_width": "0.42",
      "top_solid_infill_acceleration": "1500",
      "top_solid_infill_speed": "100",
      "top_solid_layers": "6",
    },
  },
  {
    id: "fast",
    source: "0.20mm SPEED @XLIS 0.4",
    layerHeight: 0.2,
    settings: {
      "bottom_solid_layers": "3",
      "bridge_speed": "50",
      "external_perimeter_acceleration": "2500",
      "external_perimeter_extrusion_width": "0.45",
      "external_perimeter_speed": "170",
      "gap_fill_speed": "120",
      "infill_extrusion_width": "0.45",
      "infill_speed": "200",
      "layer_height": "0.2",
      "overhang_speed_3": "80%",
      "perimeter_acceleration": "3000",
      "perimeter_extrusion_width": "0.45",
      "perimeter_speed": "170",
      "small_perimeter_speed": "170",
      "solid_infill_acceleration": "4000",
      "solid_infill_extrusion_width": "0.45",
      "solid_infill_speed": "200",
      "support_material_contact_distance": "0.2",
      "support_material_interface_speed": "50%",
      "support_material_speed": "110",
      "top_infill_extrusion_width": "0.42",
      "top_solid_infill_acceleration": "1500",
      "top_solid_infill_speed": "100",
      "top_solid_layers": "5",
    },
  },
  {
    id: "draft",
    source: "0.25mm STRUCTURAL @XLIS 0.4",
    layerHeight: 0.25,
    settings: {
      "bottom_solid_layers": "3",
      "bridge_speed": "50",
      "external_perimeter_acceleration": "1500",
      "external_perimeter_extrusion_width": "0.5",
      "external_perimeter_speed": "45",
      "gap_fill_speed": "65",
      "infill_extrusion_width": "0.5",
      "infill_speed": "120",
      "layer_height": "0.25",
      "overhang_speed_3": "90%",
      "perimeter_acceleration": "2500",
      "perimeter_extrusion_width": "0.5",
      "perimeter_speed": "80",
      "small_perimeter_speed": "45",
      "solid_infill_acceleration": "3000",
      "solid_infill_extrusion_width": "0.5",
      "solid_infill_speed": "140",
      "support_material_contact_distance": "0.25",
      "support_material_interface_speed": "50",
      "support_material_speed": "120",
      "top_infill_extrusion_width": "0.42",
      "top_solid_infill_acceleration": "1000",
      "top_solid_infill_speed": "75",
      "top_solid_layers": "4",
    },
  },
];

export function findPrintPreset(id: PrintPresetId | null | undefined): PrintPreset | null {
  if (!id) return null;
  return PRINT_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Rewrites a Slic3r_PE.config with a preset's values.  Keys the config does
 * not have are appended, so a template from an older profile still ends up
 * complete, and every other line is left untouched.
 */
export function applyPrintPresetToConfig(configText: string, preset: PrintPreset): string {
  let out = configText;
  const missing: string[] = [];
  for (const [key, value] of Object.entries(preset.settings)) {
    const line = new RegExp(`^; ${key} = .*$`, "m");
    if (line.test(out)) out = out.replace(line, `; ${key} = ${value}`);
    else missing.push(`; ${key} = ${value}`);
  }
  if (missing.length > 0) out = `${out.replace(/\s*$/, "")}\n${missing.join("\n")}\n`;
  return out;
}
