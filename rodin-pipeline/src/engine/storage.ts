import { DEFAULT_SETTINGS, DEFAULT_TARGET_HEIGHT, MAX_PHYSICAL, MIN_PHYSICAL, type PipelineSettings } from "./types";
import type { RGB } from "@core/types";
import { sharedRgbOf } from "@core/rgbPool";

const STORAGE_KEY = "rodin-pipeline-settings-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shallow-per-section merge of a stored object onto the defaults. */
export function mergeSettings(stored: unknown): PipelineSettings {
  if (!isRecord(stored)) return structuredClone(DEFAULT_SETTINGS);
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const section of ["filaments", "palette", "merge", "mix", "export", "performance"] as const) {
    const value = stored[section];
    if (isRecord(value)) Object.assign(out[section] as unknown as Record<string, unknown>, value);
  }
  // Settings saved before the height default carry targetHeight: null, which would
  // otherwise keep exporting unit-scale models as 2 mm objects.
  if (!(typeof out.export.targetHeight === "number" && out.export.targetHeight > 0))
    out.export.targetHeight = DEFAULT_TARGET_HEIGHT;
  // The cut along the borders was on by default: a setting nobody chose goes back to off.
  if (!out.export.cutChosen) out.export.cutSpan = 0;
  if (isRecord(stored.mergeFlags)) out.mergeFlags = stored.mergeFlags as PipelineSettings["mergeFlags"];
  if (Array.isArray(stored.filamentList))
    out.filamentList = stored.filamentList.filter(
      (entry): entry is PipelineSettings["filamentList"][number] =>
        isRecord(entry) && typeof entry.name === "string" && typeof entry.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(entry.hex),
    );
  if (typeof stored.rememberTemplate === "boolean") out.rememberTemplate = stored.rememberTemplate;
  if (typeof stored.rememberWork === "boolean") out.rememberWork = stored.rememberWork;
  if (isRecord(stored.manualPhysical)) out.manualPhysical = stored.manualPhysical as PipelineSettings["manualPhysical"];
  if (isRecord(stored.recipeOverrides)) out.recipeOverrides = stored.recipeOverrides as PipelineSettings["recipeOverrides"];
  if (isRecord(stored.stripByModel)) out.stripByModel = stored.stripByModel as PipelineSettings["stripByModel"];
  // The one-step undo for slot colours, so it still works after a reload.
  if (isRecord(stored.filamentsUndo)) {
    const undo = structuredClone(DEFAULT_SETTINGS.filaments);
    Object.assign(undo as unknown as Record<string, unknown>, stored.filamentsUndo);
    out.filamentsUndo = normaliseFilaments(undo);
  }
  // Keep fixed-length arrays well formed.
  out.filaments = normaliseFilaments(out.filaments);
  return out;
}

/** Fills in missing or malformed slot colours and names from the defaults. */
function normaliseFilaments(value: PipelineSettings["filaments"]): PipelineSettings["filaments"] {
  const hex = Array.isArray(value.hex) ? value.hex : [];
  const names = Array.isArray(value.names) ? value.names : [];
  return {
    ...value,
    hex: DEFAULT_SETTINGS.filaments.hex.map((fallback, i) =>
      typeof hex[i] === "string" && /^#[0-9a-fA-F]{6}$/.test(hex[i]) ? hex[i].toUpperCase() : fallback,
    ),
    names: DEFAULT_SETTINGS.filaments.names.map((fallback, i) =>
      typeof names[i] === "string" && names[i].trim() ? names[i] : fallback,
    ),
    count: Math.max(MIN_PHYSICAL, Math.min(MAX_PHYSICAL, Math.round(Number(value.count) || 5))),
  };
}

export function loadStoredSettings(): PipelineSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return mergeSettings(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function storeSettings(settings: PipelineSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); ignore.
  }
}

