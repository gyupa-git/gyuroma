import { Inflate } from "fflate";
import { ZipOut } from "@core/zipOut";
import { MAX_PAINTABLE_EXTRUDER_ID, paintCodeStates, remapPaintCode, type PaintFlavour } from "@core/paintCodes";
import {
  BAMBU_MAX_SLOTS,
  BAMBU_MODEL_HEADER,
  BAMBU_PROJECT_VERSION,
  bambuPlate,
  bambuPrinterTemplate,
  buildBambuProjectSettings,
  findBambuPrinter,
  validateBambuMixedSlots,
  type BambuMixedSlot,
} from "@core/bambuProject";

/**
 * 모아 뽑기: several finished 3MF files (규로마 exports, or the same saved
 * again from the slicer) become one file with every model on one bed — for
 * PrusaSlicer, or as a Bambu Studio project.  A slicer keeps one mix table
 * per project, numbered from the first virtual extruder up, and each file
 * numbers its own — so loading the files one after another paints the later
 * models with the first file's table.  Here the tables are joined instead: a
 * mix that is the same recipe in two files (the same filaments in the same
 * layer ratios) becomes one virtual extruder (one mixed filament in Bambu
 * Studio), the real filaments are matched by colour, every painted state is
 * renumbered, and the models are set side by side, clear of the wipe tower.
 * Bambu Studio takes 32 filaments at most, mixed ones included; past that the
 * nearest mixes (by colour) are joined, and the plan says which.  The meshes
 * go through untouched, text for text.
 *
 * The files can be large (a sculpt saved from PrusaSlicer is over 100 MB of
 * model XML), so nothing holds a whole model: each file is read twice as a
 * stream of tags — once to learn what it uses and where it stands, once to
 * write it into the new file — and the new file is compressed as it is written.
 */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GatherMix {
  id: number;
  kind: string;
  color: string;
  components: Array<{ extruder: number; ratio: number }>;
}

export interface GatherItem {
  objectId: number;
  /** Row-major 4×3, as 3MF writes it. */
  transform: number[];
  /** The whole `<item …/>` tag, for its other attributes. */
  tag: string;
}

export interface GatherObject {
  id: number;
  name: string;
  faces: number;
}

/**
 * Items whose footprints touch, which move together: the shells of one model
 * (규로마 writes each shell as its own object, all at the same place) stay as
 * they are, while a piece the owner set apart in the slicer is placed on its
 * own instead of dragging the empty bed between them along.
 */
export interface GatherPart {
  /** Indices into the file's items. */
  items: number[];
  box: Box;
  maxZ: number;
  /** Top view at 1 mm: rows from the front, one byte per cell. */
  silhouette: { width: number; height: number; cells: Uint8Array };
}

/** What a Bambu Studio project holds besides the common part. */
export interface BambuSourceInfo {
  /** Key of the template printer (core/bambu/projectTemplates.json), null when it is not one of them. */
  printerKey: string | null;
  settings: Record<string, unknown>;
  modelSettings: string | null;
  /** The mesh files, zip paths, in order. */
  files: string[];
  /** Assembly objects of the main model: id → its components. */
  assemblies: Record<number, Array<{ path: string; objectId: number; transform: number[] }>>;
  /** Mesh objects per mesh file. */
  meshes: Record<string, number[]>;
  /** Filament number as painted → its number here (real filaments first, then the mixed ones). */
  renumber: Record<number, number>;
  plates: number;
  /** Some filament is set to another preset than the printer's default PLA. */
  customFilaments: boolean;
}

/** What one file holds, read without keeping its mesh. */
export interface GatherSource {
  name: string;
  size: number;
  slicer: "prusa" | "bambu";
  application: string;
  /** How its paint codes read. */
  flavour: PaintFlavour;
  /** "#RRGGBB" of each real filament, E1 first. */
  physical: string[];
  mixes: GatherMix[];
  /** Faces per painted state (0 = not painted: the object's own extruder). */
  states: Record<number, number>;
  objects: GatherObject[];
  items: GatherItem[];
  /** The highest resource id, so the next file's ids can start above it. */
  maxId: number;
  /** Extruder (state) of each object, 1 when it names none. */
  objectExtruders: Record<number, number>;
  /** Namespace declarations of its `<model>` tag (prefix → uri, "" for the default). */
  namespaces: Record<string, string>;
  footprint: Box & { maxZ: number };
  /** What moves as one on the bed (see GatherPart). */
  parts: GatherPart[];
  config: string | null;
  modelConfig: string | null;
  layerHeights: string | null;
  layerRanges: string | null;
  wipeTower: string | null;
  thumbnail: Uint8Array | null;
  /** Colour changes and pauses at a height: they cannot be kept for a shared bed. */
  customGcode: boolean;
  bed: Box | null;
  tower: { x: number; y: number; width: number; on: boolean } | null;
  layerHeight: number | null;
  printerModel: string | null;
  bambu: BambuSourceInfo | null;
}

/** Something a file cannot be read for; `key` is an i18n key under gather.err. */
export class GatherError extends Error {
  constructor(
    readonly key: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(key);
  }
}

// ---------------------------------------------------------------- zip, read

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

async function bytesOf(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/** The entries of a zip, from its central directory (sizes are there even when streamed). */
async function zipEntries(file: Blob): Promise<Map<string, ZipEntry>> {
  const tailSize = Math.min(file.size, 22 + 0xffff + 20);
  const tail = await bytesOf(file, file.size - tailSize, file.size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new GatherError("notZip");
  let count = view.getUint16(end + 10, true);
  let size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if ((offset === 0xffffffff || count === 0xffff) && end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) {
    const at = Number(view.getBigUint64(end - 12, true));
    const record = await bytesOf(file, at, at + 56);
    const rv = new DataView(record.buffer, record.byteOffset, record.byteLength);
    count = Number(rv.getBigUint64(32, true));
    size = Number(rv.getBigUint64(40, true));
    offset = Number(rv.getBigUint64(48, true));
  }
  const dir = await bytesOf(file, offset, offset + size);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let k = 0; k < count && p + 46 <= dir.length && dv.getUint32(p, true) === 0x02014b50; k++) {
    const method = dv.getUint16(p + 10, true);
    let compressedSize = dv.getUint32(p + 20, true);
    let entrySize = dv.getUint32(p + 24, true);
    const nameLength = dv.getUint16(p + 28, true);
    const extraLength = dv.getUint16(p + 30, true);
    const commentLength = dv.getUint16(p + 32, true);
    let local = dv.getUint32(p + 42, true);
    const name = decoder.decode(dir.subarray(p + 46, p + 46 + nameLength));
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = dv.getUint16(e, true);
      const length = dv.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (entrySize === 0xffffffff) (entrySize = Number(dv.getBigUint64(q, true))), (q += 8);
        if (compressedSize === 0xffffffff) (compressedSize = Number(dv.getBigUint64(q, true))), (q += 8);
        if (local === 0xffffffff) local = Number(dv.getBigUint64(q, true));
      }
      e += 4 + length;
    }
    entries.set(name, { name, method, compressedSize, size: entrySize, offset: local });
    p = extraEnd + commentLength;
  }
  return entries;
}

const READ_STEP = 4 << 20;

/**
 * Streams one entry's bytes to `onChunk` (uncompressed).  `onChunk` returning
 * true stops the reading; `onRead` hears how many compressed bytes went by.
 */
async function readEntry(file: Blob, entry: ZipEntry, onChunk: (bytes: Uint8Array, last: boolean) => boolean | void, onRead?: (bytes: number) => void): Promise<void> {
  const head = await bytesOf(file, entry.offset, entry.offset + 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (hv.getUint32(0, true) !== 0x04034b50) throw new GatherError("broken");
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (entry.method !== 0 && entry.method !== 8) throw new GatherError("broken");
  let stopped = false;
  const inflate =
    entry.method === 8
      ? new Inflate((chunk, final) => {
          if (!stopped && onChunk(chunk, final)) stopped = true;
        })
      : null;
  if (start === end) {
    if (inflate) inflate.push(new Uint8Array(0), true);
    else onChunk(new Uint8Array(0), true);
    return;
  }
  for (let at = start; at < end && !stopped; at += READ_STEP) {
    const stop = Math.min(end, at + READ_STEP);
    const bytes = await bytesOf(file, at, stop);
    if (inflate) inflate.push(bytes, stop === end);
    else if (onChunk(bytes, stop === end)) stopped = true;
    onRead?.(stop - at);
  }
}

async function entryBytes(file: Blob, entry: ZipEntry | undefined): Promise<Uint8Array | null> {
  if (!entry) return null;
  const parts: Uint8Array[] = [];
  await readEntry(file, entry, (chunk) => void parts.push(chunk.slice()));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) (out.set(part, at), (at += part.length));
  return out;
}

