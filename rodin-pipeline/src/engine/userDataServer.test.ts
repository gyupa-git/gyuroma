import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
// The folder server's handler, on a temporary folder (never rodin-pipeline/user-data).
import { makeHandler, writeKeeping } from "../../vite.user-data.mjs";

type Reply = { status: number; body: Buffer; headers: Record<string, string> };

function request(handle: ReturnType<typeof makeHandler>, method: string, url: string, body?: Buffer | string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]) as Readable & { method: string; url: string };
    req.method = method;
    req.url = url;
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      writableEnded: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      end(data?: Buffer | string) {
        if (data !== undefined) chunks.push(Buffer.from(data));
        res.writableEnded = true;
        resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers });
      },
    };
    handle(req as never, res as never, () => reject(new Error("not handled")));
  });
}

const dirs: string[] = [];
function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gyuroma-data-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the folder server keeps the copy before each write (11-10)", () => {
  it("writes, keeps the previous copy, reads both", async () => {
    const dir = folder();
    const handle = makeHandler(dir);
    expect((await request(handle, "GET", "/__rodin/data/work-colours")).status).toBe(204);
    expect((await request(handle, "PUT", "/__rodin/data/work-colours", "first")).status).toBe(204);
    expect((await request(handle, "GET", "/__rodin/data/work-colours?prev=1")).status).toBe(204);
    expect((await request(handle, "PUT", "/__rodin/data/work-colours", "second")).status).toBe(204);
    expect((await request(handle, "GET", "/__rodin/data/work-colours")).body.toString()).toBe("second");
    expect((await request(handle, "GET", "/__rodin/data/work-colours?prev=1")).body.toString()).toBe("first");
    expect((await request(handle, "PUT", "/__rodin/data/work-colours", "third")).status).toBe(204);
    expect((await request(handle, "GET", "/__rodin/data/work-colours?prev=1")).body.toString()).toBe("second");
    // No temporary files left over.
    expect(readdirSync(dir).sort()).toEqual(["work-colours", "work-colours.prev"]);
  });

  it("a delete moves the file to the previous copy", async () => {
    const dir = folder();
    const handle = makeHandler(dir);
    await request(handle, "PUT", "/__rodin/data/work-file", "model bytes");
    expect((await request(handle, "DELETE", "/__rodin/data/work-file")).status).toBe(204);
    expect((await request(handle, "GET", "/__rodin/data/work-file")).status).toBe(204);
    expect((await request(handle, "GET", "/__rodin/data/work-file?prev=1")).body.toString()).toBe("model bytes");
    // A delete of nothing is fine.
    expect((await request(handle, "DELETE", "/__rodin/data/work-cuts")).status).toBe(204);
  });

  it("refuses a write to the previous copy and odd keys", async () => {
    const handle = makeHandler(folder());
    expect((await request(handle, "PUT", "/__rodin/data/work-file?prev=1", "x")).status).toBe(400);
    expect((await request(handle, "GET", "/__rodin/data/..%2Fsecret")).status).toBe(400);
    expect((await request(handle, "GET", "/__rodin/data/Bad.Key")).status).toBe(400);
  });

  it("writeKeeping leaves the old bytes whole when the new ones cannot be written", async () => {
    const dir = folder();
    const file = path.join(dir, "settings");
    writeFileSync(file, "old");
    // A directory where the temporary file would go cannot be written: the old file stays as it was.
    await expect(writeKeeping(path.join(dir, "missing-dir", "settings"), Buffer.from("new"))).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe("old");
    await writeKeeping(file, Buffer.from("new"));
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(readFileSync(file + ".prev", "utf8")).toBe("old");
    expect(existsSync(file + ".prev")).toBe(true);
  });
});