export function settingsToJson(settings: PipelineSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function downloadTextFile(fileName: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

// ---------------------------------------------------------------------------
// IndexedDB for binary blobs (template 3MF) that do not fit localStorage.
// ---------------------------------------------------------------------------

const DB_NAME = "rodin-pipeline";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Work autosave: the loaded model file plus the current face colours.
// ---------------------------------------------------------------------------

export const WORK_FILE_KEY = "work-file";
export const WORK_COLOURS_KEY = "work-colours";
export const WORK_CUTS_KEY = "work-cuts";

export interface StoredWorkFile {
  /** Original file name, e.g. "typhoeus.3mf". */
  name: string;
  /** "rodin" (3MF), "obj" (vertex-colour OBJ) or "nomad" (OBJ imported as a full reload). */
  kind: "rodin" | "obj" | "nomad";
  /** Raw file bytes. */
  buffer: ArrayBuffer;
  /** Palette used for snapping a Nomad OBJ (3 bytes per colour); only for kind "nomad". */
  palette?: Uint8Array;
  savedAt: number;
}

/**
 * Which model file a colours or cuts record was made on (11-10): its name and byte size.  A face count alone let
 * a second window's model take the first's colours when both had as many faces; a record made on another file is
 * now left unused.  Absent on records saved before (those still go by the face count).
 */
export interface WorkIdentity {
  name: string;
  size: number;
}

/** True when a record made on `made` belongs to the stored file (a record without one — saved before 11-10 — does). */
export function sameWorkFile(made: WorkIdentity | undefined, file: { name: string; size: number }): boolean {
  // Composed and decomposed Korean are the same name (a Mac hands out either, 11-10).
  return !made || (made.name.normalize("NFC") === file.name.normalize("NFC") && made.size === file.size);
}

export interface StoredWorkColours {
  faceCount: number;
  /** 3 bytes per face, in face order. */
  colours: Uint8Array;
  savedAt: number;
  /** How many of the stored cuts (StoredWorkCuts) the mesh these colours belong to was cut with; 0 or absent = the file as it is. */
  cuts?: number;
  /** The model file these colours were painted on (absent on records saved before 11-10). */
  file?: WorkIdentity;
}

/**
 * One confirmed cut along the colour borders (@core/borderCut), as made on the
 * mesh before it: enough to make it again, exactly, with meshWithCut.
 */
export interface StoredCut {
  /** Faces and vertices of the mesh the cut was made on. */
  faces: number;
  vertices: number;
  addedVertices: Float64Array;
  pieces: Int32Array;
  pieceGroups: Int32Array;
  pieceFaces: Int32Array;
  replaced: Int32Array;
  /**
   * Each face's group colour right after this cut (packRuns): the borders then
   * were cut along their line, and are not cut again (borderCut `settled`).
   */
  settled?: Uint8Array;
}

/**
 * The confirmed cuts of the stored work file, in the order they were made.
 * The colours record says how many of them its mesh was cut with (undone
 * cuts can stay at the end, unused).
 */
export interface StoredWorkCuts {
  /** The work file they were made on. */
  fileName: string;
  /** Its size in bytes (absent on records saved before 11-10). */
  fileSize?: number;
  cuts: StoredCut[];
  savedAt: number;
}

/** 3 bytes a face, as runs of one colour: [count (4 bytes), r, g, b] each — a few runs where a mesh's faces go in order. */
export function packRuns(rgb: Uint8Array): Uint8Array {
  const runs: number[] = [];
  for (let f = 0; f < rgb.length; f += 3) {
    const n = runs.length;
    if (n > 0 && runs[n - 3] === rgb[f] && runs[n - 2] === rgb[f + 1] && runs[n - 1] === rgb[f + 2]) runs[n - 4]++;
    else runs.push(1, rgb[f], rgb[f + 1], rgb[f + 2]);
  }
  const out = new Uint8Array((runs.length / 4) * 7);
  const view = new DataView(out.buffer);
  for (let r = 0; r < runs.length / 4; r++) {
    view.setUint32(r * 7, runs[r * 4], true);
    out[r * 7 + 4] = runs[r * 4 + 1];
    out[r * 7 + 5] = runs[r * 4 + 2];
    out[r * 7 + 6] = runs[r * 4 + 3];
  }
  return out;
}

/** packRuns back to 3 bytes a face; null when it does not make `faceCount` faces. */
export function unpackRuns(runs: Uint8Array, faceCount: number): Uint8Array | null {
  if (runs.length % 7 !== 0) return null;
  const out = new Uint8Array(faceCount * 3);
  const view = new DataView(runs.buffer, runs.byteOffset, runs.byteLength);
  let f = 0;
  for (let r = 0; r < runs.length; r += 7) {
    const count = view.getUint32(r, true);
    if (f + count > faceCount) return null;
    for (let k = 0; k < count; k++, f++) {
      out[f * 3] = runs[r + 4];
      out[f * 3 + 1] = runs[r + 5];
      out[f * 3 + 2] = runs[r + 6];
    }
  }
  return f === faceCount ? out : null;
}

export function isStoredWorkCuts(value: unknown): value is StoredWorkCuts {
  return isRecord(value) && typeof value.fileName === "string" && Array.isArray(value.cuts);
}

export function packColours(colours: ArrayLike<RGB>): Uint8Array {
  const out = new Uint8Array(colours.length * 3);
  for (let i = 0; i < colours.length; i++) {
    const rgb = colours[i];
    out[i * 3] = rgb[0];
    out[i * 3 + 1] = rgb[1];
    out[i * 3 + 2] = rgb[2];
  }
  return out;
}

export function unpackColours(packed: Uint8Array, faceCount: number): RGB[] | null {
  if (packed.length !== faceCount * 3) return null;
  const out: RGB[] = new Array(faceCount);
  // Faces of one colour share its array (rgbPool).
  for (let i = 0; i < faceCount; i++) out[i] = sharedRgbOf(packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2]);
  return out;
}

export function isStoredWorkFile(value: unknown): value is StoredWorkFile {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.kind === "rodin" || value.kind === "obj" || value.kind === "nomad") &&
    value.buffer instanceof ArrayBuffer
  );
}

