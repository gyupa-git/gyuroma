import type { ColourFileFormat } from "@core/exportColour";
import type { SlicerTarget } from "@core/export3mf";

/**
 * Export targets: the printers people print colour with, most used first.
 *
 * - fdm: filament machines.  The file is a painted 3MF; `slicer` says which
 *   family reads it (PrusaSlicer, or Bambu Studio / OrcaSlicer and their
 *   forks, which read a different paint attribute).
 * - colour: machines that print colour directly (inkjet resin, PolyJet,
 *   binder jetting, UV).  They take a coloured mesh, so the filament step does
 *   not apply and the cleaned colours go out as they are.
 *
 * Bed sizes come from the printers' own slicer profiles (PrusaSlicer 3.0,
 * Bambu Studio 2.8, ElegooSlicer 1.5, QIDI Studio 2.7, read 2026-10-30).
 */
export type PrinterTier = "major" | "minor";

interface PrinterBase {
  id: string;
  /** Product name; empty for the catch-all entries, which the UI names in its own language. */
  name: string;
  tier: PrinterTier;
  /** Name of the program the file is opened in. */
  app: string;
  bed: { x: number; y: number; z: number };
}

export interface FdmPrinter extends PrinterBase {
  kind: "fdm";
  slicer: SlicerTarget;
  /** Filament slots: the usual set-up, and the most its add-ons allow. */
  slots: { base: number; max: number };
  /** Layer mixing in its slicer (PrusaSlicer 2.9.6+ Full Spectrum, Bambu Studio 2.8+ mixed filaments). */
  layerMixing: boolean;
  /**
   * Bambu Studio printer whose project the file is written as (a key of
   * core/bambu/projectTemplates.json): the colour mixes then go in as Bambu
   * Studio 2.8 mixed filaments.  Forks of Bambu Studio and OrcaSlicer have no
   * mixed filaments and get the painted model only.
   */
  bambuProject?: string;
  /** Announced but not out yet: the date its specs are due; the values are stand-ins until then. */
  provisional?: string;
  /**
   * PrusaSlicer `printer_model` codes of this printer.  A template's printer
   * config goes into the file only when its model is one of these: an XL
   * config in a CORE One file would open as an XL.
   */
  prusaModels?: string[];
}

export interface ColourPrinter extends PrinterBase {
  kind: "colour";
  /** Colour files its software takes, best first. */
  formats: ColourFileFormat[];
}

export type Printer = FdmPrinter | ColourPrinter;

const fdm = (
  id: string,
  name: string,
  tier: PrinterTier,
  app: string,
  slicer: SlicerTarget,
  slots: [number, number],
  bed: [number, number, number],
  layerMixing = slicer === "prusa",
): FdmPrinter => ({ id, name, tier, app, kind: "fdm", slicer, slots: { base: slots[0], max: slots[1] }, bed: { x: bed[0], y: bed[1], z: bed[2] }, layerMixing });

const colour = (id: string, name: string, tier: PrinterTier, app: string, formats: ColourFileFormat[], bed: [number, number, number]): ColourPrinter => ({
  id,
  name,
  tier,
  app,
  kind: "colour",
  formats,
  bed: { x: bed[0], y: bed[1], z: bed[2] },
});

/** A Bambu Lab printer opened in Bambu Studio: written as a Bambu Studio project, mixes included. */
const bambuLab = (id: string, name: string, project: string, slots: [number, number], bed: [number, number, number]): FdmPrinter => ({
  ...fdm(id, name, "major", "Bambu Studio", "bambu", slots, bed, true),
  bambuProject: project,
});

