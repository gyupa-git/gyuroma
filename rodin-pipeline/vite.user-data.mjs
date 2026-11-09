// Local data store for the GYUROMA dev/preview server (plain JS: no node typings needed).
// Settings and the autosaved work are kept as files in rodin-pipeline/user-data/, so they
// survive browser, profile and port changes.
//   GET    /__rodin/ping              -> "ok" (header X-Rodin-Started: when this server started, in
//                                        seconds — the launcher restarts a server older than its code)
//   GET    /__rodin/data/<key>        -> file bytes (204 + X-Rodin-Missing when missing)
//   GET    /__rodin/data/<key>?prev=1 -> the file as it was before its last write (<key>.prev)
//   PUT    /__rodin/data/<key>        -> writes the request body atomically, keeping the one before as <key>.prev
//   DELETE /__rodin/data/<key>        -> moves the file to <key>.prev (a delete can be taken back like a write)
//   /__rodin/ai/*                     -> the local Claude (vite.ai.mjs)
import { promises as fs } from "node:fs";
import path from "node:path";
import { handleAi } from "./vite.ai.mjs";

const defaultDir = new URL("./user-data", import.meta.url).pathname;
const startedAt = String(Math.floor(Date.now() / 1000));
const keyPattern = /^[a-z][a-z0-9-]{0,40}$/;

/**
 * Writes `bytes` as `file` so that at every moment `file` is whole — the old bytes or the new (11-10):
 * the new bytes go to a temporary file of their own and to the disk (fsync: a power cut right after the
 * rename could otherwise leave the new name on empty or half bytes), the old file is kept as <file>.prev
 * by a hard link (no copy, however big), and only then the temporary file takes the name.
 */
export async function writeKeeping(file, bytes) {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await keepPrevious(file);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined); // no half-written leftovers
    throw err;
  }
}

/** <file>.prev becomes the file as it is now (nothing when there is none). */
async function keepPrevious(file) {
  const linking = `${file}.prev.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.link(file, linking);
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    // A disk without hard links: a copy, which costs time but keeps the same promise.
    await fs.copyFile(file, linking).catch(() => undefined);
  }
  await fs.rename(linking, `${file}.prev`).catch(() => fs.rm(linking, { force: true }).catch(() => undefined));
}

/** The request handler, on a folder of its own (tests use a temporary one; the app uses rodin-pipeline/user-data). */
export function makeHandler(userDataDir = defaultDir) {
  return async function handle(req, res, next) {
    const url = req.url ?? "";
    if (url === "/__rodin/ping") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("X-Rodin-Started", startedAt);
      res.end("ok");
      return;
    }
    if (url.startsWith("/__rodin/ai/")) {
      try {
        if (await handleAi(req, res)) return;
      } catch (err) {
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end(String(err));
        }
        return;
      }
      return next();
    }
    const match = /^\/__rodin\/data\/([^/?#]+)(\?prev=1)?$/.exec(url);
    if (!match) return next();
    const key = match[1];
    const previous = Boolean(match[2]);
    if (!keyPattern.test(key) || (previous && req.method !== "GET")) {
      res.statusCode = 400;
      res.end("bad key");
      return;
    }
    const file = path.join(userDataDir, key);
    try {
      if (req.method === "GET") {
        const data = await fs.readFile(previous ? `${file}.prev` : file);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        res.end(data);
      } else if (req.method === "PUT") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        await fs.mkdir(userDataDir, { recursive: true });
        await writeKeeping(file, Buffer.concat(chunks));
        res.statusCode = 204;
        res.end();
      } else if (req.method === "DELETE") {
        // Kept as the previous copy: a delete that should not have happened (a model opened by mistake) can be read back.
        await fs.rename(file, `${file}.prev`);
        res.statusCode = 204;
        res.end();
      } else {
        res.statusCode = 405;
        res.end();
      }
    } catch (err) {
      // Only a read (or a delete) of a missing key is "nothing there": a write that failed must say so.
      const missing = err && err.code === "ENOENT" && req.method !== "PUT";
      // A missing key answers 204 (not 404) so the browser console stays free of failed-load noise.
      res.statusCode = missing ? 204 : 500;
      if (missing) res.setHeader("X-Rodin-Missing", "1");
      res.end(missing ? undefined : String(err));
    }
  };
}

/** Temporary files left by a write that never finished (the server stopped mid-write), an hour old or more. */
async function sweepLeftovers(userDataDir = defaultDir) {
  const names = await fs.readdir(userDataDir).catch(() => []);
  const hourAgo = Date.now() - 3600_000;
  for (const name of names) {
    if (!name.endsWith(".tmp")) continue;
    const file = path.join(userDataDir, name);
    const info = await fs.stat(file).catch(() => null);
    if (info && info.mtimeMs < hourAgo) await fs.rm(file, { force: true }).catch(() => undefined);
  }
}

export function userDataPlugin() {
  const handle = makeHandler();
  void sweepLeftovers();
  return {
    name: "rodin-user-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
  };
}