export function isStoredWorkColours(value: unknown): value is StoredWorkColours {
  return isRecord(value) && typeof value.faceCount === "number" && value.colours instanceof Uint8Array;
}

export async function clearStoredWork(): Promise<void> {
  await Promise.all([idbDelete(WORK_FILE_KEY), idbDelete(WORK_COLOURS_KEY), idbDelete(WORK_CUTS_KEY)]);
}

// ---------------------------------------------------------------------------
// Local data store: files served by the app's own dev/preview server when it is
// running (rodin-pipeline/user-data/), otherwise IndexedDB in the browser.
// ---------------------------------------------------------------------------

const MAGIC = "RDN1";
let serverProbe: Promise<boolean> | null = null;

function dataUrl(key: string, previous = false): string {
  return new URL(`__rodin/data/${key}${previous ? "?prev=1" : ""}`, document.baseURI).toString();
}

/**
 * True when the page comes from this computer or its network (localhost, 127.x, 192.168.x, *.local …): served by
 * GYUROMA's own server, which keeps the work in the folder.  The public site is served from elsewhere.
 */
export function expectsLocalServer(hostname = typeof location === "undefined" ? "" : location.hostname): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

async function pingOnce(): Promise<boolean> {
  try {
    const res = await fetch(new URL("__rodin/ping", document.baseURI).toString(), { cache: "no-store" });
    return res.ok && (await res.text()).trim() === "ok";
  } catch {
    return false;
  }
}

/**
 * True when the page is served by the GYUROMA dev/preview server (worked out once a page).  Served from this
 * computer, a ping that fails is tried again for a few seconds first (11-10): the launcher restarts an old server,
 * and one failed ping in that moment used to send the whole session's saves to the browser's store, which the
 * next start (server up) never reads.
 */