async function entryText(file: Blob, entry: ZipEntry | undefined): Promise<string | null> {
  const bytes = await entryBytes(file, entry);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

const MODEL_PATH = "3D/3dmodel.model";
const BAMBU_SETTINGS_PATH = "Metadata/project_settings.config";

/**
 * Feeds text in pieces and calls `onTag` for every `<…>` (it may return true
 * to stop).  The text between two tags is handed over only when the last call
 * set `wantText`, so the vertices and triangles are not sliced twice.
 */
class TagReader {
  private carry = "";
  private decoder = new TextDecoder();
  stopped = false;
  wantText = false;
  constructor(private readonly onTag: (tag: string, text: string) => boolean | void) {}
  push(bytes: Uint8Array, last: boolean): boolean {
    if (this.stopped) return true;
    const s = this.carry + this.decoder.decode(bytes, { stream: !last });
    let at = 0;
    for (;;) {
      const open = s.indexOf("<", at);
      if (open < 0) break;
      const close = s.indexOf(">", open);
      if (close < 0) break;
      const text = this.wantText ? s.slice(at, open) : "";
      this.wantText = false;
      if (this.onTag(s.slice(open, close + 1), text)) {
        this.stopped = true;
        return true;
      }
      at = close + 1;
    }
    this.carry = s.slice(at);
    return false;
  }
}

/** Value of `name="…"` in a tag (the name preceded by a space), or null. */
export function attr(tag: string, name: string): string | null {
  const key = ` ${name}="`;
  const at = tag.indexOf(key);
  if (at < 0) return null;
  const from = at + key.length;
  const to = tag.indexOf('"', from);
  return to < 0 ? null : tag.slice(from, to);
}

function setAttr(tag: string, name: string, value: string): string {
  const key = ` ${name}="`;
  const at = tag.indexOf(key);
  if (at < 0) {
    const end = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
    return `${tag.slice(0, end)}${key}${value}"${tag.slice(end)}`;
  }
  const from = at + key.length;
  const to = tag.indexOf('"', from);
  return tag.slice(0, from) + value + tag.slice(to);
}

function removeAttr(tag: string, name: string): string {
  const key = ` ${name}="`;
  const at = tag.indexOf(key);
  if (at < 0) return tag;
  const to = tag.indexOf('"', at + key.length);
  return tag.slice(0, at) + tag.slice(to + 1);
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function parseTransform(text: string | null): number[] {
  if (!text) return IDENTITY.slice();
  const values = text.trim().split(/\s+/).map(Number);
  return values.length === 12 && values.every(Number.isFinite) ? values : IDENTITY.slice();
}

/** a then b (points are row vectors, as 3MF multiplies them). */
function compose(a: number[], b: number[]): number[] {
  const out = new Array<number>(12);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c] + (r === 3 ? b[9 + c] : 0);
  return out;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
}

class Floats {
  data = new Float32Array(3 * 1024);
  length = 0;
  push(x: number, y: number, z: number) {
    if (this.length + 3 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = x;
    this.data[this.length++] = y;
    this.data[this.length++] = z;
  }
}

function configValue(config: string | null, key: string): string | null {
  if (!config) return null;
  const match = new RegExp(`^;?\\s*${key}\\s*=\\s*(.*)$`, "m").exec(config);
  return match ? match[1].trim() : null;
}

function bedFromShape(shape: string | null): Box | null {
  if (!shape) return null;
  const points = shape.split(",").map((p) => p.split("x").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (points.length < 3) return null;
  return {
    minX: Math.min(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxX: Math.max(...points.map((p) => p[0])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

const HEX = /^#[0-9A-F]{6}$/;

function normalHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toUpperCase();
  if (HEX.test(hex)) return hex;
  return /^#[0-9A-F]{8}$/.test(hex) ? hex.slice(0, 7) : null;
}

// ---------------------------------------------------------------- one model file, as tags

interface ScannedObject {
  id: number;
  name: string;
  faces: number;
  floats: Floats | null;
  /** `path` null = an object of the same file. */
  components: Array<{ path: string | null; objectId: number; transform: number[] }>;
}

interface ScannedModel {
  application: string;
  version: number;
  namespaces: Record<string, string>;
  objects: Map<number, ScannedObject>;
  items: GatherItem[];
  /** Paint code → faces. */
  codes: Map<string, number>;
  unpainted: number;
  maxId: number;
}

/** Reads one model file of the package: its objects (vertices kept), components, items and paint. */
async function scanModel(file: Blob, entry: ZipEntry, paint: "prusa" | "bambu", onRead?: (bytes: number) => void): Promise<ScannedModel> {
  const model: ScannedModel = { application: "", version: 1, namespaces: {}, objects: new Map(), items: [], codes: new Map(), unpainted: 0, maxId: 0 };
  let meta: string | null = null;
  let current: ScannedObject | null = null;
  let resources = false;
  const first = paint === "prusa" ? "slic3rpe:mmu_segmentation" : "paint_color";
  const second = paint === "prusa" ? "paint_color" : "slic3rpe:mmu_segmentation";
  const reader = new TagReader((tag, text) => {
    if (meta !== null) {
      if (meta === "Application") model.application = text.trim();
      if (meta === "slic3rpe:MmPaintingVersion") model.version = Number(text.trim()) || 1;
      meta = null;
    }
    const c1 = tag.charCodeAt(1);
    if (c1 === 118 /* v */ && current?.floats && tag.startsWith("<vertex")) {
      current.floats.push(Number(attr(tag, "x")), Number(attr(tag, "y")), Number(attr(tag, "z")));
      return;
    }
    if (c1 === 116 /* t */ && current && tag.startsWith("<triangle ")) {
      current.faces++;
      const code = attr(tag, first) ?? attr(tag, second);
      if (code) model.codes.set(code, (model.codes.get(code) ?? 0) + 1);
      else model.unpainted++;
      return;
    }
    if (c1 === 47 /* / */) {
      if (tag.startsWith("</object")) current = null;
      else if (tag.startsWith("</resources")) resources = false;
      return;
    }
    if (tag.startsWith("<model")) {
      for (const match of tag.matchAll(/\sxmlns(?::([\w.-]+))?="([^"]*)"/g)) model.namespaces[match[1] ?? ""] = match[2];
      return;
    }
    if (tag.startsWith("<metadata") && !resources && !tag.endsWith("/>")) {
      meta = attr(tag, "name");
      reader.wantText = true;
      return;
    }
    if (tag.startsWith("<resources")) {
      resources = true;
      return;
    }
    if (resources) {
      const id = attr(tag, "id");
      if (id !== null && current === null) model.maxId = Math.max(model.maxId, Number(id) || 0);
      if (tag.startsWith("<object")) {
        const object: ScannedObject = { id: Number(id), name: attr(tag, "name") ?? "", faces: 0, floats: null, components: [] };
        model.objects.set(object.id, object);
        current = tag.endsWith("/>") ? null : object;
        return;
      }
      if (current && tag.startsWith("<mesh")) {
        current.floats = new Floats();
        return;
      }
      if (current && tag.startsWith("<component ")) {
        const path = attr(tag, "p:path");
        current.components.push({ path: path ? path.replace(/^\//, "") : null, objectId: Number(attr(tag, "objectid")), transform: parseTransform(attr(tag, "transform")) });
      }
      return;
    }
    if (tag.startsWith("<item")) model.items.push({ objectId: Number(attr(tag, "objectid")), transform: parseTransform(attr(tag, "transform")), tag });
  });
  await readEntry(file, entry, (chunk, last) => reader.push(chunk, last), onRead);
  return model;
}

/** Faces per state, the codes read as `flavour`, the states renumbered by `renumber` (when given). */
function tallyStates(models: ScannedModel[], flavour: PaintFlavour, renumber?: Record<number, number>): Record<number, number> {
  const states: Record<number, number> = {};
  for (const model of models) {
    if (model.unpainted > 0) states[0] = (states[0] ?? 0) + model.unpainted;
    for (const [code, count] of model.codes) {
      const found = paintCodeStates(code, flavour);
      if (!found) throw new GatherError("badPaint", { code });
      for (const raw of new Set(found)) {
        const state = raw === 0 || !renumber ? raw : (renumber[raw] ?? raw);
        states[state] = (states[state] ?? 0) + count;
      }
    }
  }
  return states;
}

/**
 * Where everything stands: each item's points through its components onto
 * the bed, items that touch grouped into parts, and their top views.
 */
function layOut(items: GatherItem[], resolve: (item: GatherItem) => Array<{ floats: Floats; m: number[] }>): { parts: GatherPart[]; footprint: Box & { maxZ: number } } {
  const eachPoint = (placed: Array<{ floats: Floats; m: number[] }>, visit: (x: number, y: number, z: number) => void) => {
    for (const { floats, m } of placed) {
      const d = floats.data;
      for (let i = 0; i < floats.length; i += 3)
        visit(
          d[i] * m[0] + d[i + 1] * m[3] + d[i + 2] * m[6] + m[9],
          d[i] * m[1] + d[i + 1] * m[4] + d[i + 2] * m[7] + m[10],
          d[i] * m[2] + d[i + 1] * m[5] + d[i + 2] * m[8] + m[11],
        );
    }
  };
  const itemPoints = items.map(resolve);
  const itemBoxes = itemPoints.map((placed) => {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    eachPoint(placed, (x, y, z) => {
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
      if (z > box.maxZ) box.maxZ = z;
    });
    return box;
  });
  const filled = itemBoxes.map((box, i) => (Number.isFinite(box.minX) ? i : -1)).filter((i) => i >= 0);
  if (filled.length === 0) throw new GatherError("noModel");
  // Items whose boxes touch (within 1 mm) go together.
  const group = items.map((_item, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])));
  for (const a of filled) for (const b of filled) if (a < b && overlap(itemBoxes[a], itemBoxes[b], 1)) group[root(a)] = root(b);
  const byRoot = new Map<number, number[]>();
  for (const i of filled) byRoot.set(root(i), [...(byRoot.get(root(i)) ?? []), i]);
  const parts: GatherPart[] = [...byRoot.values()].map((members) => {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    let maxZ = -Infinity;
    for (const i of members) {
      const b = itemBoxes[i];
      box.minX = Math.min(box.minX, b.minX);
      box.minY = Math.min(box.minY, b.minY);
      box.maxX = Math.max(box.maxX, b.maxX);
      box.maxY = Math.max(box.maxY, b.maxY);
      maxZ = Math.max(maxZ, b.maxZ);
    }
    const width = Math.max(1, Math.min(1000, Math.ceil(box.maxX - box.minX) + 1));
    const height = Math.max(1, Math.min(1000, Math.ceil(box.maxY - box.minY) + 1));
    const cells = new Uint8Array(width * height);
    for (const i of members)
      eachPoint(itemPoints[i], (x, y) => {
        const cx = Math.min(width - 1, Math.max(0, Math.floor(x - box.minX)));
        const cy = Math.min(height - 1, Math.max(0, Math.floor(y - box.minY)));
        cells[cy * width + cx] = 1;
      });
    return { items: members, box, maxZ, silhouette: { width, height, cells } };
  });
  const footprint = {
    minX: Math.min(...parts.map((p) => p.box.minX)),
    minY: Math.min(...parts.map((p) => p.box.minY)),
    maxX: Math.max(...parts.map((p) => p.box.maxX)),
    maxY: Math.max(...parts.map((p) => p.box.maxY)),
    maxZ: Math.max(...parts.map((p) => p.maxZ)),
  };
  return { parts, footprint };
}

/** The points of an item, following components (also into other files of the package). */
function resolver(models: Map<string, ScannedModel>, rootPath: string) {
  return (item: GatherItem) => {
    const placed: Array<{ floats: Floats; m: number[] }> = [];
    const collect = (path: string, objectId: number, m: number[], depth: number) => {
      if (depth > 8) return;
      const object = models.get(path)?.objects.get(objectId);
      if (!object) return;
      if (object.floats) placed.push({ floats: object.floats, m });
      for (const component of object.components) collect(component.path ?? path, component.objectId, compose(component.transform, m), depth + 1);
    };
    collect(rootPath, item.objectId, item.transform, 0);
    return placed;
  };
}

/**
 * Reads what a file holds.  `onRead` hears the compressed bytes of its models
 * as they go by (for a progress bar).
 */
export async function readGatherSource(file: Blob, name: string, onRead?: (bytes: number) => void): Promise<GatherSource> {
  const entries = await zipEntries(file);
  if (!entries.get(MODEL_PATH)) throw new GatherError("noModel");
  return entries.has(BAMBU_SETTINGS_PATH) ? readBambuSource(file, name, entries, onRead) : readPrusaSource(file, name, entries, onRead);
}

async function readPrusaSource(file: Blob, name: string, entries: Map<string, ZipEntry>, onRead?: (bytes: number) => void): Promise<GatherSource> {
  const config = await entryText(file, entries.get("Metadata/Slic3r_PE.config"));
  const spectrumText = await entryText(file, entries.get("Metadata/Prusa_Slicer_full_spectrum.json"));
  let physical: string[] = [];
  let mixes: GatherMix[] = [];
  if (spectrumText) {
    try {
      const spectrum = JSON.parse(spectrumText) as {
        physical_extruders?: Array<{ id: number; color: string }>;
        virtual_extruders?: Array<{ id: number; kind?: string; color?: string; components?: Array<{ extruder: number; ratio: number }> }>;
      };
      physical = (spectrum.physical_extruders ?? [])
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((entry) => normalHex(entry.color) ?? "#FFFFFF");
      mixes = (spectrum.virtual_extruders ?? []).map((entry) => ({
        id: Number(entry.id),
        kind: entry.kind ?? "fullspectrum",
        color: normalHex(entry.color) ?? "#808080",
        components: (entry.components ?? []).map((c) => ({ extruder: Number(c.extruder), ratio: Number(c.ratio) })),
      }));
    } catch {
      throw new GatherError("broken");
    }
  }
  if (physical.length === 0) {
    const colours = configValue(config, "extruder_colour");
    physical = colours ? colours.split(";").map((c) => normalHex(c.replaceAll('"', "")) ?? "#FFFFFF") : [];
  }
  if (physical.length === 0) throw new GatherError("noFilaments");

  const modelConfig = await entryText(file, entries.get("Metadata/Slic3r_PE_model.config"));
  const objectExtruders: Record<number, number> = {};
  if (modelConfig) {
    for (const block of modelConfig.matchAll(/<object\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
      const extruder = /<metadata type="object" key="extruder" value="(\d+)"/.exec(block[2]);
      objectExtruders[Number(block[1])] = Math.max(1, Number(extruder?.[1] ?? 1));
    }
  }

  const model = await scanModel(file, entries.get(MODEL_PATH) as ZipEntry, "prusa", onRead);
  if ([...model.objects.values()].some((object) => object.components.some((component) => component.path !== null))) throw new GatherError("broken");
  if (model.items.length === 0) throw new GatherError("noModel");
  const flavour: PaintFlavour = model.version >= 2 ? "prusa" : "prusa1";
  const states = tallyStates([model], flavour);
  const mixIds = new Set(mixes.map((mix) => mix.id));
  for (const state of Object.keys(states).map(Number)) {
    if (state > physical.length && !mixIds.has(state)) throw new GatherError("missingMix", { state });
  }
  const { parts, footprint } = layOut(model.items, resolver(new Map([[MODEL_PATH, model]]), MODEL_PATH));

  const towerText = await entryText(file, entries.get("Metadata/Prusa_Slicer_wipe_tower_information.xml"));
  const towerX = Number((towerText && /position_x="([-\d.]+)"/.exec(towerText)?.[1]) ?? configValue(config, "wipe_tower_x"));
  const towerY = Number((towerText && /position_y="([-\d.]+)"/.exec(towerText)?.[1]) ?? configValue(config, "wipe_tower_y"));
  const customText = await entryText(file, entries.get("Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml"));
  return {
    name,
    size: file.size,
    slicer: "prusa",
    application: model.application,
    flavour,
    physical,
    mixes,
    states,
    objects: [...model.objects.values()].map((object) => ({ id: object.id, name: object.name, faces: object.faces })),
    items: model.items,
    maxId: model.maxId,
    objectExtruders,
    namespaces: model.namespaces,
    footprint,
    parts,
    config,
    modelConfig,
    layerHeights: await entryText(file, entries.get("Metadata/Slic3r_PE_layer_heights_profile.txt")),
    layerRanges: await entryText(file, entries.get("Metadata/Prusa_Slicer_layer_config_ranges.xml")),
    wipeTower: towerText,
    thumbnail: await entryBytes(file, entries.get("Metadata/thumbnail.png")),
    customGcode: Boolean(customText && /<code\b/.test(customText)),
    bed: bedFromShape(configValue(config, "bed_shape")),
    tower:
      Number.isFinite(towerX) && Number.isFinite(towerY)
        ? { x: towerX, y: towerY, width: Number(configValue(config, "wipe_tower_width")) || 60, on: configValue(config, "wipe_tower") !== "0" }
        : null,
    layerHeight: Number(configValue(config, "layer_height")) || null,
    printerModel: configValue(config, "printer_model"),
    bambu: null,
  };
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

async function readBambuSource(file: Blob, name: string, entries: Map<string, ZipEntry>, onRead?: (bytes: number) => void): Promise<GatherSource> {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse((await entryText(file, entries.get(BAMBU_SETTINGS_PATH))) ?? "") as Record<string, unknown>;
  } catch {
    throw new GatherError("broken");
  }
  // Real filaments first, then the mixed ones, each kept in its order.
  const colours = list(settings.filament_colour).map((c) => normalHex(c) ?? "#FFFFFF");
  const mixedFlag = list(settings.filament_is_mixed);
  const componentsText = list(settings.filament_mixed_components);
  const ratiosText = list(settings.filament_mixed_sublayer_ratios);
  const renumber: Record<number, number> = {};
  const physical: string[] = [];
  colours.forEach((colour, i) => {
    if (mixedFlag[i] !== "1") {
      physical.push(colour);
      renumber[i + 1] = physical.length;
    }
  });
  if (physical.length === 0) throw new GatherError("noFilaments");
  const mixes: GatherMix[] = [];
  colours.forEach((colour, i) => {
    if (mixedFlag[i] !== "1") return;
    const id = physical.length + mixes.length + 1;
    renumber[i + 1] = id;
    const raw = (componentsText[i] ?? "").split(",").map(Number).filter((n) => n > 0);
    const ratios = (ratiosText[i] ?? "").split(",").map(Number);
    mixes.push({
      id,
      kind: "mixed",
      color: colour,
      components: raw.map((extruder, k) => ({ extruder: renumber[extruder] ?? extruder, ratio: Number.isFinite(ratios[k]) && ratios[k] > 0 ? ratios[k] : 1 / raw.length })),
    });
  });

  const main = await scanModel(file, entries.get(MODEL_PATH) as ZipEntry, "bambu", onRead);
  if (main.items.length === 0) throw new GatherError("noModel");
  const models = new Map<string, ScannedModel>([[MODEL_PATH, main]]);
  const files: string[] = [];
  const assemblies: BambuSourceInfo["assemblies"] = {};
  for (const object of main.objects.values()) {
    if (object.floats) throw new GatherError("broken");
    assemblies[object.id] = object.components.map((component) => {
      if (component.path === null) throw new GatherError("broken");
      if (!files.includes(component.path)) files.push(component.path);
      return { path: component.path, objectId: component.objectId, transform: component.transform };
    });
  }
  const meshes: Record<string, number[]> = {};
  for (const path of files) {
    const entry = entries.get(path);
    if (!entry) throw new GatherError("broken");
    const scanned = await scanModel(file, entry, "bambu", onRead);
    models.set(path, scanned);
    meshes[path] = [...scanned.objects.keys()];
  }
  const states = tallyStates([...models.values()], "bambu", renumber);
  for (const state of Object.keys(states).map(Number)) {
    if (state > physical.length + mixes.length) throw new GatherError("missingMix", { state });
  }
  const { parts, footprint } = layOut(main.items, resolver(models, MODEL_PATH));

  const modelSettings = await entryText(file, entries.get("Metadata/model_settings.config"));
  const objectExtruders: Record<number, number> = {};
  const names: Record<number, string> = {};
  for (const block of (modelSettings ?? "").matchAll(/<object\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    const extruder = /<metadata key="extruder" value="(\d+)"/.exec(block[2]);
    const raw = Math.max(1, Number(extruder?.[1] ?? 1));
    objectExtruders[Number(block[1])] = renumber[raw] ?? raw;
    names[Number(block[1])] = /<metadata key="name" value="([^"]*)"/.exec(block[2])?.[1] ?? "";
  }
  const printerKey = findBambuPrinter(settings);
  const defaultFilament = printerKey ? bambuPrinterTemplate(printerKey).filament : null;
  const filamentPresets = list(settings.filament_settings_id);
  return {
    name,
    size: file.size,
    slicer: "bambu",
    application: main.application,
    flavour: "bambu",
    physical,
    mixes,
    states,
    objects: [...main.objects.values()].map((object) => ({
      id: object.id,
      name: names[object.id] ?? object.name,
      faces: object.components.reduce((sum, component) => sum + (models.get(component.path ?? "")?.objects.get(component.objectId)?.faces ?? 0), 0),
    })),
    items: main.items,
    maxId: main.maxId,
    objectExtruders,
    namespaces: main.namespaces,
    footprint,
    parts,
    config: null,
    modelConfig: null,
    layerHeights: null,
    layerRanges: null,
    wipeTower: null,
    thumbnail: await entryBytes(file, entries.get("Metadata/plate_1.png")),
    customGcode: false,
    bed: null,
    tower: null,
    layerHeight: Number(settings.layer_height) || null,
    printerModel: typeof settings.printer_model === "string" ? settings.printer_model : null,
    bambu: {
      printerKey,
      settings,
      modelSettings,
      files,
      assemblies,
      meshes,
      renumber,
      plates: (modelSettings?.match(/<plate>/g) ?? []).length,
      customFilaments: Boolean(defaultFilament && filamentPresets.some((preset, i) => mixedFlag[i] !== "1" && preset !== defaultFilament)),
    },
  };
}

// ---------------------------------------------------------------- the plan

export type GatherWarning =
  | { key: "layerHeight"; heights: string }
  | { key: "printer"; models: string }
  | { key: "customGcode"; files: string }
  | { key: "offBed"; files: string }
  | { key: "noConfig" }
  | { key: "plates"; files: string }
  | { key: "bambuFilaments" }
  | { key: "bambuPrinter"; model: string };

/** Where one part goes: moved by dx, dy; `box` is where it lands. */
export interface GatherPlace {
  dx: number;
  dy: number;
  box: Box;
  offBed: boolean;
}

export interface GatherPlan {
  /** What the new file is for: the first file's slicer. */
  slicer: "prusa" | "bambu";
  /** Sources that go in, the first one setting the printer and print settings. */
  used: number[];
  /** Sources left out: their filaments do not fit the slots that are left, or they are for the other slicer. */
  left: Array<{ source: number; colours: string[]; reason: "filaments" | "slicer" }>;
  /** Filaments taken as the same one under another colour code (the owner said so). */
  taken: Array<{ source: number; colour: string; slot: number }>;
  /** Real filaments of the new file, E1 first. */
  slots: string[];
  /** Slots whose filament differs from the first file's (it has to be loaded there). */
  slotChanges: Array<{ slot: number; before: string; after: string }>;
  /** Per source (by index): its slot → the new slot. */
  slotMaps: Array<number[] | null>;
  /** Per source: painted state → new state. */
  stateMaps: Array<Record<number, number> | null>;
  mixes: GatherMix[];
  /** The mixes the files have between them, before the shared ones are joined. */
  mixesBefore: number;
  /** Mixes joined into the nearest one because the slicer cannot take them all (Bambu Studio: 32 filaments). */
  joined: Array<{ from: string; to: string; distance: number; faces: number }>;
  /** Most filaments the slicer takes, mixed ones included. */
  limit: number;
  /** Faces painted with each new state, all files together. */
  faces: Record<number, number>;
  /** Per source, per part (as in source.parts). */
  places: Array<GatherPlace[] | null>;
  /** Per source: the id its objects move up by. */
  idOffsets: Array<number | null>;
  bed: Box;
  tower: Box | null;
  /** Corners of the bed nothing may go on (Bambu X1/P1 front left). */
  excluded: Box[];
  warnings: GatherWarning[];
  /** True when the slicer cannot hold even the real filaments. */
  tooMany: boolean;
}

const GAP = 8;
const MARGIN = 4;
/** What the tower is assumed to take in depth (PrusaSlicer sizes it when slicing). */
const TOWER_DEPTH = 60;
const FALLBACK_BED: Box = { minX: 0, minY: 0, maxX: 250, maxY: 210 };

/** The slots a file paints with: painted directly, inside a mix it uses, or as an object's own extruder. */
export function slotsUsed(source: GatherSource): number[] {
  const used = new Set<number>();
  const mixById = new Map(source.mixes.map((mix) => [mix.id, mix]));
  const add = (state: number) => {
    if (state <= source.physical.length) used.add(state);
    else for (const component of mixById.get(state)?.components ?? []) used.add(component.extruder);
  };
  for (const key of Object.keys(source.states)) {
    const state = Number(key);
    if (state === 0) {
      for (const object of source.objects) if (object.faces > 0) add(source.objectExtruders[object.id] ?? 1);
    } else add(state);
  }
  return [...used].filter((slot) => slot >= 1 && slot <= source.physical.length).sort((a, b) => a - b);
}

/** The mixes a file paints with. */
export function mixesUsed(source: GatherSource): GatherMix[] {
  return source.mixes.filter((mix) => (source.states[mix.id] ?? 0) > 0);
}

function recipeKey(mix: GatherMix, slotMap: number[]): string {
  return (
    mix.kind +
    "|" +
    mix.components
      .map((c) => ({ extruder: slotMap[c.extruder] ?? c.extruder, ratio: c.ratio }))
      .sort((a, b) => a.extruder - b.extruder)
      .map((c) => `${c.extruder}:${c.ratio.toFixed(4)}`)
      .join(",")
  );
}

function overlap(a: Box, b: Box, gap: number): boolean {
  return a.minX < b.maxX + gap && a.maxX + gap > b.minX && a.minY < b.maxY + gap && a.maxY + gap > b.minY;
}

function rgbOf(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** How far apart two colours look (CIE76 in Lab — enough to find the nearest slot or mix). */
export function colourDistance(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, b2] = rgbOf(hex).map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((r * 0.4124 + g * 0.3576 + b2 * 0.1805) / 0.95047);
    const y = f(r * 0.2126 + g * 0.7152 + b2 * 0.0722);
    const z = f((r * 0.0193 + g * 0.1192 + b2 * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export interface GatherOptions {
  /**
   * Sources whose filaments that match no slot by colour are the same spools
   * under another colour code (the owner said so): each goes to the slot of
   * the nearest colour instead of a free slot.
   */
  same?: number[];
}

/**
 * Which files go in, the shared slots and mixes, and where every model goes.
 * `order` lists the sources in the order the owner put them (the first sets
 * the slicer, printer and print settings); files whose filaments no longer
 * fit, or that are for the other slicer, are left out.
 */
export function planGather(sources: GatherSource[], order: number[] = sources.map((_s, i) => i), options: GatherOptions = {}): GatherPlan {
  const base = sources[order[0]];
  const slicer = base?.slicer ?? "prusa";
  const slots = base ? base.physical.slice() : [];
  const taken = new Set<number>();
  const used: number[] = [];
  const left: GatherPlan["left"] = [];
  const same: GatherPlan["taken"] = [];
  const sameSet = new Set(options.same ?? []);
  const slotMaps: Array<number[] | null> = sources.map(() => null);
  for (const index of order) {
    const source = sources[index];
    if (source.slicer !== slicer) {
      left.push({ source: index, colours: [], reason: "slicer" });
      continue;
    }
    const map: number[] = [];
    const claimed = new Map<number, string>();
    let fits = true;
    const missing: string[] = [];
    const snapped: GatherPlan["taken"] = [];
    const sourceSlots = slotsUsed(source);
    for (const slot of sourceSlots) {
      const colour = source.physical[slot - 1];
      const same = (j: number) => (claimed.get(j) ?? slots[j - 1]) === colour;
      let to = 0;
      if (slot <= slots.length && same(slot)) to = slot;
      else for (let j = 1; j <= slots.length && !to; j++) if (same(j)) to = j;
      if (!to && sameSet.has(index)) {
        // The nearest slot that none of its other filaments went to.
        let best = Infinity;
        for (let j = 1; j <= slots.length; j++) {
          if (sourceSlots.some((other) => other !== slot && map[other] === j)) continue;
          const distance = colourDistance(claimed.get(j) ?? slots[j - 1], colour);
          if (distance < best) (best = distance), (to = j);
        }
        if (to) snapped.push({ source: index, colour, slot: to });
      }
      if (!to) {
        const free = (j: number) => !taken.has(j) && !claimed.has(j);
        if (slot <= slots.length && free(slot)) to = slot;
        else for (let j = 1; j <= slots.length && !to; j++) if (free(j)) to = j;
        if (to) claimed.set(to, colour);
      }
      if (!to) {
        fits = false;
        missing.push(colour);
      }
      map[slot] = to;
    }
    if (!fits) {
      left.push({ source: index, colours: missing, reason: "filaments" });
      continue;
    }
    for (const [slot, colour] of claimed) slots[slot - 1] = colour;
    for (const slot of sourceSlots) taken.add(map[slot]);
    same.push(...snapped);
    // Slots it does not paint with keep their number (nothing refers to them).
    for (let slot = 1; slot <= source.physical.length; slot++) if (!map[slot]) map[slot] = Math.min(slot, slots.length);
    slotMaps[index] = map;
    used.push(index);
  }

  // Mixes: one per recipe, numbered after the real filaments.
  let mixes: GatherMix[] = [];
  const byRecipe = new Map<string, GatherMix>();
  const stateMaps: Array<Record<number, number> | null> = sources.map(() => null);
  let mixesBefore = 0;
  for (const index of used) {
    const source = sources[index];
    const map = slotMaps[index] as number[];
    const states: Record<number, number> = { 0: 0 };
    for (let slot = 1; slot <= source.physical.length; slot++) states[slot] = map[slot];
    for (const mix of mixesUsed(source)) {
      mixesBefore++;
      const key = recipeKey(mix, map);
      let joined = byRecipe.get(key);
      if (!joined) {
        joined = { id: slots.length + mixes.length + 1, kind: mix.kind, color: mix.color, components: mix.components.map((c) => ({ extruder: map[c.extruder] ?? c.extruder, ratio: c.ratio })) };
        mixes.push(joined);
        byRecipe.set(key, joined);
      }
      states[mix.id] = joined.id;
    }
    stateMaps[index] = states;
  }
  const facesNow = () => {
    const faces: Record<number, number> = {};
    for (const index of used) {
      const states = stateMaps[index] as Record<number, number>;
      for (const [state, count] of Object.entries(sources[index].states)) {
        const to = states[Number(state)] ?? 0;
        faces[to] = (faces[to] ?? 0) + count;
      }
    }
    return faces;
  };

  // Past the slicer's limit, the nearest mixes (by colour) become one; the one with fewer faces gives way.
  const limit = slicer === "bambu" ? BAMBU_MAX_SLOTS : MAX_PAINTABLE_EXTRUDER_ID;
  const joined: GatherPlan["joined"] = [];
  const P = slots.length;
  if (P + mixes.length > limit && mixes.length > 1) {
    const weight = mixes.map((mix) => facesNow()[mix.id] ?? 0);
    const into = mixes.map((_mix, i) => i);
    const find = (i: number): number => (into[i] === i ? i : (into[i] = find(into[i])));
    let alive = mixes.length;
    while (P + alive > limit && alive > 1) {
      let best = Infinity;
      let a = -1;
      let b = -1;
      for (let i = 0; i < mixes.length; i++) {
        if (find(i) !== i) continue;
        for (let j = i + 1; j < mixes.length; j++) {
          if (find(j) !== j) continue;
          const distance = colourDistance(mixes[i].color, mixes[j].color);
          if (distance < best) (best = distance), (a = i), (b = j);
        }
      }
      const keep = weight[a] >= weight[b] ? a : b;
      const drop = keep === a ? b : a;
      joined.push({ from: mixes[drop].color, to: mixes[keep].color, distance: best, faces: weight[drop] });
      into[drop] = keep;
      weight[keep] += weight[drop];
      alive--;
    }
    const roots = mixes.map((_mix, i) => i).filter((i) => find(i) === i);
    const idOfRoot = new Map(roots.map((i, k) => [i, P + k + 1]));
    const newId = new Map(mixes.map((mix, i) => [mix.id, idOfRoot.get(find(i)) as number]));
    // Every join pointed the faces at a root; the colours it ends in are those roots'.
    for (const entry of joined) entry.to = mixes[find(mixes.findIndex((mix) => mix.color === entry.to))].color;
    for (const states of stateMaps) {
      if (!states) continue;
      for (const key of Object.keys(states)) {
        const value = states[Number(key)];
        if (value > P) states[Number(key)] = newId.get(value) as number;
      }
    }
    mixes = roots.map((i, k) => ({ ...mixes[i], id: P + k + 1 }));
  }
  const faces = facesNow();

  // Ids: each file's resources move up past the ones before it.
  const idOffsets: Array<number | null> = sources.map(() => null);
  let nextId = 0;
  for (const index of used) {
    idOffsets[index] = nextId;
    nextId += sources[index].maxId;
  }

  // The bed: the slicer file's own for PrusaSlicer, the printer's for Bambu Studio.
  let bed = base?.bed ?? FALLBACK_BED;
  let tower: Box | null = null;
  const excluded: Box[] = [];
  const bambuKey = base?.bambu?.printerKey ?? null;
  if (slicer === "bambu" && bambuKey) {
    const plate = bambuPlate(bambuKey, P);
    bed = plate.reach;
    if (plate.excluded) excluded.push(plate.excluded);
    if (P > 1) tower = plate.tower;
  } else if (slicer === "prusa") {
    const towerSource = base?.tower;
    if (towerSource && towerSource.on && P > 1) {
      const y = Math.min(towerSource.y, bed.maxY - TOWER_DEPTH);
      tower = { minX: towerSource.x - 4, minY: y - 4, maxX: towerSource.x + towerSource.width + 4, maxY: y + TOWER_DEPTH + 4 };
    }
  }

  // Places: the biggest first.  Each as near the middle of the bed as it goes
  // looks best, but a big model in the middle can leave only strips around it,
  // so filling from each corner is tried as well, and the way that leaves the
  // fewest pieces off the bed wins (the middle on a tie); a corner fill is
  // then moved toward the middle as far as it goes.
  const blocked: Box[] = [...(tower ? [tower] : []), ...excluded];
  const midX = (bed.minX + bed.maxX) / 2;
  const midY = (bed.minY + bed.maxY) / 2;
  const area = (box: Box) => (box.maxX - box.minX) * (box.maxY - box.minY);
  const pieces = used.flatMap((index) => sources[index].parts.map((part, k) => ({ index, k, f: part.box })));
  pieces.sort((a, b) => area(b.f) - area(a.f));
  const inside = (box: Box) =>
    box.minX >= bed.minX + MARGIN - 1e-9 && box.maxX <= bed.maxX - MARGIN + 1e-9 && box.minY >= bed.minY + MARGIN - 1e-9 && box.maxY <= bed.maxY - MARGIN + 1e-9;
  const fill = (score: (box: Box) => number) => {
    const boxes: Array<Box | null> = [];
    const busy = blocked.slice();
    for (const { f } of pieces) {
      const w = f.maxX - f.minX;
      const h = f.maxY - f.minY;
      let best: Box | null = null;
      let bestScore = Infinity;
      for (let x = bed.minX + MARGIN; x + w <= bed.maxX - MARGIN + 1e-9; x += 2) {
        for (let y = bed.minY + MARGIN; y + h <= bed.maxY - MARGIN + 1e-9; y += 2) {
          const box = { minX: x, minY: y, maxX: x + w, maxY: y + h };
          const value = score(box);
          if (value >= bestScore || busy.some((other) => overlap(box, other, GAP))) continue;
          best = box;
          bestScore = value;
        }
      }
      boxes.push(best);
      if (best) busy.push(best);
    }
    return boxes;
  };
  const toMiddle = (boxes: Array<Box | null>) => {
    const placed = boxes.filter((box): box is Box => box !== null);
    if (placed.length === 0) return boxes;
    const ux = (Math.min(...placed.map((b) => b.minX)) + Math.max(...placed.map((b) => b.maxX))) / 2;
    const uy = (Math.min(...placed.map((b) => b.minY)) + Math.max(...placed.map((b) => b.maxY))) / 2;
    for (const t of [1, 0.75, 0.5, 0.25]) {
      const dx = Math.round((midX - ux) * t);
      const dy = Math.round((midY - uy) * t);
      const moved = boxes.map((box) => box && { minX: box.minX + dx, minY: box.minY + dy, maxX: box.maxX + dx, maxY: box.maxY + dy });
      if (moved.every((box) => !box || (inside(box) && !blocked.some((other) => overlap(box, other, GAP))))) return moved;
    }
    return boxes;
  };
  const missing = (boxes: Array<Box | null>) => boxes.filter((box) => box === null).length;
  let chosen = fill((b) => ((b.minX + b.maxX) / 2 - midX) ** 2 + ((b.minY + b.maxY) / 2 - midY) ** 2);
  if (missing(chosen) > 0) {
    const corners: Array<(b: Box) => number> = [(b) => b.minY * 1e4 + b.minX, (b) => b.minY * 1e4 - b.maxX, (b) => -b.maxY * 1e4 + b.minX, (b) => -b.maxY * 1e4 - b.maxX];
    for (const corner of corners) {
      const way = fill(corner);
      if (missing(way) < missing(chosen)) chosen = toMiddle(way);
    }
  }
  const places: Array<GatherPlace[] | null> = sources.map((source, index) => (used.includes(index) ? source.parts.map(() => ({ dx: 0, dy: 0, box: source.parts[0].box, offBed: false })) : null));
  let offBedX = bed.maxX + 20;
  pieces.forEach(({ index, k, f }, n) => {
    const w = f.maxX - f.minX;
    const h = f.maxY - f.minY;
    const box = chosen[n] ?? { minX: offBedX, minY: bed.minY, maxX: offBedX + w, maxY: bed.minY + h };
    if (!chosen[n]) offBedX += w + GAP * 2;
    (places[index] as GatherPlace[])[k] = { dx: box.minX - f.minX, dy: box.minY - f.minY, box, offBed: !chosen[n] };
  });

  const warnings: GatherWarning[] = [];
  const inUse = used.map((index) => sources[index]);
  const heights = [...new Set(inUse.map((s) => s.layerHeight).filter((h): h is number => h !== null))];
  if (heights.length > 1) warnings.push({ key: "layerHeight", heights: heights.map((h) => `${h} mm`).join(" · ") });
  const models = [...new Set(inUse.map((s) => s.printerModel).filter((m): m is string => Boolean(m)))];
  if (models.length > 1) warnings.push({ key: "printer", models: models.join(" · ") });
  const gcode = inUse.filter((s) => s.customGcode).map((s) => s.name);
  if (gcode.length > 0) warnings.push({ key: "customGcode", files: gcode.join(", ") });
  const off = used.filter((index) => places[index]?.some((place) => place.offBed)).map((index) => sources[index].name);
  if (off.length > 0) warnings.push({ key: "offBed", files: off.join(", ") });
  if (base && slicer === "prusa" && !base.config) warnings.push({ key: "noConfig" });
  if (slicer === "bambu") {
    if (base && !bambuKey) warnings.push({ key: "bambuPrinter", model: base.printerModel ?? "?" });
    const plates = inUse.filter((s) => (s.bambu?.plates ?? 1) > 1).map((s) => s.name);
    if (plates.length > 0) warnings.push({ key: "plates", files: plates.join(", ") });
    if (inUse.some((s) => s.bambu?.customFilaments)) warnings.push({ key: "bambuFilaments" });
  }

  const slotChanges = base
    ? slots.flatMap((colour, i) => (colour !== base.physical[i] ? [{ slot: i + 1, before: base.physical[i], after: colour }] : []))
    : [];
  return {
    slicer,
    used,
    left,
    taken: same,
    slots,
    slotChanges,
    slotMaps,
    stateMaps,
    mixes,
    mixesBefore,
    joined,
    limit,
    faces,
    places,
    idOffsets,
    bed,
    tower,
    excluded,
    warnings,
    tooMany: P + mixes.length > limit,
  };
}

// ---------------------------------------------------------------- write

/** Composed (NFC) first, as in core export3mf.ts: decomposed Korean showed as "????" in Bambu Studio. */
function xmlEscape(value: string): string {
  return value.normalize("NFC").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}


/**
 * Copies what is inside `<resources>` of one model file, a piece at a time,
 * changing tags on the way: `triangle` gets each `<triangle …>`, `other` every
 * other opening tag but the vertices (either returns the new tag, or null to
 * keep it).  The vertices go through as they are.
 */
async function copyResources(
  file: Blob,
  entry: ZipEntry,
  edit: { triangle?: (tag: string) => string | null; other?: (tag: string) => string | null },
  out: (text: string) => void,
  onRead?: (bytes: number) => void,
): Promise<void> {
  let inside = false;
  let carry = "";
  let stopped = false;
  const decoder = new TextDecoder();
  const push = (bytes: Uint8Array, last: boolean): boolean => {
    const s = carry + decoder.decode(bytes, { stream: !last });
    const pieces: string[] = [];
    let copyFrom = 0;
    let at = 0;
    const put = (open: number, end: number, next: string | null) => {
      if (next === null) return;
      pieces.push(s.slice(copyFrom, open), next);
      copyFrom = end;
    };
    for (;;) {
      const open = s.indexOf("<", at);
      if (open < 0) break;
      const close = s.indexOf(">", open);
      if (close < 0) break;
      const end = close + 1;
      const c1 = s.charCodeAt(open + 1);
      if (!inside) {
        if (s.startsWith("<resources", open)) inside = !s.startsWith("/>", close - 1);
        copyFrom = end;
      } else if (c1 === 118 /* v */) {
        // vertices go through as they are
      } else if (c1 === 116 /* t */ && s.startsWith("<triangle ", open)) {
        if (edit.triangle) put(open, end, edit.triangle(s.slice(open, end)));
      } else if (c1 === 47 /* / */) {
        if (s.startsWith("</resources", open)) {
          pieces.push(s.slice(copyFrom, open));
          copyFrom = end;
          stopped = true;
          break;
        }
      } else if (edit.other) {
        put(open, end, edit.other(s.slice(open, end)));
      }
      at = end;
    }
    if (stopped) carry = "";
    else {
      if (inside) pieces.push(s.slice(copyFrom, at));
      carry = s.slice(at);
    }
    out(pieces.join(""));
    return stopped;
  };
  await readEntry(file, entry, push, onRead);
  if (!stopped) throw new GatherError("broken");
}

/** A painted code renumbered, cached (most codes repeat). */
function codeMapper(map: (state: number) => number, from: PaintFlavour, to: PaintFlavour): (code: string) => string | null {
  const cache = new Map<string, string | null>();
  return (code) => {
    let next = cache.get(code);
    if (next === undefined) {
      next = remapPaintCode(code, map, from, to);
      if (cache.size < 200000) cache.set(code, next);
    }
    return next;
  };
}

/** The model config of one file with its ids moved up and its extruders renumbered. */
function sourceModelConfig(source: GatherSource, offset: number, states: Record<number, number>): string {
  const extruder = (value: string) => String(Math.max(1, states[Math.max(1, Number(value))] ?? Number(value)));
  if (source.modelConfig) {
    const blocks = [...source.modelConfig.matchAll(/<object\b[^>]*\bid="(\d+)"[^>]*>[\s\S]*?<\/object>/g)];
    if (blocks.length > 0)
      return blocks
        .map((block) =>
          block[0]
            .replace(/(<object\b[^>]*\bid=")(\d+)"/, (_m, head: string, id: string) => `${head}${Number(id) + offset}"`)
            .replace(/(key="extruder" value=")(\d+)"/g, (_m, head: string, value: string) => (value === "0" ? `${head}0"` : `${head}${extruder(value)}"`)),
        )
        .map((text) => ` ${text.trim()}\n`)
        .join("");
  }
  const title = source.name.replace(/\.3mf$/i, "");
  return source.objects
    .filter((object) => object.faces > 0)
    .map((object, k) => {
      const name = xmlEscape(object.name || (source.objects.length > 1 ? `${title} ${k + 1}` : title));
      return (
        ` <object id="${object.id + offset}" instances_count="${Math.max(1, source.items.filter((item) => item.objectId === object.id).length)}">\n` +
        `  <metadata type="object" key="name" value="${name}"/>\n` +
        `  <metadata type="object" key="extruder" value="${extruder("1")}"/>\n` +
        `  <volume firstid="0" lastid="${object.faces - 1}">\n` +
        `   <metadata type="volume" key="name" value="${name}"/>\n` +
        `   <metadata type="volume" key="volume_type" value="ModelPart"/>\n` +
        `   <metadata type="volume" key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n` +
        `  </volume>\n` +
        ` </object>\n`
      );
    })
    .join("");
}

function renumberedLayerHeights(source: GatherSource, offset: number): string {
  if (!source.layerHeights) return "";
  return source.layerHeights
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.replace(/^object_id=(\d+)/, (_m, id: string) => `object_id=${Number(id) + offset}`))
    .join("\n");
}

function renumberedLayerRanges(source: GatherSource, offset: number, states: Record<number, number>): string {
  if (!source.layerRanges) return "";
  const blocks = [...source.layerRanges.matchAll(/<object\b[^>]*\bid="(\d+)"[^>]*>[\s\S]*?<\/object>/g)];
  return blocks
    .map((block) =>
      block[0]
        .replace(/(<object\b[^>]*\bid=")(\d+)"/, (_m, head: string, id: string) => `${head}${Number(id) + offset}"`)
        .replace(/(opt_key="extruder"[^>]*>)\s*(\d+)\s*</g, (_m, head: string, value: string) => `${head}${value === "0" ? 0 : (states[Number(value)] ?? value)}<`),
    )
    .map((text) => ` ${text.trim()}\n`)
    .join("");
}

function updatedConfig(config: string, slots: string[]): string {
  return config.replace(/^(;\s*extruder_colour\s*=\s*)(.*)$/m, (_m, head: string, value: string) => {
    const colours = value.split(";");
    slots.forEach((colour, i) => {
      if (i < colours.length) colours[i] = colour;
    });
    return head + colours.join(";");
  });
}

export interface GatherWriteOptions {
  title: string;
  thumbnail?: Uint8Array | null;
  onProgress?: (done: number, total: number) => void;
}

/** The item's transform moved by its part's place. */
function placedTransform(source: GatherSource, places: GatherPlace[], itemIndex: number): string {
  let part = 0;
  source.parts.forEach((p, k) => {
    if (p.items.includes(itemIndex)) part = k;
  });
  const m = source.items[itemIndex].transform.slice();
  m[9] += places[part].dx;
  m[10] += places[part].dy;
  return m.map(formatNumber).join(" ");
}

/**
 * Writes the gathered project.  `files` are the same files the sources were
 * read from, in the same order.
 */
export async function writeGather(files: Blob[], sources: GatherSource[], plan: GatherPlan, options: GatherWriteOptions): Promise<Blob> {
  if (plan.used.length === 0) throw new GatherError("nothing");
  if (plan.tooMany) throw new GatherError("tooMany", { n: plan.slots.length + plan.mixes.length, max: plan.limit });
  return plan.slicer === "bambu" ? writeBambu(files, sources, plan, options) : writePrusa(files, sources, plan, options);
}

async function writePrusa(files: Blob[], sources: GatherSource[], plan: GatherPlan, options: GatherWriteOptions): Promise<Blob> {
  const zip = new ZipOut("model/3mf");
  const base = sources[plan.used[0]];
  const thumbnail = options.thumbnail ?? base.thumbnail;
  zip.text(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n${thumbnail ? ' <Default Extension="png" ContentType="image/png"/>\n' : ""}</Types>\n`,
  );
  zip.text(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n${thumbnail ? ' <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n' : ""}</Relationships>\n`,
  );

  // ---- the model, streamed file by file
  const namespaces: Record<string, string> = { "": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02", slic3rpe: "http://schemas.slic3r.org/3mf/2017/06" };
  for (const index of plan.used) {
    for (const [prefix, uri] of Object.entries(sources[index].namespaces)) {
      if (namespaces[prefix] !== undefined && namespaces[prefix] !== uri) throw new GatherError("namespace", { prefix });
      namespaces[prefix] = uri;
    }
  }
  const declared = Object.entries(namespaces)
    .map(([prefix, uri]) => (prefix ? ` xmlns:${prefix}="${uri}"` : ` xmlns="${uri}"`))
    .join("");
  const model = zip.stream(MODEL_PATH);
  model.push(
    `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US"${declared}>\n` +
      ' <metadata name="slic3rpe:Version3mf">1</metadata>\n' +
      ' <metadata name="slic3rpe:MmPaintingVersion">2</metadata>\n' +
      ` <metadata name="Title">${xmlEscape(options.title)}</metadata>\n` +
      ' <metadata name="Designer"></metadata>\n' +
      ` <metadata name="Description">${xmlEscape(plan.used.map((index) => sources[index].name).join(" + "))}</metadata>\n` +
      ' <metadata name="Application">VertexColor2ColorMix</metadata>\n' +
      " <resources>\n",
  );
  const total = plan.used.reduce((sum, index) => sum + files[index].size, 0);
  let read = 0;
  const onRead = (bytes: number) => {
    read += bytes;
    options.onProgress?.(Math.min(read, total), total);
  };
  for (const index of plan.used) {
    const source = sources[index];
    const offset = plan.idOffsets[index] as number;
    const states = plan.stateMaps[index] as Record<number, number>;
    const sameStates = Object.entries(states).every(([from, to]) => Number(from) === to);
    const mapState = (state: number) => states[state] ?? state;
    const prusaCode = codeMapper(mapState, source.flavour, "prusa");
    const bambuCode = codeMapper(mapState, "bambu", "bambu");
    const moveId = (tag: string, name: string) => {
      const value = attr(tag, name);
      return value === null ? tag : setAttr(tag, name, String(Number(value) + offset));
    };
    const entry = (await zipEntries(files[index])).get(MODEL_PATH);
    if (!entry) throw new GatherError("noModel");
    await copyResources(
      files[index],
      entry,
      {
        triangle:
          sameStates && !offset
            ? undefined
            : (tag) => {
                let next = tag;
                if (!sameStates) {
                  const prusa = attr(next, "slic3rpe:mmu_segmentation");
                  if (prusa) next = setAttr(next, "slic3rpe:mmu_segmentation", prusaCode(prusa) ?? prusa);
                  // Only Bambu-family slicers read paint_color; one that no longer fits their codes is dropped.
                  const bambu = attr(next, "paint_color");
                  if (bambu) {
                    const code = bambuCode(bambu);
                    next = code === null ? removeAttr(next, "paint_color") : setAttr(next, "paint_color", code);
                  }
                }
                if (offset && attr(next, "pid") !== null) next = moveId(next, "pid");
                return next === tag ? null : next;
              },
        other: offset
          ? (tag) => {
              if (tag.startsWith("<metadata")) return null;
              let next = tag;
              if (attr(next, "id") !== null) next = moveId(next, "id");
              if (attr(next, "pid") !== null) next = moveId(next, "pid");
              if (attr(next, "objectid") !== null) next = moveId(next, "objectid");
              return next === tag ? null : next;
            }
          : undefined,
      },
      model.push,
      onRead,
    );
    model.push("\n");
  }
  const items: string[] = [];
  for (const index of plan.used) {
    const source = sources[index];
    const offset = plan.idOffsets[index] as number;
    const places = plan.places[index] as GatherPlace[];
    source.items.forEach((item, i) => {
      let tag = setAttr(item.tag, "objectid", String(item.objectId + offset));
      tag = setAttr(tag, "transform", placedTransform(source, places, i));
      items.push(`  ${tag}`);
    });
  }
  model.end(` </resources>\n <build>\n${items.join("\n")}\n </build>\n</model>\n`);

  // ---- settings
  if (base.config) zip.text("Metadata/Slic3r_PE.config", updatedConfig(base.config, plan.slots));
  zip.text(
    "Metadata/Slic3r_PE_model.config",
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${plan.used
      .map((index) => sourceModelConfig(sources[index], plan.idOffsets[index] as number, plan.stateMaps[index] as Record<number, number>))
      .join("")}</config>\n`,
  );
  zip.text(
    "Metadata/Prusa_Slicer_full_spectrum.json",
    JSON.stringify(
      {
        physical_extruders: plan.slots.map((color, i) => ({ id: i + 1, color })),
        version: 1,
        virtual_extruders: plan.mixes.map((mix) => ({
          id: mix.id,
          kind: mix.kind,
          color: mix.color,
          components: mix.components.map((c) => ({ extruder: c.extruder, ratio: Number(c.ratio.toFixed(6)) })),
        })),
      },
      null,
      2,
    ),
  );
  zip.text("Metadata/Prusa_Slicer_wipe_tower_information.xml", base.wipeTower ?? '<?xml version="1.0" encoding="UTF-8"?>\n<wipe_tower_information/>\n');
  const heights = plan.used.map((index) => renumberedLayerHeights(sources[index], plan.idOffsets[index] as number)).filter(Boolean);
  if (heights.length > 0) zip.text("Metadata/Slic3r_PE_layer_heights_profile.txt", heights.join("\n") + "\n");
  const ranges = plan.used
    .map((index) => renumberedLayerRanges(sources[index], plan.idOffsets[index] as number, plan.stateMaps[index] as Record<number, number>))
    .filter(Boolean);
  if (ranges.length > 0) zip.text("Metadata/Prusa_Slicer_layer_config_ranges.xml", `<?xml version="1.0" encoding="utf-8"?>\n<objects>\n${ranges.join("")}</objects>\n`);
  if (thumbnail) zip.bytes("Metadata/thumbnail.png", thumbnail);
  return zip.close();
}

/**
 * A Bambu Studio project, laid out as 규로마's Bambu export writes one
 * (core/bambuProject.ts): one model file per mesh file of the sources, an
 * assembly object per source object, one plate.  The settings are built for
 * the first file's printer with the joined filaments, and its own print
 * settings (layer height, supports, …) are carried over.
 */
async function writeBambu(files: Blob[], sources: GatherSource[], plan: GatherPlan, options: GatherWriteOptions): Promise<Blob> {
  const base = sources[plan.used[0]];
  const printerKey = base.bambu?.printerKey;
  if (!printerKey) throw new GatherError("bambuPrinter", { model: base.printerModel ?? "?" });
  const mixed: BambuMixedSlot[] = plan.mixes.map((mix) => ({
    components: mix.components.map((c) => c.extruder),
    ratios: mix.components.map((c) => c.ratio),
    colour: mix.color,
  }));
  const failures = validateBambuMixedSlots(plan.slots.length, mixed);
  if (failures.length > 0) throw new GatherError("unknown", { message: failures.join(" · ") });

  // New numbers: every mesh object first (1…), then the assemblies after them.
  const meshId = new Map<string, number>();
  const filePath = new Map<string, string>();
  let meshCount = 0;
  let fileCount = 0;
  for (const index of plan.used) {
    const bambu = sources[index].bambu as BambuSourceInfo;
    for (const path of bambu.files) {
      filePath.set(`${index}|${path}`, `3D/Objects/object_${++fileCount}.model`);
      for (const id of bambu.meshes[path] ?? []) meshId.set(`${index}|${path}|${id}`, ++meshCount);
    }
  }
  const assemblyId = new Map<string, number>();
  let assemblies = 0;
  for (const index of plan.used) for (const object of sources[index].objects) assemblyId.set(`${index}|${object.id}`, meshCount + ++assemblies);

  const zip = new ZipOut("model/3mf");
  const thumbnail = options.thumbnail ?? base.thumbnail;
  const date = new Date().toISOString().slice(0, 10);
  const main: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', BAMBU_MODEL_HEADER];
  main.push(` <metadata name="Application">BambuStudio-${BAMBU_PROJECT_VERSION}</metadata>`);
  main.push(' <metadata name="BambuStudio:3mfVersion">1</metadata>');
  main.push(` <metadata name="CreationDate">${date}</metadata>`);
  main.push(` <metadata name="ModificationDate">${date}</metadata>`);
  main.push(` <metadata name="Title">${xmlEscape(options.title)}</metadata>`);
  main.push(" <resources>");
  const items: string[] = [];
  const instances: Array<{ object: number; instance: number }> = [];
  for (const index of plan.used) {
    const source = sources[index];
    const bambu = source.bambu as BambuSourceInfo;
    for (const object of source.objects) {
      const id = assemblyId.get(`${index}|${object.id}`) as number;
      main.push(`  <object id="${id}" p:UUID="${hex8(id)}-61cb-4c03-9d28-80fed5dfa1dc" type="model">`);
      main.push("   <components>");
      for (const component of bambu.assemblies[object.id] ?? []) {
        const mesh = meshId.get(`${index}|${component.path}|${component.objectId}`) as number;
        main.push(
          `    <component p:path="/${filePath.get(`${index}|${component.path}`)}" objectid="${mesh}" p:UUID="${hex8(0x10000 + mesh)}-b206-40ff-9872-83e8017abed1" transform="${component.transform.map(formatNumber).join(" ")}"/>`,
        );
      }
      main.push("   </components>");
      main.push("  </object>");
    }
    const places = plan.places[index] as GatherPlace[];
    source.items.forEach((item, i) => {
      const id = assemblyId.get(`${index}|${item.objectId}`) as number;
      const instance = instances.filter((entry) => entry.object === id).length;
      instances.push({ object: id, instance });
      items.push(`  <item objectid="${id}" p:UUID="${hex8(items.length + 2)}-b1ec-4553-aec9-835e5b724bb4" transform="${placedTransform(source, places, i)}" printable="1"/>`);
    });
  }
  main.push(" </resources>");
  main.push(' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">');
  main.push(...items);
  main.push(" </build>");
  main.push("</model>");
  zip.text(MODEL_PATH, main.join("\n") + "\n");

  // ---- the meshes, streamed file by file
  const total = plan.used.reduce((sum, index) => sum + files[index].size, 0);
  let read = 0;
  const onRead = (bytes: number) => {
    read += bytes;
    options.onProgress?.(Math.min(read, total), total);
  };
  for (const index of plan.used) {
    const source = sources[index];
    const bambu = source.bambu as BambuSourceInfo;
    const states = plan.stateMaps[index] as Record<number, number>;
    const mapState = (raw: number) => (raw === 0 ? 0 : (states[bambu.renumber[raw] ?? raw] ?? raw));
    const code = codeMapper(mapState, "bambu", "bambu");
    const entries = await zipEntries(files[index]);
    for (const path of bambu.files) {
      const entry = entries.get(path);
      if (!entry) throw new GatherError("broken");
      const out = zip.stream(filePath.get(`${index}|${path}`) as string);
      out.push(`<?xml version="1.0" encoding="UTF-8"?>\n${BAMBU_MODEL_HEADER}\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n`);
      await copyResources(
        files[index],
        entry,
        {
          triangle: (tag) => {
            let next = removeAttr(tag, "slic3rpe:mmu_segmentation");
            const painted = attr(next, "paint_color");
            if (painted) {
              const moved = code(painted);
              if (moved === null) throw new GatherError("badPaint", { code: painted });
              next = setAttr(next, "paint_color", moved);
            }
            return next === tag ? null : next;
          },
          other: (tag) => {
            if (!tag.startsWith("<object")) return null;
            const id = meshId.get(`${index}|${path}|${Number(attr(tag, "id"))}`);
            if (id === undefined) return null;
            let next = setAttr(tag, "id", String(id));
            if (attr(next, "p:UUID") !== null) next = setAttr(next, "p:UUID", `${hex8(0x10000 + id)}-81cb-4c03-9d28-80fed5dfa1dc`);
            return next;
          },
        },
        out.push,
        onRead,
      );
      out.end("\n </resources>\n <build/>\n</model>\n");
    }
  }
  zip.text(
    "3D/_rels/3dmodel.model.rels",
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      [...filePath.values()].map((path, k) => ` <Relationship Target="/${path}" Id="rel-${k + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n`).join("") +
      "</Relationships>\n",
  );

  // ---- objects and the plate
  const config: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
  for (const index of plan.used) {
    const source = sources[index];
    const bambu = source.bambu as BambuSourceInfo;
    const states = plan.stateMaps[index] as Record<number, number>;
    const filament = (raw: string) => String(Math.max(1, states[bambu.renumber[Number(raw)] ?? Number(raw)] ?? Number(raw)));
    const blocks = new Map<number, string>();
    for (const block of (bambu.modelSettings ?? "").matchAll(/<object\b[^>]*\bid="(\d+)"[^>]*>[\s\S]*?<\/object>/g)) blocks.set(Number(block[1]), block[0]);
    for (const object of source.objects) {
      const id = assemblyId.get(`${index}|${object.id}`) as number;
      const components = bambu.assemblies[object.id] ?? [];
      const partId = (raw: number) => {
        const component = components.find((c) => c.objectId === raw);
        return component ? meshId.get(`${index}|${component.path}|${raw}`) : undefined;
      };
      const block = blocks.get(object.id);
      if (block) {
        config.push(
          "  " +
            block
              .replace(/(<object\b[^>]*\bid=")(\d+)"/, (_m, head: string) => `${head}${id}"`)
              .replace(/(<part\b[^>]*\bid=")(\d+)"/g, (whole, head: string, raw: string) => {
                const next = partId(Number(raw));
                return next === undefined ? whole : `${head}${next}"`;
              })
              .replace(/(key="extruder" value=")(\d+)"/g, (_m, head: string, value: string) => `${head}${value === "0" ? "0" : filament(value)}"`),
        );
        continue;
      }
      const name = xmlEscape(object.name || source.name.replace(/\.3mf$/i, ""));
      config.push(`  <object id="${id}">`);
      config.push(`    <metadata key="name" value="${name}"/>`);
      config.push(`    <metadata key="extruder" value="${filament(String(source.objectExtruders[object.id] ?? 1))}"/>`);
      config.push(`    <metadata face_count="${object.faces}"/>`);
      for (const component of components) {
        config.push(`    <part id="${partId(component.objectId)}" subtype="normal_part">`);
        config.push(`      <metadata key="name" value="${name}"/>`);
        config.push('      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>');
        config.push("    </part>");
      }
      config.push("  </object>");
    }
  }
  config.push("  <plate>");
  config.push('    <metadata key="plater_id" value="1"/>');
  config.push('    <metadata key="plater_name" value=""/>');
  config.push('    <metadata key="locked" value="false"/>');
  config.push('    <metadata key="filament_map_mode" value="Auto For Flush"/>');
  config.push('    <metadata key="gcode_file" value=""/>');
  if (thumbnail) config.push('    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>');
  instances.forEach((entry, k) => {
    config.push("    <model_instance>");
    config.push(`      <metadata key="object_id" value="${entry.object}"/>`);
    config.push(`      <metadata key="instance_id" value="${entry.instance}"/>`);
    config.push(`      <metadata key="identify_id" value="${100 + k}"/>`);
    config.push("    </model_instance>");
  });
  config.push("  </plate>");
  config.push("  <assemble>");
  config.push("  </assemble>");
  config.push("</config>");
  zip.text("Metadata/model_settings.config", config.join("\n") + "\n");

  // ---- settings: the printer's, the joined filaments, the first file's print settings
  const tower = plan.tower ?? bambuPlate(printerKey, plan.slots.length).tower;
  const settings = buildBambuProjectSettings(printerKey, plan.slots, mixed, { x: tower.minX, y: tower.minY });
  for (const [key, value] of Object.entries((base.bambu as BambuSourceInfo).settings)) {
    if (typeof value === "string" && typeof settings[key] === "string") settings[key] = value;
  }
  zip.text("Metadata/project_settings.config", JSON.stringify(settings, null, 4) + "\n");
  zip.text(
    "Metadata/slice_info.config",
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="${BAMBU_PROJECT_VERSION}"/>\n  </header>\n</config>\n`,
  );
  zip.text("Metadata/filament_sequence.json", '{"plate_1":{"nozzle_sequence":[],"optimal_assignment":[],"sequence":[]}}');
  zip.text(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n',
  );
  zip.text(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
      (thumbnail
        ? ' <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>\n'
        : "") +
      "</Relationships>\n",
  );
  if (thumbnail) zip.bytes("Metadata/plate_1.png", thumbnail);
  return zip.close();
}
