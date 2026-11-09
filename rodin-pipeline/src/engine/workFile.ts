import {
  deserialiseRecord,
  isStoredWorkColours,
  isStoredWorkCuts,
  isStoredWorkFile,
  serialiseRecord,
  type StoredWorkColours,
  type StoredWorkCuts,
  type StoredWorkFile,
} from "./storage";

/**
 * A work file (.gyuroma): what the autosave keeps — the model file, the face
 * colours and the confirmed cuts — with the settings, in one file the person
 * keeps wherever they like.  The browser's store is not theirs to keep:
 * clearing the site's data, another browser or a full disk and it is gone.
 *
 * Layout: "GYUROMA1", the header's length (4 bytes), the header (JSON, with
 * the settings), then the three records exactly as the autosave writes them
 * (storage.ts), one after another — gzipped as one where the browser can.
 */
export const WORK_FILE_EXT = ".gyuroma";
const MAGIC = "GYUROMA1";

export interface WorkFileContents {
  file: StoredWorkFile;
  /** The face colours; null = the file's own. */
  colours: StoredWorkColours | null;
  /** The confirmed cuts the colours' mesh was made with; null = none. */
  cuts: StoredWorkCuts | null;
  settings: unknown;
  /** What the AI found and said about this model (its part map, the consult) — so the work goes on where it was. */
  ai?: { partMap: unknown; chat: unknown[] } | null;
  /** ✏️ The guide lines drawn on the model (engine/guides.ts StoredGuides); read back as it was written, checked when taken. */
  guides?: unknown;
  savedAt: number;
  /** The app and version that wrote it. */
  app: string;
}

interface WorkFileHeader {
  type: "gyuroma-work";
  version: 1;
  app: string;
  savedAt: number;
  name: string;
  /** Byte lengths of the records after the header: model file, colours, cuts (0 = none). */
  parts: [number, number, number];
  gzip: boolean;
  settings: unknown;
  ai?: { partMap: unknown; chat: unknown[] } | null;
  /** Added 11-05: a file without it (older) has no guide lines; an older app reading a newer file leaves them. */
  guides?: unknown;
}

/** Why a file could not be read as a work file. */
export class WorkFileError extends Error {
  constructor(readonly code: "notWorkFile" | "newer" | "broken") {
    super(code);
  }
}

async function throughStream(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function packWorkFile(contents: Omit<WorkFileContents, "savedAt"> & { savedAt?: number }): Promise<Blob> {
  const records = [serialiseRecord(contents.file), contents.colours ? serialiseRecord(contents.colours) : null, contents.cuts ? serialiseRecord(contents.cuts) : null];
  const file = records[0];
  if (!file) throw new WorkFileError("broken");
  const body = new Uint8Array(records.reduce((n, record) => n + (record?.length ?? 0), 0));
  let at = 0;
  for (const record of records) {
    if (!record) continue;
    body.set(record, at);
    at += record.length;
  }
  // The model file is text (OBJ) or a zip (3MF): a third of the size or so, gzipped.
  const packed = typeof CompressionStream === "undefined" ? null : await throughStream(body, new CompressionStream("gzip"));
  const header: WorkFileHeader = {
    type: "gyuroma-work",
    version: 1,
    app: contents.app,
    savedAt: contents.savedAt ?? Date.now(),
    name: contents.file.name,
    parts: [file.length, records[1]?.length ?? 0, records[2]?.length ?? 0],
    gzip: packed !== null,
    settings: contents.settings,
    ai: contents.ai ?? null,
    guides: contents.guides ?? null,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const lead = new Uint8Array(12);
  lead.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(lead.buffer).setUint32(8, headerBytes.length, true);
  return new Blob([lead, headerBytes, (packed ?? body) as BlobPart], { type: "application/octet-stream" });
}

export async function readWorkFile(blob: Blob): Promise<WorkFileContents> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw new WorkFileError("notWorkFile");
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  let header: WorkFileHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength))) as WorkFileHeader;
  } catch {
    throw new WorkFileError("broken");
  }
  if (header.type !== "gyuroma-work") throw new WorkFileError("notWorkFile");
  if (!(header.version <= 1)) throw new WorkFileError("newer");
  const rest = bytes.subarray(12 + headerLength);
  let body: Uint8Array;
  try {
    body = header.gzip ? await throughStream(rest, new DecompressionStream("gzip")) : rest;
  } catch {
    throw new WorkFileError("broken");
  }
  const [fileLength, coloursLength, cutsLength] = header.parts;
  if (fileLength + coloursLength + cutsLength !== body.length) throw new WorkFileError("broken");
  const part = (from: number, length: number) => (length > 0 ? deserialiseRecord(body.slice(from, from + length).buffer) : null);
  const file = part(0, fileLength);
  const colours = part(fileLength, coloursLength);
  const cuts = part(fileLength + coloursLength, cutsLength);
  if (!isStoredWorkFile(file)) throw new WorkFileError("broken");
  return {
    file,
    colours: isStoredWorkColours(colours) ? colours : null,
    cuts: isStoredWorkCuts(cuts) ? cuts : null,
    settings: header.settings,
    ai: header.ai && typeof header.ai === "object" ? { partMap: header.ai.partMap ?? null, chat: Array.isArray(header.ai.chat) ? header.ai.chat : [] } : null,
    guides: header.guides ?? null,
    savedAt: Number(header.savedAt) || 0,
    app: String(header.app ?? ""),
  };
}

/** "Slc_p.obj" saved on 2 Nov 2026 at 16:22 -> "Slc_p 2026-11-02 1622.gyuroma". */
export function workFileName(modelName: string, at: Date): string {
  const base = modelName.replace(/\.[^.]+$/, "") || "work";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${base} ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}${two(at.getMinutes())}${WORK_FILE_EXT}`;
}