export function localServerAvailable(): Promise<boolean> {
  if (!serverProbe) {
    serverProbe = (async () => {
      const tries = expectsLocalServer() ? 6 : 1;
      for (let i = 0; i < tries; i++) {
        if (await pingOnce()) return true;
        if (i + 1 < tries) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return false;
    })();
  }
  return serverProbe;
}

function packRecord(header: Record<string, unknown>, payload: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + headerBytes.length + payload.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  out.set(payload, 8 + headerBytes.length);
  return out;
}

function unpackRecord(buffer: ArrayBuffer): { header: Record<string, unknown>; payload: Uint8Array } | null {
  if (buffer.byteLength < 8) return null;
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) return null;
  const headerLength = new DataView(buffer).getUint32(4, true);
  if (8 + headerLength > buffer.byteLength) return null;
  // A header cut short or garbled is a broken record (null), not an exception that stops a restore (11-10).
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)));
  } catch {
    return null;
  }
  if (!isRecord(header)) return null;
  return { header, payload: bytes.slice(8 + headerLength) };
}

/** Typed arrays one after another, each starting on 8 bytes (so a Float64Array can be read in place). */
function packBlocks(blocks: ArrayBufferView[]): Uint8Array {
  const padded = (n: number) => Math.ceil(n / 8) * 8;
  const out = new Uint8Array(blocks.reduce((sum, b) => sum + padded(b.byteLength), 0));
  let at = 0;
  for (const b of blocks) {
    out.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), at);
    at += padded(b.byteLength);
  }
  return out;
}

/** Serialises the records the app stores (template, work file, work colours, work cuts). */
export function serialiseRecord(value: unknown): Uint8Array | null {
  if (isStoredWorkCuts(value)) {
    const blocks: ArrayBufferView[] = [];
    for (const cut of value.cuts) blocks.push(cut.addedVertices, cut.pieces, cut.pieceGroups, cut.pieceFaces, cut.replaced, cut.settled ?? new Uint8Array(0));
    const header = {
      type: "work-cuts",
      fileName: value.fileName,
      ...(value.fileSize !== undefined ? { fileSize: value.fileSize } : {}),
      savedAt: value.savedAt,
      cuts: value.cuts.map((cut) => ({
        faces: cut.faces,
        vertices: cut.vertices,
        added: cut.addedVertices.length,
        pieces: cut.pieceGroups.length,
        replaced: cut.replaced.length,
        settled: cut.settled?.length ?? 0,
      })),
    };
    return packRecord(header, packBlocks(blocks));
  }
  if (isStoredWorkFile(value)) {
    const palette = value.palette ?? new Uint8Array(0);
    const payload = new Uint8Array(palette.length + value.buffer.byteLength);
    payload.set(palette, 0);
    payload.set(new Uint8Array(value.buffer), palette.length);
    return packRecord({ type: "work-file", name: value.name, kind: value.kind, savedAt: value.savedAt, paletteLength: palette.length }, payload);
  }
  if (isStoredWorkColours(value)) {
    return packRecord({ type: "work-colours", faceCount: value.faceCount, savedAt: value.savedAt, cuts: value.cuts ?? 0, ...(value.file ? { file: value.file } : {}) }, value.colours);
  }
  if (isRecord(value) && typeof value.name === "string" && value.buffer instanceof ArrayBuffer) {
    return packRecord({ type: "template", name: value.name }, new Uint8Array(value.buffer));
  }
  return null;
}

/**
 * Plain data (the part maps, the consult's conversation) as JSON — named keys only, so a large record that
 * fails its own check can never turn into a JSON of millions of numbers.  These used to go to the browser's
 * store only, never read back while the server is up, so a reload lost them (11-05, the owner:
 * "새로고침하니까 부위 지도가 사라지는데?").
 * The guide lines (✏️, kept by model name) go the same way (11-05).
 */