export const PRINTERS: Printer[] = [
  // ---- filament, most used
  bambuLab("bbl-p2s", "Bambu Lab P2S + AMS", "p2s", [4, 16], [256, 256, 256]),
  bambuLab("bbl-x1c", "Bambu Lab X1C / X1E + AMS", "x1c", [4, 16], [256, 256, 250]),
  bambuLab("bbl-p1s", "Bambu Lab P1S / P1P + AMS", "p1s", [4, 16], [256, 256, 250]),
  bambuLab("bbl-a1", "Bambu Lab A1 + AMS lite", "a1", [4, 4], [256, 256, 256]),
  bambuLab("bbl-a1mini", "Bambu Lab A1 mini + AMS lite", "a1mini", [4, 4], [180, 180, 180]),
  // Two heads (H2D) or a 1 + 6 nozzle rack (H2C): the file only names filaments,
  // Bambu Studio picks the head for each (checked: both slice the same file).
  // AMS set-ups go past 16, the most this app plans for.
  bambuLab("bbl-h2d", "Bambu Lab H2D / H2D Pro (2 heads)", "h2d", [4, 16], [350, 320, 325]),
  bambuLab("bbl-h2c", "Bambu Lab H2C (1 + 6 nozzles)", "h2c", [4, 16], [330, 320, 325]),
  bambuLab("bbl-h2s", "Bambu Lab H2S + AMS", "h2s", [4, 16], [340, 320, 340]),
  // Teased with nine nozzle stations, specs due on 3 November 2026: H2C values
  // (and an H2C project) until then.
  { ...bambuLab("bbl-h3c", "Bambu Lab H3C", "h2c", [9, 16], [330, 320, 325]), provisional: "2026-11-03" },
  { ...fdm("prusa-xl5", "Prusa XL 5T", "major", "PrusaSlicer", "prusa", [5, 5], [360, 360, 360]), prusaModels: ["XL5IS", "XL5"] },
  { ...fdm("prusa-c1-mmu3", "Prusa CORE One + MMU3", "major", "PrusaSlicer", "prusa", [5, 5], [250, 220, 270]), prusaModels: ["COREONEMMU3"] },
  { ...fdm("prusa-mk4s-mmu3", "Prusa MK4S + MMU3", "major", "PrusaSlicer", "prusa", [5, 5], [250, 210, 220]), prusaModels: ["MK4SMMU3", "MK4ISMMU3"] },
  fdm("creality-k2plus", "Creality K2 Plus + CFS", "major", "Creality Print", "bambu", [4, 16], [350, 350, 350]),
  fdm("creality-hi", "Creality Hi + CFS", "major", "Creality Print", "bambu", [4, 16], [260, 260, 300]),
  fdm("elegoo-cc2", "Elegoo Centauri Carbon 2 + CANVAS", "major", "ElegooSlicer", "bambu", [4, 4], [256, 256, 256]),
  fdm("anycubic-s1", "Anycubic Kobra S1 + ACE Pro", "major", "Anycubic Slicer Next", "bambu", [4, 8], [250, 250, 250]),
  fdm("anycubic-k3", "Anycubic Kobra 3 + ACE Pro", "major", "Anycubic Slicer Next", "bambu", [4, 8], [255, 255, 260]),
  fdm("snapmaker-u1", "Snapmaker U1", "major", "Snapmaker Orca", "bambu", [4, 4], [271, 272, 270]),
  // ---- filament, fewer users
  // INDX: Bondtech's tool changer, 4 or 8 tools (PrusaSlicer profiles "INDX 4T / 8T").
  { ...fdm("prusa-c1-indx", "Prusa CORE One INDX (4 · 8 tools)", "minor", "PrusaSlicer", "prusa", [4, 8], [248, 205, 270]), prusaModels: ["COREONE_INDX8T", "COREONE_INDX4T"] },
  // Sold from Prusa's shop, 8 tools shipping after 18.1.2027; no slicer profile yet.
  // Build volume with the dock in place, from the product page.
  fdm("prusa-c1l-indx", "Prusa CORE One L+ INDX (4 · 8 tools)", "minor", "PrusaSlicer", "prusa", [4, 8], [298, 275, 330]),
  { ...fdm("prusa-c1l-mmu3", "Prusa CORE One L + MMU3", "minor", "PrusaSlicer", "prusa", [5, 5], [300, 300, 330]), prusaModels: ["COREONELMMU3"] },
  { ...fdm("prusa-xlp", "Prusa XL+", "minor", "PrusaSlicer", "prusa", [5, 5], [360, 360, 360]), prusaModels: ["XLP5T", "XLP2T", "XLP1T"] },
  fdm("qidi-q2", "QIDI Q2 + QIDI Box", "minor", "QIDI Studio", "bambu", [4, 16], [270, 270, 256]),
  fdm("qidi-plus4", "QIDI Plus4 + QIDI Box", "minor", "QIDI Studio", "bambu", [4, 16], [305, 305, 280]),
  fdm("flashforge-ad5x", "Flashforge AD5X", "minor", "Orca-Flashforge", "bambu", [4, 4], [220, 220, 220]),
  fdm("creality-k1c", "Creality K1C / K1 SE + CFS", "minor", "Creality Print", "bambu", [4, 16], [220, 220, 250]),
  fdm("orca-toolchanger", "", "minor", "OrcaSlicer", "bambu", [4, 16], [350, 350, 300]),
  fdm("prusa-generic", "", "minor", "PrusaSlicer", "prusa", [5, 16], [250, 210, 220]),
  // ---- colour printers
  colour("stratasys-j55", "Stratasys J55 / J850 (PolyJet)", "major", "GrabCAD Print", ["3mf", "obj", "wrl"], [140, 200, 190]),
  colour("mimaki-3duj", "Mimaki 3DUJ-2207 / 553", "major", "Mimaki 3D Print prep", ["obj", "wrl", "ply"], [508, 508, 508]),
  colour("hp-580", "HP Jet Fusion 580 Color", "minor", "HP SmartStream", ["3mf", "obj"], [332, 190, 248]),
  colour("3dsystems-cjp", "3D Systems ProJet CJP 660 / 860", "minor", "3D Sprint", ["wrl", "ply", "obj"], [254, 381, 203]),
  colour("colour-generic", "", "minor", "", ["3mf", "obj", "wrl", "ply"], [250, 250, 250]),
];

export const DEFAULT_PRINTER_ID = "prusa-xl5";

/** Bambu Studio's limit on filament slots, mixed filaments included (as in core/bambuProject.ts). */
export const BAMBU_STUDIO_MAX_FILAMENTS = 32;

export function findPrinter(id: string | null | undefined): Printer {
  return PRINTERS.find((printer) => printer.id === id) ?? (PRINTERS.find((printer) => printer.id === DEFAULT_PRINTER_ID) as Printer);
}

/**
 * Whether a PrusaSlicer template's printer config may go into this printer's
 * file: only for the printer it was made for (the catch-all PrusaSlicer entry
 * takes any template, since there the template is what names the printer).
 */
export function templateFitsPrinter(printer: Printer, templateModel: string | undefined): boolean {
  if (printer.kind !== "fdm" || printer.slicer !== "prusa") return false;
  if (printer.id === "prusa-generic") return true;
  return templateModel !== undefined && (printer.prusaModels?.includes(templateModel) ?? false);
}
