import { Zip, ZipDeflate } from "fflate";

/** An entry written in pieces: push text, then end (with the last text, if any). */
export interface ZipEntryStream {
  push(text: string): void;
  end(text?: string): void;
}

/**
 * A zip written as its entries are produced: every piece is compressed as it
 * comes, so no file is ever held whole as one string or one buffer — a mesh of
 * millions of faces goes out in pieces of a few megabytes, and only the
 * compressed result is kept.
 */
export class ZipOut {
  private parts: Uint8Array[] = [];
  private failure: unknown = null;
  private finished!: () => void;
  private done = new Promise<void>((resolve) => (this.finished = resolve));
  private zip = new Zip((error, chunk, final) => {
    if (error) this.failure = error;
    else this.parts.push(chunk);
    if (final || error) this.finished();
  });
  private encoder = new TextEncoder();

  /**
   * `level`: deflate level 1–9 (6 by default). 1 compresses faster for a file ~8% bigger (on a 4.6M-face export
   * the whole export went 19 → 17 s in the browser — 11-09).
   */
  constructor(
    private readonly type = "application/zip",
    private readonly level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6,
  ) {}

  text(path: string, text: string): void {
    const entry = new ZipDeflate(path, { level: this.level });
    this.zip.add(entry);
    entry.push(this.encoder.encode(text), true);
  }

  bytes(path: string, bytes: Uint8Array): void {
    const entry = new ZipDeflate(path, { level: this.level });
    this.zip.add(entry);
    entry.push(bytes, true);
  }

  /** An entry written in pieces: push text, then end. */
  stream(path: string): ZipEntryStream {
    const entry = new ZipDeflate(path, { level: this.level });
    this.zip.add(entry);
    return {
      push: (text) => {
        if (text) entry.push(this.encoder.encode(text), false);
      },
      end: (text = "") => entry.push(this.encoder.encode(text), true),
    };
  }

  async close(): Promise<Blob> {
    this.zip.end();
    await this.done;
    if (this.failure) throw this.failure;
    return new Blob(this.parts as Uint8Array<ArrayBuffer>[], { type: this.type });
  }
}