export const JSON_KEYS = new Set(["part-maps", "tidy-chat", "guide-lines"]);
export function serialiseJson(value: unknown): Uint8Array {
  return packRecord({ type: "json" }, new TextEncoder().encode(JSON.stringify(value)));
}

export function deserialiseRecord(buffer: ArrayBuffer): unknown {
  const record = unpackRecord(buffer);
  if (!record) return null;
  const { header, payload } = record;
  if (header.type === "work-cuts") {
    // payload is a copy of its own (unpackRecord slices it), so its buffer starts at 0: views can be made in place.
    let at = 0;
    // A block that would run past the end (a file cut short) makes the whole record broken (null), not a RangeError (11-10).
    let broken = false;
    const take = <T extends ArrayBufferView>(make: (buffer: ArrayBuffer, offset: number, length: number) => T, count: number, size: number): T => {
      if (!(Number.isInteger(count) && count >= 0 && at + count * size <= payload.byteLength)) {
        broken = true;
        return make(new ArrayBuffer(0), 0, 0);
      }
      const view = make(payload.buffer as ArrayBuffer, payload.byteOffset + at, count);
      at += Math.ceil((count * size) / 8) * 8;
      return view;
    };
    const metas = Array.isArray(header.cuts) ? (header.cuts as Array<Record<string, number>>) : [];
    if (!metas.every((m) => isRecord(m) && Number.isInteger(m.faces) && Number.isInteger(m.vertices))) return null;
    const cuts: StoredCut[] = metas.map((m) => {
      const addedVertices = take((b, o, n) => new Float64Array(b, o, n), m.added, 8);
      const pieces = take((b, o, n) => new Int32Array(b, o, n), m.pieces * 3, 4);
      const pieceGroups = take((b, o, n) => new Int32Array(b, o, n), m.pieces, 4);
      const pieceFaces = take((b, o, n) => new Int32Array(b, o, n), m.pieces, 4);
      const replaced = take((b, o, n) => new Int32Array(b, o, n), m.replaced, 4);
      const settled = take((b, o, n) => new Uint8Array(b, o, n), Number(m.settled) || 0, 1);
      return { faces: m.faces, vertices: m.vertices, addedVertices, pieces, pieceGroups, pieceFaces, replaced, settled: settled.length > 0 ? settled : undefined };
    });
    if (broken) return null;
    const out: StoredWorkCuts = { fileName: String(header.fileName), cuts, savedAt: Number(header.savedAt) || 0 };
    if (typeof header.fileSize === "number") out.fileSize = header.fileSize;
    return out;
  }
  if (header.type === "work-file") {
    const paletteLength = Number(header.paletteLength) || 0;
    if (!(paletteLength >= 0 && paletteLength <= payload.length)) return null;
    const palette = paletteLength > 0 ? payload.slice(0, paletteLength) : undefined;
    // The file's bytes straight out of the payload (a view, then one copy of its own) — slicing the payload
    // and then its buffer copied the file twice more (11-10, Q7).
    const body = payload.subarray(paletteLength);
    const out: StoredWorkFile = {
      name: String(header.name),
      kind: header.kind === "obj" || header.kind === "nomad" ? header.kind : "rodin",
      buffer: body.byteOffset === 0 && body.byteLength === body.buffer.byteLength ? (body.buffer as ArrayBuffer) : (body.buffer as ArrayBuffer).slice(body.byteOffset, body.byteOffset + body.byteLength),
      palette,
      savedAt: Number(header.savedAt) || 0,
    };
    return out;
  }
  if (header.type === "work-colours") {
    const faceCount = Number(header.faceCount) || 0;
    // Colours that do not make their own face count are a broken record (they used to come back and be dropped quietly).
    if (payload.length !== faceCount * 3) return null;
    const out: StoredWorkColours = { faceCount, colours: payload, savedAt: Number(header.savedAt) || 0, cuts: Number(header.cuts) || 0 };
    const file = header.file;
    if (isRecord(file) && typeof file.name === "string" && typeof file.size === "number") out.file = { name: file.name, size: file.size };
    return out;
  }
  if (header.type === "template") {
    return { name: String(header.name), buffer: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) };
  }
  if (header.type === "json") {
    try {
      return JSON.parse(new TextDecoder().decode(payload)) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Reads a record: the local server's file when available, else IndexedDB.
 *
 * When the server is running it is the only source.  It used to fall back to
 * the browser's copy and push that up to the server when the file was
 * missing — which once resurrected a weeks-old model from one window's
 * browser into the folder every window shares, right after another window
 * had cleared it.  An empty folder now means empty.
 */
/** Keys that only ever reached the browser's store (see JSON_KEYS): their copy there is moved up once. */
const BROWSER_ONLY_BEFORE = JSON_KEYS;

/** What a read found (11-10): the record, or why there is none — so a restore can say a broken record from an empty one. */
export interface DataRead<T> {
  value: T | null;
  /** The record is there but cannot be read (cut short, garbled): `value` is the previous copy when that one could be. */
  broken: boolean;
  /** `value` is the copy before the last write (the folder keeps one: <key>.prev). */
  fromPrevious: boolean;
  /** The folder's server did not answer (nothing read, nothing to conclude). */
  failed: boolean;
}

async function fetchRecord(key: string, previous: boolean): Promise<{ status: "missing" | "ok" | "broken"; value: unknown; bytes?: ArrayBuffer }> {
  let lastError: unknown = null;
  // One more try after a moment: a server busy writing a big file can drop a read.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(dataUrl(key, previous), { cache: "no-store" });
      if (res.status === 204 || res.status === 404) return { status: "missing", value: null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      let value: unknown = null;
      try {
        value = deserialiseRecord(bytes);
      } catch {
        value = null;
      }
      return value === null ? { status: "broken", value: null, bytes } : { status: "ok", value };
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Reads a record: the local server's file when available, else IndexedDB.
 * With the server up it is the only source — a failed read is a failure, never the browser's old copy (11-10:
 * that copy is from another time, and once brought a weeks-old model back).  A broken record falls back to
 * the copy before its last write.
 */
export async function dataRead<T>(key: string): Promise<DataRead<T>> {
  if (await localServerAvailable()) {
    try {
      const got = await fetchRecord(key, false);
      if (got.status === "ok") return { value: got.value as T, broken: false, fromPrevious: false, failed: false };
      if (got.status === "missing") {
        if (BROWSER_ONLY_BEFORE.has(key)) {
          const kept = await idbGet<T>(key);
          if (kept !== null && (await dataSet(key, kept))) await idbDelete(key); // moved up once: an emptied file stays empty
          return { value: kept, broken: false, fromPrevious: false, failed: false };
        }
        return { value: null, broken: false, fromPrevious: false, failed: false };
      }
      const before = await fetchRecord(key, true).catch(() => null);
      return { value: before?.status === "ok" ? (before.value as T) : null, broken: true, fromPrevious: before?.status === "ok", failed: false };
    } catch {
      return { value: null, broken: false, fromPrevious: false, failed: true };
    }
  }
  return { value: await idbGet<T>(key), broken: false, fromPrevious: false, failed: false };
}

export async function dataGet<T>(key: string): Promise<T | null> {
  return (await dataRead<T>(key)).value;
}

/** Writes to one key go one after another: an older write must not land after a newer one. */
const writing = new Map<string, Promise<unknown>>();

export function dataSet(key: string, value: unknown): Promise<boolean> {
  const previous = writing.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeRecord(key, value));
  writing.set(key, next);
  void next.finally(() => {
    if (writing.get(key) === next) writing.delete(key);
  });
  return next;
}

/**
 * A model file's record as the pieces of a Blob — the same bytes as serialiseRecord, without putting the file
 * into one new array twice (11-10, Q7: a 230 MB OBJ was three copies at once while it was stored).
 */
export function workFileBody(value: StoredWorkFile): Blob {
  const palette = value.palette ?? new Uint8Array(0);
  const headerBytes = new TextEncoder().encode(JSON.stringify({ type: "work-file", name: value.name, kind: value.kind, savedAt: value.savedAt, paletteLength: palette.length }));
  const lead = new Uint8Array(8);
  lead.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(lead.buffer).setUint32(4, headerBytes.length, true);
  return new Blob([lead, headerBytes, palette as Uint8Array<ArrayBuffer>, value.buffer]);
}

async function writeRecord(key: string, value: unknown): Promise<boolean> {
  if (await localServerAvailable()) {
    const body: BodyInit | null = !JSON_KEYS.has(key) && isStoredWorkFile(value) ? workFileBody(value) : ((JSON_KEYS.has(key) ? serialiseJson(value) : serialiseRecord(value))?.buffer as ArrayBuffer | undefined) ?? null;
    if (body) {
      // With the server up it is the only place read from: a write that fails there
      // has failed (the browser's store would never be read back).
      try {
        const res = await fetch(dataUrl(key), { method: "PUT", body, headers: { "Content-Type": "application/octet-stream" } });
        return res.ok;
      } catch {
        return false;
      }
    }
  }
  return idbSet(key, value);
}

/** Deletes go in the same line as writes to their key: a delete must not overtake an older write still on its way. */
export function dataDelete(key: string): Promise<void> {
  const previous = writing.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => deleteRecord(key));
  writing.set(key, next);
  void next.finally(() => {
    if (writing.get(key) === next) writing.delete(key);
  });
  return next;
}

async function deleteRecord(key: string): Promise<void> {
  if (await localServerAvailable()) {
    try {
      await fetch(dataUrl(key), { method: "DELETE" });
    } catch {
      // ignore
    }
  }
  await idbDelete(key);
}

export async function clearStoredWorkEverywhere(): Promise<void> {
  await Promise.all([dataDelete(WORK_FILE_KEY), dataDelete(WORK_COLOURS_KEY), dataDelete(WORK_CUTS_KEY)]);
}

/**
 * Settings kept as JSON in the local server's folder.  "missing": none there yet (the browser's go up);
 * "broken": there but not readable — the copy before the last write is used when it reads (11-10: a broken file
 * was taken as none, and this browser's settings quietly overwrote the folder's — the colour strips per model,
 * hand-picked outputs and recipe changes with them); "failed": the server did not answer.
 */
export async function loadServerSettings(): Promise<{ state: "ok" | "missing" | "broken" | "failed" | "none"; settings: PipelineSettings | null; fromPrevious?: boolean }> {
  if (!(await localServerAvailable())) return { state: "none", settings: null };
  const read = async (previous: boolean): Promise<{ state: "ok" | "missing" | "broken"; settings: PipelineSettings | null }> => {
    const res = await fetch(dataUrl("settings", previous), { cache: "no-store" });
    if (res.status === 204 || res.status === 404) return { state: "missing", settings: null };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try {
      const parsed: unknown = JSON.parse(await res.text());
      return isRecord(parsed) ? { state: "ok", settings: mergeSettings(parsed) } : { state: "broken", settings: null };
    } catch {
      return { state: "broken", settings: null };
    }
  };
  try {
    const now = await read(false);
    if (now.state !== "broken") return now;
    const before = await read(true).catch(() => null);
    return before?.state === "ok" ? { state: "broken", settings: before.settings, fromPrevious: true } : { state: "broken", settings: null };
  } catch {
    return { state: "failed", settings: null };
  }
}

export async function storeServerSettings(settings: PipelineSettings): Promise<boolean> {
  if (!(await localServerAvailable())) return false;
  try {
    const res = await fetch(dataUrl("settings"), { method: "PUT", body: settingsToJson(settings), headers: { "Content-Type": "application/json" } });
    return res.ok;
  } catch {
    return false;
  }
}
